"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
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
  assert.match(found.content, /verified_vsix/);
});

test("high-confidence match selects skill without old prompts", async () => {
  const result = await skill.match(null, "пересобери", root, options(0.8));
  assert.equal(result.matched, true);
  assert.equal(result.skill.name, "build-vertex-vsix");
});

test("uncertain decision keeps normal conversation routing", async () => {
  const result = await skill.match(null, "пересобери", root, options(0.79));
  assert.equal(result.matched, false);
  assert.equal(result.skill, null);
});

test("missing skill leaves the request untouched", async () => {
  assert.equal((await skill.match(null, "пересобери", path.join(root, "no-such-folder"))).matched, false);
});
