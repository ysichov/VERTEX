"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../assistant");
const chat = require("../chat");
const copilot = require("../copilot");
const compatible = require("../openai-compatible");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

function fakeVscode(settings) {
  return {
    workspace: { getConfiguration: () => ({ get: (key, fallback) => (key in settings ? settings[key] : fallback) }) },
    extensions: { getExtension: () => ({ extensionPath: "/ext" }) },
    window: { tabGroups: { all: [{ isActive: true, tabs: [{ label: "z_calc.prog.abap", isActive: true, isDirty: false,
      input: { uri: { scheme: "file", fsPath: "C:\\git\\z_calc.prog.abap" } } }] }] } }
  };
}

test("the VS Code chat sends the conversation so far, and a new conversation starts empty", async (t) => {
  const prompts = [];
  let instructions = "";
  t.mock.method(assistant, "ask", async options => {
    prompts.push(options.prompt);
    instructions = options.instructions;
    return { plan: { answer: "Answer " + prompts.length }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const server = { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools, server);

  assert.equal((await ask("show Z_CALC")).answer, "Answer 1");
  await ask("and the second method?");
  assert.match(prompts[1], /show Z_CALC/);
  assert.match(prompts[1], /Answer 1/);
  assert.match(prompts[1], /Request:\nand the second method\?/);
  assert.match(prompts[1], /z_calc\.prog\.abap/);
  assert.match(instructions, /If a tool fails/);

  ask.newConversation();
  await ask("hello");
  assert.doesNotMatch(prompts[2], /show Z_CALC|Answer 1/);
});

test("a generic debug request cannot call the SAP debugger", async t => {
  const calls = [];
  t.mock.method(assistant, "ask", async options => {
    calls.push(options);
    return { plan: { answer: "Done" }, model: "sonnet", usage: null };
  });
  const tools = { schemas: ["run_abap_transpiler", "debug_start", "debug_wait"].map(name => ({ name, inputSchema: {} })),
    instructions: "", editorContext: () => null, execute: async name => ({ name }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "sonnet" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("Найди ошибку в Z_CALC дебаггером");
  assert.deepEqual(calls[0].tools, ["run_abap_transpiler"]);
  await ask("Запусти Z_CALC в SAP debugger");
  assert.deepEqual(calls[1].tools, ["run_abap_transpiler", "debug_start", "debug_wait"]);
});

test("a new conversation accepts a request while an old SAP debug wait is still running", async t => {
  let finishOld;
  const prompts = [];
  t.mock.method(assistant, "ask", options => {
    prompts.push(options.prompt);
    if (prompts.length === 1) return new Promise(resolve => { finishOld = resolve; });
    return Promise.resolve({ plan: { answer: "New answer" }, model: "sonnet", usage: null });
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const server = { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "sonnet" }), tools, server);
  const old = ask("debug in SAP");
  await new Promise(resolve => setImmediate(resolve));
  ask.newConversation();
  const next = await ask("find the error with the transpiler", { model: "new-selected-model" });
  assert.equal(next.answer, "New answer");
  assert.doesNotMatch(prompts[1], /debug in SAP/);
  assert.equal(assistant.ask.mock.calls[1].arguments[0].model, "new-selected-model");
  finishOld({ plan: { answer: "Old debugger answer" }, model: "haiku", usage: null });
  assert.equal((await old).superseded, true);
  await ask("follow up");
  assert.doesNotMatch(prompts[2], /Old debugger answer|debug in SAP/);
});

test("the VERTEX chat routes Copilot through VS Code with its SAP tools", async (t) => {
  let received;
  t.mock.method(copilot, "models", async () => [{ id: "model-one", label: "Model One" }]);
  t.mock.method(copilot, "ask", async (vscode, options) => {
    received = options;
    return { plan: { answer: "Done", navigation: null }, model: options.model, usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", description: "Read", inputSchema: {} }],
    instructions: "Read SAP", editorContext: () => null, execute: async () => ({ source: "ok" }) };
  const ask = chat.create(fakeVscode({ provider: "copilot", model: "" }), tools,
    { start: async () => { throw new Error("Copilot must not start an MCP server"); } });
  assert.equal((await ask("explain this class")).answer, "Done");
  assert.equal(received.model, "model-one");
  assert.deepEqual(received.tools.map(tool => tool.name), ["read_sap_object"]);
  assert.deepEqual(await received.callTool("read_sap_object", {}), { source: "ok" });
});

test("the VERTEX chat routes a key provider through its API with SAP tools", async (t) => {
  let received;
  t.mock.method(compatible, "models", async id => {
    assert.equal(id, "groq-api"); return [{ id: "groq-test", label: "Groq Test" }];
  });
  t.mock.method(compatible, "ask", async options => {
    received = options;
    return { plan: { answer: "Done", navigation: null }, model: options.model, usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", description: "Read", inputSchema: {} }],
    instructions: "Read SAP", editorContext: () => null, execute: async () => ({ source: "ok" }) };
  const ask = chat.create(fakeVscode({ provider: "groq-api", model: "" }), tools,
    { start: async () => { throw new Error("API provider must not start an MCP server"); } },
    { get: async key => key === "vertex.provider.groq-api.apiKey" ? "secret" : null });
  assert.equal((await ask("explain this class")).answer, "Done");
  assert.equal(received.assistant, "groq-api");
  assert.equal(received.apiKey, "secret");
  assert.equal(received.model, "groq-test");
  assert.deepEqual(received.tools.map(tool => tool.name), ["read_sap_object"]);
});

test("every direct model round is a separate Anthropic-format log entry", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-rounds-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(compatible, "ask", async options => {
    options.onModelCall({ model: "mistral-test", usage: { input_tokens: 10, output_tokens: 2 }, text: "" });
    options.onModelCall({ model: "mistral-test", usage: { input_tokens: 20, output_tokens: 3 }, text: "Done" });
    return { plan: { answer: "Done", navigation: null }, model: "mistral-test",
      usage: { input_tokens: 30, output_tokens: 5 } };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const ask = chat.create(fakeVscode({ provider: "mistral-api", model: "mistral-test", logPath: root,
    "log.questions": true, "log.answers": true }), tools, {}, { get: async () => "secret" });
  await ask("Explain");
  const dir = path.join(root, "claude_compatible");
  const file = fs.readdirSync(dir).find(name => name.endsWith(".jsonl"));
  const lines = fs.readFileSync(path.join(dir, file), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(line => line.type), ["user", "assistant", "assistant"]);
  assert.deepEqual(lines.slice(1).map(line => line.message.usage.output_tokens), [2, 3]);
  assert.equal(lines[2].message.content[0].text, "Done");
});

test("a selected fragment from an external ADT editor is sent to VERTEX chat", async (t) => {
  let prompt = "";
  t.mock.method(assistant, "ask", async options => {
    prompt = options.prompt;
    return { plan: { answer: "It is a type declaration." }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", execute: async () => ({}), editorContext: () => ({
    selected_fragment: { text: "TYPES: BEGIN OF ty_part.", path: "C:\\work\\zcl_test.clas.abap", language: "abap", start_line: 15, end_line: 15 }
  }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("а выделенная часть кода");
  assert.match(prompt, /Selected code fragment/);
  assert.match(prompt, /TYPES: BEGIN OF ty_part/);
  assert.doesNotMatch(prompt, /Active SAP editor context/);
});

test("the active editor's full source is never silently added to a chat prompt", async (t) => {
  let prompt = "";
  t.mock.method(assistant, "ask", async options => {
    prompt = options.prompt;
    return { plan: { answer: "Done." }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => ({ source: "SECRET_FULL_SOURCE_".repeat(10000) }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("найди транспорт Z12345");
  assert.doesNotMatch(prompt, /SECRET_FULL_SOURCE/);
});

test("a question about the open SAP code uses the tab source without a redundant read", async (t) => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "Visible program.", navigation: null }, model: "haiku", usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", inputSchema: {} }], instructions: "SAP tools",
    editorContext: () => ({ system_name: "ALC", object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB",
      source: "REPORT zvertex_debug_lab.\nSTART-OF-SELECTION." }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("что видишь");
  assert.match(request.prompt, /Active SAP editor source/);
  assert.match(request.prompt, /REPORT zvertex_debug_lab/);
  assert.match(request.instructions, /Do not read the same object again/);
});

test("the chat reads the active local ABAP document without a SAP system", async (t) => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "It calls ZCL_CALC.", navigation: null }, model: "haiku", usage: null };
  });
  const vscode = fakeVscode({ provider: "claude-subscription", model: "haiku", systems: [] });
  vscode.window.activeTextEditor = { document: { languageId: "abap",
    uri: { scheme: "file", fsPath: "C:\\work\\zvertex_debug_lab.prog.abap" },
    getText: () => "REPORT zvertex_debug_lab.\nDATA(result) = NEW zcl_calc( )->run( )." } };
  const tools = { schemas: [{ name: "read_sap_object", description: "Read SAP", inputSchema: {} }],
    instructions: "SAP system tools", editorContext: () => null };
  const ask = chat.create(vscode, tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  assert.equal((await ask("можешь прочитать этот код?")).answer, "It calls ZCL_CALC.");
  assert.match(request.prompt, /REPORT zvertex_debug_lab/);
  assert.match(request.prompt, /NEW zcl_calc/);
  assert.match(request.instructions, /No SAP system is configured/);
  assert.deepEqual(request.tools, []);
});

test("an active UML view is sent as diagram context and is analysed without requesting an object", async (t) => {
  let prompt = "", instructions = "";
  t.mock.method(assistant, "ask", async options => {
    prompt = options.prompt; instructions = options.instructions;
    return { plan: { answer: "The package has one implementation relationship." }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("UML видишь?", { state: { vertex_view: { type: "DEVC", name: "Z_AVE", view: "uml",
    object_count: 2, uml: { nodes: [{ name: "ZCL_A", kind: "class", methods: ["RUN"] },
      { name: "ZIF_B", kind: "interface", methods: [] }],
      edges: [{ source: "ZCL_A", target: "ZIF_B", kind: "implementation" }] } } } });
  assert.match(prompt, /function-specific context/);
  assert.match(prompt, /ZCL_A/);
  assert.match(prompt, /implementation/);
  assert.match(instructions, /supplied code or UML/);
  assert.match(instructions, /do not search the package again/);
});

test("the package Navigator gives the assistant its loaded objects and asks for a substantive answer", async t => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "The package calculates shipping prices.", navigation: null }, model: "haiku", usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", description: "Read SAP source", inputSchema: {} }],
    instructions: "SAP tools", editorContext: () => null };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("Что делается в пакете?", { state: { workspace: { name: "Z_RIG", type: "DEVC" },
    vertex_view: { view: "navigator", name: "Z_RIG", type: "DEVC", loaded_nodes: [
      { depth: 2, label: "ZCL_CALC_FACADE", name: "ZCL_CALC_FACADE", type: "CLAS" },
      { depth: 2, label: "ZVERTEX_DEBUG_LAB", name: "ZVERTEX_DEBUG_LAB", type: "PROG" } ] } } });
  assert.match(request.prompt, /ZCL_CALC_FACADE/);
  assert.match(request.prompt, /ZVERTEX_DEBUG_LAB/);
  assert.match(request.instructions, /read a small representative set of sources/);
  assert.match(request.instructions, /do not merely open the Navigator/);
  assert.deepEqual(request.tools, ["read_sap_object"]);
});

test("a question about the visible method keeps the tools and is told to answer from the screen", async (t) => {
  let available = [], told = "";
  t.mock.method(assistant, "ask", async options => {
    available = options.tools; told = options.instructions;
    return { plan: { answer: "It appends a diagnostic." }, model: "haiku", usage: null };
  });
  const tools = { instructions: "", editorContext: () => null, schemas: [
    { name: "search_sap_objects", description: "search", inputSchema: {} },
    { name: "read_sap_object", description: "read", inputSchema: {} },
    { name: "open_sap_object", description: "open", inputSchema: {} }
  ] };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("кратко: что делает метод?", { state: { selected_fragment: { kind: "visible_part",
    text: "METHOD add_cr_diag. APPEND iv_text TO mt_cr_diag. ENDMETHOD." } } });
  // A window on screen no longer takes the tools away; the model is told to
  // answer from what it shows and not to read the object again.
  assert.deepEqual(available, ["search_sap_objects", "read_sap_object", "open_sap_object"]);
  assert.match(told, /answer from it and do not read the object again/);
});

test("a bare object name is searched and opened without a model", async (t) => {
  const direct = require("../direct-search");
  assert.equal(direct.isObjectName("Z_CALC"), true);
  assert.equal(direct.isObjectName("ZCL_TR_*"), true);
  assert.equal(direct.isObjectName("show Z_CALC"), false);
  assert.deepEqual(direct.objectRequest("Open Z_CALC please"), { query: "Z_CALC", openEditor: true });
  assert.equal(direct.isObjectName("123"), false);
  assert.equal(direct.isObjectName("hello"), false);
  assert.equal(direct.isObjectName("ZREPORT"), true);
  assert.equal(direct.isObjectName("RSUSR003"), true);

  const calls = [];
  const asked = t.mock.method(assistant, "ask", async () => { throw new Error("no model expected"); });
  const tools = { schemas: [], instructions: "", editorContext: () => null,
    execute: async (tool, args) => {
      calls.push([tool, args]);
      if (tool === "open_sap_object") { return { opened: true }; }
      return { system: "QAS / DEV / 100", objects: args.query === "Z_CALC"
        ? [{ object_name: "Z_CALC", object_type: "PROG", package: "$TMP" }, { object_name: "Z_CALC2", object_type: "PROG", package: "$TMP" }]
        : [], truncated: false };
    } };
  const server = { start: async () => { throw new Error("no server expected"); } };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription" }), tools, server);

  const opened = await ask("z_calc");
  assert.equal(opened.direct, true);
  assert.match(opened.answer, /Opened PROG \*\*Z_CALC\*\*.*QAS/);
  assert.deepEqual(opened.choices, [
    { object_type: "PROG", object_name: "Z_CALC" },
    { object_type: "DEVC", object_name: "$TMP" }
  ]);
  assert.match(opened.answer, /package \*\*\$TMP\*\*/);
  assert.deepEqual(calls[1], ["open_sap_object", { object_type: "PROG", object_name: "Z_CALC" }]);
  const explicit = await ask("Open Z_CALC please", { state: { workspace: { type: "CLAS", name: "Z_OTHER" } } });
  assert.equal(explicit.direct, true);
  assert.deepEqual(calls[3], ["open_sap_object", { object_type: "PROG", object_name: "Z_CALC" }]);
  assert.match((await ask("ZNOTHING")).answer, /No program, class, function module or package named \*\*ZNOTHING\*\*/);
  assert.equal(asked.mock.callCount(), 0);
});

test("a name pattern with one result opens it without asking again", async () => {
  const direct = require("../direct-search");
  const opened = [], choices = [];
  const text = await direct.answer("ZVERTEX*LAB", {
    system: "A4H",
    search: async () => ({ objects: [{ object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB", package: "Z_RIG" }] }),
    open: async object => { opened.push(object); },
    choices: objects => { choices.push(...objects); }
  });
  assert.match(text, /Opened PROG \*\*ZVERTEX_DEBUG_LAB\*\*.*A4H/);
  assert.deepEqual(opened, [{ object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB" }]);
  assert.deepEqual(choices, [
    { object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB" },
    { object_type: "DEVC", object_name: "Z_RIG" }
  ]);
});

test("a plain name tries exact, prefix and contains patterns in order", async () => {
  const direct = require("../direct-search");
  const queries = [], opened = [];
  await direct.answer("Z_RIG", { search: async ({ query }) => {
    queries.push(query);
    return { objects: query === "*Z_RIG*" ? [{ object_type: "DEVC", object_name: "Z_MY_RIG" }] : [] };
  }, open: async object => { opened.push(object); } });
  assert.deepEqual(queries, ["Z_RIG", "Z_RIG*", "*Z_RIG*"]);
  assert.deepEqual(opened, [{ object_type: "DEVC", object_name: "Z_MY_RIG" }]);
  queries.length = 0;
  await direct.answer("Z_RIG*", { search: async ({ query }) => { queries.push(query); return { objects: [] }; }, open: async () => {} });
  assert.deepEqual(queries, ["Z_RIG*"]);
});

test("multiple search results are returned as openable choices", async () => {
  const direct = require("../direct-search");
  let choices = [];
  await direct.answer("ZTEST*", { search: async () => ({ objects: [
    { object_type: "PROG", object_name: "ZTEST_ONE" }, { object_type: "CLAS", object_name: "ZTEST_TWO" }
  ] }), open: async () => { throw new Error("must not open ambiguously"); }, choices: found => { choices = found; } });
  assert.deepEqual(choices.map(choice => choice.object_name), ["ZTEST_ONE", "ZTEST_TWO"]);
});

test("the chat is given Visual Debug's record and analysis, each said to be what it is, and nothing when the window has neither", () => {
  assert.equal(chat.debugFlowSection(null), "");
  assert.equal(chat.debugFlowSection({ recorded: null, analysis: null }), "", "a window with neither adds nothing to the question");
  const section = chat.debugFlowSection({ view: "Visual Debug", recorded: { steps: [{ depth: 0, at: "ZREP:10" }] }, analysis: { statements: [{ at: "ZREP:10" }] } });
  assert.match(section, /Visual Debug/);
  assert.match(section, /`recorded` is what the program actually did/);
  assert.match(section, /never present the second as the first/);
  assert.ok(section.includes('"steps":[{"depth":0,"at":"ZREP:10"}]'), "the context itself follows");
});

test("the open Value origin window reaches the question as the screen shows it, labelled as analysis", () => {
  assert.equal(chat.originFlowSection(null), "");
  assert.equal(chat.originFlowSection({ kind: "flow", flow: [] }), "");
  const flow = chat.originFlowSection({ value: "LS_X", kind: "flow", screen: { mode: "flow", view: "tree", depth: 2 }, flow: [{ depth: 1, text: "a = b.", in_slice: true }] });
  assert.match(flow, /flow, tree, depth 2/);
  assert.match(flow, /not a run/);
  assert.match(flow, /"in_slice":true/);
  const formula = chat.originFlowSection({ kind: "formula", screen: { mode: "formula", view: "tree", depth: "all" }, formula: [{ level: 1, text: "x = y * 2" }] });
  assert.match(formula, /formula, tree, depth all/);
  assert.match(formula, /x = y \* 2/);
});

test("the Expression screen reaches the question as the steps and where they come from", () => {
  const section = chat.originFlowSection({ kind: "expression", screen: { mode: "expression", view: "tree", depth: "all" },
    expression: { text: "A = A₁", steps: [{ name: "A₁", text: "x * 2" }], where: [{ name: "x", text: "SELECT x" }] } });
  assert.match(section, /expression, tree/);
  assert.match(section, /"steps":\[\{"name"/);
});
