"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const api = require("../openai-compatible"), config = require("../model-config"), profiles = require("../key-profiles");

test("TypeSafe uses the native models response and stays outside chat providers", async () => {
  const list = await api.models("typesafe-api", "synthetic-key", async (id, key, route) => {
    assert.equal(id, "typesafe-api"); assert.equal(route, "/models");
    return { models: [{ name: "jev-latest", description: "Current decision model" }, { name: "jev-preview", description: "Preview" }] };
  });
  assert.deepEqual(list.map(m => m.id), ["jev-latest", "jev-preview"]);
  assert.ok(list.every(m => m.modelKind === "decision"));
  assert.equal(api.PROVIDERS["typesafe-api"].base, "https://api.typesafe.ai/v1");
  assert.ok(config.PROVIDERS.some(p => p.id === "typesafe-api"));
  const vscode = { workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback }) } };
  assert.ok(!config.offered(vscode).some(p => p.id === "typesafe-api"));
  await assert.rejects(api.ask({ assistant: "typesafe-api", model: "jev-latest" }), /decision model/);
  await assert.rejects(api.models("typesafe-api", "key", async () => ({ models: [] })), /no decision models/);
});

test("TypeSafe synthetic check uses only its System One route and validates the answer", async () => {
  let calls = 0, recorded;
  await api.probe("typesafe-api", "synthetic-key", "jev-latest", async (id, key, route, body) => {
    calls++; assert.equal(id, "typesafe-api"); assert.equal(route, "/systemone"); assert.equal(body.model, "jev-latest");
    assert.equal(body.questions.passed.type, "noul");
    return { answers: { passed: { type: "noul", noul: 0.98 } }, usage: { input_tokens: 35, output_tokens: 0 } };
  }, { onModelCall: value => { recorded = value; } });
  assert.equal(calls, 1); assert.equal(recorded.usage.input_tokens, 35); assert.equal(recorded.usage.cost_usd, undefined);
  await assert.rejects(api.probe("typesafe-api", "key", "jev-latest", async () => ({ answers: {} })), /TypeSafe Jev returned no valid/);
});

test("TypeSafe API keys use independent named SecretStorage profiles", async () => {
  const storage = new Map(), secrets = { get: async key => storage.get(key), store: async (key, value) => { storage.set(key, value); } };
  await profiles.save(secrets, "typesafe-api", "TEST", "synthetic-key");
  assert.deepEqual(await profiles.getActiveKey(secrets, "typesafe-api"), { name: "TEST", key: "synthetic-key" });
  assert.ok([...storage.keys()].every(key => key.startsWith("vertex.provider.typesafe-api.")));
});
