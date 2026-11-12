"use strict";

/* Claude Code's permission prompt tool for a chat working in a folder. Claude Code calls it with
   { tool_name, input } and reads back { behavior: "allow", updatedInput } or { behavior: "deny", message }.
   File edits and writes - any file, any language - wait in one review page, VERTEX's review: Claude Code asks
   for parallel calls at once, so every change waiting is shown together and decided file by file; Allow
   answers them all, Deny or closing the page refuses them all. A shell command asks in a modal dialog. */

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
    current = null;
  }
  const before = lf(current || "");
  if (name === "Write") return { file, before, after: lf(input.content || ""), created: current === null };
  const oldText = lf(input.old_string || ""), newText = lf(input.new_string || "");
  if (!oldText) return { error: "The edit of " + file + " has no old_string." };
  const at = before.indexOf(oldText);
  if (at < 0) return { error: "The edit's old_string is not in " + file + "." };
  if (!input.replace_all && before.indexOf(oldText, at + 1) >= 0) return { error: "The edit's old_string occurs more than once in " + file + "." };
  const after = input.replace_all ? before.split(oldText).join(newText) : before.slice(0, at) + newText + before.slice(at + oldText.length);
  return { file, before, after, created: false };
}

/* Every file change waiting for the user, in one review page. */
function reviewQueue(vscode) {
  const pending = new Map();
  let panel = null, next = 0;
  // The files on the page: ASK AI stays open for them after Allow or Deny settled them.
  let shownFiles = new Map();
  const render = () => {
    const files = [...pending.values()];
    shownFiles = new Map(files.map(f => [f.id, f]));
    const total = new Map(), seenCount = new Map();
    files.forEach(f => total.set(f.seen.file, (total.get(f.seen.file) || 0) + 1));
    panel.webview.html = review.filesReviewHtml(files.map(f => {
      const n = (seenCount.get(f.seen.file) || 0) + 1;
      seenCount.set(f.seen.file, n);
      const base = path.basename(f.seen.file);
      return { id: f.id, path: f.seen.file, label: total.get(f.seen.file) > 1 ? base + " (change " + n + ")" : base,
        kind: f.seen.created ? "new" : "changed", parts: f.parts, after: f.seen.after, abap: /\.abap$/i.test(f.seen.file) };
    }));
  };
  const settle = (ids, decide) => ids.forEach(id => {
    const item = pending.get(id);
    if (item) { pending.delete(id); item.resolve(decide(item)); }
  });
  const open = () => {
    panel = vscode.window.createWebviewPanel("vertex.fileReview", "Review assistant changes",
      vscode.ViewColumn.Beside, { enableScripts: true });
    require("./ai-availability").attach(panel);
    require("./review-jev").bind(vscode,panel,message=>{
      const item=shownFiles.get(message.file);if(!item||!Number.isInteger(message.hunk))return null;
      return review.askContext(item.parts,[message.hunk],item.seen.after,"local",item.seen.file);
    });
    const untrackLinks=require("./file-links").register(panel,()=>[...shownFiles].map(([id,f])=>({id,path:f.seen.file,relative:path.basename(f.seen.file)})));
    panel.webview.onDidReceiveMessage(async message => {
      if(message?.action==="fileView"){const f=shownFiles.get(message.file);await review.sendFileView(panel,message,f?{parts:f.parts,after:f.seen.after,before:f.seen.before,abap:/\.abap$/i.test(f.seen.file)}:null);return;}
      if (!message) return;
      if (message.action === "ask" && shownFiles.has(message.file)) {
        const item = shownFiles.get(message.file);
        await vscode.commands.executeCommand("vertex.askReviewBlock",
          review.askContext(item.parts, Number.isInteger(message.hunk)?[message.hunk]:null, item.seen.after, "local", item.seen.file));
      } else if (message.action === "deny") {
        settle([...pending.keys()], item => deny("The user denied this change of " + item.seen.file + "."));
        await panel.webview.postMessage({ action: "denied" });
      } else if (message.action === "apply") {
        const approved = new Set(Array.isArray(message.approved) ? message.approved : []);
        const declined = new Set(Array.isArray(message.declined) ? message.declined : []);
        const shown = [...pending.keys()];
        if (shown.some(id => !approved.has(id) && !declined.has(id))) {
          await panel.webview.postMessage({ action: "error", message: "Approve or decline every file first." });
          return;
        }
        settle(shown, item => approved.has(item.id) ? allow(item.input)
          : deny("The user declined this change of " + item.seen.file + "."));
        await panel.webview.postMessage({ action: "saved" });
      }
    });
    panel.onDidDispose(() => {
      untrackLinks();
      panel = null;
      settle([...pending.keys()], item => deny("The user closed the review of " + item.seen.file + " without allowing it."));
    });
  };
  const add = function (input, seen, parts) {
    return new Promise(resolve => {
      const id = "f" + (++next);
      pending.set(id, { id, input, seen, parts, resolve });
      if (!panel) open(); else if (panel.reveal) panel.reveal(undefined, true);
      render();
    });
  };
  add.dispose = () => {
    settle([...pending.keys()], () => deny("This request is no longer active."));
    if (panel && panel.dispose) panel.dispose();
  };
  return add;
}

function set(vscode, read = file => fs.readFileSync(file, "utf8")) {
  const queue = reviewQueue(vscode);
  return {
    tools: [schema],
    dispose: () => queue.dispose(),
    call: async function (_deps, _name, args) {
      const name = String(args.tool_name || "");
      const input = args.input || {};
      let decision;
      if (name === "Edit" || name === "Write") {
        const seen = change(name, input, read);
        const parts = seen.error ? [] : review.hunks(seen.before, seen.after);
        decision = seen.error ? deny(seen.error + " Nothing was shown for review.")
          : !parts.length && !seen.created ? allow(input) : await queue(input, seen, parts);
      } else {
        const choice = "Allow";
        const answer = await vscode.window.showWarningMessage("VERTEX assistant: " + describe(name, input), { modal: true }, choice);
        decision = answer === choice ? allow(input) : deny("The user denied this action.");
      }
      return { content: [{ type: "text", text: JSON.stringify(decision) }] };
    }
  };
}

module.exports = { TOOL, schema, set, describe, change };
