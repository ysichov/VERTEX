"use strict";
// Value origin in the Eclipse plugin: the VS Code analysis as one browser script, and the page that hosts it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { bundle } = require("./value-origin-bundle");

const root = path.join(__dirname, "..");
const plugin = path.join(root, "org.vertex.abap.ui");

// As the plugin's browser runs it: a window, and no require, module or process.
function browserOrigin() {
  const window = {};
  vm.runInNewContext(bundle(root), { window });
  return window.vertexOrigin;
}
const scriptsOf = page => [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(match => !match[1].includes("application/json") && match[2].trim()).map(match => match[2]);

test("the plugin carries the bundle and page prepare.js makes from the current sources", () => {
  assert.equal(fs.readFileSync(path.join(plugin, "assistant", "value-origin.js"), "utf8"), bundle(root),
    "run node eclipse/prepare.js");
  assert.equal(fs.readFileSync(path.join(plugin, "assistant", "value-origin.html"), "utf8"),
    fs.readFileSync(path.join(__dirname, "value-origin.html"), "utf8"), "run node eclipse/prepare.js");
  assert.equal(fs.readFileSync(path.join(plugin, "assistant", "value-origin.css"), "utf8"),
    fs.readFileSync(path.join(root, "vscode", "value-origin.css"), "utf8"), "run node eclipse/prepare.js");
});

test("the analysis runs in a browser context and draws the page with everything carried inline", () => {
  const origin = browserOrigin();
  const text = "DATA x TYPE i.\nx = 2.\nWRITE x.";
  assert.equal(origin.variableAt(text, text.lastIndexOf("x")), "X");
  assert.equal(origin.literalAt("WRITE 'x'.", 7), "literal");
  const graph = origin.analyze([{ id: "demo", text }], { source: "demo", variable: "x", line: 3 });
  const sources = [{ id: "demo", name: "demo", objectName: "DEMO", objectType: "PROG" }];
  graph.codeFlow = { rows: origin.pathRows(graph, sources), sites: origin.siteRows(graph, sources) };
  const flowGraph = {};
  vm.runInNewContext(fs.readFileSync(path.join(plugin, "resources", "vertex-flow-graph.js"), "utf8"), { window: flowGraph });
  // A library may hold "</script>" in a string; inline, it must not end its tag.
  const page = origin.html(graph, "n0nce", "", "", "", "", "", { flowGraph: flowGraph.vertexFlowGraph,
    scripts: { mermaid: "var mermaidText='</script>';", flow: "var flowText=1;", lens: "var lensText=1;" },
    style: ".controls{}", head: "<style>:root{--vscode-foreground:#000}</style>", bridge: "window.acquireVsCodeApi=function(){};" });
  assert.doesNotMatch(page, /<script[^>]*\bsrc=/);
  assert.doesNotMatch(page, /<link\b/);
  assert.match(page, /<style>\.controls\{\}<\/style><style>:root\{--vscode-foreground:#000\}<\/style><\/head>/);
  const scripts = scriptsOf(page);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script), "inline script " + index));
  assert.ok(scripts.some(script => script.includes("mermaidText='<\\/script>'")), "the library's own </script> is escaped");
  // The bridge stands before the script that calls acquireVsCodeApi.
  const bridge = scripts.findIndex(script => script.includes("window.acquireVsCodeApi=")), caller = scripts.findIndex(script => script.includes("const api=acquireVsCodeApi()"));
  assert.ok(bridge >= 0 && bridge < caller);
});

test("the Eclipse page parses once ValueOriginView has put its scripts and target in", () => {
  // What ValueOriginView.readResource and initialLiteral do to the page - literally, as Java's String.replace does.
  const inline = script => script.split("</script").join("<\\/script");
  const target = JSON.stringify({ project: "P", name: "ZDEMO", type: "PROG", sourcePath: "/sap/bc/adt/programs/programs/zdemo/source/main",
    text: "WRITE '</script>'.", offset: 0, line: 1, column: 0, breakpoints: [2, 5] }).split("<").join("\\u003c");
  const page = fs.readFileSync(path.join(__dirname, "value-origin.html"), "utf8")
    .replace("/*FLOW_GRAPH*/", () => inline(fs.readFileSync(path.join(plugin, "resources", "vertex-flow-graph.js"), "utf8")))
    .replace("/*ORIGIN_ENGINE*/", () => inline(bundle(root)))
    .replace("/*INIT*/null/*INIT*/", () => target);
  const scripts = scriptsOf(page);
  assert.equal(scripts.length, 3);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script), "page script " + index));
});

test("Value origin is offered in the context menu of an ABAP editor", () => {
  const xml = fs.readFileSync(path.join(plugin, "plugin.xml"), "utf8");
  assert.match(xml, /<command\s+commandId="org\.vertex\.abap\.ui\.command\.valueOrigin"\s+label="VERTEX: Analyze Variable Value Origin"/);
  assert.match(xml, /commandId="org\.vertex\.abap\.ui\.command\.valueOrigin"\s+class="org\.vertex\.abap\.ui\.ValueOriginHandler"/);
  assert.match(xml, /id="org\.vertex\.abap\.ui\.view\.valueOrigin"[\s\S]*?class="org\.vertex\.abap\.ui\.ValueOriginView"/);
});
