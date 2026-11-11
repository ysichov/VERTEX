"use strict";
// Git History of a local folder: its commits as a table in a window of its own, beside the Tools window,
// as Session Logs opens. Read with `git log` in that folder; a folder outside a git repository says so.
const { execFile } = require("child_process");
const crypto = require("crypto");

const SEP = "\x1f", END = "\x1e";

async function readCommits(folder, filter = {}) {
  // Only hashes and dates for numbering/months; load descriptions for visible rows only.
  const index = (await git(folder, ["log", "--date=iso-strict", "--pretty=format:%H" + SEP + "%ad" + SEP + "%an" + END, "--", "."]))
    .split(END).map(line => line.replace(/^\r?\n/, "")).filter(Boolean).map(line => {
      const [hash, date, author] = line.split(SEP); return { hash, date, author };
    });
  index.forEach((entry, i) => { entry.number = index.length - i; });
  const valid = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  const from = valid(filter.from), to = valid(filter.to);
  const byAuthor = filter.author ? index.filter(entry => entry.author === filter.author) : index;
  const selected = from || to ? byAuthor.filter(entry => {
    const day = entry.date.slice(0, 10); return (!from || day >= from) && (!to || day <= to);
  }) : byAuthor.slice(0, 10);
  const details = new Map();
  for (let i = 0; i < selected.length; i += 100) {
    const text = await git(folder, ["log", "--no-walk=unsorted", "--date=iso-strict", "--pretty=format:%H" + SEP + "%h" + SEP + "%ad" + SEP + "%an" + SEP + "%s" + SEP + "%b" + END,
      ...selected.slice(i, i + 100).map(entry => entry.hash), "--"]);
    for (const line of text.split(END).map(line => line.replace(/^\r?\n/, "")).filter(Boolean)) {
      const [hash, short, date, author, subject, ...body] = line.split(SEP);
      details.set(hash, { hash, short, date, author, subject, description: body.join(SEP).trimEnd() });
    }
  }
  const commits = selected.map(entry => ({ ...details.get(entry.hash), number: entry.number }));
  commits.months = [...new Set(index.map(entry => entry.date.slice(0, 7)))].sort().reverse();
  commits.authors = [...new Set(index.map(entry => entry.author))].sort((a,b)=>a.localeCompare(b));
  return commits;
}

function git(folder, args, encoding = "utf8") {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: folder, encoding, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) { reject(new Error(String(stderr || error.message).trim() || "git " + args[0] + " failed")); return; }
      resolve(stdout);
    });
  });
}

/* The files a commit changed inside FOLDER, each with its text before and after. A file that holds a NUL byte is
   binary and gets no line diff. */
async function readCommitChanges(folder, hash) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(hash))) throw new Error("Not a commit: " + hash);
  const list = (await git(folder, ["diff-tree", "-r", "--root", "--no-commit-id", "--relative", "--name-status", "-z", hash, "--", "."])).split("\0").filter(Boolean);
  const parent = (await git(folder, ["rev-list", "--parents", "-n", "1", hash])).trim().split(/\s+/)[1] || "";
  const show = async (rev, file) => { const b = await git(folder, ["show", rev + ":./" + file], "buffer"); return b.includes(0) ? null : b.toString("utf8"); };
  const changes = [];
  for (let i = 0; i + 1 < list.length; i += 2) {
    const status = list[i][0], file = list[i + 1];
    const before = status === "A" || !parent ? "" : await show(parent, file);
    const after = status === "D" ? "" : await show(hash, file);
    changes.push({ file, status, binary: before === null || after === null, before: before || "", after: after || "" });
  }
  await markGenerated(folder, changes);
  return changes;
}

/* Compare the working folder with HEAD, including staged and untracked files. */
async function readWorkingChanges(folder) {
  const fs = require("fs/promises"), path = require("path");
  const list = (await git(folder, ["diff", "HEAD", "--no-renames", "--relative", "--name-status", "-z", "--", "."])).split("\0").filter(Boolean);
  const untracked = (await git(folder, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."])).split("\0").filter(Boolean);
  const entries = new Map();
  for (let i = 0; i + 1 < list.length; i += 2) entries.set(list[i + 1], list[i][0]);
  for (const file of untracked) entries.set(file, "A");
  const changes = [];
  for (const [file, status] of entries) {
    const before = status === "A" ? Buffer.alloc(0) : await git(folder, ["show", "HEAD:./" + file], "buffer");
    let after = Buffer.alloc(0);
    try {
      const filename = path.join(folder, file), stat = await fs.lstat(filename);
      if (stat.isDirectory()) continue; // Submodule contents have their own history.
      after = stat.isSymbolicLink() ? Buffer.from(await fs.readlink(filename)) : await fs.readFile(filename);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (before.equals(after) && status === "M") continue;
    changes.push({ file, status: status === "A" ? "A" : after.length === 0 && status === "D" ? "D" : status,
      digest: crypto.createHash("sha256").update(before).update("\0").update(after).digest("hex"), afterDigest: crypto.createHash("sha256").update(after).digest("hex"),
      binary: before.includes(0) || after.includes(0), before: before.toString("utf8"), after: after.toString("utf8") });
  }
  await markGenerated(folder, changes);
  return changes;
}

/* Files the repository marks generated (.gitattributes linguist-generated): a copy or bundle of sources that sit
   elsewhere. Their diff only repeats those sources, so the review snapshot names them instead of showing it. */
async function markGenerated(folder, changes) {
  const files = changes.map(c => c.file);
  for (let i = 0; i < files.length; i += 200) {
    let out = "";
    try { out = await git(folder, ["check-attr", "-z", "linguist-generated", "--", ...files.slice(i, i + 200)]); } catch { return changes; }
    const parts = out.split("\0");
    for (let j = 0; j + 2 < parts.length; j += 3) {
      if (parts[j + 2] === "true" || parts[j + 2] === "set") { const c = changes.find(x => x.file === parts[j]); if (c) c.generated = true; }
    }
  }
  return changes;
}

let commitPanels = new Map();
const reviewSnapshots = new Map();

// The exact snapshot rendered by the visible Git review, not a fresh git read.
function reviewContext() {
  return [...reviewSnapshots].reverse().find(([panel]) => panel.visible)?.[1] || null;
}

function reviewSnapshot(changes, title, folder, limit = 180000) {
  const review = require("./code-review");
  changes = changes.filter(c => !c.binary);
  const manifest = changes.map(c => c.status + " " + c.file + (c.generated ? " (generated)" : "")).join("\n");
  const generated = changes.filter(c => c.generated);
  const sections = changes.filter(c => !c.generated).map(c => {
    const header = c.status + " " + c.file;
    if (c.binary) return header + "\nBinary file; no text diff.";
    const blocks = review.askContext(review.hunks(c.before, c.after), null, c.after, "local", c.file).blocks;
    return header + "\n" + JSON.stringify(blocks);
  });
  const text = title + "\nFolder: " + folder + "\nFiles:\n" + manifest
    + (generated.length ? "\n\nGenerated files (marked linguist-generated in .gitattributes): copies or bundles rebuilt from sources elsewhere in the repository. Their diff is omitted; a change here repeats its sources and is not a new feature by itself:\n" + generated.map(c => c.status + " " + c.file).join("\n") : "")
    + "\n\nChanged blocks (before = removed, after = added; context_before/context_after = unchanged):\n" + sections.join("\n\n");
  const truncated = text.length > limit;
  return { title, folder, file_count: changes.length, truncated,
    text: truncated ? text.slice(0, Math.max(0, limit - 50)) + "\n[Git review context truncated]" : text };
}
/* A commit of the history on VERTEX's review page, read only: ASK AI on a block, a file or the whole commit. */
// Per folder for this session: whether the hidden extensions are shown on the Uncommitted changes page.
const showHidden=new Map();
async function openCommit(vscode, folder, commit) {
  try{return await openCommitReview(vscode,folder,commit);}
  catch(error){
    const key=folder+"|"+(commit.working===true?"working":commit.hash),view=commitPanels.get(key);
    if(view)view.webview.html=require('./code-review').waitingHtml(commit.working===true?'Uncommitted changes':'Commit '+commit.short,error.message,true);
    throw error;
  }
}
async function openCommitReview(vscode, folder, commit) {
  const working = commit.working === true;
  const key = folder + "|" + (working ? "working" : commit.hash);
  if (commitPanels.has(key)) {
    if (!working) { commitPanels.get(key).reveal(vscode.ViewColumn.Active); return; }
    commitPanels.get(key).dispose();
  }
  const path = require("path"), review = require("./code-review");
  const title = working ? "Uncommitted changes" : "Commit " + commit.short;
  const panel = vscode.window.createWebviewPanel("vertex.commitReview", title, vscode.ViewColumn.Active, { enableScripts: true });
  let disposed=false,untrackLinks=()=>{};
  commitPanels.set(key,panel);
  panel.onDidDispose(()=>{disposed=true;untrackLinks();if(commitPanels.get(key)===panel)commitPanels.delete(key);reviewSnapshots.delete(panel);});
  panel.webview.html=review.waitingHtml(title,"Reading files and preparing the diff…");
  let changes,expectedHead;
  try{
    changes=working?await readWorkingChanges(folder):await readCommitChanges(folder,commit.hash);
    if(!changes.length&&!working)throw new Error("Commit "+commit.short+" changed nothing in this folder.");
    expectedHead=working?(await git(folder,["rev-parse","HEAD"])).trim():"";
  }catch(error){if(disposed)return;panel.webview.html=review.waitingHtml(title,error.message,true);throw error;}
  if(disposed)return;
  const makeFiles = changes => changes.map((c, i) => ({ id: "f" + (i + 1), path: c.file, label: path.basename(c.file), binary: c.binary,
    kind: c.status === "A" ? "new" : c.status === "D" ? "deleted" : "changed",
    openInEditor: c.status === "A" && !c.binary && (c.after.length>256*1024 || c.after.split('\n').length>1000),
    parts: c.binary ? [] : review.hunks(c.before, c.after), before:c.before, after: c.after, abap: /\.abap$/i.test(c.file) }));
  // Files of the hidden extensions (vertex.git.hiddenExtensions, .md and .log by default) are left out of the
  // page and of the AI snapshot until "Show" is on; the commit still takes every change.
  const hiddenExts=()=>{const list=vscode.workspace?.getConfiguration?vscode.workspace.getConfiguration("vertex.git",vscode.Uri?.file?vscode.Uri.file(folder):undefined).get("hiddenExtensions",["md","log"]):["md","log"];
    return (Array.isArray(list)?list:[]).map(x=>String(x).trim().replace(/^\*?\./,"").toLowerCase()).filter(Boolean);};
  const isHidden=file=>working&&hiddenExts().includes(path.extname(file).slice(1).toLowerCase());
  const visible=()=>showHidden.get(folder)?changes:changes.filter(c=>!isHidden(c.file));
  const hiddenCount=()=>changes.filter(c=>isHidden(c.file)).length;
  let files = makeFiles(visible());
  require("./review-jev").bind(vscode,panel,message=>{
    const file=files.find(item=>item.id===message.file);if(!file||file.binary||!Number.isInteger(message.hunk))return null;
    return review.askContext(file.parts,[message.hunk],file.after,"local",file.path);
  });
  untrackLinks = require("./file-links").register(panel,()=>files.map(f=>({id:f.id,path:path.resolve(folder,f.path),relative:f.path})));
  const shownChanges=()=>visible();
  let snapshot = shownChanges().length ? reviewSnapshot(shownChanges(), title, folder) : null;
  if(snapshot)reviewSnapshots.set(panel, snapshot);
  panel.onDidChangeViewState(event => {
    if (event.webviewPanel.active) { reviewSnapshots.delete(panel); if(snapshot)reviewSnapshots.set(panel, snapshot); }
  });
  const render = () => { panel.webview.html = review.filesReviewHtml(files, { readonly: { title: title + (working ? "" : " · " + (commit.subject || "")),
    commit: working && changes.length > 0, refresh: working, hidden: working ? { exts: hiddenExts(), count: hiddenCount(), shown: showHidden.get(folder) === true } : null, subtitle: working ? folder + " · HEAD → working folder (including staged and untracked files)" : [commit.author, formatDate(commit.date), commit.hash].filter(Boolean).join(" · ") } }); };
  render();
  const name = working ? "uncommitted changes" : "commit " + commit.short;
  let commitBusy=false, committed=false;
  panel.webview.onDidReceiveMessage(async message => {
    if(message?.action==='openEditor'){
      const file=files.find(f=>f.id===message.file);if(!file?.openInEditor)return;
      try{
        const document=await vscode.workspace.openTextDocument(working?vscode.Uri.file(path.resolve(folder,file.path)):{content:file.after});
        await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.Beside,preview:true});
      }catch(error){vscode.window.showErrorMessage('VERTEX: '+error.message);}
      return;
    }
    if(message?.action==="fileView"){await review.sendFileView(panel,message,files.find(f=>f.id===message.file),true);return;}
    if(working && ["loadBranches","switchBranch","preparePR","openPR","generatePR"].includes(message?.action)){
      const kind=message.action==="loadBranches"||message.action==="switchBranch"?"branchError":"prError";
      if(commitBusy){await panel.webview.postMessage({[kind]:"Another Git operation is running. Try again when it finishes."});return;}
      commitBusy=true;
      try{
        const helper=require("./git-branches");
        if(message.action==="loadBranches")await panel.webview.postMessage({branchInfo:await helper.info(folder)});
        else if(message.action==="switchBranch"){
          await helper.switchBranch(folder,message);
          changes=await readWorkingChanges(folder);expectedHead=(await git(folder,["rev-parse","HEAD"])).trim();files=makeFiles(visible());snapshot=visible().length?reviewSnapshot(visible(),title,folder):null;
          reviewSnapshots.delete(panel);if(snapshot)reviewSnapshots.set(panel,snapshot);committed=false;panel.title=title;render();
        }else if(message.action==="preparePR")await panel.webview.postMessage({prInfo:await helper.prInfo(folder)});
        else if(message.action==="generatePR"){
          const result=await vscode.commands.executeCommand("vertex.generatePullRequest",await helper.prSnapshot(folder,message),{summary:message.title,description:message.body});
          if(!result)throw new Error("No pull request description returned.");
          await panel.webview.postMessage(result.error?{prError:result.error,prGeneration:result.generation||null}:{prDraft:result});
        }
        else{const url=await helper.prUrl(folder,message);if(!await vscode.env.openExternal(vscode.Uri.parse(url)))throw new Error("Could not open the browser.");await panel.webview.postMessage({prOpened:true});}
      }catch(error){await panel.webview.postMessage({[kind]:error.message});}finally{commitBusy=false;}return;
    }
    if(working && (message?.action==="preparePush"||message?.action==="pushChanges")){
      if(commitBusy){await panel.webview.postMessage({pushError:"Another Git operation is running. Try again when it finishes."});return;}
      commitBusy=true;
      try{const helper=require("./git-push");if(message.action==="preparePush")await panel.webview.postMessage({pushInfo:await helper.info(folder)});else await panel.webview.postMessage({pushDone:await helper.push(folder,message)});}
      catch(error){await panel.webview.postMessage({pushError:error.message});}finally{commitBusy=false;}return;
    }
    if (working && message?.action === "toggleHidden") {
      showHidden.set(folder,!showHidden.get(folder));files=makeFiles(visible());
      snapshot=visible().length?reviewSnapshot(visible(),title,folder):null;
      reviewSnapshots.delete(panel);if(snapshot)reviewSnapshots.set(panel,snapshot);render();return;
    }
    if (working && message?.action === "refresh") {
      if(commitBusy||committed)return;commitBusy=true;
      try {
        const next=await readWorkingChanges(folder);
        const head=(await git(folder,["rev-parse","HEAD"])).trim();
        changes=next;expectedHead=head;files=makeFiles(visible());
        snapshot=visible().length?reviewSnapshot(visible(),title,folder):null;
        reviewSnapshots.delete(panel);if(snapshot)reviewSnapshots.set(panel,snapshot);
        render();
      }catch(error){await panel.webview.postMessage({reviewRefreshError:error.message});}finally{commitBusy=false;}return;
    }
    if (working && message?.action === "generateCommit") {
      if(commitBusy||committed)return;commitBusy=true;
      try {
        if(!snapshot?.file_count)throw new Error("No text changes to send to AI. Enter the commit message manually.");
        const result=await vscode.commands.executeCommand("vertex.generateCommitMessage",snapshot,{summary:message.summary,description:message.description});
        if(!result)throw new Error("No commit message returned.");
        if(result.error){await panel.webview.postMessage({commitError:result.error,...(result.generation?{commitGeneration:result.generation}:{})});return;}
        await panel.webview.postMessage({commitDraft:result});
      }catch(error){await panel.webview.postMessage({commitError:error.message,...(error.generation?{commitGeneration:error.generation}:{})});}finally{commitBusy=false;}return;
    }
    if (working && message?.action === "commitChanges") {
      if(commitBusy||committed)return;commitBusy=true;
      try {
        const result=await require("./git-commit").commit(folder,expectedHead,changes,message);committed=true;
        snapshot=null;reviewSnapshots.delete(panel);panel.title="Commit "+result.hash;await panel.webview.postMessage({commitDone:result});
        vscode.window.showInformationMessage("VERTEX: committed "+result.hash+(result.warning?". "+result.warning:""));
      }catch(error){await panel.webview.postMessage({commitError:error.message});}finally{commitBusy=false;}return;
    }
    if (!message || message.action !== "ask") return;
    let context;
    if (message.all) {
      // The whole commit: every file's blocks, numbered through, each naming its file.
      const blocks = [];
      files.filter(f => !f.binary).forEach(f => review.askContext(f.parts, null, f.after, "local", f.path).blocks.forEach(b => blocks.push({ ...b, file: f.path })));
      blocks.forEach((b, i) => { b.block = i + 1; });
      context = { system: "local", object: name, total: blocks.length, all: true, blocks };
    } else {
      const f = files.find(x => x.id === message.file);
      if (!f || f.binary) return;
      context = review.askContext(f.parts, Number.isInteger(message.hunk) ? [message.hunk] : null, f.after, "local", name + " " + f.path);
    }
    if(!context.blocks.length){vscode.window.showInformationMessage("No text changes to send to AI.");return;}
    await vscode.commands.executeCommand("vertex.askReviewBlock", context);
  });
}

function formatDate(value) {
  return String(value || "").replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3-$2-$1").replace("T", " ").replace(/([+-]\d\d:\d\d|Z)$/, "");
}

function page(nonce) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:8px 12px}
h1{font-size:1.2em;margin:4px 0 2px}#folder{color:var(--vscode-descriptionForeground);margin-bottom:8px;word-break:break-all}
#filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0}#filters[hidden]{display:none}
#filters label{display:flex;align-items:center;gap:4px}
input,select{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:3px 6px}
input{width:105px}input:focus,select:focus{outline:1px solid var(--vscode-focusBorder)}
button { --accent: var(--vscode-focusBorder); font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid var(--vscode-input-border,var(--vscode-panel-border)); border-radius: 6px; padding: 3px 10px; cursor: pointer; white-space: nowrap; transition: box-shadow .12s,border-color .12s; }
button:hover:not(:disabled) { border-color: var(--accent); box-shadow: 0 0 6px -1px var(--accent); }
.fold { padding: 1px 6px; margin-right: 6px; }
.description { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 3px; color: var(--vscode-descriptionForeground); }
#error{color:var(--vscode-errorForeground)}
.history-head{display:flex;align-items:center;gap:8px}.history-head h1{margin-right:4px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:3px 8px;border-bottom:1px solid var(--vscode-panel-border,transparent);vertical-align:top}
th{position:sticky;top:0;background:var(--vscode-editor-background);color:var(--vscode-descriptionForeground);font-weight:600}
tr:hover td{background:var(--vscode-list-hoverBackground)}
td.hash{font-family:var(--vscode-editor-font-family);white-space:nowrap}td.hash a{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:none}td.hash a:hover{color:var(--vscode-textLink-activeForeground);text-decoration:underline}td.date{white-space:nowrap}
${require("./code-review").controlsCss}
</style></head><body>
<header class="history-head"><h1>Git History</h1><button id="refresh" title="Refresh Git history" aria-label="Refresh Git history">↻</button></header><div id="folder"></div><div id="error" role="alert"></div>
<div id="filters" hidden><label>From <input id="from" placeholder="dd-mm-yyyy" aria-label="From date, dd-mm-yyyy" maxlength="10"></label><label>To <input id="to" placeholder="dd-mm-yyyy" aria-label="To date, dd-mm-yyyy" maxlength="10"></label><label>Month <select id="month"><option value="">Last 10 commits</option></select></label><label>Author <select id="author"><option value="">All authors</option></select></label></div>
<table hidden><thead><tr><th>#</th><th>Commit</th><th>Date</th><th>Author</th><th>Message</th></tr></thead><tbody></tbody></table>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();
const formatDate=${formatDate.toString()};
let commits=[],dirty=true;
const expandedDescriptions=new Set();
const from=document.getElementById("from"),to=document.getElementById("to"),month=document.getElementById("month"),author=document.getElementById("author"),error=document.getElementById("error");
function parseDate(input){
  const value=input.value.trim();
  if(!value)return "";
  const m=/^(\\d{2})-(\\d{2})-(\\d{4})$/.exec(value);
  if(!m)return null;
  const iso=m[3]+"-"+m[2]+"-"+m[1],date=new Date(iso+"T00:00:00Z");
  return !isNaN(date)&&date.toISOString().slice(0,10)===iso?iso:null;
}
function render(){
  const table=document.querySelector("table"),body=table.querySelector("tbody");body.replaceChildren();
  if(dirty){const row=document.createElement("tr"),cell=document.createElement("td"),link=document.createElement("a");
  cell.colSpan=5;cell.className="hash";link.textContent="Uncommitted changes";link.tabIndex=0;link.title="Review staged, unstaged and untracked changes";
  const go=()=>vscode.postMessage({action:"commit",commit:{working:true}});
  link.onclick=go;link.onkeydown=e=>{if(e.key==="Enter")go();};cell.appendChild(link);row.appendChild(cell);body.appendChild(row);}
  const start=parseDate(from),end=parseDate(to);
  from.setAttribute("aria-invalid",String(start===null));to.setAttribute("aria-invalid",String(end===null));
  if(start===null||end===null){error.textContent="Enter dates as dd-mm-yyyy.";return;}
  if(start&&end&&start>end){error.textContent="From date must be on or before To date.";return;}
  const visible=commits.filter(c=>{const day=String(c.date||"").slice(0,10);return (!start||day>=start)&&(!end||day<=end)&&(!author.value||c.author===author.value);});
  error.textContent=visible.length?"":commits.length?"No commits match these dates.":"No commits in this folder.";
  visible.forEach(c=>{
    const tr=document.createElement("tr");
    [["number",c.number],["hash",c.short],["date",formatDate(c.date)],["author",c.author],["subject",c.subject]].forEach(([k,v])=>{
      const td=document.createElement("td");td.className=k;
      if(k==="hash"){const a=document.createElement("a");a.textContent=v||"";a.title="Review commit "+c.hash;a.tabIndex=0;
        const go=()=>vscode.postMessage({action:"commit",commit:c});a.onclick=go;a.onkeydown=e=>{if(e.key==="Enter")go();};td.appendChild(a);}
      else if(k==="subject"&&String(c.description||"").trim()){
        const fold=document.createElement("button"),description=document.createElement("div"),subject=document.createElement("span");
        fold.type="button";fold.className="fold";subject.textContent=v||"";
        description.className="description";description.textContent=c.description;
        const paint=()=>{const expanded=expandedDescriptions.has(c.hash);description.hidden=!expanded;fold.textContent=expanded?"▾":"▸";
          fold.title=expanded?"Hide description":"Show description";fold.setAttribute("aria-label",fold.title);fold.setAttribute("aria-expanded",String(expanded));};
        fold.onclick=()=>{if(expandedDescriptions.has(c.hash))expandedDescriptions.delete(c.hash);else expandedDescriptions.add(c.hash);paint();};
        paint();td.appendChild(fold);td.appendChild(subject);td.appendChild(description);
      }else td.textContent=v||"";tr.appendChild(td);});
    body.appendChild(tr);
  });
}
let filterTimer;
function requestPeriod(){
  const start=parseDate(from),end=parseDate(to);
  if(start===null||end===null||(start&&end&&start>end))return;
  vscode.postMessage({action:"filter",from:start,to:end,author:author.value});
}
[from,to].forEach(input=>input.addEventListener("input",()=>{month.value="";render();clearTimeout(filterTimer);filterTimer=setTimeout(requestPeriod,350);}));
author.addEventListener("change",()=>{render();requestPeriod();});
month.addEventListener("change",()=>{
  if(month.value){
    const [year,m]=month.value.split("-");
    from.value="01-"+m+"-"+year;
    to.value=new Date(Date.UTC(Number(year),Number(m),0)).getUTCDate()+"-"+m+"-"+year;
  }else{from.value="";to.value="";}
  render();requestPeriod();
});
window.addEventListener("message",e=>{
  const m=e.data||{};
  if(document.getElementById("folder").textContent!==m.folder){expandedDescriptions.clear();from.value="";to.value="";month.value="";author.value="";}
  document.getElementById("folder").textContent=m.folder||"";
  dirty=m.dirty!==false;
  commits=(m.commits||[]).map((c,i)=>({...c,number:c.number ?? m.commits.length-i}));
  document.querySelector("table").hidden=!m.commits;
  document.getElementById("filters").hidden=!m.commits;
  const selected=month.value;month.replaceChildren(new Option("Last 10 commits",""));
  (m.months||[...new Set(commits.map(c=>String(c.date||"").slice(0,7)))].sort().reverse()).forEach(value=>{
    month.add(new Option(value.slice(5)+"-"+value.slice(0,4),value));
  });
  month.value=selected;
  const selectedAuthor=author.value;author.replaceChildren(new Option("All authors",""));
  (m.authors||[...new Set(commits.map(c=>c.author).filter(Boolean))]).forEach(value=>author.add(new Option(value,value)));
  author.value=selectedAuthor;
  if(m.error){error.textContent=m.error;return;}
  render();
});
document.getElementById("refresh").onclick=()=>vscode.postMessage({action:"refresh"});
vscode.postMessage({action:"ready"});
</script></body></html>`;
}

let panel, shown = "";
function open(vscode, folder) {
  shown = String(folder || "");
  if (!shown) throw new Error("Choose a folder first.");
  let refreshId = 0, lastFilter = {};
  const refresh = async (filter = lastFilter) => {
    lastFilter = filter;
    const id = ++refreshId, folder = shown;
    try {
      const commits = await readCommits(folder, filter);
      // The Uncommitted changes row is offered only when the folder has some.
      let dirty = true;
      try { dirty = (await git(folder, ["status", "--porcelain", "--untracked-files=normal", "--", "."])).trim() !== ""; } catch (_) {}
      if (id === refreshId && folder === shown) await panel?.webview.postMessage({ folder, commits, dirty, months: commits.months, authors: commits.authors });
    }
    catch (error) { await panel?.webview.postMessage({ folder: shown, error: error.message }); }
  };
  if (panel) { panel.reveal(vscode.ViewColumn.Beside, false); return refresh(); }
  panel = vscode.window.createWebviewPanel("vertex.gitHistory", "VERTEX: Git History", vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  panel.webview.html = page(crypto.randomBytes(16).toString("hex"));
  panel.onDidChangeViewState?.(event => { if (event.webviewPanel.visible) refresh(); });
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.action === "ready" || message?.action === "refresh") refresh();
    if (message?.action === "filter") refresh({from:message.from,to:message.to,author:message.author});
    if (message?.action === "commit" && message.commit) {
      try { await openCommit(vscode, shown, message.commit); }
      catch (error) { vscode.window.showErrorMessage("VERTEX Git History: " + error.message); }
    }
  });
  panel.onDidDispose(() => { panel = undefined; });
}

module.exports = { open, markGenerated, readCommits, readCommitChanges, readWorkingChanges, openCommit, reviewContext, reviewSnapshot };
