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
  set innerHTML(value){const remove=node=>{if(node.id)ids.delete(node.id);for(const child of node.children||[])remove(child);};for(const child of this.children)remove(child);this.children=[];}replaceChildren(...items){this.children=items;}appendChild(item){this.children.push(item);return item;}
  setAttribute(name,value){this[name]=value;}addEventListener(name,fn){this.events[name]=fn;}
  querySelectorAll(){return [];}showModal(){this.open=true;}close(){this.open=false;}
 }
 const vnode={ViewColumn:{Active:1},workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='provider'?'vercel-api':fallback})},window:{createWebviewPanel:()=>panel={webview:{onDidReceiveMessage(){},postMessage(){}},onDidDispose(){}}}};
 require('../model-config').open(vnode,async()=>[],()=>'',()=>{},{});
 for(const id of ['tree','save','stop-detection','choose-log-folder','log-settings','said','error-dialog','error-text','error-copy-status','copy-dialog-error','close-error','close-model-info','model-info-dialog','model-info-title','model-info-id','model-info-text']){const node=new Element();node.id=id;}
 const script=panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];vm.runInNewContext(script,{document:{getElementById:id=>ids.get(id),createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},window:{addEventListener:(name,fn)=>receive=fn},acquireVsCodeApi:()=>({postMessage(){}})});
 const rows=[{id:'openai/a',label:'A',on:true,description:'Specialized model description from API',contextWindow:200,pricing:{input:'0.2'}},{id:'google/b',label:'B',on:false,contextWindow:300,pricing:{input:'0.3'}},{id:'openai/c',label:'C',on:true,contextWindow:100,pricing:{input:'0.1'}},{id:'google/d',label:'D',on:true,contextWindow:50,pricing:{input:'0.1'}}];receive({data:{provider:'vercel-api',rows}});
 assert.match(panel.webview.html,/position: sticky; top: 0/);
 const counts=()=>{const walk=node=>[node,...(node.children||[]).flatMap(walk)];return walk(ids.get('body-vercel-api')).find(n=>n.role==='status');};assert.equal(counts().textContent,'Models: 4 · Shown: 4 · Selected: 3');
 const walk=node=>[node,...(node.children||[]).flatMap(walk)];const body=()=>ids.get('body-vercel-api');let nodes=walk(body());nodes.find(n=>n.className==='model-info').events.click();assert.ok(ids.get('model-info-text').children.some(n=>n.textContent==='Specialized model description from API'));assert.ok(ids.get('model-info-text').children.some(n=>n.textContent.startsWith('Source: Vercel')));assert.equal(ids.get('model-info-dialog').open,true);nodes.find(n=>n.textContent==='By provider').events.click();
 nodes=walk(body());const table=nodes.find(n=>n.tag==='table'),bodies=table.children.filter(n=>n.tag==='tbody');assert.equal(bodies.length,2);assert.ok(nodes.some(n=>n.className==='vertex-segment-toggle'));
 const google=bodies[0],fold=google.children[0].children[0].children[0];fold.events.click();assert.equal(google.children[1].hidden,true);assert.equal(fold['aria-expanded'],'false');
 const box=google.children[1].children[0].children[0];box.checked=true;box.events.change();assert.equal(rows[1].on,true);assert.equal(counts().textContent,'Models: 4 · Shown: 4 · Selected: 4');
 walk(body()).find(n=>n.textContent==='All models').events.click();assert.equal(walk(body()).find(n=>n.tag==='table').children.filter(n=>n.tag==='tbody').length,1);
 walk(body()).find(n=>n.textContent==='By provider').events.click();const again=walk(body()).find(n=>n.tag==='table').children.filter(n=>n.tag==='tbody')[0];assert.equal(again.children[1].hidden,true);assert.equal(again.children[1].children[0].children[0].checked,true);
 const grouped=()=>walk(body()).find(n=>n.tag==='table').children.filter(n=>n.tag==='tbody');
 const picker=tbody=>walk(tbody.children[0]).find(n=>n.tag==='select');
 const order=tbody=>tbody.children.slice(1).map(row=>row.children[2].textContent);
 const nameCell=grouped()[1].children[1].children[1];assert.equal(nameCell.children[0].className,'model-info');
 ids.get('models-scroll-vercel-api').scrollTop=237;
 let select=picker(grouped()[1]);select.value='inputPrice';select.events.change();assert.deepEqual(order(grouped()[1]),['openai/c','openai/a']);assert.deepEqual(order(grouped()[0]),['google/b','google/d']);assert.equal(ids.get('models-scroll-vercel-api').scrollTop,237);
 select=picker(grouped()[0]);select.value='contextWindow';select.events.change();assert.deepEqual(order(grouped()[0]),['google/d','google/b']);assert.deepEqual(order(grouped()[1]),['openai/c','openai/a']);
 const direction=walk(grouped()[1].children[0]).find(n=>n['aria-label']==='Reverse sorting in OpenAI');direction.events.click();assert.deepEqual(order(grouped()[1]),['openai/a','openai/c']);assert.deepEqual(order(grouped()[0]),['google/d','google/b']);
 walk(body()).find(n=>n.textContent==='All models').events.click();walk(body()).find(n=>n.textContent==='By provider').events.click();assert.deepEqual(order(grouped()[1]),['openai/a','openai/c']);
 ids.get('models-scroll-vercel-api').scrollTop=321;ids.get('models-scroll-vercel-api').scrollLeft=123;
 const check=walk(body()).find(n=>n['aria-label']==='Check model A');check.events.click();
 assert.equal(ids.get('models-scroll-vercel-api').scrollTop,321);assert.equal(ids.get('models-scroll-vercel-api').scrollLeft,123);
 receive({data:{checkedRow:{provider:'vercel-api',model:'openai/a',available:true}}});
 receive({data:{modelCheck:{provider:'vercel-api',model:'openai/a',available:true}}});
 assert.equal(ids.get('models-scroll-vercel-api').scrollTop,321);assert.equal(ids.get('models-scroll-vercel-api').scrollLeft,123);
 const orRows=[{id:'openai/free',label:'Free A',free:true,on:false},{id:'google/free',label:'Free B',free:true,on:false,available:false},{id:'google/paid',label:'Paid',free:false,on:true}];
 receive({data:{provider:'openrouter-api',rows:orRows}});
 const orNodes=()=>walk(ids.get('body-openrouter-api'));
 orNodes().find(n=>n.textContent==='Free').events.click();
 assert.ok(orNodes().some(n=>n.textContent==='Models: 3 \u00b7 Shown: 1 \u00b7 Selected: 1'));
 orNodes().find(n=>n.textContent==='Select all').events.click();assert.equal(orRows[0].on,true);assert.equal(orRows[2].on,true);
 orNodes().find(n=>n.textContent==='By provider').events.click();assert.equal(orNodes().find(n=>n.tag==='table').children.filter(n=>n.tag==='tbody').length,1);
 assert.equal(orNodes().some(n=>n.className==='group-sort-controls'),false);
 orNodes().find(n=>n.textContent==='All').events.click();assert.equal(orNodes().find(n=>n.tag==='table').children.filter(n=>n.tag==='tbody').length,2);
 orNodes().find(n=>n.textContent==='Clear all').events.click();assert.ok(orRows.every(r=>!r.on));
 orNodes().find(n=>n.textContent==='Select all').events.click();assert.equal(orRows[0].on,true);assert.equal(orRows[1].on,false);assert.equal(orRows[2].on,true);
 orNodes().find(n=>n.textContent==='Clear all').events.click();assert.ok(orRows.every(r=>!r.on));
 orNodes().find(n=>n.textContent==='Free').events.click();orNodes().find(n=>n.textContent==='Select all').events.click();assert.equal(orRows[0].on,true);assert.equal(orRows[2].on,false);orNodes().find(n=>n.textContent==='Clear all').events.click();assert.ok(orRows.every(r=>!r.on));

});

test('OpenRouter follows Vercel and offers the shared grouping controls outside API providers',()=>{
 let panel;
 const vscode={ViewColumn:{Active:1},workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='provider'?'openrouter-api':fallback})},window:{createWebviewPanel:()=>panel={webview:{onDidReceiveMessage(){},postMessage(){}},onDidDispose(){}}}};
 require('../model-config').open(vscode,async()=>[],()=>'',()=>{},{});
 const script=panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
 const init=JSON.parse(script.match(/const INIT = (.*);/)[1]);
 const index=init.providers.findIndex(p=>p.id==='vercel-api');assert.equal(init.providers[index+1].id,'openrouter-api');assert.equal(init.providers.filter(p=>p.id==='openrouter-api').length,1);
 assert.match(script,/\["vercel-api", "openrouter-api"\]\.includes\(p.id\)/);
 assert.match(script,/\["vercel-api","openrouter-api"\]\.includes\(id\)&&s.grouped/);
});
