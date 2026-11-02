"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { decodeVlq, encodeVlq } = require("../source-map-vlq");

test("source map VLQ reads and writes the numbers of a mapping segment", () => {
  assert.deepEqual(decodeVlq("AAgBC"), [0, 0, 16, 1]);
  assert.deepEqual(decodeVlq("D"), [-1]);
  assert.equal(encodeVlq([0, 0, 16, 1]), "AAgBC");
  for (const values of [[0], [-1, 1], [15, -16, 1024, -123456]]) assert.deepEqual(decodeVlq(encodeVlq(values)), values);
  assert.throws(() => decodeVlq("A!"), /Invalid source map mapping/);
});
