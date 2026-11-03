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
test('Tools submenu contains Object Navigator and the five functions in each object context',()=>{
 const pkg=require('../package.json'),menus=pkg.contributes.menus;
 for(const place of ['editor/context','explorer/context','webview/context'])assert.ok(menus[place].some(m=>m.submenu==='vertex.tools.context'));
 assert.deepEqual(menus['vertex.tools.context'].map(m=>m.command),['vertex.tools.navigator','vertex.tools.uml','vertex.tools.metrics','vertex.tools.scheme','vertex.tools.calls','vertex.tools.diff']);
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
test('local ABAP context binds analysis to its document and keeps version history on SAP',async()=>{
 const commands={},opened=[],errors=[];
 const document={uri:{scheme:'file',fsPath:'zlocal.prog.abap',toString:()=> 'file:///zlocal.prog.abap'},languageId:'abap',getText:()=> 'REPORT zlocal.\nWRITE 1.'};
 const vscode={commands:{registerCommand:(name,fn)=>{commands[name]=fn;return {};}},window:{activeTextEditor:{document,selection:{active:{line:1}}},showErrorMessage:s=>errors.push(s)}};
 require('../tools-context').register(vscode,{subscriptions:[]},{documentObject:()=>null},value=>opened.push(value));
 await commands['vertex.tools.metrics']();
 assert.equal(opened[0].name,'ZLOCAL');
 assert.equal(opened[0].localSession.primary,document);
 await commands['vertex.tools.diff']();
 assert.equal(opened.length,1);
 assert.match(errors[0],/Version history needs a SAP system/);
});

test('local package command can choose a folder from the command palette',async()=>{
 const commands={},opened=[],errors=[],dialogs=[];
 const folder={scheme:'file',fsPath:__dirname};
 const local=require('../local-analysis'),original=local.createPackage;
 local.createPackage=async (_,selected)=>({object:{object_name:'TEST',object_type:'DEVC'},folder:selected});
 try{
  const vscode={commands:{registerCommand:(name,fn)=>{commands[name]=fn;return {};}},
   workspace:{workspaceFolders:[{uri:folder}]},window:{showOpenDialog:async options=>{dialogs.push(options);return [folder];},showErrorMessage:s=>errors.push(s)}};
  require('../tools-context').register(vscode,{subscriptions:[]},{},value=>opened.push(value));
  await commands['vertex.tools.localPackage']();
  assert.equal(dialogs[0].canSelectFolders,true);
  assert.equal(dialogs[0].canSelectFiles,false);
  assert.equal(opened[0].localSession.folder,folder);
  assert.deepEqual([opened[0].name,opened[0].type,opened[0].action],['TEST','DEVC','uml']);
  assert.deepEqual(errors,[]);
 }finally{local.createPackage=original;}
});
test('a Tools window opened from an editor keeps that editor, a source of SAP\'s ADT extension included',async()=>{
 const commands={},opened=[];
 const uri={scheme:'abap',toString:()=>'abap:/repotree-v1/A4H/zcl_x.clas.abap'};
 const document={uri,getText:()=>'CLASS zcl_x DEFINITION.\nENDCLASS.'};
 const vscode={commands:{registerCommand:(name,fn)=>{commands[name]=fn;return {}; }},window:{activeTextEditor:{document},showErrorMessage:()=>{}},workspace:{openTextDocument:async()=>document}};
 require('../tools-context').register(vscode,{subscriptions:[]},{documentObject:()=>null},value=>opened.push(value));
 await commands['vertex.tools.scheme']();
 assert.equal(opened.pop().sourceUri,'abap:/repotree-v1/A4H/zcl_x.clas.abap');
});

test('another extension\'s ABAP source is analysed from its editor text when VERTEX has no SAP system, and read from SAP when it has one',async()=>{
 // ABAP remote filesystem's address of a program: the system in the authority, the package tree in the path.
 const uri={scheme:'adt',path:'/Local Objects ($TMP)/Source Code Library/Programs/ZMAN_TEST_CCS/zman_test_ccs.prog.abap',
  toString:()=>'adt://icd_001/Local%20Objects%20(%24TMP)/Source%20Code%20Library/Programs/ZMAN_TEST_CCS/zman_test_ccs.prog.abap'};
 const document={uri,languageId:'abap',getText:()=>'REPORT zman_test_ccs.\nWRITE 1.'};
 const run=async systems=>{
  const commands={},opened=[],errors=[];
  const vscode={commands:{registerCommand:(name,fn)=>{commands[name]=fn;return {};}},window:{activeTextEditor:{document,selection:{active:{line:0}}},showErrorMessage:s=>errors.push(s)},
   workspace:{getConfiguration:()=>({get:()=>systems})}};
  require('../tools-context').register(vscode,{subscriptions:[]},{documentObject:()=>null},value=>opened.push(value));
  await commands['vertex.tools.scheme']();
  assert.deepEqual(errors,[]);
  return opened[0];
 };
 const local=await run([]);
 assert.deepEqual([local.name,local.type],['ZMAN_TEST_CCS','PROG']);
 assert.equal(local.localSession.primary,document,'the editor\'s own text is analysed');
 assert.equal(local.sourceUri,uri.toString());
 const sap=await run([{name:'ICD',url:'https://icd',user:'u'}]);
 assert.equal(sap.localSession,undefined,'with a system it is read from SAP, as before');
 const analysis=require('../local-analysis');
 assert.equal(analysis.isAbapDocument({uri:{scheme:'vertex-sap',path:'/zx.prog.abap'},languageId:'abap'}),false,'VERTEX\'s own SAP tab is not');
 assert.equal(analysis.isLocalAbap(document),false,'a run or the local debugger still needs a file');
});
