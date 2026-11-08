"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const assistant = require("../assistant");

const WIN = process.platform === "win32";

// Every folder a test makes, removed when the file is done.
const made = [];
function folder(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}
test.after(() => made.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

/* An installed extension as far as VERTEX looks at it: the executable where
   each assistant keeps it, and nothing else. */
function extension(kind) {
  const root = folder("vertex-ext-");
  if (kind === "claude") {
    const dir = path.join(root, "resources", "native-binary");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, WIN ? "claude.exe" : "claude"), "");
  } else {
    const dir = path.join(root, "bin", "this-platform");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "codex-package.json"), JSON.stringify({
      target: assistant.TRIPLES[process.platform + "-" + process.arch] }));
    fs.writeFileSync(path.join(dir, WIN ? "codex.exe" : "codex"), "");
    const other = path.join(root, "bin", "other-platform");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "codex-package.json"), JSON.stringify({ target: "none" }));
  }
  return root;
}

/* A child process that does what the test says once it has its input. */
function spawner(behave) {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const call = { file, args, options, input: null, child };
    child.stdin = { on() {}, end(text) { call.input = text; setImmediate(() => behave(call)); } };
    child.kill = () => { child.killed = true; setImmediate(() => child.emit("close", null)); };
    calls.push(call);
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

function after(args, flag) {
  return args[args.indexOf(flag) + 1];
}

const PLAN = { reply: "ok", table: "SFLIGHT", filters: [], join: [], fields: [],
               pivot: { rows: [], cols: [], vals: [] } };

function common(spawn, kind, extra) {
  return Object.assign({
    assistant: kind, model: "", extensionPath: extension(kind),
    url: "http://127.0.0.1:37777/selector", token: "secret-token",
    instructions: "RULES", prompt: "PROMPT", schema: { type: "object" },
    tools: ["sap_table_layout"], spawn: spawn
  }, extra || {});
}

test("Claude Code runs shut in: no built-in tool, one MCP server, the token only in the environment", async () => {
  let config = null, systemPrompt = null;
  const spawn = spawner(call => {
    config = fs.readFileSync(after(call.args, "--mcp-config"), "utf8");
    systemPrompt = fs.readFileSync(after(call.args, "--system-prompt-file"), "utf8");
    call.child.stdout.emit("data", JSON.stringify({
      type: "result", subtype: "success", is_error: false, result: "",
      structured_output: PLAN, modelUsage: { "claude-haiku-4-5-20251001": {} }
    }));
    call.child.emit("close", 0);
  });
  const answer = await assistant.ask(common(spawn, "claude", { model: "haiku" }));
  assert.deepEqual(answer, { plan: PLAN, model: "claude-haiku-4-5-20251001",
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });

  const call = spawn.calls[0];
  assert.match(call.file, /native-binary[\\/]claude(\.exe)?$/);
  assert.equal(after(call.args, "--tools"), "");
  assert.ok(call.args.includes("--strict-mcp-config"));
  assert.equal(after(call.args, "--allowedTools"), "mcp__vertex__sap_table_layout");
  assert.equal(after(call.args, "--model"), "haiku");
  // The instructions travel in a file: Windows and cmd cap the command line.
  assert.equal(call.args.includes("--system-prompt"), false);
  assert.match(after(call.args, "--system-prompt-file"), /system-prompt\.md$/);
  assert.equal(systemPrompt, "RULES");
  assert.equal(after(call.args, "--output-format"), "json");
  assert.equal(call.input, "PROMPT");
  assert.equal(call.options.env.VERTEX_WINDOW_TOKEN, "secret-token");
  assert.equal(call.options.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
  assert.equal(call.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.match(config, /"Authorization":"Bearer \$\{VERTEX_WINDOW_TOKEN\}"/);
  assert.doesNotMatch(config, /secret-token/);
  assert.doesNotMatch(call.args.join(" "), /secret-token/);
  assert.equal(fs.existsSync(call.options.cwd), false, "the run's folder is removed");
});

test("in a working folder Claude Code runs there with its file and shell tools and the folder's CLAUDE.md", async () => {
  const work = folder("vertex-work-");
  const spawn = spawner(call => {
    assert.ok(fs.existsSync(after(call.args, "--mcp-config")), "the MCP config stays in the run's own folder");
    call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false,
      result: "", structured_output: PLAN, modelUsage: {} }));
    call.child.emit("close", 0);
  });
  let config = null;
  const wrapped = (file, args, options) => {
    const child = spawn(file, args, options);
    config = JSON.parse(fs.readFileSync(after(args, "--mcp-config"), "utf8"));
    return child;
  };
  wrapped.calls = spawn.calls;
  await assistant.ask(common(wrapped, "claude", { workDir: work, approveUrl: "http://127.0.0.1:37777/approve" }));
  const call = spawn.calls[0];
  assert.equal(call.options.cwd, work);
  assert.equal(after(call.args, "--tools"), "Read,Grep,Glob,Edit,Write,Bash");
  assert.equal(after(call.args, "--allowedTools"), "Read,Grep,Glob,mcp__vertex__sap_table_layout");
  assert.equal(after(call.args, "--permission-prompt-tool"), "mcp__vertex_approve__approve_action");
  assert.equal(config.mcpServers.vertex_approve.url, "http://127.0.0.1:37777/approve");
  await assert.rejects(assistant.ask(common(spawner(() => {}), "claude", { workDir: work })), /approval address/);
  assert.equal(call.options.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, undefined);
  assert.equal(call.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.ok(fs.existsSync(work), "the working folder is not removed");
});

test("in a git working copy edits run freely and only Bash asks", async () => {
  const work = folder("vertex-copy-");
  const spawn = spawner(call => {
    call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false,
      result: "", structured_output: PLAN, modelUsage: {} }));
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { workDir: work, reviewAfter: true, approveUrl: "http://127.0.0.1:1/approve" }));
  const call = spawn.calls[0];
  assert.equal(call.options.cwd, work);
  assert.equal(after(call.args, "--allowedTools"), "Read,Grep,Glob,Edit,Write,mcp__vertex__sap_table_layout");
  assert.equal(after(call.args, "--permission-prompt-tool"), "mcp__vertex_approve__approve_action");
  await assistant.ask(common(spawn, "claude", { workDir: work, reviewAfter: true, shellWithoutAsking: true, approveUrl: "http://127.0.0.1:1/approve" }));
  assert.equal(after(spawn.calls[1].args, "--allowedTools"), "Read,Grep,Glob,Edit,Write,Bash,mcp__vertex__sap_table_layout");
  await assistant.ask(common(spawn, "claude", { workDir: work, shellWithoutAsking: true, approveUrl: "http://127.0.0.1:1/approve" }));
  assert.equal(after(spawn.calls[2].args, "--allowedTools"), "Read,Grep,Glob,mcp__vertex__sap_table_layout", "outside a copy the setting does nothing");
});

test("Claude Code's own steps reach onStep, the SAP tools and the answer's StructuredOutput do not", async () => {
  const steps = [];
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "assistant", message: { content: [
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } },
      { type: "tool_use", id: "t2", name: "mcp__vertex__read_sap_object", input: {} },
      { type: "tool_use", id: "t3", name: "StructuredOutput", input: {} }] } });
    send({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" },
      { type: "tool_result", tool_use_id: "t2", content: "source" }] } });
    send({ type: "result", subtype: "success", is_error: false, structured_output: PLAN, modelUsage: {} });
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress() {}, onStep: step => steps.push(step) }));
  assert.deepEqual(steps, [{ kind: "use", id: "t1", name: "Bash", input: { command: "npm test" } },
    { kind: "result", id: "t1", name: "Bash", is_error: false, content: "ok" }]);
});

test("Claude's thinking is taken from the stream and logged after its message's model step", async () => {
  const order = [];
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } });
    send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Found the markup; " } } });
    send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "checking logs.js." } } });
    send({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
    send({ type: "assistant", message: { id: "m1", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Now the notes." }] } });
    send({ type: "result", subtype: "success", is_error: false, structured_output: PLAN, modelUsage: {} });
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress() {},
    onProviderResponse: event => { if (event.scope === "model_response") order.push("model " + event.response.id); },
    onStep: step => order.push(step.note + ": " + step.text) }));
  assert.deepEqual(order, ["model m1", "thinking: Found the markup; checking logs.js.", "text: Now the notes."]);
});

test("the effort level reaches Claude Code as --effort and Codex as model_reasoning_effort, a foreign level not at all", async () => {
  const done = call => { call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false,
    structured_output: PLAN, modelUsage: {} })); call.child.emit("close", 0); };
  const claude = spawner(done);
  await assistant.ask(common(claude, "claude", { effort: "xhigh" }));
  assert.equal(after(claude.calls[0].args, "--effort"), "xhigh");
  await assistant.ask(common(claude, "claude", { effort: "minimal" }));
  assert.equal(claude.calls[1].args.includes("--effort"), false, "Claude Code takes no 'minimal'");
  await assistant.ask(common(claude, "claude", {}));
  assert.equal(claude.calls[2].args.includes("--effort"), false, "nothing when not set");
  const codex = spawner(call => {
    require("node:fs").writeFileSync(after(call.args, "-o"), JSON.stringify(PLAN));
    call.child.emit("close", 0);
  });
  await assistant.ask(common(codex, "codex", { effort: "high" }));
  assert.ok(codex.calls[0].args.includes("model_reasoning_effort=high"));
});

test("pasted screenshots go to Claude Code inside a stream-json message", async () => {
  const spawn = spawner(call => {
    call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false,
      result: "", structured_output: PLAN, modelUsage: {} }) + "\n");
    call.child.emit("close", 0);
  });
  const image = { media_type: "image/png", data: "iVBORw0KGgo=" };
  await assistant.ask(common(spawn, "claude", { images: [image], onProgress() {} }));
  const call = spawn.calls[0];
  assert.equal(after(call.args, "--input-format"), "stream-json");
  assert.equal(after(call.args, "--output-format"), "stream-json");
  const message = JSON.parse(call.input.trim());
  assert.equal(message.type, "user");
  assert.deepEqual(message.message.content, [{ type: "text", text: "PROMPT" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }]);
});

test("a screenshot is refused, not dropped, where it cannot be sent", async () => {
  const image = { media_type: "image/png", data: "x" };
  await assert.rejects(assistant.ask(common(spawner(() => {}), "codex", { images: [{ media_type: "text/html", data: "eA==" }] })), /Invalid screenshot/);
  await assert.rejects(assistant.ask(common(spawner(() => {}), "claude", { images: [image] })), /streaming chat/);
});

test("every model Claude Code reports is named, the one that wrote most first", async () => {
  const spawn = spawner(call => {
    call.child.stdout.emit("data", JSON.stringify({
      type: "result", subtype: "success", is_error: false, result: "", structured_output: PLAN,
      modelUsage: { "claude-haiku-4-5-20251001": { outputTokens: 31 },
                    "claude-sonnet-5": { outputTokens: 912 } }
    }));
    call.child.emit("close", 0);
  });
  const answer = await assistant.ask(common(spawn, "claude", { model: "sonnet" }));
  assert.equal(answer.model, "claude-sonnet-5, claude-haiku-4-5-20251001");
  assert.deepEqual(answer.usage, { input_tokens: 0, output_tokens: 943, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

test("Claude streams only the answer field before the final structured result", async () => {
  const updates = [];
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "stream_event", event: { type: "content_block_delta",
      delta: { type: "text_delta", text: '{"answer":"First ' } } });
    send({ type: "stream_event", event: { type: "content_block_delta",
      delta: { type: "text_delta", text: 'line\\nsecond","navigation":null}' } } });
    send({ type: "result", subtype: "success", is_error: false,
      structured_output: { answer: "First line\nsecond", navigation: null } });
    call.child.emit("close", 0);
  });
  const answer = await assistant.ask(common(spawn, "claude", {
    onProgress: update => updates.push(update)
  }));
  assert.equal(after(spawn.calls[0].args, "--output-format"), "stream-json");
  assert.ok(spawn.calls[0].args.includes("--include-partial-messages"));
  assert.deepEqual(updates, [{ answer: "First " }, { answer: "First line\nsecond" }]);
  assert.equal(answer.plan.answer, "First line\nsecond");
});

test("Claude Code 2.1 streams plain text before structured output", async () => {
  const updates = [];
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "stream_event", event: { type: "message_start", message: { role: "assistant" } } });
    send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "First " } } });
    send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "answer" } } });
    send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"answer":"First answer"}' } } });
    send({ type: "result", subtype: "success", is_error: false, structured_output: { answer: "First answer" } });
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress: update => updates.push(update) }));
  assert.deepEqual(updates, [{ answer: "First " }, { answer: "First answer" }]);
});

test("Claude names the SAP object being read and does not restart the answer", async () => {
  const updates = [];
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "stream_event", event: { type: "content_block_start", index: 0,
      content_block: { type: "tool_use", name: "mcp__vertex__read_sap_object" } } });
    send({ type: "stream_event", event: { type: "content_block_delta", index: 0,
      delta: { type: "input_json_delta", partial_json: '{"object_type":"CLAS","object_name":"ZCL_CALC"}' } } });
    send({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
    for (const part of ["Hello", "Hello", "Hello world"]) {
      send({ type: "stream_event", event: { type: "message_start", message: { role: "assistant" } } });
      send({ type: "stream_event", event: { type: "content_block_delta",
        delta: { type: "text_delta", text: part } } });
    }
    send({ type: "result", subtype: "success", is_error: false, structured_output: { answer: "Hello world" } });
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress: update => updates.push(update) }));
  assert.deepEqual(updates, [
    { status: "Using read_sap_object…" },
    { status: "Using read_sap_object: CLAS ZCL_CALC…" },
    { answer: "Hello" }, { answer: "Hello world" }
  ]);
});

test("Claude streams reasoning and the current tool name separately from the answer", async () => {
  const updates = [];
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "stream_event", event: { type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "Checking the run" } } });
    send({ type: "stream_event", event: { type: "content_block_start",
      content_block: { type: "tool_use", name: "mcp__vertex__run_abap_transpiler" } } });
    send({ type: "result", subtype: "success", is_error: false, structured_output: PLAN });
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress: update => updates.push(update) }));
  assert.deepEqual(updates, [{ thinking: "Checking the run" }, { status: "Claude is thinking…" },
    { status: "Using run_abap_transpiler…" }]);
});

test("an empty thinking delta does not claim visible reasoning", async () => {
  const updates = [];
  const spawn = spawner(call => {
    call.child.stdout.emit("data", JSON.stringify({ type: "stream_event", event: {
      type: "content_block_delta", delta: { type: "thinking_delta", thinking: "" } } }) + "\n");
    call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false,
      structured_output: PLAN }) + "\n");
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress: update => updates.push(update) }));
  assert.deepEqual(updates, [{ status: "Claude is working…" }]);
});

test("Claude Code's own failure reaches the chat in its own words", async () => {
  const run = (stdout, stderr, code) => assistant.ask(common(spawner(call => {
    if (stdout) { call.child.stdout.emit("data", stdout); }
    if (stderr) { call.child.stderr.emit("data", stderr); }
    call.child.emit("close", code);
  }), "claude"));
  await assert.rejects(run(JSON.stringify({ subtype: "success", is_error: true,
                                            result: "Credit balance is too low" }), "", 1),
                       /Claude Code: Credit balance is too low/);
  await assert.rejects(run("", "Invalid API key - please run /login", 1), /please run \/login/);
  await assert.rejects(run(JSON.stringify({ subtype: "success", is_error: false,
                                            result: "I could not." }), "", 0),
                       /answered without a plan: I could not\./);
});

test("Codex runs without the person's config, shell or plugins, and gets the rules with the request", async () => {
  const spawn = spawner(call => {
    fs.writeFileSync(after(call.args, "-o"), JSON.stringify(PLAN));
    call.child.stderr.emit("data", "OpenAI Codex\n--------\nmodel: gpt-5.6-luna\nsandbox: read-only\n");
    call.child.emit("close", 0);
  });
  const answer = await assistant.ask(common(spawn, "codex", { model: "gpt-5.6-luna" }));
  assert.deepEqual(answer, { plan: PLAN, model: "gpt-5.6-luna" });

  const args = spawn.calls[0].args;
  assert.equal(args[0], "exec");
  assert.ok(args.includes("--ignore-user-config"));
  assert.equal(after(args, "-s"), "read-only");
  for (const feature of ["shell_tool", "unified_exec", "plugins", "apps"]) {
    assert.ok(args.some((a, i) => a === "--disable" && args[i + 1] === feature), feature);
  }
  assert.ok(args.includes("mcp_servers.vertex.url=http://127.0.0.1:37777/selector"));
  assert.ok(args.includes("mcp_servers.vertex.bearer_token_env_var=VERTEX_WINDOW_TOKEN"));
  assert.equal(after(args, "-m"), "gpt-5.6-luna");
  assert.equal(args[args.length - 1], "-");
  assert.equal(spawn.calls[0].input, "RULES\n\nPROMPT");
  assert.doesNotMatch(args.join(" "), /secret-token/);
});

test("Codex delegates only supplied local-tool approvals to VERTEX", async () => {
  const spawn = spawner(call => {
    fs.writeFileSync(after(call.args, "-o"), JSON.stringify(PLAN));
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "codex", { localTools: true, tools: ["Read", "Edit", "read_sap_object"] }));
  const args = spawn.calls[0].args;
  assert.ok(args.includes('mcp_servers.vertex.tools.Read.approval_mode="approve"'));
  assert.ok(args.includes('mcp_servers.vertex.tools.Edit.approval_mode="approve"'));
  assert.ok(!args.some(arg => /tools\.(Bash|read_sap_object)\.approval_mode/.test(arg)));
  assert.equal(after(args, "-s"), "read-only");
});

test("Codex runs the tools of an MCP server VERTEX passes on, and only those it was given", async () => {
  const spawn = spawner(call => {
    fs.writeFileSync(after(call.args, "-o"), JSON.stringify(PLAN));
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "codex", { tools: ["read_sap_object", "abap_objects_generator_list"],
    externalTools: ["abap_objects_generator_list", "abap_not_offered", "bad name;rm"] }));
  const args = spawn.calls[0].args;
  assert.ok(args.includes('mcp_servers.vertex.tools.abap_objects_generator_list.approval_mode="approve"'));
  assert.ok(!args.some(arg => /tools\.(read_sap_object|abap_not_offered|bad name)/.test(arg)), "nothing beyond the external tools of this request");
});

test("Codex receives no SAP MCP server when the chat has no SAP tools", async () => {
  const spawn = spawner(call => {
    fs.writeFileSync(after(call.args, "-o"), JSON.stringify({ answer: "ok", navigation: null }));
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "codex", { tools: [] }));
  assert.doesNotMatch(spawn.calls[0].args.join(" "), /mcp_servers\.vertex/);
});

test("Codex's refusal comes through as the provider's sentence", async () => {
  const run = stderr => assistant.ask(common(spawner(call => {
    call.child.stderr.emit("data", stderr);
    call.child.emit("close", 1);
  }), "codex"));
  await assert.rejects(run("model: gpt-5.4-mini\nERROR: {\"type\":\"error\",\"status\":400,\"error\":"
    + "{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-5.4-mini' model is not supported "
    + "when using Codex with a ChatGPT account.\"}}\n"),
    /^Error: Codex: The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account\.$/);
  await assert.rejects(run("ERROR: You've hit your usage limit. Try again at 5:28 PM.\n"),
                       /Codex: You've hit your usage limit/);
});

test("a run that does not answer is stopped and says so", async () => {
  const spawn = spawner(() => { /* never answers */ });
  await assert.rejects(assistant.ask(common(spawn, "claude", { timeout: 30 })),
                       /Claude Code did not answer within 0 seconds and was stopped/);
  assert.equal(spawn.calls[0].child.killed, true);
});

test("an assistant that is not there is named, not guessed", async () => {
  const empty = folder("vertex-ext-");
  await assert.rejects(assistant.ask(common(spawner(() => {}), "claude", { extensionPath: empty })),
                       /has no executable at/);
  await assert.rejects(assistant.ask(common(spawner(() => {}), "codex", { extensionPath: empty })),
                       /has no executable at/);
  await assert.rejects(assistant.ask(common(spawner(() => {}), "copilot")),
                       /knows no assistant called copilot/);
});

test("Codex's model list starts with its weakest model and marks the one config.toml names", async () => {
  const home = folder("vertex-codex-");
  fs.writeFileSync(path.join(home, "config.toml"),
                   'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "low"\n[profiles.x]\nmodel = "other"\n');
  const spawn = spawner(call => {
    assert.deepEqual(call.args, ["debug", "models"]);
    call.child.stdout.emit("data", JSON.stringify({ models: [
      { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list", priority: 12 },
      { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 3 },
      { slug: "gpt-5.6-luna", display_name: "GPT-5.6-Luna", visibility: "list", priority: 8 },
      { slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list", priority: 1 }
    ] }));
    call.child.emit("close", 0);
  });
  const list = await assistant.models({ assistant: "codex", extensionPath: extension("codex"),
                                        codexHome: home, spawn: spawn });
  assert.deepEqual(list, [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
    { id: "gpt-6-astra", label: "GPT-6-Astra" }
  ]);
  assert.equal(assistant.configuredCodexModel(folder("vertex-codex-")), "");
});

test("Claude's list is versions by full id, the newest of each family on and the weakest first", async () => {
  const list = await assistant.models({ assistant: "claude", extensionPath: extension("claude") });
  assert.deepEqual(list.filter(m => m.on).map(m => m.id),
    ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1"]);
  assert.ok(list.every(m => /^claude-/.test(m.id)));
});

test("Claude Code's StructuredOutput call streams as the answer, not as a tool in use", async () => {
  const updates = [];
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "stream_event", event: { type: "content_block_start", index: 1,
      content_block: { type: "tool_use", name: "StructuredOutput", input: {} } } });
    send({ type: "stream_event", event: { type: "content_block_delta", index: 1,
      delta: { type: "input_json_delta", partial_json: '{"answer":"Five ' } } });
    send({ type: "stream_event", event: { type: "content_block_delta", index: 1,
      delta: { type: "input_json_delta", partial_json: 'runs","navigation":null}' } } });
    send({ type: "stream_event", event: { type: "content_block_stop", index: 1 } });
    send({ type: "result", subtype: "success", is_error: false, structured_output: { answer: "Five runs", navigation: null } });
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress: update => updates.push(update) }));
  assert.deepEqual(updates, [{ answer: "Five " }, { answer: "Five runs" }]);
});


test("Claude reports original model usage and CLI totals separately", async () => {
  const events = [];
  const usage = { input_tokens: 2, cache_creation_input_tokens: 123, output_tokens: 8 };
  const modelUsage = { opus: { inputTokens: 2, outputTokens: 8, cacheCreationInputTokens: 123 } };
  const spawn = spawner(call => {
    const send = event => call.child.stdout.emit("data", JSON.stringify(event) + "\n");
    send({ type: "assistant", message: { id: "raw-message", model: "opus", usage } });
    send({ type: "result", subtype: "success", structured_output: PLAN, usage, modelUsage, num_turns: 3 });
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { onProgress() {}, onProviderResponse: event => events.push(event) }));
  assert.deepEqual(events.map(event => event.scope), ["model_response", "cli_run"]);
  assert.deepEqual(events[0].response.usage, usage);
  assert.deepEqual(events[1].response.modelUsage, modelUsage);
});

test("CodeMie's model table: the id and name of each model, embeddings left out", () => {
  const table = "\u001b[1m\nProvider: \u001b[36mai-run-sso\u001b[39m\u001b[22m\n\n"
    + "ID                     NAME                         TYPE       DESCRIPTION\n"
    + "─".repeat(80) + "\n"
    + "\u001b[36mclaude-4-5-sonnet      \u001b[39mBedrock Claude 4.5 Sonnet    model      \n"
    + "claude-haiku-5-5       Bedrock Claude Haiku 5.5     model      fast\n"
    + "text-embedding-005     Embedding                    embedding  \n"
    + "\n50 model(s) available.\n";
  assert.deepEqual(assistant.codemieModels(table), [
    { id: "claude-4-5-sonnet", label: "Bedrock Claude 4.5 Sonnet" },
    { id: "claude-haiku-5-5", label: "Bedrock Claude Haiku 5.5" }]);
  assert.deepEqual(assistant.codemieModels("No profiles found."), []);
});

test("CodeMie runs Claude Code through codemie-claude: Claude's options, its folder first on PATH", { skip: WIN }, async () => {
  const bin = folder("vertex-codemie-");
  const file = path.join(bin, "codemie-claude");
  fs.writeFileSync(file, "", { mode: 0o755 });
  const spawn = spawner(call => {
    call.child.stdout.emit("data", JSON.stringify({
      type: "result", subtype: "success", is_error: false, result: "",
      structured_output: PLAN, modelUsage: { "claude-haiku-5-5": {} }
    }));
    call.child.emit("close", 0);
  });
  const answer = await assistant.ask(common(spawn, "codemie", { model: "claude-haiku-5-5", extensionPath: "", executable: file }));
  assert.equal(answer.model, "claude-haiku-5-5");
  const call = spawn.calls[0];
  assert.equal(call.file, file);
  assert.equal(after(call.args, "--model"), "claude-haiku-5-5");
  assert.equal(after(call.args, "--tools"), "");
  assert.equal(call.options.env.PATH.split(path.delimiter)[0], bin);
  assert.equal(call.options.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
});

test("CodeMie's profiles come from its global configuration; a chosen one reaches models list and the run", { skip: WIN }, async () => {
  const home = folder("vertex-home-");
  fs.mkdirSync(path.join(home, ".codemie"));
  fs.writeFileSync(path.join(home, ".codemie", "codemie-cli.config.json"),
    JSON.stringify({ version: 2, activeProfile: "work", profiles: { work: {}, personal: {} } }));
  assert.deepEqual(assistant.codemieProfiles(home), { names: ["personal", "work"], active: "work" });
  assert.deepEqual(assistant.codemieProfiles(folder("vertex-empty-")), { names: [], active: "" });

  const bin = folder("vertex-codemie-");
  const file = path.join(bin, "codemie-claude");
  fs.writeFileSync(file, "", { mode: 0o755 });
  let overlay = null;
  const lists = spawner(call => {
    overlay = JSON.parse(fs.readFileSync(path.join(call.options.cwd, ".codemie", "codemie-cli.config.json"), "utf8"));
    call.child.stdout.emit("data", "ID   NAME   TYPE\n" + "─".repeat(20) + "\nclaude-haiku-5-5   Haiku 5.5   model\n");
    call.child.emit("close", 0);
  });
  const models = await assistant.models({ assistant: "codemie", executable: file, profile: "personal", spawn: lists });
  assert.equal(lists.calls[0].file, path.join(bin, "codemie"));
  assert.equal(overlay.activeProfile, "personal");
  assert.deepEqual(models.map(m => m.id), ["", "claude-haiku-5-5"]);

  const runs = spawner(call => {
    call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "",
      structured_output: PLAN, modelUsage: { "claude-haiku-5-5": {} } }));
    call.child.emit("close", 0);
  });
  await assistant.ask(common(runs, "codemie", { extensionPath: "", executable: file, profile: "personal" }));
  assert.deepEqual(runs.calls[0].args.slice(0, 2), ["--profile", "personal"]);
});

test("a CodeMie profile chosen in the settings counts only while CodeMie has it", () => {
  const home = folder("vertex-home-");
  fs.mkdirSync(path.join(home, ".codemie"));
  fs.writeFileSync(path.join(home, ".codemie", "codemie-cli.config.json"),
    JSON.stringify({ version: 2, activeProfile: "work", profiles: { work: {} } }));
  const vscode = chosen => ({ workspace: { getConfiguration: () => ({ get: () => chosen }) } });
  assert.equal(assistant.profileFor(vscode("work"), "codemie", home), "work");
  assert.equal(assistant.profileFor(vscode("gone"), "codemie", home), "");
  assert.equal(assistant.profileFor(vscode("work"), "claude", home), "");
});

test("Claude Code's reckoned cost comes back with the answer; the panel writes it after the tokens", async () => {
  const spawn = spawner(call => {
    call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "",
      structured_output: PLAN, total_cost_usd: 0.00312, modelUsage: { "claude-haiku-5-5": {} } }));
    call.child.emit("close", 0);
  });
  const answer = await assistant.ask(common(spawn, "claude"));
  assert.equal(answer.cost, 0.00312);
  const { usageLine } = require("../sidebar");
  const usage = { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.match(usageLine({ model: "m", usage, cost: 0.00312 }), / · ≈ \$0\.0031$/);
  assert.match(usageLine({ model: "m", usage, cost: 0.1234567 }), / · ≈ \$0\.1235$/);
  assert.doesNotMatch(usageLine({ model: "m", usage }), /\$/);
});

test("on Windows CodeMie's commands are found through npm's .cmd folder, never its package's .js folder", () => {
  const file = String.raw`C:\Users\u\AppData\Roaming\npm\node_modules\@codemieai\code\bin\codemie-claude.js`;
  const env = assistant.codemieEnv(file, { Path: String.raw`C:\Windows` }, "win32");
  const first = env.Path.split(";")[0];
  assert.equal(first, String.raw`C:\Users\u\AppData\Roaming\npm`);
  assert.ok(!env.Path.includes(String.raw`@codemieai\code\bin`));
  const unix = assistant.codemieEnv("/usr/local/bin/codemie-claude", { PATH: "/usr/bin" }, "linux");
  assert.equal(unix.PATH.split(":")[0], "/usr/local/bin");
});

for (const fails of [false, true]) test("Codex receives multiple screenshot files and cleans them after " + (fails ? "failure" : "success"), async () => {
  let files;
  const images = [{ media_type: "image/png", data: "iVBORw0KGgo=" }, { media_type: "image/jpeg", data: "/9j/" }];
  const spawn = spawner(call => {
    files = call.args.flatMap((arg, i) => arg === "--image" ? [call.args[i + 1]] : []);
    assert.equal(files.length, 2);
    files.forEach((file, i) => assert.deepEqual(fs.readFileSync(file), Buffer.from(images[i].data, "base64")));
    assert.equal(call.input, "RULES\n\nPROMPT");
    if (!fails) fs.writeFileSync(after(call.args, "-o"), JSON.stringify(PLAN));
    call.child.emit("close", fails ? 1 : 0);
  });
  const request = assistant.ask(common(spawn, "codex", { images }));
  if (fails) await assert.rejects(request); else await request;
  files.forEach(file => assert.equal(fs.existsSync(file), false));
});

test("Claude retains native tools and approval routing in a local-agent request", async () => {
  const spawn = spawner(call => {
    for (const name of ["Read", "Grep", "Glob", "Edit", "Write", "Bash"]) assert.ok(after(call.args, "--tools").split(",").includes(name));
    assert.equal(call.args.includes("--permission-prompt-tool"), true);
    assert.ok(after(call.args, "--allowedTools").split(",").includes("Edit"));
    assert.equal(after(call.args, "--allowedTools").split(",").includes("Bash"), false);
    const config = JSON.parse(fs.readFileSync(after(call.args, "--mcp-config"), "utf8"));
    assert.ok(Object.values(config.mcpServers).some(server => server.url === "http://localhost/approve"));
    call.child.stdout.emit("data", JSON.stringify({ type: "result", subtype: "success", structured_output: PLAN }));
    call.child.emit("close", 0);
  });
  await assistant.ask(common(spawn, "claude", { workDir: folder("vertex-native-"), reviewAfter: true, approveUrl: "http://localhost/approve", tools: [] }));
});

test('Codex JSONL reports exact tokens and original counters without treating subscription as dollars',async()=>{
 const events=[],calls=[];const spawn=spawner(call=>{
  fs.writeFileSync(after(call.args,'-o'),JSON.stringify(PLAN));
  call.child.stdout.emit('data',JSON.stringify({type:'thread.started',thread_id:'thread-cost'})+'\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:60,output_tokens:5}})+'\n');call.child.emit('close',0);
 });
 const result=await assistant.ask(common(spawn,'codex',{model:'gpt-test',onProviderResponse:event=>events.push(event),onModelCall:event=>calls.push(event)}));
 assert.ok(spawn.calls[0].args.includes('--json'));assert.equal(result.usage.input_tokens,40);assert.equal(result.usage.cache_read_input_tokens,60);assert.equal(result.usage.output_tokens,5);assert.equal(result.model,'gpt-test');assert.equal(events[0].response.usage.input_tokens,100);assert.equal(calls[0].usage.generation_id,'thread-cost:1');assert.equal(calls[0].usage.cost_usd,undefined);
});
