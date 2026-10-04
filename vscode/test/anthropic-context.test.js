"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const chat = require("../chat"), anthropic = require("../anthropic"), workspace = require("../tools-window");

test("sidebar line-count question sends the published method in one bounded Anthropic request", async t => {
  let receive, state, raw;
  const panel = { webview: { onDidReceiveMessage: fn => { receive = fn; } }, onDidDispose() {} };
  const settings = { provider: "anthropic-api", model: "test-model" };
  const vscode = { ViewColumn: { Active: 1 }, extensions: { getExtension: () => null },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
      onDidChangeConfiguration: () => ({ dispose() {} }) },
    window: { createWebviewPanel: () => panel, tabGroups: { all: [] } } };
  workspace.open(vscode, { subscriptions: [] }, { pages: path.resolve(__dirname, "../../org.vertex.abap.ui/resources"),
    chat: () => null, active: () => ({ system: { name: "QAS" } }), setContext: value => { state = value; },
    debugger: { watch: () => () => {}, picture: () => ({}) } }, null);
  const method = ["METHOD add_cr_diag.", "CHECK mv_code_review = abap_true.", "CHECK iv_text IS NOT INITIAL.",
    "IF lines( mt_cr_diag ) < 300.", "APPEND iv_text TO mt_cr_diag.", "ENDIF.", "ENDMETHOD."];
  await receive({ call: "vertexContext", args: [{ vertex_view: { type: "CLAS", name: "ZCL_TEST", view: "metrics", part: "add_cr_diag" },
    selected_fragment: { kind: "visible_part", text: method.join("\n"), start_line: 1, end_line: 7 },
    workspace: { type: "CLAS", name: "ZCL_AVE_POPUP", action: "metrics" } }] });
  assert.equal(state.selected_fragment.text, method.join("\n"));
  assert.equal(state.workspace.action, "metrics");
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
  // The tools stay; the method on screen answers the question without a call.
  assert.deepEqual(bodies[0].tools.map(x => x.name), ["read_sap_object", "submit_vertex_answer"]);
  assert.ok(Buffer.byteLength(JSON.stringify(bodies[0])) < 10000);
  assert.doesNotMatch(JSON.stringify(bodies[0]), /UNRELATED_FULL_CLASS/);
  assert.match(bodies[0].messages[0].content, /APPEND iv_text/);
});

test("oversized Anthropic payload is rejected before any network request", async t => {
  const network = t.mock.method(https, "request", () => { throw new Error("Must not contact API"); });
  await assert.rejects(anthropic.ask({ apiKey: "fake", prompt: "x".repeat(70000), instructions: "", schema: {}, tools: [] }), /nothing was sent/);
  assert.equal(network.mock.callCount(), 0);
});
