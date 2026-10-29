"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/metrics.html"), "utf8");
const source = page.slice(page.indexOf("function openMetricSource("), page.indexOf("function classMetrics("));

test("unbound package Metrics frame receives the source-opening bridge", () => {
  const toolsPage = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/tools.html"), "utf8");
  const opened = [], child = { addEventListener() {}, document: { addEventListener() {} } }, frame = { contentWindow: child, dataset: { generation: "1" } };
  const context = vm.createContext({ syncTheme() {}, current: { action: "metrics" }, initial: null, localFolderState: null,
    document: {}, window: {}, sidebarChat: false, resultFrames: new Map([["metrics", frame]]), result: frame,
    sdeOpenToolSource: value => opened.push(JSON.parse(value)), VertexRoutes: { SERVICES: { metrics: {} } } });
  vm.runInContext(toolsPage.slice(toolsPage.indexOf("function wireClipboard("), toolsPage.indexOf("function enqueue(")), context);
  context.connect(child, "metrics", 1);
  assert.equal(typeof child.sdeOpenToolSource, "function");
  child.sdeOpenToolSource({ name: "ZCL_A", type: "CLAS", method: "RUN" });
  assert.deepEqual(opened, [{ name: "ZCL_A", type: "CLAS", method: "RUN" }]);
});

test("package Metrics method links open their owning object beside the table", () => {
  const opened = [];
  const element = tag => ({ tag, children: [], textContent: "", style: {},
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {}, addEventListener(name, fn) { this[name] = fn; } });
  const context = vm.createContext({ document: { createElement: element }, chosenKey: null,
    partKeyOf: value => value, cellValue: row => row.unit_name, METRIC_LIMITS: {},
    rounded: value => String(value), metricGrade: () => "", loadedObject: "SRC", loadedType: "DEVC",
    sdeOpenToolSource: args => opened.push(args) });
  vm.runInContext(source, context);
  const table = context.makeTable([{ key: "unit_name", text: "Method", num: false }],
    [{ unit_name: "ZCL_MOD_FUEL=>ZIF_CALC_MODIFIER~APPLY" }], null, true, null,
    { name: "ZCL_MOD_FUEL", type: "CLAS" });
  const find = node => node.tag === "button" ? node : node.children.map(find).find(Boolean);
  find(table).click();
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ name: "ZCL_MOD_FUEL", type: "CLAS",
    method: "ZIF_CALC_MODIFIER~APPLY", beside: true, preserveFocus: true }]);
});

test("Visual double-click opens source with focus", () => {
  const opened = [];
  const context = vm.createContext({ sdeOpenToolSource: args => opened.push(args), loadedObject: "SRC", loadedType: "CLAS" });
  vm.runInContext(page.slice(page.indexOf("function openMetricSource("), page.indexOf("function metricMapRisk(")), context);
  context.openMetricSource({ unit_name: "ZCL_A=>RUN" }, { name: "ZCL_A", type: "CLAS" }, true);
  context.openMetricSource({ unit_name: "FORM BUILD", writtenIn: { name: "ZINC", type: "INCL", line: 12 } },
    { name: "ZREP", type: "PROG" }, true);
  context.openMetricSource({ unit_name: "START-OF-SELECTION", line_from: 24 },
    { name: "ZREP", type: "PROG" }, true);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [
    { name: "ZCL_A", type: "CLAS", method: "RUN", beside: true, preserveFocus: false },
    { name: "ZINC", type: "INCL", line: 12, beside: true, preserveFocus: false },
    { name: "ZREP", type: "PROG", line: 24, beside: true, preserveFocus: false }
  ]);
});
