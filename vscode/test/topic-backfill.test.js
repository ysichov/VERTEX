"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function load(answersFor) {
  const calls = [], audits = [];
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "./review-jev") return { connection: async () => ({ key: "k", model: "m" }) };
    if (request === "./ai-accounting") return { begin: (...args) => { audits.push(args[4]); return { callbacks: {}, decision() {}, finish() {}, fail() {} }; } };
    if (request === "./jev") return { evaluate: async (provider, key, model, state, questions) => { calls.push({ state, questions }); return { answers: answersFor(questions), usage: {} }; } };
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve("../topic-backfill.js")];
  const backfill = require("../topic-backfill.js");
  return { backfill, calls, audits, restore: () => { Module._load = original; } };
}

test("untagged questions get topics: new, previous, an existing one; unclear stays untagged", async () => {
  const choices = { topic_of_2: "new", topic_of_3: "previous", topic_of_4: "topic_0001", topic_of_5: "clarify" };
  const { backfill, calls, restore } = load(questions => Object.fromEntries(Object.keys(questions).map(name => [name, { choice: choices[name] }])));
  const scope = "sap:A4H";
  const prompts = [
    { key: "f:0", text: "Explain ZCL_A", topic: { id: "topic_0001", label: "ZCL_A", scope } },
    { key: "f:1", text: "Why does Z_REPORT dump?" },
    { key: "f:2", text: "and now?" },
    { key: "f:3", text: "More on ZCL_A" },
    { key: "f:4", text: "hm" }];
  const { tags, report } = await backfill.tag({}, prompts, scope).finally(restore);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].questions), ["topic_of_2", "topic_of_3", "topic_of_4", "topic_of_5"]);
  assert.equal(tags["f:1"].id, "topic_0002");
  assert.equal(tags["f:2"].id, "topic_0002");
  assert.equal(tags["f:3"].id, "topic_0001");
  assert.equal(tags["f:4"], undefined);
  assert.equal(report.tagged, 3); assert.equal(report.unclear, 1);
});

test("a long conversation goes in several bounded batches", async () => {
  const { backfill, calls, restore } = load(questions => Object.fromEntries(Object.keys(questions).map(name => [name, { choice: "clarify" }])));
  const prompts = Array.from({ length: 70 }, (_, i) => ({ key: "f:" + i, text: "Question " + i + " " + "x".repeat(500), answer: "y".repeat(300) }));
  const { report } = await backfill.tag({}, prompts, "sap:A4H").finally(restore);
  assert.ok(calls.length > 1);
  assert.equal(report.batches, calls.length);
  assert.equal(report.unclear, 70);
  for (const call of calls) assert.ok(Buffer.byteLength(JSON.stringify({ model: "m", state: call.state, questions: call.questions })) <= 24000);
});

test("tagging an old conversation accounts against the selected conversation, not the currently open chat",async()=>{
 const {backfill,audits,restore}=load(questions=>Object.fromEntries(Object.keys(questions).map(key=>[key,{choice:'new'}])));
 await backfill.tag({},[{key:'old:0',text:'old question'}],'folder:test',{conversation:'selected-old-conversation'}).finally(restore);
 assert.equal(audits[0].relatedConversation,'selected-old-conversation');
});
