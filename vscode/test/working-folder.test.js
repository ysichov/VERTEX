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

test("a SAP tab leaves no folder, and only Claude gets one", () => {
  const one = [folder("C:\\A")];
  assert.equal(workingFolder(host({ scheme: "vertex", fsPath: "/x" }, one), "claude"), "");
  assert.equal(workingFolder(host(null, one), "codex"), "");
});
