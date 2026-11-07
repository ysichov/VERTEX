"use strict";
const { execFile } = require("node:child_process");
function git(folder,args){
  return new Promise((resolve,reject)=>execFile("git",args,{cwd:folder,windowsHide:true,timeout:120000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}},(error,out,err)=>error?reject(new Error(String(err||error.message).trim())):resolve(String(out).trim())));
}
async function info(folder){
  const branch=await git(folder,["symbolic-ref","--quiet","--short","HEAD"]).catch(()=>"");
  if(!branch)throw new Error("Push requires a named branch; HEAD is detached.");
  const head=await git(folder,["rev-parse","HEAD"]);
  const remotes=(await git(folder,["remote"])).split(/\r?\n/).filter(Boolean);
  if(!remotes.length)throw new Error("No Git remote configured. Add a remote before pushing.");
  const upstreamRemote=await git(folder,["config","--get","branch."+branch+".remote"]).catch(()=>"");
  const merge=await git(folder,["config","--get","branch."+branch+".merge"]).catch(()=>"");
  const remote=remotes.includes(upstreamRemote)?upstreamRemote:remotes.includes("origin")?"origin":remotes[0];
  return {branch,head,remotes,remote,targetBranch:remote===upstreamRemote&&merge.startsWith("refs/heads/")?merge.slice(11):branch};
}
async function push(folder,request){
  const current=await info(folder);
  if(current.head!==request.expectedHead||current.branch!==request.expectedBranch)throw new Error("HEAD or branch changed. Reopen Push to review the destination again.");
  if(!current.remotes.includes(request.remote))throw new Error("Select a configured Git remote.");
  if(typeof request.targetBranch!=="string"||request.targetBranch.startsWith("-"))throw new Error("Invalid destination branch.");
  await git(folder,["check-ref-format","refs/heads/"+request.targetBranch]);
  await git(folder,["push","--",request.remote,current.head+":refs/heads/"+request.targetBranch]);
  return {head:current.head,remote:request.remote,branch:request.targetBranch};
}
module.exports={git,info,push};
