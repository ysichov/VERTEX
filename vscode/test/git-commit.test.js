"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path"),{execFileSync}=require("node:child_process"),helper=require("../git-commit"),history=require("../git-history");
test("commit prompt treats diff as data and parses editable message",()=>{
 const prompt=helper.prompt({text:"DIFF"},{summary:"Draft"});assert.match(prompt,/Do not call tools/);assert.match(prompt,/Do not invent/);assert.match(prompt,/Draft/);
 assert.deepEqual(helper.parse("Fix selection\n\nPreserve edited parameters."),{summary:"Fix selection",description:"Preserve edited parameters."});
});
test("commit reviewed subfolder files preserves outside staged changes and rejects stale review",async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),"vertex-commit-test-"));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const git=(...args)=>execFileSync("git",args,{cwd:folder,encoding:"utf8",windowsHide:true}).trim();
 git("init");git("config","core.autocrlf","true");git("config","user.email","test@example.test");git("config","user.name","Test");
 await fs.mkdir(path.join(folder,"sub"));await fs.writeFile(path.join(folder,"outside"),"old");await fs.writeFile(path.join(folder,"sub/edited"),"old");await fs.writeFile(path.join(folder,"sub/deleted"),"old");git("add",".");git("commit","-m","initial");
 await fs.writeFile(path.join(folder,"outside"),"staged outside");git("add","outside");
 await fs.writeFile(path.join(folder,"sub/edited"),"new\r\n");await fs.writeFile(path.join(folder,"sub/new"),"created");await fs.unlink(path.join(folder,"sub/deleted"));
 const sub=path.join(folder,"sub"),changes=await history.readWorkingChanges(sub),head=git("rev-parse","HEAD");
 await fs.writeFile(path.join(folder,"sub/new"),"changed after review");
 await assert.rejects(()=>helper.commit(sub,head,changes,{summary:"Commit reviewed files"}),/changed/);assert.equal(git("rev-parse","HEAD"),head);
 await fs.writeFile(path.join(folder,"sub/new"),"created");
 const result=await helper.commit(sub,head,changes,{summary:"Commit reviewed files",description:"Body with \nmultiple lines."});
 assert.ok(result.hash);assert.equal(git("log","-1","--format=%s"),"Commit reviewed files");assert.equal(git("show","HEAD:outside"),"old");assert.equal(git("show",":outside"),"staged outside");
 assert.equal(git("diff","--cached","--name-only"),"outside");assert.equal(git("diff","--name-only","--","sub"),"");assert.equal(git("show","HEAD:sub/new"),"created");
});
test("commit form is present only on working changes and its scripts compile",()=>{
 const review=require("../code-review"),vm=require("node:vm");
 const files=[{id:"f1",path:"x",label:"x",kind:"changed",parts:review.hunks("a","b"),after:"b"}];
 const html=review.filesReviewHtml(files,{readonly:{title:"Uncommitted changes",commit:true}});assert.match(html,/id="commit-open"/);assert.match(html,/id="commit-summary" required/);assert.match(html,/generateCommit/);assert.match(html,/commitChanges/);
 const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(script));
 assert.doesNotMatch(review.filesReviewHtml(files,{readonly:{title:"Commit abc"}}),/id="commit-open"/);
});
