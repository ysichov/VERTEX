"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const workflow = require("../vsix-workflow");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-vsix-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const values = new Map([
    ["vscode/package.json", '{"name":"vertex-abap","version":"0.9.104"}\n'],
    ["vscode/package-lock.json", '{"version":"0.9.104","packages":{"":{"version":"0.9.104"}}}\n'],
    ["org.vertex.abap.feature/feature.xml", '<feature version="0.9.104.qualifier"/>\n'],
    ["org.vertex.abap.ui/META-INF/MANIFEST.MF", 'Bundle-Version: 0.9.104.qualifier\n'],
    ["README.md", 'Current VS Code extension: **0.9.104**.\n']
  ]);
  for (const [file, value] of values) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); }
  return root;
}

test("plain build keeps the current version and writes nothing", t => {
  const root = fixture(t), plan = workflow.prepare(root, "собери всикс", "current");
  assert.equal(plan.action, "current"); assert.equal(plan.version, "0.9.104"); assert.deepEqual(plan.edits, []);
  assert.equal(plan.command, process.platform === "win32" ? ".\\vscode\\package.ps1" : "./vscode/package.sh");
});
test("+1 is calculated locally and staged in all version files", t => {
  const root = fixture(t), plan = workflow.prepare(root, "VSIX +1", "current");
  assert.equal(plan.version, "0.9.105"); workflow.stage(root, plan);
  for (const file of workflow.files) assert.match(fs.readFileSync(path.join(root, file), "utf8"), /0\.9\.105/);
  assert.match(fs.readFileSync(path.join(root, "README.md"), "utf8"), /0\.9\.105/);
});
test("Jev may choose increment, while an explicit version takes precedence", t => {
  const root = fixture(t);
  assert.equal(workflow.prepare(root, "новый релиз", "increment").version, "0.9.105");
  assert.equal(workflow.prepare(root, "собери 0.9.117", "increment").version, "0.9.117");
});
test("inconsistent project versions stop before any edits", t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "org.vertex.abap.feature/feature.xml"), '<feature version="0.9.103.qualifier"/>');
  assert.throws(() => workflow.prepare(root, "+1", "increment"), /disagrees/);
  assert.match(fs.readFileSync(path.join(root, "vscode/package.json"), "utf8"), /0\.9\.104/);
});
