"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),vm=require("node:vm");
const {execFileSync}=require("node:child_process"),helper=require("../git-branches");
test("new task branch retains local edits; switching existing branches never discards them",async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-branches-"));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const git=(...args)=>execFileSync("git",args,{cwd:folder,windowsHide:true,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 git("init","-b","main");git("config","user.name","Test");git("config","user.email","test@example.test");fs.writeFileSync(path.join(folder,"a.txt"),"base");git("add",".");git("commit","-m","base");
 const original=await helper.info(folder);fs.writeFileSync(path.join(folder,"a.txt"),"edit");
 const created=await helper.switchBranch(folder,{branch:"vertex/task",create:true,expectedHead:original.head,expectedBranch:original.branch});assert.equal(created.branch,"vertex/task");assert.equal(created.head,original.head);assert.equal(fs.readFileSync(path.join(folder,"a.txt"),"utf8"),"edit");
 await assert.rejects(helper.switchBranch(folder,{branch:"main",expectedHead:created.head,expectedBranch:created.branch}),/Commit or stash/);
 git("add",".");git("commit","-m","task");const updated=await helper.info(folder);
 await assert.rejects(helper.switchBranch(folder,{branch:"main",expectedHead:created.head,expectedBranch:created.branch}),/HEAD or branch changed/);
 await helper.switchBranch(folder,{branch:"main",expectedHead:updated.head,expectedBranch:updated.branch});assert.equal(fs.readFileSync(path.join(folder,"a.txt"),"utf8"),"base");assert.equal(git("rev-parse","vertex/task"),updated.head);
});
test("GitHub PR URL uses validated branches and requires the current commit to be pushed",async()=>{
 assert.equal(helper.githubRepository("git@github.com:owner/repo.git"),"https://github.com/owner/repo");assert.equal(helper.githubRepository("https://github.com/owner/repo.git"),"https://github.com/owner/repo");assert.throws(()=>helper.githubRepository("https://example.com/owner/repo"),/github.com/);
 const module={exports:{}};let remoteHead="abc";
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../git-branches.js"),"utf8"),{module,URL,require:()=>({info:async()=>({head:"abc",branch:"task",remotes:["origin"]}),git:async(folder,args)=>args[0]==="remote"?"git@github.com:owner/repo.git":args[0]==="ls-remote"?remoteHead+"\trefs/heads/task":""})});
 const request={remote:"origin",baseBranch:"main",sourceBranch:"task/test",expectedHead:"abc",expectedBranch:"task"};
 assert.equal(await module.exports.prUrl("folder",request),"https://github.com/owner/repo/compare/main...task%2Ftest?expand=1");remoteHead="old";await assert.rejects(module.exports.prUrl("folder",request),/Push the current commit/);
 await assert.rejects(module.exports.prUrl("folder",{...request,baseBranch:request.sourceBranch}),/must be different/);
});
