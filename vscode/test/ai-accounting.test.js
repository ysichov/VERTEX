"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),api=require('../openai-compatible'),detection=require('../model-detection'),logs=require('../session-log'),usage=require('../usage-report');
test('model probes log actual usage and cost even when message-content logging is off',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-check-cost-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const vscode={workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='logPath'?root:fallback})}};
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'private-probe-key'}));
 let requests=0;t.mock.method(api,'requestJson',async(id,key,route,body)=>{requests++;assert.equal(key,'private-probe-key');if(body.model==='bad')throw Object.assign(new Error('Forbidden'),{status:403});return {id:'gen_check_'+body.model,model:body.model,usage:{prompt_tokens:6,completion_tokens:2,prompt_tokens_details:{cached_tokens:2},gateway_cost:0.002},choices:[{message:{content:'OK'}}]};});
 await detection.probe(vscode,{},'vercel-api','first',()=>'',async()=> '');
 await assert.rejects(()=>detection.probe(vscode,{},'vercel-api','bad',()=>'',async()=> ''),/Forbidden/);
 const report=usage.readUsage(root),result=usage.aggregate(report.rows,{operation:'Model check'});
 assert.equal(requests,2);assert.equal(result.total.calls,2);assert.equal(result.total.input,4);assert.equal(result.total.cacheRead,2);assert.equal(result.total.cost,0.002);assert.equal(result.total.missing,1);
 const files=fs.readdirSync(path.join(root,'claude_compatible'));assert.equal(files.length,1);const text=fs.readFileSync(path.join(root,'claude_compatible',files[0]),'utf8');assert.ok(!text.includes('private-probe-key'));assert.match(text,/request_error/);assert.match(text,/Model check/);
});
test('stopping bulk checks retains accounting for completed checks only',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-stop-cost-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let stopped=false;
 const vscode={workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='logPath'?root:fallback})}};
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'k'}));t.mock.method(api,'requestJson',async()=>{stopped=true;return {id:'gen_stopped_check',model:'first',usage:{prompt_tokens:2,completion_tokens:1,cost:0.001},choices:[{message:{content:'OK'}}]};});
 await detection.detect([{id:'vercel-api'}],async()=>[{id:'first'},{id:'untested'}],(id,model)=>detection.probe(vscode,{},id,model,()=>'',async()=>''),()=>{},()=>stopped);
 const rows=usage.readUsage(root).rows;assert.equal(rows.length,1);assert.equal(rows[0].model,'first');assert.equal(rows[0].cost,0.001);
});
test('accounting has private default storage when no log folder is selected',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-default-accounting-'));
 try{logs.configureAccounting({globalStorageUri:{fsPath:root}});const log=logs.create('','vercel-api','20261107_120000',{},'Commit message');log.user('draft');log.assistant({model:'m',usage:{input_tokens:1,cost_usd:0.01}});const report=usage.readUsage('');assert.equal(report.rows.length,1);assert.equal(report.rows[0].operation,'Commit message');assert.ok(report.folder.startsWith(root));}finally{logs.configureAccounting(undefined);logs.reset();fs.rmSync(root,{recursive:true,force:true});}
});
test('native per-model counters are not doubled or treated as subscription charges',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-cli-cost-'));
 try{const log=logs.create(root,'claude','20261107_120000',{},'Model check');log.user('check');log.providerResponse({provider:'claude',scope:'cli_run',response:{modelUsage:{modelA:{inputTokens:20,outputTokens:4,costUSD:0.2},modelB:{inputTokens:3,outputTokens:2,costUSD:0.1}},total_cost_usd:0.3}});log.assistant({model:'modelA, modelB',usage:{input_tokens:23,output_tokens:6}});const report=usage.aggregate(usage.readUsage(root).rows);assert.equal(report.models.length,2);assert.equal(report.total.input,23);assert.equal(report.total.output,6);assert.equal(report.total.known,0);assert.equal(report.total.cost,0);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
