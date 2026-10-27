"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { capture, restore } = require("../debug-panel-state");
test("reload rebuilds the local source binding without executing or retaining the old trace", async () => {
  const document = { uri: { toString: () => "file:///tmp/demo.abap" } };
  const saved = JSON.parse(JSON.stringify(capture({ object_name: "Z_DEMO", object_type: "PROG", local: true,
    document, entryLine: 12, autoRun: true, transpilerRun: { run_id: "old" } })));
  const opened = [];
  const source = await restore(saved, { openTextDocument: async uri => { opened.push(uri); return document; } }, { parse: uri => uri });
  assert.deepEqual(opened, ["file:///tmp/demo.abap"]);
  assert.equal(source.document, document);
  assert.equal(source.entryLine, 12);
  assert.equal(source.autoRun, false);
  assert.equal(source.runOnly, false);
  assert.equal(source.transpilerRun, undefined);
});
test("reload keeps the SAP system and source mapping", async () => {
  const sapCopies = { system: "DEV", root: { object_name: "Z_DEMO", system_name: "DEV" }, copies: [] };
  const saved = capture({ object_name: "Z_DEMO", object_type: "PROG", system_name: "DEV", sapCopies });
  const source = await restore(saved, { openTextDocument: () => assert.fail("SAP mode needs no local document") }, {});
  assert.equal(source.system_name, "DEV");
  assert.deepEqual(source.sapCopies, sapCopies);
});
test("saved replay objects and missing bindings do not become live programs", async () => {
  assert.equal(capture({ object_name: "Z_DEMO", storedRun: {} }), undefined);
  assert.equal(capture({ object_name: "Z_DEMO", storedDebugRecord: {} }), undefined);
  assert.equal(await restore(null, {}, {}), null);
  assert.equal(await restore({ object_name: "Z_DEMO", local: true }, {}, {}), null);
});
test("an unavailable local source reports restoration failure", async () => {
  await assert.rejects(restore({ object_name: "Z_DEMO", local: true, uri: "file:///missing.abap" },
    { openTextDocument: async () => { throw new Error("File missing"); } }, { parse: uri => uri }), /File missing/);
});
test("a manually entered caller program survives serialization separately from its class", async () => {
  const saved = JSON.parse(JSON.stringify(capture({ object_name: "ZCL_CALC", object_type: "CLAS",
    system_name: "DEV", program: "Z_CALC_DRIVER" })));
  const source = await restore(saved, {}, {});
  assert.equal(source.object_name, "ZCL_CALC");
  assert.equal(source.program, "Z_CALC_DRIVER");
  assert.equal(source.autoRun, false);
});
test("typing a program persists it without requiring Run or changing focus", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  const bridge = fs.readFileSync(path.join(__dirname, "../tools-window.js"), "utf8");
  const start = bridge.indexOf('    document.addEventListener("DOMContentLoaded",()=>{');
  const snippet = bridge.slice(start, bridge.indexOf('\n    window.sdeOrigin=', start));
  const messages = [], listeners = {}, program = { value: "", addEventListener: (type, fn) => { listeners[type] = fn; } };
  vm.runInNewContext(snippet, { document: { addEventListener: (type, fn) => fn(), getElementById: () => program },
    host: { postMessage: message => messages.push(message) } });
  program.value = "Z_DEMO"; listeners.input();
  assert.equal(messages[0].call, "debugProgram");
  assert.equal(messages[0].program, "Z_DEMO");
  program.value = ""; listeners.input();
  assert.equal(messages[1].program, "");
});
