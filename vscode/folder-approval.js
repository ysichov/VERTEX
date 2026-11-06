"use strict";

/* Claude Code's permission prompt tool for a chat working in a folder. Claude Code calls it with
   { tool_name, input } and reads back { behavior: "allow", updatedInput } or { behavior: "deny", message }.
   A file edit or write - any file, any language - opens in VERTEX's review page, block by block: the
   approved blocks are what Claude Code then writes, Deny or closing the page refuses the change. A shell
   command asks in a modal dialog. */

const fs = require("fs");
const path = require("path");
const review = require("./code-review");

const TOOL = "approve_action";

const schema = {
  name: TOOL,
  description: "Asks the VS Code user to allow or deny one action of the assistant.",
  inputSchema: {
    type: "object",
    properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } },
    required: ["tool_name", "input"]
  }
};

const allow = input => ({ behavior: "allow", updatedInput: input });
const deny = message => ({ behavior: "deny", message });
const lf = text => String(text).replace(/\r\n/g, "\n");

function describe(name, input) {
  const args = input || {};
  if (name === "Bash") return "Run command:\n\n" + String(args.command || "");
  return name + ":\n\n" + JSON.stringify(args, null, 2);
}

/* The file as it is, and as the edit or write would leave it - both with \n line ends - or a reason not to show it. */
function change(name, input, read) {
  const file = String(input.file_path || "");
  if (!file) return { error: "The " + name + " request names no file." };
  let current = "";
  try { current = read(file); } catch (error) {
    if (name === "Edit" || error.code !== "ENOENT") return { error: "Cannot read " + file + ": " + error.message };
  }
  const before = lf(current), eol = /\r\n/.test(current) ? "\r\n" : "\n";
  if (name === "Write") return { file, before, after: lf(input.content || ""), eol: /\r\n/.test(input.content || "") ? "\r\n" : "\n" };
  const oldText = lf(input.old_string || ""), newText = lf(input.new_string || "");
  if (!oldText) return { error: "The edit of " + file + " has no old_string." };
  const at = before.indexOf(oldText);
  if (at < 0) return { error: "The edit's old_string is not in " + file + "." };
  if (!input.replace_all && before.indexOf(oldText, at + 1) >= 0) return { error: "The edit's old_string occurs more than once in " + file + "." };
  const after = input.replace_all ? before.split(oldText).join(newText) : before.slice(0, at) + newText + before.slice(at + oldText.length);
  return { file, before, after, eol, at, oldText };
}

/* What Claude Code is allowed to do once only the APPROVED blocks of PARTS are kept. */
function approvedInput(name, input, seen, parts, approved) {
  if (approved.length === parts.length) return input;
  const kept = review.reviewedSource(seen.before, parts, approved);
  const eol = text => seen.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  if (name === "Write") return { ...input, content: eol(kept) };
  if (input.replace_all) throw new Error("This edit replaces every occurrence: approve all its blocks or deny it.");
  const prefix = seen.before.slice(0, seen.at), suffix = seen.before.slice(seen.at + seen.oldText.length);
  if (!kept.startsWith(prefix) || !kept.endsWith(suffix) || kept.length < prefix.length + suffix.length) {
    throw new Error("The approved blocks reach outside this edit: approve all its blocks or deny it.");
  }
  return { ...input, new_string: eol(kept.slice(prefix.length, kept.length - suffix.length)) };
}

function reviewFile(vscode, name, input, seen) {
  const parts = review.hunks(seen.before, seen.after);
  if (!parts.length) return Promise.resolve(allow(input));
  return new Promise(resolve => {
    let answered = false;
    const answer = decision => { if (!answered) { answered = true; resolve(decision); } };
    const label = path.basename(seen.file);
    const panel = vscode.window.createWebviewPanel("vertex.fileReview", "Review " + label,
      vscode.ViewColumn.Beside, { enableScripts: true });
    panel.webview.html = review.reviewHtml(parts, { before: seen.before, after: seen.after, objectName: label,
      objectType: name === "Write" && !seen.before ? "New file" : "File", system: seen.file, ai: true, file: true,
      abap: /\.abap$/i.test(seen.file) });
    panel.webview.onDidReceiveMessage(async message => {
      if (!message || answered) return;
      if (message.action === "ask" && (message.all === true || Number.isInteger(message.hunk) && parts[message.hunk])) {
        await vscode.commands.executeCommand("vertex.askReviewBlock",
          review.askContext(parts, message.all === true ? null : [message.hunk], seen.after, "local", seen.file));
      } else if (message.action === "deny") {
        answer(deny("The user denied this change of " + seen.file + "."));
        await panel.webview.postMessage({ action: "denied" });
      } else if (message.action === "apply") {
        const approved = Array.isArray(message.approved)
          ? [...new Set(message.approved.filter(i => Number.isInteger(i) && i >= 0 && i < parts.length))].sort((a, b) => a - b) : [];
        try {
          if (!approved.length) throw new Error("Approve at least one block.");
          answer(allow(approvedInput(name, input, seen, parts, approved)));
          await panel.webview.postMessage({ action: "saved", approved });
        } catch (error) {
          await panel.webview.postMessage({ action: "error", message: error.message });
        }
      }
    });
    panel.onDidDispose(() => answer(deny("The user closed the review of " + seen.file + " without allowing it.")));
  });
}

function set(vscode, read = file => fs.readFileSync(file, "utf8")) {
  return {
    tools: [schema],
    call: async function (_deps, _name, args) {
      const name = String(args.tool_name || "");
      const input = args.input || {};
      let decision;
      if (name === "Edit" || name === "Write") {
        const seen = change(name, input, read);
        decision = seen.error ? deny(seen.error + " Nothing was shown for review.") : await reviewFile(vscode, name, input, seen);
      } else {
        const choice = "Allow";
        const answer = await vscode.window.showWarningMessage("VERTEX assistant: " + describe(name, input), { modal: true }, choice);
        decision = answer === choice ? allow(input) : deny("The user denied this action.");
      }
      return { content: [{ type: "text", text: JSON.stringify(decision) }] };
    }
  };
}

module.exports = { TOOL, schema, set, describe, change, approvedInput };
