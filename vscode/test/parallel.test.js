"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runParallel } = require("../parallel");

test("parallel runner preserves order and bounds concurrency", async () => {
  let active = 0; let peak = 0; const events = [];
  const result = await runParallel(
    [1, 2, 3, 4, 5].map(taskId => ({ taskId })),
    async job => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 2)); active--; return job.taskId * 2; },
    { maxParallel: 2, emit: event => events.push(event) }
  );
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
  assert.equal(events.filter(e => e.type === "task.finish").length, 5);
});
