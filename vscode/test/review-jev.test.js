"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const service=require("../review-jev"),profiles=require("../key-profiles");
const context=()=>({object:"ZCL_TEST",blocks:[{block:1,unit:"METHOD test",line:5,before:["total = amount."],after:["total = total + amount."],context_before:["LOOP AT items INTO item."],context_after:["ENDLOOP."]}]});
async function setup(){
 const values={modelConfig:{"typesafe-api":{enabled:["jev-latest"],known:["jev-latest"]}}},data=new Map();
 const secrets={get:async k=>data.get(k),store:async(k,v)=>{data.set(k,v);}};
 const vscode={workspace:{getConfiguration:()=>({get:(k,f)=>values[k]??f}),onDidChangeConfiguration:()=>({dispose(){}})}};
 service.configure(secrets);await profiles.save(secrets,"typesafe-api","TEST","synthetic-key");
 return {values,data,secrets,vscode};
}
function result(){return {model:"jev-1.14.0",elapsedMs:120,usage:{input_tokens:100},answers:Object.fromEntries(Object.entries(service.questions).map(([id,q])=>[id,{type:"choice",choice:Object.keys(q.criteria)[0],probabilities:{[Object.keys(q.criteria)[0]]:0.9}}]))};}
test("ASK Jev requires a saved active key and an enabled provider/model without a prior paid check",async()=>{
 const env=await setup();assert.equal((await service.connection(env.vscode)).model,"jev-latest");
 await service.rememberSuccess("synthetic-key","jev-latest");assert.equal((await service.connection(env.vscode)).model,"jev-latest");
 await profiles.save(env.secrets,"typesafe-api","OTHER","different-key");assert.equal((await service.connection(env.vscode)).model,"jev-latest");
 await profiles.select(env.secrets,"typesafe-api","TEST");env.values.modelConfig["typesafe-api"].enabled=[];assert.equal(await service.connection(env.vscode),null);
 env.values.modelConfig["typesafe-api"].enabled=["jev-latest"];env.values.modelConfig["typesafe-api"].off=true;assert.equal(await service.connection(env.vscode),null);
 env.values.modelConfig["typesafe-api"].off=false;env.data.clear();assert.equal(await service.connection(env.vscode),null);
});
test("ASK Jev sends exactly four questions and only the selected diff context without applying decisions",async t=>{
 const env=await setup();await service.rememberSuccess("synthetic-key","jev-latest");let calls=0;
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},finish(){},fail(){}}));
 t.mock.method(require("../jev"),"evaluate",async(provider,key,model,state,questions)=>{
  calls++;assert.equal(provider,"typesafe-api");assert.equal(key,"synthetic-key");assert.equal(Object.keys(questions).length,4);
  assert.deepEqual(state.block.before,context().blocks[0].before);assert.equal(state.otherFiles,undefined);assert.equal(state.block.hiddenSource,undefined);return result();
 });
 const input=context();input.otherFiles="not selected";input.blocks[0].hiddenSource="must not send";
 const answer=await service.assess(env.vscode,input);assert.equal(calls,1);assert.equal(answer.rows.length,4);assert.match(answer.rows[3].answer,/reviewer still decides/);
 await assert.rejects(service.assess(env.vscode,{blocks:[...context().blocks,...context().blocks]}),/one current diff block/);
});
test("ASK Jev prevents duplicate block requests, rejects stale results and cancels on disposal",async t=>{
 const env=await setup();await service.rememberSuccess("synthetic-key","jev-latest");
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},finish(){},fail(){}}));
 let receive,dispose,finish,started;const ready=new Promise(r=>{started=r;}),posts=[];let current=context();
 const panel={webview:{postMessage:async message=>posts.push(message),onDidReceiveMessage:fn=>{receive=fn;return {dispose(){}};}},onDidDispose:fn=>{dispose=fn;}};
 t.mock.method(require("../jev"),"evaluate",async()=>{started();return new Promise(r=>{finish=r;});});
 service.bind(env.vscode,panel,()=>current);await receive({action:"jevReady"});assert.equal(posts[0].jevAvailability,true);
 const job=receive({action:"askJev",id:"one",file:"file",hunk:0});await ready;
 await receive({action:"askJev",id:"two",file:"file",hunk:0});assert.match(posts.find(p=>p.jevReview?.id==="two").jevReview.error,/already/);
 current={...current,object:"Changed"};finish(result());await job;assert.ok(posts.some(p=>/diff changed/.test(p.jevReview?.error||"")));assert.ok(!posts.some(p=>p.jevReview?.result));
 let signal;const ready2=new Promise(r=>{started=r;});t.mock.method(require("../jev"),"evaluate",async(...args)=>{signal=args[5].signal;started();return new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("aborted")),{once:true}));});
 const job2=receive({action:"askJev",id:"three",file:"file",hunk:0});await ready2;dispose();assert.equal(signal.aborted,true);await job2;
});

test('the selected Gemini decision provider reuses its own key independently of the chat provider',async()=>{
 const env=await setup();env.values.decisionModel={provider:'gemini-api',model:'gemini-decision-1'};await profiles.save(env.secrets,'gemini-api','GEMINI','gemini-fixture');
 const c=await service.connection(env.vscode);assert.equal(c.provider,'gemini-api');assert.equal(c.model,'gemini-decision-1');assert.equal(c.key,'gemini-fixture');
 env.values.modelConfig['typesafe-api'].off=true;assert.equal((await service.connection(env.vscode)).provider,'gemini-api');
 env.values.modelConfig['gemini-api']={off:true};assert.equal(await service.connection(env.vscode),null);
 env.values.decisionModel={provider:'typesafe-api',model:'jev-latest'};assert.equal(await service.connection(env.vscode),null);
});
