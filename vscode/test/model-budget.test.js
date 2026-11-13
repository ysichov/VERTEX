"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),budgets=require('../model-budget');
function host(modelConfig){return {workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='modelConfig'?modelConfig:fallback})}};}
test('A budget belongs to one model of one provider, and anything but a positive number means none',()=>{
 const vscode=host({'gemini-api':{limits:{'models/gemini-decision-1':50000,'models/gemini-3.6-flash':0}},
  'anthropic-api':{limits:{'claude-haiku-4-5':400000}},'openrouter-api':{}});
 assert.equal(budgets.budget(vscode,'gemini-api','models/gemini-decision-1'),50000);
 assert.equal(budgets.budget(vscode,'anthropic-api','claude-haiku-4-5'),400000);
 assert.equal(budgets.budget(vscode,'gemini-api','models/gemini-3.6-flash'),0,'0 means no budget');
 assert.equal(budgets.budget(vscode,'gemini-api','models/not-listed'),0);
 assert.equal(budgets.budget(vscode,'openrouter-api','anything'),0);
 assert.equal(budgets.budget(vscode,'gemini-api','claude-haiku-4-5'),0,'budgets do not leak between providers');
 assert.equal(budgets.budget({},'gemini-api','x'),0,'a host without settings paces nothing');
});
test('Each model has its own minute: one model spending does not delay another',()=>{
 budgets.forget();
 const now=Date.now();
 budgets.record('gemini-api','models/gemini-decision-1',26098,now);
 assert.ok(budgets.waitFor('gemini-api','models/gemini-decision-1',26098,50000,now+1000)>0);
 assert.equal(budgets.waitFor('gemini-api','models/gemini-3.6-flash',26098,50000,now+1000),0,'a different model of the same provider is untouched');
 assert.equal(budgets.waitFor('typesafe-api','jev-latest',26098,50000,now+1000),0,'and so is another provider');
});
test('The wait is only as long as it takes the oldest spend to leave the minute',()=>{
 budgets.forget();
 const now=Date.now();
 assert.equal(budgets.waitFor('g','m',26098,50000,now),0,'the first request never waits');
 budgets.record('g','m',26098,now);
 assert.equal(budgets.waitFor('g','m',26098,50000,now+1000),59000);
 assert.equal(budgets.waitFor('g','m',26098,50000,now+60000),0,'after the minute it goes at once');
 assert.equal(budgets.waitFor('g','m',10000,50000,now+1000),0,'a smaller request still fits beside it');
});
test('A request larger than the whole budget is not held back for ever',()=>{
 budgets.forget();
 assert.equal(budgets.waitFor('g','m',80000,50000),0,'waiting cannot make it fit; the provider answers for it');
});
test('The charged count replaces the estimate so the next pause reflects what was spent',()=>{
 budgets.forget();
 const now=Date.now();
 budgets.record('g','m',26098,now);
 assert.equal(budgets.correct('g','m',26098,40000),true);
 assert.ok(budgets.waitFor('g','m',11000,50000,now+1000)>0,'40k spent leaves no room for 11k');
 assert.equal(budgets.correct('g','m',999,1),false,'an unknown estimate corrects nothing');
 assert.equal(budgets.correct('g','other',26098,1),false);
});
test('Only exhaustion and outage are retried; a rejected or malformed request is not',()=>{
 for(const message of ['Gemini API returned 429: Rate limit exceeded','quota exceeded','RESOURCE_EXHAUSTED',
  'Provider returned HTTP 503','model is overloaded','The request timed out','Service unavailable'])
  assert.equal(budgets.retryable(new Error(message)),true,message);
 for(const message of ['Invalid decision response for question operation.','Questions must be a non-empty JSON object.',
  'Decision input exceeds 250 KiB; narrow State or Questions.','Gemini API returned 404: model not found',
  'Select a Jev decision model.','Orchestrator tool selection stopped.'])
  assert.equal(budgets.retryable(new Error(message)),false,message);
});
test('The stated delay is read from the header, the message and its units',()=>{
 assert.equal(budgets.retryDelay(Object.assign(new Error('x'),{retryAfter:'30'})),30000);
 assert.equal(budgets.retryDelay(new Error('Please retry in 44s or upgrade your tier')),44000);
 assert.equal(budgets.retryDelay(new Error('retry after 1.5 seconds')),1500);
 assert.equal(budgets.retryDelay(new Error('retry in 2 minutes')),120000);
 assert.equal(budgets.retryDelay(new Error('retry in 250ms')),250);
 assert.equal(budgets.retryDelay(new Error('Rate limit exceeded')),0);
});
test('paced waits inside the budget, reports the wait and hands it back so it can be subtracted',async()=>{
 budgets.forget();
 const vscode=host({'gemini-api':{limits:{'models/gemini-decision-1':50000}}});
 const waits=[],seen=[];let slept=0;
 const run=()=>budgets.paced(vscode,'gemini-api','models/gemini-decision-1',26098,
  async p=>{seen.push(p.waitedMs);},{onWait:w=>waits.push(w),sleep:async ms=>{slept+=ms;}});
 await run(); await run();
 assert.equal(seen[0],0,'the first request is not delayed');
 assert.ok(seen[1]>0,'the second one is');
 assert.equal(slept,seen[1]);
 assert.equal(waits.length,1);
 assert.equal(waits[0].reason,'budget');
 assert.equal(waits[0].limit,50000);
 assert.equal(waits[0].model,'models/gemini-decision-1');
});
test('A rate limit that states its delay gets one more turn on the same model; everything else surfaces',async()=>{
 budgets.forget();
 const vscode=host({});
 let calls=0,slept=0;
 const result=await budgets.paced(vscode,'gemini-api','m',26098,async p=>{
  calls++;
  if(calls===1)throw new Error('Gemini API returned 429: Rate limit exceeded. Please retry in 44s.');
  return {calls,waited:p.waitedMs,retried:p.retriedAfterLimit};
 },{sleep:async ms=>{slept+=ms;}});
 assert.deepEqual([result.calls,slept,result.waited,result.retried],[2,44000,44000,true]);
 let tried=0,sleptAgain=false;
 const fail=(message,options={})=>budgets.paced(vscode,'gemini-api','m',10,
  async()=>{tried++;throw new Error(message);},{sleep:async()=>{sleptAgain=true;},...options});
 await assert.rejects(fail('Gemini API returned 429: Rate limit exceeded.'),/429/);
 await assert.rejects(fail('429 Rate limit exceeded. Please retry in 15 minutes.'),/429/);
 await assert.rejects(fail('Invalid decision response for question operation.'),/Invalid decision/);
 await assert.rejects(fail('429 retry in 5s',{signal:{aborted:true}}),/429/);
 assert.equal(sleptAgain,false,'no stated delay, an overlong one, a rejected request and Stop never wait');
 assert.equal(tried,4,'each of them was attempted exactly once');
});
test('The table keeps a budget per model and never invents one',()=>{
 const config=require('../model-config');
 const stored={enabled:['a','b'],known:['a','b'],limits:{a:50000}};
 const rows=config.rows([{id:'a',label:'A'},{id:'b',label:'B'}],stored,'gemini-api');
 assert.equal(rows[0].limit,50000);
 assert.equal(rows[1].limit,undefined,'a model with no budget carries none');
 const store={modelConfig:{'gemini-api':{limits:{a:50000}}}};
 const vscode={workspace:{getConfiguration:()=>({get:(key,fallback)=>Object.hasOwn(store,key)?store[key]:fallback})}};
 assert.equal(config.read(vscode,'gemini-api').limits.a,50000);
 assert.deepEqual(config.read(vscode,'openrouter-api').limits,{},'a provider without budgets reads an empty set');
});
test('A provider that limits requests rather than tokens is paced by its call limit',()=>{
 budgets.forget();
 const now=Date.now();
 for(let i=0;i<50;i++)budgets.record('typesafe-api','jev-latest',40,now);
 assert.equal(budgets.calls('typesafe-api','jev-latest',now+1000),50);
 assert.equal(budgets.waitFor('typesafe-api','jev-latest',40,0,now+1000,50),59000,'the 51st call waits out the first');
 assert.equal(budgets.waitFor('typesafe-api','jev-latest',40,0,now+1000,60),0,'under a higher limit it goes at once');
 assert.equal(budgets.waitFor('typesafe-api','jev-latest',40,0,now+61000,50),0,'after the minute it goes');
 assert.equal(budgets.waitFor('typesafe-api','jev-latest',40,0,now+1000,0),0,'no call limit, no wait');
});
test('Both limits are enforced together and the longer wait wins',()=>{
 budgets.forget();
 const now=Date.now();
 budgets.record('gemini-api','m',26098,now);
 budgets.record('gemini-api','m',100,now+30000);
 assert.equal(budgets.waitFor('gemini-api','m',26098,50000,now+31000,0),29000,'tokens alone: wait out the big one');
 assert.equal(budgets.waitFor('gemini-api','m',26098,0,now+31000,2),29000,'calls alone: two in the minute, the third waits');
 assert.equal(budgets.waitFor('gemini-api','m',100,50000,now+31000,2),29000,'a small request still waits on the call limit');
 assert.equal(budgets.waitFor('gemini-api','m',100,50000,now+31000,0),0,'and goes at once when only tokens are capped');
});
test('A call limit below one cannot stop every request for ever',()=>{
 budgets.forget();
 assert.equal(budgets.waitFor('g','m',10,0,Date.now(),1),0,'the first request of the minute always goes');
});
test('The budgets are read per model and per provider from the table',()=>{
 const vscode={workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='modelConfig'
  ?{'typesafe-api':{calls:{'jev-latest':50}},'gemini-api':{limits:{'models/gemini-decision-1':50000}}}:fallback})}};
 assert.equal(budgets.callBudget(vscode,'typesafe-api','jev-latest'),50);
 assert.equal(budgets.budget(vscode,'typesafe-api','jev-latest'),0,'TypeSafe states calls, not tokens');
 assert.equal(budgets.budget(vscode,'gemini-api','models/gemini-decision-1'),50000);
 assert.equal(budgets.callBudget(vscode,'gemini-api','models/gemini-decision-1'),0,'Gemini states tokens, not calls');
 assert.equal(budgets.callBudget(vscode,'typesafe-api','jev-preview'),0);
});
