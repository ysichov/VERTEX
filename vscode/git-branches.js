"use strict";
const {git,info:pushInfo}=require("./git-push");
async function info(folder){
  const branch=await git(folder,["symbolic-ref","--quiet","--short","HEAD"]).catch(()=>"");
  const head=await git(folder,["rev-parse","HEAD"]);
  const branches=(await git(folder,["for-each-ref","--format=%(refname:short)","refs/heads/"])).split(/\r?\n/).filter(Boolean);
  return {branch,head,branches,dirty:Boolean(await git(folder,["status","--porcelain"]))};
}
async function switchBranch(folder,request){
  const current=await info(folder);
  if(current.head!==request.expectedHead||current.branch!==request.expectedBranch)throw new Error("HEAD or branch changed. Refresh and try again.");
  const name=request.branch;
  if(typeof name!=="string"||!name||name.startsWith("-")||name.includes("@{"))throw new Error("Invalid branch name.");
  await git(folder,["check-ref-format","--branch",name]);
  if(request.create===true){
    if(current.branches.includes(name))throw new Error("That branch already exists.");
    await git(folder,["switch","-c",name]);
  }else{
    if(!current.branches.includes(name))throw new Error("Select an existing local branch.");
    if(name!==current.branch&&current.dirty)throw new Error("Commit or stash local changes before switching to another branch. Creating a new branch from the current state is allowed.");
    await git(folder,["switch","--",name]);
  }
  return info(folder);
}
function githubRepository(remoteUrl){
  let host,pathname;
  const scp=String(remoteUrl).match(/^git@([^:]+):(.+)$/);
  if(scp){host=scp[1];pathname=scp[2];}else{
    const url=new URL(remoteUrl);if(!["https:","ssh:"].includes(url.protocol))throw new Error("PR supports GitHub HTTPS or SSH remotes.");host=url.hostname;pathname=url.pathname;
  }
  const parts=pathname.replace(/^\//,"").replace(/\.git$/,"").split("/");
  if(host.toLowerCase()!=="github.com"||parts.length!==2||parts.some(p=>!p||!/^[-\w.]+$/.test(p)))throw new Error("PR currently supports github.com remotes.");
  return "https://github.com/"+parts.map(encodeURIComponent).join("/");
}
async function prInfo(folder){
  const current=await pushInfo(folder);
  const defaultRef=await git(folder,["symbolic-ref","--quiet","refs/remotes/"+current.remote+"/HEAD"]).catch(()=>"");
  return {...current,sourceBranch:current.targetBranch,baseBranch:defaultRef.startsWith("refs/remotes/"+current.remote+"/")?defaultRef.slice(("refs/remotes/"+current.remote+"/").length):"main"};
}
async function prUrl(folder,request){
  const current=await pushInfo(folder);
  if(current.head!==request.expectedHead||current.branch!==request.expectedBranch)throw new Error("HEAD or branch changed. Reopen PR to review the branches.");
  if(!current.remotes.includes(request.remote))throw new Error("Select a configured Git remote.");
  for(const branch of [request.baseBranch,request.sourceBranch]){
    if(typeof branch!=="string"||!branch||branch.startsWith("-"))throw new Error("Invalid PR branch.");
    await git(folder,["check-ref-format","refs/heads/"+branch]);
  }
  if(request.baseBranch===request.sourceBranch)throw new Error("PR source and base must be different branches. Create a task branch before committing.");
  const repository=githubRepository(await git(folder,["remote","get-url",request.remote]));
  const remoteHead=await git(folder,["ls-remote","--exit-code","--heads","--",request.remote,"refs/heads/"+request.sourceBranch]);
  if(remoteHead.split(/\s/)[0]!==current.head)throw new Error("Push the current commit to the selected source branch before opening PR.");
  return repository+"/compare/"+encodeURIComponent(request.baseBranch)+"..."+encodeURIComponent(request.sourceBranch)+"?expand=1";
}
module.exports={info,switchBranch,githubRepository,prInfo,prUrl};
