"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {request}=require('../frontend-analysis');
test('Calls uses Value Origin call enumeration for NEW receiver and nested assignment calls',async()=>{
 const texts={ZTEST:'REPORT ztest. START-OF-SELECTION. DATA(ls_result) = NEW zcl_calc_facade( )->run( iv_scenario = zcl_config=>scenario( ) ). WRITE ls_result.',
 ZCL_CALC_FACADE:'CLASS zcl_calc_facade DEFINITION. PUBLIC SECTION. METHODS run IMPORTING iv_scenario TYPE string RETURNING VALUE(result) TYPE i. METHODS deeper. ENDCLASS. CLASS zcl_calc_facade IMPLEMENTATION. METHOD run. DATA(value) = deeper( ). result = value. ENDMETHOD. METHOD deeper. ENDMETHOD. ENDCLASS.',
 ZCL_CONFIG:'CLASS zcl_config DEFINITION. PUBLIC SECTION. CLASS-METHODS scenario RETURNING VALUE(result) TYPE string. ENDCLASS. CLASS zcl_config IMPLEMENTATION. METHOD scenario. ENDMETHOD. ENDCLASS.'};
 const reads=[];
 const api={analysisReader:()=>async({object_name,object_type})=>{reads.push(object_name);return {object_name,object_type,source_url:object_name,source:texts[object_name],includes:[]};}};
 const base='/sap/bc/adt/vertex/flow/ZTEST?mode=calls&type=PROG&all=X&depth=';
 const shallow=await request(api,base+'2');
 assert.doesNotMatch(shallow.mermaid,/depth limit|->CONSTRUCTOR/);assert.match(shallow.mermaid,/ZCL_CALC_FACADE->RUN/);assert.match(shallow.mermaid,/ZCL_CONFIG->SCENARIO/);assert.deepEqual(reads,['ZTEST']);
 const deeper=await request(api,base+'4');
 assert.doesNotMatch(deeper.mermaid,/depth limit|->CONSTRUCTOR/);assert.match(deeper.mermaid,/ZCL_CALC_FACADE->DEEPER/);assert.deepEqual(reads,['ZTEST','ZCL_CALC_FACADE','ZCL_CONFIG']);
});
test('constructor expression types are not methods; NEW names the constructor',()=>{
 const {callsIn}=require('../value-origin-model'),{tokenize}=require('../value-origin-tokens');
 const result=callsIn(tokenize("DATA(x) = COND char12( WHEN flag = abap_true THEN zcl_config=>scenario( ) ELSE 'X' ). DATA(lo) = NEW zcl_log( )."));
 assert.deepEqual(result.map(c=>[c.owner,c.method]),[['ZCL_CONFIG','SCENARIO'],['ZCL_LOG','CONSTRUCTOR']]);
 for(const expression of ['CONV string( zcl_config=>scenario( ) )','CAST zif_config( zcl_config=>create( ) )','VALUE zif_config=>ty_config( )'])assert.ok(!callsIn(tokenize(expression)).some(c=>['STRING','ZIF_CONFIG','TY_CONFIG'].includes(c.method)));
});
