"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createGate } = require("../request-gate");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("requests go one after another, and an error of one does not stop the next", async () => {
  const gate = createGate({ delay: 1 }), order = [];
  const first = gate.gated(async () => { order.push("a start"); await wait(10); order.push("a end"); return 1; });
  const second = gate.gated(async () => { order.push("b"); throw new Error("no"); });
  const third = gate.gated(async () => { order.push("c"); return 3; });
  assert.equal(await first, 1);
  await assert.rejects(second, /no/);
  assert.equal(await third, 3);
  assert.deepEqual(order, ["a start", "a end", "b", "c"]);
});

test("a session that is busy with something else is waited for, a few times, then reported", async () => {
  const gate = createGate({ retries: 3, delay: 1 });
  let calls = 0;
  assert.equal(await gate.gated(async () => { if (++calls < 3) { throw new Error("SAP session is busy. Use separate sessions."); } return "done"; }), "done");
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(gate.gated(async () => { calls++; throw new Error("SAP session is busy."); }), /busy/);
  assert.equal(calls, 4, "the first try and three more");
  calls = 0;
  await assert.rejects(gate.gated(async () => { calls++; throw new Error("not found"); }), /not found/);
  assert.equal(calls, 1, "any other error at once");
});

test("of a request made again and again only the newest is read while an older one waits", async () => {
  const gate = createGate({ delay: 1 }), read = [];
  const variables = gate.newest(async request => { read.push(request); await wait(5); return { read: request }; });
  const running = variables("one");
  await wait(2);
  const answers = [running, variables("two"), variables("three"), variables("four")];
  const results = await Promise.all(answers);
  assert.deepEqual(read, ["one", "four"], "the first was already running; of those waiting only the last is read");
  assert.deepEqual(results.map(r => r.superseded === true), [false, true, true, false]);
});
