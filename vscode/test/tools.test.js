"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),path=require("node:path");
const model=require("../object-tools"),workspace=require("../tools-window");
test("source reads the selected object, preserves selection for chat and reports SAP errors",()=>{
  const html=require("node:fs").readFileSync(path.resolve(__dirname,"../../org.vertex.abap.ui/resources/source.html"),"utf8");
  const handlers={},elements={title:{},code:{contains:n=>n==="code",addEventListener:(name,fn)=>handlers[name]=fn}};
  let raw,selection;const calls=[];
  const c=vm.createContext({document:{getElementById:id=>elements[id],addEventListener:(name,fn)=>handlers[name]=fn},window:{getSelection:()=>selection},sdeSource:(...args)=>calls.push(args),sdeTake:()=>raw});
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace("/*INIT*/null/*INIT*/",JSON.stringify({type:"PROG",name:"Z_TEST"})),c);
  assert.deepEqual(calls,[["Z_TEST","PROG"]]);
  raw=JSON.stringify({source:"REPORT z_test."});c.sdeReady();assert.equal(elements.code.textContent,"REPORT z_test.");
  selection={rangeCount:1,anchorNode:"code",focusNode:"code",toString:()=>"REPORT"};handlers.selectionchange();
  selection=null;handlers.selectionchange();assert.equal(c.sdeSelection().text,"REPORT");
  handlers.mousedown();assert.equal(c.sdeSelection(),null);
  raw="ERROR:SAP unavailable";c.sdeReady();assert.equal(elements.code.textContent,"SAP unavailable");
});
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
  assert.equal(model.normalize({type:"CLAS/OC",name:"zcl_test"}).action,"view");
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
test("workspace transport permits only VERTEX resources and existing review writes",()=>{
  assert.equal(workspace.allowed("/sap/bc/adt/vertex/package/%2FABC%2FAPP",null),true);
  assert.equal(workspace.allowed("/sap/bc/adt/vertex/review/DEVK123","{}"),true);
  for(const resource of ["https://evil.test/","/sap/bc/adt/vertex/../other","/sap/bc/adt/vertex/class/%2e%2e"]){
    assert.equal(workspace.allowed(resource,null),false);
  }
  assert.equal(workspace.allowed("/sap/bc/adt/vertex/class/ZCL_APP","{}"),false);
});
