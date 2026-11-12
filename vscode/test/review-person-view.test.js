"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const page=require("./tools-page").toolsPage("versions.html");
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.className='';}
 appendChild(child){this.children.push(child);child.parentNode=this;return child;}
 insertBefore(child,ref){const at=this.children.indexOf(ref);this.children.splice(at<0?this.children.length:at,0,child);child.parentNode=this;return child;}
 addEventListener(name,fn){this[name]=fn;}
 setAttribute(name,value){this[name]=value;}
 set innerHTML(value){this.children=[];}
 querySelectorAll(selector){const all=this.children.flatMap(child=>[child,...child.querySelectorAll(selector)]);return all.filter(child=>selector==='details.person-section'?child.tag==='details'&&child.className==='person-section':selector==='button[data-act]'?child.tag==='button'&&child.dataset.act:child.className==='person-block');}
}
test('person view shows all objects and filters their blocks, with working expand/collapse controls',()=>{
 const root=new Element('root'),scopes=[];
 const context=vm.createContext({document:{getElementById:()=>root,createElement:tag=>new Element(tag)},
 heading:text=>Object.assign(new Element('h3'),{textContent:text}),loadReview(){},copyText(){},status(){},
 segmented:(choices,index,pick)=>{if(choices[0]&&choices[0][0]==='All')context.pickFilter=pick;return new Element('controls')},
 blockRow:(block,scope)=>{scopes.push(scope);return new Element('tr')},saidRows:()=>[],diffTable:()=>new Element('table'),
 promptEditorButton:()=>new Element('button'),compact:true,review_part:null,review_live:false,showing:{},promptKind:'review',PROMPT_CHOICES:[['Code review'],['Technical documentation']],sdeReviewAsk(){}});
 vm.runInContext(page.slice(page.indexOf('var personView = null;'),page.indexOf("/* One developer's part")),context);
 const make=(name,blocks)=>({object:{objtype:'METH',obj_name:name,class_name:'ZCL_X'},body:{blocks,ops:[{op:'+',text:name}]}});
 context.personView={title:'DEV',filter:'all',parts:[make('ONE',[{hunk_no:1,action:'A',op_from:1,op_to:1},{hunk_no:2,action:'D',op_from:1,op_to:1}]),make('TWO',[{hunk_no:1,action:'',messages:[{text:'note'}],op_from:1,op_to:1}])]};
 context.drawPersonView();assert.equal(root.querySelectorAll('.person-block').length,3);assert.equal(scopes[2].object.obj_name,'TWO');
 const controls=root.children[0].children;controls.find(button=>button.textContent==='Collapse all').onclick();assert.ok(root.querySelectorAll('details.person-section').every(el=>!el.open));
 controls.find(button=>button.textContent==='Expand all').onclick();assert.ok(root.querySelectorAll('details.person-section').every(el=>el.open));
 context.pickFilter(1);assert.equal(root.querySelectorAll('.person-block').length,1);
 context.pickFilter(4);assert.equal(root.querySelectorAll('.person-block').length,1);
});

test('buttons in the multi-object view keep the object scope they were rendered for',()=>{
 const opened=[],asked=[];
 const element=tag=>Object.assign(new Element(tag),{textContent:''});
 const context=vm.createContext({document:{createElement:element,createTextNode:text=>Object.assign(element('text'),{textContent:text})},
 review_live:false,sdeAct(){},sdeOpenReviewSource(){},sdeReviewAsk(){},
 actButton:(block,action,label,scope)=>Object.assign(element('button'),{textContent:label,scope}),
 openBlock:(block,object)=>opened.push(object),askReview:(blocks,scope)=>asked.push(scope)});
 vm.runInContext(page.slice(page.indexOf('function blockRow('),page.indexOf('var review_ops =')),context);
 const block={hunk_no:1,change_count:1,change_kind:'added',start_line:1,author:'DEV'};
 const one={object:{obj_name:'ONE'}},two={object:{obj_name:'TWO'}};
 const rows=[context.blockRow(block,one),context.blockRow(block,two)];
 const buttons=node=>[...(node.tag==='button'?[node]:[]),...node.children.flatMap(buttons)];
 buttons(rows[1]).find(button=>button.textContent==='Open').click();
 buttons(rows[0]).find(button=>button.textContent==='ASK AI').click();
 assert.equal(opened[0],two.object);assert.equal(asked[0],one);
 assert.equal(buttons(rows[1]).find(button=>button.textContent==='Approve').scope,two);
});

test('Expand all in the request summary opens the code view, including for one class',()=>{
 const opened=[];
 const context=vm.createContext({document:{createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('text'),{textContent:text})},
 review:{saved:true},review_live:false,review_building:'',objectName:()=> 'K1',renderPerson:(...args)=>opened.push(args),aveTable:()=>new Element('table')});
 vm.runInContext(page.slice(page.indexOf('var promptPick ='),page.indexOf('/* Reviewers as AVE')),context);
 const view=context.objectGroups([{class_name:'ZCL_X',obj_name:'ONE'}]);
 const all=node=>[node,...node.children.flatMap(all)];
 const expand=all(view).find(node=>node.textContent==='Expand all');assert.ok(expand);expand.click();
 assert.equal(opened.length,1);assert.equal(opened[0][0],'Review: K1');assert.equal(opened[0][2],'A:');
 const documentation=all(view).find(node=>node.textContent==='Technical documentation');assert.ok(documentation);documentation.click();
 assert.equal(context.promptKind,'technical');assert.equal(opened[1][2],'A:');
});

test('ticked objects narrow the combined review and its prompt to them; none ticked means all',()=>{
 const context=vm.createContext({document:{createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('text'),{textContent:text})},
 review:{saved:true},review_live:false,review_building:'',objectName:()=> 'K1',renderPerson(){},loadReviewPart(){},loadReviewClass(){},
 cell(){},rowsCell(){},count(){},shareCell(){},percentCell(){}});
 vm.runInContext(page.slice(page.indexOf('function aveTable('),page.indexOf('/* Reviewers as AVE')),context);
 context.drawPersonView=()=>{};
 const objects=[{group:'Programs',objtype:'PROG',obj_name:'A'},{group:'Programs',objtype:'PROG',obj_name:'B'},{group:'Function Modules',objtype:'FUNC',obj_name:'C'}];
 const view=context.objectGroups(objects);
 const all=node=>[node,...node.children.flatMap(all)];
 const boxes=all(view).filter(node=>node.type==='checkbox');
 assert.equal(boxes.length,5);
 const counter=()=>all(view).find(node=>String(node.textContent).startsWith('Selected'));
 assert.equal(counter().textContent,'Selected: all 3');
 const programs=boxes.find(box=>box.title==='Select every object of Programs');
 programs.checked=true;programs.change();
 assert.equal(counter().textContent,'Selected: 2 of 3');
 const parts=objects.map(object=>({object,body:{blocks:[]}}));
 context.personView={title:'Review: K1',selector:'A:',parts:[],filter:'all'};
 context.renderPersonParts({selector:'A:',request:'k1',parts});
 assert.deepEqual(context.personView.parts.map(p=>p.object.obj_name),['A','B']);
 assert.equal(context.personView.title,'Review: K1 · 2 selected objects');
 all(view).find(node=>node.textContent==='None').click();
 assert.equal(counter().textContent,'Selected: all 3');
 context.personView={title:'Review: K1',selector:'A:',parts:[],filter:'all'};
 context.renderPersonParts({selector:'A:',request:'k1',parts});
 assert.equal(context.personView.parts.length,3);
});

test('ASK AI beside the prompt choice sends that prompt as the chip instruction; a block ASK AI does not',async()=>{
 const sent=[];const context=vm.createContext({sdeReviewAsk:json=>sent.push(JSON.parse(json)),status(){},
 loadPrompt:()=>Promise.resolve(),promptOpening:kind=>'OPEN '+kind,promptEnding:kind=>kind==='technical'?' END':'',
 PROMPT_CHOICES:[['Code review',''],['Technical documentation','']]});
 vm.runInContext(page.slice(page.indexOf('function askWithPrompt('),page.indexOf('/* AVE\'s AI prompt diff')),context);
 context.askWithPrompt({object:'X',blocks:[]},'technical');await new Promise(r=>setTimeout(r,0));
 assert.equal(sent[0].instruction,'OPEN technical END');assert.equal(sent[0].prompt_label,'Technical documentation');
 context.askWithPrompt({object:'X',blocks:[]});assert.equal(sent[1].instruction,undefined);
});

test('a review block opens at its line: class parts count from their method, section or local include',()=>{
 const context=vm.createContext({review_part:null});
 vm.runInContext(page.slice(page.indexOf('var CLASS_INCLUDES ='),page.indexOf('function openBlock(')),context);
 const t=(line,o)=>JSON.parse(JSON.stringify(context.blockTarget(line,o)));
 assert.deepEqual(t(5,{objtype:'METH',class_name:'ZCL_A',obj_name:'RUN'}),{name:'ZCL_A',type:'CLAS',method:'RUN',offset:4});
 assert.deepEqual(t(3,{objtype:'CPRI',class_name:'ZCL_A',obj_name:'ZCL_A'}),{name:'ZCL_A',type:'CLAS',section:'PRIVATE',offset:2});
 assert.deepEqual(t(12,{objtype:'CINC',class_name:'ZCL_DLG_HR_UTILITY_APP',obj_name:'ZCL_DLG_HR_UTILITY_APP========CCIMP'}),{name:'ZCL_DLG_HR_UTILITY_APP',type:'CLAS',classInclude:'implementations',line:12});
 assert.deepEqual(t(7,{objtype:'FUNC',obj_name:'ZHR_X'}),{name:'ZHR_X',type:'FUNC',line:7});
 assert.deepEqual(t(7,{objtype:'REPS',obj_name:'ZPROG'}),{name:'ZPROG',type:'PROG',line:7});
});

test('Open in the class view names the class: its parts carry class_name', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'org.vertex.abap.ui', 'resources', 'versions.html'), 'utf8');
  assert.match(html, /display_name: s\.display_name, class_name: data\.class_name \}/);
  assert.match(html, /openBlock\(b, \(scope && scope\.object\) \|\| b\.part\)/);
});
