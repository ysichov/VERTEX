"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../assistant");
const chat = require("../chat");
const copilot = require("../copilot");
const compatible = require("../openai-compatible");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

test.beforeEach(t => { t.mock.method(assistant, "resolveAssistant", async (vscode, id) => "/ext/" + id); });

function fakeVscode(settings) {
  return {
    ConfigurationTarget: { Global: 1 },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => (key in settings ? settings[key] : fallback),
      update: async (key, value) => { settings[key] = value; } }) },
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
  await ask("hello there");
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
  await ask("Explain this");
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

test("the chat reads the whole ABAP source another extension's editor holds, not a fragment of it", async (t) => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "It reads notifications.", navigation: null }, model: "haiku", usage: null };
  });
  const vscode = fakeVscode({ provider: "claude-subscription", model: "haiku", systems: [] });
  // ABAP remote filesystem: an adt:// document, opened from a system VERTEX does not have.
  const text = "REPORT zman_test_ccs.\nTYPES BEGIN OF type_data.\nDATA lt_data TYPE ttype_data.";
  vscode.window.activeTextEditor = { document: { languageId: "abap",
    uri: { scheme: "adt", path: "/Local Objects ($TMP)/zman_test_ccs.prog.abap", toString: () => "adt://icd_001/Local%20Objects/zman_test_ccs.prog.abap" },
    getText: () => text } };
  const ask = chat.create(vscode, { schemas: [], instructions: "", editorContext: () => null },
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  assert.equal((await ask("видишь ли ты весь код этой программы?")).answer, "It reads notifications.");
  assert.match(request.prompt, /DATA lt_data TYPE ttype_data/);
  assert.match(request.prompt, /adt:\/\/icd_001/);
  assert.match(request.instructions, /another extension \(adt\) opened it/);
  assert.match(request.instructions, /do not say only a fragment is visible/);
  // VERTEX's own SAP tab comes through editorContext, not as another editor's document.
  vscode.window.activeTextEditor = { document: { languageId: "abap", uri: { scheme: "vertex-sap", path: "/zx.prog.abap" }, getText: () => "REPORT zx." } };
  assert.equal(chat.localAbapContext(vscode), null);
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

test("same-name program and package remain separate direct-search choices", async () => {
  const direct = require("../direct-search");
  let choices = [];
  const answer = await direct.answer("Z_AVE", { search: async () => ({ objects: [
    { object_type: "PROG", object_name: "Z_AVE" }, { object_type: "DEVC", object_name: "Z_AVE" }
  ] }), open: async () => { throw new Error("ambiguous name must not open automatically"); }, choices: found => { choices = found; } });
  assert.match(answer, /PROG \*\*Z_AVE\*\*/);
  assert.match(answer, /DEVC \*\*Z_AVE\*\*/);
  assert.deepEqual(choices.map(choice => choice.object_type), ["PROG", "DEVC"]);
});

test("the chat is given VERTEX Smart Debugger's record and analysis, each said to be what it is, and nothing when the window has neither", () => {
  assert.equal(chat.debugFlowSection(null), "");
  assert.equal(chat.debugFlowSection({ recorded: null, analysis: null }), "", "a window with neither adds nothing to the question");
  const section = chat.debugFlowSection({ view: "VERTEX Smart Debugger", recorded: { steps: [{ depth: 0, at: "ZREP:10" }] }, analysis: { statements: [{ at: "ZREP:10" }] } });
  assert.match(section, /VERTEX Smart Debugger/);
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

test("an explicit review-block question is not widened by the visible object's full diff", async t => {
  let prompt = "";
  t.mock.method(assistant, "ask", async options => { prompt = options.prompt; return { plan: { answer: "Block one" } }; });
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }),
    { schemas: [], instructions: "", editorContext: () => null },
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("Explain selected block 1: ONLY_BLOCK_ONE", { state: {
    review_ask: { object: "RUN", all: false, blocks: [1] },
    vertex_view: { view: "review_object", name: "K1", review_object: "RUN" },
    review_source: { object: "RUN", text: "OTHER_BLOCKS_FULL_DIFF" },
    selected_fragment: { text: "UNRELATED_SELECTION" }
  } });
  assert.match(prompt, /ONLY_BLOCK_ONE/);
  assert.doesNotMatch(prompt, /OTHER_BLOCKS_FULL_DIFF|UNRELATED_SELECTION/);
});

test("ChatGPT subscription forwards screenshots to Codex", async t => {
  const images = [{ media_type: "image/png", data: "iVBORw0KGgo=" }];
  let received;
  t.mock.method(assistant, "ask", async options => { received = options; return { plan: { answer: "Screenshot received" }, model: "codex" }; });
  const ask = chat.create(fakeVscode({ provider: "codex-subscription" }),
    { schemas: [], instructions: "", editorContext: () => null },
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  assert.equal((await ask("Explain this screenshot", { images })).answer, "Screenshot received");
  assert.equal(received.assistant, "codex");
  assert.deepEqual(received.images, images);
});


test("a visible Git review snapshot reaches ordinary chat; explicit blocks keep priority", async t => {
 const gitHistory=require('../git-history');
 t.mock.method(gitHistory,'reviewContext',()=>({title:'Uncommitted changes',folder:'project',truncated:false,text:'VISIBLE_GIT_DIFF before old after new'}));
 const calls=[];
 t.mock.method(assistant,'ask',async options=>{calls.push(options);return {plan:{answer:'Summary'}};});
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'haiku'}),
  {schemas:[],instructions:'',editorContext:()=>null},
  {start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 await ask('Сформируй краткое описание для коммита');
 assert.match(calls[0].prompt,/VISIBLE_GIT_DIFF/);
 assert.match(calls[0].prompt,/Do not run Git, Grep, Glob, Read or shell commands/);
 await ask('Explain ONLY_SELECTED_BLOCK',{state:{review_ask:{object:'RUN',all:false,blocks:[1]}}});
 assert.doesNotMatch(calls[1].prompt,/VISIBLE_GIT_DIFF/);
 t.mock.method(gitHistory,'reviewContext',()=>null);
 await ask('Another question');
 assert.doesNotMatch(calls[2].prompt,/VISIBLE_GIT_DIFF/);
});


test('Vercel chat rejects screenshots before inference for a declared text-only model',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'text',label:'Text',capabilities:{vision:false,tools:true}}]);
 let calls=0;t.mock.method(compatible,'ask',async()=>{calls++;});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'text'}),{schemas:[],instructions:'',editorContext:()=>null},{},{get:async()=>null});
 await assert.rejects(()=>ask('Explain screenshot',{images:[{media_type:'image/png',data:'abcd'}]}),/no Vision/);
 assert.equal(calls,0);
});

test('Vercel Vision chat forwards images and removes tools when the model cannot call them',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'vision',label:'Vision',capabilities:{vision:true,tools:false}}]);
 let received;t.mock.method(compatible,'ask',async options=>{received=options;return {plan:{answer:'Image described'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'vision'}),{schemas:[{name:'read_sap_object'}],instructions:'',editorContext:()=>null},{},{get:async()=>null});
 const images=[{media_type:'image/png',data:'abcd'}];
 assert.equal((await ask('Explain screenshot',{images})).answer,'Image described');
 assert.deepEqual(received.images,images);assert.deepEqual(received.tools,[]);
 assert.match(received.instructions,/cannot call tools/);
});

test('commit message generation is isolated and supplies no action tools',async t=>{
 let options;t.mock.method(compatible,'ask',async value=>{options=value;return {model:'text',plan:{answer:'Improve Git review\n\nAdd a draft commit form.'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'text'}),{schemas:[{name:'read_sap_object'}],instructions:'',editorContext:()=>{throw Error('No editor access needed');}},{start:()=>{throw Error('No MCP needed');}},{get:async()=>null});
 const result=await ask.generateCommitMessage({text:'SUPPLIED_DIFF'},{summary:'Draft'});
 assert.equal(result.summary,'Improve Git review');assert.deepEqual(options.tools,[]);assert.equal(options.textOnly,true);assert.equal(options.capabilities.tools,false);assert.equal(options.maxOutputTokens,4096);assert.match(options.instructions,/plain text only/);assert.doesNotMatch(options.instructions,/Put the entire commit message in the answer field/);assert.match(options.prompt,/SUPPLIED_DIFF/);assert.equal(options.workDir,undefined);assert.equal(options.callTool,undefined);
});

test('Web mode bypasses local editor, worktree and SAP context',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'web',label:'Web',capabilities:{tools:true}}]);let received;
 t.mock.method(compatible,'ask',async options=>{received=options;return {model:'web',plan:{answer:'Answer with source'}};});
 const vscode=fakeVscode({provider:'vercel-api',model:'web'});
 const ask=chat.create(vscode,{editorContext(){throw Error('No editor context');},schemas:[{name:'read_sap_object'}]},{start(){throw Error('No MCP');}},{get:async()=>null});
 const answer=await ask('ABAP benchmarks',{web:true,state:{git_review:{text:'PRIVATE_DIFF'},selected_fragment:{text:'PRIVATE_SOURCE'}}});
 assert.equal(answer.navigation,null);assert.equal(received.webSearch,true);assert.deepEqual(received.tools,[]);assert.equal(received.webQuery,'ABAP benchmarks');assert.doesNotMatch(received.prompt,/PRIVATE_DIFF|PRIVATE_SOURCE/);
});

test('commit header metadata reports actual model and cost separately for repeated generations',async t=>{
 let attempt=0;t.mock.method(compatible,'ask',async options=>{const model=++attempt===1?'inclusionai/ling-3.0-flash':'nvidia/free',usage={input_tokens:attempt===1?40964:42055,output_tokens:attempt===1?461:177,cost_usd:attempt===1?0.00088929:0};options.onModelCall({model,usage,text:'Update commit dialog'});return {model,usage,plan:{answer:'Update commit dialog\n\nShow generation cost.'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'configured-model'}),{schemas:[],instructions:''},{},{get:async()=>null});
 const first=await ask.generateCommitMessage({text:'diff'},{}),second=await ask.generateCommitMessage({text:'diff'},{});
 assert.match(first.description,/Generated by: inclusionai\/ling-3\.0-flash$/);assert.match(second.description,/Generated by: nvidia\/free$/);assert.doesNotMatch(second.description,/configured-model|ling-3/);assert.equal(first.generation.model,'inclusionai/ling-3.0-flash');assert.equal(first.generation.cost_usd,0.00088929);assert.equal(first.generation.usage.output_tokens,461);assert.equal(second.generation.model,'nvidia/free');assert.equal(second.generation.cost_usd,0);assert.equal(second.generation.usage.input_tokens,42055);
});
test('failed commit generation retains reported charge metadata',async t=>{
 t.mock.method(compatible,'ask',async options=>{options.onModelCall({model:'failed-model',usage:{input_tokens:10,output_tokens:3,cost_usd:0.001},text:'[empty]'});throw new Error('No final text');});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'configured'}),{schemas:[],instructions:''},{},{get:async()=>null});await assert.rejects(()=>ask.generateCommitMessage({text:'diff'},{}),error=>error.generation.model==='failed-model'&&error.generation.cost_usd===0.001);
});

test('natural-language Web request bypasses local and SAP context without a checkbox',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'web',label:'Web',capabilities:{tools:true}}]);let received;
 t.mock.method(compatible,'ask',async options=>{received=options;return {model:'web',plan:{answer:'Found'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'web'}),{editorContext(){throw Error('No SAP context');},schemas:[]},{},{get:async()=>null});
 await ask('Найди в интернете ABAP benchmarks',{state:{git_review:{text:'PRIVATE_DIFF'}}});assert.equal(received.webSearch,true);assert.doesNotMatch(received.prompt,/PRIVATE_DIFF/);
});
test('explicit SAP and Folder modes select context, and text-only models can read supplied source',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'text',label:'Text',capabilities:{tools:false}}]);let received;
 t.mock.method(compatible,'ask',async options=>{received=options;return {model:'text',plan:{answer:'Shown'}};});
 const vscode=fakeVscode({provider:'vercel-api',model:'text'}),tools={schemas:[{name:'read_sap_object'},{name:'run_abap_transpiler'}],instructions:'SAP_RULES',editorContext:()=>({source:'REPORT VISIBLE_SAP_SOURCE.',object_name:'Z_REPORT',object_type:'PROG'})};
 const sap=chat.create(vscode,tools,{},{get:async()=>null},()=>({analysis:{methods:['VISIBLE_METHOD']}}));
 await sap('видишь Z_REPORT?',{contextMode:'sap',state:{git_review:{text:'PRIVATE_DIFF'}}});assert.match(received.prompt,/VISIBLE_SAP_SOURCE|VISIBLE_METHOD/);assert.doesNotMatch(received.prompt,/PRIVATE_DIFF/);assert.match(received.instructions,/supplied source, review and debugger context are available/);
 const folder=chat.create(vscode,tools,{},{get:async()=>null},()=>{throw Error('No SAP debugger in Folder mode');});
 await folder('список файлов',{contextMode:'folder',state:{vertex_view:{secret:'PRIVATE_SAP_VIEW'}}});assert.doesNotMatch(received.prompt,/PRIVATE_SAP_VIEW|VISIBLE_SAP_SOURCE/);assert.deepEqual(received.tools.map(x=>x.name),[]);
});

test('changing model or provider cancels a pending rate-limit retry without losing history', async t => {
  t.mock.method(require('../model-config'), 'isOn', () => true);
  for (const change of ['model','provider']) {
    const settings={provider:'claude-subscription',model:'old'};
    const vscode=fakeVscode(settings);
    vscode.ConfigurationTarget={Global:1};
    vscode.workspace.getConfiguration=()=>({get:(key,fallback)=>settings[key]??fallback,update:async(key,value)=>{settings[key]=value;}});
    let waiting, calls=0; const ready=new Promise(resolve=>{waiting=resolve;}); const prompts=[];
    t.mock.method(assistant,'ask',async options=>{
      prompts.push(options.prompt);
      if(options.prompt.endsWith('blocked question')) return compatible.rateLimitedRequest(async()=>{
        calls++;throw Object.assign(new Error('rate limited'),{status:429,retryAfter:'60'});
      },{...options,onRetryWait:cancel=>{options.onRetryWait(cancel);if(cancel)waiting();}});
      return {plan:{answer:'kept answer'},model:'test',usage:null};
    });
    const ask=chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
    await ask('first question');
    const old=ask('blocked question');await ready;
    if(change==='model')await ask.setModel('new');else await ask.setProvider('codex-subscription');
    assert.equal((await old).superseded,true);
    const next=await ask('next question',{model:'new'});
    assert.equal(next.answer,'kept answer');assert.equal(calls,1);
    assert.match(prompts.at(-1),/first question/);assert.match(prompts.at(-1),/kept answer/);
    assert.doesNotMatch(prompts.at(-1),/blocked question/);
    ask.dispose();
  }
});

test('OpenRouter shows remaining daily requests when a request is rate limited', async t => {
  t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
  t.mock.method(compatible,'models',async()=>[{id:'test',label:'Test'}]);
  let checks=0;
  t.mock.method(compatible,'keyLimits',async()=>{checks++;return {free:{used:50,limit:50,remaining:0},usage_daily:0,limit_remaining:null};});
  t.mock.method(compatible,'ask',async options=>compatible.rateLimitedRequest(async()=>{throw Object.assign(new Error('Daily rate limit'),{status:429,retryAfter:'120'});},options));
  const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},null,{});
  const progress=[];
  await assert.rejects(ask('explain this',{onProgress:update=>progress.push(update)}),/Daily rate limit/);
  assert.ok(checks>0);assert.ok(progress.some(update=>/free today 0 of 50 left/.test(update.limits||'')));
  t.mock.method(compatible,'ask',async options=>{
    assert.doesNotMatch(options.prompt,/Daily rate limit|Request failed:/);
    return {plan:{answer:'new answer'},model:'test',usage:null};
  });
  assert.equal((await ask('next question')).answer,'new answer');
  ask.dispose();
});

test("a wrong navigation keeps the answer and names the error", () => {
  const { navigationOf } = require("../chat");
  assert.deepEqual(navigationOf({ type: "FUNC", name: "Z_F", action: "review", part: null }),
    { navigation: null, navigationError: "Review is unavailable for Function module" });
  assert.equal(navigationOf({ type: "FUNC", name: "Z_F", action: "metrics", part: null }).navigation.action, "metrics");
  assert.deepEqual(navigationOf(null), { navigation: null });
});
