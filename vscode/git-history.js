"use strict";
// Git History of a local folder: its commits as a table in a window of its own, beside the Tools window,
// as Session Logs opens. Read with `git log` in that folder; a folder outside a git repository says so.
const { execFile } = require("child_process");
const crypto = require("crypto");

const SEP = "\x1f", END = "\x1e";

function readCommits(folder) {
  return new Promise((resolve, reject) => {
    execFile("git", ["log", "--date=iso-strict", "--pretty=format:%H" + SEP + "%h" + SEP + "%ad" + SEP + "%an" + SEP + "%s" + END, "--", "."],
      { cwd: folder, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        if (error) { reject(new Error(String(stderr || error.message).trim() || "git log failed")); return; }
        resolve(stdout.split(END).map(line => line.replace(/^\r?\n/, "")).filter(Boolean).map(line => {
          const [hash, short, date, author, subject] = line.split(SEP);
          return { hash, short, date, author, subject };
        }));
      });
  });
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
  return changes;
}

let commitPanels = new Map();
/* A commit of the history on VERTEX's review page, read only: ASK AI on a block, a file or the whole commit. */
async function openCommit(vscode, folder, commit) {
  const key = folder + "|" + commit.hash;
  if (commitPanels.has(key)) { commitPanels.get(key).reveal(vscode.ViewColumn.Active); return; }
  const path = require("path"), review = require("./code-review");
  const changes = await readCommitChanges(folder, commit.hash);
  if (!changes.length) throw new Error("Commit " + commit.short + " changed nothing in this folder.");
  const files = changes.map((c, i) => ({ id: "f" + (i + 1), path: c.file, label: path.basename(c.file), binary: c.binary,
    kind: c.status === "A" ? "new" : c.status === "D" ? "deleted" : "changed",
    parts: c.binary || c.status === "D" ? [] : review.hunks(c.before, c.after), after: c.after, abap: /\.abap$/i.test(c.file) }));
  const panel = vscode.window.createWebviewPanel("vertex.commitReview", "Commit " + commit.short, vscode.ViewColumn.Active, { enableScripts: true });
  commitPanels.set(key, panel);
  panel.onDidDispose(() => commitPanels.delete(key));
  panel.webview.html = review.filesReviewHtml(files, { readonly: { title: "Commit " + commit.short + " · " + (commit.subject || ""),
    subtitle: [commit.author, String(commit.date || "").replace("T", " ").replace(/([+-]\d\d:\d\d|Z)$/, ""), commit.hash].filter(Boolean).join(" · ") } });
  const name = "commit " + commit.short;
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || message.action !== "ask") return;
    let context;
    if (message.all) {
      // The whole commit: every file's blocks, numbered through, each naming its file.
      const blocks = [];
      files.forEach(f => review.askContext(f.parts, null, f.after, "local", f.path).blocks.forEach(b => blocks.push({ ...b, file: f.path })));
      blocks.forEach((b, i) => { b.block = i + 1; });
      context = { system: "local", object: name, total: blocks.length, all: true, blocks };
    } else {
      const f = files.find(x => x.id === message.file);
      if (!f) return;
      context = review.askContext(f.parts, Number.isInteger(message.hunk) ? [message.hunk] : null, f.after, "local", name + " " + f.path);
    }
    await vscode.commands.executeCommand("vertex.askReviewBlock", context);
  });
}

function page(nonce) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:8px 12px}
h1{font-size:1.2em;margin:4px 0 2px}#folder{color:var(--vscode-descriptionForeground);margin-bottom:8px;word-break:break-all}
#error{color:var(--vscode-errorForeground)}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:3px 8px;border-bottom:1px solid var(--vscode-panel-border,transparent);vertical-align:top}
th{position:sticky;top:0;background:var(--vscode-editor-background);color:var(--vscode-descriptionForeground);font-weight:600}
tr:hover td{background:var(--vscode-list-hoverBackground)}
td.hash{font-family:var(--vscode-editor-font-family);white-space:nowrap}td.hash a{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:none}td.hash a:hover{color:var(--vscode-textLink-activeForeground);text-decoration:underline}td.date{white-space:nowrap}
</style></head><body>
<h1>Git History</h1><div id="folder"></div><div id="error" role="alert"></div>
<table hidden><thead><tr><th>Commit</th><th>Date</th><th>Author</th><th>Message</th></tr></thead><tbody></tbody></table>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();
window.addEventListener("message",e=>{
  const m=e.data||{};
  document.getElementById("folder").textContent=m.folder||"";
  document.getElementById("error").textContent=m.error||"";
  const table=document.querySelector("table"),body=table.querySelector("tbody");body.replaceChildren();
  table.hidden=!m.commits;
  (m.commits||[]).forEach(c=>{
    const tr=document.createElement("tr");
    [["hash",c.short],["date",String(c.date||"").replace("T"," ").replace(/([+-]\\d\\d:\\d\\d|Z)$/,"")],["author",c.author],["subject",c.subject]].forEach(([k,v])=>{
      const td=document.createElement("td");td.className=k;
      if(k==="hash"){const a=document.createElement("a");a.textContent=v||"";a.title="Review commit "+c.hash;a.tabIndex=0;
        const go=()=>vscode.postMessage({action:"commit",commit:c});a.onclick=go;a.onkeydown=e=>{if(e.key==="Enter")go();};td.appendChild(a);}
      else td.textContent=v||"";tr.appendChild(td);});
    body.appendChild(tr);
  });
  if(m.commits&&!m.commits.length)document.getElementById("error").textContent="No commits in this folder.";
});
vscode.postMessage({action:"ready"});
</script></body></html>`;
}

let panel, shown = "";
function open(vscode, folder) {
  shown = String(folder || "");
  if (!shown) throw new Error("Choose a folder first.");
  const refresh = async () => {
    try { await panel?.webview.postMessage({ folder: shown, commits: await readCommits(shown) }); }
    catch (error) { await panel?.webview.postMessage({ folder: shown, error: error.message }); }
  };
  if (panel) { panel.reveal(vscode.ViewColumn.Beside, false); return refresh(); }
  panel = vscode.window.createWebviewPanel("vertex.gitHistory", "VERTEX: Git History", vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  panel.webview.html = page(crypto.randomBytes(16).toString("hex"));
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.action === "ready") refresh();
    if (message?.action === "commit" && message.commit) {
      try { await openCommit(vscode, shown, message.commit); }
      catch (error) { vscode.window.showErrorMessage("VERTEX Git History: " + error.message); }
    }
  });
  panel.onDidDispose(() => { panel = undefined; });
}

module.exports = { open, readCommits, readCommitChanges };
