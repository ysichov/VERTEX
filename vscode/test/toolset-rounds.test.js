"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("an OpenAI-compatible request offers tools added during the request from the next step", async () => {
  const compatible = require("../openai-compatible");
  const id = Object.keys(compatible.PROVIDERS).find(key => key !== "vercel-api" && key !== "openrouter-api");
  const tools = [{ name: "enable_toolset", description: "enable", inputSchema: { type: "object", properties: {} } }];
  const offered = [];
  let step = 0;
  const request = async (_id, _key, _route, body) => {
    offered.push(body.tools.map(tool => tool.function.name));
    step += 1;
    const call = step === 1 ? { name: "enable_toolset", arguments: "{}" }
      : step === 2 ? { name: "abap_objects_generator_list", arguments: "{}" }
      : { name: "submit_vertex_answer", arguments: JSON.stringify({ answer: "done", navigation: null }) };
    return { model: "m", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c" + step, type: "function", function: call }] } }] };
  };
  const ran = [];
  const result = await compatible.ask({ assistant: id, model: "m", apiKey: "k", prompt: "make a RAP service", instructions: "i",
    schema: { type: "object" }, tools, request, maxRounds: 5,
    callTool: async name => {
      ran.push(name);
      if (name === "enable_toolset") tools.push({ name: "abap_objects_generator_list", description: "gen", inputSchema: { type: "object", properties: {} } });
      return { ok: true };
    } });
  assert.equal(result.plan.answer, "done");
  assert.deepEqual(ran, ["enable_toolset", "abap_objects_generator_list"]);
  assert.deepEqual(offered[0], ["enable_toolset", "submit_vertex_answer"]);
  assert.deepEqual(offered[1], ["enable_toolset", "abap_objects_generator_list", "submit_vertex_answer"]);
});

test("the Anthropic request offers tools added during the request from the next step", async () => {
  const anthropic = require("../anthropic");
  assert.match(require("node:fs").readFileSync(require.resolve("../anthropic"), "utf8"), /apiTools = toolsNow\(\);[\s\S]{0,1500}?const response = await request\(/,
    "the tool list is rebuilt at the start of every step, before that step's request");
  assert.equal(typeof anthropic.ask, "function");
});

test("the request limit counts the conversation, not the tool definitions", async () => {
  const compatible = require("../openai-compatible");
  const id = Object.keys(compatible.PROVIDERS).find(key => key !== "vercel-api" && key !== "openrouter-api");
  const big = { type: "object", properties: { note: { type: "string", description: "x".repeat(100000) } } };
  const tools = [{ name: "abap_big", description: "big", inputSchema: big }];
  let limit = 0, sent = 0;
  const request = async (_id, _key, _route, body, maxBytes) => {
    limit = maxBytes; sent = Buffer.byteLength(JSON.stringify(body), "utf8");
    return { model: "m", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c", type: "function",
      function: { name: "submit_vertex_answer", arguments: JSON.stringify({ answer: "ok", navigation: null }) } }] } }] };
  };
  await compatible.ask({ assistant: id, model: "m", apiKey: "k", prompt: "q", instructions: "i", schema: { type: "object" }, tools, request, callTool: async () => ({}) });
  assert.ok(sent > 100000, "the request carries the large tool definitions");
  assert.ok(limit >= sent, "and still fits the limit: " + limit + " >= " + sent);
  assert.ok(limit - Buffer.byteLength(JSON.stringify(tools), "utf8") < 140000, "the conversation keeps its own 128 KB");
});

test('API transport rebuilds schemas after a staged selection in the same request',async()=>{
 const router=require('../orchestrator-plan'),compatible=require('../openai-compatible'),tools=[],candidates=[{name:'read_object',inputSchema:{type:'object'}},{name:'read_dependencies',inputSchema:{type:'object'}}];
 let selections=0,round=0;const offered=[],ran=[];
 const session=router.createSession({vscode:{},task:'inspect',context:{},tools:candidates,schemas:tools,choose:async()=>({tools:[candidates[selections++]],permissions:{write:false,execute:false}})});await session.start();
 const request=async(_id,_key,_route,body)=>{offered.push(body.tools.map(t=>t.function.name));round++;const call=round===1?{name:router.STEP,arguments:JSON.stringify({subtask:'Inspect dependencies',evidence:'Object supplied'})}:round===2?{name:'read_dependencies',arguments:'{}'}:{name:'submit_vertex_answer',arguments:JSON.stringify({answer:'done'})};return {choices:[{message:{role:'assistant',tool_calls:[{id:'s'+round,type:'function',function:call}]}}]};};
 const result=await compatible.ask({assistant:'openai-api',model:'test',apiKey:'test',prompt:'inspect',instructions:'stages',schema:{type:'object'},tools,request,maxRounds:4,callTool:(name,args)=>session.run(name,args,async n=>{ran.push(n);return 'deps';})});
 assert.equal(result.plan.answer,'done');assert.equal(selections,2);assert.ok(offered[0].includes('read_object'));assert.ok(!offered[0].includes('read_dependencies'));assert.ok(offered[1].includes('read_dependencies'));assert.ok(!offered[1].includes('read_object'));assert.deepEqual(ran,['read_dependencies']);
});

test('A hidden tool hallucination returns an error to the model and staged recovery completes without invoking it',async()=>{
 const api=require('../openai-compatible'),router=require('../orchestrator-plan'),schemas=[];let selections=0,round=0;const ran=[];
 const catalog=[{name:'SAPRead',description:'Read source',inputSchema:{type:'object'}},{name:'SAPContext',description:'Inspect dependencies',inputSchema:{type:'object'}}];
 const session=router.createSession({vscode:{},task:'inspect',context:{},tools:catalog,schemas,choose:async()=>({tools:[catalog[selections++]],permissions:{write:false,execute:false}})});await session.start();
 const request=async(_p,_k,_r,body)=>{
   round++;if(round===2)assert.match(body.messages.filter(m=>m.role==='tool').at(-1).content,/missing capability/);
   const f=round===1?{name:'SAPContext',arguments:'{}'}:round===2?{name:router.STEP,arguments:JSON.stringify({subtask:'Inspect dependencies',evidence:'Need the dependency capability'})}:round===3?{name:'SAPContext',arguments:'{}'}:{name:'submit_vertex_answer',arguments:'{"answer":"done"}'};
   return {choices:[{message:{role:'assistant',tool_calls:[{id:'r'+round,type:'function',function:f}]}}]};
 };
 const result=await api.ask({assistant:'vercel-api',apiKey:'test',model:'test',prompt:'inspect',instructions:'stages',schema:{type:'object'},tools:schemas,request,maxRounds:5,recoverUnavailableTools:true,callTool:(n,a)=>session.run(n,a,async name=>{ran.push(name);return 'dependency evidence';})});
 assert.equal(result.plan.answer,'done');assert.deepEqual(ran,['SAPContext']);assert.equal(selections,2);
});
