"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { diffLines } = require("../line-diff");

// The longest common subsequence by the textbook table, to check that the diff is a shortest one.
function lcs(a, b) {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
    }
  }
  return t[a.length][b.length];
}

function check(a, b) {
  const ops = diffLines(a, b);
  assert.deepStrictEqual(ops.filter(o => o.op !== "+").map(o => o.text), a, "old side");
  assert.deepStrictEqual(ops.filter(o => o.op !== "-").map(o => o.text), b, "new side");
  assert.strictEqual(ops.filter(o => o.op === "=").length, lcs(a, b), "shortest");
  for (let i = 1; i < ops.length; i++) {
    assert.ok(!(ops[i - 1].op === "+" && ops[i].op === "-"), "old lines first in a run");
  }
}

test("edge cases", () => {
  check([], []);
  check([], ["a"]);
  check(["a"], []);
  check(["a", "b"], ["a", "b"]);
  check(["a"], ["b"]);
  check(["a", "b", "c"], ["x", "y"]);
});

test("random pairs are exact and shortest", () => {
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let round = 0; round < 3000; round++) {
    const alphabet = 2 + rnd(5);
    const a = Array.from({ length: rnd(25) }, () => "l" + rnd(alphabet));
    const b = rnd(2) ? Array.from({ length: rnd(25) }, () => "l" + rnd(alphabet)) : a.filter(() => rnd(4)).concat(["l" + rnd(alphabet)]);
    check(a, b);
  }
});

test("a key compares lines without case and indentation", () => {
  const ops = diffLines(["  IF x.", "a"], ["if X.", "b"], l => l.trim().toUpperCase());
  assert.deepStrictEqual(ops.map(o => o.op), ["=", "-", "+"]);
  assert.strictEqual(ops[0].text, "if X.");
});

test("large sources stay fast", () => {
  const a = Array.from({ length: 20000 }, (_, i) => "line " + i);
  const b = a.slice();
  for (let i = 0; i < 200; i++) { b[i * 97] = "changed " + i; }
  const started = Date.now();
  const ops = diffLines(a, b);
  assert.strictEqual(ops.filter(o => o.op === "-").length, 200);
  assert.ok(Date.now() - started < 1000, "took " + (Date.now() - started) + " ms");
});
