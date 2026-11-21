"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const worktree = require("../agent-worktree");
const reviewer = require("../worktree-review");

const made = [];
test("assistant ASK AI opens an independent review for all changes and uses a project-relative tree", async () => {
  const page = { posted: [] }, commands = [], vscode = fakeVscode(page);
  vscode.commands.executeCommand = async (...args) => commands.push(args);
  const folder = path.join(os.tmpdir(), "project");
  const changes = [{ file: "src/a.txt", path: path.join(folder, "src", "a.txt"), before: "old", after: "new" },
    { file: "b.txt", path: path.join(folder, "b.txt"), before: "", after: "added" }];
  reviewer.open(vscode, { folder, changes: async () => changes }, changes, () => {}, { task: "Original task", turnId: "0123456789abcdef" });
  assert.match(page.html, /id="askall"/);
  assert.match(page.html, /data-jev-scope="review"/);
  assert.equal((page.html.match(/data-jev-scope="file"/g)||[]).length,2);
  const tree = page.html.slice(page.html.indexOf('<nav class="review-tree"'), page.html.indexOf('</nav>'));
  assert.match(tree, /<summary>project<\/summary>/);
  assert.doesNotMatch(tree, /<summary>[A-Z]:/);
  await page.send({ action: "ask", all: true });
  assert.equal(commands[0][0], "vertex.openAiReview");
  assert.equal(commands[0][1].blocks.length, 2);
  assert.equal(await commands[0][1].isCurrent(), true);
  assert.equal(commands[0][1].task, "Original task");
  assert.equal(commands[0][1].relatedTurnId, "0123456789abcdef", "the review is logged as a step of the turn that made the changes");
  assert.equal((await commands[0][1].refresh()).relatedTurnId, "0123456789abcdef");
  await page.send({ action: "ask", file: "f1" });
  assert.deepEqual(commands[1][1].files, ["src/a.txt"]);
  const whole=reviewer.aiContext(changes,folder,"All topic requests");
  const oneFile=reviewer.aiContext(changes,folder,"All topic requests",{file:"src/a.txt"});
  const oneBlock=reviewer.aiContext(changes,folder,"All topic requests",{file:"src/a.txt",hunk:0});
  assert.deepEqual([whole.scope,oneFile.scope,oneBlock.scope],["review","file","block"]);
  assert.deepEqual([whole.blocks.length,oneFile.blocks.length,oneBlock.blocks.length],[2,1,1]);
  assert.equal(whole.task,"All topic requests");
});
test.after(() => made.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-repo-"));
  made.push(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  git("init", "-q"); git("config", "core.autocrlf", "false");
  ["a.txt", "b.txt", "c.txt"].forEach(f => fs.writeFileSync(path.join(dir, f), f + "\n"));
  git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "start");
  return dir;
}
function fakeVscode(page) {
  return { window: { createWebviewPanel: () => ({ webview: { set html(v) { page.html = v; }, onDidReceiveMessage: fn => { page.send = fn; },
    postMessage: async m => { page.posted.push(m); } }, onDidDispose: fn => { page.close = fn; } }), showErrorMessage() {},showWarningMessage:async()=>undefined },
    ViewColumn: { Beside: 2 }, commands: { executeCommand: async () => {} } };
}

test("one review per answer: approved copied and declined dropped without sending rework", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "a\nfirst\n");
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "a\nfirst\nsecond\n");
    fs.writeFileSync(path.join(copy.dir, "b.txt"), "b changed\n");
    fs.writeFileSync(path.join(copy.dir, "c.txt"), "c changed\n");
    const changes = await copy.changes();
    assert.equal(changes.length, 3, "a file's edits are one change");
    const page = { posted: [] };
    let outcome = null;
    reviewer.open(fakeVscode(page), copy, changes, o => { outcome = o; });
    assert.match(page.html, />Apply</);
    assert.match(page.html,/id="decline-all"/);
    assert.match(page.html,/id="delete-declined"/);
    assert.match(page.html,/id="delete-changes"/);
    assert.doesNotMatch(page.html,/class="reason"/);
    await page.send({ action: "apply", approved: ["f1"], declined: ["f2"] });
    assert.equal(page.posted.pop().action, "error", "every file needs a decision");
    await page.send({ action: "apply", approved: ["f1"], declined: ["f2", "f3"] });
    assert.deepEqual(outcome.applied, ["a.txt"]);
    assert.deepEqual(outcome.reworked, []);
    assert.deepEqual(outcome.dropped, ["b.txt", "c.txt"]);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a\nfirst\nsecond\n");
    assert.equal(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "b.txt\n", "a declined file is not copied");
    assert.equal(fs.readFileSync(path.join(copy.dir, "c.txt"), "utf8"), "c.txt\n", "a dropped change is undone in the copy");
    assert.match(reviewer.report(outcome), /Declined; your change was dropped/);
    assert.deepEqual(await copy.changes(), [], "decided files do not come up again unchanged");
  } finally { await copy.remove(); }
});

test("closing the review with marks but no Apply asks, and Apply there does the marked ones", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "changed\n");
    fs.writeFileSync(path.join(copy.dir, "b.txt"), "changed too\n");
    const page = { posted: [] }, asked = [];
    const vscode = fakeVscode(page);
    vscode.window.showWarningMessage = async (text, options, ...items) => { asked.push({ text, options,items }); return "Apply Decisions"; };
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    reviewer.open(vscode, copy, await copy.changes(), resolveDone);
    await page.send({ action: "decisions", approved: ["f1"], declined: [] });
    page.close();
    const outcome = await done;
    assert.match(asked[0].text, /without Apply/);
    assert.ok(asked[0].items.includes("Delete All Changes"));
    assert.ok(asked[0].items.includes("Choose Files to Delete"));
    assert.match(asked[0].options.detail, /1 not decided/);
    assert.deepEqual(outcome.applied, ["a.txt"]);
    assert.deepEqual(outcome.closed, ["b.txt"]);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "changed\n");
    assert.deepEqual((await copy.changes()).map(c => c.file), ["b.txt"], "the undecided file comes up again");
  } finally { await copy.remove(); }
});

test("closing the review decides nothing: the changes come up again after the next answer", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "changed\n");
    const page = { posted: [] };
    let outcome = null,resolveDone;
    const done=new Promise(resolve=>{resolveDone=resolve;});
    reviewer.open(fakeVscode(page), copy, await copy.changes(), o => { outcome = o; resolveDone(); });
    page.close();await done;
    assert.deepEqual(outcome.closed, ["a.txt"]);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a.txt\n");
    assert.equal((await copy.changes()).length, 1);
  } finally { await copy.remove(); }
});
test("closing an unmarked review can delete one pending change",async()=>{
 const dir=repo(),copy=await worktree.open(dir);
 try{
  fs.writeFileSync(path.join(copy.dir,"a.txt"),"assistant edit\n");
  const page={posted:[]},vscode=fakeVscode(page);
  vscode.window.showWarningMessage=async(_text,_options,...items)=>{assert.ok(items.includes("Delete All Changes"));return "Delete All Changes";};
  const changes=await copy.changes(),done=new Promise(resolve=>{reviewer.open(vscode,copy,changes,resolve);page.close();});
  const outcome=await done;
  assert.deepEqual(outcome.dropped,["a.txt"]);
  assert.deepEqual(await copy.changes(),[]);
  assert.equal(fs.readFileSync(path.join(dir,"a.txt"),"utf8"),"a.txt\n");
 }finally{await copy.remove();}
});
test("closing a multi-file review can select only the changes to delete",async()=>{
 const dir=repo(),copy=await worktree.open(dir);
 try{
  fs.writeFileSync(path.join(copy.dir,"a.txt"),"assistant A\n");
  fs.writeFileSync(path.join(copy.dir,"b.txt"),"assistant B\n");
  const page={posted:[]},vscode=fakeVscode(page);
  vscode.window.showWarningMessage=async()=>"Choose Files to Delete";
  vscode.window.showQuickPick=async items=>items.filter(item=>item.label==="a.txt");
  const changes=await copy.changes(),done=new Promise(resolve=>{reviewer.open(vscode,copy,changes,resolve);page.close();});
  const outcome=await done;
  assert.deepEqual(outcome.dropped,["a.txt"]);
  assert.deepEqual(outcome.closed,["b.txt"]);
  assert.deepEqual((await copy.changes()).map(change=>change.file),["b.txt"]);
 }finally{await copy.remove();}
});
test("Delete Changes on the page removes every assistant edit after confirmation",async()=>{
 const dir=repo(),copy=await worktree.open(dir);
 try{
  fs.writeFileSync(path.join(copy.dir,"a.txt"),"assistant A\n");
  fs.writeFileSync(path.join(copy.dir,"b.txt"),"assistant B\n");
  const page={posted:[]},vscode=fakeVscode(page);
  vscode.window.showWarningMessage=async()=>"Delete All Changes";
  let outcome;
  reviewer.open(vscode,copy,await copy.changes(),result=>{outcome=result;});
  await page.send({action:"deleteChanges"});
  assert.deepEqual(outcome.dropped,["a.txt","b.txt"]);
  assert.deepEqual(await copy.changes(),[]);
  assert.equal(fs.readFileSync(path.join(dir,"a.txt"),"utf8"),"a.txt\n");
 }finally{await copy.remove();}
});
test("Delete Declined on the page removes only selected assistant edits",async()=>{
 const dir=repo(),copy=await worktree.open(dir);
 try{
  fs.writeFileSync(path.join(copy.dir,"a.txt"),"assistant A\n");
  fs.writeFileSync(path.join(copy.dir,"b.txt"),"assistant B\n");
  const page={posted:[]},vscode=fakeVscode(page);
  vscode.window.showWarningMessage=async()=>"Delete Declined";
  let outcome;
  reviewer.open(vscode,copy,await copy.changes(),result=>{outcome=result;});
  await page.send({action:"deleteDeclined",files:["f1"]});
  assert.deepEqual(outcome.dropped,["a.txt"]);
  assert.deepEqual(outcome.closed,["b.txt"]);
  assert.deepEqual((await copy.changes()).map(change=>change.file),["b.txt"]);
 }finally{await copy.remove();}
});
