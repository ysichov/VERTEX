"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),checks=require('../task-verification');
test('successful local reads disprove a claimed connection error',()=>{
 const evidence={tools:[{tool:'Read',arguments:{file_path:'vscode/log-flow.js'},result:{text:'source'}}],omitted_tools:0,pending:0};
 assert.equal(checks.falseLocalConnectionClaim('Чтение завершилось ошибкой соединения с локальным инструментом VERTEX.',evidence),true);
 assert.equal(checks.falseLocalConnectionClaim('Чтение завершилось ошибкой соединения с локальным инструментом VERTEX.',{...evidence,tools:[{...evidence.tools[0],error:true}]}),false);
 assert.equal(checks.falseLocalConnectionClaim('Для локальных серверов прокси отключается. Ошибки соединения и некорректный JSON превращаются в сообщение о недоступном сервере.',evidence),false);
 assert.equal(checks.falseLocalConnectionClaim('For local servers the proxy is disabled. Connection errors become a message.',evidence),false);
 assert.equal(checks.falseLocalConnectionClaim('The local file tool failed with a connection error.',evidence),true);
});
const connection={provider:'typesafe-api',model:'jev-latest',key:'test'};
test('recovery is bounded by an actionable decision, completed tools and existing user approval',()=>{
 assert.equal(checks.canRecover({status:'failed'},{tools:[{error:true,result:'old_string is not in file'}]}),true);
 assert.equal(checks.canRecover({status:'unverified',error:'Jev unavailable'},{tools:[]}),false);
 assert.equal(checks.canRecover({status:'failed'},{pending:1,tools:[]}),false);
 assert.equal(checks.canRecover({status:'failed'},{tools:[{error:true,result:'The user declined this action.'}]}),false);
 assert.equal(checks.canRecover({status:'unverified',checks:[{status:'unverified',probabilities:{passed:0.6,failed:0.05}}]},
   {tools:[{tool:'Edit',result:{changed:true}}]},{state:'passed'}),false);
 assert.equal(checks.canRecover({status:'unverified'}, {tools:[
   {tool:'Edit',error:true,arguments:{file_path:'C:/project/view.html'},result:'old_string is not in file'},
   {tool:'Edit',arguments:{file_path:'C:/project/view.html'},result:{changed:true}},
   {tool:'Verification',result:'PASSED'}]},{state:'passed'}),false);
 assert.equal(checks.canRecover({status:'unverified'},
   {tools:[{tool:'Edit',error:true,arguments:{file_path:'C:/project/view.html'},result:'old_string is not in file'}]},{state:'passed'}),true);
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
 assert.deepEqual(capture().input.state.tool_evidence.changes[0].source,{kind:'after',text:'const x=2;'});
 assert.deepEqual(capture().scope.context,{mode:'folder',folder:'C:/project'});
});
test('large unchanged source is narrowed to changed lines and nearby context',async t=>{
 const capture=decision(t),context='/* context */\n'.repeat(15000);
 await checks.verifyTask({},'Change the colour','Done',{changes:[{file:'view.css',before:context+'color: gray;',after:context+'color: blue;'}]},{connection});
 const change=capture().input.state.tool_evidence.changes[0];
 assert.equal(change.source.kind,'excerpt');assert.equal(change.source.totalCharacters,(context+'color: blue;').length);
 assert.match(change.source.text,/color: blue;/);assert.ok(change.source.text.length<12000);
 assert.deepEqual(change.hunks[0].after,['color: blue;']);
});

test('pre-review check receives every changed line and excludes unrelated task context and final-answer claims',async t=>{
 const capture=decision(t),body='x'.repeat(800);
 await checks.verifyTask({},'Show dates only for custom range','Build not run',{changes:[{file:'view.js',before:'old',after:body+'\nfrom.hidden = !custom;'}],context:'UNRELATED_HISTORY',hostChecks:{state:'passed'},tools:[]},{connection});
 const state=capture().input.state;assert.equal(state.tool_evidence.changes[0].hunks[0].after[1],'from.hidden = !custom;');assert.doesNotMatch(JSON.stringify(state),/UNRELATED_HISTORY|Build not run/);assert.match(state.stage.completion_checks[0],/Do not assess completion of the whole task/);
});
test('Jev sees recorded test commands but not unrelated shell diagnostics',async t=>{
 const capture=decision(t);
 await checks.verifyTask({},'Fix deletion totals','Done',{changes:[{file:'review.js',before:'old',after:'new'}],tools:[
   {tool:'Edit',result:{changed:true}},
   {tool:'Bash',arguments:{command:'node --test vscode/test/review-live.test.js'},result:{code:0,stdout:'25 passed'}},
   {tool:'Bash',arguments:{command:'git status --short'},result:{code:0,stdout:'M review.js'}}
 ]},{connection});
 const proof=capture().input.state.tool_evidence;
 assert.equal(proof.tools.length,2);
 assert.equal(proof.tools[1].result.stdout,'25 passed');
 assert.match(capture().input.state.stage.completion_checks[0],/no built-in checker/);
});
test('decision input keeps code context but omits unchanged supporting test and documentation source',async t=>{
 const capture=decision(t);
 await checks.verifyTask({},'Fix count','Done',{changes:[
   {file:'src/count.js',before:'return 0;',after:'return total;'},
   {file:'test/count.test.js',before:'old test',after:'new test'},
   {file:'history.md',before:'old note',after:'new note'}
 ]},{connection});
 const changes=capture().input.state.tool_evidence.changes;
 assert.equal(changes[0].source.text,'return total;');
 assert.equal(changes[1].source.kind,'omitted');assert.equal(changes[2].source.kind,'omitted');
 assert.ok(changes[1].hunks.length&&changes[2].hunks.length);
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
test('change verification never sends Markdown and skips a Markdown-only change',async t=>{
 const inputs=[];
 t.mock.method(require('../ai-accounting'),'begin',()=>({callbacks:{},decision(){},finish(){},fail(){}}));
 t.mock.method(require('../jev'),'evaluate',async(_provider,_key,_model,state)=>{
  inputs.push(state);return {model:'jev-test',usage:{},answers:{implementation:{noul:0.9},syntax:{noul:0.1}}};
 });
 const markdown={file:'docs/README.MD',before:'old',after:'SECRET DOCUMENT'};
 const code={file:'src/app.js',before:'old',after:'const x = 1;'};
 const mixed=await checks.verifyTask({},'Fix code','Done',{changes:[markdown,code]},{connection});
 assert.equal(mixed.status,'passed');assert.equal(inputs.length,1);assert.match(inputs[0],/src\/app\.js/);assert.doesNotMatch(inputs[0],/SECRET DOCUMENT|README\.MD/);
 const only=await checks.verifyTask({},'Edit docs','Done',{changes:[markdown]},{connection});
 assert.equal(only.status,'unverified');assert.equal(inputs.length,1);
});

test('evidence preserves exit status and persistent log paths without forwarding full command output',()=>{
 const evidence=checks.createEvidence();evidence.step({kind:'use',id:'x',name:'Bash',input:{command:'build'}});
 assert.equal(evidence.snapshot().pending,1);
 evidence.step({kind:'result',id:'x',name:'Bash',content:JSON.stringify({code:7,output_file:'C:/logs/output.log',stdout:'x'.repeat(100000),stderr:'failed'})});
 const saved=evidence.snapshot();assert.equal(saved.pending,0);assert.equal(saved.tools[0].result.code,7);assert.equal(saved.tools[0].result.output_file,'C:/logs/output.log');assert.ok(JSON.stringify(saved).length<2500);
});
