"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),path=require("node:path");
const model=require("../object-tools"),workspace=require("../tools-window");
test("embedded theme follows all VS Code themes and changes without reloading",()=>{
  const source=require("node:fs").readFileSync(path.resolve(__dirname,"../../org.vertex.abap.ui/resources/tools.html"),"utf8");
  const code=source.slice(source.indexOf("function syncTheme("),source.indexOf("new MutationObserver"));
  let active; const tokens=new Map(); const styles=new Map(); const classes=new Set();
  const child={document:{body:{style:{[Symbol.iterator]:()=>styles.keys(),setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)},classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k)}}}};
  const context={document:{body:{classList:{contains:k=>k===active}}},getComputedStyle:()=>({[Symbol.iterator]:()=>tokens.keys(),getPropertyValue:k=>tokens.get(k)||""})};
  vm.createContext(context);vm.runInContext(code,context);
  for(const [theme,bg,fg,insert] of [["vscode-dark","#182449","#ffffff","#17301c"],["vscode-light","#ffffff","#202020","#e8f6ea"],["vscode-high-contrast","#000000","#ffffff","#17301c"],["vscode-high-contrast-light","#ffffff","#000000","#e8f6ea"]]){
    active=theme;tokens.set("--vscode-editor-background",bg);tokens.set("--vscode-editor-foreground",fg);
    context.syncTheme(child);
    assert.deepEqual([...classes],[theme]);assert.equal(styles.get("--bg"),bg);assert.equal(styles.get("--fg"),fg);assert.equal(styles.get("--ins-bg"),insert);assert.equal(styles.get("--vscode-editor-background"),bg);
  }
});
test("objects expose valid functions and appropriate defaults",()=>{
  assert.equal(model.normalize({type:"TR",name:"devk900001"}).action,"review");
  assert.equal(model.normalize({type:"CLAS/OC",name:"zcl_test"}).action,"uml");
  assert.equal(model.normalize({type:"DEVC",name:"z_rig"}).action,"uml");
  assert.throws(()=>model.normalize({type:"PROG",name:"z_rig",action:"view"}),"View source is not a function: the source is the editor");
  assert.equal(model.normalize({type:"DEVC",name:"$TMP",action:"uml"}).type,"DEVC");
  assert.throws(()=>model.normalize({type:"TABL",action:"uml"}));
  assert.throws(()=>model.normalize({type:"CLAS",name:'x"><script>'}));
});
test("workspace embeds pages without breaking script boundaries or initial state",()=>{
  const html=workspace.html(path.resolve(__dirname,"../../org.vertex.abap.ui/resources"),{type:"DEVC",name:"ZAPP",action:"uml"});
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  new vm.Script(scripts[0][1]);
  assert.match(html,/const initial = {"type":"DEVC","name":"ZAPP","action":"uml"}/);
});
test("Tools mounts a selected view before the optional Parts request completes",()=>{
  const page=require("node:fs").readFileSync(path.resolve(__dirname,"../../org.vertex.abap.ui/resources/tools.html"),"utf8");
  const run=page.slice(page.indexOf("function run(){"),page.indexOf('document.getElementById("tsplit")'));
  assert.match(run,/mount\(service,state,applyPart\);\s*loadParts\(state,applyPart\);/);
});
test("workspace transport permits only VERTEX resources and existing review writes",()=>{
  assert.equal(workspace.allowed("/sap/bc/adt/vertex/package/%2FABC%2FAPP",null),true);
  assert.equal(workspace.allowed("/sap/bc/adt/vertex/review/DEVK123","{}"),true);
  for(const resource of ["https://evil.test/","/sap/bc/adt/vertex/../other","/sap/bc/adt/vertex/class/%2e%2e"]){
    assert.equal(workspace.allowed(resource,null),false);
  }
  assert.equal(workspace.allowed("/sap/bc/adt/vertex/class/ZCL_APP","{}"),false);
});
test("Visual Debug is the docked panel beside the editor, not a view of the Tools window",()=>{
  assert.deepEqual(model.objects.find(o=>o[0]==="PROG")[2],["metrics","scheme","flow","diff"]);
  assert.throws(()=>model.normalize({type:"FUNC",name:"Z_FM",action:"vdebug"}));
  assert.doesNotMatch(model.instructions,/vdebug/);
  assert.ok(!model.navigationSchema.anyOf[1].properties.action.enum.includes("vdebug"));
  const page=workspace.html(path.resolve(__dirname,"../../org.vertex.abap.ui/resources"),null);
  assert.doesNotMatch(page,/enable\.apply\(null,\["vdebug"/);
  assert.doesNotMatch(page,/Click beside a line number to set a breakpoint/,"the Tools page carries no Visual Debug page");
  const docked=workspace.debugHtml({name:"Z_TEST",type:"PROG"});
  assert.match(docked,/Z_TEST/);
  assert.match(docked,/window\.sdeDebug=/);
  assert.match(docked,/window\.sdeAsset=/);
  assert.doesNotMatch(docked,/sdeOpenEditor/);
});
test("the Visual Debug page asks the debugger for nothing it has no command for",async()=>{
  const seen=[];
  const dbg={picture:()=>({ok:1}),async setBreakpointAt(a){seen.push(a);return {id:"bp1"};},async advance(k){seen.push(k);}};
  assert.deepEqual(await workspace.debugCommand(dbg,"picture",{}),{ok:1});
  assert.deepEqual(await workspace.debugCommand(dbg,"set",{url:"/u",line:3,take_over:"yes"}),{id:"bp1"});
  assert.equal(seen[0].take_over,false);
  await workspace.debugCommand(dbg,"step",{kind:"over"});
  assert.equal(seen[1],"over");
  await assert.rejects(workspace.debugCommand(dbg,"setValue",{}),/no command setValue/);
});
