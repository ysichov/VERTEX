"use strict";
const flowGraph = require("../../org.vertex.abap.ui/resources/vertex-flow-graph.js");
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), path = require("node:path");
const page = require("node:fs").readFileSync(path.resolve(__dirname, "../pages/visual-debug.html"), "utf8");
const part = (from, to) => page.slice(page.indexOf(from), page.indexOf(to));

test("a value is followed from the row's menu, not by a click on it", () => {
  const nodes = {}, listeners = {}, chosen = [];
  const node = id => nodes[id] || (nodes[id] = { id, style: {}, classList: { on: false, add() { this.on = true; }, remove() { this.on = false; } } });
  const context = vm.createContext({ failed() {}, $: node, window: { innerWidth: 800, innerHeight: 600 },
    document: { addEventListener: (type, fn) => { listeners[type] = fn; } }, chosenValue: null,
    chooseValue: name => chosen.push(name) });
  vm.runInContext(part("var menuFor=", "function chooseValue(name){"), context);

  vm.runInContext('openValueMenu("LS_ORDER-ITEM", 100, 200)', context);
  assert.equal(nodes.vfollow.textContent, "Follow LS_ORDER-ITEM in the analysis");
  assert.equal(nodes.vmenu.classList.on, true);
  assert.equal(nodes.vmenu.style.left, "100px");
  nodes.vfollow.onclick();
  assert.deepEqual(chosen, ["LS_ORDER-ITEM"]);
  assert.equal(nodes.vmenu.classList.on, false);

  context.chosenValue = { name: "LS_ORDER-ITEM" };
  vm.runInContext('openValueMenu("LS_ORDER-ITEM", 100, 200)', context);
  assert.equal(nodes.vfollow.textContent, "Stop following LS_ORDER-ITEM");
  nodes.vfollow.onclick();
  assert.deepEqual(chosen, ["LS_ORDER-ITEM", ""]);

  const copied = [];
  context.debug = (command, args) => { copied.push([command, args.text]); return Promise.resolve({}); };
  vm.runInContext('openValueMenu("LS_RESULT-AMOUNT", 5, 5, "12.50")', context);
  nodes.vcopyvalue.onclick();
  vm.runInContext('openValueMenu("LS_RESULT-AMOUNT", 5, 5, "12.50")', context);
  nodes.vcopyname.onclick();
  assert.deepEqual(copied, [["copy", "12.50"], ["copy", "LS_RESULT-AMOUNT"]]);
  assert.equal(nodes.vmenu.classList.on, false);

  vm.runInContext('openValueMenu("X", 1, 1)', context);
  listeners.mousedown({ target: { closest: () => null } });
  assert.equal(nodes.vmenu.classList.on, false, "a click elsewhere closes it");
});

test("a row in Variables follows no value on a click", () => {
  const rows = part("    n.title=path+", "    var type=shownType(");
  assert.match(rows, /oncontextmenu/);
  assert.doesNotMatch(rows, /n\.onclick/);
});

test("the stats line gives the average steps per second", () => {
  const out = {};
  const context = vm.createContext({ $: () => out, picture: { stopped: { frames: [1, 2, 3, 4] } }, lastStats: null,
    Date: { now: () => 25600 } });
  vm.runInContext(part("function drawStats(s){", "function runVisual(){"), context);
  vm.runInContext("drawStats({steps:36,predicted:0,t0:0})", context);
  assert.match(out.textContent, /^36 steps \(0 predicted\) · depth 4 · 25\.6 s · 1\.4 steps\/s on average/);
  vm.runInContext("drawStats({steps:0,predicted:0,t0:25600})", context);
  assert.doesNotMatch(out.textContent, /steps\/s/, "no rate before a step or a second has passed");
});

test("a stop of the record on a statement of the slice marks its class and routine, whatever the reading", () => {
  const points = new Set(["ZVERTEX_DEBUG_LAB:10", "ZCL_MOD_FUEL:15"]);
  const context = vm.createContext({ inSlice: (owner, line) => points.has(String(owner).toUpperCase() + ":" + line),
    flow: { timeline: [
      { stack: [{ program: "ZVERTEX_DEBUG_LAB", line: 10 }], cur: { owner: "ZVERTEX_DEBUG_LAB" } },
      { stack: [{ program: "ZCL_MOD_FUEL=====CP", line: 17 }], cur: { owner: "ZCL_MOD_FUEL" } },
      { stack: [{ program: "ZCL_MOD_FUEL=====CP", line: 15 }], cur: { owner: "ZCL_MOD_FUEL" } },
      { stack: [] }] } });
  vm.runInContext(part("function sliceStops(", "function sharedFlowGraph(mode){"), context);
  assert.deepEqual(Object.keys(vm.runInContext("sliceStops()", context)), ["0", "2"]);
});

test("a source link of the diagram moves the editor when docked, and the window's own pane otherwise", () => {
  const run = docked => {
    let listener; const revealed = [], shown = [];
    const context = vm.createContext({ failed() {}, window: {}, sdeReveal: frame => revealed.push(frame),
      show: (...args) => { shown.push(args); return Promise.resolve(); },
      document: { addEventListener: (type, fn) => { if (type === "click") { listener = fn; } },
        body: { classList: { contains: name => docked && name === "vertex-docked-debug" } } } });
    vm.runInContext(part('document.addEventListener("click",function(e){', "/* Depth, Collapse all"), context);
    const button = { getAttribute: name => ({ "data-source": "/sap/bc/adt/oo/classes/zcl_price_road/source/main", "data-line": "17" })[name] };
    listener({ target: { closest: () => button }, preventDefault() {}, stopPropagation() {} });
    return { revealed, shown };
  };
  const docked = run(true);
  assert.deepEqual(JSON.parse(JSON.stringify(docked.revealed)), [{ url: "/sap/bc/adt/oo/classes/zcl_price_road/source/main", line: 17 }]);
  assert.equal(docked.shown.length, 0);
  const standing = run(false);
  assert.equal(standing.revealed.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(standing.shown)), [["/sap/bc/adt/oo/classes/zcl_price_road/source/main", "", 17]]);
});

test("a statement that only closes a block is not a step of the diagram", () => {
  const lists = { list: [{ line: 3, kw: "METHOD" }, { line: 4, kw: "SELECT" }, { line: 9, kw: "ENDSELECT" }, { line: 17, kw: "ENDMETHOD" },
    { line: 20, kw: "END-OF-SELECTION" }, { line: 21, kw: "COMPUTE" }] };
  const context = vm.createContext({ maps: { PROG: {} }, listFor: () => lists.list });
  vm.runInContext(part("var ENDING=", "function stepFlow(){"), context);
  const closes = line => vm.runInContext("closesBlock({program:'PROG',line:" + line + "},'/u')", context);
  assert.equal(closes(9), true, "ENDSELECT");
  assert.equal(closes(17), true, "ENDMETHOD");
  assert.equal(closes(4), false, "SELECT is a statement");
  assert.equal(closes(20), false, "END-OF-SELECTION is an event, not a closing statement");
  assert.equal(closes(21), false);
  assert.equal(closes(99), false, "a line the map does not know stays");
  assert.equal(vm.runInContext("closesBlock({program:'OTHER',line:9},'/u')", context), false, "with no map nothing says what it is");
});

test("choosing a value asks for its slice at once, so Full marks it before BSE is ever pressed", () => {
  const asked = [];
  const context = vm.createContext({ chosenValue: null, slicePoints: "old", sliceAsked: "old", sliceFor: "old",
    drawChosen() {}, drawVars() {}, paneOn: () => false, flow: {}, sdeOrigin() {}, notice() {},
    fetchSlice: () => { asked.push(context.chosenValue && context.chosenValue.name); return Promise.resolve(); } });
  vm.runInContext(part("function chooseValue(name){", "/* The places the analysis says the chosen value can be changed"), context);
  vm.runInContext('chooseValue("ls_result-amount")', context);
  assert.deepEqual(asked, ["LS_RESULT-AMOUNT"]);
  assert.equal(context.slicePoints, null, "a new value drops the old slice");
  vm.runInContext('chooseValue("")', context);
  assert.deepEqual(asked, ["LS_RESULT-AMOUNT"], "following nothing asks for nothing");
});

test("a line of several statements shows the one that does something when the run cannot say which", () => {
  const context = vm.createContext({});
  vm.runInContext(part("var STRUCTURAL=", "/* An inline declaration is noise in a flow"), context);
  const nth = (text, ord) => vm.runInContext("nthStatement(" + JSON.stringify(text) + "," + ord + ")", context);
  const line = "METHOD create. ro_strategy = NEW zcl_price_road( ). ENDMETHOD.";
  assert.equal(nth(line, 0), "ro_strategy = NEW zcl_price_road( ).", "METHOD is never stopped on, ENDMETHOD is not a step");
  assert.equal(nth(line, 2), "ENDMETHOD.", "a statement the run did name is shown as it is");
  assert.equal(nth("IF a = 'x.y'. b = 1. ENDIF.", 0), "IF a = 'x.y'.", "a period inside a literal ends nothing");
  assert.equal(nth("IF a = 'x.y'. b = 1. ENDIF.", 1), "b = 1.");
  assert.equal(nth("lo_log->add( iv_step = 'a' iv_text = 'b' ).", 0), "lo_log->add( iv_step = 'a' iv_text = 'b' ).");
  assert.equal(nth("DATA: a TYPE i, b TYPE i.", 0), "DATA: a TYPE i, b TYPE i.", "a chained statement is one");
  assert.equal(nth("ENDMETHOD.", 0), "ENDMETHOD.", "nothing else to show");
  assert.equal(nth("cs_context-fuel_amount = x. cs_context-amount = y.", 0), "cs_context-fuel_amount = x.");
});

test("the diagram of a record draws the branch the run went through, and only that one", () => {
  const frame = line => ({ program: "ZCL_CALC_FACADE===CP", include: "ZCL_CALC_FACADE===CM001", unit: "MODIFIER_FOR", line, url: "/u" });
  const stop = line => ({ cur: { name: "MODIFIER_FOR", owner: "ZCL_CALC_FACADE" }, at: { url: "/u", line, ord: 0 }, stack: [frame(line)] });
  // 7 CASE, 8 WHEN fuel, 9 its statement, 10 WHEN customs, 11 its statement. The run stopped on 7 and 9, never on a WHEN.
  const context = vm.createContext({ flow: { timeline: [stop(7), stop(9), stop(7), stop(9)] }, stepIndex: null,
    closesBlock: () => false, stepText: f => "text" + f.line,
    shapeIn: () => ({ parent: { 7: null, 8: 7, 9: 8, 10: 7, 11: 10 } }) });
  vm.runInContext(part("function stepKey(t)", "/* The blocks a statement of a routine stands in") + part("function stepFlow(){", "/* The running block, green"), context);
  const S = vm.runInContext("stepFlow()", context);
  const key = line => "MODIFIER_FOR|ZCL_CALC_FACADE===CM001:" + line;
  assert.ok(S.nodes[key(7)] && S.nodes[key(9)], "the statements the run stopped on");
  assert.ok(S.nodes[key(8)], "the WHEN the run went through, which was never stopped on");
  assert.equal(S.nodes[key(8)].branch, true);
  assert.equal(S.nodes[key(10)], undefined, "the WHEN it did not take");
  assert.equal(S.nodes[key(11)], undefined);
  const edge = (from, to) => Object.keys(S.edges).some(k => S.edges[k].from === from && S.edges[k].to === to);
  assert.ok(edge(key(7), key(8)) && edge(key(8), key(9)), "CASE > WHEN > statement");
});

test("at the level of classes and of methods, what holds a statement of the slice is marked, and logging is not", () => {
  const slice = new Set(["ZVERTEX_DEBUG_LAB:15", "ZCL_CALC_FACADE:28", "ZCL_MOD_FUEL:21"]);
  const stop = (owner, name, line, depth) => ({ cur: { owner, name }, at: { url: "/u/" + owner, line },
    stack: Array.from({ length: depth }, () => ({ program: owner, unit: name, line })) });
  const timeline = [
    stop("ZVERTEX_DEBUG_LAB", "ZVERTEX_DEBUG_LAB=>EVENT START-OF-SELECTION", 15, 1),
    stop("ZCL_CALC_FACADE", "ZCL_CALC_FACADE=>RUN", 28, 2),
    stop("ZCL_MOD_FUEL", "ZCL_MOD_FUEL=>ZIF_CALC_MODIFIER~APPLY", 21, 3),
    stop("ZCL_CALC_LOG", "ZCL_CALC_LOG=>ADD", 7, 4),
    stop("ZCL_MOD_FUEL", "ZCL_MOD_FUEL=>ZIF_CALC_MODIFIER~NAME", 25, 4)];
  const context = vm.createContext({ flow: { timeline }, chosenValue: { name: "LS_RESULT-AMOUNT" }, sharedIds: null, stepIndex: null,
    valueTrail: () => ({ why: "no values in this record" }), stepKey: () => "", stepFlow: () => { throw new Error("not the steps reading"); },
    sliceAt: (owner, line) => slice.has(String(owner).toUpperCase() + ":" + line) ? { text: "x" } : null,
    inSlice: (owner, line) => slice.has(String(owner).toUpperCase() + ":" + line) });
  vm.runInContext(part("function callGraph(byOwner){", "/* Where the chosen value changed, from the record alone.")
    + part("/* The stops of the record at a statement the slice names", "function loadControls(){"), context);
  const graph = mode => vm.runInContext("sharedFlowGraph(" + JSON.stringify(mode) + ")", context).bseFlow.nodes;
  const green = mode => Array.from(graph(mode)).filter(node => node.bse).map(node => node.key).sort();
  assert.deepEqual(green("classes"), ["ZCL_CALC_FACADE", "ZCL_MOD_FUEL", "ZVERTEX_DEBUG_LAB"], "ZCL_CALC_LOG has nothing of the slice in it");
  assert.deepEqual(green("methods"), ["ZCL_CALC_FACADE=>RUN", "ZCL_MOD_FUEL=>ZIF_CALC_MODIFIER~APPLY", "ZVERTEX_DEBUG_LAB=>EVENT START-OF-SELECTION"],
    "~NAME of the same class and ADD of the log are not marked");
});

test("the analysis starts from the object's own frame, not from the frame the run is in", () => {
  const frame = (program, line) => ({ program, line });
  const run = (frames, object, placed) => {
    const context = vm.createContext({ object, maps: { PROG: {} }, currentFrame: () => frames[0],
      picture: { stopped: { frames } }, placeOf: (f) => placed(f) });
    vm.runInContext(part("function originLine(){", "function fetchSlice(){"), context);
    return () => vm.runInContext("originLine()", context);
  };
  const lab = { name: "ZVERTEX_DEBUG_LAB", type: "PROG" };
  // Standing in the program itself: its own line.
  assert.equal(run([frame("ZVERTEX_DEBUG_LAB", 16)], lab, () => null)(), 16);
  // Inside a called method: the program's frame is on its call; the value is looked for from the next statement.
  const inside = [frame("ZCL_CALC_DATA_PROVIDER=====CP", 7), frame("ZCL_CALC_FACADE===========CP", 20), frame("ZVERTEX_DEBUG_LAB", 15)];
  assert.equal(run(inside, lab, f => f.line === 15 ? { next: { line: 16 } } : null)(), 16);
  // No map for it: the call's own line.
  assert.equal(run(inside, lab, () => null)(), 15);
  // The program is not on the stack: the current frame's line is only a hint, the host starts from the last use.
  assert.equal(run([frame("ZCL_OTHER=====CP", 3)], lab, () => null)(), 3);
});

test("the chip says what the analysis found and how much of it the record reached", () => {
  const context = vm.createContext({ chosenValue: { name: "X" }, slicePoints: null, sliceAsked: null, flow: { timeline: [] },
    sliceStops: () => ({ 3: true, 7: true }) });
  vm.runInContext(part("function sliceSummary(){", "function drawChosen(){"), context);
  const say = () => vm.runInContext("sliceSummary()", context);
  assert.equal(say(), "", "nothing asked yet");
  context.sliceAsked = {};
  assert.equal(say(), " · analysing…");
  context.slicePoints = { "A:1": {}, "B:2": {}, "C:3": {} };
  assert.equal(say(), " · 3 places", "no record yet");
  context.flow.timeline = new Array(10).fill({});
  assert.equal(say(), " · 3 places · 2 of 10 stops on them");
  context.slicePoints = { "A:1": {} };
  assert.equal(say(), " · 1 place · 2 of 10 stops on them");
  context.chosenValue = null;
  assert.equal(say(), "");
});

test("a new run keeps the analysis the user already waited for, and asks again only for an empty one", () => {
  const asked = [];
  const make = slicePoints => {
    const context = vm.createContext({ maps: { a: 1 }, lists: { a: 1 }, methodsAt: { a: 1 }, slicePoints, sliceAsked: slicePoints ? {} : null, sliceFor: "X",
      chosenValue: { name: "X" }, sdeOrigin() {}, notice() {},
      fetchSlice: () => { asked.push(context.slicePoints === null); return Promise.resolve(); } });
    vm.runInContext(part("function fresh(){", "function runFlow(){").split("function runFlow(){")[0], context);
    return context;
  };
  const kept = make({ "A:1": {} });
  vm.runInContext("fresh()", kept);
  assert.notEqual(kept.slicePoints, null, "the slice read before the run is still there");
  assert.deepEqual(Object.keys(kept.maps), [], "the maps are read again, they belong to the run");
  const empty = make({});
  vm.runInContext("fresh()", empty);
  assert.equal(empty.slicePoints, null, "an empty answer is dropped");
  assert.equal(asked.at(-1), true, "and asked for again");
});

test("what leads to a statement of the slice is part of the slice; what leads nowhere is not", () => {
  const frame = (line, depth) => ({ program: "ZCL_CALC_FACADE===CP", include: "ZCL_CALC_FACADE===CM001", unit: "MODIFIER_FOR", line, url: "/u" });
  const stop = line => ({ cur: { name: "ZCL_CALC_FACADE=>MODIFIER_FOR", owner: "ZCL_CALC_FACADE" }, at: { url: "/u", line, ord: 0 }, stack: [frame(line)] });
  // 7 CASE; 8 WHEN fuel, 9 its statement (in the slice); 10 WHEN tax, 11 its statement (not in the slice); 12 a log call.
  const slice = new Set(["ZCL_CALC_FACADE:9"]);
  const context = vm.createContext({ flow: { timeline: [stop(7), stop(9), stop(11), stop(12)] }, stepIndex: null, chosenValue: { name: "X" }, sharedIds: null,
    closesBlock: () => false, stepText: f => "text" + f.line, valueTrail: () => ({ why: "no values" }),
    shapeIn: () => ({ parent: { 7: null, 8: 7, 9: 8, 10: 7, 11: 10, 12: 7 } }),
    sliceAt: (owner, line) => slice.has(String(owner).toUpperCase() + ":" + line) ? { text: "text" + line } : null,
    inSlice: (owner, line) => slice.has(String(owner).toUpperCase() + ":" + line) });
  vm.runInContext(part("function stepKey(t)", "/* The blocks a statement of a routine stands in") + part("function stepFlow(){", "/* The running block, green")
    + part("/* The stops of the record at a statement the slice names", "function loadControls(){"), context);
  const nodes = vm.runInContext("sharedFlowGraph('steps')", context).bseFlow.nodes;
  const green = Array.from(nodes).filter(n => n.bse).map(n => n.line === undefined ? n.text : n.line).sort((a, b) => a - b);
  assert.ok(green.includes(9), "the statement of the slice");
  assert.ok(green.includes(8), "the WHEN the run went through to it");
  assert.ok(green.includes(7), "the CASE around it");
  assert.ok(!green.includes(10) && !green.includes(11), "the other WHEN and its statement lead nowhere");
  assert.ok(!green.includes(12), "a statement beside it that is not in the slice");
});

test("the analysis answers on a channel of its own, by number, in whatever order", async () => {
  const sent = [];
  const context = vm.createContext({ Object, Promise, sdeOrigin: request => sent.push(request) });
  vm.runInContext(part("var originWaiting={}", "function ask(send,raw){"), context);
  const first = vm.runInContext("askOrigin({variable:'A'})", context);
  const second = vm.runInContext("askOrigin({variable:'B'})", context);
  assert.deepEqual(sent.map(request => request.id), [1, 2], "each request carries its number");
  // The second answers first, the first with an error: neither is taken for the other.
  vm.runInContext('sdeOriginReady(JSON.stringify({id:2,answer:{points:["b"]}}))', context);
  vm.runInContext('sdeOriginReady(JSON.stringify({id:1,error:"SAP is busy"}))', context);
  assert.deepEqual(JSON.parse(JSON.stringify(await second)), { points: ["b"] });
  await assert.rejects(first, /SAP is busy/);
  vm.runInContext('sdeOriginReady(JSON.stringify({id:99,answer:{}}))', context);   // a stray answer is ignored
});

test("Run in SAP has a light green background that follows the theme", () => {
  assert.match(page, /#run\{background:color-mix\(in srgb,var\(--vscode-testing-iconPassed/);
  assert.doesNotMatch(part("#run{background", "#run svg.clock"), /background:#/i, "no fixed colour as the background");
  assert.match(part("#run{background", "#run svg.clock"), /var\(--vscode-editor-background/, "mixed into the editor's own background");
});

test("the </> of a node in the diagram opens its source: the editor when docked", () => {
  const revealed = [], shown = [];
  const context = vm.createContext({ failed() {}, window: {}, sdeReveal: frame => revealed.push(frame),
    show: (...args) => { shown.push(args); return Promise.resolve(); },
    document: { addEventListener() {}, body: { classList: { contains: name => name === "vertex-docked-debug" } } } });
  vm.runInContext(part('document.addEventListener("click",function(e){', "/* Depth, Collapse all"), context);
  vm.runInContext("sharedNodes=[{id:'f3',source:'/sap/bc/adt/oo/classes/zcl_mod_fuel/source/main',line:21},{id:'f4',line:5}]", context);
  context.window.bseMermaidOpen("f3");
  assert.deepEqual(JSON.parse(JSON.stringify(revealed)), [{ url: "/sap/bc/adt/oo/classes/zcl_mod_fuel/source/main", line: 21 }]);
  context.window.bseMermaidOpen("f4");   // no place of its own
  context.window.bseMermaidOpen("nope");  // not a node
  assert.equal(revealed.length, 1);
  assert.equal(shown.length, 0);
});

test("the next statement is the first on another line: a chain of one line is one step of the debugger", () => {
  // 41 COMPUTE, 42 WRITE: / a, b - two statements of the map on one line, 43 ULINE.
  const list = [{ line: 41, kw: "COMPUTE" }, { line: 42, kw: "WRITE" }, { line: 42, kw: "WRITE" }, { line: 43, kw: "ULINE" }];
  const frame = { program: "P", line: 42 };
  const context = vm.createContext({ picture: { stopped: { frames: [frame] } }, spots: [], listFor: () => list, frame });
  vm.runInContext(part("function placeOf(f,map){", "/* The statement after the end of the loop that starts here"), context);
  context.spots[1] = list[1];   // the statement the run itself arrived at: the first of the two
  const place = vm.runInContext("placeOf(frame, {})", context);
  assert.equal(place.here, list[1]);
  assert.equal(place.next, list[3], "line 43, not the second half of line 42");
});

test("Predict passes a loop in one go only when the chosen value's slice does not touch it", () => {
  const frame = { program: "ZCL_CALC_FACADE===CP", line: 35 };
  const exit = { lines: [41, 42], line: 41 };
  const context = vm.createContext({ chosenValue: null, slicePoints: null, unitOf: () => ({ owner: "ZCL_CALC_FACADE" }), frame, exit });
  vm.runInContext(part("function loopUnlessSliced(f,exit,block,map){", "/* A statement whose every call the map could place"), context);
  const decide = () => vm.runInContext("loopUnlessSliced(frame, exit)", context);
  assert.equal(decide(), null, "no value chosen: nothing says the loop is free of it, so it is stepped through");
  context.chosenValue = { name: "X" };
  assert.equal(decide(), null, "the slice is still being asked for: the loop is not known to be free of it");
  context.slicePoints = { "ZCL_CALC_FACADE:41": {}, "ZCL_MOD_FUEL:21": {} };
  assert.equal(decide(), context.exit, "the slice has nothing between the loop and its end: passed");
  context.slicePoints = { "ZCL_CALC_FACADE:38": {} };
  assert.equal(decide(), null, "line 38 is in the body: the loop is stepped through");
  context.slicePoints = { "ZCL_OTHER:38": {} };
  assert.equal(decide(), context.exit, "the same line of another class is not in this body");
});

test("Predict runs past straight-line statements outside the slice in one go, and past a call it does not touch", () => {
  const list = [{ line: 10, kw: "DATA", kind: "plain" }, { line: 11, kw: "+CALL_METHOD", kind: "call", calls: true, owners: "?" },
    { line: 12, kw: "MOVE", kind: "plain" }, { line: 13, kw: "MOVE", kind: "plain" }, { line: 14, kw: "IF", kind: "plain" }];
  const frame = { url: "u", line: 10, program: "P" };
  const context = vm.createContext({ chosenValue: { name: "X" }, slicePoints: { "ZCL_CALC_FACADE:13": {}, "ZCL_MOD_FUEL:5": {} }, frame, list,
    unitOf: () => ({ owner: "ZCL_CALC_FACADE" }), listFor: () => list, placeOf: f => ({ here: list.find(s => s.line === f.line), next: list[list.indexOf(list.find(s => s.line === f.line)) + 1] }),
    MIN_RUN: 1, breakpointOn: () => false, inSlice: (o, l) => !!context.slicePoints[o + ":" + l],
    CLOSERS: /^(ENDIF|ENDMETHOD)$/i, EVENTS: /^(METHOD|FORM)$/i });
  vm.runInContext(part("var NONLINEAR=", "/* A statement whose every call the map could place"), context);
  vm.runInContext(part("/* A statement whose every call the map could place", "/* A statement whose every call the map could place"), context);
  const skip = () => JSON.parse(JSON.stringify(vm.runInContext("skipAhead(frame, null)", context)));
  assert.deepEqual(skip().lines, [13], "the log call and the statement after it are outside the slice: run to line 13");
  context.slicePoints["ZCL_CALC_FACADE:11"] = {};
  assert.equal(vm.runInContext("skipAhead(frame, null)", context), null, "the call is itself a place of the slice: it is looked into");
});

test("the names of the page's global regular expressions are not declared twice", () => {
  const names = (page.match(/^var ([A-Z]+)=\//gm) || []).concat(page.match(/^ {4}([A-Z]+)=\//gm) || []);
  const seen = new Set();
  for (const name of names.map(n => n.replace(/^var |=\/$|^ +/g, ""))) { assert.ok(!seen.has(name), name + " is declared twice"); seen.add(name); }
});

test("Predict passes an IF block in one go when the slice has no place in it and no breakpoint stands in it", () => {
  const frame = { url: "u", program: "ZCL_X===CP", line: 11 };
  const context = vm.createContext({ chosenValue: { name: "X" }, slicePoints: { "ZCL_X:30": {} }, frame, exit: { lines: [16], line: 16 },
    unitOf: () => ({ owner: "ZCL_X" }), breakpointOn: () => false, MIN_BLOCK: 4,
    listFor: () => [12, 13, 14, 15].map(line => ({ line, kind: "plain" })), map: {} });
  vm.runInContext(part("function loopUnlessSliced(f,exit,block,map){", "/* A statement whose every call the map could place"), context);
  const decide = () => vm.runInContext("loopUnlessSliced(frame, exit, true, map)", context);
  assert.equal(decide(), context.exit);
  assert.equal(context.exit.block, true);
  context.MIN_BLOCK = 5;
  assert.equal(decide(), null, "four statements in the block spare less than the F8 costs");
  context.MIN_BLOCK = 4;
  context.slicePoints["ZCL_X:13"] = {};
  assert.equal(decide(), null, "a place of the slice in the block: it is stepped through");
  context.slicePoints = {};
  context.breakpointOn = (u, l) => l === 14;
  assert.equal(decide(), null, "a breakpoint in the block: it is stepped through");
});

test("after a call, SAP stops at the next statement that is a stop: ENDIF and ENDCASE are not, ENDLOOP and ENDMETHOD are", () => {
  const list = [{ line: 36, kw: "COMPUTE" }, { line: 37, kw: "IF" }, { line: 38, kw: "+CALL_METHOD" }, { line: 39, kw: "ENDIF" },
    { line: 40, kw: "ENDLOOP" }, { line: 50, kw: "CASE" }, { line: 51, kw: "WHEN" }, { line: 52, kw: "COMPUTE" }, { line: 53, kw: "WHEN" },
    { line: 54, kw: "IF" }, { line: 55, kw: "COMPUTE" }, { line: 56, kw: "ENDIF" }, { line: 57, kw: "ENDCASE" }, { line: 58, kw: "ENDMETHOD" }];
  const context = vm.createContext({ list });
  vm.runInContext(part("var BLOCK_OPEN=", "/* With a value followed and its analysis loaded"), context);
  const after = line => vm.runInContext("stopAfter(list, " + list.findIndex(s => s.line === line) + ")", context).line;
  assert.equal(after(38), 40, "the call before ENDIF: the next stop is ENDLOOP");
  assert.equal(after(52), 58, "the last statement of a WHEN: the other WHEN, with its IF, is jumped over, ENDCASE passed");
  assert.equal(after(36), 37);
});

test("Analyze flow path: from a point in a program or a class to the next checked point the flow meets, wherever it is", async () => {
  const context = vm.createContext({ window: { vertexFlowGraph: flowGraph }, chosenValue: null, sdeOrigin: () => {}, notice: text => { context.said = text; }, drawBreakpoints: () => {}, bpPaths: {},
    setPane: (id, on) => { context.opened = id; }, showFlow: () => { context.shown = true; }, staticFlow: null, paneOn: () => false, drawVars: () => {},
    autoVariables: () => {}, pointFocus: null, publishDebugContext: () => {},
    picture: { breakpoints: [{ id: "1", name: "ZREP", objectType: "PROG", line: 10, active: true }, { id: "2", name: "ZREP", objectType: "PROG", line: 16, active: false },
      { id: "3", name: "ZCL_X", objectType: "CLAS", line: 31, active: true }] },
    loadFlowGraph: () => Promise.resolve(), askOrigin: request => { context.asked = request; return Promise.resolve(context.answer); } });
  const arrow = String.fromCharCode(0x2192), row = (name, type, line, text, scope) => ({ name, type, line, aceLine: line, text, scope, source: "s:" + name, location: scope.replace(arrow, "->"), included: false });
  context.answer = { formula: { nodes: [], edges: [], maxLevel: 0 }, panes: { formula: "", expression: "" }, flow: [row("ZREP", "PROG", 10, "DATA(a) = 1.", "ZREP" + arrow + "START-OF-SELECTION"), row("ZREP", "PROG", 15, "lo->run( ).", "ZREP" + arrow + "START-OF-SELECTION"),
      row("ZREP", "PROG", 16, "WRITE a.", "ZREP" + arrow + "START-OF-SELECTION"),
      row("ZCL_X", "CLAS", 30, "x = 1.", "ZCL_X" + arrow + "RUN"), row("ZCL_X", "CLAS", 31, "y = 2.", "ZCL_X" + arrow + "RUN"), row("ZCL_X", "CLAS", 32, "z = 3.", "ZCL_X" + arrow + "RUN")],
    sites: [{ name: "ZREP", line: 15, callees: ["ZCL_X" + arrow + "RUN"] }] };
  // staticFlowGraph and pathUrl are the page's own
  vm.runInContext(part("function staticFlowGraph(mode,quiet){", "function sharedFlowGraph(mode){"), context);
  vm.runInContext(part("function pathUrl(w,b){", "function drawBreakpoints(){"), context);
  const run = b => vm.runInContext("analyzePath(" + JSON.stringify(b) + ")", context);
  const bp = { id: "1", name: "ZREP", objectType: "PROG", line: 10, url: "u" };
  await assert.rejects(run({ ...bp, objectType: "FUNC" }), /program, an include or a class/);
  context.picture.breakpoints = context.picture.breakpoints.filter(p => p.id === "1");
  await assert.rejects(run(bp), /Check a second breakpoint/, "one point is no path");
  context.picture.breakpoints.push({ id: "2", name: "ZREP", objectType: "PROG", line: 16, active: false });
  await assert.rejects(run(bp), /Check a second breakpoint/, "an unchecked point does not end the path");
  context.picture.breakpoints.push({ id: "3", name: "ZCL_X", objectType: "CLAS", line: 31, active: true });
  await run(bp);
  assert.deepEqual([context.asked.from, context.asked.to, context.asked.variable, context.asked.object_name], [10, undefined, "", "ZREP"], "asked from the point, with no end of its own");
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("staticFlow.stopAt", context))), { name: "ZCL_X", line: 31 }, "the end is the point below the stack, met in the routine the flow calls");
  assert.equal(vm.runInContext("bpPaths['1'].count", context), 4, "10, the call at 15, and 30 and 31 of the routine it calls - 31 the last drawn");
  assert.equal(context.opened, "flowpane");
  // a start in a class: asked as a class
  await run({ id: "3", name: "ZCL_X", objectType: "CLAS", line: 31, url: "u" }).catch(error => { context.failed = error.message; });
  assert.equal(context.asked.object_type, "CLAS", "a point in a class is a start too");
});

test("the flow of the analysis is drawn as program, classes, routines and statements with blocks as parents", () => {
  const rows = [
    { name: "ZREP", type: "PROG", line: 10, text: "DATA(a) = 1.", scope: "ZREP→START-OF-SELECTION", included: false },
    { name: "ZCL_X", type: "CLAS", line: 5, text: "IF a = 1.", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_X", type: "CLAS", line: 6, text: "b = 2.", scope: "ZCL_X→RUN", included: true },
    { name: "ZCL_X", type: "CLAS", line: 7, text: "ELSE.", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_X", type: "CLAS", line: 8, text: "b = 3.", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_X", type: "CLAS", line: 9, text: "ENDIF.", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_X", type: "CLAS", line: 11, text: "c = 4.", scope: "ZCL_X→RUN", included: false, unplaced: true }];
  const context = vm.createContext({ window: { vertexFlowGraph: flowGraph }, staticFlow: { formula: { nodes: [], edges: [], maxLevel: 0 }, panes: { formula: "", expression: "" }, rows: rows.map(w => ({ ...w, aceLine: w.line, source: "s:" + w.name, location: w.scope.replace("→", "->") })), sites: [{ name: "ZREP", line: 10, callees: ["ZCL_X→RUN"] }], point: { url: "u", line: 10 }, name: "ZREP" }, sharedIds: null, sharedNodes: null,
    pathUrl: (w) => "/" + w.name, notice: text => { context.said = text; } });
  vm.runInContext(part("function staticFlowGraph(mode,quiet){", "function sharedFlowGraph(mode){"), context);
  const graph = mode => JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph(" + JSON.stringify(mode) + ")", context).bseFlow));
  const classes = graph("classes"), steps = graph("steps");
  assert.deepEqual(classes.nodes.map(n => n.type), ["program", "class", "class"]);
  assert.deepEqual(steps.nodes.map(n => n.type).filter(t => t === "method").length, 1, "a called routine has no block of its own among statements");
  const byLine = line => steps.nodes.find(n => n.type === "operation" && n.line === line);
  const parentOf = node => steps.nodes.find(n => n.id === steps.edges.find(e => e.to === node.id).from);
  assert.equal(parentOf(byLine(6)).line, 5, "the body of IF is under the IF");
  assert.equal(parentOf(byLine(8)).line, 7, "the body of ELSE is under the ELSE");
  assert.equal(parentOf(byLine(11)).line, 10, "after ENDIF the next statement is the routine's again: under the call that entered it");
  assert.equal(byLine(9), undefined, "ENDIF is no node");
  assert.deepEqual([byLine(6).bse, byLine(5).bse, byLine(11).bse], [true, true, false], "what leads to a statement of the slice is part of it");
  assert.deepEqual([byLine(6).source, byLine(6).line, byLine(6).aceLocation], ["origin:s:ZCL_X|ZCL_X->RUN", 6, "ZCL_X->RUN"], "a node opens by the analysis: its source, its line, its routine");
  assert.equal(byLine(10).source, "origin:s:ZREP|ZREP->START-OF-SELECTION", "a program statement the same");
  const methodNodes = JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph('methods')", context).bseFlow)).nodes;
  const head = methodNodes.find(n => n.type === "method" && n.location === "ZCL_X" + String.fromCharCode(0x2192) + "RUN");
  assert.deepEqual([head.line, head.aceLocation], [1, "ZCL_X->RUN"], "a routine opens its METHOD, not its first statement");
  assert.equal(steps.nodes.find(n => n.type === "method" && n.text === "START-OF-SELECTION").line, 10, "a program's event opens at its first statement");
  const classNodes = JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph('classes')", context).bseFlow)).nodes;
  assert.deepEqual([classNodes.find(n => n.text === "ZCL_X").line, classNodes.find(n => n.text === "ZCL_X").aceLocation], [1, "ZCL_X->RUN"], "a class opens the head of its first routine");
  assert.equal(steps.nodes[0].id, "bseroot");
});

test("a call draws the routine's statements under the calling statement, in the order of execution and one level deeper", () => {
  const rows = [
    { name: "ZREP", type: "PROG", line: 15, text: "DATA(r) = NEW zcl_x( )->run( ).", scope: "ZREP→START-OF-SELECTION", included: false },
    { name: "ZREP", type: "PROG", line: 16, text: "WRITE r.", scope: "ZREP→START-OF-SELECTION", included: false },
    { name: "ZCL_X", type: "CLAS", line: 30, text: "a = 1.", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_X", type: "CLAS", line: 31, text: "lo->m( ).", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_X", type: "CLAS", line: 32, text: "b = 2.", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_Y", type: "CLAS", line: 7, text: "c = 3.", scope: "ZCL_Y→M", included: true }];
  const sites = [{ name: "ZREP", line: 15, callees: ["ZCL_X→RUN"] }, { name: "ZCL_X", line: 31, callees: ["ZCL_Y→M"] }];
  const context = vm.createContext({ window: { vertexFlowGraph: flowGraph }, staticFlow: { formula: { nodes: [], edges: [], maxLevel: 0 }, panes: { formula: "", expression: "" }, rows: rows.map(w => ({ ...w, aceLine: w.line, source: "s:" + w.name, location: w.scope.replace("→", "->") })), sites, point: { url: "u", line: 10 }, name: "ZREP" }, sharedIds: null, sharedNodes: null,
    pathUrl: (w) => "/" + w.name, notice: () => {} });
  vm.runInContext(part("function staticFlowGraph(mode,quiet){", "function sharedFlowGraph(mode){"), context);
  const graph = mode => JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph(" + JSON.stringify(mode) + ")", context).bseFlow));
  const steps = graph("steps");
  const op = line => steps.nodes.find(n => n.type === "operation" && n.line === line);
  const parent = node => steps.nodes.find(n => n.id === steps.edges.find(e => e.to === node.id).from);
  assert.equal(steps.nodes.filter(n => n.type === "method").length, 1, "only the entry has a block: the calling statement already names the routine");
  assert.equal(parent(op(30)).line, 15, "RUN's first statement hangs under the statement that calls it");
  assert.equal(parent(op(7)).line, 31, "M's under the call in RUN");
  assert.deepEqual([op(15).stack, op(30).stack, op(31).stack, op(7).stack], [1, 2, 2, 3], "the stack deepens with each call");
  const order = steps.nodes.filter(n => n.type === "operation").map(n => n.line);
  assert.deepEqual(order, [15, 30, 31, 7, 32, 16], "a routine is drawn where it is called: before the statements that follow the call");
  assert.equal(op(7).bse && op(31).bse && op(15).bse, true, "what leads to the slice is in it");
  const classes = graph("classes"), names = classes.nodes.map(n => n.text);
  assert.deepEqual(names, ["ZREP", "ZREP", "ZCL_X", "ZCL_Y"]);
  assert.deepEqual(classes.nodes.map(n => n.stack), [0, 1, 2, 3], "a class stands at the depth of the call that reached it");
  assert.equal(JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph('classes')", context))).maxStack, 3, "so the depth control reaches as deep as the calls do");
  const link = (a, b) => classes.edges.some(e => classes.nodes.find(n => n.id === e.from).text === a && classes.nodes.find(n => n.id === e.to).text === b);
  assert.deepEqual([link("ZCL_X", "ZCL_Y"), link("ZREP", "ZCL_X")], [true, true]);
});

test("the stack and the variables open when the program stops and close when it does not stand; the breakpoints show when there are any", () => {
  const on = { stacksec: true, bpsec: false, varsec: true };
  const stackButton = { style: {} }, logButton = { style: {} };
  const context = vm.createContext({ steplog: { rows: [] }, document: { querySelectorAll: selector => [/stacksec/.test(selector) ? stackButton : logButton] }, paneOn: id => !!on[id], setPane: (id, value) => { on[id] = value; }, staticVars: null, autoVariables: () => { context.read = (context.read || 0) + 1; } });
  vm.runInContext(part("var autoStopped=null", "function apply(p){"), context);
  const apply = p => vm.runInContext("autoPanes(" + JSON.stringify(p) + ")", context);
  apply({ stopped: null, breakpoints: [{ id: 1 }] });
  assert.deepEqual([on.stacksec, on.bpsec], [false, true], "listening: no stack, the points shown");
  assert.equal(stackButton.style.display, "none", "and no switch for the stack before the program stops");
  assert.equal(logButton.style.display, "none", "nor for the log before anything has run");
  on.bpsec = false;
  apply({ stopped: null, breakpoints: [{ id: 1 }] });
  assert.equal(on.bpsec, false, "a pane the reader closed stays closed");
  apply({ stopped: { frames: [] }, breakpoints: [{ id: 1 }] });
  assert.deepEqual([on.stacksec, on.varsec], [true, true], "stopped: they open");
  assert.equal(stackButton.style.display, "", "and the switch for the stack is there");
  assert.equal(logButton.style.display, "", "and for the log");
  apply({ stopped: null, breakpoints: [] });
  assert.deepEqual([on.stacksec, on.varsec], [false, false]);
  assert.equal(stackButton.style.display, "none", "the run is over: no stack");
  context.steplog.rows.push({});
  apply({ stopped: null, breakpoints: [] });
  assert.equal(logButton.style.display, "", "but the log of the run stays");
  apply({ stopped: null, breakpoints: [{ id: 2 }] });
  assert.equal(on.bpsec, true, "the first point set while listening shows the section");
});

test("a routine no call of the flow reaches is not drawn under the program, and the notice says so", () => {
  const rows = [
    { name: "ZREP", type: "PROG", line: 15, text: "DATA(r) = NEW zcl_x( )->run( ).", scope: "ZREP→START-OF-SELECTION", included: false },
    { name: "ZCL_X", type: "CLAS", line: 30, text: "a = 1.", scope: "ZCL_X→RUN", included: false },
    { name: "ZCL_Y", type: "CLAS", line: 5, text: "n = 'Y'.", scope: "ZCL_Y→NAME", included: false }];
  const context = vm.createContext({ window: { vertexFlowGraph: flowGraph }, staticFlow: { formula: { nodes: [], edges: [], maxLevel: 0 }, panes: { formula: "", expression: "" }, rows: rows.map(w => ({ ...w, aceLine: w.line, source: "s:" + w.name, location: w.scope.replace("→", "->") })), sites: [{ name: "ZREP", line: 15, callees: ["ZCL_X→RUN"] }], point: { url: "u", line: 10 }, name: "ZREP" },
    sharedIds: null, sharedNodes: null, pathUrl: (w) => "/" + w.name, notice: text => { context.said = text; } });
  vm.runInContext(part("function staticFlowGraph(mode,quiet){", "function sharedFlowGraph(mode){"), context);
  const graph = JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph('methods')", context).bseFlow));
  assert.deepEqual(graph.nodes.map(n => n.text), ["ZREP", "START-OF-SELECTION", "ZCL_X=>RUN"], "ZCL_Y=>NAME is nowhere in it");
  assert.match(context.said, /1 routine .*ZCL_Y=>NAME/);
});

test("with no value chosen the Full/BSE toggle is hidden and the diagram reads Full", () => {
  const classes = new Set(), clicked = [];
  const full = { classList: { contains: () => false }, click: () => clicked.push("full") };
  const flowChoice = { classList: { contains: () => false }, click: () => clicked.push("flow") };
  const context = vm.createContext({ chosenValue: null, $: () => ({ textContent: "", hidden: false, appendChild() {} }),
    document: { body: { classList: { toggle: (name, on) => { on ? classes.add(name) : classes.delete(name); } } }, querySelector: selector => /flow-scope/.test(selector) ? full : flowChoice } });
  // The head of the function: everything it does with no value chosen.
  const start = page.indexOf("function drawChosen(){");
  vm.runInContext(page.slice(start, page.indexOf("var chip=", start)) + "var chip=$(\"chosenvalue\");if(!chosenValue){chip.hidden=true;return;}}", context);
  vm.runInContext("drawChosen()", context);
  assert.equal(classes.has("no-value"), true, "no value: the toggle is hidden by the style on the body");
  assert.deepEqual(clicked, ["full", "flow"], "and the scope is put back on Full, the type on FLOW: Formula needs a value");
  assert.ok(page.includes('body.no-value div[aria-label="FLOW scope"],body.no-value div[data-mode-toggle]{display:none!important}'), "the style that hides it, and the FLOW / Formula toggle with it: Formula needs a value");
});

test("a call to a routine the flow lists no statement of is still drawn, as a block with nothing under it", () => {
  const rows = [
    { name: "ZREP", type: "PROG", line: 15, text: "lo_log->add( ).", scope: "ZREP" + String.fromCharCode(0x2192) + "START-OF-SELECTION", included: false }];
  const sites = [{ name: "ZREP", line: 15, callees: ["ZCL_LOG" + String.fromCharCode(0x2192) + "ADD"] }];
  const context = vm.createContext({ window: { vertexFlowGraph: flowGraph }, staticFlow: { formula: { nodes: [], edges: [], maxLevel: 0 }, panes: { formula: "", expression: "" }, rows: rows.map(w => ({ ...w, aceLine: w.line, source: "s:" + w.name, location: "ZREP->START-OF-SELECTION" })), sites, point: { url: "u", line: 10 }, name: "ZREP" },
    sharedIds: null, sharedNodes: null, pathUrl: (w) => "/" + w.name, notice: () => {} });
  vm.runInContext(part("function staticFlowGraph(mode,quiet){", "function sharedFlowGraph(mode){"), context);
  const graph = mode => JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph(" + JSON.stringify(mode) + ")", context).bseFlow));
  for (const mode of ["steps", "methods"]) {
    const g = graph(mode), stub = g.nodes.find(n => n.text === "ZCL_LOG=>ADD");
    assert.ok(stub, mode + ": the called routine is a node");
    assert.equal(stub.source, "", "with no source to open");
    const from = g.nodes.find(n => n.id === g.edges.find(e => e.to === stub.id).from);
    assert.equal(mode === "steps" ? from.line : from.text, mode === "steps" ? 15 : "START-OF-SELECTION", "under the call that makes it");
  }
  const classes = graph("classes");
  assert.deepEqual(classes.nodes.map(n => n.text), ["ZREP", "ZREP", "ZCL_LOG"]);
});

test("a variable of a structure type opens to its components before the run, and a component can be followed by its path", () => {
  const element = tag => {
    const el = { tag, children: [], className: "", style: {}, attrs: {}, classList: { set: new Set(), add(n) { this.set.add(n); }, contains(n) { return this.set.has(n); } },
      appendChild(c) { el.children.push(c); return c; }, set innerHTML(v) { el.children = []; } };
    Object.defineProperty(el, "rows", { get: () => el.children.filter(c => c.tag === "tr") });
    return el;
  };
  const on = { classList: { contains: () => true } }, box = element("div");
  const context = vm.createContext({ staticVars: { object_name: "ZREP", name: "", scope: "", params: [], locals: [], globals: [{ name: "ls_result", type: "zif=>ty",
      components: [{ name: "shipment_id", type: "char10" }, { name: "amount", type: "decfloat34" }] }, { name: "lv_scenario", type: "" }] }, staticOpen: {}, chosenValue: null,
    $: id => id === "filter" ? { value: "" } : on, document: { createElement: element, createTextNode: text => ({ tag: "#text", text }) },
    openValueMenu: (path) => { context.menu = path; }, drawVars: () => { context.redrawn = true; } });
  vm.runInContext(page.slice(page.indexOf("function drawStaticVars(box){"), page.indexOf("function drawVars(){")), context);
  const draw = () => { const b = element("div"); vm.runInContext("drawStaticVars(__box)", Object.assign(context, { __box: b })); return b.children[0].rows; };
  assert.equal(draw().length, 3, "the group, the structure and the plain variable: the structure is closed");
  vm.runInContext("staticOpen['LS_RESULT']=true", context);
  const rows = draw();
  assert.equal(rows.length, 5, "open: its two components follow it");
  assert.equal(rows[2].children[0].children[1].text, "shipment_id");
  rows[3].oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 2 });
  assert.equal(context.menu, "LS_RESULT-AMOUNT", "a component is followed by its path");
});

test("the variables before the run follow the reader's place: a routine shows its own, the program's globals otherwise, and a stale answer is dropped", async () => {
  const toggles = { globals: new Set(["on"]), locals: new Set(), params: new Set() }, asked = [], waiting = [];
  const el = id => ({ classList: { toggle: (name, on) => { on ? toggles[id].add(name) : toggles[id].delete(name); }, add: name => toggles[id].add(name), contains: name => toggles[id].has(name) } });
  const context = vm.createContext({ staticVars: null, picture: { stopped: null }, series: null, object: { name: "ZREP", type: "PROG" },
    askOrigin: request => new Promise(ok => { asked.push(request.variables); waiting.push(ok); }), $: el, paneOn: () => true, setPane: () => {},
    notice: () => {}, drawVars: () => { context.drawn = (context.drawn || 0) + 1; }, window: {} });
  vm.runInContext(page.slice(page.indexOf("var staticVars=null,staticOpen"), page.indexOf("function drawStaticVars(box){")), context);
  const answer = (name, extra) => ({ object_name: "ZREP", object_type: "PROG", name, scope: name ? "ZREP->" + name : "", params: [], locals: [], globals: name ? null : [], ...extra });
  // no cursor, no point: the program under debug, globals
  const first = vm.runInContext("autoVariables()", context);
  assert.deepEqual([asked[0].object_name, asked[0].object_type, asked[0].line], ["ZREP", "PROG", undefined]);
  waiting[0](answer("")); await first;
  assert.deepEqual([toggles.globals.has("on"), toggles.locals.has("on")], [true, true], "outside every routine the globals are shown");
  // the cursor stands in a routine: its parameters and locals, and no globals
  context.window.sdeCursor(JSON.stringify({ object_name: "ZREP", object_type: "PROG", line: 22 }));
  assert.equal(asked[1].line, 22, "the cursor's line is the place");
  waiting[1](answer("F"));
  await new Promise(r => setImmediate(r));
  assert.deepEqual([toggles.globals.has("on"), toggles.locals.has("on"), toggles.params.has("on")], [false, true, true], "in a routine: locals and params, not globals");
  // two questions, the older answered last: it is dropped
  context.window.sdeCursor(JSON.stringify({ object_name: "ZREP", object_type: "PROG", line: 30 }));
  context.window.sdeCursor(JSON.stringify({ object_name: "ZREP", object_type: "PROG", line: 5 }));
  waiting[3](answer(""));
  await new Promise(r => setImmediate(r));
  waiting[2](answer("G"));
  await new Promise(r => setImmediate(r));
  assert.equal(vm.runInContext("staticVars.name", context), "", "the newer answer stands");
  // a stopped program has real variables: nothing is asked
  context.picture.stopped = { frames: [] };
  const before = asked.length;
  await vm.runInContext("autoVariables()", context);
  assert.equal(asked.length, before);
});

test("SYST and Initials are offered only while the program is stopped", () => {
  const shown = { syst: { style: {} }, initials: { style: {} } };
  const context = vm.createContext({ picture: { stopped: null }, $: id => shown[id] });
  vm.runInContext(part("function syncVarSwitches(){", "function drawVars(){"), context);
  vm.runInContext("syncVarSwitches()", context);
  assert.deepEqual([shown.syst.style.display, shown.initials.style.display], ["none", "none"], "no values yet: no switches for them");
  context.picture.stopped = { frames: [] };
  vm.runInContext("syncVarSwitches()", context);
  assert.deepEqual([shown.syst.style.display, shown.initials.style.display], ["", ""], "stopped: both are there");
});

test("a path ends at the statement of its end point: nothing after it is drawn, and what it calls is not", () => {
  const arrow = String.fromCharCode(0x2192);
  const row = (name, type, line, text, scope) => ({ name, type, line, aceLine: line, text, scope, source: "s:" + name, location: scope.replace(arrow, "->"), included: false });
  const rows = [row("ZREP", "PROG", 10, "a = 1.", "ZREP" + arrow + "START-OF-SELECTION"), row("ZREP", "PROG", 15, "lo->run( ).", "ZREP" + arrow + "START-OF-SELECTION"),
    row("ZREP", "PROG", 16, "WRITE a.", "ZREP" + arrow + "START-OF-SELECTION"), row("ZCL_X", "CLAS", 30, "x = 1.", "ZCL_X" + arrow + "RUN"),
    row("ZCL_X", "CLAS", 31, "lo2->deep( ).", "ZCL_X" + arrow + "RUN"), row("ZCL_X", "CLAS", 32, "z = 3.", "ZCL_X" + arrow + "RUN"), row("ZCL_Y", "CLAS", 5, "q = 1.", "ZCL_Y" + arrow + "DEEP")];
  const sites = [{ name: "ZREP", line: 15, callees: ["ZCL_X" + arrow + "RUN"] }, { name: "ZCL_X", line: 31, callees: ["ZCL_Y" + arrow + "DEEP"] }];
  const context = vm.createContext({ window: { vertexFlowGraph: flowGraph }, staticFlow: { formula: { nodes: [], edges: [], maxLevel: 0 }, panes: { formula: "", expression: "" }, rows, sites, point: { url: "u", line: 10 }, name: "ZREP", stopAt: { name: "ZCL_X", line: 31 } },
    sharedIds: null, sharedNodes: null, pathUrl: () => "", notice: () => { context.noticed = true; } });
  vm.runInContext(part("function staticFlowGraph(mode,quiet){", "function sharedFlowGraph(mode){"), context);
  const graph = mode => JSON.parse(JSON.stringify(vm.runInContext("staticFlowGraph(" + JSON.stringify(mode) + ")", context).bseFlow));
  const lines = graph("steps").nodes.filter(n => n.type === "operation").map(n => n.line);
  assert.deepEqual(lines, [10, 15, 30, 31], "the end statement is the last: not the WRITE after the call, not 32, not what 31 calls");
  assert.ok(!graph("steps").nodes.some(n => /DEEP/.test(n.text)), "no block for the routine the end statement would call");
  assert.deepEqual(graph("methods").nodes.map(n => n.text), ["ZREP", "START-OF-SELECTION", "ZCL_X=>RUN"], "the same in the routines' reading");
  assert.ok(!context.noticed, "and no notice of routines that are not drawn: a path leaves them out on purpose");
});

test("the variables section is opened for the first answer of a state, not again once the reader has closed it", async () => {
  const opened = [];
  const toggle = { classList: { toggle() {}, add() {}, contains: () => true } };
  const context = vm.createContext({ staticVars: null, picture: { stopped: null }, series: null, object: { name: "ZREP", type: "PROG" }, readerClosed: {},
    askOrigin: () => Promise.resolve({ object_name: "ZREP", object_type: "PROG", name: "", scope: "", params: [], locals: [], globals: [] }), $: () => toggle,
    paneOn: () => false, setPane: (id, on) => { opened.push(id + ":" + on); }, notice: () => {}, drawVars: () => {}, window: {} });
  vm.runInContext(page.slice(page.indexOf("var staticVars=null,staticOpen"), page.indexOf("function drawStaticVars(box){")), context);
  await vm.runInContext("askVariables({object_name:'ZREP',object_type:'PROG'})", context);
  assert.deepEqual(opened, ["varsec:true"], "the first answer opens it");
  opened.length = 0;
  context.readerClosed = { varsec: true };
  await vm.runInContext("askVariables({object_name:'ZREP',object_type:'PROG',line:5})", context);
  assert.deepEqual(opened, [], "a section the reader closed stays closed: a click on a method does not bring it back");
});

test("the chat is given what the window shows in two labelled parts: what ran, within the depth, and what the analysis says can happen", () => {
  const arrow = String.fromCharCode(0x2192);
  const frame = (name, line) => ({ label: name + ":" + line, program: name, line });
  const stop = (stackNames, cur, line) => ({ cur: { name: cur, owner: cur.split("=>")[0] }, stack: stackNames.map((n, i) => frame(n, i ? 1 : line)) });
  const timeline = [stop(["ZREP"], "ZREP", 10), stop(["ZREP"], "ZREP", 15), stop(["ZCL_X=>RUN", "ZREP"], "ZCL_X=>RUN", 30), stop(["ZCL_X=>RUN", "ZREP"], "ZCL_X=>RUN", 30),
    stop(["ZCL_Y=>M", "ZCL_X=>RUN", "ZREP"], "ZCL_Y=>M", 7), stop(["ZCL_X=>RUN", "ZREP"], "ZCL_X=>RUN", 31)];
  const row = (name, line, text, included) => ({ name, type: "PROG", line, aceLine: line, text, scope: name + arrow + "RUN", source: "s", location: name + "->RUN", included: !!included });
  const context = vm.createContext({ flow: { timeline }, chosenValue: { name: "LS_X" }, slicePoints: { "ZCL_X:30": {} }, inSlice: (o, l) => o === "ZCL_X" && l === 30,
    picture: { stopped: { at: "ZCL_X:31" } }, object: { name: "ZREP", type: "PROG" }, window: { vertexFlow: { depth: () => context.depth } }, depth: null,
    staticFlow: { formula: { nodes: [], edges: [], maxLevel: 0 }, panes: { formula: "", expression: "" }, rows: [row("ZREP", 10, "a = 1."), row("ZREP", 15, "b = 2.", true)], sites: [], point: { url: "u" }, name: "ZREP", from: 10, stopAt: { name: "ZREP", line: 15 } },
    staticFlowGraph: () => ({ sequence: [row("ZREP", 10, "a = 1."), row("ZREP", 15, "b = 2.", true)] }), MAX_CONTEXT: 150 });
  vm.runInContext(part("function debugContext(){", "var contextTimer=null;"), context);
  const read = () => JSON.parse(JSON.stringify(vm.runInContext("debugContext()", context)));
  let got = read();
  assert.deepEqual(got.recorded.steps.map(s => s.depth + ":" + s.at), ["0:ZREP:10", "0:ZREP:15", "1:ZCL_X=>RUN:30", "2:ZCL_Y=>M:7", "1:ZCL_X=>RUN:31"], "consecutive repeats once, with the depth below the first stop");
  assert.equal(got.recorded.steps[2].slice, true, "a statement of the slice is marked");
  assert.match(got.recorded.note, /actually did/);
  assert.match(got.analysis.note, /NOT what ran/, "the analysis says it is not what ran");
  assert.deepEqual([got.analysis.from, got.analysis.to, got.analysis.statements.length, got.analysis.statements[1].slice], ["ZREP:10", "ZREP:15", 2, true]);
  context.depth = 2;
  got = read();
  assert.deepEqual(got.recorded.steps.map(s => s.at), ["ZREP:10", "ZREP:15", "ZCL_X=>RUN:30", "ZCL_X=>RUN:31"], "only as deep as the depth control shows");
  context.flow = { timeline: [] }; context.staticFlow = null;
  assert.equal(vm.runInContext("debugContext()", context), null, "neither a record nor an analysis: nothing to give");
});
