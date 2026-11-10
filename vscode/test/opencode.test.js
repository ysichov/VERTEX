"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const api = require("../openai-compatible"), config = require("../model-config");
const { groupModels } = require("../model-capabilities");

test("OpenCode live catalog shape treats chat as language and uses zero prices for Free", () => {
  const { decorate } = require("../opencode-models");
  const free = decorate({ id: "big-pickle", type: "chat", cost: { text: { input: { price: 0, cache: { read: 0, write: 0 } }, output: { price: 0 } } }, limit: { context: 200000 } });
  assert.equal(free.modelKind, "language"); assert.equal(free.free, true); assert.equal(free.contextWindow, 200000);
  const paid = decorate({ id: "not-really-free", type: "chat", canonical_id: "anthropic/example", cost: { text: { input: { price: 1 }, output: { price: 5 } } }, capabilities: { tools: { supported: true }, structured_output: true }, modalities: { input: ["text", "image/png"] } });
  assert.equal(paid.free, false); assert.equal(paid.modelProvider, "anthropic"); assert.equal(paid.pricing.input, 0.000001);
  assert.equal(paid.capabilities.tools, true); assert.equal(paid.capabilities.vision, true);
  const tiered = decorate({ id: "tiered-free", cost: { text: { input: { price: 0, overrides: [{ when: { context: { gt: 1000 } }, price: 1 }] }, output: { price: 0 } } } });
  assert.equal(tiered.free, false);
  assert.equal(decorate({ id: "unknown" }).free, false);
  assert.doesNotThrow(() => decorate({ id: "partial", cost: { text: { output: { price: 1 } } } }));
});

test("OpenCode does not invent Jev when the live catalog only lists chat models", async () => {
  const models = await api.models("opencode-api", "synthetic-key", async () => ({ data: [{ id: "big-pickle", type: "chat" }] }));
  assert.deepEqual(models.map(m => m.id), ["big-pickle"]);
  const vscode = { workspace: { getConfiguration: () => ({ get: () => ({ "opencode-api": { enabled: ["big-pickle"], known: ["big-pickle"] } }) }) } };
  assert.equal(config.apply(vscode, "opencode-api", models)[0].id, "big-pickle");
});

test("OpenCode HTTP routes keep its credential on the OpenCode origin", async t => {
  const { EventEmitter } = require("node:events");
  const seen = [];
  t.mock.method(require("node:https"), "request", (url, options, ready) => {
    seen.push({ url: String(url), auth: options.headers.authorization });
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.end = () => {
      const response = new EventEmitter(); response.statusCode = 200; response.setEncoding = () => {};
      ready(response); response.emit("data", "{}"); response.emit("end");
    };
    return request;
  });
  for (const route of ["/models", "/chat/completions", "/systemone/v1/systemone"]) await api.requestJson("opencode-api", "synthetic-key", route);
  assert.deepEqual(seen.map(s => s.url), ["https://opencode.ai/inference/v1/models", "https://opencode.ai/inference/openai/v1/chat/completions", "https://opencode.ai/inference/systemone/v1/systemone"]);
  assert.ok(seen.every(s => s.auth === "Bearer synthetic-key"));
});

test("OpenCode discovery preserves wire IDs and groups Jev separately from chat models", async () => {
  const seen = [];
  const models = await api.models("opencode-api", "synthetic-key", async (...args) => {
    seen.push(args);
    return { data: [{ id: "jev-1.13-free", owned_by: "opencode" }, { id: "gpt-6-sol", owned_by: "opencode" },
      { id: "claude-fable-5", owned_by: "opencode" }, { id: "custom-model", owned_by: "custom-maker" }, { id: "qwen3.8-flash" }] };
  });
  assert.deepEqual(seen, [["opencode-api", "synthetic-key", "/models"]]);
  assert.equal(models.find(m => m.id === "jev-1.13-free").modelKind, "decision");
  assert.equal(models.find(m => m.id === "jev-1.13-free").free, true);
  assert.ok(models.find(m => m.id === "jev-1.13-free").label.includes("Decision API"));
  assert.equal(models.find(m => m.id === "gpt-6-sol").pricing, undefined);
  const groups = groupModels(models, undefined, false, false);
  assert.equal(groups.find(g => g.id === "typesafe").label, "TypeSafe AI");
  assert.deepEqual(groups.find(g => g.id === "openai").models.map(m => m.id), ["gpt-6-sol"]);
  assert.ok(groups.some(g => g.id === "custom-maker"));
  assert.equal(api.PROVIDERS["opencode-api"].base, "https://opencode.ai/inference");
  assert.equal(api.PROVIDERS["opencode-api"].routes["/models"], "/v1/models");
  assert.equal(api.PROVIDERS["opencode-api"].routes["/chat/completions"], "/openai/v1/chat/completions");
});

test("OpenCode Jev probe uses System One, validates probabilities and records reported usage", async () => {
  let called, usage;
  const result = await api.probe("opencode-api", "synthetic-key", "jev-1.13-free", async (...args) => {
    called = args;
    return { model: "jev-1.13", answers: { passed: { type: "noul", noul: 0.99 } }, usage: { input_tokens: 40, output_tokens: 2, cost: 0 } };
  }, { onModelCall: call => { usage = call.usage; } });
  assert.equal(called[2], "/systemone/v1/systemone");
  assert.equal(called[3].questions.passed.type, "noul");
  assert.equal(called[3].messages, undefined);
  assert.equal(result.model, "jev-1.13");
  assert.equal(usage.cost_usd, 0);
  assert.equal(usage.input_tokens, 40);
  await assert.rejects(api.probe("opencode-api", "key", "jev-1.13", async () => ({ answers: { passed: { noul: 2 } } })), /valid Jev decision probability/);
  await assert.rejects(api.probe("opencode-api", "key", "jev-1.13", async () => ({ choices: [{ message: { content: "OK" } }] })), /valid Jev decision probability/);
});

test("OpenCode Jev errors stay scoped to OpenCode without fallback or a chat request", async () => {
  let calls = 0;
  await assert.rejects(api.probe("opencode-api", "key", "jev-1.13-free", async (id, key, route) => {
    calls++; assert.equal(id, "opencode-api"); assert.equal(route, "/systemone/v1/systemone");
    throw Object.assign(new Error("Free tier can only be used from within OpenCode"), { status: 403 });
  }), /Free tier/);
  assert.equal(calls, 1);
  await assert.rejects(api.ask({ assistant: "opencode-api", model: "jev-1.13-free", request() { throw new Error("must not send"); } }), /decision model/);
});

test("OpenCode chat model selection excludes decision models while the settings retain them", async () => {
  const models = await api.models("opencode-api", "key", async () => ({ data: [{ id: "jev-1.13" }, { id: "gpt-6-sol" }] }));
  const vscode = { workspace: { getConfiguration: () => ({ get: (_, fallback) => ({ "opencode-api": { enabled: models.map(m => m.id), known: models.map(m => m.id) } }) }) } };
  assert.equal(config.rows(models, config.read(vscode, "opencode-api"), "opencode-api").length, 2);
  assert.deepEqual(config.apply(vscode, "opencode-api", models).map(m => m.id), ["gpt-6-sol"]);
  assert.equal(config.PROVIDERS.filter(p => p.id === "opencode-api").length, 1);
  const index = config.PROVIDERS.findIndex(p => p.id === "openrouter-api");
  assert.equal(config.PROVIDERS[index + 1].id, "opencode-api");
});

test("OpenCode normal chat uses the compatible transport and retains actual cost", async () => {
  const calls = [];
  let reported;
  const result = await api.ask({ assistant: "opencode-api", apiKey: "synthetic-key", model: "gpt-6-sol", tools: [], textOnly: true,
    instructions: "Synthetic connectivity test.", prompt: "Hello", schema: {}, capabilities: { tools: false },
    onModelCall: call => { reported = call; },
    request: async (...args) => {
      calls.push(args);
      return { model: "gpt-6-sol", choices: [{ message: { content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001 } };
    } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "opencode-api"); assert.equal(calls[0][2], "/chat/completions");
  assert.equal(result.plan.answer, "Hello"); assert.equal(reported.usage.cost_usd, 0.0001);
});

test("OpenCode group checks use maker metadata and the Free filter", async t => {
  let receive;
  const posts = [], calls = [];
  t.mock.method(require("../model-detection"), "probe", async (_, __, id, model) => { calls.push([id, model]); });
  const own = {};
  const vscode = { ViewColumn: { Active: 1 }, ConfigurationTarget: { Global: 1 },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => own[key] ?? fallback, update: async (key, value) => { own[key] = value; } }) },
    window: { createWebviewPanel: () => ({ onDidDispose() {}, webview: { postMessage: message => posts.push(message), onDidReceiveMessage: fn => { receive = fn; } } }) } };
  const rows = [{ id: "jev-1.13-free", label: "Jev Free", modelProvider: "typesafe", free: true },
    { id: "jev-1.13", label: "Jev", modelProvider: "typesafe", free: false },
    { id: "gpt-6-sol", label: "GPT", modelProvider: "openai", free: true }];
  config.open(vscode, async () => rows, () => "", () => {}, { get: async () => "", store: async () => {} });
  await receive({ action: "detect", provider: "opencode-api", group: "typesafe", filter: "free" });
  assert.deepEqual(calls, [["opencode-api", "jev-1.13-free"]]);
  assert.equal(posts.at(-1).detection.results[0].filtered, true);
});
