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

test("a context of an unknown shape in the file is not trusted", () => {
  const { root, file } = written({ mode: "folder", folder: "C:\\soft\\GitHub\\AVE" });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n")
    .map(line => { const record = JSON.parse(line); record.vertex_context = { mode: "folder", folder: { evil: true } }; return JSON.stringify(record); });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  assert.equal(logReport.readSessions(root).sessions[0].context, null);
});
