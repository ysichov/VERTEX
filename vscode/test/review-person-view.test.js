"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/versions.html'),'utf8');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.className='';}
 appendChild(child){this.children.push(child);child.parentNode=this;return child;}
 insertBefore(child,ref){const at=this.children.indexOf(ref);this.children.splice(at<0?this.children.length:at,0,child);child.parentNode=this;return child;}
 addEventListener(name,fn){this[name]=fn;}
 set innerHTML(value){this.children=[];}
 querySelectorAll(selector){const all=this.children.flatMap(child=>[child,...child.querySelectorAll(selector)]);return all.filter(child=>selector==='details.person-section'?child.tag==='details'&&child.className==='person-section':selector==='button[data-act]'?child.tag==='button'&&child.dataset.act:child.className==='person-block');}
}
test('person view shows all objects and filters their blocks, with working expand/collapse controls',()=>{
 const root=new Element('root'),scopes=[];
 const context=vm.createContext({document:{getElementById:()=>root,createElement:tag=>new Element(tag)},
 heading:text=>Object.assign(new Element('h3'),{textContent:text}),loadReview(){},copyText(){},status(){},
 segmented:(choices,index,pick)=>{context.pickFilter=pick;return new Element('controls')},
 blockRow:(block,scope)=>{scopes.push(scope);return new Element('tr')},saidRows:()=>[],diffTable:()=>new Element('table'),
 compact:true,review_part:null,review_live:false,showing:{},sdeReviewAsk(){}});
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
 vm.runInContext(page.slice(page.indexOf('function objectGroups('),page.indexOf('/* Reviewers as AVE')),context);
 const view=context.objectGroups([{class_name:'ZCL_X',obj_name:'ONE'}]);
 const all=node=>[node,...node.children.flatMap(all)];
 const expand=all(view).find(node=>node.textContent==='Expand all');assert.ok(expand);expand.click();
 assert.equal(opened.length,1);assert.equal(opened[0][0],'Review: K1');assert.equal(opened[0][2],'A:');
});
