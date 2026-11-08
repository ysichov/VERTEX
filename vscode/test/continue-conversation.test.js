"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test("a conversation that changed provider is continued from all its files, in order", async () => {
  const sessionLog = require("../session-log"), report = require("../log-report");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vx-continue-"));
  const include = { questions: true, answers: true };
  sessionLog.reset();
  const claude = sessionLog.current(root, "claude", include);
  claude.user("first question");
  claude.assistant({ model: "opus", text: "first answer" });
  await pause(15);
  const codex = sessionLog.current(root, "codex", include);
  codex.user("second question");
  codex.assistant({ model: "gpt", text: "second answer" });
  await pause(15);
  claude.user("third question");
  claude.assistant({ model: "opus", text: "third answer" });
  const commit = sessionLog.create(root, "claude", "commit_1", include, "Commit message");
  commit.user("Generate a commit message for the reviewed changes");
  commit.assistant({ model: "opus", text: "Fix things" });
  // Another conversation, which must stay out; log file names change by the second.
  await pause(1100);
  sessionLog.reset();
  sessionLog.current(root, "claude", include).user("other conversation");

  const read = report.readSessions(root);
  const codexSession = read.sessions.find(s => s.provider === "codex");
  const found = report.conversationTurns(read, codexSession.id);
  assert.equal(found.files, 3, "both providers' chat files and the commit file share the id");
  assert.deepEqual(found.turns.map(t => [t.question, t.answer, t.provider]), [
    ["first question", "first answer", "claude"],
    ["second question", "second answer", "codex"],
    ["third question", "third answer", "claude"]]);

  const continued = found.conversation;
  sessionLog.reset(continued);
  sessionLog.current(root, "claude", include).user("fourth question");
  const again = report.readSessions(root);
  assert.equal(report.conversationTurns(again, codexSession.id).turns.length, 4, "the question asked after continuing joins the same conversation");
  assert.ok(again.sessions.filter(s => s.conversation === continued).length >= 4, "the continued conversation keeps logging under its id");
});

test("a conversation logged without answers or questions says so instead of continuing", () => {
  const sessionLog = require("../session-log"), report = require("../log-report");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vx-continue-"));
  sessionLog.reset();
  const log = sessionLog.current(root, "claude", { questions: true, answers: false });
  log.user("asked");
  log.assistant({ model: "opus", text: "not kept" });
  const read = report.readSessions(root);
  assert.throws(() => report.conversationTurns(read, read.sessions[0].id), /without its answers.*vertex\.ai\.log\.answers/);

  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "vx-continue-"));
  sessionLog.reset();
  const quiet = sessionLog.current(root2, "claude", { questions: false, answers: true });
  quiet.user("hidden");
  quiet.assistant({ model: "opus", text: "kept" });
  const read2 = report.readSessions(root2);
  assert.throws(() => report.conversationTurns(read2, read2.sessions[0].id), /without its questions.*vertex\.ai\.log\.questions/);
  assert.throws(() => report.conversationTurns(read2, "gone"), /no longer in the log folder/);
});

test("the chat takes the turns as its history", () => {
  const settings = {};
  const vscode = { ConfigurationTarget: { Global: 1 }, window: {},
    workspace: { workspaceFolders: [], onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: section => ({ get: (key, fallback) => settings[section + "." + key] ?? fallback, update: async () => {}, inspect: () => ({}) }) } };
  const ask = require("../chat").create(vscode, { schemas: [], execute: async () => "" }, null, {}, null, null, null);
  assert.equal(ask.restoreConversation([{ question: "q1", answer: "a1" }, { question: " ", answer: "dropped" }, { question: "q2", answer: "" }]), 2);
});
