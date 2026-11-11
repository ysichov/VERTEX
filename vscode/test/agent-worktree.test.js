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
    await assert.rejects(copy.apply(change), /overlap/);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "user\n");
    await copy.revert(change);
    assert.equal(fs.readFileSync(path.join(copy.dir, "a.txt"), "utf8"), "user\n");
    assert.deepEqual(await copy.changes(), []);
  } finally { await copy.remove(); }
});

test("changes that do not overlap are merged; the merged file goes to the folder and the copy", async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "m.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "m"], { cwd: dir });
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "m.txt"), "1\nassistant\n3\n4\n5\n6\n7\n8\n");
    fs.writeFileSync(path.join(dir, "m.txt"), "1\n2\n3\n4\n5\n6\n7\nuser\n");
    const [change] = await copy.changes();
    assert.equal(change.conflict, false);
    assert.equal(change.merged, true);
    assert.equal(change.after, "1\nassistant\n3\n4\n5\n6\n7\nuser\n");
    assert.equal(change.before, "1\n2\n3\n4\n5\n6\n7\nuser\n", "the review compares with the folder as it is");
    await copy.apply(change);
    assert.equal(fs.readFileSync(path.join(dir, "m.txt"), "utf8"), "1\nassistant\n3\n4\n5\n6\n7\nuser\n");
    assert.equal(fs.readFileSync(path.join(copy.dir, "m.txt"), "utf8"), "1\nassistant\n3\n4\n5\n6\n7\nuser\n");
    assert.deepEqual(await copy.changes(), []);
    // The next edit of the same file is measured against what the folder holds now: no stale conflict.
    fs.writeFileSync(path.join(copy.dir, "m.txt"), "1\nassistant\n3\nmore\n5\n6\n7\nuser\n");
    const [next] = await copy.changes();
    assert.equal(next.conflict, false);
    assert.equal(next.merged, false);
  } finally { await copy.remove(); }
});

test("a declined overlap leaves the folder's version in the copy, and the redone change is not a conflict", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "assistant\n");
    fs.writeFileSync(path.join(dir, "a.txt"), "user\n");
    const [change] = await copy.changes();
    assert.equal(change.conflict, true);
    await copy.keep(change);
    assert.equal(fs.readFileSync(path.join(copy.dir, "a.txt"), "utf8"), "user\n");
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "user\nassistant\n");
    const [redone] = await copy.changes();
    assert.equal(redone.conflict, false);
    await copy.apply(redone);
    assert.equal(fs.readFileSync(path.join(dir, "a.txt"), "utf8"), "user\nassistant\n");
  } finally { await copy.remove(); }
});

test("a folder outside git has no copy", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-plain-"));
  made.push(plain);
  assert.equal(await worktree.open(plain), null);
});

test("refresh: what the user changed in the folder reaches the copy before the assistant works again", async () => {
  const dir = repo();
  const copy = await worktree.open(dir);
  try {
    assert.deepEqual(await copy.refresh(), [], "nothing changed yet");
    // A file the assistant has not touched takes the folder's version.
    fs.writeFileSync(path.join(dir, "a.txt"), "one\nby hand\n");
    fs.writeFileSync(path.join(dir, "new.txt"), "made by hand\n");
    assert.deepEqual((await copy.refresh()).sort(), ["a.txt", "new.txt"]);
    assert.equal(fs.readFileSync(path.join(copy.dir, "a.txt"), "utf8"), "one\nby hand\n");
    assert.equal(fs.readFileSync(path.join(copy.dir, "new.txt"), "utf8"), "made by hand\n");
    assert.deepEqual(await copy.changes(), [], "the user's own edits are not the assistant's changes");
    assert.deepEqual(await copy.refresh(), [], "brought once");
  } finally { await copy.remove(); }
});

test("refresh: a change still waiting for review is merged with the user's, and an overlap stops the turn", async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "five"], { cwd: dir });
  const copy = await worktree.open(dir);
  try {
    fs.writeFileSync(path.join(copy.dir, "a.txt"), "ONE\ntwo\nthree\nfour\nfive\n");     // the assistant, undecided
    fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\nfour\nFIVE\n");          // the user, by hand
    assert.deepEqual(await copy.refresh(), ["a.txt"]);
    assert.equal(fs.readFileSync(path.join(copy.dir, "a.txt"), "utf8"), "ONE\ntwo\nthree\nfour\nFIVE\n");
    const [change] = await copy.changes();
    assert.equal(change.conflict, false);
    assert.equal(change.before, "one\ntwo\nthree\nfour\nFIVE\n", "measured against the user's version");
    fs.writeFileSync(path.join(dir, "a.txt"), "uno\ntwo\nthree\nfour\nFIVE\n");          // overlaps the assistant's line
    await assert.rejects(copy.refresh(), /a\.txt changed in your folder .* overlap/);
    assert.equal(fs.readFileSync(path.join(copy.dir, "a.txt"), "utf8"), "ONE\ntwo\nthree\nfour\nFIVE\n", "the copy is left as it was");
  } finally { await copy.remove(); }
});
