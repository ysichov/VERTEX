"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {request}=require('../frontend-analysis');
test('Parts method selection replaces constructor as the Calls start',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/metrics.html'),'utf8');
 let selected;
 const context=vm.createContext({mode:'calls',loadedObject:'ZTEST',shownUnit:null,setCallStart:start=>{selected=start;}});
 vm.runInContext(html.match(/function sdeSelectPart\(chosen\) \{[\s\S]*?(?=function markMetricRow)/)[0],context);
 context.sdeSelectPart({key:'SHOW',type:'METH',name:'show'});
 assert.equal(selected.name,'ZTEST=>SHOW');assert.equal(selected.type,'METHOD');
 const calls=[];Object.assign(context,{loadedType:'CLAS',callStart:null,units:[{unit_name:'ZTEST=>CONSTRUCTOR'}],mermaidLoaded:true,depth:2,allBlocks:true,status:()=>{},hint:()=>{},sdeFlow:(...args)=>calls.push(args)});
 vm.runInContext(html.match(/function requestDiagram\(\) \{[\s\S]*?\n\}/)[0],context);
 context.requestDiagram();assert.equal(calls[0][9],'ZTEST=>CONSTRUCTOR');
 context.callStart=selected;context.requestDiagram();assert.equal(calls[1][9],'ZTEST=>SHOW');
 context.callStart=null;context.units=[];context.requestDiagram();assert.equal(calls.length,2,'no constructor requires user selection, never all methods');
});
test('class Calls starts only at constructor, then at the explicitly selected method',async()=>{
 const text='CLASS ztest DEFINITION. PUBLIC SECTION. METHODS constructor. METHODS show. METHODS build. METHODS unused. ENDCLASS. CLASS ztest IMPLEMENTATION. METHOD constructor. build( ). ENDMETHOD. METHOD show. unused( ). ENDMETHOD. METHOD build. ENDMETHOD. METHOD unused. ENDMETHOD. ENDCLASS.';
 const api={analysisReader:()=>async()=>({object_name:'ZTEST',object_type:'CLAS',source_url:'test',source:text,includes:[]})};
 const base='/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=CLAS&all=X&depth=2';
 const first=await request(api,base);
 assert.match(first.mermaid,/ZTEST->CONSTRUCTOR/);assert.match(first.mermaid,/ZTEST->BUILD/);assert.ok(!first.mermaid.includes('ZTEST->SHOW')&&!first.mermaid.includes('ZTEST->UNUSED'));
 const selected=await request(api,base+'&start=ZTEST%3D%3ESHOW');
 assert.match(selected.mermaid,/ZTEST->SHOW/);assert.match(selected.mermaid,/ZTEST->UNUSED/);assert.ok(!selected.mermaid.includes('ZTEST->CONSTRUCTOR')&&!selected.mermaid.includes('ZTEST->BUILD'));
});
