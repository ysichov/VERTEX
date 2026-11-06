"use strict";

/* A git working copy for the assistant. Claude works in it, not in the user's folder; at the end of an answer
   the changes are reviewed and the approved files carried over. The copy starts from the folder as it is -
   uncommitted changes and new files included, ignored files left out - and is removed with its conversation.

   The copy's baseline is a commit made inside it of that starting state, so every later change is a diff
   against it. Files are compared by git blob ids (hash-object), which applies the repository's filters:
   line-end conversion does not show as a change. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

function git(cwd, args, buffer) {
  return new Promise((resolve, reject) => execFile("git", args, { cwd, windowsHide: true, maxBuffer: 512 * 1024 * 1024,
    encoding: buffer ? "buffer" : "utf8" }, (error, out, err) => error
      ? reject(new Error("git " + args.filter(a => !/^-c$|=/.test(a))[0] + " failed: " + String(err || error.message).trim()))
      : resolve(out)));
}

const COMMIT = ["-c", "user.name=VERTEX", "-c", "user.email=vertex@localhost", "-c", "commit.gpgsign=false"];

/** The repository root of FOLDER, or "" when it is not in a git work tree. */
async function repositoryOf(folder) {
  try { return (await git(folder, ["rev-parse", "--show-toplevel"])).trim(); } catch (_) { return ""; }
}

/** A working copy of FOLDER's repository, or null when FOLDER is not in one. */
async function open(folder, options = {}) {
  const top = await repositoryOf(folder);
  if (!top) return null;
  const head = (await git(top, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "")).trim();
  if (!head) throw new Error("The repository at " + top + " has no commit yet, so no working copy can be made for review.");
  await git(top, ["worktree", "prune"]);
  // The folder's tracked state, uncommitted changes included; HEAD when there are none.
  const base = (await git(top, ["stash", "create"])).trim() || head;
  const dir = path.join(options.tmp || os.tmpdir(), "vertex-wt-" + crypto.randomBytes(5).toString("hex"));
  await git(top, ["worktree", "add", "--detach", dir, base]);
  try {
    const untracked = (await git(top, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
    for (const file of untracked) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.copyFileSync(path.join(top, file), path.join(dir, file));
    }
    await git(dir, ["add", "-A"]);
    await git(dir, COMMIT.concat(["commit", "-q", "--no-verify", "--allow-empty", "-m", "VERTEX review baseline"]));
  } catch (error) {
    await git(top, ["worktree", "remove", "--force", dir]).catch(() => {});
    throw error;
  }
  const baseline = (await git(dir, ["rev-parse", "HEAD"])).trim();
  const sub = path.relative(top, path.resolve(folder));
  // What the user decided, by path: the copy's blob id then. A file shows again only when the copy changes it anew.
  const settled = new Map();
  const blobIn = async (repo, file) => fs.existsSync(path.join(repo, file))
    ? (await git(repo, ["hash-object", "--", file])).trim() : "deleted";
  const baselineBlob = async file => (await git(dir, ["rev-parse", "-q", "--verify", baseline + ":" + file]).catch(() => "")).trim() || "deleted";
  const text = async (repo, file) => fs.existsSync(path.join(repo, file)) ? fs.readFileSync(path.join(repo, file)) : null;
  return {
    folder: path.resolve(folder), top, dir, cwd: sub ? path.join(dir, sub) : dir,
    /** The files the assistant changed since the start, or since the user's last decision on them. */
    async changes() {
      await git(dir, ["add", "-A"]);
      const listed = (await git(dir, ["diff", "--cached", "--name-status", "-z", "--no-renames", baseline])).split("\0").filter(Boolean);
      const result = [];
      for (let i = 0; i + 1 < listed.length; i += 2) {
        const status = listed[i], file = listed[i + 1];
        const now = await blobIn(dir, file);
        if (settled.get(file) === now) continue;
        const before = await text(top, file), after = await text(dir, file);
        result.push({ file, path: path.join(top, file), status: status === "A" ? "added" : status === "D" ? "deleted" : "changed",
          // The user's own copy changed since the start: carrying the assistant's version over would lose it.
          conflict: (await blobIn(top, file)) !== (await baselineBlob(file)),
          binary: [before, after].some(content => content && content.includes(0)),
          before: before ? before.toString("utf8") : "", after: after ? after.toString("utf8") : "", blob: now });
      }
      return result;
    },
    /** Carries the copy's version of FILE into the user's folder. */
    async apply(change) {
      const target = path.join(top, change.file);
      if ((await blobIn(top, change.file)) !== (await baselineBlob(change.file))) {
        throw new Error(change.file + " changed in your folder while the assistant worked; it was not overwritten.");
      }
      if (change.status === "deleted") { if (fs.existsSync(target)) fs.rmSync(target); }
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(dir, change.file), target); }
      settled.set(change.file, change.blob);
    },
    /** Leaves the copy's version where it is, for the assistant to rework. */
    keep(change) { settled.set(change.file, change.blob); },
    /** Puts the user's version of FILE back into the copy. */
    async revert(change) {
      const source = path.join(top, change.file), target = path.join(dir, change.file);
      if (fs.existsSync(source)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
      else if (fs.existsSync(target)) fs.rmSync(target);
      settled.set(change.file, await blobIn(dir, change.file));
    },
    async remove() {
      await git(top, ["worktree", "remove", "--force", dir]).catch(() => {});
      await git(top, ["worktree", "prune"]).catch(() => {});
    }
  };
}

module.exports = { open, repositoryOf };
