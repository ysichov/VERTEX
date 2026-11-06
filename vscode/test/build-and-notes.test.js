"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const buildRunner = require("../build-runner");
const sessionLog = require("../session-log");
const report = require("../log-report");

function fakeVscode(updates) {
  const lines = [];
  return { lines, window: { createOutputChannel: () => ({ show() {}, append: t => lines.push(t), appendLine: t => lines.push(t + "\n") }) },
    Uri: { file: p => ({ fsPath: p }) },
    ConfigurationTarget: { Workspace: 2, WorkspaceFolder: 3 },
    workspace: { getWorkspaceFolder: () => ({}), getConfiguration: () => ({
      get: (key, fallback) => key === "buildCommand" ? (updates.saved || fallback) : fallback,
      update: async (key, value, target) => { updates.saved = value; updates.target = target; } }) } };
}

test("the build runs in the folder, its output shown and its tail kept, with the exit code", async () => {
  const calls = [];
  const spawnFn = (command, args, options) => {
    calls.push({ command, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    setImmediate(() => { child.stdout.emit("data", "compiling\n"); child.stderr.emit("data", "error: x\n"); child.emit("close", 2); });
    return child;
  };
  const vscode = fakeVscode({});
  const result = await buildRunner.run(vscode, "C:/p", "npm test", spawnFn);
  assert.equal(calls[0].command, "npm test");
  assert.equal(calls[0].options.cwd, "C:/p");
  assert.equal(result.code, 2);
  assert.equal(result.tail, "compiling\nerror: x");
});

test("a command is remembered in the folder's own settings and read back", async () => {
  const updates = {};
  const vscode = fakeVscode(updates);
  assert.equal(buildRunner.remembered(vscode, "C:/p"), "");
  await buildRunner.remember(vscode, "C:/p", "mvn -q package");
  assert.equal(updates.target, 3, "the workspace folder's settings");
  assert.equal(buildRunner.remembered(vscode, "C:/p"), "mvn -q package");
});

test("what Claude says and thinks between steps is logged with the answers option and drawn in the timeline", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-notes-"));
  const log = sessionLog.create(root, "claude", "notes", { questions: true, answers: true, tools: true });
  log.user("Change the page");
  log.step({ kind: "note", id: "m1:0", note: "thinking", text: "Found the markup; checking logs.js next." });
  log.step({ kind: "use", id: "t1", name: "Read", input: { file_path: "C:/p/a.html" } });
  const session = report.parseSession(fs.readFileSync(log.file, "utf8"), path.basename(log.file));
  const timeline = session.prompts[0].timeline;
  assert.deepEqual(timeline.map(t => t.kind), ["note", "tool"]);
  assert.equal(timeline[0].note, "thinking");
  assert.match(timeline[0].text, /checking logs\.js/);
  const quiet = sessionLog.create(root, "claude", "quiet", { tools: true });
  quiet.step({ kind: "note", id: "m1:0", note: "text", text: "secret thought" });
  assert.equal(fs.existsSync(quiet.file), false, "nothing without the answers option");
});

test("the review offers the proposed build once something was applied, and runs it on Run", async () => {
  const reviewer = require("../worktree-review");
  const page = { posted: [], send: null };
  const vscode = { window: { createWebviewPanel: () => ({ webview: { set html(v) { page.html = v; }, onDidReceiveMessage: fn => { page.send = fn; },
    postMessage: async m => { page.posted.push(m); } }, onDidDispose() {} }), showErrorMessage() {} }, ViewColumn: { Beside: 2 }, commands: { executeCommand: async () => {} } };
  const copy = { apply: async () => {}, keep: async () => {}, revert: async () => {} };
  const change = { file: "a.js", path: "C:/p/a.js", status: "changed", before: "a\n", after: "b\n", conflict: false };
  const ran = [];
  reviewer.open(vscode, copy, [change], () => {}, { build: { command: "npm test" }, onBuild: async (command, remember) => { ran.push([command, remember]); return { code: 0 }; } });
  assert.match(page.html, /id="build-bar"/);
  await page.send({ action: "apply", approved: ["f1"], declined: [] });
  assert.deepEqual(page.posted.find(m => m.action === "offerBuild"), { action: "offerBuild", command: "npm test" });
  await page.send({ action: "build", remember: true });
  assert.deepEqual(ran, [["npm test", true]]);
  assert.equal(page.posted.pop().message, "Build passed.");
});
