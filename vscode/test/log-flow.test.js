"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const flow = require("../log-flow"), logs = require("../log-report");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

test("absent stages are omitted, not drawn as successful or empty steps", () => {
  assert.deepEqual(flow.stages({text:"Hello",details:[],timeline:[]}).map(s=>s.kind),["prompt"]);
  assert.deepEqual(flow.stages({text:"Hello",details:[{type:"answer",text:"Hi"}],timeline:[]}).map(s=>s.kind),["prompt","answer"]);
});

test("routing reduction shows included content and hides excluded blocks", () => {
  const prompt={text:"Explain",details:[{type:"Topic routing (Jev)",routing:{contextReduction:{beforeCharacters:1200,afterCharacters:400,
    estimatedSavedTokens:200,method:"characters/4",blocks:[{index:0,role:"user",sourcePromptNumber:1,topicId:"topic_0001",topic:"Current task",included:true,estimatedTokens:50,preview:"Explain"},{index:1,role:"user",sourcePromptNumber:2,topicId:"topic_0002",topic:"Old build task",included:false,estimatedTokens:200,preview:"Build"}]}},text:"private routing state"}],timeline:[]};
  const index=flow.summary(prompt),steps=flow.contextStages({...prompt,flow:index},3);
  assert.equal(index.contextReduction.estimatedSavedTokens,200);
  assert.match(steps[0].label,/102 \/ 302 tokens/);
  assert.match(steps[0].label,/200 saved/);
  assert.deepEqual(steps.map(step=>step.kind),["prompt","section","included","included"]);
  assert.match(steps[2].title,/^1\. Prompt 3 · Included/);
  assert.doesNotMatch(JSON.stringify(steps),/Old build task|From prompt 2/);
  assert.equal(steps[1].title,"Included · 2 blocks");
  assert.equal(flow.stages({...prompt,flow:index}).some(step=>step.kind==="excluded"),false);
  assert.doesNotMatch(JSON.stringify(index),/private routing state/);
});

test("first request shows its question as fully included context", () => {
  const stages=flow.contextStages({text:"First question",flow:{contextReduction:{beforeCharacters:2,afterCharacters:2,
    currentPromptCharacters:14,estimatedSavedTokens:0,blocks:[]}}});
  assert.deepEqual(stages.map(stage=>stage.kind),["prompt","section","included"]);
  assert.match(stages[0].label,/100% included/);
  assert.match(stages[0].label,/0 saved/);
  assert.match(stages[2].label,/First question/);
});

test("Context totals measure cumulative savings across covered requests", () => {
  const groups=[
    {prompt:{text:"1234",flow:{contextReduction:{beforeCharacters:396,afterCharacters:196}}}},
    {prompt:{text:"1234",flow:{contextReduction:{beforeCharacters:196,afterCharacters:96,reconstructed:true}}}},
    {prompt:{text:"No context record"}}
  ];
  assert.deepEqual(flow.contextStats(groups),{before:150,after:75,saved:75,percent:50,duplicateSaved:0,topicSaved:50,skillSaved:0,
    unattributedSaved:25,covered:2,total:3,reconstructed:1});
});

test("Context totals split topic and duplicate savings when the routing stages are recorded",()=>{
  const groups=[{prompt:{text:"1234",flow:{contextReduction:{beforeCharacters:396,topicAfterCharacters:196,afterCharacters:96}}}}];
  assert.deepEqual(flow.contextStats(groups),{before:100,after:25,saved:75,percent:75,duplicateSaved:25,topicSaved:50,skillSaved:0,
    unattributedSaved:0,covered:1,total:1,reconstructed:0});
});

test("prompt lane keeps executor usage separate from linked Jev usage",()=>{
  const usage=flow.groupUsage({prompt:{usage:{input:36269,cacheRead:223872,output:620}},
    children:[{costKind:"jev",usage:{input:461,output:22,cost:0.000019362,costEstimated:1}}]});
  assert.equal(usage.input,36269);
  assert.equal(usage.cacheRead,223872);
  assert.equal(usage.output,620);
  assert.equal(usage.costMissing,true);
  const lines=flow.usageLines(usage);
  assert.match(lines[0],/260\D141 in \(36\D269 new, 223\D872 cache read\) · 620 out/);
  assert.equal(lines[1],"Cost not reported");
  const jev=flow.groupUsage({prompt:{usage:{input:36269}},children:[{costKind:"jev",usage:{input:461,output:22,cost:0.000019362,costEstimated:1}}]},"jev");
  assert.equal(jev.input,461);assert.equal(jev.output,22);assert.equal(jev.cost,0.000019362);
  assert.equal(flow.usageLines(flow.groupUsage({prompt:{usage:{input:10}}}))[1],"Cost not reported");
});

test("skill search and topic choice have distinct flow titles",()=>{
 const prompt={time:1,details:[{type:"Skill search",routing:{status:"skill",skill:"build-vertex-vsix"}}],events:[{kind:"detail",detail:0,time:2}]};
 const stages=flow.chronologicalStages(prompt,[{operation:"Topic routing with Jev",time:2}]);
 assert.equal(stages.find(stage=>stage.kind==="jev"&&stage.prompt).title,"Choose topic · Jev");
 assert.equal(stages.find(stage=>stage.title==="Skill search").label,"Matched build-vertex-vsix · previous messages excluded");
});

test("step timing separates tool intervals without double-counting overlap",()=>{
  const prompt={time:1000,end:11000,details:[{tool_id:"a"},{tool_id:"b"},{tool_id:"a"},{tool_id:"b"}],
    events:[{kind:"tool",detail:0,time:2000},{kind:"tool",detail:1,time:4000},
      {kind:"tool_result",detail:2,time:6000},{kind:"tool_result",detail:3,time:7000}]};
  assert.deepEqual(flow.timeBreakdown(prompt),{totalMs:10000,toolMs:5000,modelHostMs:5000,incompleteTools:false});
});

test("matched skill excludes every prior prompt and attributes savings to skill",()=>{
  const prompt={text:"Rebuild",flow:{contextReduction:{skill:"build-vertex-vsix",beforeCharacters:400,topicAfterCharacters:400,afterCharacters:0,skillCharacters:40,
    currentPromptCharacters:7,estimatedSavedTokens:100,blocks:[]}}};
  const stages=flow.contextStages(prompt,2);
  assert.equal(stages.length,1);
  assert.match(stages[0].title,/Skill matched · build-vertex-vsix/);
  assert.equal(stages[0].label,"100% of previous conversation excluded");
  const totals=flow.contextStats([{prompt}]);
  assert.equal(totals.skillSaved,100);
  assert.equal(totals.duplicateSaved,0);
  assert.equal(totals.topicSaved,0);
});

test("Context omits a removed repetition from its visible blocks",()=>{
  const prompt={text:"Rebuild",flow:{contextReduction:{beforeCharacters:100,afterCharacters:20,estimatedSavedTokens:20,
    blocks:[{index:0,role:"user",sourcePromptNumber:2,included:false,reason:"duplicate",preferredPromptNumber:4,estimatedTokens:20,preview:"Build again"}]}}};
  const stages=flow.contextStages(prompt,5);
  assert.deepEqual(stages.map(stage=>stage.kind),["prompt","section","included"]);
  assert.doesNotMatch(JSON.stringify(stages),/Build again|Represented by prompt 4/);
});

test("Flow numbers the complete chronology including linked Jev and paired tool results", () => {
  const prompt={key:"chat:0",text:"Fix",time:10,contextSize:{estimatedTokens:120},details:[{type:"tool",name:"Read",tool_id:"x",input:{file_path:"main.js"}},
    {type:"tool result",tool_id:"x",text:"result"},{type:"answer",text:"Done"}],
    events:[{kind:"request",details:[],time:11},{kind:"tool",detail:0,time:12},{kind:"tool_result",detail:1,time:13},{kind:"detail",detail:2,time:15}]};
  const child={operation:"Change verification with Jev",time:14,flow:{jevOutcome:"Passed"}};
  const steps=flow.chronologicalStages({...prompt,flow:flow.summary(prompt)},[child]);
  assert.deepEqual(steps.map(step=>step.stepNumber),[1,2,3,4,5]);
  assert.deepEqual(steps.map(step=>step.title),["User question","LLM request and context","Read · main.js","Change verification with Jev","Response"]);
  assert.match(steps[1].label,/120 context tokens/);
  assert.equal(steps[2].detailIndex,0);
});

test("older routing indices reconstruct context only when saved history matches", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-flow-history-"));
  try {
    const log=require("../session-log").create(root,"test","older",{questions:true,answers:true});
    log.user("First question");log.assistant({model:"m",usage:{},text:"First answer"});
    log.user("Second question");log.routing({status:"routed",beforeMessages:2,keptIndices:[0],topic:{id:"topic_0001",label:"First",scope:"test"}});
    const prompt=logs.readSessions(root).sessions[0].prompts[1],index=flow.summary(prompt);
    assert.equal(index.contextReduction.reconstructed,true);
    const steps=flow.contextStages({...prompt,flow:index},2);
    assert.deepEqual(steps.map(item=>item.kind),["prompt","section","included","included"]);
    assert.match(steps[3].title,/From prompt 1/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
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
  ],timeline:[{kind:"model",usageScope:"cli_turn"}],events:[{kind:"detail",detail:0,time:2},{kind:"tool",detail:1,time:3},
    {kind:"tool",detail:2,time:4},{kind:"tool_result",detail:3,time:5},{kind:"tool",detail:4,time:6},{kind:"tool_result",detail:5,time:7},
    {kind:"detail",detail:6,time:8},{kind:"tool",detail:7,time:9}]};
  const report=logs.listReport({sessions:[{prompts:[prompt]}]}),index=report.sessions[0].prompts[0];
  assert.equal(index.details,undefined);assert.equal(index.timeline,undefined);
  assert.deepEqual(index.flow.checks.map(c=>c.state),["failed","passed"]);
  assert.equal(index.flow.tools,1);assert.equal(index.flow.cliTurns,1);
  assert.doesNotMatch(JSON.stringify(index.flow),/sensitive|secret|large answer/);
  const steps=flow.chronologicalStages(index);
  assert.equal(steps.length,7);
  assert.deepEqual(steps.filter(s=>s.title.startsWith("Verification")).map(s=>s.state),["failed","passed"]);
  assert.equal(steps.at(-1).title,"Review");
});

test("operation groups carry a bounded first-line note preview and portable file names", () => {
  const prompt = { details: [{ type: "tool", name: "Read", input: { file_path: "C:\\src\\main.js", description: "Inspect source" } },
    { type: "tool", name: "Edit", input: { path: "src/view.js" } }], events: [
    { kind: "note", model: { text: "\nInspect the source\nFull explanation" } }, { kind: "tool", detail: 0 },
    { kind: "note", model: { text: "Update the view" } }, { kind: "tool", detail: 1 }] };
  const items = flow.summary(prompt).eventItems;
  assert.deepEqual(items.map(item => item.kind), ["note", "tool", "note", "tool"]);
  assert.deepEqual(items.filter(item => item.kind === "tool").map(item => item.notePreview), ["Inspect the source", "Update the view"]);
  assert.deepEqual(items.filter(item => item.kind === "tool").map(item => item.noteEventIndex), [0, 2]);
  assert.deepEqual(items.filter(item => item.kind === "tool").map(item => item.fileName), ["main.js", "view.js"]);
  const stages = flow.chronologicalStages({ ...prompt, flow: flow.summary(prompt) });
  assert.deepEqual(stages.filter(item => item.kind === "note" || item.kind === "tool").map(item => item.kind), ["note", "tool", "note", "tool"]);
  assert.doesNotMatch(JSON.stringify(items), /Full explanation/);
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
