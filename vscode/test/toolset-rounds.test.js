"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("an OpenAI-compatible request offers tools added during the request from the next step", async () => {
  const compatible = require("../openai-compatible");
  const id = Object.keys(compatible.PROVIDERS).find(key => key !== "vercel-api" && key !== "openrouter-api");
  const tools = [{ name: "enable_toolset", description: "enable", inputSchema: { type: "object", properties: {} } }];
  const offered = [];
  let step = 0;
  const request = async (_id, _key, _route, body) => {
    offered.push(body.tools.map(tool => tool.function.name));
    step += 1;
    const call = step === 1 ? { name: "enable_toolset", arguments: "{}" }
      : step === 2 ? { name: "abap_objects_generator_list", arguments: "{}" }
      : { name: "submit_vertex_answer", arguments: JSON.stringify({ answer: "done", navigation: null }) };
    return { model: "m", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c" + step, type: "function", function: call }] } }] };
  };
  const ran = [];
  const result = await compatible.ask({ assistant: id, model: "m", apiKey: "k", prompt: "make a RAP service", instructions: "i",
    schema: { type: "object" }, tools, request, maxRounds: 5,
    callTool: async name => {
      ran.push(name);
      if (name === "enable_toolset") tools.push({ name: "abap_objects_generator_list", description: "gen", inputSchema: { type: "object", properties: {} } });
      return { ok: true };
    } });
  assert.equal(result.plan.answer, "done");
  assert.deepEqual(ran, ["enable_toolset", "abap_objects_generator_list"]);
  assert.deepEqual(offered[0], ["enable_toolset", "submit_vertex_answer"]);
  assert.deepEqual(offered[1], ["enable_toolset", "abap_objects_generator_list", "submit_vertex_answer"]);
});

test("the Anthropic request offers tools added during the request from the next step", async () => {
  const anthropic = require("../anthropic");
  assert.match(require("node:fs").readFileSync(require.resolve("../anthropic"), "utf8"), /apiTools = toolsNow\(\);\r?\n    const response = await request\(/,
    "the tool list is rebuilt at the start of every step");
  assert.equal(typeof anthropic.ask, "function");
});

test("the request limit counts the conversation, not the tool definitions", async () => {
  const compatible = require("../openai-compatible");
  const id = Object.keys(compatible.PROVIDERS).find(key => key !== "vercel-api" && key !== "openrouter-api");
  const big = { type: "object", properties: { note: { type: "string", description: "x".repeat(100000) } } };
  const tools = [{ name: "abap_big", description: "big", inputSchema: big }];
  let limit = 0, sent = 0;
  const request = async (_id, _key, _route, body, maxBytes) => {
    limit = maxBytes; sent = Buffer.byteLength(JSON.stringify(body), "utf8");
    return { model: "m", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function",
      function: { name: "submit_vertex_answer", arguments: JSON.stringify({ answer: "ok", navigation: null }) } }] } }] };
  };
  await compatible.ask({ assistant: id, model: "m", apiKey: "k", prompt: "q", instructions: "i", schema: { type: "object" }, tools, request, callTool: async () => ({}) });
  assert.ok(sent > 100000, "the request carries the large tool definitions");
  assert.ok(limit >= sent, "and still fits the limit: " + limit + " >= " + sent);
  assert.ok(limit - Buffer.byteLength(JSON.stringify(tools), "utf8") < 140000, "the conversation keeps its own 128 KB");
});
