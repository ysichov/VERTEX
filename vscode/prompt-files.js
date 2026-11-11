"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const names = Object.freeze({ review: "code-review.txt", technical: "technical-documentation.txt",
  "git-review": "git-review.txt", "git-business": "git-business-review.txt", "git-docs": "git-technical-documentation.txt",
  "git-tests": "git-test-plan.txt", "git-release": "git-release-notes.txt", "git-commit": "git-commit-message.txt",
  "git-pr": "git-pull-request.txt" });

async function promptFile(kind, operation, content = "", home = os.homedir()) {
  if (!Object.hasOwn(names, kind)) throw new Error("Unknown prompt kind.");
  if (!["read", "save", "reset"].includes(operation)) throw new Error("Unknown prompt operation.");
  const file = path.join(home, ".vertex", "prompts", names[kind]);
  if (operation === "save") {
    if (typeof content !== "string" || !content.trim() || content.length > 65536) throw new Error("Prompt must contain 1 to 65536 characters.");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
  } else if (operation === "reset") {
    try { await fs.unlink(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  try { return { kind, path: file, exists: true, text: await fs.readFile(file, "utf8") }; }
  catch (error) { if (error.code === "ENOENT") return { kind, path: file, exists: false, text: "" }; throw error; }
}

module.exports = { promptFile };
