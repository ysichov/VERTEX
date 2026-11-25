"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),dedup=require("../context-dedup");
const topic={id:"topic_0001",label:"Build",scope:"folder"};
const other={id:"topic_0002",label:"Other",scope:"folder"};
const exchange=(question,answer,chosen=topic)=>[{role:"user",content:question,topic:chosen},{role:"assistant",content:answer,topic:chosen}];
const yes={type:"noul",noul:.95},no={type:"noul",noul:.05};

test("one Jev call evaluates each prompt and answer against the full current request",async t=>{
  const history=[...exchange("Old task","Finished"),...exchange("Keep the version unchanged","Version remains 0.9.99")];
  const current="Continue: "+"x".repeat(450); let calls=0,auditReport;
  t.mock.method(require("../review-jev"),"connection",async()=>({provider:"typesafe-api",model:"jev-test",key:"test"}));
  t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},decision(){},finish(){},fail(){},contextOptimization(report){auditReport=report;}}));
  t.mock.method(require("../jev"),"evaluate",async(_p,_k,_m,state,questions)=>{
    calls++;assert.equal(state.currentQuestion,current);assert.equal(state.exchanges,undefined);
    assert.deepEqual(Object.keys(questions),["relevant_1","relevant_2"]);
    assert.deepEqual(JSON.parse(questions.relevant_1.instructions),{question:"Old task",answer:"Finished"});
    return {model:"jev-test",usage:{input_tokens:10},answers:{relevant_1:no,relevant_2:yes}};
  });
  const result=await dedup.select({},current,history,topic.id);
  assert.equal(calls,1);assert.deepEqual(result.keptIndices,[2,3]);
  assert.deepEqual(result.report.dropped,[{exchange:1,start:0,end:2}]);
  assert.equal(result.report.status,"filtered");assert.deepEqual(auditReport,result.report);
  assert.equal(history.length,4);
});

test("uncertain, missing and invalid decisions keep the exchange",()=>{
  const history=exchange("Question","Answer"),prepared=dedup.request(history,topic.id,"Current");
  for(const answer of [undefined,{type:"noul",noul:.21},{type:"noul",noul:-1},{type:"noul",noul:NaN},{type:"noul",noul:"0"},{type:"choice",choice:"skip"}])
    assert.deepEqual(dedup.apply(history,prepared,{relevant_1:answer}).history,history);
  assert.equal(dedup.apply(history,prepared,{relevant_1:{type:"noul",noul:.2}}).history.length,0);
});

test("other topics, long or incomplete exchanges and unseen tool results are protected",()=>{
  const source=exchange("Source","Found");source[1].tool_history=[{tool:"Read",result:{text:"code"}}];
  const omitted=exchange("Old command","Done");omitted[1].tool_history=[{tool:"Bash",omitted:"Non-source historical tool details omitted"}];
  const image=exchange("Screenshot","See image");image[0].images=[{file:"image.png"}];
  const untagged={id:"",label:"",scope:""};
  const history=[...exchange("Other","Done",other),...exchange("x".repeat(1601),"Done"),...exchange("Incomplete",""),...source,...image,...omitted,...exchange("Legacy","Done",untagged)];
  const prepared=dedup.request(history,topic.id,"Current");
  assert.deepEqual(prepared.candidates.map(x=>x.id),[6,7]);
  assert.deepEqual(dedup.apply(history,prepared,{relevant_6:no,relevant_7:no}).keptIndices,[0,1,2,3,4,5,6,7,8,9]);
});

test("empty, oversized or unavailable decision input fails closed",()=>{
  assert.equal(dedup.request(exchange("Q","A"),topic.id,""),null);
  assert.equal(dedup.request(exchange("Q","A"),topic.id,"x".repeat(180001)),null);
  assert.equal(dedup.request(Array.from({length:49},()=>exchange("Q","A")).flat(),topic.id,"Current"),null);
});

test("provider failure retains the selected history",async t=>{
  const history=exchange("Q","A");
  t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},decision(){},finish(){},fail(){},contextOptimization(){}}));
  t.mock.method(require("../jev"),"evaluate",async()=>{throw Error("unavailable");});
  const result=await dedup.select({},"Current",history,topic.id,{connection:{provider:"typesafe-api",model:"test",key:"test"}});
  assert.deepEqual(result.history,history);assert.equal(result.report.status,"fallback");
});
