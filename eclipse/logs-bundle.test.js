"use strict";
// Session Logs in the Eclipse plugin: VS Code's log reading as one browser script (logs-bundle.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { bundle } = require("./logs-bundle");

const root = path.join(__dirname, "..");

test("the plugin carries the Session Logs bundle prepare.js makes from the current sources", () => {
  assert.equal(fs.readFileSync(path.join(root, "org.vertex.abap.ui", "assistant", "logs.js"), "utf8"), bundle(root),
    "run node eclipse/prepare.js");
});

test("Session Logs read a log and draw its snapshot in a browser context, the nonce from the browser's random source", () => {
  // As the plugin's browser runs it: a window with crypto, and no require, module or process.
  let asked = 0;
  const window = { crypto: { getRandomValues: bytes => { asked += bytes.length; return bytes.fill(171); } } };
  vm.runInNewContext(bundle(root), { window });
  const logs = window.vertexLogs;
  const text = [{ type: "user", message: { content: "Question" } }, { type: "assistant", message: { id: "one", usage: { input_tokens: 2 }, content: [] } }]
    .map(record => JSON.stringify({ timestamp: "2026-11-01T15:04:45Z", ...record })).join("\n");
  const session = logs.parseSession(text, "C:\\logs\\claude_20261101_170445.jsonl");
  assert.equal(session.id, "claude_20261101_170445");
  assert.equal(session.usage.input, 2);
  const html = logs.snapshotHtml({ kind: "metrics", name: "ZCL_A", data: { columns: ["unit_name"], units: [{ unit_name: "RUN" }] } }, "mermaid.js", "blob:");
  assert.match(html, /nonce="(ab)+"/);
  assert.ok(asked > 0);
  assert.equal(logs.objectReference({ review_object: "ZCL_A=====CM001", review_type: "METH" }).object_type, "CLAS");
});
