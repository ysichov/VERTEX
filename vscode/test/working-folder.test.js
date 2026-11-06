"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { workingFolder } = require("../chat");

const folder = fsPath => ({ uri: { scheme: "file", fsPath } });
function host(editorUri, folders) {
  return { window: { activeTextEditor: editorUri ? { document: { uri: editorUri } } : undefined },
    workspace: { workspaceFolders: folders,
      getWorkspaceFolder: uri => folders.find(f => uri.fsPath.startsWith(f.uri.fsPath)) } };
}

test("with no editor open, the workspace's only folder is Claude's working folder", () => {
  assert.equal(workingFolder(host(null, [folder("C:\\HR_DME")]), "claude"), "C:\\HR_DME");
});

test("two folders and no editor leave no folder; an active file picks its own", () => {
  const two = [folder("C:\\A"), folder("C:\\B")];
  assert.equal(workingFolder(host(null, two), "claude"), "");
  assert.equal(workingFolder(host({ scheme: "file", fsPath: "C:\\B\\x.abap" }, two), "claude"), "C:\\B");
});

test("a SAP tab leaves no folder; every provider gets a local workspace folder", () => {
  const one = [folder("C:\\A")];
  assert.equal(workingFolder(host({ scheme: "vertex", fsPath: "/x" }, one), "claude"), "");
  for (const id of ["claude", "codex", "codemie", "copilot", "anthropic-api", ...Object.keys(require("../openai-compatible").PROVIDERS)])
    assert.equal(workingFolder(host(null, one), id), "C:\\A");
  const untrusted = host(null, one); untrusted.workspace.isTrusted = false;
  assert.equal(workingFolder(untrusted, "codex"), "");
});

test("a step's paths into the working copy become the folder's, in either slash style", () => {
  const { inFolder } = require("../chat");
  const copy = { dir: String.raw`C:\Temp\vertex-wt-1`, top: String.raw`C:\soft\P` };
  const step = inFolder({ input: { file_path: String.raw`c:\temp\vertex-wt-1\src\a.js`, command: "cat C:/Temp/vertex-wt-1/b.md" } }, copy);
  assert.equal(step.input.file_path, String.raw`C:\soft\P\src\a.js`);
  assert.equal(step.input.command, "cat C:/soft/P/b.md");
});
