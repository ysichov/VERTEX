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
  const released = pairOf(FEED, new Set(["K1", "K1T"]), true);
  assert.deepStrictEqual([released.old.id, released.fresh.id], ["00001", "00002"]);
  const later = pairOf(FEED, new Set(["K2"]), true);
  assert.deepStrictEqual([later.old.id, later.fresh.id], ["00002", "00003"]);
  const open = pairOf([{ id: "00000", uri: "/p/0", author: "DEV", transport: "K2" }, ...FEED.slice(1)], new Set(["K2"]), true);
  assert.deepStrictEqual([open.old.id, open.fresh.id], ["00002", "00000"]);
  // The active state of another request above the request's own version is not the request's (E19K907280 on E19).
  const history = pairOf([{ id: "00000", uri: "/p/0", author: "DEV", transport: "K7" }, ...FEED.slice(1)], new Set(["K1T"]), true);
  assert.deepStrictEqual([history.old.id, history.fresh.id], ["00001", "00002"]);
  const none = pairOf(FEED, new Set(["K9"]), true);
  assert.deepStrictEqual([none.old.id, none.fresh.id], ["00003", "00000"]);
  // A released request with no version of a part does not claim the active state - it holds another request's work.
  assert.strictEqual(pairOf(FEED, new Set(["K9"]), false), null);
  // The request's own ToCs are skipped for the old side: the base is the version before the request (a class CCIMP).
  const copied = pairOf([{ id: "00000", uri: "/c/0", author: "DEV", transport: "K3" },
    { id: "00003", uri: "/c/3", author: "DEV", transport: "T2" }, { id: "00002", uri: "/c/2", author: "DEV", transport: "T1" },
    { id: "00001", uri: "/c/1", author: "OLD", transport: "K0" }], new Set(["K3", "T1", "T2"]), true);
  assert.deepStrictEqual([copied.old.id, copied.fresh.id], ["00001", "00000"]);
  assert.ok(require("../review-live").generated({ fresh: { author: "SAP" } }));
  assert.ok(!require("../review-live").generated({ fresh: { author: "DEV" } }));
  const created = pairOf([{ id: "00001", uri: "/n/1", author: "DEV", transport: "K5" }], new Set(["K5"]), true);
  assert.deepStrictEqual([created.old, created.fresh.id], [null, "00001"]);
});

test("a request's program is reviewed as the diff of its pair, cut into blocks, with its author named", async () => {
  const sources = { "/p/1": "a.\nb.\n", "/p/2": "a.\nx.\nb.\ny.\n" };
  const api = {
    query: async sql => {
      if (/FROM e070 WHERE trkorr/.test(sql)) { return { values: [{ TRKORR: "K1", TRSTATUS: "R" }] }; }
      if (/FROM e070 WHERE strkorr/.test(sql)) { return { values: [{ TRKORR: "K1T" }] }; }
      if (/object = 'MERG'/.test(sql)) { return { values: [] }; }
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

test("blame credits each line to the developer whose task it came from, a transport of copies included", async () => {
  // v1 before the request; v2 a ToC of K3 copied by COPIER; the active state under K3's task K3B.
  const feed = [
    { id: "00000", uri: "/b/0", author: "ACTIVATOR", transport: "K3B", time: "2026-10-06T10:00:00Z" },
    { id: "00002", uri: "/b/2", author: "COPIER", transport: "T1", time: "2026-10-02T10:00:00Z" },
    { id: "00001", uri: "/b/1", author: "OLD", transport: "K0", time: "2026-01-01T10:00:00Z" }];
  const sources = { "/b/0": "a.\nb.\nc.\n", "/b/2": "a.\nb.\n", "/b/1": "a.\n" };
  const heads = { K3: { TRKORR: "K3", TRSTATUS: "D", TRFUNCTION: "K" }, T1: { TRKORR: "T1", TRFUNCTION: "T" },
    K3B: { TRKORR: "K3B", TRFUNCTION: "S", AS4USER: "DEVB" }, K0: { TRKORR: "K0", TRFUNCTION: "K" } };
  const api = {
    query: async sql => {
      const t = (/WHERE trkorr = '([^']+)'/.exec(sql) || [])[1];
      if (/object = 'MERG' AND obj_name LIKE/.test(sql)) { return { values: [{ TRKORR: "T1", OBJ_NAME: "K3" }] }; }
      if (/object = 'MERG'/.test(sql)) { return { values: t === "T1" ? [{ OBJ_NAME: "K3" }] : [] }; }
      if (/INNER JOIN e071/.test(sql)) {
        return { values: /strkorr = 'K3'/.test(sql) ? [{ TRKORR: "K3A", AS4USER: "DEVA", AS4DATE: "20261001", AS4TIME: "090000" },
          { TRKORR: "K3B", AS4USER: "DEVB", AS4DATE: "20261005", AS4TIME: "090000" }] : [] };
      }
      if (/FROM e070 WHERE trkorr/.test(sql)) { return { values: heads[t] ? [heads[t]] : [] }; }
      if (/FROM e070 WHERE strkorr/.test(sql)) { return { values: [{ TRKORR: "K3A" }, { TRKORR: "K3B" }] }; }
      if (/FROM e071/.test(sql)) { return { values: [{ PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZBLAME" }] }; }
      return { values: [] };
    },
    revisions: async () => feed,
    revisionSource: async uri => sources[uri]
  };
  // Off by default: no blame is read, and every block is the NEW version's author's.
  const plain = await build(api, "K3");
  assert.deepStrictEqual([plain.DIFF_DATA[0].BLAME_MAP, plain.OBJ_STATS[0].BT_AUTHORS], [[], []]);
  const payload = await build(api, "K3", undefined, false, true);
  const map = payload.DIFF_DATA[0].BLAME_MAP.map(b => [b.TEXT, b.AUTHOR]);
  assert.deepStrictEqual(map, [["b.", "DEVA"], ["c.", "DEVB"]]);
  assert.deepStrictEqual(payload.OBJ_STATS[0].BT_AUTHORS.map(a => [a.AUTHOR, a.INS_COUNT, a.HUNK_COUNT]), [["DEVA", 1, 1], ["DEVB", 1, 0]]);
});

test("AVE's ignore rules: generator stamps, generated objects, comment-only objects, empty sections", () => {
  const { stripStamps, generatedObject, commentsOnly, emptySection } = require("../review-live");
  const ops = stripStamps([{ op: "=", text: "*" }, { op: "-", text: "*   generation date: 12.02.2020 at 13:28:20" },
    { op: "+", text: "*   generation date: 28.09.2026 at 16:31:07" }, { op: "=", text: "FUNCTION X." }]);
  assert.deepStrictEqual(ops.map(o => o.op), ["=", "=", "="]);
  assert.strictEqual(ops[1].text, "*   generation date: 28.09.2026 at 16:31:07");
  assert.deepStrictEqual(stripStamps([{ op: "+", text: "* regenerated at 30.06.2026 16:56:30" }]).map(o => o.op), ["+"]);
  assert.strictEqual(generatedObject({ part: "ZCL_X_MPC_EXT=================CP" }), true);
  assert.strictEqual(generatedObject({ className: "ZCL_X_DPC" }), true);
  assert.strictEqual(generatedObject({ className: "ZCL_X_DPC_EXT", object: "ZCL_X_DPC_EXT" }), false);
  assert.strictEqual(generatedObject({ part: "SAPLZHR_X" }), true);
  assert.strictEqual(commentsOnly(["* header", ""]), true);
  assert.strictEqual(commentsOnly(["* header", "REPORT x."]), false);
  assert.strictEqual(emptySection(["  protected section.", ""]), true);
  assert.strictEqual(emptySection(["public section.", "  data a type i."]), false);
});

test("a LIMU METH entry names its class and method in the long form and in AVE's short ones", () => {
  const { methodOf } = require("../review-live");
  assert.deepStrictEqual(methodOf("ZCL_HR_EMP_ADJ_PROM_COMM      GET_TFC"), { owner: "ZCL_HR_EMP_ADJ_PROM_COMM", method: "GET_TFC" });
  assert.deepStrictEqual(methodOf("ZCL_A=>RUN"), { owner: "ZCL_A", method: "RUN" });
  assert.deepStrictEqual(methodOf("ZCL_A\\RUN"), { owner: "ZCL_A", method: "RUN" });
  assert.deepStrictEqual(methodOf("ZCL_A"), { owner: "ZCL_A", method: "" });
});
