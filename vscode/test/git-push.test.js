"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {execFileSync}=require("node:child_process"),helper=require("../git-push");
test("Push previews the actual branch and pushes only after explicit invocation, rejecting stale HEAD",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-push-")),folder=path.join(root,"work"),remote=path.join(root,"remote.git");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(folder);
  const git=(cwd,...args)=>execFileSync("git",args,{cwd,windowsHide:true,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git(root,"init","--bare",remote);git(folder,"init","-b","topic");git(folder,"config","user.name","Test");git(folder,"config","user.email","test@example.test");
  fs.writeFileSync(path.join(folder,"a.txt"),"one");git(folder,"add",".");git(folder,"commit","-m","one");
  await assert.rejects(helper.info(folder),/No Git remote/);git(folder,"remote","add","origin",remote);
  const info=await helper.info(folder);assert.equal(info.branch,"topic");assert.equal(info.targetBranch,"topic");assert.equal(git(remote,"for-each-ref"),"");
  await assert.rejects(helper.push(folder,{remote:"bad",targetBranch:"topic",expectedHead:info.head,expectedBranch:info.branch}),/configured Git remote/);
  await helper.push(folder,{remote:"origin",targetBranch:"topic",expectedHead:info.head,expectedBranch:info.branch});assert.equal(git(remote,"rev-parse","refs/heads/topic"),info.head);
  fs.writeFileSync(path.join(folder,"a.txt"),"two");git(folder,"add",".");git(folder,"commit","-m","two");
  await assert.rejects(helper.push(folder,{remote:"origin",targetBranch:"topic",expectedHead:info.head,expectedBranch:info.branch}),/HEAD or branch changed/);
  assert.equal(git(remote,"rev-parse","refs/heads/topic"),info.head);
});
test("GitHub disabled credential prompts explain authentication on the extension host",()=>{
  for(const field of ["Username","Password"]){
    const original="fatal: could not read "+field+" for 'https://github.com': terminal prompts disabled";
    const message=helper.gitError(original).message;
    assert.ok(message.startsWith(original));
    assert.match(message,/gh auth login --hostname github.com --git-protocol https --web/);
    assert.match(message,/gh auth setup-git --hostname github.com/);
    assert.match(message,/remote host for SSH, WSL or containers/);
    assert.match(message,/retry the operation/i);
  }
  for(const message of ["fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled","fatal: could not read Username for 'https://github.com.evil.test': terminal prompts disabled","fatal: Authentication failed","fatal: rejected non-fast-forward"]){
    assert.equal(helper.gitError(message).message,message);
  }
});
test("Git runner surfaces authentication guidance from failed Git commands",async()=>{
  const vm=require("node:vm"),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve("../git-push"),"utf8"),{module,process:{env:{}},require:name=>{
    assert.equal(name,"node:child_process");return {execFile(command,args,options,done){
      assert.equal(options.env.GIT_TERMINAL_PROMPT,"0");
      done(new Error("exit 128"),"","fatal: could not read Username for 'https://github.com': terminal prompts disabled");
    }};
  }});
  await assert.rejects(module.exports.git("/project",["push"]),/gh auth setup-git --hostname github.com/);
});
