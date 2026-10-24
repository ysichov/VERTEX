"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/metrics.html"), "utf8");
const linkSource = page.slice(page.indexOf("function linkUmlMethods("), page.indexOf("function draw(preserveViewport)"));
const clickSource = page.slice(page.indexOf("function onDiagramClick("), page.indexOf("function requestHybridLogic("));

test("UML method links navigate to their own class or interface in either source host", () => {
  const opened = [];
  const methodEntry = (label) => ({ tagName: "tspan", textContent: label, dataset: {}, style: {},
    querySelector() { return null; },
    setAttribute(name, value) { this[name] = value; } });
  const classMethod = methodEntry("+RUN()");
  const interfaceMethod = methodEntry("+APPLY()");
  const group = (id, entry, title) => ({ id,
    querySelector() { return title ? { textContent: title } : null; },
    querySelectorAll() { return [entry]; } });
  const context = vm.createContext({
    umlDiagram: { nodes: [{ name: "ZCL_RUNNER", kind: "class", methods: ["RUN"] },
      { name: "ZIF_TASK", kind: "interface", methods: ["APPLY"] }] },
    sdeOpenToolSource: args => opened.push(args), mode: "class"
  });
  vm.runInContext(linkSource + clickSource, context);
  context.linkUmlMethods({ querySelectorAll() { return [group("classId-n0-0", classMethod), group("n1", interfaceMethod, "ZIF_TASK")]; } });
  for (const entry of [classMethod, interfaceMethod]) {
    assert.equal(entry.role, "link");
    context.onDiagramClick({ target: { closest: () => entry }, preventDefault() {}, stopPropagation() {} });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [
    { name: "ZCL_RUNNER", type: "CLAS", method: "RUN", beside: true, preserveFocus: true, newTab: false },
    { name: "ZIF_TASK", type: "INTF", method: "APPLY", beside: true, preserveFocus: true, newTab: false }
  ]);
});

test("SAP source navigation reuses the group the source already stands in, not a new one beside the UML view", async () => {
  const workbench = fs.readFileSync(path.join(__dirname, "../code-workbench.js"), "utf8");
  const source = workbench.slice(workbench.indexOf("async function revealSource("), workbench.indexOf("async function openToolSource("));
  const document = { uri: { scheme: "vertex-sap" } };
  let options;
  const context = vm.createContext({
    navigation: [],
    vscode: { ViewColumn: { One: 1, Beside: -2 }, TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
      Selection: class { constructor(start, end) { this.active = end; } },
      Range: class {},
      window: { visibleTextEditors: [{ document, viewColumn: 1, selection: { active: { line: 0 } } }],
        showTextDocument: async (_document, value) => { options = value; return { selection: null, revealRange() {} }; } } }
  });
  vm.runInContext(source, context);
  await context.revealSource(document, { line: 4 }, true, true);
  assert.equal(options.viewColumn, 1);
  assert.equal(options.preserveFocus, true);
});
