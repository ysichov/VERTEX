"use strict";

/* The review at the end of an answer: the assistant's working copy against the user's folder, file by file, on
   VERTEX's review page. Apply copies the approved files into the folder. A declined file with a reason stays in
   the copy for the assistant to rework; without a reason its change is dropped (the copy gets the user's
   version back). The outcome is what the assistant is told before its next answer. */

const path = require("path");
const review = require("./code-review");

/** Opens the review of CHANGES (from agent-worktree's changes()); ONDONE gets the outcome after Apply. */
function open(vscode, copy, changes, onDone) {
  const panel = vscode.window.createWebviewPanel("vertex.worktreeReview", "Review assistant changes",
    vscode.ViewColumn.Beside, { enableScripts: true });
  const byId = new Map(changes.map((change, i) => ["f" + (i + 1), change]));
  panel.webview.html = review.filesReviewHtml([...byId].map(([id, change]) => ({
    id, path: change.path, label: path.basename(change.file), conflict: change.conflict, merged: change.merged, binary: change.binary,
    kind: change.status === "added" ? "new" : change.status === "deleted" ? "deleted" : "changed",
    parts: change.binary || change.status === "deleted" ? [] : review.hunks(change.before, change.after),
    after: change.after, abap: /\.abap$/i.test(change.file)
  })), { worktree: true });
  let finished = false;
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || finished) return;
    if (message.action === "ask" && byId.has(message.file)) {
      const change = byId.get(message.file);
      await vscode.commands.executeCommand("vertex.askReviewBlock",
        review.askContext(review.hunks(change.before, change.after), null, change.after, "local", change.path));
      return;
    }
    if (message.action === "decisions") { marked = decisionsOf(message); return; }
    if (message.action !== "apply") return;
    const decided = decisionsOf(message);
    if ([...byId.keys()].some(id => !decided.approved.has(id) && !decided.declined.has(id))) {
      await panel.webview.postMessage({ action: "error", message: "Approve or decline every file first." });
      return;
    }
    finished = true;
    const outcome = await carryOut(decided);
    await panel.webview.postMessage({ action: "saved", message: summary(outcome) });
    onDone(outcome);
  });
  // The page reports its marks as they are made, so closing it can offer to apply them.
  let marked = { approved: new Set(), declined: new Map() };
  function decisionsOf(message) {
    return { approved: new Set((Array.isArray(message.approved) ? message.approved : []).filter(id => byId.has(id))),
      declined: new Map((Array.isArray(message.declined) ? message.declined : [])
        .filter(d => d && byId.has(d.id)).map(d => [d.id, String(d.reason || "").trim()])) };
  }
  /* Does what was decided; an undecided file stays in the copy for the next review. */
  async function carryOut(decided) {
    const outcome = { applied: [], merged: [], reworked: [], dropped: [], failed: [], closed: [] };
    for (const [id, change] of byId) {
      try {
        if (decided.approved.has(id)) { await copy.apply(change); outcome.applied.push(change.file); if (change.merged) outcome.merged.push(change.file); }
        else if (decided.declined.get(id)) { await copy.keep(change); outcome.reworked.push({ file: change.file, reason: decided.declined.get(id), overlapped: change.conflict }); }
        else if (decided.declined.has(id)) { await copy.revert(change); outcome.dropped.push(change.file); }
        else outcome.closed.push(change.file);
      } catch (error) { outcome.failed.push({ file: change.file, error: error.message }); }
    }
    if (outcome.failed.length) vscode.window.showErrorMessage("VERTEX: " + outcome.failed.map(f => f.error).join(" "));
    return outcome;
  }
  panel.onDidDispose(async () => {
    if (finished) return;
    finished = true;
    const count = marked.approved.size + marked.declined.size;
    // Replaced by a newer review (quiet), or closed with nothing marked: nothing is done, the files come up again.
    if (!panel.quiet && count) {
      const left = byId.size - count;
      const answer = await vscode.window.showWarningMessage("The review was closed without Apply. Apply the decisions you made?",
        { modal: true, detail: marked.approved.size + " approved, " + marked.declined.size + " declined"
          + (left ? "; " + left + " not decided stay for the next review." : ".") }, "Apply");
      if (answer === "Apply") { onDone(await carryOut(marked)); return; }
    }
    // Closed without deciding: nothing is copied; the changes stay in the copy and come up again after the next answer.
    onDone({ applied: [], merged: [], reworked: [], dropped: [], failed: [], closed: changes.map(c => c.file) });
  });
  return panel;
}

function summary(outcome) {
  const said = [];
  if (outcome.applied.length) said.push("copied into your folder: " + outcome.applied.join(", "));
  if (outcome.reworked.length) said.push("sent back with your reasons: " + outcome.reworked.map(r => r.file).join(", "));
  if (outcome.dropped.length) said.push("dropped: " + outcome.dropped.join(", "));
  if (outcome.failed.length) said.push("not done: " + outcome.failed.map(f => f.error).join(" "));
  return said.length ? "Done - " + said.join("; ") + "." : "Done.";
}

/** What the assistant is told about the review before its next answer. */
function report(outcome) {
  const lines = [];
  if (outcome.applied.length) lines.push("Approved and copied into the user's folder: " + outcome.applied.join(", ") + ".");
  if ((outcome.merged || []).length) lines.push("Of these, merged with the user's own change made meanwhile (your working copy now has the merged file): " + outcome.merged.join(", ") + ".");
  if (outcome.dropped.length) lines.push("Declined without a reason; your change was dropped and the working copy has the user's version again: " + outcome.dropped.join(", ") + ".");
  if (outcome.failed.length) lines.push("Approved but not copied: " + outcome.failed.map(f => f.error).join(" "));
  if (outcome.closed && outcome.closed.length) lines.push("Not decided by the user yet, still waiting in the working copy: " + outcome.closed.join(", ") + ".");
  outcome.reworked.forEach(r => lines.push("Declined " + r.file + " - the user's reason: " + r.reason
    + (r.overlapped ? " (the user had changed this file too and the changes overlapped: your working copy now holds the user's version; redo your change on top of it)" : "")));
  return lines.join("\n");
}

module.exports = { open, report, summary };
