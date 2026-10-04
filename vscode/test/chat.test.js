"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../assistant");
const chat = require("../chat");

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
  await ask("explain this method");
  assert.doesNotMatch(prompt, /SECRET_FULL_SOURCE/);
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
  assert.deepEqual(calls[1], ["open_sap_object", { object_type: "PROG", object_name: "Z_CALC" }]);
  const explicit = await ask("Open Z_CALC please", { state: { workspace: { type: "CLAS", name: "Z_OTHER" } } });
  assert.equal(explicit.direct, true);
  assert.deepEqual(calls[3], ["open_sap_object", { object_type: "PROG", object_name: "Z_CALC" }]);
  assert.match((await ask("ZNOTHING")).answer, /No program, class or function module named \*\*ZNOTHING\*\*/);
  assert.equal(asked.mock.callCount(), 0);
});

test("a name pattern with one result opens it without asking again", async () => {
  const direct = require("../direct-search");
  const opened = [];
  const text = await direct.answer("ZVERTEX*LAB", {
    system: "ALC",
    search: async () => ({ objects: [{ object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB", package: "Z_RIG" }] }),
    open: async object => { opened.push(object); }
  });
  assert.match(text, /Opened PROG \*\*ZVERTEX_DEBUG_LAB\*\*.*ALC/);
  assert.deepEqual(opened, [{ object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB" }]);
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
