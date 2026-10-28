"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("../record-formula");

const page = fs.readFileSync(path.join(__dirname, "../pages/visual-debug.html"), "utf8");
const part = (from, to) => page.slice(page.indexOf(from), page.indexOf(to));

const source = ["REPORT zlab.", "PARAMETERS p_prec AS CHECKBOX.", "DATA lv_rate TYPE i.", "START-OF-SELECTION.",
  "  lv_rate = 3.", "  DATA(lv_scenario) = COND char12( WHEN p_prec = abap_true THEN 'PRECISION'", "                                    ELSE 'CLEAN' ).",
  "  DATA(lv_total) = lv_rate * 10.", "  WRITE lv_total."].join("\n");

// A transpiler record: the values that changed before each stop's statement ran.
const stop = (line, changed) => ({ at: { url: "zlab.prog.abap", line }, cur: { owner: "ZLAB", name: "START-OF-SELECTION" },
  stack: [{ program: "ZLAB" }], varsDelta: true, vars: [{ name: "Locals", children: Object.entries(changed).map(([name, value]) => ({ name, value })) }] });
const timeline = [stop(5, { p_prec: "", lv_rate: 0, lv_scenario: "", lv_total: 0 }), stop(6, { lv_rate: 3 }), stop(8, { lv_scenario: "CLEAN" }), stop(9, { lv_total: 30 })];

function steps() {
  const context = vm.createContext({ flow: { timeline } });
  vm.runInContext(part("function recordSteps(){", "function withRecordFormula(data){"), context);
  return vm.runInContext("recordSteps()", context);
}

test("the record gives each stop the whole set of values, built from the changes", () => {
  const all = steps();
  assert.equal(all.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(all[3].values)), { P_PREC: "", LV_RATE: 3, LV_SCENARIO: "CLEAN", LV_TOTAL: 30 });
  assert.equal(all[2].location, "ZLAB=>START-OF-SELECTION");
});

test("a stop read without values does not make the change: the statement after the last stop read does", () => {
  const unread = line => ({ at: { url: "zx.prog.abap", line }, cur: { owner: "ZX", name: "START-OF-SELECTION" }, stack: [{ program: "ZX" }] });
  const context = vm.createContext({ flow: { timeline: [stop(5, { ls_result: { AMOUNT: 0 } }), stop(6, {}), unread(7), stop(7, { ls_result: { AMOUNT: 7 } })] } });
  vm.runInContext(part("function recordSteps(){", "function withRecordFormula(data){"), context);
  const all = vm.runInContext("recordSteps()", context);
  const source = ["REPORT zx.", "", "", "", "WRITE 1.", "ls_result-amount = 7.", "WRITE 2."].join("\n");
  const result = build({ variable: "LS_RESULT-AMOUNT", steps: all, sources: { "zx.prog.abap": source } });
  assert.equal(result.tree.line, 6);
});

test("a value is derived from the statement that changed it and what that statement read", () => {
  const result = build({ variable: "LV_TOTAL", steps: steps(), sources: { "zlab.prog.abap": source } });
  assert.equal(result.tree.of, "LV_TOTAL");
  assert.equal(result.tree.value, "30");
  assert.equal(result.tree.line, 8);
  assert.match(result.tree.text, /lv_rate \* 10/);
  const rate = result.tree.children.find(child => child.of === "LV_RATE");
  assert.ok(rate, "the operand it read");
  assert.equal(rate.value, "3");
  assert.equal(rate.line, 5);
  assert.match(result.panes.formula, /From the run/);
  assert.match(result.panes.formula, /before this assignment: 0/);
  assert.match(result.panes.expression.replace(/<[^>]+>/g, ""), /lv_rate \(3\) = 3/);
  assert.equal(result.formula.edges.length, result.formula.nodes.length - 1);
});

test("SAP stops on the calling line again after the call: the value is followed into the routine", () => {
  const main = ["REPORT zx.", "DATA(ls_result) = NEW zcl_f( )->run( ).", "WRITE ls_result-amount."].join("\n");
  const run = ["CLASS zcl_f IMPLEMENTATION.", "METHOD run.", "DATA(ls_context) = VALUE ty( amount = 7 ).", "rs_result = ls_context.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const at = (url, line, depth, values) => ({ url, line, depth, location: url, values });
  const steps = [at("zx.prog.abap", 2, 1, { LS_RESULT: { AMOUNT: 0 } }), at("zcl_f.clas.abap", 3, 2, {}),
    at("zcl_f.clas.abap", 4, 2, { LS_CONTEXT: { AMOUNT: 7 } }), at("zx.prog.abap", 2, 1, { LS_RESULT: { AMOUNT: 0 } }),
    at("zx.prog.abap", 3, 1, { LS_RESULT: { AMOUNT: 7 } })];
  const result = build({ variable: "LS_RESULT-AMOUNT", steps, sources: { "zx.prog.abap": main, "zcl_f.clas.abap": run } });
  const returned = result.tree.children.find(child => child.returned);
  assert.ok(returned, "the routine's result");
  assert.equal(returned.of, "RS_RESULT-AMOUNT");
  assert.match(result.panes.expression.replace(/<[^>]+>/g, ""), /= 7/);
});

test("a source that starts with CONV is read to its end, not only inside the CONV", () => {
  const { parsedSource, statementAt } = require("../record-formula");
  const statements = parsedSource("REPORT x.\nDATA(a) = CONV decfloat34( b - c ) / CONV decfloat34( c ) * d.\n", "x.prog.abap");
  assert.equal(statementAt(statements, 2).rhs.map(piece => piece.chain || piece.text).join(" "), "( B - C ) / C * D");
});

test("a statement over several lines is read whole", () => {
  const result = build({ variable: "LV_SCENARIO", steps: steps(), sources: { "zlab.prog.abap": source } });
  assert.equal(result.tree.line, 6);
  assert.match(result.tree.text, /ELSE 'CLEAN'/);
  assert.ok(result.tree.children.some(child => child.of === "P_PREC" && child.outside), "a parameter never changed in the record is where it started");
});

test("Expression writes the derivation out, each value read replaced by its own right-hand side", () => {
  const text = ["REPORT zx.", "DATA(lv_base) = 5.", "DATA(lv_qty) = 2.", "DATA(lv_total) = ( lv_base + 1 ) * lv_qty.", "WRITE lv_total."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values });
  const steps = [at(2, {}), at(3, { LV_BASE: 5 }), at(4, { LV_BASE: 5, LV_QTY: 2 }), at(5, { LV_BASE: 5, LV_QTY: 2, LV_TOTAL: 12 })];
  const result = build({ variable: "LV_TOTAL", steps, sources: { "zx.prog.abap": text } });
  const plain = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(plain, /lv_total \(12\) = \( 5 \+ 1 \) \* 2 = 12/);
});

test("a change seen on coming back from a call is the call's, not the deeper stop's", () => {
  const report = ["REPORT zx.", "DATA ls_r TYPE i.", "ls_r = zcl_calc=>run( 7 ).", "WRITE ls_r."].join("\n");
  const method = ["CLASS zcl_calc IMPLEMENTATION.", "METHOD run.", "rv = iv * 2.", "WRITE rv.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const steps = [
    { url: "zx.prog.abap", line: 3, depth: 1, location: "ZX", values: { LS_R: 0 } },
    { url: "zcl_calc.clas.abap", line: 3, depth: 2, location: "ZCL_CALC=>RUN", values: { LS_R: 0, IV: 7 } },
    { url: "zcl_calc.clas.abap", line: 4, depth: 2, location: "ZCL_CALC=>RUN", values: { LS_R: 0, IV: 7, RV: 14 } },
    { url: "zx.prog.abap", line: 4, depth: 1, location: "ZX", values: { LS_R: 14 } }];
  const result = build({ variable: "LS_R", steps, sources: { "zx.prog.abap": report, "zcl_calc.clas.abap": method } });
  assert.equal(result.tree.line, 3);
  assert.equal(result.tree.source, "zx.prog.abap");
  assert.match(result.tree.text, /run/i);
  const returned = result.tree.children.find(child => child.returned);
  assert.ok(returned, "the value the call returned, as the routine had it");
  assert.equal(returned.of, "RV");
  assert.equal(returned.source, "zcl_calc.clas.abap");
  assert.ok(returned.children.some(child => child.of === "IV" && child.value === "7"));
  assert.match(result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), /ls_r \(14\) = iv \(7\) \* 2 = 14/);
});

test("an empty record says so", () => {
  assert.throws(() => build({ variable: "LV_TOTAL", steps: [] }), /Nothing is recorded/);
});

test("a record of steps alone still gives the formula, from the statements that ran", () => {
  const text = ["REPORT zx.", "DATA(lv_base) = 5.", "DATA(lv_qty) = 2.", "DATA(lv_total) = ( lv_base + 1 ) * lv_qty.", "WRITE lv_total."].join("\n");
  const steps = [2, 3, 4, 5].map(line => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: {} }));
  const result = build({ variable: "LV_TOTAL", steps, sources: { "zx.prog.abap": text } });
  assert.equal(result.hasValues, false);
  assert.equal(result.tree.line, 4);
  assert.deepEqual(result.tree.children.map(child => child.of).sort(), ["LV_BASE", "LV_QTY"]);
  const plain = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(plain, /lv_total = \( 5 \+ 1 \) \* 2/);
  assert.doesNotMatch(plain, /= 12/);
});

test("With values finds the analysis's name in the routine it places it in, as a component when need be", () => {
  const context = vm.createContext({});
  vm.runInContext(part("function recordedValue(full,location,steps,upto){", "function annotateValues(){"), context);
  const steps = [
    { location: "ZCL_DATA=>GET", values: { RS_CONTEXT: { weight_kg: 1287, distance_km: 4 } } },
    { location: "ZX=>START-OF-SELECTION", values: { LS_RESULT: { amount: "11302.00" } } }];
  const find = (full, location) => vm.runInContext("recordedValue(" + JSON.stringify(full) + "," + JSON.stringify(location) + ",__s,1)", Object.assign(context, { __s: steps }));
  assert.equal(find("RS_CONTEXT-WEIGHT_KG", "ZCL_DATA->GET"), 1287);
  assert.equal(find("WEIGHT_KG", "ZCL_DATA->GET"), 1287, "a bare component of a structure the routine held");
  assert.equal(find("LS_RESULT-AMOUNT", "ZX"), "11302.00");
  assert.equal(find("LV_NOWHERE", "ZX"), undefined);
});

test("one calculation, the way the run went: an accumulation and a component carried through a call", () => {
  const report = ["REPORT zx.", "DATA ls_result TYPE ty.", "zcl_calc=>apply( CHANGING cs_context = ls_result ).", "WRITE ls_result-amount."].join("\n");
  const method = ["CLASS zcl_calc IMPLEMENTATION.", "METHOD apply.", "cs_context-amount = 100.", "cs_context-tax = cs_context-amount * lv_rate.",
    "cs_context-amount = cs_context-amount + cs_context-tax.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const at = (url, line, depth, values) => ({ url, line, depth, location: url, values });
  const steps = [
    at("zx.prog.abap", 3, 1, { LS_RESULT: { amount: 0, tax: 0 } }),
    at("zcl_calc.clas.abap", 3, 2, { LS_RESULT: { amount: 0, tax: 0 }, CS_CONTEXT: { amount: 0, tax: 0 }, LV_RATE: "0.19" }),
    at("zcl_calc.clas.abap", 4, 2, { LS_RESULT: { amount: 0, tax: 0 }, CS_CONTEXT: { amount: 100, tax: 0 }, LV_RATE: "0.19" }),
    at("zcl_calc.clas.abap", 5, 2, { LS_RESULT: { amount: 0, tax: 0 }, CS_CONTEXT: { amount: 100, tax: 19 }, LV_RATE: "0.19" }),
    at("zx.prog.abap", 4, 1, { LS_RESULT: { amount: 119, tax: 19 } })];
  const result = build({ variable: "LS_RESULT-AMOUNT", steps, sources: { "zx.prog.abap": report, "zcl_calc.clas.abap": method } });
  const formula = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(" Where the values")[0];
  assert.match(formula, /ls_result-amount \(119\) = 100 \+ \( 100 \* lv_rate \(0\.19\) \) = 119/);
  assert.doesNotMatch(formula, /otherwise|\|/);
});

test("the tree shows no node that leads to the same code as its only child", () => {
  const report = ["REPORT zx.", "DATA ls_r TYPE i.", "ls_r = zcl_calc=>run( 7 ).", "WRITE ls_r."].join("\n");
  const method = ["CLASS zcl_calc IMPLEMENTATION.", "METHOD run.", "rv = iv * 2.", "WRITE rv.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const steps = [
    { url: "zx.prog.abap", line: 3, depth: 1, location: "ZX", values: { LS_R: 0 } },
    { url: "zcl_calc.clas.abap", line: 3, depth: 2, location: "ZCL_CALC=>RUN", values: { LS_R: 0, IV: 7 } },
    { url: "zcl_calc.clas.abap", line: 4, depth: 2, location: "ZCL_CALC=>RUN", values: { LS_R: 0, IV: 7, RV: 14 } },
    { url: "zx.prog.abap", line: 4, depth: 1, location: "ZX", values: { LS_R: 14 } }];
  const result = build({ variable: "LS_R", steps, sources: { "zx.prog.abap": report, "zcl_calc.clas.abap": method } });
  const lines = result.formula.nodes.map(node => node.source + ":" + node.line);
  const parent = new Map(result.formula.edges.map(edge => [edge.to, edge.from]));
  for (const node of result.formula.nodes) {
    const up = result.formula.nodes.find(item => item.id === parent.get(node.id));
    const only = up && result.formula.edges.filter(edge => edge.from === up.id).length === 1;
    assert.ok(!(only && up.source && up.source === node.source && up.line === node.line), "a node repeats its parent's code: " + lines.join(", "));
  }
  assert.match(result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), /ls_r \(14\) = iv \(7\) \* 2 = 14/);
});

test("a call made again in a loop shows once per pass, without the parameter over it", () => {
  const report = ["REPORT zx.", "DATA(ls_result) = zcl_run=>run( ).", "WRITE ls_result-amount."].join("\n");
  const run = ["CLASS zcl_run IMPLEMENTATION.", "METHOD run.", "ls_context-amount = 100.", "zcl_mod=>apply( CHANGING cs_context = ls_context ).",
    "rs_result = ls_context.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const mod = ["CLASS zcl_mod IMPLEMENTATION.", "METHOD apply.", "cs_context-amount = cs_context-amount * 2.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const s = (url, line, depth, values) => ({ url, line, depth, location: url, values });
  const R = "run.clas.abap", M = "mod.clas.abap";
  const steps = [s("zx.prog.abap", 2, 1, {}), s(R, 3, 2, { LS_CONTEXT: { amount: 0 } }), s(R, 4, 2, { LS_CONTEXT: { amount: 100 } }),
    s(M, 3, 3, { LS_CONTEXT: { amount: 100 }, CS_CONTEXT: { amount: 100 } }), s(R, 4, 2, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }),
    s(M, 3, 3, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }), s(R, 5, 2, { LS_CONTEXT: { amount: 400 }, CS_CONTEXT: { amount: 400 } }),
    s("zx.prog.abap", 3, 1, { LS_RESULT: { amount: 400 } })];
  const result = build({ variable: "LS_RESULT-AMOUNT", steps, sources: { "zx.prog.abap": report, [R]: run, [M]: mod } });
  assert.ok(!result.formula.nodes.some(node => /^parameter of/.test(node.text)), result.formula.nodes.map(node => node.text).join(" | "));
  assert.equal(result.formula.nodes.filter(node => /apply/.test(node.text)).length, 2, "one node per pass of the loop");
});

test("Expression goes on through the parameter a call passed, modifier after modifier", () => {
  const report = ["REPORT zx.", "DATA(ls_result) = zcl_run=>run( ).", "WRITE ls_result-amount."].join("\n");
  const run = ["CLASS zcl_run IMPLEMENTATION.", "METHOD run.", "ls_context-amount = 100.", "zcl_mod=>apply( CHANGING cs_context = ls_context ).",
    "rs_result = ls_context.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const mod = ["CLASS zcl_mod IMPLEMENTATION.", "METHOD apply.", "cs_context-amount = cs_context-amount * 2.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const s = (url, line, depth, values) => ({ url, line, depth, location: url, values });
  const R = "run.clas.abap", M = "mod.clas.abap";
  const steps = [s("zx.prog.abap", 2, 1, {}), s(R, 3, 2, { LS_CONTEXT: { amount: 0 } }), s(R, 4, 2, { LS_CONTEXT: { amount: 100 } }),
    s(M, 3, 3, { LS_CONTEXT: { amount: 100 }, CS_CONTEXT: { amount: 100 } }), s(R, 4, 2, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }),
    s(M, 3, 3, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }), s(R, 5, 2, { LS_CONTEXT: { amount: 400 }, CS_CONTEXT: { amount: 400 } }),
    s("zx.prog.abap", 3, 1, { LS_RESULT: { amount: 400 } })];
  const result = build({ variable: "LS_RESULT-AMOUNT", steps, sources: { "zx.prog.abap": report, [R]: run, [M]: mod } });
  const formula = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(" = 400")[0];
  assert.match(formula, /ls_result-amount \(400\) = \( 100 \* 2 \) \* 2$/);
});
