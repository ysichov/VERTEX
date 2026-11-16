"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),dedup=require("../context-dedup");
const topic={id:"topic_0001",label:"Build",scope:"folder"};
const other={id:"topic_0002",label:"Other",scope:"folder"};
const exchange=(question,answer,chosen=topic,iterations)=>[{role:"user",content:question,topic:chosen},
  {role:"assistant",content:answer,topic:chosen,...(iterations===undefined?{}:{execution:{iterations}})}];
const yes={type:"noul",noul:.95,confidence:.95},no={type:"noul",noul:.05,confidence:.95};

test("one Jev comparison keeps the best representative and distinct requirements",async t=>{
  const history=[...exchange("Build VSIX","Build completed without artifact"),...exchange("Keep the version unchanged","Version remains 0.9.99"),...exchange("Rebuild VSIX","Verified VSIX at output/vertex.vsix")];
  let calls=0;
  t.mock.method(require("../review-jev"),"connection",async()=>({provider:"typesafe-api",model:"jev-test",key:"test"}));
  t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},decision(){},finish(){},fail(){}}));
  t.mock.method(require("../jev"),"evaluate",async(_p,_k,_m,state,questions)=>{calls++;assert.equal(state.exchanges.length,3);assert.equal(Object.keys(questions).length,6);
    return {model:"jev-test",usage:{input_tokens:10},answers:{success_1:no,success_2:no,success_3:yes,duplicate_1:yes,duplicate_2:no,duplicate_3:no}};});
  const result=await dedup.select({},"Continue",history,topic.id);
  assert.equal(calls,1);assert.deepEqual(result.keptIndices,[2,3,4,5]);assert.equal(result.report.dropped[0].representativeStart,4);
});

test("uncertain, cyclic and different-topic exchanges remain intact",()=>{
  const history=[...exchange("First","A"),...exchange("Again","B"),...exchange("Other topic","C",other)];
  const prepared=dedup.request(history,topic.id);
  assert.deepEqual(prepared.candidates.map(item=>item.id),[1,2]);
  const valid={success_2:yes};
  assert.deepEqual(dedup.apply(history,prepared,{...valid,duplicate_1:{type:"noul",noul:.6}}).history,history);
  assert.deepEqual(dedup.apply(history,prepared,{...valid,duplicate_1:no}).history,history);
  assert.equal(dedup.request(exchange("Only","A"),topic.id),null);
});

test("Jev audit treats repeated successful builds as superseded attempts",()=>{
  const prepared=dedup.request([...exchange("Build VSIX","Verified VSIX: first"),...exchange("Build again","Verified VSIX: second")],topic.id);
  assert.match(prepared.state.policy,/failed attempt at the same task is an inferior candidate/i);
  assert.match(prepared.questions.duplicate_1.instructions,/Differences in build logs, timestamps, and transient errors/);
});

test("a failed duplicate can be replaced by a later verified success",()=>{
  const history=[...exchange("Build VSIX","Build failed: missing binding"),...exchange("Build VSIX again","Verified VSIX: vertex-abap-0.9.99.vsix")];
  const prepared=dedup.request(history,topic.id);
  const result=dedup.apply(history,prepared,{success_1:no,success_2:yes,duplicate_1:yes});
  assert.deepEqual(result.keptIndices,[2,3]);
  assert.equal(result.dropped[0].representative,2);
});

test("an unverified latest answer cannot erase earlier attempts",()=>{
  const history=[...exchange("Build VSIX","Verified VSIX: first"),...exchange("Build again","I will try")];
  const prepared=dedup.request(history,topic.id);
  const result=dedup.apply(history,prepared,{success_1:no,success_2:no,duplicate_1:yes});
  assert.deepEqual(result.keptIndices,[0,1,2,3]);
});

test("Jev may choose an earlier verified result with fewer iterations",()=>{
  const history=[...exchange("Build","Failed"),...exchange("Build again","Verified in one attempt",topic,1),...exchange("Build again","Verified after three retries",topic,3)];
  const prepared=dedup.request(history,topic.id);
  const result=dedup.apply(history,prepared,{success_1:no,success_2:yes,success_3:yes,duplicate_1:yes,duplicate_3:yes});
  assert.deepEqual(result.keptIndices,[2,3]);
  assert.deepEqual(result.dropped.map(item=>item.exchange),[1,3]);
});

test("legacy untagged and unanswered repeats are eligible but distinct topics are not",()=>{
  const untagged={id:"",label:"",scope:""};
  const history=[...exchange("Build VSIX","",untagged),...exchange("Other task","Done",other),...exchange("Build VSIX again","Verified VSIX",topic)];
  const prepared=dedup.request(history,topic.id);
  assert.deepEqual(prepared.candidates.map(item=>item.id),[1,3]);
  const result=dedup.apply(history,prepared,{success_3:yes,duplicate_1:yes});
  assert.deepEqual(result.keptIndices,[2,3,4,5]);
});

test("Jev binary probability works without a separate confidence field",()=>{
  const history=[...exchange("Build","Failed"),...exchange("Build again","Verified VSIX")];
  const prepared=dedup.request(history,topic.id);
  const result=dedup.apply(history,prepared,{success_2:{type:"noul",noul:.93},duplicate_1:{type:"noul",noul:.96}});
  assert.equal(result.representative,2);
  assert.deepEqual(result.dropped.map(item=>item.exchange),[1]);
});

test("a resolved failed attempt needs less duplicate certainty than a distinct requirement",()=>{
  const history=[...exchange("Build VSIX","Failed: old version"),...exchange("Change version","Version bumped"),
    ...exchange("Build again","Verified VSIX at new version")];
  const prepared=dedup.request(history,topic.id);
  const result=dedup.apply(history,prepared,{success_1:{type:"noul",noul:.14},success_2:no,success_3:{type:"noul",noul:.93},
    duplicate_1:{type:"noul",noul:.67},duplicate_2:{type:"noul",noul:.33}});
  assert.deepEqual(result.keptIndices,[2,3,4,5]);
});
