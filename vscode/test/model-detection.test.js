"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { detect } = require("../model-detection");
test("discovery distinguishes models that answer, models that fail, and missing providers", async () => {
  const progress = [];
  const result = await detect([{id:"one"},{id:"missing"}], async id => {
    if (id === "missing") throw new Error("No key");
    return [{id:"ok",label:"OK"},{id:"no",label:"No"}];
  }, async (_,model) => { if (model === "no") throw new Error("Forbidden"); }, p => progress.push(p));
  assert.deepEqual(result.results[0].rows.map(r => [r.id,r.on,r.available]), [["ok",true,true],["no",false,false]]);
  assert.equal(result.results[0].rows[1].reason,"Forbidden");
  assert.equal(result.results[1].error,"No key");
  assert.equal(progress.length,2);
});
test("stopping discovery keeps checked results and leaves untested models unchanged", async () => {
  let stop = false;
  const result = await detect([{id:"one"}], async () => [{id:"a"},{id:"b"}], async () => {stop=true;}, () => {}, () => stop);
  assert.equal(result.cancelled,true);
  assert.equal(result.results[0].checked,1);
  assert.equal(result.results[0].partial,true);
  assert.equal(result.results[0].rows[0].available,true);
  assert.equal(result.results[0].rows[1].checked,false);
  assert.equal(result.results[0].rows[1].on,undefined);
});
test("the LLM settings page script compiles and uses the existing button theme", () => {
  const { open } = require("../model-config");
  let page;
  const vscode = { ViewColumn: { Active: 1 }, workspace: { getConfiguration: () => ({ get: (_,fallback) => fallback }) },
    window: { createWebviewPanel: () => (page = { webview: { postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {} }) } };
  open(vscode,async () => [], () => "", () => {}, {});
  const code = page.webview.html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  new (require("node:vm").Script)(code);
  assert.match(page.webview.html,/textContent: scanningProvider === p.id/);
  assert.match(page.webview.html,/action: "detect", provider: p.id/);
  assert.doesNotMatch(page.webview.html,/id="detect"/);
  assert.match(page.webview.html,/One button for all of VERTEX/);
  assert.match(page.webview.html,/id: "check-status-" \+ p.id/);
});
test("the settings host scans only the requested provider and rejects global scans", async () => {
  let handler;
  const asked = [];
  const vscode = { ViewColumn: { Active: 1 }, workspace: { getConfiguration: () => ({ get: (_,fallback) => fallback }) },
    window: { createWebviewPanel: () => ({ webview: { postMessage() {}, onDidReceiveMessage(fn) { handler=fn; } }, onDidDispose() {} }) } };
  require("../model-config").open(vscode, async id => { asked.push(id); return []; }, () => "", () => {}, {});
  await handler({action:"detect"});
  await handler({action:"detect",provider:"unknown"});
  assert.deepEqual(asked,[]);
  await handler({action:"detect",provider:"copilot"});
  assert.deepEqual(asked,["copilot"]);
});
test("checking shows progress next to the provider, and finishes with its result there", () => {
  let panel, onMessage;
  const vscode = { ViewColumn: { Active: 1 }, workspace: { getConfiguration: () => ({ get: (_,fallback) => fallback }) },
    window: { createWebviewPanel: () => (panel = { webview: { postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {} }) } };
  require("../model-config").open(vscode, async () => [], () => "", () => {}, {});
  const ids = new Map(), nodes = [], messages = [];
  class Element {
    constructor() { this.children=[]; this.listeners={}; nodes.push(this); }
    set id(id) { this._id=id; ids.set(id,this); }
    get id() { return this._id; }
    set innerHTML(value) { this.children=[]; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(){this.children=[];}
    showModal(){this.open=true;}
    close(){this.open=false;}
    setAttribute(name,value) { this[name]=value; }
    addEventListener(event,fn) { this.listeners[event]=fn; }
  }
  for(const id of ["tree","save","stop-detection","choose-log-folder","log-settings","said","error-dialog","error-text","error-copy-status","copy-dialog-error","close-error","close-model-info","model-info-dialog","model-info-title","model-info-text"]) { const node=new Element(); node.id=id; }
  const document = { getElementById: id => ids.get(id), createElement: () => new Element(), createTextNode: text => ({textContent:text}) };
  require("node:vm").runInNewContext(panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1], {
    document, acquireVsCodeApi: () => ({postMessage: message => messages.push(message)}),
    window: {addEventListener: (_,fn) => {onMessage=fn;}}
  });
  nodes.find(n => n.textContent === "Check models").listeners.click();
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{action:"detect",provider:"claude"});
  assert.equal(ids.get("check-status-claude").textContent,"Reading model list…");
  onMessage({data:{detectionProgress:{provider:"claude",model:"Sonnet",index:2,total:5}}});
  assert.equal(ids.get("check-status-claude").textContent,"Checking 2 / 5: Sonnet…");
  onMessage({data:{detection:{results:[{provider:"claude",rows:[{id:"sonnet",label:"Sonnet",on:true}]}],cancelled:false}}});
  assert.equal(ids.get("check-status-claude").textContent,"1 / 1 working");
  assert.equal(ids.get("save").disabled,false);
  onMessage({data:{detection:{results:[{provider:"claude",partial:true,checked:1,total:3,stopReason:"403 require credit card",rows:[
    {id:"a",label:"A",on:false,available:false,checked:true,reason:"403 require credit card https://vercel.com/d?to=%2Fteam%2Fai&source=check"},
    {id:"b",label:"B",on:true,checked:false},{id:"c",label:"C",on:false,checked:false}
  ]}],cancelled:true}}});
  assert.match(ids.get("check-status-claude").textContent,/1 \/ 3 checked/);
  assert.match(ids.get("check-status-claude").textContent,/credit card/);
  assert.match(ids.get("said").textContent,/untested models are unchanged/);
  assert.ok(nodes.some(n=>n.textContent==='Not checked'));
  const hide=nodes.filter(n=>n.title==='Hide unavailable models').at(-1);
  assert.equal(hide.checked,true);hide.checked=false;hide.listeners.change();
  nodes.filter(n=>n.textContent==='Unavailable').at(-1).listeners.click({preventDefault(){}});
  assert.equal(ids.get('error-dialog').open,true);
  const url='https://vercel.com/d?to=%2Fteam%2Fai&source=check';
  const errorLink=ids.get('error-text').children.find(n=>n.href===url);
  assert.ok(errorLink);errorLink.listeners.click({preventDefault(){}});
  assert.equal(messages.at(-1).action,'open-error-link');assert.equal(messages.at(-1).url,url);

  ids.get('copy-dialog-error').listeners.click();
  assert.match(messages.at(-1).text,/403 require credit card/);
  ids.get('close-error').listeners.click();assert.equal(ids.get('error-dialog').open,false);

  nodes.filter(n=>n.textContent==='Copy error').at(-1).listeners.click();
  assert.equal(messages.at(-1).action,'copy-error');
  assert.match(messages.at(-1).text,/403 require credit card/);

  assert.equal(ids.get("save").disabled,false);

});


test("credit card errors stop the provider after one probe, preserving untested rows", async () => {
 for (const reason of ['API returned 403: require credit card']) {
  let calls=0;
  const result=await detect([{id:'vercel-api'}],async()=>[{id:'a',on:true},{id:'b',on:true},{id:'c',on:false}],async()=>{calls++;throw new Error(reason);},()=>{});
  const provider=result.results[0];
  assert.equal(calls,1);assert.equal(provider.stopReason,reason);assert.equal(provider.checked,1);assert.equal(provider.total,3);
  assert.equal(provider.rows[0].on,false);assert.equal(provider.rows[1].on,true);assert.equal(provider.rows[2].on,false);
  assert.equal(provider.rows[1].checked,false);
 }
});

test("model-specific 403 does not stop checking other models", async () => {
 let calls=0;
 const result=await detect([{id:'one'}],async()=>[{id:'a'},{id:'b'}],async()=>{if(++calls===1)throw new Error('API returned 403: model unavailable');},()=>{});
 assert.equal(calls,2);assert.equal(result.results[0].partial,false);assert.equal(result.results[0].rows[1].available,true);
});


test('Copy error writes the complete text and URL to the host clipboard',async()=>{
 let handler,copied;
 const posts=[];
 const vscode={ViewColumn:{Active:1},ConfigurationTarget:{Global:1},workspace:{getConfiguration:(()=>{const v={};return()=>({get:(k,f)=>k in v?v[k]:f,update:async(k,x)=>{v[k]=x;}});})()},
  env:{clipboard:{async writeText(text){copied=text;}}},
  window:{createWebviewPanel:()=>({webview:{postMessage(m){posts.push(m);},onDidReceiveMessage(fn){handler=fn;}},onDidDispose(){}})} };
 require('../model-config').open(vscode,async()=>[],()=>'',()=>{},{});
 const text='Vercel · model\n403 require credit card\nhttps://vercel.com/account/billing?next=models&source=check';
 await handler({action:'copy-error',text});
 assert.equal(copied,text);assert.deepEqual(posts.at(-1),{errorCopied:true});
 vscode.env.clipboard.writeText=async()=>{throw new Error('Clipboard unavailable');};
 await handler({action:'copy-error',text});
 assert.deepEqual(posts.at(-1),{errorCopied:false,copyError:'Clipboard unavailable'});
});


test('a Vercel model requiring Pro or Enterprise does not stop the provider',async()=>{
 let calls=0;
 const error='Vercel AI Gateway API returned 403: stealth/glyph-cluster on stealth requires an active Pro plan with purchased AI Gateway credits, or an Enterprise plan. Buy credits at https://vercel.com/d?to=%2Fteam%2Fai%3Fmodal%3Dtop-up or manage your plan at https://vercel.com/d?to=%2Fteam%2Fsettings%2Fbilling.';
 const result=await detect([{id:'vercel-api'}],async()=>[{id:'stealth/glyph-cluster'},{id:'another-model'}],async()=>{if(++calls===1)throw new Error(error);},()=>{});
 assert.equal(calls,2);assert.equal(result.results[0].stopReason,undefined);
 assert.equal(result.results[0].rows[0].available,false);assert.equal(result.results[0].rows[1].available,true);
});


test('payment and insufficient credits errors do not auto-stop without a credit card message',async()=>{
 for(const reason of ['402 Payment required','insufficient_credits','billing limit exceeded']){
  let calls=0;
  const result=await detect([{id:'vercel-api'}],async()=>[{id:'a'},{id:'b'}],async()=>{if(++calls===1)throw new Error(reason);},()=>{});
  assert.equal(calls,2);assert.equal(result.results[0].stopReason,undefined);
 }
});

test('single model check probes only the requested model',async t=>{
 let handler;const calls=[],posts=[];
 t.mock.method(require('../model-detection'),'probe',async(_,__,id,model)=>{calls.push([id,model]);});
 const vscode={ViewColumn:{Active:1},ConfigurationTarget:{Global:1},workspace:{getConfiguration:(()=>{const v={};return()=>({get:(k,f)=>k in v?v[k]:f,update:async(k,x)=>{v[k]=x;}});})()},
  window:{createWebviewPanel:()=>({webview:{postMessage(m){posts.push(m);},onDidReceiveMessage(fn){handler=fn;}},onDidDispose(){}})}};
 require('../model-config').open(vscode,async()=>[{id:'a'},{id:'b'}],()=>'',()=>{},{});
 await handler({action:'detect-model',provider:'vercel-api',model:'b'});
 assert.deepEqual(calls,[['vercel-api','b']]);
 assert.deepEqual(posts.at(-1),{modelCheck:{provider:'vercel-api',model:'b',available:true}});
});


test('bulk discovery skips already available models',async()=>{
 const calls=[];
 const result=await detect([{id:'one'}],async()=>[{id:'known',on:true,available:true},{id:'new'},{id:'failed',available:false}],async(_,model)=>calls.push(model),()=>{});
 assert.deepEqual(calls,['new','failed']);assert.equal(result.results[0].rows[0].available,true);
});

test('repeated bulk checks reuse successful checks, including a single-model check',async t=>{
 let handler;const calls=[];
 t.mock.method(require('../model-detection'),'probe',async(_,__,id,model)=>calls.push(model));
 const vscode={ViewColumn:{Active:1},ConfigurationTarget:{Global:1},workspace:{getConfiguration:(()=>{const v={};return()=>({get:(k,f)=>k in v?v[k]:f,update:async(k,x)=>{v[k]=x;}});})()},
 window:{createWebviewPanel:()=>({webview:{postMessage(){},onDidReceiveMessage(fn){handler=fn;}},onDidDispose(){}})}};
 require('../model-config').open(vscode,async()=>[{id:'a'},{id:'b'}],()=>'',()=>{},{});
 await handler({action:'detect-model',provider:'vercel-api',model:'a'});
 await handler({action:'detect',provider:'vercel-api'});
 await handler({action:'detect',provider:'vercel-api'});
 assert.deepEqual(calls,['a','b']);
 await handler({action:'detect-model',provider:'vercel-api',model:'a'});
 assert.deepEqual(calls,['a','b','a']);
});


test('new catalog models arrive off, a dropped one stays as not in catalog',()=>{
 const config=require('../model-config');
 const read={enabled:['a','gone'],known:['a','b','gone'],hidden:[],versions:[],unavailable:{}};
 const rows=config.rows([{id:'a'},{id:'b'},{id:'c'}],read,'codex');
 assert.deepEqual(rows.map(r=>[r.id,r.on,!!r.isNew,!!r.missing]),[['a',true,false,false],['b',false,false,false],['c',false,true,false],['gone',true,false,true]]);
});

test('adopting every provider at once loses none of them',async()=>{
 const config=require('../model-config');
 let all={codex:{hidden:['x']},'vercel-api':{hidden:[]}};
 const settings={get:(key,fallback)=>key==='modelConfig'?all:fallback,async update(key,value){await new Promise(r=>setTimeout(r,5));all=value;}};
 const vscode={ConfigurationTarget:{Global:1},workspace:{getConfiguration:()=>settings}};
 await Promise.all([config.adopt(vscode,'codex',[{id:'x'},{id:'y'}]),config.adopt(vscode,'vercel-api',[{id:'v'}])]);
 assert.deepEqual(all.codex.enabled,['y']);assert.deepEqual(all['vercel-api'].enabled,['v']);
});

test('unchecked selection is migrated to a persistent unavailable flag only once',async()=>{
 const config=require('../model-config');
 let all={'vercel-api':{hidden:['old-off']}};let updates=0;
 const settings={get:(key,fallback)=>key==='modelConfig'?all:fallback,async update(key,value){assert.equal(key,'modelConfig');all=value;updates++;}};
 const vscode={ConfigurationTarget:{Global:1},workspace:{getConfiguration:()=>settings}};
 const list=[{id:'old-off',label:'Old off'},{id:'selected',label:'Selected'},{id:'later-off',label:'Later off'}];
 await config.adopt(vscode,'vercel-api',list);
 assert.deepEqual(all['vercel-api'].enabled,['selected','later-off']);assert.equal(all['vercel-api'].hidden,undefined);
 await config.migrateUnavailable(vscode,'vercel-api',list);
 assert.equal(all['vercel-api'].unavailable['old-off'].source,'probe');
 let rows=config.rows(list,config.read(vscode,'vercel-api'),'vercel-api');
 assert.equal(rows[0].available,false);assert.equal(rows[0].on,false);assert.equal(rows[1].available,undefined);
 assert.equal(rows[0].reason,'Unavailable');assert.equal(rows[0].checked,true);
 all['vercel-api'].enabled=['selected'];
 await config.migrateUnavailable(vscode,'vercel-api',list);
 assert.equal(updates,2);assert.equal(all['vercel-api'].unavailable['later-off'],undefined);
 rows=config.rows(list,config.read(vscode,'vercel-api'),'vercel-api');
 assert.equal(rows[2].on,false);assert.equal(rows[2].available,undefined);
});

test('checks persist per key across windows, including failures and interrupted scans',async t=>{
 const values=new Map();const secrets={get:async key=>values.get(key),store:async(key,value)=>values.set(key,value)};
 const profiles=require('../key-profiles');await profiles.save(secrets,'openrouter-api','one','key-one');
 const calls=[];let dispose;
 t.mock.method(require('../model-detection'),'probe',async(_,__,id,model)=>{calls.push(model);if(model==='b')throw new Error('429');if(model==='c')dispose();});
 const posts=[];let handler;
 const vscode={ViewColumn:{Active:1},ConfigurationTarget:{Global:1},workspace:{getConfiguration:(()=>{const v={};return()=>({get:(k,f)=>k in v?v[k]:f,update:async(k,x)=>{v[k]=x;}});})()},window:{createWebviewPanel:()=>({webview:{postMessage(m){posts.push(m);},onDidReceiveMessage(fn){handler=fn;}},onDidDispose(fn){dispose=fn;}})}};
 const open=()=>require('../model-config').open(vscode,async()=>['a','b','c','d'].map(id=>({id})),()=>'',()=>{},secrets);
 open();await handler({action:'detect',provider:'openrouter-api'});assert.deepEqual(calls,['a','b','c']);
 assert.equal(posts.filter(p=>p.checkedRow).length,3);
 open();await handler({action:'load',provider:'openrouter-api'});
 const loaded=posts.at(-1).rows;assert.equal(loaded[0].checked,true);assert.equal(loaded[1].checked,true);assert.equal(loaded[1].available,false);
 await handler({action:'detect',provider:'openrouter-api'});assert.deepEqual(calls,['a','b','c','d']);
 await handler({action:'detect-model',provider:'openrouter-api',model:'a'});assert.deepEqual(calls,['a','b','c','d','a']);
 await profiles.save(secrets,'openrouter-api','two','key-two');
 await handler({action:'detect-model',provider:'openrouter-api',model:'b'});
 await handler({action:'load',provider:'openrouter-api'});const other=posts.at(-1).rows;assert.notEqual(other[0].checked,true);assert.equal(other[1].checked,true);
 await profiles.select(secrets,'openrouter-api','one');await handler({action:'load',provider:'openrouter-api'});assert.ok(posts.at(-1).rows.every(r=>r.checked===true));
});

test('group check probes only that model provider and returns its scope',async t=>{
 let handler;const calls=[],posts=[];
 t.mock.method(require('../model-detection'),'probe',async(_,__,id,model)=>calls.push(model));
 const vscode={ViewColumn:{Active:1},ConfigurationTarget:{Global:1},workspace:{getConfiguration:(()=>{const v={};return()=>({get:(k,f)=>k in v?v[k]:f,update:async(k,x)=>{v[k]=x;}});})()},window:{createWebviewPanel:()=>({webview:{postMessage(m){posts.push(m);},onDidReceiveMessage(fn){handler=fn;}},onDidDispose(){}})}};
 require('../model-config').open(vscode,async()=>[{id:'openai/a'},{id:'google/b'},{id:'openai/c'}],()=>'',()=>{},{});
 await handler({action:'detect',provider:'openrouter-api',group:'openai'});
 assert.deepEqual(calls,['openai/a','openai/c']);const result=posts.at(-1).detection.results[0];assert.equal(result.group,'openai');assert.equal(result.total,2);
});

test('OpenRouter Free group check never probes paid or known-unavailable models',async t=>{
 let handler;const calls=[],posts=[];t.mock.method(require('../model-detection'),'probe',async(_,__,id,model)=>calls.push(model));
 const vscode={ViewColumn:{Active:1},ConfigurationTarget:{Global:1},workspace:{getConfiguration:(()=>{const v={};return()=>({get:(k,f)=>k in v?v[k]:f,update:async(k,x)=>{v[k]=x;}});})()},window:{createWebviewPanel:()=>({webview:{postMessage(m){posts.push(m);},onDidReceiveMessage(fn){handler=fn;}},onDidDispose(){}})}};
 require('../model-config').open(vscode,async()=>[{id:'openai/free',free:true},{id:'openai/paid',free:false},{id:'google/free',free:true},{id:'openai/unavailable',free:true,available:false}],()=>'',()=>{},{});
 await handler({action:'detect',provider:'openrouter-api',group:'openai',filter:'free'});assert.deepEqual(calls,['openai/free']);assert.equal(posts.at(-1).detection.results[0].filtered,true);
});
