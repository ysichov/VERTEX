"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { hits } = require("../local-watchpoint");

test("a watched component stops only when that component changes", () => {
  const point = [{ id: "W", name: "LS_VAR-COUNT" }];
  const first = { changed: { LS_VAR: { count: 1, label: "A" } } };
  const otherField = { changed: { LS_VAR: { count: 1, label: "B" } } };
  const count = { changed: { LS_VAR: { count: 2, label: "B" } } };
  assert.equal(hits(otherField, [first], point).length, 0);
  assert.equal(hits(count, [first, otherField], point)[0].id, "W");
});

test("a conditional watchpoint stops only when the new value reaches its target", () => {
  const point = [{ id: "W", name: "LS_VAR-COUNT", condition: "LS_VAR-COUNT >= 10" }];
  const before = { changed: { LS_VAR: { count: 8 } } };
  const below = { changed: { LS_VAR: { count: 9 } } };
  const reached = { changed: { LS_VAR: { count: 10 } } };
  assert.equal(hits(below, [before], point).length, 0);
  assert.equal(hits(reached, [before, below], point)[0].id, "W");
});
