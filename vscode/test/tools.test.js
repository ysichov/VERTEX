"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),path=require("node:path");
const model=require("../object-tools"),workspace=require("../tools-window");
test("objects expose valid functions and appropriate defaults",()=>{
  assert.equal(model.normalize({type:"TR",name:"devk900001"}).action,"review");
  assert.equal(model.normalize({type:"CLAS/OC",name:"zcl_test"}).action,"diff");
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
