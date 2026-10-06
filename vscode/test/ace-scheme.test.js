"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {parseSource}=require('../value-origin-linter'),{buildIndex}=require('../value-origin-model'),{scheme}=require('../ace-scheme');
function draw(body,expand=''){
 const text=['CLASS zcl_test DEFINITION.','PUBLIC SECTION.','METHODS run.','ENDCLASS.','CLASS zcl_test IMPLEMENTATION.','METHOD run.',...body,'ENDMETHOD.','ENDCLASS.'].join('\n');
 const source=parseSource({id:'test',name:'ZCL_TEST',objectName:'ZCL_TEST',objectType:'CLAS',text}).source;
 const p=buildIndex([source]).procedures.find(p=>p.name==='RUN');return scheme(p,expand).mermaid;
}
test('scheme preserves ACE method shape, CHECK sequencing and call styling',()=>{
 const mm=draw(['CHECK x IS BOUND.','result = x->get_schema( ).']);
 assert.match(mm,/n1\[\["ZCL_TEST.RUN"\]\]/);assert.match(mm,/n1 --> p2\np2 --> p3/);assert.match(mm,/class p3 callnode/);assert.doesNotMatch(mm,/&gt;|Structured syntax/);
});
test('IF and ELSEIF branches fan out and join before following work',()=>{
 const mm=draw(['IF x = 1.','a = 1.','ELSEIF x = 2.','a = 2.','ELSE.','a = 3.','ENDIF.','WRITE a.']);
 assert.match(mm,/n2\{"IF/);assert.match(mm,/n4\{"ELSEIF/);assert.match(mm,/n2 -->\|"false"\| n4/);assert.match(mm,/n4 -->\|"false"\| p7/);
 assert.equal((mm.match(/--> j8/g)||[]).length,3);assert.match(mm,/j8 --> p9/);
});
test('CASE WHEN paths join on ENDCASE',()=>{
 const mm=draw(['CASE x.','WHEN 1.','a = 1.','WHEN OTHERS.','a = 2.','ENDCASE.']);
 assert.match(mm,/n2\{"CASE/);assert.match(mm,/n2 -->\|"WHEN 1\."/);assert.match(mm,/n2 -->\|"WHEN OTHERS\."/);assert.equal((mm.match(/--> j7/g)||[]).length,2);
});
test('plain loop folds and expands through existing aceexp action',()=>{
 const body=['DO 3 TIMES.','a = 1.','a = 2.','ENDDO.'];
 const folded=draw(body),open=draw(body,'7');assert.match(folded,/n2\[\/"DO/);assert.match(folded,/aceexp_7/);assert.match(open,/subgraph g2/);assert.match(open,/p3 --> p4/);assert.match(open,/click p3 "sapevent:aceexp_7/);
});
test('nested loop structure uses a frame; trailing work remains outside it',()=>{
 const mm=draw(['LOOP AT tab INTO row.','IF row = 1.','WRITE row.','ENDIF.','ENDLOOP.','WRITE x.']);
 assert.match(mm,/subgraph g2/);assert.match(mm,/end\np7/);assert.match(mm,/j5 --> p7/);
});
test('TRY CATCH does not capture the enclosing IF branch owner',()=>{
 const mm=draw(['IF x = 1.','TRY.','a = 1.','CATCH cx_root.','a = 2.','ENDTRY.','ELSE.','a = 3.','ENDIF.']);
 assert.match(mm,/class g3 tryblk/);assert.match(mm,/n5\("CATCH/);assert.match(mm,/n2 -->\|"false"\| p9/);assert.equal((mm.match(/--> j10/g)||[]).length,2);
});
test('operations fold, expand and preserve side effects',()=>{
 const body=['DATA a TYPE i.','a = 1.','a = 2.','SELECT SINGLE field FROM tab INTO a.','a = 3.','a = 4.'];
 const mm=draw(body),open=draw(body,'all');assert.doesNotMatch(mm,/DATA a/);assert.equal((mm.match(/2 operations/g)||[]).length,2);assert.match(mm,/class p5 dbnode/);assert.doesNotMatch(open,/operations/);assert.match(open,/a = 4/);
});
test('same-line statements keep separate nodes and balanced branch joins',()=>{
 const mm=draw(['IF x = 1. a = 1. ELSE. a = 2. ENDIF. WRITE a.']);assert.match(mm,/p3\("a = 1/);assert.match(mm,/p5\("a = 2/);assert.match(mm,/j6 --> p7/);
});
test('empty method draws only its method node',()=>{
 const mm=draw([]);assert.match(mm,/n1\[\[/);assert.doesNotMatch(mm,/operations| --> /);
});

test('nested IF false paths join their own ENDIF',()=>{
 const mm=draw(['IF x = 1.','IF y = 2.','a = 1.','ENDIF.','WRITE a.','ENDIF.','WRITE x.']);
 assert.match(mm,/n2 -->\|"true"\| n3/);
 assert.match(mm,/n3 -->\|"false"\| j5/);
 assert.match(mm,/n2 -->\|"false"\| j7/);
 assert.match(mm,/j5 --> p6/);assert.match(mm,/j7 --> p8/);
 assert.doesNotMatch(mm,/n3 -->\|"false"\| j7/);
});
