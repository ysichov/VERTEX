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
    postMessage: async m => { page.posted.push(m); } }, onDidDispose: fn => { page.close = fn; } }), showErrorMessage() {} },
    ViewColumn: { Beside: 2 }, commands: { executeCommand: async () => {} } };
}

test("one review per answer: approved copied, declined with a reason kept for rework, without one dropped", async () => {
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
    await page.send({ action: "apply", approved: ["f1"], declined: [{ id: "f2" }] });
    assert.equal(page.posted.pop().action, "error", "every file needs a decision");
    await page.send({ action: "apply", approved: ["f1"], declined: [{ id: "f2", reason: "keep the old wording" }, { id: "f3", reason: "" }] });
    assert.deepEqual(outcome.applied, ["a.txt"]);
    assert.deepEqual(outcome.reworked, [{ file: "b.txt", reason: "keep the old wording", overlapped: false }]);
    assert.deepEqual(outcome.dropped, ["c.txt"]);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a\nfirst\nsecond\n");
    assert.equal(fs.readFileSync(path.join(dir, "b.txt"), "utf8"), "b.txt\n", "a declined file is not copied");
    assert.equal(fs.readFileSync(path.join(copy.dir, "c.txt"), "utf8"), "c.txt\n", "a dropped change is undone in the copy");
    assert.match(reviewer.report(outcome), /b\.txt - the user's reason: keep the old wording/);
    assert.deepEqual(await copy.changes(), [], "decided files do not come up again unchanged");
  } finally { await copy.remove(); }
});

test("closing the review decides nothing: the changes come up again after the next answer", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "changed\n");
    const page = { posted: [] };
    let outcome = null;
    reviewer.open(fakeVscode(page), copy, await copy.changes(), o => { outcome = o; });
    page.close();
    assert.deepEqual(outcome.closed, ["a.txt"]);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "a.txt\n");
    assert.equal((await copy.changes()).length, 1);
  } finally { await copy.remove(); }
});
