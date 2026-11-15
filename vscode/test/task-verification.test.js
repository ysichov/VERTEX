"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),checks=require('../task-verification');
const connection={provider:'typesafe-api',model:'jev-latest',key:'test'};
test('recovery is bounded by an actionable decision, completed tools and existing user approval',()=>{
 assert.equal(checks.canRecover({status:'failed'},{tools:[{error:true,result:'old_string is not in file'}]}),true);
 assert.equal(checks.canRecover({status:'unverified',error:'Jev unavailable'},{tools:[]}),false);
 assert.equal(checks.canRecover({status:'failed'},{pending:1,tools:[]}),false);
 assert.equal(checks.canRecover({status:'failed'},{tools:[{error:true,result:'The user declined this action.'}]}),false);
});
function decision(t,choice='passed',confidence=0.95){
 let input,operation,finished,scope;
 t.mock.method(require('../ai-accounting'),'begin',(_v,_p,_m,op,given)=>{operation=op;scope=given;return {callbacks:{},decision:value=>{input=value;},finish:value=>{finished=value;},fail(){}};});
 t.mock.method(require('../jev'),'evaluate',async()=>({model:'jev-latest',answers:{check_0:{type:'choice',choice,confidence}},usage:{input_tokens:11,output_tokens:3}}));
 return ()=>({input,operation,finished,scope});
}
test('global verification uses its own operation, completed evidence and actual decision log',async t=>{
 const capture=decision(t);const evidence={changes:[{file:'index.js',before:'const x=1;',after:'const x=2;'}],tools:[{tool:'Edit',result:{changed:true}}]};
 const result=await checks.verifyTask({},'Build','Done',evidence,{connection,logContext:{mode:'folder',folder:'C:/project'}});
 assert.equal(result.status,'passed');assert.equal(result.usage.input_tokens,11);assert.equal(capture().operation,'Change verification with Jev');assert.deepEqual(capture().input.state.tool_evidence.changes[0].hunks[0].after,['const x=2;']);assert.match(capture().finished.plan.answer,/passed/);
 assert.deepEqual(capture().scope.context,{mode:'folder',folder:'C:/project'});
});

test('pre-review check receives every changed line and excludes unrelated task context and final-answer claims',async t=>{
 const capture=decision(t),body='x'.repeat(800);
 await checks.verifyTask({},'Show dates only for custom range','Build not run',{changes:[{file:'view.js',before:'old',after:body+'\nfrom.hidden = !custom;'}],context:'UNRELATED_HISTORY',hostChecks:{state:'passed'},tools:[]},{connection});
 const state=capture().input.state;assert.equal(state.tool_evidence.changes[0].hunks[0].after[1],'from.hidden = !custom;');assert.doesNotMatch(JSON.stringify(state),/UNRELATED_HISTORY|Build not run/);assert.match(state.stage.completion_checks[0],/Do not assess completion of the whole task/);
});
test('uncertain or unavailable verification stays unverified',async t=>{
 decision(t,'passed',0.5);assert.equal((await checks.verifyTask({},'Build','Done',{}, {connection})).status,'unverified');
 t.mock.method(require('../review-jev'),'connection',async()=>null);
 const result=await checks.verifyTask({},'Build','Done',{});assert.equal(result.status,'unverified');assert.match(checks.format(result),/Configure an enabled Jev/);
});
test('Jev cannot override failed host checks and cancellation does not become a verdict',async t=>{
 decision(t);assert.equal((await checks.verifyTask({},'Fix','Done',{hostChecks:{state:'failed'}},{connection})).status,'failed');
 const pending=await checks.verifyTask({},'Build','Done',{pending:1},{connection});assert.equal(pending.status,'unverified');assert.equal(pending.host_override,true);
 const controller=new AbortController();controller.abort();await assert.rejects(checks.verifyTask({},'Build','Done',{}, {connection,signal:controller.signal}),/stopped|cancel/i);
});
test('evidence preserves exit status and persistent log paths without forwarding full command output',()=>{
 const evidence=checks.createEvidence();evidence.step({kind:'use',id:'x',name:'Bash',input:{command:'build'}});
 assert.equal(evidence.snapshot().pending,1);
 evidence.step({kind:'result',id:'x',name:'Bash',content:JSON.stringify({code:7,output_file:'C:/logs/output.log',stdout:'x'.repeat(100000),stderr:'failed'})});
 const saved=evidence.snapshot();assert.equal(saved.pending,0);assert.equal(saved.tools[0].result.code,7);assert.equal(saved.tools[0].result.output_file,'C:/logs/output.log');assert.ok(JSON.stringify(saved).length<2500);
});
