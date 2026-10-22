"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {parseSource}=require('../value-origin-linter'),{buildIndex}=require('../value-origin-model'),{scheme}=require('../ace-scheme');
function draw(body,expand='',logicOnly=false){
 const text=['CLASS zcl_test DEFINITION.','PUBLIC SECTION.','METHODS run.','ENDCLASS.','CLASS zcl_test IMPLEMENTATION.','METHOD run.',...body,'ENDMETHOD.','ENDCLASS.'].join('\n');
 const source=parseSource({id:'test',name:'ZCL_TEST',objectName:'ZCL_TEST',objectType:'CLAS',text}).source;
 const p=buildIndex([source]).procedures.find(p=>p.name==='RUN');return scheme(p,expand,logicOnly).mermaid;
}
test('scheme preserves ACE method shape, CHECK sequencing and call styling',()=>{
 const mm=draw(['CHECK x IS BOUND.','result = x->get_schema( ).']);
 assert.match(mm,/n1\[\["ZCL_TEST=>RUN"\]\]/);assert.match(mm,/n1 --> p2\np2 --> p3/);assert.match(mm,/class p3 callnode/);assert.doesNotMatch(mm,/&gt;|Structured syntax/);
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
 // Only Logic folds: the loop stays a frame, its operations one block opened by the first line's number.
 const folded=draw(body,'',true),open=draw(body,'3',true);assert.match(folded,/subgraph g2/);assert.match(folded,/o3\("2 operations"\)/);assert.match(folded,/aceexp_3/);assert.match(open,/subgraph g2/);assert.match(open,/p3 --> p4/);assert.match(open,/click p3 "sapevent:aceexp_3/);
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
 const mm=draw(body,'',true),open=draw(body,'3,6',true);assert.doesNotMatch(mm,/DATA a/);assert.equal((mm.match(/2 operations/g)||[]).length,2);assert.match(mm,/class p5 dbnode/);assert.doesNotMatch(open,/operations/);assert.match(open,/a = 4/);
});
test('same-line statements keep separate nodes and balanced branch joins',()=>{
 const mm=draw(['IF x = 1. a = 1. ELSE. a = 2. ENDIF. WRITE a.']);assert.match(mm,/p3\("a = 1/);assert.match(mm,/p5\("a = 2/);assert.match(mm,/j6 --> p7/);
});
test('empty method draws only its method node and its end',()=>{
 const mm=draw([],'',true);assert.match(mm,/n1\[\[/);assert.doesNotMatch(mm,/operations/);assert.match(mm,/n1 --> n2\n/);assert.equal((mm.match(/ --> /g)||[]).length,1);
});

test('nested IF false paths join their own ENDIF',()=>{
 const mm=draw(['IF x = 1.','IF y = 2.','a = 1.','ENDIF.','WRITE a.','ENDIF.','WRITE x.']);
 assert.match(mm,/n2 -->\|"true"\| n3/);
 assert.match(mm,/n3 -->\|"false"\| j5/);
 assert.match(mm,/n2 -->\|"false"\| j7/);
 assert.match(mm,/j5 --> p6/);assert.match(mm,/j7 --> p8/);
 assert.doesNotMatch(mm,/n3 -->\|"false"\| j7/);
});
test('an IF with an early RETURN keeps a visible ENDIF before the next condition',()=>{
 const mm=draw(['IF x IS INITIAL.','MESSAGE e001(zx).','RETURN.','ELSE.','CALL METHOD zcl_x=>run( ).','ENDIF.','IF y IS NOT INITIAL.','WRITE y.','ENDIF.'],'',true);
 assert.match(mm,/j7\("ENDIF\."\)/);
 assert.match(mm,/p4 --> j7/);
 assert.match(mm,/p6 --> j7/);
 assert.match(mm,/j7 --> n8/);
 assert.doesNotMatch(mm,/~~~/);
});
test('labels keep the code as written: operators, => and field symbols; only " and | are replaced, < travels as U+E000',()=>{
 const mm=draw(['IF a <> zcl_x=>c AND b <= 3.','ASSIGN ls-f TO <fs>.','ENDIF.']);
 assert.match(mm,/IF a > zcl_x => c/);assert.match(mm,/ASSIGN ls-f TO fs>\./);assert.doesNotMatch(mm,/ NE |&lt;/);
 const page=require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../org.vertex.abap.ui/resources/metrics.html'),'utf8');
 assert.ok(page.includes('now = was.replace(/\\uE000/g, "<").replace(/&lt;/g, "<")'),'the Tools page puts the characters back after drawing');
});
test('a CATCH that returns leaves the TRY body going on after ENDTRY',()=>{
 const mm=draw(['TRY.','a = 1.','CATCH cx_root.','RETURN.','ENDTRY.','WRITE a.']);
 assert.match(mm,/n1 --> n4/,'the handler is entered from before the TRY, not after its body');
 assert.doesNotMatch(mm,/p3 --> n4/);
 assert.match(mm,/class p5 exitnode/,'RETURN ends its branch as an exit');assert.doesNotMatch(mm,/p5 -->/,'with no line on to ENDMETHOD');
 assert.match(mm,/p3 --> j6/);assert.match(mm,/j6 --> p7/,'the method goes on after ENDTRY');
});
test('LEAVE PROGRAM and an EXIT outside a loop end their branch; an EXIT in a loop does not',()=>{
 const mm=draw(['IF a = 1.','LEAVE PROGRAM.','ENDIF.','DO 2 TIMES.','EXIT.','ENDDO.','EXIT.']);
 assert.match(mm,/class p3 exitnode/);assert.match(mm,/class p8 exitnode/);assert.doesNotMatch(mm,/class p6 exitnode/);
});
test('Logic only folds the operations it leaves out into one block, opened by its first line',()=>{
 const text=['CLASS zcl_test DEFINITION.','PUBLIC SECTION.','METHODS run.','ENDCLASS.','CLASS zcl_test IMPLEMENTATION.','METHOD run.','a = 1.','b = 2.','x->go( ).','c = 3.','ENDMETHOD.','ENDCLASS.'].join('\n');
 const source=parseSource({id:'test',name:'ZCL_TEST',objectName:'ZCL_TEST',objectType:'CLAS',text}).source;
 const p=buildIndex([source]).procedures.find(p=>p.name==='RUN');
 const folded=scheme(p,'',true).mermaid,open=scheme(p,'2',true).mermaid;
 assert.match(folded,/o2\("2 operations"\)/);assert.match(folded,/class o2 foldnode/);assert.match(folded,/click o2 "sapevent:aceexp_2"/);
 // A single left-out operation is shown as itself, and leads to its line.
 assert.doesNotMatch(folded,/o5\(/);assert.match(folded,/p5\("c = 3\."\)/);assert.match(folded,/click p5 "sapevent:acego_\d+_\d+"/);assert.match(folded,/p4\(/);
 assert.match(open,/p2\("a = 1\."\)/);assert.match(open,/p3\("b = 2\."\)/);assert.match(open,/click p2 "sapevent:aceexp_2"/);assert.doesNotMatch(open,/o2\(/);
});

test('Logic depth: a block nested deeper keeps its opening and closing statement and hides what is inside until opened', () => {
  const text = ['REPORT z.', 'FORM f.', '  IF a = 1.', '    IF b = 1.', '      IF c = 1.', '        IF d = 1.', '          x = 1.', '          y = 2.',
    '        ENDIF.', '      ENDIF.', '    ENDIF.', '  ENDIF.', 'ENDFORM.'].join('\n');
  const source = parseSource({ id: 'z', name: 'Z', objectName: 'Z', objectType: 'PROG', text }).source;
  const st = source.aceStatements, p = { source, start: st[1].offset, end: st.at(-1).offset, unitType: 'FORM', name: 'F', line: 2 };
  const folded = scheme(p, '', false, 3).mermaid;
  assert.match(folded, /p5\("IF d = 1\."\)/);
  assert.match(folded, /p6\("\(2 operations hidden\)"\)/);
  assert.match(folded, /p8\("ENDIF\."\)/);
  assert.match(folded, /class p6 foldnode/);
  assert.match(folded, /click p6 "sapevent:aceexp_5"/);
  assert.doesNotMatch(folded, /x = 1/);
  const opened = scheme(p, '5', false, 3).mermaid;
  assert.match(opened, /x = 1/);
  assert.doesNotMatch(opened, /hidden/);
  assert.match(scheme(p, '', false, 0).mermaid, /x = 1/);
});

test('Logic Code view: the lines as written, a deeper block folded between its opening and closing lines', () => {
  const { codeView } = require('../ace-scheme');
  const text = ['REPORT z.', 'FORM f.', '  IF a = 1.', '    IF b = 1.', '      IF c = 1.', '        IF d = 1.', '          x = 1.', '          " note',
    '          y = 2.', '        ENDIF.', '      ENDIF.', '    ENDIF.', '  ENDIF.', 'ENDFORM.'].join('\n');
  const source = parseSource({ id: 'z', name: 'Z', objectName: 'Z', objectType: 'PROG', text }).source;
  const st = source.aceStatements, p = { source, start: st[1].offset, end: st.at(-1).offset, unitType: 'FORM', name: 'F', line: 2 };
  const items = codeView(p, '', 3);
  assert.deepEqual(items.map(i => i.fold ? 'fold ' + i.fold + ':' + i.count : i.line),
    [2, 3, 4, 5, 6, 'fold 5:2', 10, 11, 12, 13, 14]);
  assert.equal(items[1].text, '  IF a = 1.');
  assert.deepEqual(codeView(p, '5', 3).map(i => i.line), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});
