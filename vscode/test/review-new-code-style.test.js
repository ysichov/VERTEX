"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const page=require("./tools-page").toolsPage("versions.html");

class Element {
  constructor(tag){this.tag=tag;this.children=[];this.className="";this.style={};}
  appendChild(child){this.children.push(child);return child;}
  addEventListener(){}
}
const context=vm.createContext({document:{createElement:tag=>new Element(tag)},compact:false,pairAll:()=>({}),pairRun:()=>({}),blameMark(){}});
vm.runInContext(page.slice(page.indexOf("function diffTable("),page.indexOf("/* The Blame switch",page.indexOf("function diffTable("))),context);

test("new review code keeps its text but has no green line fill or plus markers",()=>{
  const ops=[{op:"+",text:"METHOD new_method."},{op:"+",text:"ENDMETHOD."}];
  const neutral=context.diffTable(ops,null,0,null,true).children[0].children;
  assert.deepEqual(neutral.map(row=>row.className),["",""]);
  assert.deepEqual(neutral.map(row=>row.children[2].textContent),["METHOD new_method.","ENDMETHOD."]);
  assert.deepEqual(neutral.map(row=>row.children[1].textContent),[" "," "]);
  const changed=context.diffTable(ops,null,0,null,false).children[0].children;
  assert.deepEqual(changed.map(row=>row.className),["ins","ins"]);
  const side=context.sideTable(ops,true,null,true).children.at(-1).children;
  assert.ok(side.every(row=>row.children.every(cell=>!cell.className.includes("ins"))));
});
