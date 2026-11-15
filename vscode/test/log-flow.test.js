"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const flow = require("../log-flow"), logs = require("../log-report");

test("absent stages are omitted, not drawn as successful or empty steps", () => {
  assert.deepEqual(flow.stages({text:"Hello",details:[],timeline:[]}).map(s=>s.kind),["prompt"]);
  assert.deepEqual(flow.stages({text:"Hello",details:[{type:"answer",text:"Hi"}],timeline:[]}).map(s=>s.kind),["prompt","answer"]);
});

test("graph index preserves verification retries, Jev and review without bodies", () => {
  const prompt={key:"s:0",text:"Change",details:[
    {type:"Topic routing (Jev)",text:"sensitive routing state"},
    {type:"tool",name:"Read",tool_id:"r",text:"secret file body"},
    {type:"tool",name:"Verification",tool_id:"v1"},
    {type:"tool result",tool_id:"v1",text:"VERTEX automatic checks: FAILED",failed:true},
    {type:"tool",name:"Verification",tool_id:"v2"},
    {type:"tool result",tool_id:"v2",text:"VERTEX automatic checks: PASSED"},
    {type:"answer",text:"large answer body"},{type:"tool",name:"Review",tool_id:"review"}
  ],timeline:[{kind:"model",usageScope:"cli_turn"}]};
  const report=logs.listReport({sessions:[{prompts:[prompt]}]}),index=report.sessions[0].prompts[0];
  assert.equal(index.details,undefined);assert.equal(index.timeline,undefined);
  assert.deepEqual(index.flow.checks.map(c=>c.state),["failed","passed"]);
  assert.equal(index.flow.tools,1);assert.equal(index.flow.cliTurns,1);
  assert.doesNotMatch(JSON.stringify(index.flow),/sensitive|secret|large answer/);
  assert.deepEqual(flow.stages(index).map(s=>s.kind),["prompt","jev","steps","checks","answer","review"]);
  assert.equal(flow.stages(index).find(s=>s.kind==="checks").state,"passed");
});

test("missing check outcomes remain unknown and tool failures remain failed", () => {
  assert.equal(flow.summary({details:[{type:"tool",name:"Verification",tool_id:"u"},{type:"tool result",tool_id:"u",failed:true,text:"VERTEX automatic checks: UNVERIFIED"}]}).checks[0].state,"unverified");
  assert.equal(flow.summary({details:[{type:"tool",name:"Verification",tool_id:"x"}]}).checks[0].state,"unknown");
  const parsed=logs.parseSession([
    {type:"user",message:{content:"Fix"}},
    {type:"assistant",message:{content:[{type:"tool_use",id:"c",name:"Verification",input:{}}]}},
    {type:"user",message:{content:[{type:"tool_result",tool_use_id:"c",is_error:true,content:"failed to start"}]}}
  ].map(r=>JSON.stringify({timestamp:"2026-11-15T01:00:00Z",...r})).join("\n"),"codex_test.jsonl");
  assert.equal(flow.summary(parsed.prompts[0]).checks[0].state,"failed");
});
