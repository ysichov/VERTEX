"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const backward = require("../backward-usage");

// CALC returns a value; RUN takes it, tests it and gives it back as its own RETURNING; START receives that and writes it.
// RUN passes its importing IV_BASE on to CALC. HELP neither takes nor gives anything.
const text = ["CLASS zcl_use DEFINITION.", "  PUBLIC SECTION.",
  "    METHODS calc IMPORTING iv_in TYPE i RETURNING VALUE(rv_out) TYPE i.",
  "    METHODS run IMPORTING iv_base TYPE i RETURNING VALUE(rv_total) TYPE i.",
  "    METHODS start.", "    METHODS help.", "    DATA mv_count TYPE i.", "ENDCLASS.",
  "CLASS zcl_use IMPLEMENTATION.",
  "  METHOD calc.", "    rv_out = iv_in * 2.", "  ENDMETHOD.",
  "  METHOD run.", "    DATA(lv_value) = calc( iv_in = iv_base ).", "    IF lv_value > 10.", "      mv_count = mv_count + 1.", "    ENDIF.",
  "    rv_total = lv_value + 1.", "  ENDMETHOD.",
  "  METHOD start.", "    DATA(lv_total) = run( iv_base = 5 ).", "    WRITE lv_total.", "    help( ).", "  ENDMETHOD.",
  "  METHOD help.", "    WRITE 1.", "  ENDMETHOD.", "ENDCLASS."].join("\n");
// Parsed by abaplint, as the command parses what it reads.
let source;
test.before(async () => {
  const parser = require("../value-origin-linter").createParser();
  try { source = (await parser.parse({ id: "zcl_use", name: "ZCL_USE", text, objectName: "ZCL_USE", objectType: "CLAS", include: "main" })).source; }
  finally { await parser.close(); }
});
const lineOf = fragment => text.split("\n").findIndex(line => line.includes(fragment)) + 1;
// SAP's where-used, stood in for: the lines that name the routine.
const io = (extra = {}) => ({
  callers: async routine => ({ places: text.split("\n").map((line, at) => ({ line: at + 1, text: line }))
    .filter(item => new RegExp("\\b" + routine.name + "\\b", "i").test(item.text)).map(item => ({ source, line: item.line })), skipped: [] }),
  uses: async attribute => ({ places: text.split("\n").map((line, at) => ({ line: at + 1, text: line }))
    .filter(item => new RegExp("\\b" + attribute.name + "\\b", "i").test(item.text)).map(item => ({ source, line: item.line })), skipped: [] }),
  breakpointAt: () => false, ask: async () => "next", ...extra });
const texts = node => [node.text, ...node.children.flatMap(texts)];

test("a RETURNING parameter is followed into its callers and up through theirs", async () => {
  const result = await backward.analyze({ source, line: lineOf("rv_out = iv_in"), variable: "rv_out" }, io());
  const all = texts(result.root).join("\n");
  assert.match(all, /ZCL_USE->RUN: DATA\(lv_value\) = calc/i);
  assert.match(all, /LV_VALUE > 10/i, "the test of the value in RUN");
  assert.match(all, /leaves ZCL_USE->RUN as returning RV_TOTAL/i);
  assert.match(all, /ZCL_USE->START: DATA\(lv_total\) = run/i);
  assert.match(all, /WRITE lv_total/i);
});

test("an importing parameter is followed to where each caller took it from", async () => {
  const result = await backward.analyze({ source, line: lineOf("rv_out = iv_in"), variable: "iv_in" }, io());
  const all = texts(result.root).join("\n");
  assert.match(all, /^iv_base$/im, "RUN passes its own IV_BASE");
  assert.match(all, /ZCL_USE->START: DATA\(lv_total\) = run\( iv_base = 5 \)/i, "and START passes 5 to RUN");
});

test("with no variable every parameter is followed; with none, the calls are SAP's where-used", async () => {
  const all = await backward.analyze({ source, line: lineOf("rv_out = iv_in"), variable: "" }, io());
  assert.deepEqual(all.root.children.filter(node => node.kind === "target").map(node => node.text), ["importing IV_IN", "returning RV_OUT"]);
  const plain = await backward.analyze({ source, line: lineOf("WRITE 1"), variable: "" }, io());
  assert.deepEqual(plain.root.children.map(node => node.kind), ["caller"]);
  assert.match(plain.root.children[0].text, /help\( \)/i);
});

test("a local is followed through the parameters it reaches", async () => {
  const result = await backward.analyze({ source, line: lineOf("IF lv_value"), variable: "lv_value" }, io());
  assert.deepEqual(result.root.children.filter(node => node.kind === "target").map(node => node.text), ["returning RV_TOTAL"]);
});

test("the walk stops at a wave that reaches a breakpoint when the reader says stop", async () => {
  const asked = [];
  const result = await backward.analyze({ source, line: lineOf("rv_out = iv_in"), variable: "rv_out" },
    io({ breakpointAt: (id, line) => line === lineOf("IF lv_value"), ask: async points => { asked.push(points.map(point => point.line)); return "stop"; } }));
  assert.deepEqual(asked, [[lineOf("IF lv_value")]]);
  assert.equal(result.stoppedAt.length, 1);
  assert.doesNotMatch(texts(result.root).join("\n"), /ZCL_USE->START/i, "nothing above the wave that stopped");
});

test("the window draws it as Forward does, turned inside out: the routine first, its callers under it", async () => {
  const result = await backward.analyze({ source, line: lineOf("rv_out = iv_in"), variable: "rv_out" }, io());
  const builder = require("../resources/vertex-flow-graph.js");
  const drawn = builder.build({ rows: result.flow.rows, sites: result.flow.sites, point: { url: "", line: 0 }, name: "ZCL_USE" }, "methods").bseFlow;
  const methods = drawn.nodes.filter(node => node.type === "method").map(node => node.text + ":" + node.stack);
  assert.deepEqual(methods, ["CALC:1", "RUN:2", "START:3"]);
});

test("on the METHOD line the routine is analysed with no variable, whatever word the cursor is on", async () => {
  const result = await backward.analyze({ source, line: lineOf("METHOD calc."), variable: "CALC" }, io());
  assert.deepEqual(result.root.children.filter(node => node.kind === "target").map(node => node.text), ["importing IV_IN", "returning RV_OUT"]);
});
