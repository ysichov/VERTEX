"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

/* SelecTor's script without its wiring, on a document that only remembers
   what was done to it. */
function page(host) {
  function element(tag) {
    return {
      tagName: tag, value: "", className: "", textContent: "", disabled: false,
      selectedIndex: 0, scrollTop: 0, scrollHeight: 0, style: {},
      children: [], options: [], handlers: {},
      classList: { add() {}, remove() {} },
      get text() { return this.textContent; },
      set innerHTML(value) { this.children = []; this.options = []; },
      appendChild(child) {
        this.children.push(child);
        if (child.tagName === "option") { this.options.push(child); }
        return child;
      },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      focus() {}
    };
  }
  const elements = {};
  const calls = [];
  const globals = {
    document: {
      getElementById(id) { return elements[id] || (elements[id] = element("div")); },
      createElement: element,
      createTextNode: text => ({ textContent: text }),
      addEventListener() {}
    },
    sdeLoad: (...args) => calls.push(["load", ...args]),
    sdeJoin: (...args) => calls.push(["join", ...args])
  };
  if (host !== "eclipse") {
    globals.sdeAsk = (...args) => calls.push(["ask", ...args]);
    globals.sdeModels = (...args) => calls.push(["models", ...args]);
  }
  const context = vm.createContext(globals);
  const html = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/table.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.split("/* ---------- wiring ---------- */")[0], context);
  // A select in a real document takes the value of one of its options.
  const who = globals.document.getElementById("who");
  who.tagName = "select";
  return { context, elements, calls };
}

const none = { rows: [], cols: [], vals: [] };
const AA = { field: "carrid", text: "Airline Code", sign: "I", option: "EQ", low: "AA", high: "" };

test("a plan for one table loads it with its filters in the selection panel", () => {
  const { context, calls } = page();
  context.applyPlan({ reply: "", table: "SFLIGHT", filters: [AA], join: [], fields: [], pivot: none });
  assert.deepEqual(calls, [["load", "SFLIGHT", 100, "f1=carrid&s1=I&o1=EQ&l1=AA"]]);
  assert.equal(context.criteria.length, 1);
  assert.equal(context.criteria[0].text, "Airline Code");
});

test("a plan with a join goes to the join, with the filters", () => {
  const { context, calls } = page();
  context.currentTable = "SBOOK";
  context.applyPlan({ reply: "", table: "SFLIGHT", filters: [AA], join: ["SCARR"], fields: [], pivot: none });
  assert.deepEqual(calls, [["join", "SFLIGHT", "SCARR", 100, "f1=carrid&s1=I&o1=EQ&l1=AA", "", ""]]);
  assert.equal(context.mode, "J");
});

test("a pivot plan opens the pivot with its slots filled", () => {
  const { context, calls } = page();
  context.applyPlan({ reply: "", table: "SFLIGHT", filters: [], join: [], fields: [],
                      pivot: { rows: ["t0~carrid"], cols: [], vals: [{ key: "t0~price", agg: "SUM" }] } });
  assert.equal(context.mode, "P");
  assert.deepEqual(calls, [["join", "SFLIGHT", "", 100, "", "r1=t0~carrid&v1=t0~price&a1=SUM", ""]]);
});

test("the host's answer puts the plan on the page and says what was done", () => {
  const { context, elements, calls } = page();
  context.sdeAssistant(JSON.stringify({ call: "ask", model: "claude-haiku-4-5", system: "DEV",
    plan: { reply: "SFLIGHT for AA.", table: "SFLIGHT", filters: [AA], join: ["SCARR"], fields: [], pivot: none } }));
  assert.equal(calls[0][0], "join");
  const said = elements.chatlog.children[0];
  assert.equal(said.className, "msg assistant");
  assert.equal(said.children[0].textContent, "Assistant · claude-haiku-4-5 · DEV");
  assert.equal(said.children[1].textContent, "SFLIGHT for AA.");
  assert.equal(said.children[2].textContent, "SFLIGHT · CARRID EQ AA · join SCARR");
});

test("an error or an answer without a table leaves the page as it was", () => {
  const { context, elements, calls } = page();
  context.sdeAssistant(JSON.stringify({ call: "ask", error: "Codex: You've hit your usage limit." }));
  context.sdeAssistant(JSON.stringify({ call: "ask",
    plan: { reply: "There is no such table.", table: "", filters: [], join: [], fields: [], pivot: none } }));
  assert.deepEqual(calls, []);
  assert.equal(elements.chatlog.children[0].className, "msg error");
  assert.equal(elements.chatlog.children[1].children[1].textContent, "There is no such table.");
});

test("what the assistant is told about the page carries settings, never rows", () => {
  const { context, calls } = page();
  const el = id => context.document.getElementById(id);
  context.currentTable = "SFLIGHT";
  context.criteria = [{ field: "carrid", text: "Airline Code", sign: "I", option: "EQ", low: "AA", high: "" },
                      { field: "connid", text: "", sign: "I", option: "EQ", low: "", high: "" }];
  context.shown = { rows: [{ carrid: "AA", price: "422.94" }] };
  el("ask").value = "join SCARR";
  el("model").disabled = false;
  el("model").value = "haiku";
  el("who").value = "claude";
  el("who").options = [{ text: "Claude Code" }];
  context.sendAsk();
  assert.equal(calls[0][0], "ask");
  assert.deepEqual(calls[0].slice(1, 4), ["claude", "haiku", "join SCARR"]);
  const state = JSON.parse(calls[0][4]);
  assert.deepEqual(state.filters, [{ field: "carrid", sign: "I", option: "EQ", low: "AA", high: "" }]);
  assert.doesNotMatch(calls[0][4], /422\.94/);
  context.sendAsk();
  assert.equal(calls.length, 1, "one request at a time");
});

test("in Eclipse the panel says there is no assistant and cannot be used", () => {
  const { context, elements, calls } = page("eclipse");
  context.openChat();
  assert.equal(elements.send.disabled, true);
  assert.equal(elements.ask.disabled, true);
  assert.match(elements.chatlog.children[0].children[1].textContent, /runs in VS Code for now/);
  assert.deepEqual(calls, []);
});

test("a system without the join resource gets no Join button, and is told why", () => {
  const { context, elements, calls } = page();
  context.sdeAbout = () => calls.push(["about"]);
  context.askAbout(() => {});
  context.sdeTake = () => JSON.stringify({ services: [
    { name: "table", handler: "ZCL_SDE_ADT_RES_TABLE", backend: "", active: true }], backends: [] });
  context.sdeReady();
  assert.deepEqual(calls, [["about"]]);
  assert.equal(elements.join.hidden, true);
  assert.equal(elements.missing.hidden, false);
  assert.equal(elements.missing.textContent,
    "Not on this system: the join builder - the VERTEX hub there is older than this window.");
});

test("without the table resource SelecTor opens on what is missing, and reads nothing", () => {
  const { context, elements, calls } = page();
  context.INITIAL = "SFLIGHT";
  context.sdeAbout = () => {};
  context.askAbout(context.startWindow);
  context.sdeTake = () => JSON.stringify({ services: [
    { name: "table", handler: "ZCL_SDE_ADT_RES_TABLE", backend: "", active: false },
    { name: "join", handler: "ZCL_SDE_ADT_RES_JOIN", backend: "", active: true }], backends: [] });
  context.sdeReady();
  assert.deepEqual(calls, []);
  assert.equal(elements.root.className, "setup");
  assert.equal(elements.root.children[2].children[0].textContent,
    "reading a table - missing: ZCL_SDE_ADT_RES_TABLE is not active");
});

test("a window opened on a plan - Run Select's SELECT - starts from it; an empty line restricts nothing", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/table.html"), "utf8");
  const plan = { table: "ZLOG_PIPELINE", filters: [
    { field: "scenario_id", sign: "I", option: "EQ", low: "", high: "" },
    { field: "step_no", sign: "I", option: "BT", low: "010", high: "030" }] };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace("/*INIT*/null/*INIT*/", JSON.stringify(plan));
  const { context, calls } = page();
  context.window = { addEventListener() {} };
  vm.runInContext(script.split("/* ---------- wiring ---------- */")[1], context);
  context.startWindow();
  assert.deepEqual(calls, [["load", "ZLOG_PIPELINE", 100, "f1=step_no&s1=I&o1=BT&l1=010&h1=030"]]);
  assert.deepEqual(Array.from(context.criteria, c => c.field), ["scenario_id", "step_no"]);
});

test("a plan's join types and ON go to the join resource; a table taken by hand drops the ON", () => {
  const { context, calls } = page();
  context.applyPlan({ table: "E070", filters: [], join: ["E070"], fields: ["t1~trkorr"], jtypes: { T1: "INNER" },
    on: { T1: "t1~trkorr = t0~strkorr" }, pivot: none });
  assert.equal(calls[0][0], "join");
  assert.equal(calls[0][6], "pick=X&sf1=t1~trkorr&jT1=INNER&onT1=t1~trkorr%20%3D%20t0~strkorr");
  context.toggleTaken("E07T");
  assert.ok(!calls[1][6].includes("onT1"));
});

test("Run Select's table is read with its SELECT list; Show hidden reads every field and leaves the others unticked", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/table.html"), "utf8");
  const plan = { table: "E070", filters: [{ field: "as4user", sign: "I", option: "EQ", low: "", high: "" }], columns: ["trkorr"] };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace("/*INIT*/null/*INIT*/", JSON.stringify(plan));
  const { context, calls, elements } = page();
  context.window = { addEventListener() {} };
  vm.runInContext(script.split("/* ---------- wiring ---------- */")[1], context);
  context.startWindow();
  assert.deepEqual(calls[0], ["load", "E070", 100, "pick=X&sf1=trkorr"]);
  context.render({ table: "e070", count: 0, rows: [], fields: [{ name: "trkorr", key: true, datatype: "CHAR", text: "Request" }] });
  const list = elements.criteria.children[0];
  assert.equal(list.children.length, 3, "a heading, the field read, and the condition's field");
  const more = elements.criteria.children[1];
  assert.equal(more.textContent, "Show hidden");
  more.handlers.click();
  assert.deepEqual(calls[1], ["load", "E070", 100, ""]);
  context.render({ table: "e070", count: 0, rows: [], fields: [
    { name: "trkorr", key: true, datatype: "CHAR", text: "Request" }, { name: "as4user", key: false, datatype: "CHAR", text: "Owner" }] });
  assert.deepEqual(JSON.parse(JSON.stringify(context.hidden)), { as4user: true });
  // The owner's From cell: typing makes the line a criterion.
  const from = elements.criteria.children[0].children[2].children[3].children[0];
  from.handlers.input({ target: { value: "dev" } });
  assert.deepEqual(Array.from(context.criteria, c => [c.field, c.low]), [["as4user", "DEV"]]);
  context.load("E071");
  assert.deepEqual(calls[2], ["load", "E071", 100, ""]);
});

test("a join's selection lists the fields of its tables under its column names; Shown is the SELECT list and runs it again", () => {
  const { context, calls, elements } = page();
  context.applyPlan({ table: "E070", filters: [{ field: "t1_trstatus", sign: "I", option: "EQ", low: "", high: "" }], join: ["E070"],
    fields: ["t1~trkorr"], jtypes: { T1: "INNER" }, on: { T1: "t1~trkorr = t0~strkorr" }, pivot: none });
  context.renderJoin({ table: "e070", sql: "x", rows: [], candidates: [],
    tables: [{ alias: "T0", tabname: "E070", jtype: "LEFT OUTER", cond: "" }, { alias: "T1", tabname: "E070", jtype: "INNER", cond: "t1~trkorr = t0~strkorr" }], fields: [
    { sel: false, alias: "T0", fieldname: "TRKORR", key: true, ddtext: "Request" },
    { sel: true, alias: "T1", fieldname: "TRKORR", key: true, ddtext: "Request" },
    { sel: false, alias: "T1", fieldname: "TRSTATUS", key: false, ddtext: "Status" }] });
  const rows = elements.criteria.children[0].children;
  assert.deepEqual(rows.slice(1).map(r => r.children[1].textContent), ["Request", "T1 \u00b7 Request", "T1 \u00b7 Status"]);
  assert.deepEqual(rows.slice(1).map(r => r.children[0].children[0].checked), [false, true, false]);
  rows[3].children[0].children[0].handlers.change({ target: { checked: true } });
  assert.match(calls.at(-1)[6], /pick=X&sf1=t1~trkorr&sf2=t1~trstatus/);
});

test("a pivot's selection is the same field list, without Shown - its columns are its slots", () => {
  const { context, elements } = page();
  context.applyPlan({ table: "E070", filters: [], join: [], fields: [], pivot: { rows: ["t0~trstatus"], cols: [], vals: [{ key: "*", agg: "COUNT" }] } });
  context.renderJoin({ table: "e070", sql: "x", pivot: true, rows: [], candidates: [],
    tables: [{ alias: "T0", tabname: "E070", jtype: "LEFT OUTER", cond: "" }],
    fields: [{ sel: true, alias: "T0", fieldname: "TRSTATUS", key: false, ddtext: "Status", aggs: ["COUNT"], agg: "COUNT" }] });
  const rows = elements.criteria.children[0].children;
  assert.equal(rows[1].children[1].textContent, "Status");
  assert.equal(rows[1].children[0].children.length, 0);
});

test("the pivot offers the fields the join selected, not every field of its tables", () => {
  const { context } = page();
  const fields = [{ sel: true, alias: "T0", fieldname: "CARRID", key: true }, { sel: false, alias: "T1", fieldname: "CUSTOMID", key: false }];
  context.applyPlan({ table: "SFLIGHT", filters: [], join: ["SBOOK"], fields: [], pivot: { rows: ["t0~carrid"], cols: [], vals: [] } });
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../org.vertex.abap.ui/resources/table.html"), "utf8");
  assert.match(html, /crossPanel\(\(data\.fields \|\| \[\]\)\.filter\(function \(f\) \{ return f\.sel === "X" \|\| f\.sel === true; \}\)\)/);
  assert.equal(fields.filter(f => f.sel).length, 1);
});
