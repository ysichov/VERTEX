"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{groupModels}=require('../model-capabilities');
test('Vercel model groups preserve sorting, filtering and original row identity',()=>{
 const models=[{id:'openai/expensive',pricing:{input:'0.00001'},on:true},{id:'google/hidden',available:false},{id:'openai/free',pricing:{input:'0'},on:false},{id:'google/gemini',pricing:{input:'0.000002'},on:true},{id:'constructor/test'},{id:'unprefixed'}];
 const groups=groupModels(models,'inputPrice',false,true);assert.deepEqual(groups.map(g=>g.label),['constructor','Google','OpenAI','Other']);assert.deepEqual(groups.find(g=>g.id==='openai').models.map(m=>m.id),['openai/free','openai/expensive']);assert.equal(groups.find(g=>g.id==='google').models.length,1);assert.equal(groups.find(g=>g.id==='openai').models[1],models[0]);
 assert.equal(groupModels(models,'inputPrice',true,false).find(g=>g.id==='google').models.length,2);assert.equal(models[0].id,'openai/expensive');
});
test('Vercel grouped view folds groups and preserves selection through layout changes',()=>{
 let panel,receive;const ids=new Map();class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.hidden=false;}
  set id(value){this._id=value;ids.set(value,this);}get id(){return this._id;}
  set innerHTML(value){this.children=[];}replaceChildren(...items){this.children=items;}appendChild(item){this.children.push(item);return item;}
  setAttribute(name,value){this[name]=value;}addEventListener(name,fn){this.events[name]=fn;}
  querySelectorAll(){return [];}
 }
 const vnode={ViewColumn:{Active:1},workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='provider'?'vercel-api':fallback})},window:{createWebviewPanel:()=>panel={webview:{onDidReceiveMessage(){},postMessage(){}},onDidDispose(){}}}};
 require('../model-config').open(vnode,async()=>[],()=>'',()=>{},{});
 for(const id of ['tree','save','stop-detection','choose-log-folder','log-settings','said','error-dialog','error-text','error-copy-status','copy-dialog-error','close-error']){const node=new Element();node.id=id;}
 const script=panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];vm.runInNewContext(script,{document:{getElementById:id=>ids.get(id),createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},window:{addEventListener:(name,fn)=>receive=fn},acquireVsCodeApi:()=>({postMessage(){}})});
 const rows=[{id:'openai/a',label:'A',on:true},{id:'google/b',label:'B',on:false}];receive({data:{provider:'vercel-api',rows}});
 const walk=node=>[node,...(node.children||[]).flatMap(walk)];const body=()=>ids.get('body-vercel-api');let nodes=walk(body());nodes.find(n=>n.textContent==='By provider').events.click();
 nodes=walk(body());const table=nodes.find(n=>n.tag==='table'),bodies=table.children.filter(n=>n.tag==='tbody');assert.equal(bodies.length,2);assert.ok(nodes.some(n=>n.className==='vertex-segment-toggle'));
 const google=bodies[0],fold=google.children[0].children[0].children[0];fold.events.click();assert.equal(google.children[1].hidden,true);assert.equal(fold['aria-expanded'],'false');
 const box=google.children[1].children[0].children[0];box.checked=true;box.events.change();assert.equal(rows[1].on,true);
 walk(body()).find(n=>n.textContent==='All models').events.click();assert.equal(walk(body()).find(n=>n.tag==='table').children.filter(n=>n.tag==='tbody').length,1);
 walk(body()).find(n=>n.textContent==='By provider').events.click();const again=walk(body()).find(n=>n.tag==='table').children.filter(n=>n.tag==='tbody')[0];assert.equal(again.children[1].hidden,true);assert.equal(again.children[1].children[0].children[0].checked,true);
});
