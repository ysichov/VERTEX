"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const load = Module._load;
Module._load = function (name, ...rest) { return name === "vscode" ? {} : load.call(this, name, ...rest); };
const { reviewSnapshot } = require("../git-history");
Module._load = load;

test("program changes come before documentation, so a cut loses prose first", () => {
  const change = (file, after) => ({ file, status: "M", before: "a\n", after });
  const doc = change("README.md", "x\n".repeat(20000));
  const code = change("vscode/chat.js", "fixed\n");
  const snap = reviewSnapshot([doc, change("history.md", "h\n"), code], "Uncommitted changes", "/repo", 5000);
  assert.ok(snap.truncated);
  const body = snap.text.split("Changed blocks")[1];
  assert.ok(body.indexOf("M vscode/chat.js") >= 0 && body.indexOf("M vscode/chat.js") < body.indexOf("M README.md"));
  assert.match(snap.text, /Files:\nM vscode\/chat\.js\nM README\.md\nM history\.md/);
});
