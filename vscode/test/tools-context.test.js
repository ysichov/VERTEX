"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
test('Tools context commands use selected object/URI before the active editor',async()=>{
 const commands={},opened=[],errors=[],documents=[];
 const vscode={commands:{registerCommand:(name,fn)=>{commands[name]=fn;return {}; }},window:{activeTextEditor:{document:{object_name:'ZWRONG',object_type:'PROG'}},showErrorMessage:s=>errors.push(s)},workspace:{openTextDocument:async uri=>{documents.push(uri);return {object_name:'ZSELECTED',object_type:'CLAS'};}}};
 require('../tools-context').register(vscode,{subscriptions:[]},{documentObject:document=>document},value=>opened.push(value));
 await commands['vertex.tools.calls']({object_name:'zclass',object_type:'CLAS'});
 assert.deepEqual(opened.pop(),{name:'ZCLASS',type:'CLAS',action:'flow',boundObject:true});
 await commands['vertex.tools.scheme']({resourceUri:{scheme:'vertex-sap'}});
 assert.deepEqual(opened.pop(),{name:'ZSELECTED',type:'CLAS',action:'scheme',boundObject:true});assert.equal(documents.length,1);
 await commands['vertex.tools.diff']();assert.equal(opened.pop().name,'ZWRONG');assert.equal(errors.length,0);
});
test('Tools submenu contains all five functions in each object context',()=>{
 const pkg=require('../package.json'),menus=pkg.contributes.menus;
 for(const place of ['editor/context','explorer/context','webview/context'])assert.ok(menus[place].some(m=>m.submenu==='vertex.tools.context'));
 assert.deepEqual(menus['vertex.tools.context'].map(m=>m.command),['vertex.tools.uml','vertex.tools.metrics','vertex.tools.scheme','vertex.tools.calls','vertex.tools.diff']);
});
test('program Calls passes panel initialization and unsupported UML does not open an empty panel',async()=>{
 const commands={},opened=[],errors=[];
 const vscode={commands:{registerCommand:(name,fn)=>{commands[name]=fn;return {}; }},window:{showErrorMessage:s=>errors.push(s)}};
 require('../tools-context').register(vscode,{subscriptions:[]},{},initial=>{
  const model=require('../../org.vertex.abap.ui/resources/object-tools');
  opened.push(model.normalize(initial));
 });
 await commands['vertex.tools.calls']({object_name:'ZVERTEX_DEBUG_LAB',object_type:'PROG'});
 assert.deepEqual(opened,[{name:'ZVERTEX_DEBUG_LAB',type:'PROG',action:'flow'}]);
 await commands['vertex.tools.uml']({object_name:'ZVERTEX_DEBUG_LAB',object_type:'PROG'});
 assert.equal(opened.length,1);assert.equal(errors.length,1);assert.match(errors[0],/unavailable for Program/);
});
