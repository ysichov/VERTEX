"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const page=fs.readFileSync(path.join(__dirname,"../../org.vertex.abap.ui/resources/chat.html"),"utf8");

test("same-name program and package both become openable chat links",()=>{
 const opened=[];
 const itemFor=(type,leading)=>{
  const strong={textContent:"Z_AVE",cloneNode(){return {textContent:this.textContent}}};
  const li={firstChild:leading?{nodeType:3,textContent:type+" "}:null,textContent:type+" Z_AVE — description",querySelector:()=>strong};
  strong.parentNode={replaceChild(link){li.link=link;}};
  return li;
 };
 const program=itemFor("PROG",false),packageItem=itemFor("DEVC",true);
 const context=vm.createContext({document:{createElement:()=>({children:[],appendChild(child){this.children.push(child)},addEventListener(name,fn){this[name]=fn}}),getElementById:()=>({value:"codex"})},
  sdeOpenObject:(assistant,unused,raw)=>opened.push(JSON.parse(raw))});
 vm.runInContext(page.slice(page.indexOf("function links("),page.indexOf("function copyButton(")),context);
 context.links({querySelectorAll:()=>[program,packageItem]},[{object_type:"DEVC",object_name:"Z_AVE"},{object_type:"PROG",object_name:"Z_AVE"}]);
 assert.equal(program.link.className,"object-link");assert.equal(packageItem.link.className,"object-link");
 program.link.click({preventDefault(){}});packageItem.link.click({preventDefault(){}});
 assert.deepEqual(opened,[{object_type:"PROG",object_name:"Z_AVE"},{object_type:"DEVC",object_name:"Z_AVE"}]);
});
