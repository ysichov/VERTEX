"use strict";

/* The project's build or test command, run by VERTEX in the user's folder after a review's Apply - never by the
   assistant. The command is the project's own: the one remembered for the folder (vertex.ai.buildCommand), or
   the one the assistant proposed and the user ran. Its output goes to the "VERTEX Build" output channel; the
   result says whether it passed and holds the output's tail for the assistant to read. */

const { spawn } = require("child_process");

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
    const commandOutput = require("./command-output");
    const capture = commandOutput.collect({ directory: commandOutput.directory(vscode) });
    const keep = text => {
      out.append(text);
    };
    let child;
    try {
      child = spawnFn(command, [], { cwd: folder, shell: process.platform === "win32" ? "powershell.exe" : true, env: require("./assistant").nodeEnv(), windowsHide: true });
    } catch (error) {
      out.appendLine("Could not start: " + error.message);
      resolve({ code: -1, tail: error.message });
      return;
    }
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout && child.stdout.on("data", text => { capture.write("stdout", text); keep(text); });
    child.stderr && child.stderr.on("data", text => { capture.write("stderr", text); keep(text); });
    child.on("error", error => { keep("Could not start: " + error.message + "\n"); });
    child.on("close", code => {
      out.appendLine("[exit " + code + "]");
      const captured = capture.finish();
      resolve({ code: code === null ? -1 : code, ...captured, tail: (captured.stdout.trimEnd() + "\n" + captured.stderr).trim() });
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

// A current task may request packaging without the tests saved for the folder.
// A different proposal is offered on the existing review page, never replaced by the saved command.
function select(saved, proposed) {
  saved = String(saved || "").trim(); proposed = String(proposed || "").trim();
  return { command: proposed || saved, automatic: !!saved && (!proposed || proposed === saved) };
}
module.exports = { run, remembered, remember, select, output };
