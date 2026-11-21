"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {taskForFiles}=require("../review-topic");
const folder="C:/projects/example";
const topic=(id,label)=>({id,label});
function prompt(time,text,subject,details=[]){return {operation:"Chat",time,text,topic:subject,details};}
function tool(name,input){return {type:"tool",name,input};}
test("latest file edit selects its topic and all earlier user refinements",()=>{
  const old=topic("old","Old task"),current=topic("new","Progress indicator");
  const report={sessions:[{conversation:"chat-1",context:{folder},prompts:[
    prompt(1,"old request",old,[tool("Edit",{file_path:"C:/projects/example/src/main.abap"})]),
    prompt(2,"show percentage",current),
    prompt(3,"improve existing program",current,[tool("Edit",{file_path:"C:/projects/example/src/main.abap"}),tool("Review",{files:[{file:"src/main.abap",decision:"approved"}]})])]}]};
  const result=taskForFiles(report,folder,["src/main.abap"]);
  assert.match(result,/show percentage/);assert.match(result,/improve existing program/);
  assert.doesNotMatch(result,/old request/);
});
test("whole diff includes each file's latest linked topic",()=>{
  const a=topic("a","First"),b=topic("b","Second");
  const report={sessions:[{conversation:"chat-1",context:{folder},prompts:[
    prompt(1,"change A",a,[tool("Write",{file_path:"C:/projects/example/a.txt"})]),
    prompt(2,"change B",b,[tool("Review",{files:[{file:"b.txt",decision:"approved"}]})])]}]};
  const result=taskForFiles(report,folder,["a.txt","b.txt"]);
  assert.match(result,/change A/);assert.match(result,/change B/);
});
test("review keeps an earlier task linked as a dependency of a restoration follow-up",()=>{
  const original=topic("original","Fix invalid ABAP declarations"),restore=topic("restore","Restore changes overwritten by pull");
  const report={sessions:[{conversation:"chat-1",context:{folder},prompts:[
    prompt(1,"The declarations do not compile; check the whole program",original),
    prompt(2,"Fix everything",original,[tool("Edit",{file_path:"C:/projects/example/src/report.abap"})]),
    prompt(3,"My pull overwrote the last changes; restore them",{...restore,dependencies:["original"]}),
    prompt(4,"Apply the fixes to the current file",restore,[tool("Edit",{file_path:"C:/projects/example/src/report.abap"})])]}]};
  const result=taskForFiles(report,folder,["src/report.abap"]);
  assert.match(result,/The declarations do not compile/);
  assert.match(result,/Fix everything/);
  assert.match(result,/My pull overwrote/);
  assert.match(result,/Apply the fixes/);
  assert.ok(result.indexOf("Fix invalid ABAP declarations")<result.indexOf("Restore changes overwritten by pull"));
});
test("review includes a correction whose saved routing kept only the selected topic",()=>{
 const current=topic("topic_0001","Skip EN to UK"),other=topic("topic_0002","Other review");
 const routing={status:"pruned",topics:[current,other],answers:{route:{choice:current.id,confidence:0.39},
   need_topic_0001:{choice:"keep",confidence:0.86},need_topic_0002:{choice:"skip",confidence:0.7}}};
 const report={sessions:[{conversation:"chat-1",context:{folder},prompts:[
   prompt(1,"Skip EN to UK",current,[tool("Edit",{file_path:"C:/projects/example/src/report.abap"})]),
   prompt(2,"Do not show a message, just skip",topic("topic_0003","Later backfilled topic"),[{routing},tool("Edit",{file_path:"C:/projects/example/src/report.abap"})])]}]};
 const result=taskForFiles(report,folder,["src/report.abap"]);
 assert.match(result,/Skip EN to UK/);
 assert.match(result,/Do not show a message, just skip/);
 assert.doesNotMatch(result,/Later backfilled topic/);
});
