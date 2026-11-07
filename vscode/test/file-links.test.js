"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const links=require("../file-links");
test("only known file references are linked, with paths, Unicode and sentence punctuation",()=>{
 const aliases=new Set(["README.md","src/a.js","LICENSE","файл.abap","my file.md"]);
 assert.deepEqual(links.references("See README.md. Then src/a.js and файл.abap; unknown.js",aliases).map(x=>x.reference),["README.md","src/a.js","файл.abap"]);
 assert.equal(links.references("LICENSE",aliases)[0].reference,"LICENSE");assert.equal(links.references("my file.md",aliases)[0].reference,"my file.md");
 assert.equal(links.references("https://example.com/README.md",aliases).length,0);
});
test("file links select an open review first, then open the editor after review disposal",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-links-")),filename=path.join(root,"a.js");fs.writeFileSync(filename,"content");t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let revealed=0,message,opened;
 const panel={active:true,visible:true,reveal(){revealed++;},webview:{async postMessage(m){message=m;}}};
 const dispose=links.register(panel,()=>[{id:"f1",path:filename,relative:"a.js"}]);t.after(dispose);
 const vscode={workspace:{workspaceFolders:[{uri:{scheme:"file",fsPath:root}}],async findFiles(){return [{scheme:"file",fsPath:filename}];}},RelativePattern:class{},Uri:{file:fsPath=>({fsPath})},commands:{async executeCommand(command,uri){opened={command,uri};}}};
 assert.equal(await links.open(vscode,"a.js"),"review");assert.equal(revealed,1);assert.deepEqual(message,{action:"selectFile",file:"f1"});assert.equal(opened,undefined);
 dispose();assert.equal(await links.open(vscode,"a.js"),"file");assert.equal(opened.command,"vscode.open");assert.equal(opened.uri.fsPath,fs.realpathSync(filename));
 await assert.rejects(links.open(vscode,"../outside.js"),/not available/);
});
