"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sessionLog = require("../session-log");
const logReport = require("../log-report");

function written(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-context-"));
  const log = sessionLog.create(root, "claude", "20261113_120000_aa11bb", { questions: true, answers: true });
  log.setContext(context);
  log.user("where does this run");
  log.assistant({ model: "claude-test", usage: { input_tokens: 1, output_tokens: 1 }, text: "here" });
  const file = log.file;
  return { root, file, lines: fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse) };
}

test("a folder conversation stamps every entry with the folder it was held in", () => {
  const { lines } = written({ mode: "folder", folder: "C:\\soft\\GitHub\\AVE" });
  assert.equal(lines.length, 2);
  for (const line of lines) assert.deepEqual(line.vertex_context, { mode: "folder", folder: "C:\\soft\\GitHub\\AVE" });
});

test("a SAP conversation stamps the system and its client", () => {
  const { lines } = written({ mode: "sap", system: "A4H", client: "100" });
  assert.deepEqual(lines[0].vertex_context, { mode: "sap", system: "A4H", client: "100" });
});

test("an unusable context is refused rather than written half", () => {
  for (const value of [null, {}, { mode: "folder" }, { mode: "sap", client: "100" }, { mode: "whatever", folder: "x" }, "C:\\x"]) {
    assert.equal("vertex_context" in written(value).lines[0], false, "refused: " + JSON.stringify(value));
  }
});

test("Session Logs reads the context back, and a log without one stays uncontexted", () => {
  const { root } = written({ mode: "folder", folder: "C:\\soft\\GitHub\\AVE" });
  const held = logReport.readSessions(root).sessions[0];
  assert.deepEqual(held.context, { mode: "folder", folder: "C:\\soft\\GitHub\\AVE" });

  const plain = written(null);
  assert.equal(logReport.readSessions(plain.root).sessions[0].context, null);
});

for (const context of [{ mode: "folder", folder: "/project" }, { mode: "sap", system: "A4H", client: "100" }, { mode: "zero" }]) {
  test("a decision before context does not hide an existing conversation: " + context.mode, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-decision-context-"));
    try {
      const log = sessionLog.create(root, "codemie", "20261125_164156_76d211", { questions: true });
      log.decision({ web_intent: { web: false } }, true);
      log.setContext(context);
      log.user("Find the missing log");
      const header = sessionLog.readHeader(log.file);
      assert.equal(header.type, "vertex_decision");
      assert.deepEqual(header.vertex_context, context);
      for (const listOnly of [false, true]) {
        const report = logReport.readSessions(root, { place: context, listOnly });
        assert.equal(report.sessions.length, 1);
        assert.equal(report.sessions[0].prompts[0].text, "Find the missing log");
        assert.equal(report.places[0].key, logReport.placeKey(context));
        assert.equal(logReport.conversationList(report, context).length, 1);
        assert.equal(logReport.readSessions(root, { placeKey: "none", listOnly }).sessions.length, 0);
        assert.equal(logReport.readSessions(root, { placeKey: "folder:/other", listOnly }).sessions.length, 0);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test("header context follows an appended user record, even across UTF-8 chunks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-header-context-"));
  try {
    const log = sessionLog.create(root, "codemie", "header", { questions: true });
    log.decision({ state: "Я".repeat(20000) }, true);
    assert.equal(sessionLog.readHeader(log.file).vertex_context, undefined);
    assert.equal(logReport.readSessions(root, { placeKey: "folder:/project" }).sessions.length, 0);
    log.setContext({ mode: "folder", folder: "/project" });
    log.user("Now visible");
    // Exercise a final record without a newline as well as cache invalidation.
    const text = fs.readFileSync(log.file, "utf8");
    fs.writeFileSync(log.file, text.trimEnd());
    assert.deepEqual(sessionLog.readHeader(log.file).vertex_context, { mode: "folder", folder: "/project" });
    assert.equal(logReport.readSessions(root, { placeKey: "folder:/project", listOnly: true }).sessions.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a context of an unknown shape in the file is not trusted", () => {
  const { root, file } = written({ mode: "folder", folder: "C:\\soft\\GitHub\\AVE" });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n")
    .map(line => { const record = JSON.parse(line); record.vertex_context = { mode: "folder", folder: { evil: true } }; return JSON.stringify(record); });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  assert.equal(logReport.readSessions(root).sessions[0].context, null);
});
