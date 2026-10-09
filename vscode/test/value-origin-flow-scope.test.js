"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { analyze } = require("./origin-view-fixture");
const view = require("../value-origin-view");

// A class whose RUN is called from START and calls HELP; OTHER is called by no one.
const text = ["CLASS zcl_scope DEFINITION.", "  PUBLIC SECTION.", "    METHODS: start, run, help, other.", "ENDCLASS.",
  "CLASS zcl_scope IMPLEMENTATION.",
  "  METHOD start.", "    run( ).", "  ENDMETHOD.",
  "  METHOD run.", "    DATA lv_count TYPE i.", "    lv_count = 1.", "    help( ).", "    lv_count = lv_count + 1.", "  ENDMETHOD.",
  "  METHOD help.", "    WRITE 1.", "  ENDMETHOD.",
  "  METHOD other.", "    WRITE 2.", "  ENDMETHOD.", "ENDCLASS."].join("\n");
const source = { id: "zcl_scope.clas.abap", text, objectName: "ZCL_SCOPE", objectType: "CLAS" };
const drawn = target => {
  const output = view.html(analyze([source], { source: source.id, ...target }), "n");
  const data = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]);
  return data.bseFlow.nodes.filter(node => node.type === "method").map(node => node.text);
};

test("a local variable's flow is its routine alone: no caller, no other method", () => {
  const methods = drawn({ line: 13, variable: "lv_count" });
  assert.deepEqual(methods, ["RUN"]);
});

test("between breakpoints the flow is the routine they stand in and what it calls, beyond them too", () => {
  const methods = drawn({ line: 13, variable: "lv_count", flowBounds: { source: source.id, from: 10, to: 13 } });
  assert.ok(methods.includes("RUN") && methods.includes("HELP"), methods.join());
  assert.ok(!methods.includes("START") && !methods.includes("OTHER"), methods.join());
});

// Forward Usage Analysis with no variable under the cursor: the run from the selected line on.
const scoped = target => view.flowScope(analyze([source], { source: source.id, ...target }));
const routines = scope => [...new Set(scope.rows.map(row => String(row.scope).toUpperCase().split("→").pop()))];

test("with no variable the flow is the routine from the selected line on, and every routine it calls", () => {
  const scope = scoped({ line: 12, variable: "" });
  assert.deepEqual(routines(scope).sort(), ["HELP", "RUN"]);
  assert.ok(!scope.rows.some(row => row.line < 12 && /RUN$/i.test(row.scope)), scope.rows.map(row => row.line).join());
});

test("a breakpoint stops the flow where the run would stop, and 'next' and 'ignore' go on", async () => {
  const scope = scoped({ line: 11, variable: "" });
  const at = line => row => row.line === line ? { location: row.location, line } : null;
  const asked = [];
  const stopped = await view.stopAtBreakpoints(scope, at(12), async points => { asked.push(points[0].line); return "stop"; });
  assert.deepEqual(asked, [12]);
  assert.deepEqual(stopped.stoppedAt.map(point => point.line), [12]);
  assert.ok(!stopped.rows.some(row => row.line > 12 && /RUN$/i.test(row.scope)), "nothing after the breakpoint");
  assert.ok(!routines(stopped).includes("HELP"), "the call at the breakpoint is not made");
  for (const answer of ["next", "ignore"]) {
    const going = await view.stopAtBreakpoints(scope, at(12), async () => answer);
    assert.equal(going.stoppedAt, undefined);
    assert.equal(going.rows.length, scope.rows.length);
  }
  await assert.rejects(view.stopAtBreakpoints(scope, at(12), async () => undefined), /Unknown answer/);
});

test("the window draws the forward flow when no variable was chosen", () => {
  const output = view.html(analyze([source], { source: source.id, line: 12, variable: "" }), "n");
  assert.match(output, /Forward flow from line 12/);
});

test("a parameter's flow is its routine alone, as a local's is", () => {
  const withParameter = ["CLASS zcl_par DEFINITION.", "  PUBLIC SECTION.", "    METHODS run.", "    METHODS help IMPORTING iv_name TYPE string.", "ENDCLASS.",
    "CLASS zcl_par IMPLEMENTATION.", "  METHOD run.", "    help( iv_name = 'A' ).", "  ENDMETHOD.",
    "  METHOD help.", "    WRITE iv_name.", "  ENDMETHOD.", "ENDCLASS."].join("\n");
  const own = { id: "zcl_par.clas.abap", text: withParameter, objectName: "ZCL_PAR", objectType: "CLAS" };
  const scope = view.flowScope(analyze([own], { source: own.id, line: 11, variable: "iv_name" }));
  assert.deepEqual([...new Set(scope.rows.map(row => String(row.scope).toUpperCase().split("→").pop()))], ["HELP"]);
});

test("a program's local class routine is named by its class, so its call reaches it", () => {
  const text = ["REPORT zprog.", "CLASS lcl_a DEFINITION.", "  PUBLIC SECTION.", "    METHODS run.", "ENDCLASS.",
    "CLASS lcl_a IMPLEMENTATION.", "  METHOD run.", "    WRITE 1.", "  ENDMETHOD.", "ENDCLASS.",
    "START-OF-SELECTION.", "  DATA(go_a) = NEW lcl_a( ).", "  go_a->run( )."].join("\n");
  const program = { id: "zprog.prog.abap", text, objectName: "ZPROG", objectType: "PROG" };
  const graph = analyze([program], { source: program.id, line: 12, variable: "" });
  assert.ok(graph.codeFlow.rows.some(row => String(row.scope).toUpperCase() === "LCL_A→RUN"), graph.codeFlow.rows.map(row => row.scope).join());
  assert.ok(graph.codeFlow.sites.some(site => site.callees.includes("LCL_A→RUN")));
});

test("a local class's DEFINITION is no part of the flow", () => {
  const text = ["REPORT zprog.", "CLASS lcl_a DEFINITION.", "  PUBLIC SECTION.", "    METHODS run.", "ENDCLASS.",
    "CLASS lcl_a IMPLEMENTATION.", "  METHOD run.", "    WRITE 1.", "  ENDMETHOD.", "ENDCLASS.",
    "START-OF-SELECTION.", "  NEW lcl_a( )->run( )."].join("\n");
  const program = { id: "zdef.prog.abap", text, objectName: "ZDEF", objectType: "PROG" };
  const graph = analyze([program], { source: program.id, line: 12, variable: "" });
  assert.ok(!graph.codeFlow.rows.some(row => /SECTION|METHODS/i.test(row.text)), graph.codeFlow.rows.map(row => row.text).join(" | "));
});
