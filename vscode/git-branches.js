"use strict";
const {git,info:pushInfo}=require("./git-push");
/* For a branch diff, which can pass git-push's 1 MB output buffer. */
const gitLarge=(folder,args)=>new Promise((resolve,reject)=>require("node:child_process").execFile("git",args,{cwd:folder,windowsHide:true,timeout:120000,maxBuffer:64*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}},(error,out,err)=>error?reject(new Error(String(err||error.message).trim())):resolve(String(out))));
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
/* The checks both PR steps share: the same HEAD and branch, a configured remote, two valid and different branch names. */
async function checkPR(folder,request){
  const current=await pushInfo(folder);
  if(current.head!==request.expectedHead||current.branch!==request.expectedBranch)throw new Error("HEAD or branch changed. Reopen PR to review the branches.");
  if(!current.remotes.includes(request.remote))throw new Error("Select a configured Git remote.");
  for(const branch of [request.baseBranch,request.sourceBranch]){
    if(typeof branch!=="string"||!branch||branch.startsWith("-"))throw new Error("Invalid PR branch.");
    await git(folder,["check-ref-format","refs/heads/"+branch]);
  }
  if(request.baseBranch===request.sourceBranch)throw new Error("PR source and base must be different branches. Create a task branch before committing.");
  return current;
}
/* GitHub's compare page fills a new PR from title and body in its address; past this length browsers and GitHub cut it. */
const PR_URL_LIMIT=8000;
async function prUrl(folder,request){
  const current=await checkPR(folder,request);
  const repository=githubRepository(await git(folder,["remote","get-url",request.remote]));
  const title=String(request.title||"").trim(),body=String(request.body||"").trim();
  const url=repository+"/compare/"+encodeURIComponent(request.baseBranch)+"..."+encodeURIComponent(request.sourceBranch)+"?expand=1"
    +(title?"&title="+encodeURIComponent(title):"")+(body?"&body="+encodeURIComponent(body):"");
  if(url.length>PR_URL_LIMIT)throw new Error("The title and description are too long to hand to GitHub in the page address ("+url.length+" of "+PR_URL_LIMIT+" characters once encoded). Shorten the description and open again; nothing was opened.");
  // The length is checked before the network.
  const remoteHead=await git(folder,["ls-remote","--exit-code","--heads","--",request.remote,"refs/heads/"+request.sourceBranch]);
  if(remoteHead.split(/\s/)[0]!==current.head)throw new Error("Push the current commit to the selected source branch before opening PR.");
  return url;
}
/* What the PR would carry: its commits and its diff against the base branch as the remote-tracking ref has it. */
async function prSnapshot(folder,request,limit=180000){
  await checkPR(folder,request);
  const base=request.remote+"/"+request.baseBranch;
  await git(folder,["rev-parse","--verify","--quiet","refs/remotes/"+base]).catch(()=>{throw new Error("There is no remote-tracking branch "+base+". Fetch "+request.remote+" first.");});
  const commits=await git(folder,["log","--no-merges","--format=- %h %s%n%b","refs/remotes/"+base+"..HEAD"]);
  if(!commits.trim())throw new Error("HEAD has no commits that "+base+" lacks, so there is nothing to describe.");
  const stat=await git(folder,["diff","--stat","refs/remotes/"+base+"...HEAD"]);
  const diff=await gitLarge(folder,["diff","refs/remotes/"+base+"...HEAD"]);
  const text="Pull request "+request.sourceBranch+" into "+request.baseBranch+"\nCommits:\n"+commits.trim()+"\n\nFiles:\n"+stat.trim()+"\n\nDiff against "+base+":\n"+diff;
  const truncated=text.length>limit;
  return {title:"Pull request",file_count:1,truncated,text:truncated?text.slice(0,Math.max(0,limit-50))+"\n[Branch snapshot truncated]":text};
}
module.exports={info,switchBranch,githubRepository,prInfo,prUrl,prSnapshot,PR_URL_LIMIT};
