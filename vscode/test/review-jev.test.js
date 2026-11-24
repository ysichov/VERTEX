"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const service=require("../review-jev"),profiles=require("../key-profiles");
const context=()=>({object:"ZCL_TEST",blocks:[{block:1,unit:"METHOD test",line:5,before:["total = amount."],after:["total = total + amount."],context_before:["LOOP AT items INTO item."],context_after:["ENDLOOP."]}]});
async function setup(){
 const values={modelConfig:{"typesafe-api":{enabled:["jev-latest"],known:["jev-latest"]}}},data=new Map();let configurationListener;
 const secrets={get:async k=>data.get(k),store:async(k,v)=>{data.set(k,v);}};
 const vscode={workspace:{getConfiguration:()=>({get:(k,f)=>values[k]??f}),onDidChangeConfiguration:listener=>{configurationListener=listener;return {dispose(){}};}}};
 service.configure(secrets);await profiles.save(secrets,"typesafe-api","TEST","synthetic-key");
 return {values,data,secrets,vscode,changeConfiguration:event=>configurationListener?.(event)};
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
test("ASK Jev asks for context and auto-approval probability with only the selected diff",async t=>{
 const env=await setup();await service.rememberSuccess("synthetic-key","jev-latest");let calls=0;
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},finish(){},fail(){}}));
 t.mock.method(require("../jev"),"evaluate",async(provider,key,model,state,questions)=>{
  calls++;assert.equal(provider,"typesafe-api");assert.equal(key,"synthetic-key");assert.equal(Object.keys(questions).length,3);
  assert.deepEqual(state.block.before,context().blocks[0].before);assert.equal(state.otherFiles,undefined);assert.equal(state.block.hiddenSource,undefined);return result();
 });
 const input=context();input.otherFiles="not selected";input.blocks[0].hiddenSource="must not send";
 const answer=await service.assess(env.vscode,input);assert.equal(calls,1);assert.equal(answer.rows.length,3);assert.equal(answer.rows[1].label,"Задача выполнена?");assert.equal(answer.rows[1].answer,"Да");assert.equal(answer.rows[2].label,"Auto-approve likelihood");assert.equal(answer.rows[2].answer,"90%");assert.equal(answer.rows[2].likelihood,0.9);
 await assert.rejects(service.assess(env.vscode,{blocks:[...context().blocks,...context().blocks]}),/one current diff block/);
});
test("review-level Jev receives the topic's user requests and all changed blocks",async t=>{
 const env=await setup();let seen;
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},decision(){},finish(){},fail(){}}));
 t.mock.method(require("../jev"),"evaluate",async(_provider,_key,_model,state,questions)=>{
  seen={state,questions};return {model:"jev-test",elapsedMs:1,usage:{},answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,{choice:Object.keys(q.criteria)[0],probabilities:{[Object.keys(q.criteria)[0]]:0.9}}]))};
 });
 const input={...context(),scope:"review",task:"1. Show percent progress for 20000 entries\n2. Improve the existing program",blocks:[context().blocks[0],{...context().blocks[0],block:2,after:["progress = percent."]}]};
 const answer=await service.assess(env.vscode,input);
 assert.equal(seen.state.scope,"review");assert.equal(seen.state.blocks.length,2);
 assert.equal(seen.state.task,input.task);assert.deepEqual(Object.keys(seen.questions),["context","completed","autoapprove"]);
 assert.match(seen.questions.completed.instructions,/latest actionable request/);
 assert.match(seen.questions.completed.instructions,/do not require already implemented work to reappear/);
 assert.equal(answer.rows[1].label,"Задача выполнена?");assert.equal(answer.scope,"review");
});
test("whole-review Jev assesses files separately and expands insufficient context",async t=>{
 const env=await setup();const calls=[];
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},decision(){},finish(){},fail(){}}));
 t.mock.method(require("../jev"),"evaluate",async(_provider,_key,_model,state,questions)=>{
  calls.push(state);const insufficient=state.object==="a.js"&&!state.primary_file;
  return {model:"jev-test",elapsedMs:1,usage:{},answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,{choice:id==="context"&&insufficient?"insufficient":Object.keys(q.criteria)[0],probabilities:id==="autoapprove"?{yes:state.object==="b.js"?0.7:0.8,no:state.object==="b.js"?0.3:0.2}:{[Object.keys(q.criteria)[0]]:0.9}}]))};
 });
 const block=context().blocks[0];const input={...context(),scope:"review",task:"Improve both files",blocks:[{...block,file:"a.js"},{...block,file:"b.js"}]};
 const answer=await service.assess(env.vscode,input);
 assert.equal(calls.length,3);assert.deepEqual(calls.map(call=>call.blocks.map(block=>block.file)),[["a.js"],["a.js","b.js"],["b.js"]]);
 assert.equal(answer.files,2);assert.equal(answer.expanded,1);assert.equal(answer.rows.at(-1).answer,"70%");
});
test("whole-review completion reflects partial and failed files",async t=>{
 const env=await setup();
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},decision(){},finish(){},fail(){}}));
 let second="partial";
 t.mock.method(require("../jev"),"evaluate",async(_provider,_key,_model,state,questions)=>({model:"jev-test",elapsedMs:1,usage:{},answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,{choice:id==="completed"&&state.object==="b.js"?second:Object.keys(q.criteria)[0],probabilities:{yes:0.8,no:0.2}}]))}));
 const block=context().blocks[0],input={...context(),scope:"review",task:"Change both files",blocks:[{...block,file:"a.js"},{...block,file:"b.js"}]};
 let answer=await service.assess(env.vscode,input);
 assert.equal(answer.rows.find(row=>row.label==="Задача выполнена?").answer,"Частично");
 second="no";answer=await service.assess(env.vscode,input);
 assert.equal(answer.rows.find(row=>row.label==="Задача выполнена?").answer,"Нет");
});
test("whole-review Jev accepts a diff above the former 90000-character limit",async t=>{
 const env=await setup();let calls=0;
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},decision(){},finish(){},fail(){}}));
 t.mock.method(require("../jev"),"evaluate",async(_provider,_key,_model,_state,questions)=>{
  calls++;return {model:"jev-test",elapsedMs:1,usage:{},answers:Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,{choice:Object.keys(q.criteria)[0],probabilities:id==="autoapprove"?{yes:0.8,no:0.2}:{[Object.keys(q.criteria)[0]]:0.9}}]))};
 });
 const block=context().blocks[0],blocks=Array.from({length:28},(_,index)=>({...block,file:`src/file${index}.js`,after:["x".repeat(4000)]}));
 assert.ok(JSON.stringify(blocks).length>90000);
 const answer=await service.assess(env.vscode,{...context(),scope:"review",blocks});
 assert.equal(calls,28);assert.equal(answer.files,28);assert.equal(answer.rows.at(-1).answer,"80%");
});
test("ASK Jev availability resynchronizes when the decision model changes",async()=>{
 const env=await setup();let dispose;const posts=[];
 const panel={webview:{postMessage:async message=>posts.push(message),onDidReceiveMessage:()=>({dispose(){}})},onDidDispose:listener=>{dispose=listener;}};
 service.bind(env.vscode,panel,()=>context());
 const changes=[];env.values.decisionModel={provider:"gemini-api",model:"gemini-decision-1"};
 env.changeConfiguration({affectsConfiguration:key=>{changes.push(key);return key==="vertex.ai.decisionModel";}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(changes,["vertex.ai.modelConfig","vertex.ai.decisionModel"]);
 assert.deepEqual(posts,[{jevAvailability:false}]);
 env.values.decisionModel={provider:"typesafe-api",model:"jev-latest"};
 env.changeConfiguration({affectsConfiguration:key=>key==="vertex.ai.decisionModel"});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(posts,[{jevAvailability:false},{jevAvailability:true}]);
 dispose();
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
