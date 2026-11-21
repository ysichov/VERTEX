"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const skill = require("../skill-match");

const root = path.resolve(__dirname, "../..");
const audit = { decision() {}, finish() {}, fail() {}, callbacks: {} };
const options = answer => ({ connection: { provider: "typesafe-api", key: "test", model: "jev-latest" }, begin: () => audit,
  evaluate: async (_provider, _key, _model, state) => {
    assert.equal(state.currentRequest, "пересобери");
    assert.equal(Object.hasOwn(state, "history"), false);
    assert.equal(JSON.stringify(state).includes("Verified VSIX:"), false);
    return { answers: { match_0: { type: "noul", noul: answer } }, usage: { input_tokens: 30 } };
  } });

test("repository skill loads Markdown procedure", () => {
  const available = skill.discover(root);
  assert.equal(available.length, 1);
  assert.equal(available[0].name, "build-vertex-vsix");
  const found = skill.load(available[0], root);
  assert.match(found.content, /Verified VSIX/);
});

test("high-confidence match selects skill without old prompts", async () => {
  const result = await skill.match(null, "пересобери", root, options(0.8));
  assert.equal(result.matched, true);
  assert.equal(result.skill.name, "build-vertex-vsix");
});

test("Jev returns the VSIX version branch with the skill match", async () => {
  const result = await skill.match(null, "VSIX +1", root, { connection: { provider: "typesafe-api", key: "test", model: "jev-latest" }, begin: () => audit,
    evaluate: async (_provider, _key, _model, state, questions) => {
      assert.equal(state.currentRequest, "VSIX +1");
      assert.deepEqual(Object.keys(questions.vsix_version.criteria), ["current", "increment"]);
      return { answers: { match_0: { noul: 0.95 }, vsix_version: { choice: "increment" } }, usage: {} };
    } });
  assert.equal(result.matched, true);
  assert.equal(result.versionChoice, "increment");
});

test("uncertain decision keeps normal conversation routing", async () => {
  const result = await skill.match(null, "пересобери", root, options(0.79));
  assert.equal(result.matched, false);
  assert.equal(result.skill, null);
});

test("a repeat request gives skill matching the routed topic", async () => {
  const result = await skill.match(null, "еще раз", root, {
    connection: { provider: "typesafe-api", key: "test", model: "jev-latest" }, begin: () => audit,
    topic: { id: "topic_0001", label: "Build VSIX" },
    evaluate: async (_provider, _key, _model, state) => {
      assert.equal(state.currentRequest, "еще раз");
      assert.equal(state.activeTopic, "Build VSIX");
      assert.equal(Object.hasOwn(state, "history"), false);
      return { answers: { match_0: { type: "noul", noul: 0.9 } }, usage: {} };
    }
  });
  assert.equal(result.skill.name, "build-vertex-vsix");
});

test("missing skill leaves the request untouched", async () => {
  assert.equal((await skill.match(null, "пересобери", path.join(root, "no-such-folder"))).matched, false);
});

test("another Git project never runs Jev skill matching", async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-other-skill-"));
  try {
    execFileSync("git", ["init", "-q", other]);
    execFileSync("git", ["-C", other, "remote", "add", "origin", "https://github.com/example/other.git"]);
    const skills = path.join(other, ".agents", "skills", "build-vertex-vsix");
    fs.mkdirSync(skills, { recursive: true });
    fs.copyFileSync(path.join(root, ".agents", "skills", "build-vertex-vsix", "SKILL.md"), path.join(skills, "SKILL.md"));
    assert.equal(await skill.isVertexRepository(other), false);
    const result = await skill.match(null, "пересобери", other, { evaluate: () => { throw new Error("Jev must not run"); } });
    assert.equal(result.status, "unavailable");
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
});
