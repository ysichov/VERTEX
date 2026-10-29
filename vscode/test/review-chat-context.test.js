"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {format}=require('../review-chat-context');
test('request context includes every reviewed object and its saved diff, with a bounded marked result',()=>{
 const objects=[{objtype:'METH',obj_name:'ZCL_X RUN',class_name:'ZCL_X',display_name:'RUN',inserted:1,modified:0,deleted:1,hunks:1},
 {objtype:'REPS',obj_name:'Z_NEW',inserted:1,modified:0,deleted:0,hunks:1,is_created:true}];
 const payload={TRKORR:'K1',DIFF_DATA:objects.map(o=>({KEY:{OBJTYPE:o.objtype,OBJNAME:o.obj_name,VERSNO_O:'00001',VERSNO_N:'00002'},DIFF:[{OP:'-',TEXT:'old calculation.'},{OP:'+',TEXT:'new calculation.'}]}))};
 const context=format(payload,{objects});assert.equal(context.object_count,2);assert.equal(context.shown,'summary');
 assert.match(context.text,/ZCL_X \/ RUN/);assert.match(context.text,/Z_NEW/);assert.match(context.text,/- old calculation/);assert.match(context.text,/\+ new calculation/);assert.match(context.text,/new object/);
 payload.DIFF_DATA[0].DIFF=[{OP:'+',TEXT:'x'.repeat(5000)}];const limited=format(payload,{objects},1000);assert.ok(limited.text.length<=1000);assert.equal(limited.truncated,true);assert.match(limited.text,/truncated/);
});

test('the review summary published by the page includes the objects and selected storage copy',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/versions.html'),'utf8');
 const objects=[{obj_name:'ZPROG',objtype:'REPS',inserted:2}];
 const context=vm.createContext({objectType:()=> 'TR',objectName:()=> 'K1',showing:{view:'review'},scope:true,current:null,review_part:null,
 review:{request:'k1',saved:true,saved_at:'stamp',objects,storage:{from:'file'}}});
 vm.runInContext(page.slice(page.indexOf('function pageState('),page.indexOf('// The Tools-window chat'))+'\nresult=pageState();',context);
 assert.equal(context.result.review_summary.objects,objects);
 assert.equal(context.result.review_summary.from,'file');assert.equal(context.result.review_summary.saved_at,'stamp');
});
