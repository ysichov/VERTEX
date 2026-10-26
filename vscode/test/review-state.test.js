"use strict";
const test = require("node:test");
const assert = require("node:assert");
const state = require("../review-state");
const front = require("../review-front");

test("a payload read for writing goes back with its stamps as the numbers they were", () => {
  const text = '{"LAST_SAVED_AT":20261009101112.1234567,"HUNKS":[{"HUNK_NO":1,"TEXT":"a 12345678901234567 b"}],"N":20261009101112345}';
  const payload = state.parseForWrite(text);
  assert.strictEqual(state.plain(payload.LAST_SAVED_AT), "20261009101112.1234567");
  assert.strictEqual(state.stringify(payload), text);
});

test("a stamp is GET TIME STAMP's TIMESTAMPL, in UTC", () => {
  const at = state.stamp(new Date(Date.UTC(2026, 9, 9, 8, 7, 6, 54)));
  assert.strictEqual(state.plain(at), "20261009080706.0540000");
  assert.strictEqual(state.stringify({ A: at }), '{"A":20261009080706.0540000}');
});

test("approve, decline, comment and take back change the review as AVE does", () => {
  const who = { user: "REV", name: "Reviewer" };
  const payload = { HUNKS: [{ HUNK_KEY: "METH~X~1", OBJTYPE: "METH", OBJ_NAME: "X", HUNK_NO: 1, AUTHOR: "DEV" }],
    USER_STATES: [{ REVIEWER: "OTHER", REVIEWER_NAME: "Other", SAVED_AT: state.MARK + "20260101000000.0000000", APPROVED: [{ HUNK_KEY: "METH~X~1" }] }] };
  const s = state.applySaved(payload, who.user);
  assert.strictEqual(s.actions.length, 1, "the other reviewer's approval becomes an action");
  state.applyAction(s, "METH~X~1", "D", s.hunks[0], "no", who);
  state.applyAction(s, "METH~X~1", "D", s.hunks[0], "no", who);
  assert.deepStrictEqual([...s.declined], ["METH~X~1"]);
  assert.strictEqual(s.threads[0].MESSAGES.length, 1, "a double click is not a second comment");
  const saved = state.buildSave(payload, "K1", s, who);
  assert.deepStrictEqual(saved.USER_STATES.map(u => u.REVIEWER), ["OTHER", "REV"]);
  assert.deepStrictEqual(saved.USER_STATES[1].NOTES, [{ HUNK_KEY: "METH~X~1", NOTE: "no" }]);
  assert.strictEqual(saved.HISTORY.length, 1);
  state.applyAction(s, "METH~X~1", "U", s.hunks[0], "", who);
  assert.strictEqual(s.declined.size, 0);
  assert.strictEqual(s.notes.size, 0);
});

// A system without VERTEX's ABAP: files only.
function system() {
  const files = new Map(), stored = [];
  const feed = [{ id: "00002", uri: "/p/2", author: "DEV", transport: "K1" }, { id: "00001", uri: "/p/1", author: "OLD", transport: "K0" }];
  const api = {
    user: () => "rev",
    query: async sql => {
      if (/FROM dd03l/.test(sql)) { return { values: [] }; }
      if (/FROM e070 WHERE trkorr/.test(sql)) { return { values: [{ TRKORR: "K1" }] }; }
      if (/FROM e070 WHERE strkorr/.test(sql)) { return { values: [] }; }
      if (/FROM e071/.test(sql)) { return { values: [{ PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZPROG" }] }; }
      if (/FROM usr21/.test(sql)) { return { values: [{ BNAME: "DEV", NAME_TEXT: "Dev One" }] }; }
      return { values: [] };
    },
    revisions: async () => feed,
    revisionSource: async uri => ({ "/p/1": "a.\nb.\n", "/p/2": "a.\nx.\nb.\n" })[uri],
    storeReview: async (...args) => { stored.push(args); }
  };
  const io = { mode: "file", wanted: "table", canStore: false, where: t => "/reviews/" + t + ".json",
    read: async t => files.get(t) || null, write: async (t, r, text) => { files.set(t, text); return "/reviews/" + t + ".json"; } };
  return { api, io, files, stored };
}

test("a review built from ADT is saved to a file, then approved there", async () => {
  const { api, io, files, stored } = system();
  const summary = await front.write(api, "/sap/bc/adt/vertex/review/K1", JSON.stringify({ action: "S" }), io);
  assert.strictEqual(summary.saved, true);
  assert.strictEqual(summary.live, false);
  assert.strictEqual(summary.storage.from, "file");
  assert.strictEqual(stored.length, 0, "nothing goes to the table on a system without the store");
  const text = files.get("K1");
  assert.match(text, /"LAST_SAVED_AT":\d{14}\.\d{7}[,}]/, "the stamp is written as a number");
  const part = await front.request(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS", undefined, io);
  const key = part.blocks[0].hunk_key;
  const after = await front.write(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS",
    JSON.stringify({ hunk_key: key, action: "A", saved_at: part.saved_at }), io);
  assert.strictEqual(after.blocks[0].action, "A");
  assert.strictEqual(after.blocks[0].reviewer, "REV");
  await assert.rejects(front.write(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS",
    JSON.stringify({ hunk_key: key, action: "U", saved_at: part.saved_at }), io), /saved this review while the page was open/);
  await assert.rejects(front.write(api, "/sap/bc/adt/vertex/review/K1", JSON.stringify({ action: "S" }), io), /already saved/);
});

test("a saved review rebuilt from ADT holds the request as it is now, without the old verdicts", async () => {
  const { api, io, files } = system();
  await front.write(api, "/sap/bc/adt/vertex/review/K1", JSON.stringify({ action: "S" }), io);
  const part = await front.request(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS", undefined, io);
  const approved = await front.write(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS",
    JSON.stringify({ hunk_key: part.blocks[0].hunk_key, action: "A", saved_at: part.saved_at }), io);
  await assert.rejects(front.write(api, "/sap/bc/adt/vertex/review/K1", JSON.stringify({ action: "R", saved_at: part.saved_at }), io),
    /saved this review while the page was open/);
  const summary = await front.write(api, "/sap/bc/adt/vertex/review/K1", JSON.stringify({ action: "R", saved_at: approved.saved_at }), io);
  assert.strictEqual(summary.objects[0].approved, 0);
  assert.deepStrictEqual(summary.stale, { changed: [], unchecked: [] });
  assert.strictEqual(JSON.parse(files.get("K1")).HISTORY.length, 3, "earlier saves stay on record");
});

test("a review kept in the table and in a file: both copies are named, either is shown, a write goes back to the one shown", async () => {
  const { api, io, files, stored } = system();
  await front.write(api, "/sap/bc/adt/vertex/review/K1", JSON.stringify({ action: "S" }), io);
  // The table holds another copy, saved by AVE.
  let tableText = files.get("K1").replace(/"LAST_SAVED_BY":"[^"]*"/, '"LAST_SAVED_BY":"AVEUSER"');
  const query = api.query;
  api.query = async (sql, rows) => {
    if (/FROM dd03l/.test(sql)) { return { values: [{ FIELDNAME: "TRKORR" }, { FIELDNAME: "REMOTE" }, { FIELDNAME: "PAYLOAD" }] }; }
    if (/FROM zave_review/.test(sql)) { return { values: [{ PAYLOAD: tableText }] }; }
    return query(sql, rows);
  };
  api.storeReview = async (t, r, e, text) => { stored.push(e); tableText = text; };
  const summary = await front.request(api, "/sap/bc/adt/vertex/review/K1", undefined, io);
  assert.deepStrictEqual([summary.storage.from, summary.copies.table.saved_by, summary.copies.file.saved_by], ["file", "AVEUSER", "REV"]);
  const fromTable = await front.request(api, "/sap/bc/adt/vertex/review/K1?from=table", undefined, io);
  assert.strictEqual(fromTable.storage.from, "table");
  const part = await front.request(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS&from=table", undefined, io);
  // The system cannot write the table: the table copy, approved, goes to the file, and the table is untouched.
  await front.write(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS&from=table",
    JSON.stringify({ hunk_key: part.blocks[0].hunk_key, action: "A", saved_at: part.saved_at }), io);
  assert.strictEqual(stored.length, 0);
  assert.match(files.get("K1"), /"ACTION":"A"/);
  assert.match(tableText, /"LAST_SAVED_BY":"AVEUSER"/);
  // Where it can: the table copy goes back to the table, and the file is left as it is.
  io.canStore = true; io.mode = "table";
  const before = files.get("K1");
  const again = await front.request(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS&from=table", undefined, io);
  await front.write(api, "/sap/bc/adt/vertex/review/K1?part=ZPROG&ptype=REPS&from=table",
    JSON.stringify({ hunk_key: again.blocks[0].hunk_key, action: "D", note: "no", saved_at: again.saved_at }), io);
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(files.get("K1"), before);
  await assert.rejects(front.request(api, "/sap/bc/adt/vertex/review/K2?from=file", undefined, io), /No copy/);
});
