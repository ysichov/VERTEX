"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { request, hunkRanges, reportObjects, parsePayload } = require("../review-front");

// A review of one request as /ui2/cl_json stores it: one method with two blocks, one approved, one declined with a note.
const PAYLOAD = '{"SCHEMA_VERSION":1,"TRKORR":"A4HK900001","LAST_SAVED_AT":20261009123456.1234567,"LAST_SAVED_BY":"REVIEWER",'
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
  const answer = await request(api, "/sap/bc/adt/vertex/review/A4HK900001");
  assert.ok(asked.some(sql => sql === "SELECT payload FROM zave_review WHERE trkorr = 'A4HK900001' AND remote = ' '"));
  assert.strictEqual(answer.saved, true);
  assert.strictEqual(answer.saved_at, "20261009123456.1234567");
  assert.deepStrictEqual(answer.objects.map(o => [o.objtype, o.class_name, o.hunks, o.approved, o.declined, o.open]), [["METH", "ZCL_X", 2, 1, 1, 0]]);
  assert.deepStrictEqual(answer.reviewers[0], { reviewer: "REVIEWER", reviewer_name: "Re Viewer", approved: 1, declined: 1, total: 2,
    objects: ["x", "y", "METH~ZCL_X                         RUN"] });
  assert.strictEqual(answer.history.length, 1);
});

test("a part's blocks carry their verdicts, notes and threads, and where they sit in the stored diff", async () => {
  const { api } = session();
  const part = encodeURIComponent("ZCL_X                         RUN");
  const answer = await request(api, "/sap/bc/adt/vertex/review/A4HK900001?part=" + part + "&ptype=METH");
  assert.deepStrictEqual(answer.blocks.map(b => [b.hunk_no, b.action, b.op_from, b.op_to, b.note, b.messages.length]),
    [[1, "A", 2, 4, "", 0], [2, "D", 6, 6, "Why c?", 1]]);
  assert.deepStrictEqual([answer.versno_old, answer.versno_new, answer.added, answer.deleted, answer.ops.length], ["00001", "00002", 2, 1, 6]);
});

test("with nothing saved - or no table at all - opening builds nothing; build=1 builds the review from ADT, live", async () => {
  const empty = { query: async sql => /FROM e070 WHERE trkorr/.test(sql) ? { values: [{ TRKORR: "A4HK900001", TRSTATUS: "R" }] } : { values: [] } };
  const opened = await request(empty, "/sap/bc/adt/vertex/review/A4HK900001");
  assert.deepStrictEqual([opened.table, opened.live, opened.saved, opened.can_build], [false, false, false, true]);
  const answer = await request(empty, "/sap/bc/adt/vertex/review/A4HK900001?build=1");
  assert.deepStrictEqual([answer.table, answer.live, answer.saved, answer.objects.length], [false, true, true, 0]);
});

test("a class part with no class name is placed under its class", () => {
  const sorted = reportObjects([{ OBJTYPE: "CPUB", CLASS_NAME: "", OBJ_NAME: "ZCL_B==========", INS_COUNT: 1 },
    { OBJTYPE: "REPS", CLASS_NAME: "", OBJ_NAME: "ZPROG", INS_COUNT: 1 }]);
  assert.deepStrictEqual(sorted.map(s => [s.OBJTYPE, s.CLASS_NAME]), [["REPS", ""], ["CPUB", "ZCL_B"]]);
});

test("a review with blame names who wrote each changed line, and counts developers by it", async () => {
  const stored = JSON.parse(PAYLOAD.replace(/(\d{14}\.\d{7})/g, '"$1"'));
  stored.DIFF_DATA[0].BLAME_MAP = [{ TEXT: "call( y", AUTHOR: "DEVA", AUTHOR_NAME: "Dev A", VERSNO_TEXT: "2", DATUM: "2026-10-02", TASK: "A4HK900002" },
    { TEXT: "c.", AUTHOR: "DEVB", AUTHOR_NAME: "Dev B", VERSNO_TEXT: "2" }];
  stored.DIFF_DATA[0].BLAME_DELETED = [{ TEXT: "call( x", AUTHOR: "DEVA", AUTHOR_NAME: "Dev A" }];
  stored.OBJ_STATS[0].BT_AUTHORS = [{ AUTHOR: "DEVA", AUTHOR_NAME: "Dev A", INS_COUNT: 0, MOD_COUNT: 1, DEL_COUNT: 0 },
    { AUTHOR: "DEVB", AUTHOR_NAME: "Dev B", INS_COUNT: 1, MOD_COUNT: 0, DEL_COUNT: 0 }];
  stored.HUNKS[0].AUTHOR = "DEVA"; stored.HUNKS[1].AUTHOR = "DEVB";
  const part = encodeURIComponent("ZCL_X                         RUN");
  const answer = await request(session(JSON.stringify(stored)).api, "/sap/bc/adt/vertex/review/A4HK900001?part=" + part + "&ptype=METH");
  assert.deepStrictEqual(answer.ops.filter(o => o.who).map(o => [o.op, o.text, o.who.author]),
    [["-", "call( x", "DEVA"], ["+", "call( y", "DEVA"], ["+", "c.", "DEVB"]]);
  const summary = await request(session(JSON.stringify(stored)).api, "/sap/bc/adt/vertex/review/A4HK900001");
  assert.deepStrictEqual(summary.developers.map(d => [d.author, d.inserted, d.modified, d.hunks, d.approved, d.declined]),
    [["DEVA", 0, 1, 1, 1, 0], ["DEVB", 1, 0, 1, 0, 1]]);
});

test("every line of a block names the block's one author, a line repeated elsewhere included", async () => {
  const stored = JSON.parse(PAYLOAD.replace(/(\d{14}\.\d{7})/g, '"$1"'));
  // "call( x" is a text another developer wrote last somewhere else; in this block the other line is DEVA's too.
  stored.DIFF_DATA[0].BLAME_MAP = [{ TEXT: "call( y", AUTHOR: "DEVA" }, { TEXT: "c.", AUTHOR: "DEVB" }];
  stored.DIFF_DATA[0].BLAME_DELETED = [{ TEXT: "call( x", AUTHOR: "DEVB" }];
  const part = encodeURIComponent("ZCL_X                         RUN");
  const answer = await request(session(JSON.stringify(stored)).api, "/sap/bc/adt/vertex/review/A4HK900001?part=" + part + "&ptype=METH");
  const block = answer.blocks[0], lines = answer.ops.slice(block.op_from - 1, block.op_to).filter(o => o.who);
  assert.equal(lines.length, 2);
  assert.equal(new Set(lines.map(o => o.who.author)).size, 1);
  assert.equal(answer.ops.find(o => o.text === "c.").who.author, "DEVB");
});

test("a review built from ADT sends each part done, as a summary, on the progress line", async () => {
  const { PARTIAL_MARK, summarize } = require("../review-front");
  const so = summarize({ OBJ_STATS: [{ OBJTYPE: "REPS", OBJ_NAME: "ZPROG", AUTHOR: "DEV", INS_COUNT: 2, DEL_COUNT: 0, MOD_COUNT: 1, HUNK_COUNT: 1 }],
    HUNKS: [{ HUNK_KEY: "REPS~ZPROG~1", OBJTYPE: "REPS", OBJ_NAME: "ZPROG", AUTHOR: "DEV" }] });
  assert.deepStrictEqual(so.objects.map(o => [o.obj_name, o.hunks, o.inserted]), [["ZPROG", 1, 2]]);
  assert.deepStrictEqual(so.developers.map(d => [d.author, d.hunks]), [["DEV", 1]]);
  assert.ok(PARTIAL_MARK.endsWith(" "));
});

test("an interface's section include is shown as the interface, among Interfaces", () => {
  const { summarize } = require("../review-front");
  const so = summarize({ OBJ_STATS: [{ OBJTYPE: "REPS", OBJ_NAME: "ZIF_CALC_TYPES=================IU", DISPLAY_NAME: "ZIF_CALC_TYPES=================IU",
    AUTHOR: "DEV", INS_COUNT: 1, HUNK_COUNT: 1 }], HUNKS: [] });
  assert.deepStrictEqual(so.objects.map(o => [o.kind, o.display_name, o.group, o.objtype]), [["INTF", "ZIF_CALC_TYPES", "Interfaces", "REPS"]]);
});

test("a dictionary object AVE reviewed is diffed again through VERTEX's ABAP, its blocks kept; without it the page says why", async () => {
  const payload = JSON.stringify({ SCHEMA_VERSION: 1, TRKORR: "A4HK900001", LAST_SAVED_AT: "20261009123456.1234567", LAST_SAVED_BY: "R",
    OBJ_STATS: [{ OBJTYPE: "DTED", OBJ_NAME: "ZDE", INS_COUNT: 1, HUNK_COUNT: 1 }],
    HUNKS: [{ HUNK_KEY: "DTED~ZDE~1", OBJTYPE: "DTED", OBJ_NAME: "ZDE", HUNK_NO: 1, START_LINE: 1, VERSNO_NEW: 99998, VERSNO_OLD: 1 }],
    HUNK_ACTIONS: [{ HUNK_KEY: "DTED~ZDE~1", ACTION: "A", REVIEWER: "R" }],
    DIFF_DATA: [{ KEY: { OBJTYPE: "DTED", OBJNAME: "ZDE", VERSNO_O: 1, VERSNO_N: 99998 }, DIFF: [], HTML: "<html>AVE</html>" }] });
  const without = session(payload).api;
  const said = await request(without, "/sap/bc/adt/vertex/review/A4HK900001?part=ZDE&ptype=DTED");
  assert.strictEqual(said.ddic, true);
  assert.match(said.ddic_needs, /ABAP backend/);
  const withIt = Object.assign(session(payload).api, { ddicVersions: async () => true,
    ddicVersion: async (type, name, versno) => versno ? ["Length            : 000030"] : ["Length            : 000040"] });
  const read = await request(withIt, "/sap/bc/adt/vertex/review/A4HK900001?part=ZDE&ptype=DTED");
  assert.strictEqual(read.ddic, false);
  assert.deepStrictEqual(read.ops.map(o => o.op + o.text), ["-Length            : 000030", "+Length            : 000040"]);
  assert.deepStrictEqual(read.blocks.map(b => [b.hunk_key, b.action, b.op_from, b.op_to]), [["DTED~ZDE~1", "A", 1, 2]]);
});

test("a class asked for whole answers each of its parts as a section with its own blocks", async () => {
  const answer = await request(session().api, "/sap/bc/adt/vertex/review/A4HK900001?part=ZCL_X&ptype=CLASS");
  assert.strictEqual(answer.class_name, "ZCL_X");
  assert.ok(answer.sections.length >= 1);
  answer.sections.forEach(s => {
    assert.ok(s.objtype && s.obj_name, "a section names its part");
    s.blocks.forEach(b => assert.ok(b.hunk_key.startsWith(s.objtype + "~"), "a section's blocks are its part's"));
  });
});
