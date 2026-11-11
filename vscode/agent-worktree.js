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
  // A file's base: what the assistant's change is measured against and what the folder is expected to still hold.
  // It starts as the baseline commit's and moves to the folder's version after every decision on the file, so a
  // decided file never shows a conflict that is not there.
  const bases = new Map();
  const blobIn = async (repo, file, write) => fs.existsSync(path.join(repo, file))
    ? (await git(repo, ["hash-object"].concat(write ? ["-w"] : [], ["--", file]))).trim() : "deleted";
  const baseBlob = async file => bases.get(file)
    || (await git(dir, ["rev-parse", "-q", "--verify", baseline + ":" + file]).catch(() => "")).trim() || "deleted";
  const read = (repo, file) => fs.existsSync(path.join(repo, file)) ? fs.readFileSync(path.join(repo, file)) : null;
  const write = (repo, file, content) => {
    const target = path.join(repo, file);
    if (content === null) { if (fs.existsSync(target)) fs.rmSync(target); return; }
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  };
  /* The folder's version, the base and the assistant's version merged line by line (git merge-file): the merged
     text, or null when their changes overlap or a side is missing. */
  async function merge(file, base) {
    const mine = read(top, file), theirs = read(dir, file);
    if (!mine || !theirs || base === "deleted") return null;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-merge-"));
    try {
      fs.writeFileSync(path.join(scratch, "folder"), mine);
      fs.writeFileSync(path.join(scratch, "base"), await git(dir, ["cat-file", "-p", base], true));
      fs.writeFileSync(path.join(scratch, "assistant"), theirs);
      return await new Promise(resolve => execFile("git", ["merge-file", "-p", "folder", "base", "assistant"],
        { cwd: scratch, windowsHide: true, encoding: "buffer", maxBuffer: 512 * 1024 * 1024 },
        (error, out) => resolve(error ? null : out)));
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  // After a decision: the folder's version is the file's base from now on.
  const settle = async (change) => {
    bases.set(change.file, await blobIn(top, change.file, true));
    settled.set(change.file, await blobIn(dir, change.file));
  };
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
        const base = await baseBlob(file), folderNow = await blobIn(top, file);
        if (now === base) continue;
        const before = read(top, file);
        let after = read(dir, file), conflict = false, merged = false;
        if (folderNow !== base && folderNow !== now) {
          // The user changed the file too: their change and the assistant's are merged when they do not overlap.
          const joined = await merge(file, base);
          if (joined) { after = joined; merged = true; } else conflict = true;
        }
        result.push({ file, path: path.join(top, file), status: status === "A" ? "added" : status === "D" ? "deleted" : "changed",
          conflict, merged, folderBlob: folderNow, content: after,
          binary: [before, after].some(content => content && content.includes(0)),
          before: before ? before.toString("utf8") : "", after: after ? after.toString("utf8") : "", blob: now });
      }
      return result;
    },
    /** Brings what the user changed in the folder since the copy last saw it into the copy, before the assistant
        works again: otherwise the assistant reads and edits a version the user has already replaced. A file the
        assistant has not changed takes the folder's version; one whose change still waits for review is merged
        with the folder's, and where the two overlap the turn stops - the user decides that review first.
        Returns the files brought over. */
    async refresh() {
      const listed = new Set();
      const add = out => out.split("\0").filter(Boolean).forEach(file => listed.add(file));
      // Changed in the folder against the starting commit, new in it, dirty when the copy was made, decided since.
      add(await git(top, ["diff", "--name-only", "-z", "--no-renames", head]));
      add(await git(top, ["ls-files", "--others", "--exclude-standard", "-z"]));
      add(await git(dir, ["diff", "--name-only", "-z", "--no-renames", head, baseline]));
      for (const file of bases.keys()) listed.add(file);
      const brought = [];
      for (const file of listed) {
        const folderNow = await blobIn(top, file, true), base = await baseBlob(file);
        if (folderNow === base) continue;
        const copyNow = await blobIn(dir, file);
        if (copyNow !== folderNow) {
          if (copyNow === base) write(dir, file, read(top, file));
          else {
            const joined = await merge(file, base);
            if (!joined) {
              throw new Error(file + " changed in your folder while the assistant's change to it still waits for review, "
                + "and the two overlap. Decide that review first, so the assistant works on your version.");
            }
            write(dir, file, joined);
          }
          brought.push(file);
        }
        bases.set(file, folderNow);
      }
      return brought;
    },
    /** Carries the assistant's version - merged with the folder's when both changed it - into the user's folder. */
    async apply(change) {
      if (change.conflict) throw new Error(change.file + ": your change and the assistant's overlap; it was not overwritten.");
      if ((await blobIn(top, change.file)) !== change.folderBlob) {
        throw new Error(change.file + " changed in your folder during the review; it was not overwritten.");
      }
      const content = change.status === "deleted" ? null : change.content;
      write(top, change.file, content);
      // A merged file goes into the copy too, so the assistant goes on from what the folder now holds.
      if (change.merged) write(dir, change.file, content);
      await settle(change);
    },
    /** Leaves the copy's version for the assistant to rework. Where it overlaps the user's own change the copy
        gets the folder's version, and the assistant redoes its change on top of it. */
    async keep(change) {
      if (change.conflict) write(dir, change.file, read(top, change.file));
      await settle(change);
    },
    /** Puts the user's version of FILE back into the copy. */
    async revert(change) {
      write(dir, change.file, read(top, change.file));
      await settle(change);
    },
    async remove() {
      await git(top, ["worktree", "remove", "--force", dir]).catch(() => {});
      await git(top, ["worktree", "prune"]).catch(() => {});
    }
  };
}

module.exports = { open, repositoryOf };
