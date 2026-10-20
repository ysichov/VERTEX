"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const helpers = html => ["function poolName(program){", "function recordedUnitKey(owner,unit){"].map(start =>
  html.slice(html.indexOf(start), html.indexOf("\n", html.indexOf(start)))).join("\n") + "\n";

test("a SAP recording snapshots the initial stop before stepping", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("function runVisual(){");
  const next = html.indexOf("function next(){", start);
  assert.ok(start >= 0 && next > start);
  const begin = html.slice(start, next);
  assert.match(begin, /record\(picture\.stopped\.frames\);s\.valueDue=!!chosenValue;s\.snapDue=!INITIAL\.local/);
  const snapshot = html.indexOf('if(s.snapDue&&!s.stop)', next);
  const step = html.indexOf('debug("step",{kind:"into"', next);
  assert.ok(snapshot > next && snapshot < step, "the initial scope read completes before the first step");
});

test("recorded structures expand and table rows are paged", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("var recordedOpen={},recordedPages={};");
  const end = html.indexOf("function drawRecordedVars(i){", start);
  assert.ok(start >= 0 && end > start);
  const rows = [];
  const document = {
    createElement(tag) {
      return { tag, children: [], style: {}, appendChild(child) { this.children.push(child); },
        set textContent(value) { this.text = value; }, get textContent() { return this.text; } };
    },
    createTextNode(text) { return { text }; }
  };
  const context = { document, INITIAL: { local: false }, replayAt: 0, drawRecordedVars() {}, chosenValue: null, openValueMenu() {} };
  vm.runInNewContext(helpers(html) + html.slice(start, end), context);
  const table = { appendChild(row) { rows.push(row); } };
  const structure = { amount: 9, currency: "EUR" };
  context.drawRecordedTree(table, "result", structure, 0, "result");
  assert.equal(rows.length, 1);
  rows[0].children[0].children[0].onclick();
  context.drawRecordedTree(table, "result", structure, 0, "result");
  assert.equal(rows.length, 4);
  const tableValue = Array.from({ length: 1000 }, (_, i) => ({ amount: i }));
  context.recordedOpen.lines = true;
  context.drawRecordedTree(table, "lines", tableValue, 0, "lines");
  assert.equal(rows.length, 106);
  assert.match(rows.at(-1).children[0].textContent, /900 remaining/);
  rows.at(-1).children[0].onclick();
  assert.equal(context.recordedPages.lines, 2);
});

test("local recorded structures open initially and keep an explicit collapse", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("var recordedOpen={},recordedPages={};");
  const end = html.indexOf("function drawRecordedVars(i){", start);
  const rows = [];
  const document = { createElement(tag) { return { tag, children: [], style: {}, appendChild(child) { this.children.push(child); },
    set textContent(value) { this.text = value; }, get textContent() { return this.text; } }; },
    createTextNode(text) { return { text }; } };
  const context = { document, INITIAL: { local: true }, replayAt: 0, drawRecordedVars() {}, chosenValue: null, openValueMenu() {} };
  vm.runInNewContext(html.slice(start, end), context);
  const table = { appendChild(row) { rows.push(row); } };
  context.drawRecordedTree(table, "ls_result", { amount: 12, currency: "EUR" }, 0, "Locals/ls_result");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].children[0].children[0].textContent, "v");
  rows[0].children[0].children[0].onclick();
  rows.length = 0;
  context.drawRecordedTree(table, "ls_result", { amount: 12, currency: "EUR" }, 0, "Locals/ls_result");
  assert.equal(rows.length, 1);
});

test("local recorded steps populate the step log", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("var steplog={rows:[],ended:null,closed:false}");
  const end = html.indexOf("function drawLog(){", start);
  const context = { INITIAL: { local: true }, flow: { timeline: [
    { cur: { owner: "ZREPORT" }, at: { url: "report.abap", line: 10 }, stack: [{}] },
    { cur: { owner: "ZCL_CALC" }, at: { url: "calc.abap", line: 3 }, stack: [{}, {}] }
  ] }, texts: { "report.abap": Array(9).fill("").concat("DATA(lv_x) = 1."),
    "calc.abap": ["", "", "rv_result = lv_x."] }, norm: value => value, logFilter: "" };
  vm.runInNewContext(html.slice(start, end), context);
  assert.equal(context.allLogRows().length, 2);
  assert.equal(context.shownRows()[1].detail, "rv_result = lv_x.");
  context.logFilter = "ZCL_CALC";
  assert.equal(context.shownRows().length, 1);
});

test("fast replay reveals only the final source after the slider settles", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("var revealTimer=null;");
  const end = html.indexOf("function showStop(i){", start);
  const timers = new Map(), revealed = [];
  let next = 0;
  const context = { document: { body: { classList: { contains: () => true } } }, playing: null,
    sdeReveal: frame => revealed.push(frame),
    setTimeout: fn => { const id = ++next; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(html.slice(start, end), context);
  const stop = line => ({ at: { url: "report.abap", line }, stack: [{ program: "ZREPORT" }] });
  context.revealInEditor(stop(15));
  context.revealInEditor(stop(10));
  assert.equal(timers.size, 1);
  for (const [id, fn] of timers) { timers.delete(id); fn(); }
  assert.equal(revealed.length, 1);
  assert.equal(revealed[0].line, 10);
  context.playing = {};
  context.revealInEditor(stop(20));
  assert.equal(timers.size, 0, "automatic playback does not queue another source change");
});

test("a completed value slice redraws BSE and formula after an earlier render", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("var flowBusy=false,flowAgain=false,flowDone=null;");
  const end = html.indexOf("/* Formula and Expression from the record", start);
  let version = 1, releaseFirst, active = 0, maxActive = 0;
  const drawn = [], element = () => ({ classList: { toggle() {} }, hidden: false });
  const context = { flow: { timeline: [{ at: { url: "report.abap" } }] }, staticFlow: null,
    texts: { "report.abap": ["REPORT zreport."] }, norm: value => value, paneOn: () => true,
    $: element, flowGrouping: "classes", flowMode: "logic", loadMermaid: () => Promise.resolve(),
    mermaid: { initialize() {} }, darkPane: () => false, buildReading: () => ({ version, bseFlow: {}, maxStack: 1 }),
    withRecordFormula: data => { active++; maxActive = Math.max(maxActive, active);
      return (data.version === 1 ? new Promise(resolve => { releaseFirst = resolve; }) : Promise.resolve(data))
        .then(answer => { active--; return answer; }); },
    document: { body: { classList: { add() {} } } },
    window: { vertexFlow: { redraw: data => drawn.push(data.version) } },
    openRecordFlow() {}, markNow() {}, failed: error => { throw error; } };
  vm.runInNewContext(html.slice(start, end), context);
  const first = context.showFlow();
  for (let i = 0; i < 10 && !releaseFirst; i++) await Promise.resolve();
  assert.ok(releaseFirst);
  version = 2;
  context.showFlow();
  releaseFirst({ version: 1, bseFlow: {}, maxStack: 1 });
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxActive, 1);
  assert.equal(drawn.at(-1), 2, "the value and slice available after the first render win");
});

test("Follow opens the completed BSE only after its flow has rendered", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("function fetchSlice(){");
  const end = html.indexOf("function pointsFromBse(){", start);
  let finishRender, clicked = false, rendered = false;
  const bse = { classList: { contains: () => false }, click: () => { clicked = true; assert.equal(rendered, true); } };
  const context = { chosenValue: { name: "LS_RESULT-AMOUNT" }, bseAfterFollow: true,
    sliceFor: "", sliceAsked: null, sliceSeq: 0,
    slicePoints: null, sdeOrigin() {}, originLine: () => 16,
    object: { name: "ZVERTEX_DEBUG_LAB", type: "PROG" }, notice() {},
    askOrigin: () => Promise.resolve({ points: [{ name: "ZVERTEX_DEBUG_LAB", line: 15 }] }),
    flow: { timeline: [{}] }, sliceStops: () => ({ 0: true }),
    drawChosen() {}, publishDebugContext() {}, paneOn: () => true, staticFlow: null,
    showFlow: () => new Promise(resolve => { finishRender = () => { rendered = true; resolve(); }; }),
    document: { querySelector: () => bse } };
  vm.runInNewContext(html.slice(start, end), context);
  const answer = context.fetchSlice();
  for (let i = 0; i < 10 && !finishRender; i++) await Promise.resolve();
  assert.ok(finishRender);
  assert.equal(clicked, false);
  finishRender();
  await answer;
  assert.equal(clicked, true);
});

test("a recorded result supplies Expression even when the static path has an empty one", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("function withRecordFormula(data){");
  const end = html.indexOf('$("fvalues").onclick=', start);
  const context = { chosenValue: { name: "LS_RESULT-AMOUNT" }, flow: { timeline: [{}] },
    $: () => ({ hidden: false, classList: { contains: () => true } }), sdeOrigin() {},
    recordSteps: () => [{ url: "report.abap", line: 15, location: "REPORT=>START", values: {} }],
    texts: { "report.abap": ["REPORT report."] }, norm: value => value, replayAt: null,
    INITIAL: { local: true }, localEnded: true, picture: {}, notice() {},
    askOrigin: request => Promise.resolve(request.recordFormula ? { hasValues: true,
      formula: { nodes: [{ id: "result", text: "amount", label: "amount = 42" }], edges: [], maxLevel: 0 },
      panes: { formula: "recorded formula", expression: "recorded expression" } } : { panes: { expression: "" } }) };
  vm.runInNewContext(html.slice(start, end), context);
  const result = await context.withRecordFormula({ panes: { formula: "static formula", expression: "" } });
  assert.equal(result.panes.formula, "recorded formula");
  assert.equal(result.panes.expression, "recorded expression");
});

test("recorded SY values obey the SYST switch", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("function drawRecordedVars(i){");
  const end = html.indexOf("/* One stop into the record", start);
  const element = tag => ({ tag, children: [], appendChild(child) { this.children.push(child); },
    set textContent(value) { this.text = value; if (value === "") this.children = []; }, get textContent() { return this.text; } });
  const box = element("div");
  let systOn = false;
  const context = { document: { createElement: element }, $: id => id === "vars" ? box
    : { classList: { contains: () => systOn } }, INITIAL: { local: true },
    flow: { timeline: [{ cur: { owner: "ZREPORT", name: "START" }, vars: [
      { name: "Locals", children: [{ name: "X", value: 1 }] },
      { name: "SY", children: [{ name: "SY-SUBRC", value: 0 }] }
    ] }] }, groupOn: () => true, drawRecordedTree() {} };
  vm.runInNewContext(html.slice(start, end), context);
  context.drawRecordedVars(0);
  assert.equal(box.children[0].children.length, 1);
  systOn = true;
  context.drawRecordedVars(0);
  assert.equal(box.children[0].children.length, 2);
});

test("a delayed empty restore does not erase a newer recorded run", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("function localResult(result){");
  const end = html.indexOf("/* Run in SAP:", start);
  const existing = { timeline: [{ at: { line: 16 } }] };
  const context = { picture: { traceLength: 1 }, flow: existing, document: { body: { classList: { contains: () => false } } },
    $: () => ({ hidden: false, childNodes: [] }) };
  vm.runInNewContext(html.slice(start, end), context);
  context.localResult({ trace: [] });
  assert.equal(context.flow, existing);
});

test("a recorded run restores after a failed interim picture draw", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("var localRestorePending=false;");
  const end = html.indexOf("/* ---------- the window's parts list", start);
  const restored = [];
  const context = { INITIAL: { local: true }, localFetching: false, series: null, replayAt: null,
    picture: {}, flow: { timeline: [] }, JSON, debug: () => Promise.resolve({ trace: [{ line: 16 }] }),
    localResult: result => restored.push(result.trace[0].line), apply: () => { throw new Error("interim variables"); },
    failed: () => {} };
  vm.runInNewContext(html.slice(start, end), context);
  context.sdeDebugEvent('{"traceLength":1}');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(restored, [16]);
});

test("class diagram includes callers from the recorded ABAP stack", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("function callGraph(byOwner){");
  const end = html.indexOf("/* Where the chosen value changed", start);
  assert.ok(start >= 0 && end > start);
  const timeline = [{ cur: { owner: "ZCL_PRICE_ROAD", name: "CALCULATE_BASE" },
    at: { url: "road.abap", line: 20 }, stack: [
      { program: "ZCL_PRICE_ROAD", unit: "CALCULATE_BASE", line: 20 },
      { program: "ZCL_CALC_FACADE", unit: "RUN", line: 31 },
      { program: "ZVERTEX_DEBUG_LAB", unit: "ZVERTEX_DEBUG_LAB", line: 19 }
    ] }];
  const context = { flow: { timeline } };
  vm.runInNewContext(helpers(html) + html.slice(start, end), context);
  const graph = context.callGraph(true);
  assert.deepEqual(Array.from(graph.order), ["ZVERTEX_DEBUG_LAB", "ZCL_CALC_FACADE", "ZCL_PRICE_ROAD"]);
  assert.ok(graph.edges["ZVERTEX_DEBUG_LAB>ZCL_CALC_FACADE"]);
  assert.ok(graph.edges["ZCL_CALC_FACADE>ZCL_PRICE_ROAD"]);
});

test("statement diagram connects nested routines of the same class", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "latin1");
  const start = html.indexOf("function stepFlow(){");
  const end = html.indexOf("/* The running block, green", start);
  assert.ok(start >= 0 && end > start);
  const frame = (program, unit, line) => ({ program, unit, include: program, line, url: program + ".abap" });
  const root = frame("ZREPORT", "ZREPORT", 5);
  const run = frame("ZCL_FACADE", "RUN", 15);
  const nested = frame("ZCL_FACADE", "MODIFIER_FOR", 25);
  const timeline = [
    { stack: [root], cur: { owner: root.program, name: root.unit }, at: { url: root.url, line: root.line } },
    { stack: [nested, run, root], cur: { owner: nested.program, name: nested.unit }, at: { url: nested.url, line: nested.line } }
  ];
  const context = { flow: { timeline }, stepKey: t => t.cur.owner + "=>" + t.cur.name + ":" + t.at.line,
    stepText: f => f.program + ":" + f.line, shapeIn: () => null, closesBlock: () => false };
  vm.runInNewContext(helpers(html) + html.slice(start, end), context);
  const graph = context.stepFlow();
  // RUN is entered from the recorded statement that called it.
  assert.ok(graph.edges["ZREPORT=>ZREPORT:5>m|ZCL_FACADE=>RUN"]);
  assert.ok(graph.edges["m|ZCL_FACADE=>RUN>m|ZCL_FACADE=>MODIFIER_FOR"]);
  assert.ok(graph.edges["m|ZCL_FACADE=>MODIFIER_FOR>ZCL_FACADE=>MODIFIER_FOR:25"]);
});
