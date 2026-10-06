"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {parseSource}=require('../value-origin-linter'),model=require('../value-origin-model'),calls=require('../call-graph');
function fixture(){
 return [
  ['ZTEST','PROG','REPORT ztest. START-OF-SELECTION. DATA(lo) = NEW zcl_impl( ). DATA(result) = lo->run( ). WRITE result.'],
  ['ZCL_IMPL','CLAS','CLASS zcl_impl DEFINITION. PUBLIC SECTION. METHODS run RETURNING VALUE(result) TYPE i. METHODS deeper. ENDCLASS. CLASS zcl_impl IMPLEMENTATION. METHOD run. deeper( ). ENDMETHOD. METHOD deeper. ENDMETHOD. ENDCLASS.']
 ].map(([name,type,text])=>parseSource({id:name,name,objectName:name,objectType:type,text}).source);
}
test('shared call resolution is identical to Value Origin callSites for inferred receivers',()=>{
 const sources=fixture(),index=model.buildIndex(sources),graph=model.analyze(sources,{source:'ZTEST',line:1,variable:'RESULT'});
 const shared=calls.create(index),targets=[];
 for(const p of index.procedures)for(const s of p.body)for(const record of shared.calls(p,s))for(const q of record.targets)targets.push(q.owner+'->'+q.name);
 const origin=graph.callSites.flatMap(s=>s.callees.map(q=>q.owner+'->'+q.name));
 assert.deepEqual(targets,origin);assert.ok(targets.includes('ZCL_IMPL->RUN'));assert.ok(targets.includes('ZCL_IMPL->DEEPER'));
});
test('shared walker observes depth and entry breakpoint range before visiting bodies',async()=>{
 const index=model.buildIndex(fixture()),shared=calls.create(index),entry=index.procedures.filter(p=>p.source.objectName==='ZTEST'),visited=[];
 await calls.walk(entry,{maxDepth:2,calls:(p,s)=>shared.calls(p,s),onStatement:p=>visited.push(p.name)});
 assert.ok(visited.length>0);assert.ok(visited.every(name=>name==='GLOBAL'));
 visited.length=0;
 await calls.walk(entry,{maxDepth:4,range:{from:2,to:3},calls:(p,s)=>shared.calls(p,s),onStatement:p=>visited.push(p.name)});
 assert.equal(visited.length,0,'range does not include the one-line fixture');
});
