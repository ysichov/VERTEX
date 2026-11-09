"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{create,parseVerdict}=require('../orchestrator-supervisor');
test('Successful tools and answers never call the supervisor model',async()=>{
 const control=create({revise:()=>assert.fail('unnecessary replan'),review:()=>assert.fail('unnecessary review')});
 assert.equal(await control.run('read',{id:'a'},async()=>42),42);assert.equal(await control.beforeAnswer({answer:'42'}),null);
});
test('An identical failed call is blocked before execution and gets recovery advice',async()=>{
 let actions=0,plans=0;const control=create({revise:async evidence=>{plans++;assert.match(evidence.history.at(-1).error,/blocked/);return 'Discover the schema first';},review:async()=>({accept:true,feedback:''})});
 const run=()=>control.run('read',{query:'bad'},async()=>{actions++;throw new Error('bad field');});
 await assert.rejects(run(),/bad field/);await assert.rejects(run(),/Discover the schema/);assert.equal(actions,1);assert.equal(plans,1);
 assert.equal(await control.beforeAnswer({answer:'limited result'}),null);
});
test('The same error under changed arguments triggers one correction and revised answer review',async()=>{
 let plans=0;const control=create({revise:async()=>{plans++;return 'Read schema';},review:async()=>({accept:false,feedback:'Use the available read tool'})});
 const run=id=>control.run('read',{id},async()=>{throw new Error('invalid syntax\nSQL differs by argument');});
 await assert.rejects(run('a'));await assert.rejects(run('b'),/Read schema/);assert.equal(plans,1);
 assert.match(await control.beforeAnswer({answer:'ask the user to read'}),/available read tool/);
});
test('Recovery is bounded and fatal errors stop further tool execution',async()=>{
 let executions=0;const control=create({revise:async()=> 'Change approach',review:async()=>({accept:true,feedback:''}),maxRecoveries:1});
 const run=()=>control.run('change',{id:'a'},async()=>{executions++;throw new Error('failed');});
 await assert.rejects(run());await assert.rejects(run(),/Change approach/);await assert.rejects(run(),error=>error.orchestratorFatal===true);
 await assert.rejects(control.run('another',{},async()=>{executions++;}),error=>error.orchestratorFatal===true);assert.equal(executions,1);
});
test('Stopping while recovery waits prevents more actions',async()=>{
 let active=true,release;const control=create({isActive:()=>active,revise:()=>new Promise(resolve=>release=resolve),review:async()=>({accept:true,feedback:''})});
 await assert.rejects(control.run('read',{},async()=>{throw new Error('bad');}));const wait=control.run('read',{},async()=>assert.fail('duplicate executed'));
 active=false;release('advice');await assert.rejects(wait,error=>error.orchestratorFatal===true);
});
test('Review verdicts must be explicit and well-formed',()=>{
 assert.deepEqual(parseVerdict('{"accept":true,"feedback":""}'),{accept:true,feedback:''});assert.throws(()=>parseVerdict('{"accept":false,"feedback":""}'));assert.throws(()=>parseVerdict('unstructured'));
});
