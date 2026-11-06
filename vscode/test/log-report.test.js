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

test("the panel's scroll title action opens the theme-aware report from the configured log folder", async () => {
  const commands = new Map(), posted = [], executed = [], created = [], revealed = [];
  let receive;
  const panel = { webview: { postMessage: message => posted.push(message), onDidReceiveMessage: callback => { receive = callback; }, html: "" },
    onDidDispose() {}, reveal: (...args) => revealed.push(args) };
  const vscode = { ViewColumn: { Active: 1, Beside: 2 }, workspace: { getConfiguration: () => ({ get: () => "" }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; },
      executeCommand: async (...args) => { executed.push(args); } },
    window: { createWebviewPanel: (...args) => { created.push(args); return panel; } } };
  report.register(vscode, { subscriptions: [] });
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.ok(manifest.contributes.menus["view/title"].some(item => item.command === "vertex.showLogs" && item.when === "view == vertex.launcher"));
  assert.match(JSON.stringify(manifest.contributes.commands.find(c => c.command === "vertex.showLogs").icon), /scroll-light\.svg/);
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


test("Claude Code's steps reach the report page with their arguments, to be drawn as what they did", () => {
  const records = [
    { type: "user", message: { content: "Change the greeting" } },
    { type: "assistant", vertex_step: "claude", message: { id: "toolu_1", content: [{ type: "tool_use", id: "toolu_1", name: "Edit",
      input: { file_path: "C:\\p\\a.js", old_lines: 1, new_lines: 1, old_string: "old", new_string: "new" } }] } },
    { type: "assistant", message: { id: "plain", content: [{ type: "tool_use", id: "t2", name: "read_sap_object", input: { object_name: "ZX" } }] } }
  ];
  const session = report.parseSession(records.map(record => JSON.stringify({ timestamp: "2026-11-06T10:00:00Z", ...record })).join("\n"), "claude_20261106_120000.jsonl");
  const [edit, sap] = session.prompts[0].details.filter(d => d.type === "tool");
  assert.equal(edit.step, "claude");
  assert.equal(edit.input.old_string, "old");
  assert.equal(sap.step, undefined, "a SAP tool keeps the plain view");
  // The page's source: vscode/resources/log-report.html is a copy made at packaging, not kept in git.
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  assert.match(page, /function drawStep/);
  assert.match(page, /--vscode-diffEditor-insertedLineBackground/);
  assert.doesNotMatch(page, /charts-orange/, "technical entries in a quiet colour");
  assert.doesNotMatch(page, /border-left/, "no side bars on log entries");
});

test("a run reads as one timeline: a model call per message, then the tools it called, in order", () => {
  const records = [
    { type: "user", message: { content: "Rules?" } },
    { type: "vertex_provider_response", provider: "claude", scope: "model_response", response: { id: "m1", usage: { input_tokens: 1 } } },
    { type: "vertex_provider_response", provider: "claude", scope: "model_response", response: { id: "m1", usage: { input_tokens: 1, output_tokens: 9 } } },
    { type: "assistant", vertex_step: "claude", message: { id: "t1", content: [{ type: "tool_use", id: "t1", name: "Glob", input: { pattern: "*.md" } }] } },
    { type: "vertex_provider_response", provider: "claude", scope: "model_response", response: { id: "m2", usage: { input_tokens: 2 } } },
    { type: "assistant", vertex_step: "claude", message: { id: "t2", content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "a.md" } }] } },
    { type: "vertex_provider_response", provider: "claude", scope: "cli_run", response: { usage: { input_tokens: 3 } } }
  ];
  const session = report.parseSession(records.map(record => JSON.stringify({ timestamp: "2026-11-06T10:00:00Z", ...record })).join("\n"), "claude_20261106_120001.jsonl");
  const prompt = session.prompts[0];
  assert.deepEqual(prompt.timeline.map(t => t.kind + ":" + (t.id || t.tool_id)), ["model:m1", "tool:t1", "model:m2", "tool:t2"]);
  assert.equal(prompt.timeline[0].usage.output_tokens, 9, "one message's events are one step, its last usage kept");
  assert.deepEqual(prompt.details.filter(d => /^Provider usage/.test(d.type)).map(d => d.type), ["Provider usage (cli_run)"]);
});

test("provider evidence is visible without doubling session usage", () => {
  const records = [
    { type: "user", message: { content: "Question" } },
    { type: "vertex_provider_response", provider: "claude", scope: "cli_run", response: { usage: { input_tokens: 2 } } },
    { type: "assistant", message: { id: "one", usage: { input_tokens: 2 }, content: [] } }
  ];
  const session = report.parseSession(records.map(record => JSON.stringify({ timestamp: "2026-11-01T15:04:45Z", ...record })).join("\n"), "claude_20261101_170445.jsonl");
  assert.equal(session.usage.input, 2);
  assert.equal(session.prompts[0].details[0].type, "Provider usage (cli_run)");
  assert.match(session.prompts[0].details[0].text, /input_tokens/);
});
