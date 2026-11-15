"use strict";

const path = require("node:path");
const history = require("./git-history");
const review = require("./code-review");

async function snapshot(folder) {
  const changes = await history.readWorkingChanges(folder);
  return new Map(changes.map(change => [change.file, change]));
}

function show(vscode, folder, before, after) {
  const changed = [...new Set([...before.keys(), ...after.keys()])].sort().filter(file =>
    before.get(file)?.afterDigest !== after.get(file)?.afterDigest);
  if (!changed.length) return [];
  const files = changed.map((file, index) => {
    const old = before.get(file), current = after.get(file);
    const previous = old?.after ?? current?.before ?? "";
    const next = current?.after ?? old?.before ?? "";
    const binary = Boolean(old?.binary || current?.binary);
    return { id: "f" + index, path: file, label: path.basename(file),
      kind: previous === "" ? "new" : next === "" ? "deleted" : "changed", binary,
      before: previous, after: next, parts: binary ? [] : review.hunks(previous, next),
      abap: /\.abap$/i.test(file) };
  });
  const panel = vscode.window.createWebviewPanel("vertex.projectCommandDiff", "Bash changes in project",
    vscode.ViewColumn.Beside, { enableScripts: true });
  panel.webview.html = review.filesReviewHtml(files, { readonly: {
    title: "Bash changes in project", subtitle: folder + " · changes made by this command" },
    rootLabel: path.basename(folder) });
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.action === "fileView") await review.sendFileView(panel, message,
      files.find(file => file.id === message.file), true);
    if (message?.action === "openCode") {
      const file = files.find(item => item.id === message.file);
      const line = Number(message.line);
      if (file && Number.isSafeInteger(line) && line > 0)
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path.join(folder, file.path)),
          { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(line - 1, 0, line - 1, 0), preview: true });
    }
  });
  return changed;
}

module.exports = { snapshot, show };
