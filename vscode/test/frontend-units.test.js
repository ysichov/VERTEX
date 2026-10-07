"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {parseSource}=require('../value-origin-linter'),{buildIndex}=require('../value-origin-model');
const {analysisUnits,metric}=require('../frontend-analysis');
test('empty routines remain ACE metrics units',async()=>{
 const api={analysisReader:()=>async()=>({object_name:'ZTEST',object_type:'CLAS',source_url:'test',source:'CLASS ztest DEFINITION. PUBLIC SECTION. METHODS run. ENDCLASS. CLASS ztest IMPLEMENTATION. METHOD run. ENDMETHOD. ENDCLASS.',includes:[]})};
 const result=await require('../frontend-analysis').request(api,'/sap/bc/adt/vertex/metrics/ZTEST?type=CLAS');
 assert.equal(result.units.length,1);assert.equal(result.units[0].lloc,2);assert.equal(result.units[0].cyclomatic,1);
});
test('ACE UML references come only from attributes and method declarations',()=>{
 const source=parseSource({id:'test',name:'ZTEST',objectType:'CLAS',text:'CLASS ztest DEFINITION. PUBLIC SECTION. TYPES ignored TYPE REF TO zcl_ignored. DATA other TYPE REF TO zcl_other. DATA self TYPE REF TO ztest. METHODS zebra. METHODS alpha. ENDCLASS.'}).source;
 const graph=require('../frontend-analysis').declarations([source]);
 assert.deepEqual(graph.nodes[0].methods.map(m=>m.name),['ALPHA','ZEBRA']);
 assert.deepEqual(graph.edges.map(e=>e.target),['ZCL_OTHER']);
});
function units(text,type='PROG'){
 const source=parseSource({id:'test',name:'ZTEST',objectName:'ZTEST',objectType:type,text}).source;
 return analysisUnits(buildIndex([source])).map(metric);
}

test('ACE metric boundaries include FORM header and closing statement',()=>{
 const row=units('REPORT ztest.\nFORM run.\nWRITE 1.\nENDFORM.')[0];
 assert.equal(row.line_from,2);
 assert.equal(row.line_to,4);
 assert.equal(row.loc,3);
 assert.equal(row.lloc,3);
 // FORM, WRITE and ENDFORM are grammar keywords, not class-name guesses.
 assert.ok(row.n1>=3);
});
test('report Parts retain named events and FORM types without synthetic GLOBAL',()=>{
 const rows=units('REPORT ztest. INITIALIZATION. WRITE 1. START-OF-SELECTION. PERFORM run. FORM run. WRITE 2. ENDFORM.');
 assert.deepEqual(rows.map(r=>[r.unit_type,r.unit_name]),[['EVENT','INITIALIZATION'],['EVENT','START-OF-SELECTION'],['FORM','RUN']]);
 assert.ok(rows.every(r=>r.unit_type!=='METHOD'&&r.unit_name!=='GLOBAL'));
});
test('implicit report processing is START-OF-SELECTION',()=>{
 assert.deepEqual(units('REPORT ztest. WRITE 1.').map(r=>[r.unit_type,r.unit_name]),[['EVENT','START-OF-SELECTION']]);
});
test('GET PARAMETER is an operation, not a logical database event',()=>{
 assert.deepEqual(units("REPORT ztest. GET PARAMETER ID 'X' FIELD x. WRITE x.").map(r=>r.unit_name),['START-OF-SELECTION']);
});
test('function and dialog module remain distinct kinds',()=>{
 assert.equal(units('FUNCTION ztest. WRITE 1. ENDFUNCTION.')[0].unit_type,'FUNCTION');
 assert.deepEqual(units('MODULE status OUTPUT. WRITE 1. ENDMODULE.').map(r=>[r.unit_type,r.unit_name]),[['MODULE','STATUS']]);
});
test('class methods remain qualified METHOD units',()=>{
 assert.deepEqual(units('CLASS ztest DEFINITION. PUBLIC SECTION. METHODS run. ENDCLASS. CLASS ztest IMPLEMENTATION. METHOD run. WRITE 1. ENDMETHOD. ENDCLASS.','CLAS').map(r=>[r.unit_type,r.unit_name]),[['METHOD','ZTEST=>RUN']]);
});
test('each element of a chain is placed on the line where SAP stops for it, not on the keyword line',async()=>{
 const api={analysisReader:()=>async()=>({object_name:'ZTEST',object_type:'PROG',source_url:'test',source:'REPORT ztest.\nSTART-OF-SELECTION.\n  WRITE: / sy-vline,\n    3 sy-uname,\n    14 sy-vline.\n  WRITE sy-datum.',includes:[]})};
 const result=await require('../frontend-analysis').request(api,'/sap/bc/adt/vertex/flow/ZTEST?mode=statements&type=PROG');
 assert.deepEqual(result.includes[0].statements.filter(s=>s.kw==='WRITE').map(s=>s.line),[3,4,5,6]);
});
