"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { request, hunkRanges, reportObjects, parsePayload } = require("../review-front");

// A review of one request as /ui2/cl_json stores it: one method with two blocks, one approved, one declined with a note.
const PAYLOAD = '{"SCHEMA_VERSION":1,"TRKORR":"ALCK900001","LAST_SAVED_AT":20261009123456.1234567,"LAST_SAVED_BY":"REVIEWER",'
  + '"OBJ_STATS":[{"OBJTYPE":"METH","CLASS_NAME":"ZCL_X","OBJ_NAME":"ZCL_X                         RUN","INS_COUNT":2,"DEL_COUNT":1,"MOD_COUNT":0,'
  + '"HUNK_COUNT":2,"DISPLAY_NAME":"RUN","AUTHOR":"DEV","AUTHOR_NAME":"Dev One","IS_CREATED":false},'
  + '{"OBJTYPE":"TABD","CLASS_NAME":"","OBJ_NAME":"ZTAB","INS_COUNT":0,"DEL_COUNT":0,"MOD_COUNT":0,"HUNK_COUNT":0}],'
  + '"HUNKS":[{"HUNK_KEY":"METH~ZCL_X                         RUN~1","OBJTYPE":"METH","OBJ_NAME":"ZCL_X                         RUN","HUNK_NO":1,"START_LINE":2,'
  + '"CHANGE_COUNT":2,"CHANGE_KIND":"MOD","AUTHOR":"DEV","AUTHOR_NAME":"Dev One","VERSNO_NEW":"00002","VERSNO_OLD":"00001"},'
  + '{"HUNK_KEY":"METH~ZCL_X                         RUN~2","OBJTYPE":"METH","OBJ_NAME":"ZCL_X                         RUN","HUNK_NO":2,"START_LINE":5,'
  + '"CHANGE_COUNT":1,"CHANGE_KIND":"INS","AUTHOR":"DEV","AUTHOR_NAME":"Dev One","VERSNO_NEW":"00002","VERSNO_OLD":"00001"}],'
  + '"DIFF_DATA":[{"KEY":{"OBJTYPE":"METH","OBJNAME":"ZCL_X                         RUN","VERSNO_O":"00001","VERSNO_N":"00002"},"RETROFIT":false,'
  + '"DIFF":[{"OP":"=","TEXT":"a."},{"OP":"-","TEXT":"call( x"},{"OP":"+","TEXT":"call( y"},{"OP":"=","TEXT":"  z )."},{"OP":"=","TEXT":"b."},{"OP":"+","TEXT":"c."}]}],'
  + '"HUNK_ACTIONS":[{"HUNK_KEY":"METH~ZCL_X                         RUN~1","REVIEWER":"REVIEWER","REVIEWER_NAME":"Re Viewer","ACTION":"A","CHANGED_AT":20261009120000.0000000},'
  + '{"HUNK_KEY":"METH~ZCL_X                         RUN~2","REVIEWER":"REVIEWER","REVIEWER_NAME":"Re Viewer","ACTION":"D","CHANGED_AT":20261009121000.0000000}],'
  + '"USER_STATES":[{"REVIEWER":"REVIEWER","REVIEWER_NAME":"Re Viewer","SAVED_AT":20261009123456.1234567,"APPROVED":[{"HUNK_KEY":"x"}],"DECLINED":[{"HUNK_KEY":"y"}],'
  + '"NOTES":[{"HUNK_KEY":"METH~ZCL_X                         RUN~2","NOTE":"Why c?"}]}],'
  + '"THREADS":[{"HUNK_KEY":"METH~ZCL_X                         RUN~2","MESSAGES":[{"AUTHOR":"REVIEWER","AUTHOR_NAME":"Re Viewer","CREATED_AT":20261009121000.0000000,"IS_DECLINE":true,"TEXT":"Why c?"}]}],'
  + '"HISTORY":[{"SAVED_AT":20261009123456.1234567,"SAVED_BY":"REVIEWER","SAVED_BY_NAME":"Re Viewer","APPROVED_COUNT":1,"DECLINED_COUNT":1,"NOTE_COUNT":1}]}';

function session(payload = PAYLOAD) {
  const asked = [];
  const api = { query: async sql => {
    asked.push(sql);
    if (/FROM dd03l/.test(sql)) { return { values: [{ FIELDNAME: "TRKORR" }, { FIELDNAME: "REMOTE" }, { FIELDNAME: "PAYLOAD" }] }; }
    if (/FROM zave_review/.test(sql)) { return { values: payload ? [{ PAYLOAD: payload }] : [] }; }
    return { values: [] };
  } };
  return { api, asked };
}

test("a stamp keeps every digit it was written with", () => {
  assert.strictEqual(parsePayload('{"T":20261009123456.1234567}').T, "20261009123456.1234567");
});

test("blocks are cut as AVE cuts them: an open statement takes the line that closes it", () => {
  const diff = [{ op: "=", text: "a." }, { op: "-", text: "call( x" }, { op: "+", text: "call( y" }, { op: "=", text: "  z )." },
    { op: "=", text: "b." }, { op: "+", text: "c." }];
  assert.deepStrictEqual(hunkRanges(diff), [{ op_from: 2, op_to: 4, start_line: 2 }, { op_from: 6, op_to: 6, start_line: 5 }]);
});

test("the summary lists changed objects in AVE's order, with the verdicts on their blocks", async () => {
  const { api, asked } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/review/ALCK900001");
  assert.ok(asked.some(sql => sql === "SELECT payload FROM zave_review WHERE trkorr = 'ALCK900001' AND remote = ' '"));
  assert.strictEqual(answer.saved, true);
  assert.strictEqual(answer.saved_at, "20261009123456.1234567");
  assert.deepStrictEqual(answer.objects.map(o => [o.objtype, o.class_name, o.hunks, o.approved, o.declined, o.open]), [["METH", "ZCL_X", 2, 1, 1, 0]]);
  assert.deepStrictEqual(answer.reviewers[0], { reviewer: "REVIEWER", reviewer_name: "Re Viewer", saved_at: "20261009123456.1234567", approved: 1, declined: 1, notes: 1 });
  assert.strictEqual(answer.history.length, 1);
});

test("a part's blocks carry their verdicts, notes and threads, and where they sit in the stored diff", async () => {
  const { api } = session();
  const part = encodeURIComponent("ZCL_X                         RUN");
  const answer = await request(api, "/sap/bc/adt/vertex/review/ALCK900001?part=" + part + "&ptype=METH");
  assert.deepStrictEqual(answer.blocks.map(b => [b.hunk_no, b.action, b.op_from, b.op_to, b.note, b.messages.length]),
    [[1, "A", 2, 4, "", 0], [2, "D", 6, 6, "Why c?", 1]]);
  assert.deepStrictEqual([answer.versno_old, answer.versno_new, answer.added, answer.deleted, answer.ops.length], ["00001", "00002", 2, 1, 6]);
});

test("with nothing saved - or no table at all - the review is built from ADT, live", async () => {
  const empty = { query: async sql => /FROM e070 WHERE trkorr/.test(sql) ? { values: [{ TRKORR: "ALCK900001", TRSTATUS: "R" }] } : { values: [] } };
  const answer = await request(empty, "/sap/bc/adt/vertex/review/ALCK900001");
  assert.deepStrictEqual([answer.table, answer.live, answer.saved, answer.objects.length], [false, true, true, 0]);
});

test("a class part with no class name is placed under its class", () => {
  const sorted = reportObjects([{ OBJTYPE: "CPUB", CLASS_NAME: "", OBJ_NAME: "ZCL_B==========", INS_COUNT: 1 },
    { OBJTYPE: "REPS", CLASS_NAME: "", OBJ_NAME: "ZPROG", INS_COUNT: 1 }]);
  assert.deepStrictEqual(sorted.map(s => [s.OBJTYPE, s.CLASS_NAME]), [["REPS", ""], ["CPUB", "ZCL_B"]]);
});
