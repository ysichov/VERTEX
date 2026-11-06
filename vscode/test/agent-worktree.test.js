"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const worktree = require("../agent-worktree");

const made = [];
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-repo-"));
  made.push(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "build/\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "start");
  return dir;
}
test.after(() => made.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

test("the copy starts from the folder as it is: uncommitted and new files in, ignored ones out", async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "a.txt"), "one\nuncommitted\n");
  fs.writeFileSync(path.join(dir, "new.txt"), "fresh\n");
  fs.mkdirSync(path.join(dir, "build"));
  fs.writeFileSync(path.join(dir, "build", "out.bin"), "x");
  const copy = await worktree.open(dir);
  try {
    assert.equal(fs.readFileSync(path.join(copy.dir, "a.txt"), "utf8"), "one\nuncommitted\n");
    assert.equal(fs.readFileSync(path.join(copy.dir, "new.txt"), "utf8"), "fresh\n");
    assert.equal(fs.existsSync(path.join(copy.dir, "build")), false);
    assert.deepEqual(await copy.changes(), [], "nothing changed yet");
  } finally { await copy.remove(); }
  assert.equal(fs.existsSync(copy.dir), false, "removed");
});

test("changes are listed per file; approved ones are carried over and not listed again", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "one\ntwo\n");
    fs.writeFileSync(path.join(copy.dir, "b.txt"), "bee\n");
    const changes = await copy.changes();
    assert.deepEqual(changes.map(c => [c.file, c.status, c.conflict]), [["a.txt", "changed", false], ["b.txt", "added", false]]);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\n", "the user's folder is untouched");
    await copy.apply(changes[0]);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "one\ntwo\n");
    copy.keep(changes[1]);
    assert.deepEqual(await copy.changes(), []);
    fs.writeFileSync(path.join(copy.dir, "b.txt"), "bee reworked\n");
    assert.deepEqual((await copy.changes()).map(c => c.file), ["b.txt"], "a reworked file shows again");
  } finally { await copy.remove(); }
});

test("a file the user changed meanwhile is a conflict and is not overwritten; revert puts the user's version back", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "assistant\n");
    fs.writeFileSync(path.join(dir, "a.txt"), "user\n");
    const [change] = await copy.changes();
    assert.equal(change.conflict, true);
    await assert.rejects(copy.apply(change), /changed in your folder/);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "user\n");
    await copy.revert(change);
    assert.equal(fs.readFileSync(path.join(copy.dir, "a.txt"), "utf8"), "user\n");
    assert.deepEqual(await copy.changes(), []);
  } finally { await copy.remove(); }
});

test("a folder outside git has no copy", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-plain-"));
  made.push(plain);
  assert.equal(await worktree.open(plain), null);
});
