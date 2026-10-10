'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const page=fs.readFileSync(path.join(root,'vscode/pages/visual-debug.html'),'utf8');
const host=fs.readFileSync(path.join(__dirname,'visual-debug-host.js'),'utf8');

test('Eclipse packages the exact Visual Debug page, including history and player',()=>{
  assert.equal(fs.readFileSync(path.join(root,'org.vertex.abap.ui/assistant/visual-debug.html'),'utf8'),page);
  assert.equal(fs.readFileSync(path.join(root,'org.vertex.abap.ui/assistant/visual-debug-host.js'),'utf8'),host);
});

function bridge(){
  const requests=[],answers=[],events=[],reveals=[];
  const context={addEventListener(){},document:{addEventListener(){},getElementById(){return {hidden:true,replaceChildren(){},add(){}};}},
    Option:function(){},Promise,Map,Set,JSON,Array,String,Number,Error,console,
    sdeNativeDebug:(command,args,id)=>requests.push({command,args:JSON.parse(args),id}),
    sdeReady:()=>answers.push(context.sdeTake()),sdeDebugEvent:raw=>events.push(JSON.parse(raw)),
    sdeOpenToolSource:raw=>reveals.push(JSON.parse(raw)),sdeCopyText:()=>'',
    notice(){},series:null,vertexEclipseRead:async()=> 'REPORT zdemo.\nWRITE sy-subrc.',
    vertexEclipseDebugAnalysis:async()=>({reveal:{url:'/sap/bc/adt/programs/programs/zdemo/source/main',line:2}}),
    sdeOriginReady:raw=>answers.push(JSON.parse(raw)),sdeOriginProgress(){}};
  context.window=context;vm.runInNewContext(host,context);
  return {context,requests,answers,events,reveals};
}
test('native replies remain correlated when SAP answers channels in reverse order',async()=>{
  const b=bridge();const a=b.context.vertexDebugAsset('flow'),c=b.context.vertexDebugAsset('lens');
  b.context.vertexNativeReply(b.requests[1].id,'lens source',false);
  b.context.vertexNativeReply(b.requests[0].id,'flow source',false);
  assert.equal(await a,'flow source');assert.equal(await c,'lens source');
});
test('bridge reports native command failures through the shared page queue',async()=>{
  const b=bridge();b.context.sdeDebug('step',{kind:'into'});
  b.context.vertexNativeReply(b.requests[0].id,'Session ended',true);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(b.answers,['ERROR:Session ended']);
});
test('a native stop reaches shared recording without reopening the ADT editor',()=>{
  const b=bridge();const p={system:'ALC',ended:0,breakpoints:[],stopped:{at:'stop 1',frames:[{current:true,url:'/sap/bc/adt/oo/classes/zcl_calc/source/main',line:27}]}};
  b.context.vertexNativeEvent(JSON.stringify(p));
  assert.deepEqual(b.events,[p]);assert.deepEqual(b.reveals,[]);
});
test('explicit analysis source links still open an ADT editor',async()=>{
  const b=bridge();await b.context.sdeOrigin({id:7,open:{source:'source',line:2}});
  assert.equal(b.reveals[0].name,'ZDEMO');assert.equal(b.answers[0].id,7);
});
test('analysis worker parses real ABAP and returns debugger FLOW and declared variables',async()=>{
  const {bundle}=require('./frontend-bundle');const window={};vm.runInNewContext(bundle(root),{window,TextEncoder,TextDecoder,Uint8Array,URL,console,setTimeout,clearTimeout});
  const api={analysisReader:()=>async()=>({object_name:'ZDEMO',object_type:'PROG',source_url:'/sap/bc/adt/programs/programs/zdemo/source/main',source:'REPORT zdemo.\nDATA lv_result TYPE i.\nSTART-OF-SELECTION.\nlv_result = 1.\nWRITE lv_result.'})};
  const flow=await window.vertexDebugAnalysis.request(api,{object_name:'ZDEMO',object_type:'PROG',line:4,from:4});
  assert.ok(flow.flow.length);assert.ok(flow.read.nodes);assert.match(flow.analysisLog,/ADT \+ abaplint/);
  const variables=await window.vertexDebugAnalysis.request(api,{variables:{object_name:'ZDEMO',object_type:'PROG',globals:true}});
  assert.ok(variables.globals.some(v=>v.name.toUpperCase()==='LV_RESULT'));
});
