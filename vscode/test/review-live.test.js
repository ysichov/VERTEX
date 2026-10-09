"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { build, pairOf } = require("../review-live");

const FEED = [
  { id: "00000", uri: "/p/0", author: "DEV", transport: "" },
  { id: "00003", uri: "/p/3", author: "DEV", transport: "K2" },
  { id: "00002", uri: "/p/2", author: "DEV", transport: "K1T" },
  { id: "00001", uri: "/p/1", author: "OLD", transport: "K0" }];

test("the pair follows AVE: the request's newest version, the active one when it is the request's and nothing foreign is above", () => {
  const released = pairOf(FEED, new Set(["K1", "K1T"]));
  assert.deepStrictEqual([released.old.id, released.fresh.id], ["00001", "00002"]);
  const later = pairOf(FEED, new Set(["K2"]));
  assert.deepStrictEqual([later.old.id, later.fresh.id], ["00002", "00003"]);
  const open = pairOf([{ id: "00000", uri: "/p/0", author: "DEV", transport: "K2" }, ...FEED.slice(1)], new Set(["K2"]));
  assert.deepStrictEqual([open.old.id, open.fresh.id], ["00002", "00000"]);
  // The active state of another request above the request's own version is not the request's (E19K907280 on E19).
  const history = pairOf([{ id: "00000", uri: "/p/0", author: "DEV", transport: "K7" }, ...FEED.slice(1)], new Set(["K1T"]));
  assert.deepStrictEqual([history.old.id, history.fresh.id], ["00001", "00002"]);
  const none = pairOf(FEED, new Set(["K9"]));
  assert.deepStrictEqual([none.old.id, none.fresh.id], ["00003", "00000"]);
  const created = pairOf([{ id: "00001", uri: "/n/1", author: "DEV", transport: "K5" }], new Set(["K5"]));
  assert.deepStrictEqual([created.old, created.fresh.id], [null, "00001"]);
});

test("a request's program is reviewed as the diff of its pair, cut into blocks, with its author named", async () => {
  const sources = { "/p/1": "a.\nb.\n", "/p/2": "a.\nx.\nb.\ny.\n" };
  const api = {
    query: async sql => {
      if (/FROM e070 WHERE trkorr/.test(sql)) { return { values: [{ TRKORR: "K1", TRSTATUS: "R" }] }; }
      if (/FROM e070 WHERE strkorr/.test(sql)) { return { values: [{ TRKORR: "K1T" }] }; }
      if (/FROM e071/.test(sql)) { return { values: [{ PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZPROG" }] }; }
      if (/FROM usr21/.test(sql)) { return { values: [{ BNAME: "DEV", NAME_TEXT: "Dev One" }] }; }
      return { values: [] };
    },
    revisions: async () => FEED,
    revisionSource: async uri => sources[uri]
  };
  const payload = await build(api, "K1");
  assert.deepStrictEqual(payload.OBJ_STATS.map(s => [s.OBJTYPE, s.OBJ_NAME, s.VERSNO_OLD, s.VERSNO_NEW, s.INS_COUNT, s.HUNK_COUNT, s.AUTHOR_NAME]),
    [["REPS", "ZPROG", "00001", "00002", 2, 2, "Dev One"]]);
  assert.deepStrictEqual(payload.HUNKS.map(h => [h.HUNK_KEY, h.START_LINE, h.CHANGE_KIND]),
    [["REPS~ZPROG~1", 2, "added"], ["REPS~ZPROG~2", 4, "added"]]);
});
