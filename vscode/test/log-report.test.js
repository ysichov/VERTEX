"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const report = require("../log-report");

test("session report reads provider logs without treating tool results as prompts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-log-report-"));
  try {
    const folder = path.join(root, "claude_compatible");
    fs.mkdirSync(folder);
    const records = [
      { timestamp: "2026-10-12T10:00:00Z", type: "user", message: { role: "user", content: "Explain this class" } },
      { timestamp: "2026-10-12T10:00:01Z", type: "vertex_request", request: { instructions: "Use visible UML first", prompt: 'Current VERTEX view:\n{"name":"Z_RIG","nodes":["ZCL_TEST"]}', tools: [{ name: "read_sap_object" }], schema: { type: "object" } } },
      { timestamp: "2026-10-12T10:00:02Z", type: "assistant", message: { id: "m1", model: "mistral-test", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10 }, content: [{ type: "tool_use", name: "read_sap_object", input: { object_name: "ZCL_TEST" } }] } },
      { timestamp: "2026-10-12T10:00:03Z", type: "user", message: { role: "user", content: [{ type: "tool_result", content: '{"object_name":"ZCL_TEST","opened":true}' }] } },
      { timestamp: "2026-10-12T10:00:04Z", type: "assistant", message: { id: "m2", model: "mistral-test", usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 5 }, content: [{ type: "text", text: "It has one method." }] } },
      { timestamp: "2026-10-12T10:00:05Z", type: "assistant", message: { id: "m2", model: "mistral-test", usage: { input_tokens: 50, output_tokens: 30 }, content: [] } }
    ];
    fs.writeFileSync(path.join(folder, "mistral-api_20261012_100000.jsonl"), records.map(row => JSON.stringify(row)).join("\n") + "\n{unfinished", "utf8");
    const data = report.readSessions(root);
    assert.equal(data.sessions.length, 1);
    assert.equal(data.sessions[0].prompts.length, 1);
    assert.equal(data.sessions[0].provider, "mistral-api");
    assert.deepEqual(data.sessions[0].usage, { input: 150, output: 50, cacheRead: 10, cacheWrite: 5 });
    assert.equal(data.sessions[0].prompts[0].details.length, 7);
    assert.match(data.sessions[0].prompts[0].details[0].text, /visible UML/);
    assert.match(data.sessions[0].prompts[0].details[1].text, /\n  "nodes": \[/);
    assert.match(data.sessions[0].prompts[0].details[5].text, /\n  "opened": true/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("sidebar scroll button opens the theme-aware report from the configured log folder", async () => {
  const commands = new Map(), posted = [], executed = [], created = [], revealed = [];
  let receive;
  const panel = { webview: { postMessage: message => posted.push(message), onDidReceiveMessage: callback => { receive = callback; }, html: "" },
    onDidDispose() {}, reveal: (...args) => revealed.push(args) };
  const vscode = { ViewColumn: { Active: 1, Beside: 2 }, workspace: { getConfiguration: () => ({ get: () => "" }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; },
      executeCommand: async (...args) => { executed.push(args); } },
    window: { createWebviewPanel: (...args) => { created.push(args); return panel; } } };
  report.register(vscode, { subscriptions: [] });
  assert.match(fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8"), /data-action="logs"[^>]*>📜 AI<\/button>/);
  commands.get("vertex.showLogs")();
  assert.equal(created[0][2], vscode.ViewColumn.Beside);
  commands.get("vertex.showLogs")();
  assert.deepEqual(revealed[0], [vscode.ViewColumn.Beside, false]);
  await receive({ action: "ready" });
  await receive({ action: "settings" });
  assert.equal(posted[0].report.configured, false);
  assert.deepEqual(executed[0], ["workbench.action.openSettings", "vertex.ai.log"]);
  await receive({ action: "openRecording", recording: { kind: "transpiler", id: "run-1" } });
  await receive({ action: "openRecording", recording: { kind: "sap", id: "sap-1" } });
  await receive({ action: "openRecording", recording: { kind: "transpiler", id: "../unsafe" } });
  assert.deepEqual(executed.slice(1), [["vertex.openTranspilerRun", { run_id: "run-1", step: 1 }], ["vertex.openDebugSession", { session_id: "sap-1", step: 1 }]]);
  assert.match(panel.webview.html, /var\(--vscode-editor-background\)/);
  assert.doesNotMatch(panel.webview.html, /\{\{NONCE\}\}/);
  new vm.Script(panel.webview.html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1]);
});

test("clear selected conversations deletes only known logs and prevents pending writes from restoring them", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-clear-conversations-"));
  const logger = require("../session-log");
  try {
    const active = logger.current(root, "claude", {});
    active.user("one");
    const other = logger.create(root, "codex", "other", {});
    other.user("two");
    const recording = path.join(root, "run.vertex-debug.json");
    fs.writeFileSync(recording, "retained recording");
    const id = path.basename(active.file, ".jsonl");
    let confirm = false, requests = 0;
    const vscode = { workspace: { getConfiguration: () => ({ get: () => root }) },
      window: { showWarningMessage: async () => { requests++; return confirm ? "Clear selected conversations" : undefined; } } };
    assert.equal(await report.clearConversations(vscode, ["../outside"]), 0);
    assert.equal(requests, 0);
    assert.equal(await report.clearConversations(vscode, [id]), 0);
    assert.ok(fs.existsSync(active.file));
    confirm = true;
    assert.equal(await report.clearConversations(vscode, [id, id, "../outside"]), 1);
    active.assistant({ text: "late answer" });
    assert.equal(fs.existsSync(active.file), false);
    assert.ok(fs.existsSync(other.file));
    assert.ok(fs.existsSync(recording));
  } finally { logger.reset(); fs.rmSync(root, { recursive: true, force: true }); }
});
