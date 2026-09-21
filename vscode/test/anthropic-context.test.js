"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const chat = require("../chat"), anthropic = require("../anthropic"), workspace = require("../tools-window");

test("sidebar line-count question sends the published method in one bounded Anthropic request", async t => {
  let receive, state, raw;
  const panel = { webview: { onDidReceiveMessage: fn => { receive = fn; } } };
  const settings = { provider: "anthropic-api", model: "test-model" };
  const vscode = { ViewColumn: { Active: 1 }, extensions: { getExtension: () => null },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
    window: { createWebviewPanel: () => panel, tabGroups: { all: [] } } };
  workspace.open(vscode, { subscriptions: [] }, { pages: path.resolve(__dirname, "../../org.vertex.abap.ui/resources"),
    chat: () => null, setContext: value => { state = value; } }, null);
  const elements = { title: {}, code: { addEventListener() {} } };
  const page = vm.createContext({ document: { getElementById: id => elements[id], addEventListener() {} },
    window: {}, sdeSource() {}, sdeTake: () => raw,
    sdeContextUpdate: value => receive({ call: "vertexContext", args: [{ ...value,
      workspace: { type: "CLAS", name: "ZCL_AVЕ_POPUP", action: "view" } }] }) });
  const html = fs.readFileSync(path.resolve(__dirname, "../../org.vertex.abap.ui/resources/source.html"), "utf8");
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace("/*INIT*/null/*INIT*/", JSON.stringify({ type: "CLAS", name: "ZCL_TEST" })), page);
  const method = ["METHOD add_cr_diag.", "CHECK mv_code_review = abap_true.", "CHECK iv_text IS NOT INITIAL.",
    "IF lines( mt_cr_diag ) < 300.", "APPEND iv_text TO mt_cr_diag.", "ENDIF.", "ENDMETHOD."];
  page.allLines = method.concat(["UNRELATED_FULL_CLASS".repeat(20000)]);
  page.selectedPart = { name: "add_cr_diag" }; page.shownRange = { start: 1, end: 7 };
  page.publishContext();
  assert.equal(state.selected_fragment.text, method.join("\n"));
  assert.equal(state.workspace.action, "view");
  const bodies = [];
  t.mock.method(https, "request", (_options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.end = payload => {
      bodies.push(JSON.parse(payload));
      const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {};
      callback(res);
      res.emit("data", JSON.stringify({ content: [{ type: "text", text: "7 строк." }],
        usage: { input_tokens: 600, output_tokens: 8 } })); res.emit("end");
    }; return req;
  });
  const tools = { schemas: [{ name: "read_sap_object", inputSchema: {} }], instructions: "",
    editorContext: () => ({ source: "UNRELATED_FULL_CLASS".repeat(20000) }),
    execute: () => { throw new Error("Unexpected SAP call"); } };
  const ask = chat.create(vscode, tools, { start: () => { throw new Error("Unexpected MCP start"); } },
    { get: async () => "fake-key" });
  const result = await ask("сколько строк в методе?", { state });
  assert.equal(result.answer, "7 строк."); assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].tools.map(x => x.name), ["submit_vertex_answer"]);
  assert.ok(Buffer.byteLength(JSON.stringify(bodies[0])) < 10000);
  assert.doesNotMatch(JSON.stringify(bodies[0]), /UNRELATED_FULL_CLASS/);
  assert.match(bodies[0].messages[0].content, /APPEND iv_text/);
});

test("oversized Anthropic payload is rejected before any network request", async t => {
  const network = t.mock.method(https, "request", () => { throw new Error("Must not contact API"); });
  await assert.rejects(anthropic.ask({ apiKey: "fake", prompt: "x".repeat(70000), instructions: "", schema: {}, tools: [] }), /nothing was sent/);
  assert.equal(network.mock.callCount(), 0);
});
