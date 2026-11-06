"use strict";

/* The project's build or test command, run by VERTEX in the user's folder after a review's Apply - never by the
   assistant. The command is the project's own: the one remembered for the folder (vertex.ai.buildCommand), or
   the one the assistant proposed and the user ran. Its output goes to the "VERTEX Build" output channel; the
   result says whether it passed and holds the output's tail for the assistant to read. */

const { spawn } = require("child_process");

const TAIL = 80;
let channel = null;

function output(vscode) {
  if (!channel) channel = vscode.window.createOutputChannel("VERTEX Build");
  return channel;
}

/** Runs COMMAND in FOLDER; resolves to { code, tail } once it ends. On Windows the command runs in PowerShell. */
function run(vscode, folder, command, spawnFn = spawn) {
  const out = output(vscode);
  out.show(true);
  out.appendLine("");
  out.appendLine("> " + command + "    (" + folder + ")");
  return new Promise(resolve => {
    const lines = [];
    const keep = text => {
      out.append(text);
      for (const part of String(text).split(/\r?\n/)) if (part.trim()) lines.push(part);
      while (lines.length > TAIL) lines.shift();
    };
    let child;
    try {
      child = spawnFn(command, [], { cwd: folder, shell: process.platform === "win32" ? "powershell.exe" : true, windowsHide: true });
    } catch (error) {
      out.appendLine("Could not start: " + error.message);
      resolve({ code: -1, tail: error.message });
      return;
    }
    child.stdout && child.stdout.on("data", keep);
    child.stderr && child.stderr.on("data", keep);
    child.on("error", error => { keep("Could not start: " + error.message + "\n"); });
    child.on("close", code => {
      out.appendLine("[exit " + code + "]");
      resolve({ code: code === null ? -1 : code, tail: lines.join("\n") });
    });
  });
}

/** The command remembered for FOLDER, if any. */
function remembered(vscode, folder) {
  const value = vscode.workspace.getConfiguration("vertex.ai", vscode.Uri.file(folder)).get("buildCommand", "");
  return typeof value === "string" ? value.trim() : "";
}

/** Remembers COMMAND for FOLDER: the folder's own settings when it is a workspace folder, the workspace's otherwise. */
async function remember(vscode, folder, command) {
  const uri = vscode.Uri.file(folder);
  const target = vscode.workspace.getWorkspaceFolder && vscode.workspace.getWorkspaceFolder(uri)
    ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
  await vscode.workspace.getConfiguration("vertex.ai", uri).update("buildCommand", command, target);
}

module.exports = { run, remembered, remember };
