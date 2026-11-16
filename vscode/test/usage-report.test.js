"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),vm=require("node:vm"),usage=require("../usage-report");
test('activity subtables keep model and Jev usage and totals separate',()=>{
 const result=usage.aggregate([{provider:'codex',model:'gpt',operation:'Chat',input:100,output:10,cacheRead:20,cost:null},
  {provider:'typesafe-api',model:'jev',operation:'Topic routing with Jev',costKind:'jev',input:7,output:2,cacheRead:0,cost:0.001,estimated:true}]);
 assert.deepEqual(result.activitiesByKind.model.map(row=>row.provider),['Chat']);
 assert.deepEqual(result.activitiesByKind.jev.map(row=>row.provider),['Topic routing with Jev']);
 assert.equal(result.costs.model.input,100);assert.equal(result.costs.jev.input,7);
 assert.equal(result.costs.model.output,10);assert.equal(result.costs.jev.output,2);
 const page=usage.html('split');assert.match(page,/<h2>LLM activities<\/h2>/);assert.match(page,/<h2>Jev activities<\/h2>/);
});
test('usage report deduplicates raw and normalized usage and preserves per-model cost',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-usage-'));try{
 const folder=path.join(root,'claude_compatible');fs.mkdirSync(folder);
 const rows=[{type:'vertex_request',request:{prompt:'PRIVATE_PROMPT'}},{type:'vertex_provider_response',provider:'vercel-api',scope:'model_response',response:{id:'gen_a',model:'model-a',usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:30},gateway_cost:0.01}}},{type:'assistant',message:{id:'msg1',model:'model-a',usage:{input_tokens:70,output_tokens:10,cache_read_input_tokens:30,cost_usd:0.01,generation_id:'gen_a'}}},{type:'assistant',message:{id:'msg1',model:'model-a',usage:{input_tokens:70,cost_usd:0.01}}},{type:'vertex_provider_response',provider:'vercel-api',scope:'model_response',response:{id:'gen_b',model:'model-b',usage:{prompt_tokens:20,completion_tokens:5,gateway_cost:0}}},{type:'assistant',message:{id:'msg2',model:'model-b',usage:{input_tokens:20,output_tokens:5,cost_usd:0,generation_id:'gen_b'}}}].map(row=>({timestamp:'2026-11-07T10:00:00Z',...row}));
 fs.writeFileSync(path.join(folder,'vercel-api_20261107_100000_abc123.jsonl'),rows.map(JSON.stringify).join('\n'));
 fs.writeFileSync(path.join(folder,'codex_20261107_100001_abcd12.jsonl'),JSON.stringify({timestamp:'2026-11-07T10:01:00Z',type:'assistant',message:{id:'c',model:'codex-model',usage:{input_tokens:40,output_tokens:5}}}));
 const report=usage.readUsage(root);assert.equal(report.rows.length,3);assert.ok(!JSON.stringify(report).includes('PRIVATE_PROMPT'));
 const all=usage.aggregate(report.rows);assert.equal(all.total.input,130);assert.equal(all.total.output,20);assert.equal(all.total.cacheRead,30);assert.equal(all.total.cost,0.01);assert.equal(all.total.known,2);assert.equal(all.total.missing,1);assert.equal(all.models.length,3);
 const vercel=usage.aggregate(report.rows,{provider:'vercel-api'});assert.equal(vercel.total.calls,2);assert.equal(vercel.total.missing,0);assert.equal(vercel.models.find(r=>r.model==='model-b').cost,0);
 const empty=usage.aggregate(report.rows,{from:'2026-11-08',to:'2026-11-09'});assert.equal(empty.total.calls,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('usage report dates include both period boundaries and keep model changes separate',()=>{
 const rows=[{provider:'p',model:'a',time:new Date(2026,10,1,0,0).getTime(),input:1,cost:0.1},{provider:'p',model:'b',time:new Date(2026,10,30,23,59).getTime(),input:2,cost:null},{provider:'q',model:'c',time:new Date(2026,11,1,0,0).getTime(),input:3,cost:1}];
 const result=usage.aggregate(rows,{from:'2026-11-01',to:'2026-11-30'});assert.equal(result.total.calls,2);assert.equal(result.total.cost,0.1);assert.equal(result.total.missing,1);assert.equal(result.models.length,2);
 const html=usage.html('test');const script=html.match(/<script nonce="test">([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(script));assert.match(html,/type="date"/);assert.match(html,/By provider/);assert.match(html,/By model/);
});

test('usage report calendar periods filter and navigate in its webview',()=>{
 const elements=new Map();class Element{constructor(){this.value='';this.textContent='';this.children=[];}replaceChildren(...items){this.children=items;}appendChild(item){this.children.push(item);}add(item){this.children.push(item);}addEventListener(name,fn){this[name]=fn;}querySelector(selector){return get(selector.match(/"(.*?)"/)[1]==='period'?'period':selector.match(/"(.*?)"/)[1]);}}
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};let receive;
 const html=usage.html('n'),script=html.match(/<script nonce="n">([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(script,{document:{getElementById:get,createElement:()=>new Element()},window:{addEventListener:(name,fn)=>receive=fn},acquireVsCodeApi:()=>({postMessage(){}}),Option:function(text,value){this.text=text;this.value=value;}});
 receive({data:{data:{configured:true,folder:'logs',rows:[{provider:'vercel-api',model:'a',time:new Date(2026,10,7,12).getTime(),input:10,output:2,cost:0.1}]}}});
 assert.match(get('total').textContent,/12 tokens/);get('from').value='2026-11-08';get('from').onchange();assert.match(get('total').textContent,/0 tokens/);
 get('to').value='2026-11-07';get('to').onchange();assert.match(get('error').textContent,/on or before/);
 get('period').value='month';get('period').onchange();get('from').value='2024-03-01';get('to').value='2024-03-31';get('previous').onclick();assert.equal(get('from').value,'2024-02-01');assert.equal(get('to').value,'2024-02-29');get('next').onclick();assert.equal(get('to').value,'2024-03-31');
 get('period').value='year';get('from').value='2024-01-01';get('previous').onclick();assert.equal(get('from').value,'2023-01-01');assert.equal(get('to').value,'2023-12-31');
 get('period').value='all';get('period').onchange();assert.equal(get('from').value,'');assert.equal(get('next').disabled,true);
});

test('streaming native model calls are not doubled by the final CLI run and aggregate message',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-native-stream-'));
 try{const log=require('../session-log').create(root,'claude','20261107_120000',{});log.user('run');for(const [id,model,input] of [['a','m1',10],['b','m2',20]])log.providerResponse({provider:'claude',scope:'model_response',response:{id,model,usage:{input_tokens:input,output_tokens:1}}});log.providerResponse({provider:'claude',scope:'cli_run',response:{modelUsage:{m1:{inputTokens:10,outputTokens:1},m2:{inputTokens:20,outputTokens:1}}}});log.assistant({model:'m1, m2',usage:{input_tokens:30,output_tokens:2}});const result=usage.aggregate(usage.readUsage(root).rows);assert.equal(result.total.calls,2);assert.equal(result.total.input,30);assert.equal(result.models.length,2);}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('CodeMie streamed CLI estimates match canonical models once without doubling tokens or calls',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-codemie-cost-'));
 try{
  const log=require('../session-log').create(root,'codemie','20261114_100000',{questions:true});log.user('question');
  for(const id of ['a','b'])log.providerResponse({provider:'codemie',scope:'model_response',response:{id,model:'claude-opus-5-5',usage:{input_tokens:10,output_tokens:2}}});
  const response={id:'run',total_cost_usd:1.6210562,modelUsage:{'claude-opus-5-5[1m]':{canonicalModel:'claude-opus-5-5',inputTokens:20,outputTokens:4,costUSD:1.6210562,costBasis:'list'}}};
  log.providerResponse({provider:'codemie',scope:'cli_run',response});log.providerResponse({provider:'codemie',scope:'cli_run',response});
  log.assistant({model:'claude-opus-5-5[1m]',usage:{input_tokens:20,output_tokens:4},text:'answer'});
  const data=usage.aggregate(usage.readUsage(root).rows).total;
  assert.equal(data.cost,1.6210562);assert.equal(data.estimated,1);assert.equal(data.calls,2);assert.equal(data.input,20);assert.equal(data.output,4);assert.equal(data.missing,0);
  const session=require('../log-report').readSessions(root).sessions[0];assert.equal(session.usage.cost,1.6210562);assert.equal(session.usage.costEstimated,1);assert.equal(session.usage.input,20);assert.equal(session.prompts[0].usage.cost,1.6210562);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('reported CodeMie costs take precedence over list-price CLI estimates; subscription costs stay excluded',()=>{
 for(const provider of ['codemie','claude']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-cost-source-'));
  try{
   const log=require('../session-log').create(root,provider,'20261114_100000',{questions:true});log.user('question');
   log.providerResponse({provider,scope:'model_response',response:{id:'a',model:'m',usage:{input_tokens:10,output_tokens:2,...(provider==='codemie'?{cost_usd:0.3}:{})}}});
   log.assistant({model:'m',usage:{input_tokens:10,output_tokens:2,...(provider==='codemie'?{cost_usd:0.3}:{})},text:'answer'});
   log.providerResponse({provider,scope:'cli_run',response:{total_cost_usd:9,modelUsage:{m:{costUSD:9}}}});
   const total=usage.aggregate(usage.readUsage(root).rows).total;assert.equal(total.cost,provider==='codemie'?0.3:0);assert.equal(total.estimated,0);
   const session=require('../log-report').readSessions(root).sessions[0];assert.equal(session.usage.cost,provider==='codemie'?0.3:undefined);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});

test('CodeMie aggregate-only estimates and Jev estimates are labeled without being treated as bills',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-cost-estimates-'));
 try{
  const logs=require('../session-log'),log=logs.create(root,'codemie','20261114_100000',{questions:true});log.user('question');
  log.providerResponse({provider:'codemie',scope:'cli_run',response:{total_cost_usd:0.5}});
  log.assistant({model:'m',usage:{input_tokens:10,output_tokens:2},text:'answer'});
  const jev=logs.create(root,'typesafe-api','20261114_100000',{});jev.user('route');jev.assistant({model:'jev',usage:{input_tokens:100,estimated_cost_usd:0.0000042}});
  const report=usage.aggregate(usage.readUsage(root).rows);assert.equal(report.total.calls,2);assert.equal(report.total.input,110);assert.equal(report.total.cost,0.5000042);assert.equal(report.total.estimated,2);assert.equal(report.total.missing,0);
  assert.match(usage.html('n'),/not the service bill/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('model spending and Jev spending remain separate across provider and activity filters',()=>{
 const rows=[
  {provider:'codemie',model:'claude-opus-5-5',operation:'Chat',cost:1.6210562,estimated:true},
  {provider:'typesafe-api',model:'jev-1.14.0',operation:'Topic routing with Jev',cost:0.000454062,estimated:true},
  {provider:'gemini-api',model:'gemini-flash',operation:'Review block with Jev',cost:0.0001},
  {provider:'gemini-api',model:'gemini-flash',operation:'Chat',cost:0.2}
 ];
 const report=usage.aggregate(rows);
 assert.equal(report.costs.model.cost,1.8210562);
 assert.equal(report.costs.jev.cost,0.000554062);
 assert.equal(report.costs.model.estimated,1);assert.equal(report.costs.jev.estimated,1);
 assert.equal(usage.aggregate(rows,{provider:'codemie'}).costs.jev.known,0);
 assert.equal(usage.aggregate(rows,{operation:'Review block with Jev'}).costs.model.known,0);
 const records=[{type:'user',timestamp:'2026-11-14T10:00:00Z',vertex_operation:'Topic routing with Jev',message:{content:'route'}},{type:'assistant',timestamp:'2026-11-14T10:00:01Z',message:{model:'gemini-flash',usage:{estimated_cost_usd:0.0001},content:[]}}];
 const session=require('../log-report').parseSession(records.map(JSON.stringify).join('\n'),'gemini-api_20261114_120000.jsonl');
 assert.equal(session.prompts[0].costKind,'jev');
});
