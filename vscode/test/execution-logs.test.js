"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),vm=require("node:vm");

test("execution manager lists, opens and deletes selected SAP and transpiler recordings independently of AI logs",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-execution-logs-"));
 try{
  const sapFolder=path.join(root,"sap");fs.mkdirSync(sapFolder);
  const sap=require("../sap-debug-history"),sapFile=path.join(sapFolder,"one.vertex-debug.json");
  sap.save(sapFile,{format:1,meta:{name:"Z_SAP",type:"PROG",created:new Date().toISOString()},timeline:[{}],sources:{}});
  const source=path.join(root,"original.abap");fs.writeFileSync(source,"REPORT z_test.");
  const conversation=path.join(root,"ai.jsonl");fs.writeFileSync(conversation,"keep conversation");
  const history=require("../transpiler-history").create(()=>path.join(root,"transpiler"));
  const id=history.save([{line:1,file:source}],{object_name:"Z_LOCAL"},{main:source});
  const commands=new Map(),posted=[],opened=[],discarded=[];let receive,confirm=false;
  const panel={webview:{postMessage:message=>posted.push(message),onDidReceiveMessage:fn=>{receive=fn;},html:""},onDidDispose(){},reveal(){}};
  const vscode={ViewColumn:{Beside:2},workspace:{getConfiguration:()=>({get:()=>sapFolder})},
   commands:{registerCommand:(name,fn)=>commands.set(name,fn),executeCommand:async(...args)=>opened.push(args)},
   window:{createWebviewPanel:()=>panel,showWarningMessage:async()=>confirm?"Delete":undefined,showErrorMessage:message=>assert.fail(message)}};
  const sourceCode=fs.readFileSync(path.join(__dirname,"../extension.js"),"utf8");
  const start=sourceCode.indexOf('vscode.commands.registerCommand("vertex.openSapDebugRuns"');
  const end=sourceCode.indexOf('vscode.commands.registerCommand("vertex.knownEvidenceSessions"',start);
  vm.runInNewContext(sourceCode.slice(start,end).trim().replace(/,$/,""),{vscode,context:{globalStorageUri:{fsPath:root}},fs,path,__dirname:path.join(__dirname,".."),sapDebugRunsPanel:null,transpilerHistory:history,
   require:name=>name.startsWith("./")?require(path.join(__dirname,"..",name)):require(name),dbg:{discardRecording:id=>discarded.push(id)},openVisualDebug:async(...args)=>opened.push(args)});
  await commands.get("vertex.openSapDebugRuns")();await receive({action:"ready"});
  const rows=posted.at(-1).runs;assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(r=>r.kind)),new Set(["sap","transpiler"]));
  await receive({action:"open",key:"transpiler:"+id});assert.equal(opened[0][0],"vertex.openTranspilerRun");assert.equal(opened[0][1].run_id,id);
  await receive({action:"deleteSelected",keys:rows.map(r=>r.key)});assert.ok(fs.existsSync(sapFile));assert.equal(history.known().length,1);
  confirm=true;await receive({action:"deleteSelected",keys:[...rows.map(r=>r.key),"../outside"]});
  assert.equal(fs.existsSync(sapFile),false);assert.equal(history.known().length,0);assert.equal(discarded.length,1);
  assert.ok(fs.existsSync(source));assert.ok(fs.existsSync(conversation));assert.equal(posted.at(-1).runs.length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
