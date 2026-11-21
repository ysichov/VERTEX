"use strict";

/* The review at the end of an answer: Apply copies approved files into the user's folder and drops declined
   changes from the assistant's working copy. Delete Changes drops every pending change. */

const path = require("path");
const review = require("./code-review");

function aiContext(changes, folder, task = "", scope = null) {
  const selected = scope ? changes.filter(change => change.file === scope.file) : changes;
  const blocks = selected.filter(change => !change.binary).flatMap(change =>
    review.askContext(review.hunks(change.before, change.after), scope && Number.isInteger(scope.hunk) ? [scope.hunk] : null,
      change.after, "local", change.file).blocks.map(block => ({ ...block, file: change.file })));
  blocks.forEach((block, i) => { block.block = i + 1; });
  return { system: "local", object: scope ? scope.file : path.basename(folder), scope: scope ? Number.isInteger(scope.hunk) ? "block" : "file" : "review", all: !scope, total: blocks.length,
    blocks, files: selected.map(change => change.file), task, logContext: { mode: "folder", folder } };
}

/** Opens the review of CHANGES (from agent-worktree's changes()); ONDONE gets the outcome after Apply. */
/* OPTIONS.build: { command } the assistant proposed for building the folder after a change; offered on the page
   once something was applied. OPTIONS.onBuild(command, remember) runs it; the page shows how it ended. */
function open(vscode, copy, changes, onDone, options = {}) {
  const panel = vscode.window.createWebviewPanel("vertex.worktreeReview", "Review assistant changes",
    vscode.ViewColumn.Beside, { enableScripts: true });
  require("./ai-availability").attach(panel);
  const byId = new Map(changes.map((change, i) => ["f" + (i + 1), change]));
  require("./review-jev").bind(vscode,panel,message=>{
    const scope=message.scope==="review"?null:message.scope==="file"?{file:byId.get(message.file)?.file}:Number.isInteger(message.hunk)?{file:byId.get(message.file)?.file,hunk:message.hunk}:undefined;
    if(scope===undefined||scope?.file&&!byId.has(message.file))return null;
    return aiContext(changes,copy.folder||copy.top,options.task||"",scope);
  });
  panel.webview.html = review.filesReviewHtml([...byId].map(([id, change]) => ({
    id, path: change.path, treePath: change.file, label: path.basename(change.file), conflict: change.conflict, merged: change.merged, binary: change.binary,
    kind: change.status === "added" ? "new" : change.status === "deleted" ? "deleted" : "changed",
    parts: change.binary || change.status === "deleted" ? [] : review.hunks(change.before, change.after),
    before: change.before, after: change.after, abap: /\.abap$/i.test(change.file)
  })), { worktree: true, rootLabel: path.basename(copy.folder || copy.top) });
  const untrackLinks=require("./file-links").register(panel,()=>[...byId].map(([id,change])=>({id,path:change.path,relative:path.relative(copy.folder||copy.top,change.path)})));
  let finished = false, built = false;
  const offered = options.build && typeof options.build.command === "string" ? options.build.command.trim() : "";
  panel.webview.onDidReceiveMessage(async message => {
    if(message?.action==="fileView"){const change=byId.get(message.file);await review.sendFileView(panel,message,change?{parts:change.binary?[]:review.hunks(change.before,change.after),before:change.before,after:change.after,binary:change.binary,abap:/\.abap$/i.test(change.file)}:null);return;}
    if (message && message.action === "build" && finished && offered && !built && typeof options.onBuild === "function") {
      built = true;
      await panel.webview.postMessage({ action: "buildStatus", state: "working", message: "Building in your folder: " + offered + " - output in VERTEX Build." });
      const result = await options.onBuild(offered, message.remember === true);
      await panel.webview.postMessage({ action: "buildStatus", state: result && result.code === 0 ? "success" : "error", message: result && result.code === 0
        ? "Build passed." : "Build failed (exit " + (result ? result.code : "?") + "); its output went to the assistant." });
      return;
    }
    if (!message) return;
    // ASK AI stays open after Apply: the reader may still ask about a change already decided.
    if (message.action === "ask" && (message.all || byId.has(message.file))) {
      const scope = message.all ? null : { file: byId.get(message.file).file, hunk: message.hunk };
      const folder = copy.folder || copy.top;
      const buildContext = snapshot => {
        const context = aiContext(snapshot, folder, options.task || "", scope);
        const fingerprint = JSON.stringify(context.blocks);
        context.isCurrent = async () => fingerprint === JSON.stringify(aiContext(await copy.changes(), folder, options.task || "", scope).blocks);
        context.refresh = async () => buildContext(await copy.changes());
        // The chat turn whose changes these are: Session Logs shows the AI Review as a step of that turn.
        if (options.turnId) context.relatedTurnId = options.turnId;
        return context;
      };
      await vscode.commands.executeCommand("vertex.openAiReview", buildContext(changes));
      return;
    }
    if (finished) return;
    if (message.action === "decisions") { marked = decisionsOf(message); return; }
    if (message.action === "deleteChanges" || message.action === "deleteDeclined") {
      const selected=message.action==="deleteChanges"?new Set(byId.keys()):new Set((Array.isArray(message.files)?message.files:[]).filter(id=>byId.has(id)));
      if(!selected.size){await panel.webview.postMessage({action:"error",message:"Decline at least one file to delete it."});return;}
      const label=message.action==="deleteChanges"?"Delete All Changes":"Delete Declined";
      const answer=await vscode.window.showWarningMessage("Delete "+selected.size+" assistant change(s)? Your folder will not be changed.",
        {modal:true,detail:"Selected changes will be reset in the assistant's working copy; other files will remain pending."},label);
      if(answer!==label){await panel.webview.postMessage({action:"error",message:"Changes kept for review."});return;}
      finished=true;
      const outcome=await carryOut({approved:new Set(),declined:selected});
      await panel.webview.postMessage({action:"saved",message:summary(outcome)});
      onDone(outcome);
      return;
    }
    if (message.action !== "apply") return;
    const decided = decisionsOf(message);
    if ([...byId.keys()].some(id => !decided.approved.has(id) && !decided.declined.has(id))) {
      await panel.webview.postMessage({ action: "error", message: "Approve or decline every file first." });
      return;
    }
    finished = true;
    const outcome = await carryOut(decided);
    await panel.webview.postMessage({ action: "saved", message: summary(outcome) });
    // Something reached the folder: the assistant's build command is offered there.
    if (outcome.applied.length && offered) await panel.webview.postMessage({ action: "offerBuild", command: offered });
    onDone(outcome);
  });
  // The page reports its marks as they are made, so closing it can offer to apply them.
  let marked = { approved: new Set(), declined: new Set() };
  function decisionsOf(message) {
    return { approved: new Set((Array.isArray(message.approved) ? message.approved : []).filter(id => byId.has(id))),
      declined: new Set((Array.isArray(message.declined) ? message.declined : [])
        .map(d => typeof d==="string"?d:d?.id).filter(id => byId.has(id))) };
  }
  /* Does what was decided; an undecided file stays in the copy for the next review. */
  async function carryOut(decided) {
    const outcome = { applied: [], merged: [], reworked: [], dropped: [], failed: [], closed: [] };
    for (const [id, change] of byId) {
      try {
        if (decided.approved.has(id)) { await copy.apply(change); outcome.applied.push(change.file); if (change.merged) outcome.merged.push(change.file); }
        else if (decided.declined.has(id)) { await copy.revert(change); outcome.dropped.push(change.file); }
        else outcome.closed.push(change.file);
      } catch (error) { outcome.failed.push({ file: change.file, error: error.message }); }
    }
    if (outcome.failed.length) vscode.window.showErrorMessage("VERTEX: " + outcome.failed.map(f => f.error).join(" "));
    return outcome;
  }
  panel.onDidDispose(async () => {
    untrackLinks();
    if (finished) return;
    finished = true;
    const count = marked.approved.size + marked.declined.size;
    // Replaced by a newer review (quiet): leave the changes for the new page.
    if (!panel.quiet) {
      const left = byId.size - count;
      const answer = await vscode.window.showWarningMessage("The review was closed without Apply. What should happen to the assistant's changes?",
        { modal: true, detail: marked.approved.size + " approved, " + marked.declined.size + " declined"
          + (left ? "; " + left + " not decided." : ".") }, ...(count?["Apply Decisions"]:[]),...(byId.size>1?["Choose Files to Delete"]:[]),"Delete All Changes","Keep for Later");
      if (answer === "Apply Decisions") { onDone(await carryOut(marked)); return; }
      if (answer === "Choose Files to Delete") {
        const picked=await vscode.window.showQuickPick([...byId].map(([id,change])=>({label:change.file,id})),
          {canPickMany:true,placeHolder:"Select assistant changes to delete"});
        if(picked?.length){onDone(await carryOut({approved:new Set(),declined:new Set(picked.map(item=>item.id))}));return;}
      }
      if (answer === "Delete All Changes") { onDone(await carryOut({approved:new Set(),declined:new Set(byId.keys())})); return; }
    }
    // Closed without deciding: nothing is copied; the changes stay in the copy and come up again after the next answer.
    onDone({ applied: [], merged: [], reworked: [], dropped: [], failed: [], closed: changes.map(c => c.file) });
  });
  return panel;
}

function summary(outcome) {
  const said = [];
  if (outcome.applied.length) said.push("copied into your folder: " + outcome.applied.join(", "));
  if (outcome.dropped.length) said.push("dropped: " + outcome.dropped.join(", "));
  if (outcome.failed.length) said.push("not done: " + outcome.failed.map(f => f.error).join(" "));
  return said.length ? "Done - " + said.join("; ") + "." : "Done.";
}

/** What the assistant is told about the review before its next answer. */
function report(outcome) {
  const lines = [];
  if (outcome.applied.length) lines.push("Approved and copied into the user's folder: " + outcome.applied.join(", ") + ".");
  if ((outcome.merged || []).length) lines.push("Of these, merged with the user's own change made meanwhile (your working copy now has the merged file): " + outcome.merged.join(", ") + ".");
  if (outcome.dropped.length) lines.push("Declined; your change was dropped and the working copy has the user's version again: " + outcome.dropped.join(", ") + ".");
  if (outcome.failed.length) lines.push("Approved but not copied: " + outcome.failed.map(f => f.error).join(" "));
  if (outcome.closed && outcome.closed.length) lines.push("Not decided by the user yet, still waiting in the working copy: " + outcome.closed.join(", ") + ".");
  return lines.join("\n");
}

module.exports = { open, report, summary, aiContext };
