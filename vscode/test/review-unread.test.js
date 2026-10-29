"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { carryUnread } = require("../review-live");

test("a rebuild takes a data element ADT cannot read from the saved review, without its verdicts", () => {
  const built = { OBJ_STATS: [{ OBJTYPE: "REPS", OBJ_NAME: "ZPROG" }], HUNKS: [{ HUNK_KEY: "REPS~ZPROG~1", OBJTYPE: "REPS", OBJ_NAME: "ZPROG" }],
    DIFF_DATA: [{ KEY: { OBJTYPE: "REPS", OBJNAME: "ZPROG" } }] };
  Object.defineProperty(built, "MISSING", { value: [{ object: "DTEL", name: "ZVX_ACTION", reason: "Request version for DTEL is not supported" },
    { object: "DTEL", name: "ZVX_OTHER", reason: "Request version for DTEL is not supported" }], enumerable: false });
  const saved = { OBJ_STATS: [{ OBJTYPE: "DTED", OBJ_NAME: "ZVX_ACTION" }], HUNKS: [{ HUNK_KEY: "DTED~ZVX_ACTION~1", OBJTYPE: "DTED", OBJ_NAME: "ZVX_ACTION" }],
    DIFF_DATA: [{ KEY: { OBJTYPE: "DTED", OBJNAME: "ZVX_ACTION" } }], HUNK_ACTIONS: [{ HUNK_KEY: "DTED~ZVX_ACTION~1", ACTION: "A" }] };
  const payload = carryUnread(built, saved);
  assert.deepStrictEqual(payload.OBJ_STATS.map(s => s.OBJ_NAME), ["ZPROG", "ZVX_ACTION"]);
  assert.deepStrictEqual(payload.HUNKS.map(h => h.HUNK_KEY), ["REPS~ZPROG~1", "DTED~ZVX_ACTION~1"]);
  assert.strictEqual(payload.DIFF_DATA.length, 2);
  assert.strictEqual(payload.HUNK_ACTIONS, undefined, "a rebuild drops verdicts");
  assert.deepStrictEqual(payload.MISSING.map(m => m.name), ["ZVX_OTHER"], "only what the saved review lacks stays unreviewed");
  assert.strictEqual(built.OBJ_STATS.length, 1, "the build itself is left as it was");
});
