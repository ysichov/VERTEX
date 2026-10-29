"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/versions.html'),'utf8');
const code=page.slice(page.indexOf('function reviewAskContext('),page.indexOf("/* AVE's AI prompt"));
function run(all){let answer;const context=vm.createContext({objectName:()=> 'K1',review_part:{display_name:'RUN',obj_name:'ZCL_X RUN'},
 review_blocks:[{hunk_no:1,start_line:1,op_from:1,op_to:2},{hunk_no:2,start_line:3,op_from:4,op_to:5},{hunk_no:3,start_line:5,op_from:7,op_to:8}],
 review_ops:[{op:'-',text:'old one'},{op:'+',text:'new one'},{op:'=',text:'separator'},
 {op:'-',text:'old two'},{op:'+',text:'new two'},{op:'=',text:'separator'},
 {op:'-',text:'old three'},{op:'+',text:'new three'}],sdeReviewAsk:json=>answer=JSON.parse(json)});
 vm.runInContext(code,context);context.askReview(all?null:[context.review_blocks[0]]);return answer;}
test('Ask AI beside block 1 includes that block only, even when the diff contains three blocks',()=>{
 const answer=run(false);assert.equal(answer.all,false);assert.equal(answer.blocks.length,1);
 assert.deepEqual(answer.blocks[0].before,['old one']);assert.deepEqual(answer.blocks[0].after,['new one']);
 assert.doesNotMatch(JSON.stringify(answer.blocks),/old two|new two|old three|new three/);
});
test('Ask AI above the object includes all three blocks',()=>{const answer=run(true);assert.equal(answer.all,true);assert.deepEqual(answer.blocks.map(b=>b.block),[1,2,3]);assert.deepEqual(answer.blocks[1].after,['new two']);});

test('a block click replaces all-block scope and never merges across requests',()=>{
 const {mergeAsk}=require('../code-review');
 const all={system:'E19',request:'K1',object:'RUN',object_key:'ZCL_X RUN',all:true,total:3,blocks:[{block:1},{block:2},{block:3}]};
 const one={...all,all:false,blocks:[{block:1}]};assert.equal(mergeAsk(all,one),one);
 const other={...one,request:'K2',blocks:[{block:2}]};assert.equal(mergeAsk(one,other),other);
});
