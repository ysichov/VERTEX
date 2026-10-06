"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {request,invalidate}=require('../frontend-analysis');

test('Calls retains ACE names, rounded shapes and type colours without HTML entities or synthetic root',async()=>{
 const texts={ZTEST:'REPORT ztest. START-OF-SELECTION. PERFORM first. FORM first. zcl_a=>run( ). ENDFORM.',ZCL_A:'CLASS zcl_a DEFINITION. PUBLIC SECTION. CLASS-METHODS run. ENDCLASS. CLASS zcl_a IMPLEMENTATION. METHOD run. WRITE 1. ENDMETHOD. ENDCLASS.'};
 const api={analysisReader:()=>async({object_name,object_type})=>({object_name,object_type,source_url:object_name,source:texts[object_name],includes:[]})};
 const {mermaid}=await request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=4&all=X');
 assert.match(mermaid,/\("ZTEST:START-OF-SELECTION"\):::[ ]?event/);
 assert.match(mermaid,/\("FORM FIRST"\):::form/);
 assert.match(mermaid,/\("ZCL_A->RUN"\):::method/);
 assert.ok(!mermaid.includes('&gt;')&&!mermaid.includes('&amp;'));
 assert.ok(!mermaid.includes('("ZTEST")')&&!mermaid.includes('|"EVENT"|'));
 for(const entry of ['event fill:#FFE0B2,stroke:#E65100','method fill:#BBDEFB,stroke:#1565C0','form fill:#EEEEEE,stroke:#616161','constr fill:#E1BEE7,stroke:#6A1B9A','enh fill:#FCE4EC,stroke:#AD1457','func fill:#C8E6C9,stroke:#2E7D32'])assert.ok(mermaid.includes('classDef '+entry));
});
test('FORM to function adds one level and does not read a boundary function',async()=>{
 const counts={};
 const api={analysisReader:()=>async({object_name,object_type})=>{counts[object_name]=(counts[object_name]||0)+1;return {object_name,object_type,source_url:object_name,source:object_name==='ZTEST'?"REPORT ztest. START-OF-SELECTION. PERFORM first. FORM first. CALL FUNCTION 'ZFUNC'. ENDFORM.":'FUNCTION zfunc. WRITE 1. ENDFUNCTION.',includes:[]};}};
 const base='/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&all=X&depth=';
 const two=await request(api,base+'2'),three=await request(api,base+'3');
 assert.ok(!two.mermaid.includes('ZFUNC'));assert.match(three.mermaid,/ZFUNC/);assert.deepEqual(counts,{ZTEST:1});
 await request(api,base+'4');assert.deepEqual(counts,{ZTEST:1,ZFUNC:1});
});
test('event to FORM to FORM increments depth inside the same source',async()=>{
 const api={analysisReader:()=>async()=>({object_name:'ZTEST',object_type:'PROG',source_url:'test',source:'REPORT ztest. START-OF-SELECTION. PERFORM first. FORM first. PERFORM second. ENDFORM. FORM second. WRITE 1. ENDFORM.',includes:[]})};
 const base='/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&all=X&depth=';
 const one=await request(api,base+'1'),two=await request(api,base+'2'),three=await request(api,base+'3');
 assert.match(one.mermaid,/START-OF-SELECTION/);assert.ok(!one.mermaid.includes('FIRST'));
 assert.match(two.mermaid,/FIRST/);assert.ok(!two.mermaid.includes('SECOND'));
 assert.match(three.mermaid,/SECOND/);
});
test('Calls does not traverse an unused report FORM or its foreign calls',async()=>{
 let reads=0;
 const api={analysisReader:()=>async()=>{reads++;return {object_name:'ZTEST',object_type:'PROG',source_url:'test',source:'REPORT ztest. START-OF-SELECTION. WRITE 1. FORM unused. zcl_unused=>run( ). ENDFORM.',includes:[]};}};
 const result=await request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=2&all=X');
 assert.equal(reads,1);assert.ok(!result.mermaid.includes('ZCL_UNUSED'));assert.ok(!result.mermaid.includes('UNUSED'));
});
test('Calls queue cancels the active traversal and retains only the newest pending Calls',()=>{
 const vm=require('node:vm'),text=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/tools.html'),'utf8');
 const start=text.indexOf('function enqueue('),end=text.indexOf('function sdeWorkspaceProgress',start);
 let cancellations=0;
 const active={request:{path:'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&depth=99'}};
 const context=vm.createContext({queue:[{request:{path:'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&depth=3'}}],activeRequest:active,sdeCancelWorkspace:()=>cancellations++,pump:()=>{}});
 vm.runInContext(text.slice(start,end),context);
 vm.runInContext("enqueue({path:'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&depth=1'},()=>{},()=>true)",context);
 assert.equal(cancellations,1);assert.equal(active.superseded,true);assert.equal(context.queue.length,1);assert.match(context.queue[0].request.path,/depth=1/);
});
test('superseded analysis exits without waiting for its current ADT read',async()=>{
 let stopped=false;const started=Date.now();
 const api={analysisReader:()=>async()=>{await new Promise(ok=>setTimeout(ok,800));return {object_name:'ZTEST',object_type:'PROG',source_url:'test',source:'REPORT ztest. WRITE 1.',includes:[]};}};
 const pending=request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=99',undefined,()=>stopped);
 setTimeout(()=>{stopped=true;},60);
 await assert.rejects(pending,/Analysis cancelled/);assert.ok(Date.now()-started<700,'does not wait for the 800 ms read');
});
test('increasing Calls depth reuses parsed objects and reads only the next level',async()=>{
 const counts={},messages=[];
 const texts={ZTEST:'REPORT ztest. START-OF-SELECTION. zcl_a=>run( ).',
 ZCL_A:'CLASS zcl_a DEFINITION. PUBLIC SECTION. CLASS-METHODS run. ENDCLASS. CLASS zcl_a IMPLEMENTATION. METHOD run. zcl_b=>run( ). ENDMETHOD. ENDCLASS.',
 ZCL_B:'CLASS zcl_b DEFINITION. PUBLIC SECTION. CLASS-METHODS run. ENDCLASS. CLASS zcl_b IMPLEMENTATION. METHOD run. WRITE 1. ENDMETHOD. ENDCLASS.'};
 const api={analysisReader:()=>async({object_name,object_type})=>{
  counts[object_name]=(counts[object_name]||0)+1;
  return {object_name,object_type,source_url:object_name,source:texts[object_name],includes:[]};
 }};
 const one=await request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=1');
 assert.deepEqual(counts,{ZTEST:1},'level 1 event is not walked');
 assert.ok(!one.mermaid.includes('ZCL_A'),'event entry consumes level 1');
 const two=await request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=2',text=>messages.push(text));
 assert.deepEqual(counts,{ZTEST:1},'level 2 callee is a leaf, not read or walked');
 assert.ok(messages.some(m=>/^Reusing ZTEST/.test(m)));
 assert.ok(!messages.some(m=>/^Parsing ZTEST/.test(m)));
 assert.ok(two.mermaid.includes('ZCL_A'));assert.ok(!two.mermaid.includes('ZCL_B'));
 const three=await request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=3&all=X');
 assert.deepEqual(counts,{ZTEST:1,ZCL_A:1});assert.ok(three.mermaid.includes('ZCL_B'));
 const shallow=await request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=1&all=X');
 assert.equal(shallow.depth,1);assert.ok(!shallow.mermaid.includes('ZCL_B'),'cached deeper objects do not escape the displayed depth');
 assert.ok(!shallow.mermaid.includes('ZCL_A'));
 assert.match(shallow.mermaid,/\("ZTEST:START-OF-SELECTION"\):::event/,'ACE starts directly at the event');
 assert.ok(!shallow.mermaid.includes('-->'),'depth 1 has no entered calls or synthetic root edge');
 await request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&depth=2');
 assert.deepEqual(counts,{ZTEST:1,ZCL_A:1});
 invalidate(api);await request(api,'/sap/bc/adt/vertex/metrics/ZTEST?type=PROG');
 assert.equal(counts.ZTEST,2);
});
test('source cache is isolated per repository and shares concurrent reads',async()=>{
 let reads=0;
 const make=()=>({analysisReader:()=>async()=>{reads++;await new Promise(ok=>setTimeout(ok,30));return {object_name:'ZTEST',object_type:'PROG',source_url:'test',source:'REPORT ztest. WRITE 1.',includes:[]};}});
 const a=make(),b=make(),url='/sap/bc/adt/vertex/metrics/ZTEST?type=PROG';
 await Promise.all([request(a,url),request(a,url)]);assert.equal(reads,1);
 await request(b,url);assert.equal(reads,2);
});
test('orientation redraws cached Mermaid without requesting another analysis',()=>{
 const vm=require('node:vm');
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/metrics.html'),'utf8');
 const start=page.indexOf('function setDirection(value)'),end=page.indexOf('/* The library arrives',start);
 let draws=0,requests=0;const button={getAttribute:()=> 'LR',className:''};
 const context=vm.createContext({direction:'TB',lastMermaid:'flowchart LR\na --> b',document:{querySelectorAll:()=>[button]},draw:()=>draws++,requestDiagram:()=>requests++});
 vm.runInContext(page.slice(start,end),context);vm.runInContext("setDirection('LR')",context);
 assert.equal(draws,1);assert.equal(requests,0);assert.equal(button.className,'on');
});
test('local analysis reports progress during a slow ADT read and then parsing/building',async()=>{
 const messages=[];
 const api={analysisReader:()=>async()=>{
   await new Promise(ok=>setTimeout(ok,2100));
   return {object_name:'ZTEST',object_type:'PROG',source_url:'test',source:'REPORT ztest. START-OF-SELECTION. WRITE 1.',includes:[]};
 }};
 const result=await request(api,'/sap/bc/adt/vertex/metrics/ZTEST?type=PROG',text=>messages.push(text));
 assert.ok(messages.some(m=>/Reading ZTEST.*2 s/.test(m)),messages.join('\n'));
 assert.ok(messages.some(m=>/^Parsing ZTEST/.test(m)));
 assert.ok(messages.some(m=>/^Building metrics analysis/.test(m)));
 assert.equal(result.units[0].unit_name,'START-OF-SELECTION');
});
test('warning details are collapsed and progress follows the active request',()=>{
 const metrics=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/metrics.html'),'utf8');
 assert.match(metrics,/createElement\('details'\)/);assert.match(metrics,/max-height:180px/);
 assert.doesNotMatch(metrics,/engineNote\.textContent = .*warnings\.join/);
 const tools=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/tools.html'),'utf8');
 assert.match(tools,/item\.request\.path===path&&item\.live\(\)&&item\.progress/);
});
