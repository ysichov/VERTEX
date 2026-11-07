"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),vm=require("node:vm"),usage=require("../usage-report");
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
 const html=usage.html('test');const script=html.match(/<script nonce="test">([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(script));assert.match(html,/dd-mm-yyyy/);assert.match(html,/By provider/);assert.match(html,/By model/);
});

test('usage report filters render valid dd-mm-yyyy periods in its webview',()=>{
 const elements=new Map();class Element{constructor(){this.value='';this.textContent='';this.children=[];}replaceChildren(...items){this.children=items;}appendChild(item){this.children.push(item);}add(item){this.children.push(item);}addEventListener(name,fn){this[name]=fn;}}
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};let receive;
 const html=usage.html('n'),script=html.match(/<script nonce="n">([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(script,{document:{getElementById:get,createElement:()=>new Element()},window:{addEventListener:(name,fn)=>receive=fn},acquireVsCodeApi:()=>({postMessage(){}}),Option:function(text,value){this.text=text;this.value=value;}});
 receive({data:{data:{configured:true,folder:'logs',rows:[{provider:'vercel-api',model:'a',time:new Date(2026,10,7,12).getTime(),input:10,output:2,cost:0.1}]}}});
 assert.match(get('total').textContent,/12 tokens/);get('from').value='08-11-2026';get('from').input();assert.match(get('total').textContent,/0 tokens/);get('from').value='31-02-2026';get('from').input();assert.match(get('error').textContent,/valid period/);
});

test('streaming native model calls are not doubled by the final CLI run and aggregate message',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-native-stream-'));
 try{const log=require('../session-log').create(root,'claude','20261107_120000',{});log.user('run');for(const [id,model,input] of [['a','m1',10],['b','m2',20]])log.providerResponse({provider:'claude',scope:'model_response',response:{id,model,usage:{input_tokens:input,output_tokens:1}}});log.providerResponse({provider:'claude',scope:'cli_run',response:{modelUsage:{m1:{inputTokens:10,outputTokens:1},m2:{inputTokens:20,outputTokens:1}}}});log.assistant({model:'m1, m2',usage:{input_tokens:30,output_tokens:2}});const result=usage.aggregate(usage.readUsage(root).rows);assert.equal(result.total.calls,2);assert.equal(result.total.input,30);assert.equal(result.models.length,2);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
