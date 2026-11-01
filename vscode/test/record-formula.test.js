"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("../record-formula");

const page = fs.readFileSync(path.join(__dirname, "../pages/visual-debug.html"), "utf8");
const part = (from, to) => page.slice(page.indexOf(from), page.indexOf(to));
// Expression's default view - the formula, its where and its rule - without the one-line view behind Optimized.
const stepView = html => html.replace(/<div class="rf-inline">[^]*?<\/div>/, "");

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

test("Expression is the statement that made the value, with the values it read; a literal is not opened", () => {
  const text = ["REPORT zx.", "DATA(lv_base) = 5.", "DATA(lv_qty) = 2.", "DATA(lv_total) = ( lv_base + 1 ) * lv_qty.", "WRITE lv_total."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values });
  const steps = [at(2, {}), at(3, { LV_BASE: 5 }), at(4, { LV_BASE: 5, LV_QTY: 2 }), at(5, { LV_BASE: 5, LV_QTY: 2, LV_TOTAL: 12 })];
  const result = build({ variable: "LV_TOTAL", steps, sources: { "zx.prog.abap": text } });
  const plain = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(plain, /lv_total \(12\) = \( lv_base \(5\) \+ 1 \) \* lv_qty \(2\) = 12/);
  assert.doesNotMatch(result.panes.expression, /expression-decode/, "lv_base and lv_qty are literals: nothing to explain");
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
  assert.match(plain, /lv_total = \( lv_base \+ 1 \) \* lv_qty/);
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
  assert.match(formula, /ls_result-amount \(119\) = cs_context-amount \(100\) \+ cs_context-tax \(19\) where cs_context-tax \(19\) = cs_context-amount \(100\) \* lv_rate \(0\.19\) = 119/);
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

test("Expression's where goes on through the parameter a call passed, modifier after modifier", () => {
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
  const plain = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(plain, /ls_result-amount \(400\) = cs_context-amount₂ \(200\) \* 2 where cs_context-amount₂ \(200\) = cs_context-amount₁ \(100\) \* 2 the same as one rule: the first value and the rates, the sums in between folded in ls_result-amount \(400\) = cs_context-amount₁ \(100\) × 2 × 2 = 400 /);
});

test("Expression's where opens each computed value once, and only values of several terms", () => {
  const text = ["REPORT zx.", "DATA(lv_a) = 100.", "lv_a = lv_a + lv_a * lv_f.", "DATA(lv_x) = lv_a * lv_r.", "lv_a = lv_a + lv_x.", "WRITE lv_a."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_F: "0.5", LV_R: "0.1" }, values) });
  const steps = [at(2, {}), at(3, { LV_A: 100 }), at(4, { LV_A: 150 }), at(5, { LV_A: 150, LV_X: 15 }), at(6, { LV_A: 165, LV_X: 15 })];
  const result = build({ variable: "LV_A", steps, sources: { "zx.prog.abap": text } });
  const plain = stepView(result.panes.expression).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(" Where the values")[0];
  assert.match(plain, /^ lv_a₃ \(165\) = lv_a₂ \(150\) \+ lv_x \(15\) where [^]* the same as one rule: the first value and the rates, the sums in between folded in lv_a₃ \(165\) = lv_a₁ \(100\) × \( 1 \+ lv_f \(0\.5\) \) × \( 1 \+ lv_r \(0\.1\) \) = 165$/);
  assert.match(plain, /lv_a₂ \(150\) = lv_a₁ \(100\) \+ lv_a₁ \(100\) \* lv_f \(0\.5\)/, "lv_a₁ (100) is a literal: not opened");
  assert.match(plain, /lv_x \(15\) = lv_a₂ \(150\) \* lv_r \(0\.1\)/);
  // lv_x reads the lv_a of line 3, opened just above: it is not opened a second time.
  assert.equal(plain.split("lv_a₂ (150) =").length - 1, 1);
});

test("Expression's where nests: a computed value of a computed value is opened under it", () => {
  const text = ["REPORT zx.", "DATA(lv_a) = lv_w + 1.", "DATA(lv_x) = lv_a * 2.", "DATA(lv_y) = lv_x + 3.", "WRITE lv_y."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_W: "4" }, values) });
  const steps = [at(2, {}), at(3, { LV_A: 5 }), at(4, { LV_A: 5, LV_X: 10 }), at(5, { LV_A: 5, LV_X: 10, LV_Y: 13 })];
  const html = stepView(build({ variable: "LV_Y", steps, sources: { "zx.prog.abap": text } }).panes.expression);
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(plain, /lv_y \(13\) = lv_x \(10\) \+ 3 where lv_x \(10\) = lv_a \(5\) \* 2 lv_a \(5\) = lv_w \(4\) \+ 1 = 13 Where/);
  // lv_a's line is the next level of lv_x's, folded under its arrow - not beside it.
  const decode = html.slice(html.indexOf('<ul class="expression-decode">'));
  assert.match(decode, /^<ul class="expression-decode"><li class="more"><details><summary><code>[^]*?>lv_x<[^]*?<\/summary><ul class="expression-decode"><li><code>[^]*?>lv_a<[^]*?<\/li><\/ul><\/details><\/li><\/ul>/);
});

test("Expression writes a decimal comma as a point", () => {
  const text = ["REPORT zx.", "DATA(lv_b) = lv_w * lv_p.", "DATA(lv_t) = lv_b * 2.", "WRITE lv_t."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_W: "1200,000", LV_P: "5.42" }, values) });
  const steps = [at(2, {}), at(3, { LV_B: "6504,000" }), at(4, { LV_B: "6504,000", LV_T: "13008,00" })];
  const result = build({ variable: "LV_T", steps, sources: { "zx.prog.abap": text } });
  const plain = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(" Where the values")[0];
  assert.match(plain, /lv_t \(13008\) = lv_b \(6504\) \* 2 where lv_b \(6504\) = lv_w \(1200\) \* lv_p \(5\.42\) = 13008/);
});

test("Expression numbers a name read with several values, by the order they were made", () => {
  const text = ["REPORT zx.", "DATA(lv_a) = lv_w * 2.", "lv_a = lv_a + lv_a * lv_f.", "lv_a = lv_a + lv_a * lv_r.", "WRITE lv_a."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_W: "50", LV_F: "0.5", LV_R: "0.1" }, values) });
  const steps = [at(2, {}), at(3, { LV_A: 100 }), at(4, { LV_A: 150 }), at(5, { LV_A: 165 })];
  const plain = stepView(build({ variable: "LV_A", steps, sources: { "zx.prog.abap": text } }).panes.expression)
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(" Where the values")[0];
  // The values of lv_a follow one another on one level of where - a list, not a staircase.
  assert.match(plain, /^ lv_a₃ \(165\) = lv_a₂ \(150\) \+ lv_a₂ \(150\) \* lv_r \(0\.1\) where lv_a₂ \(150\) = lv_a₁ \(100\) \+ lv_a₁ \(100\) \* lv_f \(0\.5\) lv_a₁ \(100\) = lv_w \(50\) \* 2 the same as one rule: the first value and the rates, the sums in between folded in lv_a₃ \(165\) = lv_a₁ \(100\) × \( 1 \+ lv_f \(0\.5\) \) × \( 1 \+ lv_r \(0\.1\) \) where lv_a₁ \(100\) = lv_w \(50\) \* 2 = 165$/);
  // A name with one value gets no number.
  assert.doesNotMatch(plain, /lv_[wfr][₀-₉]/);
});

test("Expression's product: one variable built up through routines; a plain local name of two routines is not numbered", () => {
  const report = ["REPORT zx.", "DATA(ls_result) = zcl_run=>run( ).", "WRITE ls_result-amount."].join("\n");
  const run = ["CLASS zcl_run IMPLEMENTATION.", "METHOD run.", "ls_context-amount = 100.", "zcl_a=>apply( CHANGING cs_context = ls_context ).",
    "zcl_b=>apply( CHANGING cs_context = ls_context ).", "rs_result = ls_context.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const mod = rate => ["CLASS zcl_m IMPLEMENTATION.", "METHOD apply.", "DATA(lv_p) = " + rate + ".", "cs_context-amount = cs_context-amount * lv_p.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const s = (url, line, depth, values) => ({ url, line, depth, location: url, values });
  const R = "run.clas.abap", A = "a.clas.abap", B = "b.clas.abap";
  const steps = [s("zx.prog.abap", 2, 1, {}), s(R, 3, 2, { LS_CONTEXT: { amount: 0 } }), s(R, 4, 2, { LS_CONTEXT: { amount: 100 } }),
    s(A, 3, 3, { LS_CONTEXT: { amount: 100 }, CS_CONTEXT: { amount: 100 } }), s(A, 4, 3, { LS_CONTEXT: { amount: 100 }, CS_CONTEXT: { amount: 100 }, LV_P: 2 }),
    s(R, 5, 2, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }),
    s(B, 3, 3, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }), s(B, 4, 3, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 }, LV_P: 3 }),
    s(R, 6, 2, { LS_CONTEXT: { amount: 600 }, CS_CONTEXT: { amount: 600 } }), s("zx.prog.abap", 3, 1, { LS_RESULT: { amount: 600 } })];
  const result = build({ variable: "LS_RESULT-AMOUNT", steps, sources: { "zx.prog.abap": report, [R]: run, [A]: mod(2), [B]: mod(3) } });
  const plain = result.panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(" Where the values")[0];
  assert.match(plain, /ls_result-amount \(600\) = cs_context-amount₁ \(100\) × lv_p \(2\) × lv_p \(3\) = 600/);
  assert.doesNotMatch(plain, /lv_p[₀-₉]/, "the lv_p of zcl_a and of zcl_b are two variables");
});

test("Expression's product keeps what a step adds besides the value, and says when there is none", () => {
  const text = ["REPORT zx.", "DATA(lv_a) = lv_w * 2.", "lv_a = lv_a + lv_a * lv_f.", "DATA(lv_d) = ( lv_a - lv_t ) * lv_r.", "lv_a = lv_a - lv_d.", "WRITE lv_a."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_W: "50", LV_F: "0.5", LV_R: "0.1", LV_T: "10" }, values) });
  const steps = [at(2, {}), at(3, { LV_A: 100 }), at(4, { LV_A: 150 }), at(5, { LV_A: 150, LV_D: 14 }), at(6, { LV_A: 136, LV_D: 14 })];
  const plain = build({ variable: "LV_A", steps, sources: { "zx.prog.abap": text } }).panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // 150 - (150 - 10) * 0.1 = 150 * (1 - 0.1) + 10 * 0.1 = 136
  assert.match(plain, /lv_a₃ \(136\) = \( lv_a₁ \(100\) × \( 1 \+ lv_f \(0\.5\) \) × \( 1 − lv_r \(0\.1\) \) \+ lv_t \(10\) × lv_r \(0\.1\) \) where lv_a₁ \(100\) = lv_w \(50\) \* 2 = 136/);
  // where follows the formula lv_a₂ - lv_d: lv_a₂ and lv_d side by side; lv_a₁, which lv_a₂ reads, folded under lv_a₂.
  const html = build({ variable: "LV_A", steps, sources: { "zx.prog.abap": text } }).panes.expression;
  assert.match(html, /<li class="more"><details><summary><code><button[^>]*>lv_a₂<\/button>[^]*?<\/summary><ul class="expression-decode"><li><code><button[^>]*>lv_a₁<\/button>[^]*?<\/ul><\/details><\/li><li><code><button[^>]*>lv_d<\/button>/);
  const round = ["REPORT zx.", "DATA(lv_a) = lv_w * 2.", "lv_a = lv_a + lv_a * lv_f.", "lv_a = round( val = lv_a dec = 0 ).", "WRITE lv_a."].join("\n");
  const none = build({ variable: "LV_A", steps: [at(2, {}), at(3, { LV_A: 100 }), at(4, { LV_A: 150 }), at(5, { LV_A: 151 })], sources: { "zx.prog.abap": round } })
    .panes.expression.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(none, /No product: lv_a = round\( val = lv_a dec = 0 \)\. is not a sum or product of lv_a - it reads round\./);
});

test("Expression shows a value at four decimals at most, the whole value on hover", () => {
  const text = ["REPORT zx.", "DATA(lv_b) = lv_w * lv_p.", "WRITE lv_b."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_W: "9124.006319999999", LV_P: "0.08930232558139543" }, values) });
  const html = build({ variable: "LV_B", steps: [at(2, {}), at(3, { LV_B: "814.8048214883720" })], sources: { "zx.prog.abap": text } }).panes.expression;
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(plain, /lv_b \(814\.8048\) = lv_w \(9124\.0063\) \* lv_p \(0\.0893\) = 814\.8048/);
  assert.match(html, /title="0\.08930232558139543"/);
  assert.match(html, /title="814\.804821488372"/);
});

test("Behind Optimized, Expression is one line: each value written out, a value written out once named", () => {
  const text = ["REPORT zx.", "DATA(lv_a) = 100.", "lv_a = lv_a + lv_a * lv_f.", "DATA(lv_x) = lv_a * lv_r.", "lv_a = lv_a + lv_x.", "WRITE lv_a."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_F: "0.5", LV_R: "0.1" }, values) });
  const steps = [at(2, {}), at(3, { LV_A: 100 }), at(4, { LV_A: 150 }), at(5, { LV_A: 150, LV_X: 15 }), at(6, { LV_A: 165, LV_X: 15 })];
  const html = build({ variable: "LV_A", steps, sources: { "zx.prog.abap": text } }).panes.expression;
  assert.match(html, /^<div class="rf-step">[^]*<\/div><div class="rf-inline">/, "both views are there, the page shows one");
  const inline = html.slice(html.indexOf('<div class="rf-inline">')).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").split(" Where the values")[0];
  // lv_x reads the lv_a of line 3, already written out on the left: it is named with its value, not derived again.
  assert.match(inline, /^ lv_a₃ \(165\) = \( 100 \+ 100 \* lv_f \(0\.5\) \) \+ \( lv_a₂ \(150\) \* lv_r \(0\.1\) \) where lv_a₂ \(150\) = lv_a₁ \(100\) \+ lv_a₁ \(100\) \* lv_f \(0\.5\) = 165/);
});

test("a recorded calculation of zero still has a formula and source colour", () => {
  const text = ["REPORT zx.", "DATA(lv_result) = lv_price * 0.", "WRITE lv_result."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values });
  const result = build({ variable: "LV_RESULT", steps: [at(2, { LV_PRICE: 100, LV_RESULT: 0 }), at(3, { LV_PRICE: 100, LV_RESULT: 0 })], sources: { "zx.prog.abap": text } });
  assert.equal(result.tree.outside, undefined);
  assert.match(result.panes.expression, /lv_result<\/button><span class="rf-value"> \(0\)<\/span>[^]*lv_price<span class="rf-value"> \(100\)<\/span>[^]*rf-number">0<\/span>/);
});

test("recorded Expression colours source keywords, numbers and strings without changing value links", () => {
  const text = ["REPORT zx.", "DATA(lv_x) = COND i( WHEN lv_flag = 'Y' THEN 12 ELSE 0 ).", "WRITE lv_x."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values });
  const html = build({ variable: "LV_X", steps: [at(2, { LV_FLAG: "Y" }), at(3, { LV_FLAG: "Y", LV_X: 12 })], sources: { "zx.prog.abap": text } }).panes.expression;
  assert.match(html, /class="rf-keyword">(?:COND|WHEN|THEN|ELSE)</);
  assert.match(html, /class="rf-string">'Y'<\/span>/);
  assert.match(html, /class="rf-number">12<\/span>/);
  assert.match(html, /class="data-composed"/);
});

test("a value a SELECT left empty is red, with why: found nothing by its sy-subrc, or found an empty field", () => {
  const text = ["REPORT zx.", "SELECT SINGLE price FROM ztab WHERE id = 1 INTO @DATA(lv_p).", "DATA(lv_t) = lv_p * 2 + lv_q.", "WRITE lv_t."].join("\n");
  const at = (line, values, subrc) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_Q: "1" }, values), subrc });
  const run = subrc => build({ variable: "LV_T", steps: [at(2, {}, subrc), at(3, { LV_P: "0" }), at(4, { LV_P: "0", LV_T: "1" })], sources: { "zx.prog.abap": text } }).panes.expression;
  assert.match(run("4"), /<span class="rf-empty" title="SELECT found nothing \(sy-subrc 4\): the value stayed as it was"><button[^>]*>lv_p<\/button><span class="rf-value"> \(0\)<\/span><\/span>/);
  assert.match(run("0"), /<span class="rf-empty" title="SELECT found a row whose field is empty \(sy-subrc 0\)">/);
  assert.match(run(undefined), /<span class="rf-empty" title="SELECT gave an empty value">/);
  assert.doesNotMatch(run("4"), /rf-empty[^>]*>[^]*?>lv_q</, "a value that did not come from a SELECT stays as it is");
});

test("a value read empty that the run sets later is red: read before it was set", () => {
  const text = ["REPORT zx.", "DATA(lv_d) = ( lv_a - lv_t ) * 2.", "lv_t = lv_a * 3.", "DATA(lv_r) = lv_d + lv_t.", "WRITE lv_r."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LV_A: "5", LV_T: "0" }, values) });
  const steps = [at(2, {}), at(3, { LV_D: "10" }), at(4, { LV_D: "10", LV_T: "15" }), at(5, { LV_D: "10", LV_T: "15", LV_R: "25" })];
  const html = build({ variable: "LV_R", steps, sources: { "zx.prog.abap": text } }).panes.expression;
  assert.match(html, /<span class="rf-empty" title="Read before it was set: the run sets lv_t later, at stop 2"><button class="data-composed" title="Read here before it was set: ZX:2 · stop 1"[^>]*data-line="2" data-stop="0">lv_t₁<\/button><span class="rf-value"> \(0\)<\/span><\/span>/,
    "its link leads to the statement that read it, at the step it read it");
  // where explains it: under the line that read it, what it was then and the statement that set it later.
  const where = html.slice(html.indexOf('<p class="edge">where</p>'), html.indexOf('<div class="rf-inline">')).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(where, /lv_d \(10\) = \( lv_a \(5\) - lv_t₁ \(0\) \) \* 2 lv_t₁ \(0\) Read before it was set: the run sets lv_t later, at stop 2 \(above\) lv_t₂ \(15\) = lv_a \(5\) \* 3/);
});

test("a modifier that leaves the value as it was does not cut the chain: the call passed it on unchanged", () => {
  const report = ["REPORT zx.", "DATA(ls_result) = zcl_run=>run( ).", "WRITE ls_result-amount."].join("\n");
  const run = ["CLASS zcl_run IMPLEMENTATION.", "METHOD run.", "ls_context-amount = 100.", "zcl_a=>apply( CHANGING cs_context = ls_context ).",
    "zcl_b=>apply( CHANGING cs_context = ls_context ).", "rs_result = ls_context.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const double = ["CLASS zcl_a IMPLEMENTATION.", "METHOD apply.", "cs_context-amount = cs_context-amount * 2.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const none = ["CLASS zcl_b IMPLEMENTATION.", "METHOD apply.", "IF 1 = 2.", "cs_context-amount = 0.", "ENDIF.", "ENDMETHOD.", "ENDCLASS."].join("\n");
  const s = (url, line, depth, values) => ({ url, line, depth, location: url, values });
  const R = "run.clas.abap", A = "a.clas.abap", B = "b.clas.abap";
  const steps = [s("zx.prog.abap", 2, 1, {}), s(R, 3, 2, { LS_CONTEXT: { amount: 0 } }), s(R, 4, 2, { LS_CONTEXT: { amount: 100 } }),
    s(A, 3, 3, { LS_CONTEXT: { amount: 100 }, CS_CONTEXT: { amount: 100 } }), s(R, 5, 2, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }),
    s(B, 3, 3, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }), s(R, 6, 2, { LS_CONTEXT: { amount: 200 }, CS_CONTEXT: { amount: 200 } }),
    s("zx.prog.abap", 3, 1, { LS_RESULT: { amount: 200 } })];
  const html = stepView(build({ variable: "LS_RESULT-AMOUNT", steps, sources: { "zx.prog.abap": report, [R]: run, [A]: double, [B]: none } }).panes.expression);
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(plain, /ls_result-amount \(200\) = cs_context-amount \(100\) \* 2 = 200/, "the value comes from zcl_a, through zcl_b that left it as it was");
});

test("a name of the formula carries the stop its statement ran at, for the player to go to", () => {
  const text = ["REPORT zx.", "DATA(lv_base) = 5.", "DATA(lv_qty) = 2.", "DATA(lv_total) = ( lv_base + 1 ) * lv_qty.", "WRITE lv_total."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values });
  const steps = [at(2, {}), at(3, { LV_BASE: 5 }), at(4, { LV_BASE: 5, LV_QTY: 2 }), at(5, { LV_BASE: 5, LV_QTY: 2, LV_TOTAL: 12 })];
  const html = build({ variable: "LV_TOTAL", steps, sources: { "zx.prog.abap": text } }).panes.expression;
  assert.match(html, /data-line="3" data-stop="1">lv_qty</);
  assert.match(html, /data-line="4" data-stop="2">lv_total</);
});

test("a field left empty when its structure was filled, and set later, is read before it was set", () => {
  const text = ["REPORT zx.", "ls_c = ls_src.", "DATA(lv_d) = ( ls_c-a - ls_c-t ) * 2.", "ls_c-t = ls_c-a * 3.", "DATA(lv_r) = lv_d + ls_c-t.", "WRITE lv_r."].join("\n");
  const at = (line, values) => ({ url: "zx.prog.abap", line, depth: 1, location: "ZX", values: Object.assign({ LS_SRC: { a: "5", t: "0" } }, values) });
  const steps = [at(2, {}), at(3, { LS_C: { a: "5", t: "0" } }), at(4, { LS_C: { a: "5", t: "0" }, LV_D: "10" }),
    at(5, { LS_C: { a: "5", t: "15" }, LV_D: "10" }), at(6, { LS_C: { a: "5", t: "15" }, LV_D: "10", LV_R: "25" })];
  const html = build({ variable: "LV_R", steps, sources: { "zx.prog.abap": text } }).panes.expression;
  assert.match(html, /<span class="rf-empty" title="Read before it was set: the run sets ls_c-t later, at stop 3"><button[^>]*>ls_c-t₁<\/button><span class="rf-value"> \(0\)<\/span><\/span>/);
});
