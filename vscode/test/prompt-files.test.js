"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promptFile } = require("../prompt-files");

test("user prompt files can be read, replaced and reset independently", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "vertex-prompts-"));
  try {
    assert.equal((await promptFile("review", "read", "", home)).exists, false);
    await promptFile("review", "save", "My review", home);
    await promptFile("technical", "save", "My documentation", home);
    assert.equal((await promptFile("review", "read", "", home)).text, "My review");
    await promptFile("review", "reset", "", home);
    assert.equal((await promptFile("review", "read", "", home)).exists, false);
    assert.equal((await promptFile("technical", "read", "", home)).text, "My documentation");
    await assert.rejects(promptFile("../../outside", "save", "bad", home), /Unknown prompt kind/);
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});
