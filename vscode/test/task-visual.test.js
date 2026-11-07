"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const visual=require("../task-visual"),review=require("../code-review");

test("review and commit scenes are distinct, theme-aware and static under reduced motion",()=>{
 assert.match(visual.html("review"),/review-lens/);assert.match(visual.html("commit"),/commit-link/);
 assert.doesNotMatch(visual.css,/rotate\(|filter:/);assert.match(visual.css,/prefers-reduced-motion/);assert.match(visual.css,/vscode-reduce-motion/);assert.match(visual.css,/var\(--vscode-/);
 const failed=review.waitingHtml("Review","Could not read changes",true);assert.doesNotMatch(failed,/<svg/);assert.match(failed,/aria-busy="false"/);
});

test("chat review scene survives progress updates and is removed on completion or error",()=>{
 const dirname=path.join(__dirname,".."),sandbox={module:{exports:{}},require,__dirname:dirname};vm.runInNewContext(fs.readFileSync(path.join(dirname,"sidebar.js"),"utf8")+"\nmodule.exports.render=html;",sandbox);
 const script=sandbox.module.exports.render("test").match(/<script nonce="test">([\s\S]*?)<\/script>/)[1],start=script.indexOf("function paintTaskScene("),end=script.indexOf("\n}\n",start)+2;
 const item={dataset:{},children:[],setAttribute(name,value){this[name]=value;},querySelector(){return this.children[0];},appendChild(child){this.children.push(child);}};
 const context={taskVisuals:{review:visual.html("review"),commit:visual.html("commit")},document:{createElement(){return {dataset:{},setAttribute(){},remove(){item.children=[];}};}}};vm.runInNewContext(script.slice(start,end),context);
 context.paintTaskScene(item,{kind:"review"});const first=item.children[0];assert.match(first.innerHTML,/review-lens/);assert.equal(item['aria-busy'],"true");
 context.paintTaskScene(item,{status:"Model request"});assert.equal(item.children[0],first);
 context.paintTaskScene(item,{done:true,answer:"Request failed"});assert.equal(item.children.length,0);assert.equal(item['aria-busy'],"false");
 context.paintTaskScene(item,{kind:"commit"});assert.match(item.children[0].innerHTML,/commit-link/);context.paintTaskScene(item,{done:true});assert.equal(item.children.length,0);
});

test("commit waiting visual covers generation and commit, and stops after success or failure",()=>{
 const html=review.filesReviewHtml([{id:"f",path:"a.js",label:"a.js",after:"new",parts:review.hunks("old","new")}],{readonly:{title:"Changes",commit:true}}),script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
 assert.match(html,/id="commit-working" hidden/);assert.match(html,/task-commit/);
 const start=script.indexOf("if(commitDialog){"),end=script.indexOf("\nlet decisions=",start),nodes=new Map(),listeners=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:"",hidden:id==="commit-working",setAttribute(name,value){this[name]=value;},addEventListener(){},focus(){},showModal(){},close(){}});return nodes.get(id);};
 const progress=node("progress");node("commit-status").parentElement=progress;
 const context={commitDialog:node("dialog"),refreshReview:node("refresh"),stored:{},api:{getState:()=>({}),setState(){},postMessage(){}},document:{getElementById:node,querySelector:()=>node("heading")},window:{addEventListener:(_,fn)=>listeners.push(fn)}};vm.runInNewContext(script.slice(start,end),context);
 node("commit-generate").onclick();assert.equal(node("commit-working").hidden,false);assert.equal(context.commitDialog['aria-busy'],"true");
 listeners[0]({data:{commitError:"Network error"}});assert.equal(node("commit-working").hidden,true);assert.equal(node("commit-close").disabled,false);
 node("commit-generate").onclick();listeners[0]({data:{commitDraft:{summary:"Update code",description:"Details"}}});assert.equal(node("commit-working").hidden,true);
 node("commit-form").onsubmit({preventDefault(){}});assert.equal(node("commit-working").hidden,false);listeners[0]({data:{commitDone:{hash:"abc"}}});assert.equal(node("commit-working").hidden,true);assert.equal(context.commitDialog['aria-busy'],"false");
});
