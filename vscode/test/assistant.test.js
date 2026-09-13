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
  let config = null;
  const spawn = spawner(call => {
    config = fs.readFileSync(after(call.args, "--mcp-config"), "utf8");
    call.child.stdout.emit("data", JSON.stringify({
      type: "result", subtype: "success", is_error: false, result: "",
      structured_output: PLAN, modelUsage: { "claude-haiku-4-5-20251001": {} }
    }));
    call.child.emit("close", 0);
  });
  const answer = await assistant.ask(common(spawn, "claude", { model: "haiku" }));
  assert.deepEqual(answer, { plan: PLAN, model: "claude-haiku-4-5-20251001" });

  const call = spawn.calls[0];
  assert.match(call.file, /native-binary[\\/]claude(\.exe)?$/);
  assert.equal(after(call.args, "--tools"), "");
  assert.ok(call.args.includes("--strict-mcp-config"));
  assert.equal(after(call.args, "--allowedTools"), "mcp__vertex__sap_table_layout");
  assert.equal(after(call.args, "--model"), "haiku");
  assert.equal(after(call.args, "--system-prompt"), "RULES");
  assert.equal(after(call.args, "--output-format"), "json");
  assert.equal(call.input, "PROMPT");
  assert.equal(call.options.env.VERTEX_WINDOW_TOKEN, "secret-token");
  assert.match(config, /"Authorization":"Bearer \$\{VERTEX_WINDOW_TOKEN\}"/);
  assert.doesNotMatch(config, /secret-token/);
  assert.doesNotMatch(call.args.join(" "), /secret-token/);
  assert.equal(fs.existsSync(call.options.cwd), false, "the run's folder is removed");
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
  await assert.rejects(assistant.ask(common(spawner(() => {}), "claude", { extensionPath: "" })),
                       /Claude Code is not installed in this VS Code \(extension anthropic\.claude-code\)/);
  const empty = folder("vertex-ext-");
  await assert.rejects(assistant.ask(common(spawner(() => {}), "codex", { extensionPath: empty })),
                       /has no executable at/);
  await assert.rejects(assistant.ask(common(spawner(() => {}), "copilot")),
                       /knows no assistant called copilot/);
});

test("Codex's model list starts with the model config.toml names, then its catalog", async () => {
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
    { id: "gpt-5.6-luna", label: "gpt-5.6-luna (config.toml)" },
    { id: "gpt-6-astra", label: "GPT-6-Astra" },
    { id: "gpt-5.5", label: "GPT-5.5" }
  ]);
  assert.equal(assistant.configuredCodexModel(folder("vertex-codex-")), "");
});

test("Claude Code's list is its aliases, with its own default first", async () => {
  const list = await assistant.models({ assistant: "claude" });
  assert.deepEqual(list.map(m => m.id), ["", "fable", "opus", "sonnet", "haiku"]);
});
