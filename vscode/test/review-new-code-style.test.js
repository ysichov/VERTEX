"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const page=require("./tools-page").toolsPage("versions.html");

class Element {
  constructor(tag){this.tag=tag;this.children=[];this.className="";this.style={};}
  appendChild(child){this.children.push(child);return child;}
  addEventListener(){}
}
const context=vm.createContext({document:{createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},compact:false,blameMark(){}});
vm.runInContext(page.slice(page.indexOf('function tokens('),page.indexOf('/* Where a block\'s row')),context);
vm.runInContext(page.slice(page.indexOf("function diffTable("),page.indexOf("/* The Blame switch",page.indexOf("function diffTable("))),context);

test("new review code keeps its text but has no green line fill or plus markers",()=>{
  const ops=[{op:"+",text:"METHOD new_method."},{op:"+",text:"ENDMETHOD."}];
  const neutral=context.diffTable(ops,null,0,null,true).children[0].children;
  assert.deepEqual(neutral.map(row=>row.className),["",""]);
  assert.deepEqual(neutral.map(row=>row.children[2].textContent),["METHOD new_method.","ENDMETHOD."]);
  assert.deepEqual(neutral.map(row=>row.children[1].textContent),[" "," "]);
  const changed=context.diffTable(ops,null,0,null,false).children[0].children;
  assert.deepEqual(changed.map(row=>row.className),["ins","ins"]);
  const side=context.sideTable(ops,true,null,true).children.at(-1).children;
  assert.ok(side.every(row=>row.children.every(cell=>!cell.className.includes("ins"))));
});

test("VERTEX aligns a commented block without skipping repeated assignments",()=>{
  // Greedy pairing takes the later exact line and loses the following two correspondences.
  const old=['  ls_final-prop_rem_allow = <lfs_proposed>-current_bal.',
    '* ls_final-prop_rem_allow = <lfs_proposed>-proposed_bal.', 'ELSE.'];
  const next=['*'+old[0], '*'+old[1], '*'+old[2], old[0]];
  const ops=old.map(text=>({op:'-',text})).concat(next.map(text=>({op:'+',text})));
  const original=JSON.stringify(ops);
  context.vertexDiff=true;
  assert.equal(JSON.stringify(context.pairAll(ops)),JSON.stringify({3:0,4:1,5:2}));
  const rows=context.diffTable(ops).children[0].children;
  assert.deepEqual(rows.map(row=>row.className),['mod','mod','mod','ins']);
  assert.deepEqual(rows.map(row=>row.children[0].textContent),['1','2','3','4']);
  assert.deepEqual(rows.slice(0,3).map(row=>row.children[2].children.find(x=>x.className==='wins').textContent),['*','*','*']);
  const side=context.sideTable(ops,true).children.at(-1).children;
  assert.equal(side.length,4);
  context.vertexDiff=false;
  assert.equal(JSON.stringify(context.pairAll(ops)),JSON.stringify({6:0}));
  assert.equal(JSON.stringify(ops),original,'rendering must not rewrite saved operations');
});

test("VERTEX handles uncommenting, insertions, deletions and unrelated lines",()=>{
  context.vertexDiff=true;
  const ops=[{op:'-',text:'*IF x.'},{op:'-',text:'** old comment'},
    {op:'+',text:'new completely unrelated statement'}, {op:'+',text:'IF x.'},{op:'+',text:'* old comment'}];
  assert.equal(JSON.stringify(context.pairAll(ops)),JSON.stringify({3:0,4:1}));
  assert.equal(JSON.stringify(context.pairAll([{op:'-',text:'removed'}])), '{}');
  assert.equal(JSON.stringify(context.pairAll([{op:'+',text:'added'}])), '{}');
});

// Repeated allowance branches, inline annotations, blanks and already-commented assignments.
// This is a synthetic analogue of the reported SAP block, not source recovered from a screenshot.
function allowanceBlock(size) {
  const branch=[
    '  READ TABLE lt_proposed ASSIGNING <lfs_proposed> WITH KEY',
    '                                      wage_code = lc_1007.',
    '  IF sy-subrc EQ 0.',
    '    ls_final-cur_rem_allow = <lfs_proposed>-current_bal.',
    '    ls_final-prop_rem_allow = <lfs_proposed>-current_bal. "added by safiq on 27.11.2023',
    '*   ls_final-prop_rem_allow = <lfs_proposed>-proposed_bal. "commented by safiq on 27.11.2023',
    '  ELSE.', '', '  ENDIF.'
  ];
  return Array.from({length:size},(_,i)=>branch[i%branch.length]);
}
function operations(old,next) {
  return old.map(text=>({op:'-',text,who:'REVIEWER'})).concat(next.map(text=>({op:'+',text,who:'REVIEWER'})));
}
function textOf(node) {
  return node.children?.length ? node.children.map(textOf).join('') : node.textContent || '';
}

test('VERTEX renders all 68 allowance lines in order, with only the added comment marker highlighted',()=>{
  context.vertexDiff=true;
  const old=allowanceBlock(68),next=old.map(text=>'*'+text),ops=operations(old,next);
  const original=JSON.stringify(ops);
  const expected=Object.fromEntries(old.map((_,i)=>[68+i,i]));
  assert.equal(JSON.stringify(context.pairAll(ops)),JSON.stringify(expected));
  const rows=context.diffTable(ops,null,2467).children[0].children;
  assert.equal(rows.length,68);
  rows.forEach((row,i)=>{
    assert.equal(row.className,'mod');
    assert.equal(row.children[0].textContent,String(2468+i));
    assert.equal(textOf(row.children[2]),next[i]);
    assert.deepEqual(row.children[2].children.filter(x=>x.className==='wins').map(textOf),['*']);
    assert.ok(!row.children[2].children.some(x=>x.className==='wdel'));
  });
  for (const swap of [false,true]) {
    const side=context.sideTable(ops,swap).children.at(-1).children;
    assert.equal(side.length,68);
    side.forEach((row,i)=>{
      assert.equal(textOf(row.children[1]),swap?next[i]:old[i]);
      assert.equal(textOf(row.children[3]),swap?old[i]:next[i]);
    });
  }
  assert.equal(JSON.stringify(ops),original);
  assert.equal(JSON.stringify(context.pairAll(operations(next,old))),JSON.stringify(expected));
});

test('VERTEX aligns 68 and 256 repeated lines around an insertion without the old 4096 fallback',()=>{
  context.vertexDiff=true;
  for (const size of [68,256]) {
    const old=allowanceBlock(size),next=old.map(text=>'*'+text);
    next.splice(20,0,'WRITE / z_unique_diagnostic_message.');
    next.push(old[0]); // The greedy algorithm would jump to this exact duplicate.
    const ops=operations(old,next),expected=Object.fromEntries(old.map((_,i)=>[size+i+(i>=20?1:0),i]));
    assert.equal(JSON.stringify(context.pairAll(ops)),JSON.stringify(expected));
    const rows=context.diffTable(ops).children[0].children;
    assert.equal(rows.length,size+2);
    assert.deepEqual(rows.map(row=>row.className),next.map((_,i)=>i===20||i===next.length-1?'ins':'mod'));
    const reverseExpected=Object.fromEntries(old.map((_,i)=>[next.length+i,i+(i>=20?1:0)]));
    assert.equal(JSON.stringify(context.pairAll(operations(next,old))),JSON.stringify(reverseExpected));
  }
});

test('VERTEX bounds huge mixed rewrites without invoking greedy pairing; huge comment blocks still align',()=>{
  context.vertexDiff=true;
  const old=allowanceBlock(1000),next=old.map(text=>'*'+text);
  assert.equal(Object.keys(context.pairAll(operations(old,next))).length,1000);
  const standard=context.standardPairRun;
  context.standardPairRun=()=>{throw new Error('VERTEX must not silently use Standard');};
  try {
    next.splice(20,0,'WRITE / z_unique_diagnostic_message.');
    assert.equal(JSON.stringify(context.pairAll(operations(old,next))),'{}');
  } finally { context.standardPairRun=standard; }
});
