"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const tool = require("../transpiler-tool");

test("transpiler agent tool requires an explicit class method line", () => {
  assert.throws(() => tool.validate({ object_type: "CLAS", object_name: "ZCL_CALC_FACADE" }), /entry_line/);
  assert.deepEqual(tool.validate({ object_type: "CLAS", object_name: "zcl_calc_facade", entry_line: 31 }), {
    object_name: "ZCL_CALC_FACADE", object_type: "CLAS", entryLine: 31, selection: {}
  });
});

test("transpiler agent tool describes selection screen and asks for required inputs", () => {
  const screen = { texts: { selections: { P_ID: "Shipment" } }, elements: [
    { kind: "parameter", name: "P_CLEAN", radio: "SC", default: "X" },
    { kind: "parameter", name: "P_ID", obligatory: true, default: "" },
    { kind: "select-option", name: "S_DATE", obligatory: true, default: null }
  ] };
  assert.deepEqual(tool.missingSelection(screen, {}), ["P_ID", "S_DATE"]);
  assert.deepEqual(tool.missingSelection(screen, { $parameters: { P_ID: "42" },
    $ranges: { S_DATE: [{ sign: "I", option: "EQ", low: "20261018" }] } }), []);
  assert.equal(tool.describeScreen(screen)[1].label, "Shipment");
});

test("transpiler agent tool asks for required method arguments", () => {
  const entry = { creation: [], parameters: [
    { name: "IV_SCENARIO", direction: "importing", optional: false },
    { name: "EV_RESULT", direction: "exporting", optional: false }
  ] };
  assert.deepEqual(tool.missingEntry(entry, {}), ["IV_SCENARIO"]);
  assert.deepEqual(tool.missingEntry(entry, { $entry: { parameters: { IV_SCENARIO: "CLEAN" } } }), []);
});

test("source acquisition queue orders requests and recovers after failure", async () => {
  const queue = tool.createRunQueue();
  const order = [];
  const first = queue(async () => { order.push("first"); throw new Error("read failed"); });
  const second = queue(async () => { order.push("second"); return 2; });
  assert.equal((await Promise.allSettled([first, second]))[1].value, 2);
  assert.deepEqual(order, ["first", "second"]);
});

test("transpiler agent tool normalizes selection case and refuses keys the screen lacks", () => {
  const screen = { elements: [
    { kind: "parameter", name: "P_CLEAN", radio: "SC", default: "X" },
    { kind: "parameter", name: "P_PREC", radio: "SC" },
    { kind: "parameter", name: "P_ID" }
  ] };
  assert.deepEqual(tool.normalizeSelection(screen, { sc: "p_prec", $parameters: { p_id: "7" } }),
    { SC: "P_PREC", $parameters: { P_ID: "7" } });
  assert.throws(() => tool.normalizeSelection(screen, { P_PREC: "X" }), /not on this screen.*"SC": one of P_CLEAN\/P_PREC/);
  assert.throws(() => tool.normalizeSelection(screen, { SC: "P_NONE" }), /no choice P_NONE/);
  assert.throws(() => tool.normalizeSelection(screen, { $parameters: { P_X: "1" } }), /P_X is not a parameter/);
});


test('the agent finds an open local report by declaration or filename even while a webview has focus',async t=>{
 const document={uri:{scheme:'file',fsPath:require('path').join(process.cwd(),'zfibonacci_report.abap')},getText:()=>"REPORT zfibonacci.\nPARAMETERS n TYPE i DEFAULT 10.\nWRITE n."};
 const vscode={window:{visibleTextEditors:[{document}]}};
 assert.equal(tool.findLocalReport(vscode,'ZFIBONACCI'),document);
 assert.equal(tool.findLocalReport(vscode,'ZFIBONACCI_REPORT'),document);
 assert.equal(tool.findLocalReport(vscode,'OTHER'),null);
 const launches=[];
 t.mock.method(require('../local-run'),'launch',async(_,__,options)=>{launches.push(options);return {records:[{line:3}],output:'12'};});
 const result=await tool.runLocalReport(vscode,{object_name:'ZFIBONACCI',object_type:'PROG',selection:{n:12}},document,{save:()=> 'run1',number:()=>1});
 assert.equal(launches.length,1);assert.equal(launches[0].document,document);
 assert.deepEqual(launches[0].selection,{$parameters:{N:12}});
 assert.equal(result.system,'local');assert.equal(result.output,'12');assert.equal(result.run_id,'run1');
});
