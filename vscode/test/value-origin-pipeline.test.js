"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), path = require("path");

const read = file => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");

test("both hosts read Value origin's sources through the one pipeline, not a collector of their own", () => {
  const eclipse = read("eclipse/value-origin.html"), vscode = read("vscode/code-workbench.js");
  assert.match(eclipse, /origin\.collect\(/, "the Eclipse page asks the pipeline");
  assert.doesNotMatch(eclipse, /collectSources|collectDemandSources/, "and no collector directly");
  const linter = vscode.slice(vscode.indexOf("const linterSources"), vscode.indexOf("require('./value-origin-view').register"));
  assert.match(linter, /require\('\.\/value-origin-pipeline'\)\.collect\(/, "the VS Code analysis asks the pipeline");
  assert.doesNotMatch(linter, /collectSources|collectDemandSources/, "and no collector directly");
  assert.doesNotMatch(read("eclipse/value-origin-bundle.js"), /collectSources|collectDemandSources/, "the Eclipse bundle offers no collector but the pipeline");
});

test("the pipeline refuses a host that gives it no reader", () => {
  const { collect } = require("../value-origin-pipeline");
  assert.throws(() => collect([], {}, { load: async () => [] }), /reader for objects and for class parts/);
});
