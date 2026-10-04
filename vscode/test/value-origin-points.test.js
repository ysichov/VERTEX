"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { analyze } = require("../value-origin");
const { pointsOf } = require("../value-origin-points");
const sources = require("./fixtures/value-origin-demo.json");

test("the places the debugger stops at are the statements of the slice the Value origin view draws", () => {
  const graph = analyze(sources, { source: "zvertex_debug_lab.prog.abap", line: 16, variable: "ls_result-amount" });
  const points = pointsOf(graph, sources);
  const at = (name, line) => points.find(point => point.name === name && point.line === line);
  assert.ok(at("ZVERTEX_DEBUG_LAB", 15), "the call of RUN that returns the value");
  assert.ok(at("ZCL_CALC_FACADE", 28), "rs_result = ls_context");
  assert.ok(at("ZCL_CALC_FACADE", 20), "calculate_base( CHANGING cs_context )");
  assert.ok(at("ZCL_PRICE_ROAD", 5), "the strategy that sets cs_context-amount");
  assert.ok(points.every(point => point.name && point.line > 0 && point.text));
  assert.equal(new Set(points.map(point => point.name + ":" + point.line)).size, points.length, "one point per statement");
});

test("a value nothing leads to gives no places, and says so by being empty", () => {
  const graph = analyze(sources, { source: "zvertex_debug_lab.prog.abap", line: 16, variable: "returned" });
  const points = pointsOf(graph, sources);
  assert.ok(points.length <= 1, "only the statement the word stands in");
});

test("a statement's own names come from ACE's flow row when it has one", () => {
  const graph = { nodes: [{ kind: "calculation", source: "a", line: 3, text: "x = y." }],
    flow: [{ source: "a", line: 3, changed: "x", dependencies: ["y", "x"] }] };
  const [point] = pointsOf(graph, [{ id: "a", name: "ZREP", objectType: "PROG", aceStatements: [{ line: 3, text: "x = y." }] }]);
  assert.deepEqual(point, { name: "ZREP", type: "PROG", line: 3, text: "x = y.", names: ["X", "Y"],
    method: "", object_name: "", object_type: "PROG" });
});

test("a global class's lines move from ACE's method include to the class's main source", () => {
  const { classLines } = require("../value-origin-points");
  const at = (name, method, line, extra = {}) => ({ name, method, line, text: "x", names: [], object_name: name, object_type: "CLAS", ...extra });
  // RUN starts at line 15 of the class source: its 14th line, rs_result = ls_context, is line 28 there.
  const moved = classLines([at("ZCL_CALC_FACADE", "RUN", 14), at("ZCL_CALC_FACADE", "MODIFIER_FOR", 7),
    at("ZCL_MOD_FUEL", "ZIF_CALC_MODIFIER~APPLY", 13)],
  name => ({ ZCL_CALC_FACADE: { RUN: 15, MODIFIER_FOR: 6 }, ZCL_MOD_FUEL: { "ZIF_CALC_MODIFIER~APPLY": 3 } })[name]);
  assert.deepEqual(moved.map(point => point.line), [28, 12, 15]);
});

test("a program, and a local class inside one, keep the lines ACE gave", () => {
  const { classLines } = require("../value-origin-points");
  const program = { name: "ZREPORT", method: "", line: 16, object_name: "ZREPORT", object_type: "PROG" };
  const local = { name: "LCL_X", method: "RUN", line: 4, object_name: "ZREPORT", object_type: "PROG" };
  assert.deepEqual(classLines([program, local], () => { throw new Error("no class source is asked for"); }), [program, local]);
});

test("a method ADT's class structure does not list is an error, not a wrong line", () => {
  const { classLines } = require("../value-origin-points");
  const point = { name: "ZCL_A", method: "GONE", line: 3, object_name: "ZCL_A", object_type: "CLAS" };
  assert.throws(() => classLines([point], () => ({ OTHER: 5 })), /Cannot place ZCL_A=>GONE/);
});

test("a point carries its method and the object it belongs to", () => {
  const graph = { nodes: [{ kind: "calculation", source: "a", line: 14, location: "ZCL_CALC_FACADE->RUN", text: "rs_result = ls_context." }] };
  const [point] = pointsOf(graph, [{ id: "a", name: "ZCL_CALC_FACADE", objectName: "ZCL_CALC_FACADE", objectType: "CLAS", aceOwner: "ZCL_CALC_FACADE", aceOwnerType: "CLAS" }]);
  assert.equal(point.method, "RUN");
  assert.equal(point.object_name, "ZCL_CALC_FACADE");
  assert.equal(point.object_type, "CLAS");
});

test("the flow between two breakpoints is ACE's statement stream under its routines, marked where the slice reaches it", () => {
  const { pathRows } = require("../value-origin-points");
  const sources = [{ id: "a", name: "ZREP", objectName: "ZREP", objectType: "PROG" },
    { id: "b", name: "ZCL_X=>M", aceOwner: "ZCL_X", aceOwnerType: "CLAS", objectName: "ZCL_X", objectType: "CLAS" }];
  const graph = { fullFlow: [
    { source: "a", line: 15, text: " DATA(r) = NEW zcl_x( )->run( ). ", scope: "ZREP→START-OF-SELECTION", included: true },
    { source: "b", line: 4, text: "x = 1.", scope: "ZCL_X→RUN", included: false },
    { source: "b", line: 2, text: "PUBLIC SECTION.", scope: "ZCL_X→START-OF-SELECTION", included: false },
    { source: "gone", line: 9, text: "lost.", scope: "" }] };
  const rows = JSON.parse(JSON.stringify(pathRows(graph, sources)));
  assert.equal(rows.length, 2, "a row whose source is unknown is not invented, nor a class's text between its methods");
  assert.deepEqual([rows[0].name, rows[0].line, rows[0].included, rows[0].text], ["ZREP", 15, true, "DATA(r) = NEW zcl_x( )->run( )."]);
  assert.deepEqual([rows[1].name, rows[1].method, rows[1].included, rows[1].object_type, rows[1].scope], ["ZCL_X", "RUN", false, "CLAS", "ZCL_X→RUN"]);
  assert.deepEqual(pathRows({}, sources), [], "no flow in the answer: no rows");
});

test("a row of the flow that ADT cannot place stays in the list, marked, and does not stop the others", () => {
  const { placeRows } = require("../value-origin-points");
  const rows = [{ name: "ZCL_X", type: "CLAS", line: 3, method: "RUN", object_name: "ZCL_X", object_type: "CLAS" },
    { name: "ZCL_X", type: "CLAS", line: 5, method: "GONE", object_name: "ZCL_X", object_type: "CLAS" },
    { name: "ZREP", type: "PROG", line: 9, method: "", object_name: "ZREP", object_type: "PROG" }];
  const placed = JSON.parse(JSON.stringify(placeRows(rows, () => ({ RUN: 20 }))));
  assert.equal(placed[0].line, 22, "METHOD is line 1 of its include: 20 + 3 - 1");
  assert.deepEqual([placed[1].unplaced, placed[1].line], [true, 5]);
  assert.equal(placed[2].line, 9);
});

test("the calls of the flow are named as the rows' scopes are, so a call can be nested where it is made", () => {
  const { siteRows, placeRows } = require("../value-origin-points");
  const sources = [{ id: "b", name: "ZCL_X=>M", aceOwner: "ZCL_X", aceOwnerType: "CLAS", objectName: "ZCL_X", objectType: "CLAS" }];
  const graph = { callSites: [{ source: "b", line: 3, caller: "ZCL_X->RUN", callees: [{ owner: "zcl_y", name: "m" }, { owner: "ZCL_Z", name: "ZIF~M" }] },
    { source: "gone", line: 1, caller: "", callees: [] }] };
  const sites = siteRows(graph, sources);
  assert.equal(sites.length, 1);
  assert.deepEqual([sites[0].name, sites[0].method, sites[0].callees], ["ZCL_X", "RUN", ["ZCL_Y→M", "ZCL_Z→ZIF~M"]]);
  assert.equal(JSON.parse(JSON.stringify(placeRows(sites, () => ({ RUN: 20 }))))[0].line, 22, "the call is placed as a row is");
});

test("a structure type declared in another object is read from it, and what cannot be read is said", async () => {
  const { completeStructures } = require("../value-origin-points");
  const { typeComponents } = require("../value-origin");
  const nl = String.fromCharCode(10);
  const intf = ["INTERFACE zif_t PUBLIC.", "  TYPES: BEGIN OF ty_ctx,", "           id TYPE char10,", "         END OF ty_ctx.", "ENDINTERFACE."].join(nl);
  const variables = { globals: [{ name: "ls", type: "zif_t=>ty_ctx" }, { name: "lx", type: "zif_gone=>ty" }, { name: "lo", type: "REF TO zcl_a" }, { name: "lp", type: "char10" }],
    routines: [{ params: [{ name: "iv", mode: "IMPORTING", type: "zif_t=>ty_ctx" }], locals: [] }] };
  const asked = [];
  const warnings = await completeStructures(variables, typeComponents, async owner => { asked.push(owner); if (owner === "ZIF_T") return intf; throw new Error("not found"); });
  assert.deepEqual(variables.globals[0].components.map(c => c.name), ["id"], "read from the interface");
  assert.deepEqual(variables.routines[0].params[0].components.map(c => c.name), ["id"], "for a parameter too");
  assert.deepEqual(asked, ["ZIF_T", "ZIF_GONE"], "one read per owner, none for a reference or a plain type");
  assert.match(variables.globals[1].unresolved, /could not be read: not found/);
  assert.deepEqual(warnings, ["Structures of ZIF_GONE could not be read (not found)."], "and it is said once");
});

test("the routine a line is in: by the lines of a program's routine, by the start of a class's method in its source", () => {
  const { routineAt } = require("../value-origin-points");
  const declarations = [{ source: "p", owner: "ZREP", name: "GLOBAL", first: 1, last: 99 }, { source: "p", owner: "ZREP", name: "F", first: 20, last: 26 },
    { source: "c1", owner: "ZCL_X", name: "RUN", first: 1, last: 6 }, { source: "c2", owner: "ZCL_X", name: "OTHER", first: 1, last: 4 },
    { source: "c3", owner: "ZCL_Y", name: "RUN", first: 1, last: 3 }];
  const program = line => routineAt(declarations, { objectType: "PROG", objectName: "ZREP", targetSource: "p", line });
  assert.equal(program(22).name, "F");
  assert.equal(program(10), null, "a line in the program's events is in no routine: its variables are the program's");
  const starts = { RUN: 30, OTHER: 50 };
  const klass = line => routineAt(declarations, { objectType: "CLAS", objectName: "ZCL_X", targetSource: "c1", line, starts });
  assert.equal(klass(33).name, "RUN", "a method holds its length from its start");
  assert.equal(klass(35).name, "RUN", "its ENDMETHOD too: six lines from line 30");
  assert.equal(klass(36), null, "and not the lines after it");
  assert.equal(klass(52).name, "OTHER");
  assert.equal(klass(10), null, "the class's own text is in no method");
  assert.equal(klass(31).owner, "ZCL_X", "another class's method of the same name is not taken");
  assert.equal(routineAt(declarations, { objectType: "PROG", objectName: "ZREP", targetSource: "p", line: undefined }), null);
});
