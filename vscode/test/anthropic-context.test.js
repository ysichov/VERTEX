"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const chat = require("../chat"), anthropic = require("../anthropic"), workspace = require("../tools-window");

test("sidebar line-count question sends the published method in one bounded Anthropic request", async t => {
  let receive, state, raw;
  const panel = { webview: { onDidReceiveMessage: fn => { receive = fn; } }, onDidDispose() {} };
  const settings = { provider: "anthropic-api", model: "test-model" };
  const vscode = { ViewColumn: { Active: 1 }, extensions: { getExtension: () => null },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
      onDidChangeConfiguration: () => ({ dispose() {} }) },
    window: { createWebviewPanel: () => panel, tabGroups: { all: [] } } };
  workspace.open(vscode, { subscriptions: [] }, { pages: path.resolve(__dirname, "../../org.vertex.abap.ui/resources"),
    chat: () => null, active: () => ({ system: { name: "QAS" } }), setContext: (_panel, value) => { state = value; },
    debugger: { watch: () => () => {}, picture: () => ({}) } }, null);
  const method = ["METHOD add_cr_diag.", "CHECK mv_code_review = abap_true.", "CHECK iv_text IS NOT INITIAL.",
    "IF lines( mt_cr_diag ) < 300.", "APPEND iv_text TO mt_cr_diag.", "ENDIF.", "ENDMETHOD."];
  await receive({ call: "vertexContext", args: [{ vertex_view: { type: "CLAS", name: "ZCL_TEST", view: "metrics", part: "add_cr_diag" },
    selected_fragment: { kind: "visible_part", text: method.join("\n"), start_line: 1, end_line: 7 },
    workspace: { type: "CLAS", name: "ZCL_AVE_POPUP", action: "metrics" } }] });
  assert.equal(state.selected_fragment.text, method.join("\n"));
  assert.equal(state.workspace.action, "metrics");
  const bodies = [];
  t.mock.method(https, "request", (_options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.end = payload => {
      bodies.push(JSON.parse(payload));
      const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {};
      callback(res);
      res.emit("data", JSON.stringify({ content: [{ type: "text", text: "7 строк." }],
        usage: { input_tokens: 600, output_tokens: 8 } })); res.emit("end");
    }; return req;
  });
  const tools = { schemas: [{ name: "read_sap_object", inputSchema: {} }], instructions: "",
    editorContext: () => ({ source: "UNRELATED_FULL_CLASS".repeat(20000) }),
    execute: () => { throw new Error("Unexpected SAP call"); } };
  const ask = chat.create(vscode, tools, { start: () => { throw new Error("Unexpected MCP start"); } },
    { get: async () => "fake-key" });
  const result = await ask("сколько строк в методе?", { state });
  assert.equal(result.answer, "7 строк."); assert.equal(bodies.length, 1);
  // The tools stay; the method on screen answers the question without a call.
  assert.deepEqual(bodies[0].tools.map(x => x.name), ["read_sap_object", "submit_vertex_answer"]);
  assert.ok(Buffer.byteLength(JSON.stringify(bodies[0])) < 10000);
  assert.doesNotMatch(JSON.stringify(bodies[0]), /UNRELATED_FULL_CLASS/);
  assert.match(bodies[0].messages[0].content, /APPEND iv_text/);
});

test("oversized Anthropic payload is rejected before any network request", async t => {
  const network = t.mock.method(https, "request", () => { throw new Error("Must not contact API"); });
  await assert.rejects(anthropic.ask({ apiKey: "fake", prompt: "x".repeat(130000), instructions: "", schema: {}, tools: [] }), /nothing was sent/);
  assert.equal(network.mock.callCount(), 0);
});

test("Anthropic reports each model round to the common session logger", async t => {
  const replies = [
    { content: [{ type: "tool_use", id: "tool-1", name: "read_sap_object", input: { object_name: "ZCL_A" } }],
      usage: { input_tokens: 10, output_tokens: 2 } },
    { content: [{ type: "text", text: "Done" }], usage: { input_tokens: 20, output_tokens: 3 } }
  ];
  t.mock.method(https, "request", (_options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.end = () => {
      const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {};
      callback(res); res.emit("data", JSON.stringify(replies.shift())); res.emit("end");
    }; return req;
  });
  const rounds = [];
  const result = await anthropic.ask({ apiKey: "fake", model: "test", instructions: "", prompt: "Read",
    tools: [{ name: "read_sap_object", description: "Read", inputSchema: {} }], schema: {},
    callTool: async () => ({ source: "CLASS zcl_a." }), onModelCall: round => rounds.push(round) });
  assert.equal(result.plan.answer, "Done");
  assert.deepEqual(rounds.map(round => round.usage.input_tokens), [10, 20]);
});

test("Anthropic reads multiple SAP objects sequentially through one session", async t => {
  const requests = [];
  const replies = [
    { content: [
      { type: "tool_use", id: "first", name: "read_sap_object", input: { object_name: "ZCL_A" } },
      { type: "tool_use", id: "second", name: "read_sap_object", input: { object_name: "ZCL_B" } }
    ] },
    { content: [{ type: "text", text: "Both classes read." }] }
  ];
  t.mock.method(https, "request", (_options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.end = payload => {
      requests.push(JSON.parse(payload));
      const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {};
      callback(res); res.emit("data", JSON.stringify(replies.shift())); res.emit("end");
    }; return req;
  });
  let active = false;
  const result = await anthropic.ask({ apiKey: "fake", model: "test", instructions: "", prompt: "Read two classes",
    tools: [{ name: "read_sap_object", description: "Read", inputSchema: {} }], schema: {},
    callTool: async (_name, args) => {
      if (active) throw new Error("SAP session is busy");
      active = true;
      await new Promise(resolve => setTimeout(resolve, 1));
      active = false;
      return { object_name: args.object_name };
    } });
  assert.equal(result.plan.answer, "Both classes read.");
  assert.deepEqual(requests[1].messages[2].content.map(item => JSON.parse(item.content).object_name), ["ZCL_A", "ZCL_B"]);
});


test('Anthropic withholds a rejected answer and continues with review feedback',async t=>{
 const bodies=[],shown=[],replies=[{content:[{type:'text',text:'unfinished'}]},{content:[{type:'tool_use',id:'final',name:'submit_vertex_answer',input:{answer:'verified',navigation:null}}]}];let checks=0;
 t.mock.method(https,'request',(_options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=payload=>{bodies.push(JSON.parse(payload));const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>{};callback(res);res.emit('data',JSON.stringify(replies.shift()));res.emit('end');};return req;});
 const result=await anthropic.ask({apiKey:'fake',model:'test',instructions:'rules',prompt:'task',tools:[],schema:{},onBeforeAnswer:async()=>++checks===1?'Finish the available task':null,onModelCall:event=>{if(!event.withheld)shown.push(event.text);}});
 assert.equal(result.plan.answer,'verified');assert.equal(checks,2);assert.match(JSON.stringify(bodies[1].messages),/Finish the available task/);assert.deepEqual(shown,['verified']);
});


test('Anthropic planner is forced to return fields through the root result tool schema',async t=>{
 const schema=require('../orchestrator-plan').PLAN_SCHEMA,plan={goal:'task',context:[],steps:[{id:1,action:'read',tools:[],depends_on:[],success_criteria:['evidence'],on_failure:'inspect error'}],recovery:[],completion_checks:['verify']};
 t.mock.method(https,'request',(_options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=payload=>{const body=JSON.parse(payload);assert.deepEqual(body.tool_choice,{type:'tool',name:'submit_vertex_answer'});assert.deepEqual(body.tools[0].input_schema,schema);assert.equal(body.tools.length,1);const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>{};callback(res);res.emit('data',JSON.stringify({content:[{type:'tool_use',id:'result',name:'submit_vertex_answer',input:plan}]}));res.emit('end');};return req;});
 const result=await anthropic.ask({apiKey:'fake',model:'test',prompt:'task',instructions:'Plan',schema,structuredResult:true,textOnly:true,tools:[]});assert.deepEqual(result.plan,plan);
});
