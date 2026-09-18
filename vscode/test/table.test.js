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
      createTextNode: text => ({ textContent: text })
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
    "Not on this system: the join builder - the Simple-Data-Explorer there is older than this window.");
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
