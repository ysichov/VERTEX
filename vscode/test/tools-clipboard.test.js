"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/tools.html'),'utf8');
const source=page.slice(page.indexOf('function wireClipboard('),page.indexOf('function connect('));
for(const key of ['metaKey','ctrlKey'])test(key+'+C copies selected review text through the host clipboard',()=>{
 const handlers={},copied=[];
 const child={document:{activeElement:null,addEventListener:(name,handler)=>handlers[name]=handler},getSelection:()=>({toString:()=> 'selected diff'}),sdeCopyText:text=>copied.push(text),addEventListener:(name,handler)=>handlers[name]=handler};
 vm.runInNewContext(source+'\nwireClipboard(child)',{child});
 let prevented=false,stopped=false;
 handlers.keydown({key:'c',[key]:true,preventDefault(){prevented=true},stopPropagation(){stopped=true}});
 assert.deepEqual(copied,['selected diff']);assert.ok(prevented&&stopped);
});
test('Copy menu also copies a selected substring in an input',()=>{
 const handlers={},copied=[];
 const child={document:{activeElement:{value:'ABCDEFG',selectionStart:1,selectionEnd:4},addEventListener:(name,handler)=>handlers[name]=handler},getSelection:()=>'',sdeCopyText:text=>copied.push(text),addEventListener:(name,handler)=>handlers[name]=handler};
 vm.runInNewContext(source+'\nwireClipboard(child)',{child});
 handlers.copy({preventDefault(){},stopPropagation(){}});assert.deepEqual(copied,['BCD']);
});
