"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),config=require('../model-config');
function host(modelConfig,onUpdate=()=>{}){
 const store={modelConfig};
 return {ConfigurationTarget:{Global:1},store,workspace:{getConfiguration:()=>({
  get:(key,fallback)=>Object.hasOwn(store,key)?store[key]:fallback,
  update:async(key,value,where)=>{store[key]=value;onUpdate(where);}})}};
}
test('A successful re-check clears the stored unavailable mark, so an old failed probe cannot hide a model forever',async()=>{
 let target=null;
 const vscode=host({'gemini-api':{enabled:['models/gemini-3.6-flash'],unavailable:{
  'models/gemini-decision-1':{reason:'Gemini API returned 404',source:'probe'},
  'models/gemini-embedding-001':{reason:'Gemini API returned 404',source:'probe'}}}},where=>target=where);
 assert.equal(await config.clearUnavailable(vscode,'gemini-api','models/gemini-decision-1'),true);
 const own=vscode.store.modelConfig['gemini-api'];
 assert.equal(Object.hasOwn(own.unavailable,'models/gemini-decision-1'),false,'the re-checked model is no longer marked');
 assert.equal(Object.hasOwn(own.unavailable,'models/gemini-embedding-001'),true,'other marks are untouched');
 assert.deepEqual(own.enabled,['models/gemini-3.6-flash'],'clearing a mark never switches a model on by itself');
 assert.equal(target,1,'the mark is stored globally, so it is cleared globally');
});
test('Clearing an unmarked model writes nothing',async()=>{
 let wrote=false;
 const vscode=host({'gemini-api':{enabled:[],unavailable:{}}},()=>wrote=true);
 assert.equal(await config.clearUnavailable(vscode,'gemini-api','models/gemini-decision-1'),false);
 assert.equal(await config.clearUnavailable(vscode,'missing-provider','any'),false);
 assert.equal(wrote,false);
});
test('A model marked unavailable is withheld from every offered list until the mark goes',()=>{
 const marked={enabled:['models/gemini-decision-1'],known:['models/gemini-decision-1'],
  unavailable:{'models/gemini-decision-1':{reason:'Gemini API returned 404',source:'probe'}}};
 const list=[{id:'models/gemini-decision-1',label:'Gemini Decision 1',modelKind:'decision'}];
 assert.equal(config.rows(list,marked,'gemini-api')[0].available,false);
 assert.throws(()=>config.apply(host({'gemini-api':marked}),'gemini-api',list,true),/switched on/);
 const cleared={...marked,unavailable:{}};
 assert.equal(config.rows(list,cleared,'gemini-api')[0].available,undefined);
 assert.deepEqual(config.apply(host({'gemini-api':cleared}),'gemini-api',list,true).map(m=>m.id),['models/gemini-decision-1']);
});
