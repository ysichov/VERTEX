"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const tools = require("../folder-tools");

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-local-tools-"));
  const page = {}, asked = [];
  const vscode = { workspace: { getConfiguration: () => ({ get: (key, fallback) => key === 'logPath' ? root : fallback }) }, ViewColumn: { Beside: 2 }, window: {
    showWarningMessage: options.showWarningMessage || (async (text, details) => { asked.push(text + "\n" + (details?.detail || "")); return options.allow ? "Allow" : undefined; }),
    createWebviewPanel: () => ({ webview: { html: "", onDidReceiveMessage: fn => { page.send = fn; }, postMessage: async () => {} },
      onDidDispose: fn => { page.close = fn; }, dispose: () => page.close(), reveal() {} }) } };
  const steps = [];
  const agent = tools.create(vscode, { cwd: root, reviewAfter: true, onStep: step => steps.push(step), ...options });
  t.after(() => { agent.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  return { root, agent, page, steps, asked };
}
test("a Glob pattern ending in / lists folders, not files", async t => {
  const { agent, root } = fixture(t);
  fs.mkdirSync(path.join(root, "docs", "img"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "docs", "x.md"), "x");
  assert.deepEqual((await agent.call("Glob", { pattern: "*/" })).matches, ["docs/", "src/"]);
  assert.deepEqual((await agent.call("Glob", { pattern: "**/" })).matches, ["docs/", "docs/img/", "src/"]);
  assert.deepEqual((await agent.call("Glob", { pattern: "*" })).matches, ["a.txt"]);
});
test("Edit tells the model when VERTEX safely normalizes escaped quotes",async t=>{
 const {agent,root,steps}=fixture(t);
 fs.writeFileSync(path.join(root,"a.txt"),'<span id="folder-name">Folder</span>');
 await agent.call("Read",{file_path:"a.txt"});
 const result=await agent.call("Edit",{file_path:"a.txt",old_string:'<span id=\\"folder-name\\">Folder</span>',new_string:'<a id=\\"folder-name\\">Project</a>'});
  assert.match(result.edit_normalization,/removing literal JSON quote escapes/);
 assert.equal(fs.readFileSync(path.join(root,"a.txt"),"utf8"),'<a id="folder-name">Project</a>');
  assert.deepEqual(steps.filter(step=>step.kind==="result").map(step=>[step.name,step.is_error]),[["Read",false],["Edit",true],["VERTEX Edit retry",false]]);
});
test("a failed VERTEX Edit retry is logged and returned to the model",async t=>{
 let root;const events=[];
 const fixtureResult=fixture(t,{onStep:step=>{events.push(step);if(step.name==="VERTEX Edit retry"&&step.kind==="use")fs.writeFileSync(path.join(root,"a.txt"),"changed meanwhile");}});
 root=fixtureResult.root;
 fs.writeFileSync(path.join(root,"a.txt"),'<span id="folder-name">Folder</span>');
 await fixtureResult.agent.call("Read",{file_path:"a.txt"});
 await assert.rejects(fixtureResult.agent.call("Edit",{file_path:"a.txt",old_string:'<span id=\\"folder-name\\">Folder</span>',new_string:'<a id=\\"folder-name\\">Project</a>'}),/Read the current file before changing it/);
 assert.deepEqual(events.filter(step=>step.kind==="result").map(step=>[step.name,step.is_error]),[["Read",false],["Edit",true],["VERTEX Edit retry",true]]);
});
const tick = () => new Promise(resolve => setImmediate(resolve));

test("a read-only folder turn creates a review copy only on Edit and overlays changed files", async t => {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-lazy-project-"));
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-lazy-copy-"));
  t.after(()=>{fs.rmSync(project,{recursive:true,force:true});fs.rmSync(copy,{recursive:true,force:true});});
  fs.writeFileSync(path.join(project,"a.txt"),"before\n");
  fs.writeFileSync(path.join(project,"b.txt"),"original\n");
  let prepared=0;
  const agent=tools.create({workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}},
    {cwd:project,projectFolder:project,prepareEdit:async()=>{
      prepared++;
      fs.copyFileSync(path.join(project,"a.txt"),path.join(copy,"a.txt"));
      fs.copyFileSync(path.join(project,"b.txt"),path.join(copy,"b.txt"));
      return {cwd:copy,pendingChanges:async()=>[]};
    }});
  t.after(()=>agent.dispose());
  assert.match((await agent.call("Read",{file_path:"a.txt"})).text,/before/);
  assert.equal(prepared,0);
  await agent.call("Edit",{file_path:"a.txt",old_string:"before",new_string:"after"});
  assert.equal(prepared,1);
  assert.equal(fs.readFileSync(path.join(project,"a.txt"),"utf8"),"before\n");
  assert.match((await agent.call("Read",{file_path:"a.txt"})).text,/after/);
  fs.writeFileSync(path.join(project,"b.txt"),"updated in project\n");
  assert.match((await agent.call("Read",{file_path:"b.txt"})).text,/updated in project/);
  assert.equal((await agent.call("Grep",{pattern:"after",glob:"*.txt"})).matches[0].file,"a.txt");
});
test("review copy line endings do not make a previously read file look stale", async t => {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-lf-project-"));
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-crlf-copy-"));
  t.after(()=>{fs.rmSync(project,{recursive:true,force:true});fs.rmSync(copy,{recursive:true,force:true});});
  fs.writeFileSync(path.join(project,"a.txt"),"one\ntwo\n");
  fs.writeFileSync(path.join(copy,"a.txt"),"one\r\ntwo\r\n");
  const agent=tools.create({workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}},
    {cwd:project,projectFolder:project,prepareEdit:async()=>({cwd:copy,pendingChanges:async()=>[]})});
  t.after(()=>agent.dispose());
  await agent.call("Read",{file_path:"a.txt"});
  await agent.call("Edit",{file_path:"a.txt",old_string:"one",new_string:"changed"});
  assert.match(fs.readFileSync(path.join(copy,"a.txt"),"utf8"),/^changed/);
});
test("generated VS Code page paths edit their tracked source in the review copy", async t => {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-pages-project-"));
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-pages-copy-"));
  t.after(()=>{fs.rmSync(project,{recursive:true,force:true});fs.rmSync(copy,{recursive:true,force:true});});
  const source=path.join("org.vertex.abap.ui","resources","versions.html");
  const generated=path.join("vscode","resources","versions.html");
  fs.mkdirSync(path.dirname(path.join(project,source)),{recursive:true});
  fs.mkdirSync(path.dirname(path.join(project,generated)),{recursive:true});
  fs.mkdirSync(path.dirname(path.join(copy,source)),{recursive:true});
  fs.writeFileSync(path.join(project,source),"original");
  fs.writeFileSync(path.join(project,generated),"stale copy");
  fs.writeFileSync(path.join(copy,source),"original");
  const agent=tools.create({workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}},
    {cwd:project,projectFolder:project,prepareEdit:async()=>({cwd:copy,pendingChanges:async()=>[]})});
  t.after(()=>agent.dispose());
  const generatedPath=path.join(project,generated);
  assert.equal((await agent.call("Read",{file_path:generatedPath})).text,"1: original");
  await agent.call("Edit",{file_path:generatedPath,old_string:"original",new_string:"updated"});
  assert.equal(fs.readFileSync(path.join(copy,source),"utf8"),"updated");
  assert.equal(fs.readFileSync(generatedPath,"utf8"),"stale copy");
  assert.equal(agent.changes()[0].file,source.replace(/\\/g,"/"));
});
test("in-place sed prepares the copy before Bash can execute",async t=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-sed-project-"));
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-sed-copy-"));
  t.after(()=>{fs.rmSync(project,{recursive:true,force:true});fs.rmSync(copy,{recursive:true,force:true});});
  fs.writeFileSync(path.join(project,"a.txt"),"before\n");
  let prepared=0;
  const agent=tools.create({workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}},
    {cwd:project,projectFolder:project,shellWithoutAsking:true,prepareEdit:async()=>{
      prepared++;fs.copyFileSync(path.join(project,"a.txt"),path.join(copy,"a.txt"));
      return {cwd:copy,pendingChanges:async()=>[]};
    }});
  t.after(()=>agent.dispose());
  const result=await agent.call("Bash",{command:"sed -i 's/before/after/' '"+path.join(project,"a.txt")+"'",purpose:"command",target:"project"});
  assert.equal(prepared,1);
  assert.equal(result.cwd,fs.realpathSync(copy));
  assert.equal(fs.readFileSync(path.join(project,"a.txt"),"utf8"),"before\n");
});
test("in-place sed cannot edit a folder without a review copy",async t=>{
  const {agent,root}=fixture(t,{reviewAfter:false,allow:true});
  await assert.rejects(agent.call("Bash",{command:"sed -i 's/one/changed/' a.txt"}),/review copy/);
  assert.equal(fs.readFileSync(path.join(root,"a.txt"),"utf8"),"one\ntwo\n");
});

test("successful VSIX build returns compact artifact proof while retaining its log",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-vsix-proof-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,"vscode","vertex-abap-0.9.99.vsix");fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,"archive");
 const result=tools.compactVerifiedVsix({purpose:"build",code:0,verified_vsix_line:"Verified VSIX: "+file,
   output_file:path.join(root,"output.log"),output_bytes:417314,stdout:"noise".repeat(1000),stderr:"warnings",highlights:["noise"]},root);
 assert.deepEqual(result.verified_vsix,{file});
 assert.equal(result.stdout,undefined);assert.equal(result.stderr,undefined);assert.equal(result.output_bytes,417314);
 assert.equal(tools.compactVerifiedVsix({purpose:"build",code:1,verified_vsix_line:"Verified VSIX: "+file,stdout:"failure"},root).stdout,"failure");
});

test("noisy shell commands finish without a buffer limit and their persistent logs can only be read",async t=>{
 const {agent,root}=fixture(t,{allow:true});
 fs.writeFileSync(path.join(root,'noisy.js'),"process.stdout.write('PREFIX\\n'+'x'.repeat(200000)+'\\nSUFFIX\\n');process.stderr.write('diagnostic\\n');");
 const result=await agent.call('Bash',{command:(process.platform==='win32'?'& ':'')+'"'+process.execPath+'" noisy.js'});
 assert.equal(result.code,0);assert.equal(result.output_truncated,true);assert.match(fs.readFileSync(result.output_file,'utf8'),/PREFIX/);
 assert.match((await agent.call('Read',{file_path:result.output_file,limit:1})).text,/PREFIX/);
 await assert.rejects(agent.call('Write',{file_path:result.output_file,content:'replace'}),/read-only/i);
 const second=tools.create({window:{},workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='logPath'?root:fallback})}},{cwd:root});t.after(()=>second.dispose());
 assert.match((await second.call('Read',{file_path:result.output_file,limit:1})).text,/PREFIX/);
 fs.rmSync(path.dirname(result.output_file),{recursive:true,force:true});
});

test("common tools search, page, edit and create files, and log every step", async t => {
  const { agent, root, steps } = fixture(t);
  assert.deepEqual((await agent.call("Glob", { pattern: "**/*.txt" })).matches, ["a.txt"]);
  assert.equal((await agent.call("Grep", { pattern: "TWO", ignore_case: true })).matches[0].line, 2);
  await assert.rejects(agent.call("Edit", { file_path: "a.txt", old_string: "one", new_string: "new" }), /Read the current/);
  assert.equal((await agent.call("Read", { file_path: "a.txt", offset: 2, limit: 1 })).text, "2: two");
  await agent.call("Edit", { file_path: "a.txt", old_string: "one", new_string: "new" });
  await agent.call("Write", { file_path: "sub/new.js", content: "export const x = 1;" });
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "new\ntwo\n");
  assert.deepEqual(agent.changes().map(c => [c.file, c.before, c.after, c.status]), [
    ["a.txt", "one\ntwo\n", "new\ntwo\n", "changed"], ["sub/new.js", "", "export const x = 1;", "added"]
  ]);
  assert.ok(steps.some(step => step.is_error));
  assert.equal(steps.filter(step => step.kind === "use").length, 6);
  assert.equal(steps.filter(step => step.kind === "result").length, 6);
});

test("local paths cannot escape, access .git or follow directory links", async t => {
  const { agent, root } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "secret.txt"), "untouched");
  for (const file_path of ["../outside.txt", path.join(outside, "secret.txt"), ".git/config", "a.txt:stream"]) {
    await assert.rejects(agent.call("Write", { file_path, content: "bad" }), /outside|metadata|streams/);
  }
  fs.symlinkSync(outside, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(agent.call("Read", { file_path: "link/secret.txt" }), /Symbolic/);
  await assert.rejects(agent.call("Write", { file_path: "link/new.txt", content: "bad" }), /Symbolic/);
  assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
  assert.deepEqual((await agent.call("Glob", { pattern: "**" })).matches, ["a.txt"]);
});

test("stale edits are rejected and concurrent mutations are serialized", async t => {
  const { agent, root } = fixture(t);
  await agent.call("Read", { file_path: "a.txt" });
  fs.writeFileSync(path.join(root, "a.txt"), "user edit");
  await assert.rejects(agent.call("Write", { file_path: "a.txt", content: "lost" }), /changed/);
  await agent.call("Read", { file_path: "a.txt" });
  await Promise.all([
    agent.call("Edit", { file_path: "a.txt", old_string: "user", new_string: "first" }),
    agent.call("Edit", { file_path: "a.txt", old_string: "first", new_string: "second" })
  ]);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "second edit");
});

test("outside Git, a write waits for review; cancellation or concurrent user edits prevent it", async t => {
  const { agent, root, page } = fixture(t, { reviewAfter: false });
  await agent.call("Read", { file_path: "a.txt" });
  const request = agent.call("Edit", { file_path: "a.txt", old_string: "one", new_string: "approved" });
  await tick();
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "one\ntwo\n");
  await page.send({ action: "apply", approved: ["f1"], declined: [] });
  await request;
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "approved\ntwo\n");
  const next = agent.call("Write", { file_path: "a.txt", content: "overwrite" });
  await tick();
  fs.writeFileSync(path.join(root, "a.txt"), "user");
  await page.send({ action: "apply", approved: ["f2"], declined: [] });
  await assert.rejects(next, /changed while waiting/);
  const pending = agent.call("Write", { file_path: "new.txt", content: "cancelled" });
  await tick(); agent.dispose();
  await assert.rejects(pending, /no longer active/);
  assert.equal(fs.existsSync(path.join(root, "new.txt")), false);
});

test("shell commands require permission and never execute after denial", async t => {
  const { agent, root } = fixture(t);
  await assert.rejects(agent.call("Bash", { command: "echo forbidden" }), /denied/);
  agent.dispose();
  await assert.rejects(agent.call("Write", { file_path: "new.txt", content: "bad" }), /no longer active/);
  assert.equal(fs.existsSync(path.join(root, "new.txt")), false);
});

test("a late Allow cannot start Bash after the model request has ended", async t => {
  let allow, shown;
  const waiting = new Promise(resolve => { shown = resolve; });
  const { agent, root } = fixture(t, { showWarningMessage: () => { shown(); return new Promise(resolve => { allow = resolve; }); } });
  const marker = path.join(root, "stale.txt");
  const command = process.platform === "win32" ? "Set-Content -LiteralPath stale.txt -Value stale" : "printf stale > stale.txt";
  const pending = agent.call("Bash", { command });
  await waiting;
  assert.equal(agent.closeApprovals(), 1);
  await assert.rejects(pending, /model request ended/);
  await agent.settled();
  allow("Allow");
  await tick();
  assert.equal(fs.existsSync(marker), false);
});

test("non-ASCII reads stay below the model tool-result byte budget", async t => {
  const { agent, root } = fixture(t);
  fs.writeFileSync(path.join(root, "unicode.txt"), ("界".repeat(1000) + "\n").repeat(100));
  const result = await agent.call("Read", { file_path: "unicode.txt", limit: 500 });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 24000);
  assert.ok(result.next_offset > 1);
});

test("approved commands run in the selected folder and report failed exits", async t => {
  const { agent, root, steps } = fixture(t, { allow: true });
  const result = await agent.call("Bash", { command: process.platform === "win32" ? "(Get-Location).Path" : "pwd" });
  assert.equal(result.code, 0);
  assert.equal(fs.realpathSync(result.stdout.trim()), fs.realpathSync(root));
  assert.equal((await agent.call("Bash", { command: "exit 7" })).code, 7);
  assert.equal(steps.at(-1).is_error, true);
});

test("Windows shell parsing failure explains that Git did not run", {skip:process.platform!=='win32'}, async t => {
 const {agent}=fixture(t,{allow:true});
 const result=await agent.call('Bash',{command:'git --version && git --version'});
 assert.notEqual(result.code,0);assert.match(result.hint,/Git did not run/);
});

test('environment identifies the executing host and separates bundled runtime from PATH', () => {
 const text=tools.environment('test folder');
 const data=JSON.parse(text.slice(text.indexOf('{')));
 assert.equal(data.platform,process.platform);assert.equal(data.architecture,process.arch);
 assert.equal(data.workingDirectory,'test folder');assert.equal(data.cwdAlreadySelected,true);
 assert.match(data.dependencyStatus,/not verified/);assert.match(data.dependencyStatus,/does not imply node is on PATH/);
 assert.equal(tools.environment('').includes('"workingDirectory":null'),true);
 assert.equal(text.includes(process.env.PATH||'impossible env value'),false);
});

test('commands default to the copy, builds default to the real project, and explicit targets report their actual cwd',async t=>{
 const project=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-real-project-'));
 const elsewhere=fs.mkdtempSync(path.join(os.tmpdir(),'vertex requested folder '));
 t.after(()=>{fs.rmSync(project,{recursive:true,force:true});fs.rmSync(elsewhere,{recursive:true,force:true});});
 const {agent,root,asked,steps}=fixture(t,{projectFolder:project,shellWithoutAsking:true,allow:true,pendingChanges:async()=>[{file:'unapplied.txt'}]});
 const command=process.platform==='win32'?'(Get-Location).Path':'pwd';
 const diagnostic=await agent.call('Bash',{command,purpose:'command'});
 assert.equal(diagnostic.cwd,fs.realpathSync(root));assert.equal(diagnostic.target,'working_copy');assert.equal(asked.length,0);
 await assert.rejects(agent.call('Bash',{command,purpose:'build'}),/unapplied working-copy edits/);
 assert.equal(asked.length,0);
 const projectCommand=await agent.call('Bash',{command,purpose:'command',target:'project'});
 assert.equal(projectCommand.cwd,fs.realpathSync(project));assert.equal(projectCommand.target,'project');
 assert.deepEqual(projectCommand.unapplied_changes,['unapplied.txt']);assert.match(projectCommand.warning,/unapplied/);
 assert.equal(asked.length,0);
 const copyBuild=await agent.call('Bash',{command,purpose:'build',target:'working_copy'});
 assert.equal(copyBuild.cwd,diagnostic.cwd);assert.equal(asked.length,0);
 const custom=await agent.call('Bash',{command,purpose:'build',target:'directory',directory:elsewhere});
 assert.equal(custom.cwd,fs.realpathSync(elsewhere));assert.equal(fs.realpathSync(custom.stdout.trim()),custom.cwd);assert.equal(custom.target,'directory');assert.equal(asked.length,1);
 assert.equal(steps.filter(step=>step.kind==='use').at(-1).input.cwd,custom.cwd);
 fs.writeFileSync(path.join(project,'source.txt'),'real source');
 await assert.rejects(agent.call('Read',{file_path:path.join(project,'source.txt')}),/outside/);
 for(const args of [{target:'unknown'},{target:'directory'},{target:'directory',directory:'relative'},{target:'project',directory:elsewhere},{purpose:'unknown'}])await assert.rejects(agent.call('Bash',{command,...args}),/target|purpose|directory/);
});

test('a build denied in the real project never executes when autoapproval is off',async t=>{
 const project=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-build-denied-'));
 t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
 const {agent,asked}=fixture(t,{projectFolder:project,shellWithoutAsking:false,allow:false});
 await assert.rejects(agent.call('Bash',{command:'exit 0',purpose:'build'}),/denied/);
 assert.equal(asked.length,1);assert.ok(asked[0].includes(fs.realpathSync(project)));
});

test('autoapproval covers project builds and commands before a review copy exists, not external directories',async t=>{
 const project=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-auto-project-'));
 const elsewhere=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-auto-external-'));
 t.after(()=>{fs.rmSync(project,{recursive:true,force:true});fs.rmSync(elsewhere,{recursive:true,force:true});});
 for(const reviewAfter of [false,true]){
  const {agent,asked}=fixture(t,{projectFolder:project,shellWithoutAsking:true,reviewAfter,allow:false});
  for(const args of [{purpose:'command'},{purpose:'build'},{purpose:'artifact'},{purpose:'command',target:'project'},{purpose:'command',target:'directory',directory:project}]){
   const result=await agent.call('Bash',{command:'exit 0',...args});
   assert.equal(result.code,0);assert.equal(asked.length,0);
  }
  await assert.rejects(agent.call('Bash',{command:'exit 0',purpose:'command',target:'directory',directory:elsewhere}),/denied/);
  assert.equal(asked.length,1);
 }
 const {agent,asked}=fixture(t,{cwd:project,projectFolder:project,reviewAfter:false,shellWithoutAsking:true,allow:false});
 assert.equal((await agent.call('Bash',{command:'exit 0',purpose:'build'})).code,0);
 assert.equal(asked.length,0);
});

test('an ignored binary build output can be transferred to the project without source review',async t=>{
 const project=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-artifact-target-'));
 t.after(()=>fs.rmSync(project,{recursive:true,force:true}));
 const {agent,root}=fixture(t,{projectFolder:project,allow:true});
 fs.writeFileSync(path.join(root,'example.zip'),Buffer.from([0,1,2,255]));
 fs.writeFileSync(path.join(project,'copy-artifact.js'),"require('fs').copyFileSync(process.argv[2],'example.zip');");
 const prefix=process.platform==='win32'?'& ':'';
 const result=await agent.call('Bash',{purpose:'artifact',command:prefix+'"'+process.execPath+'" copy-artifact.js "'+path.join(root,'example.zip')+'"'});
 assert.equal(result.code,0,result.stderr);assert.equal(result.target,'project');
 assert.deepEqual(fs.readFileSync(path.join(project,'example.zip')),fs.readFileSync(path.join(root,'example.zip')));
});

test('project rules are supplied in full with inherited rules before nearer rules; incomplete reads are explicit',t=>{
 const {root}=fixture(t),sub=path.join(root,'src');fs.mkdirSync(sub);
 const text=Array.from({length:620},(_,i)=>'rule '+i).join('\n');
 fs.writeFileSync(path.join(root,'AGENTS.md'),text);fs.writeFileSync(path.join(sub,'CLAUDE.md'),'Nested rule');
 const rules=tools.projectRules(sub,root);
 assert.equal(rules.length,2);assert.equal(rules[0].text,text);assert.equal(rules[0].complete,true);assert.equal(rules[1].text,'Nested rule');
 fs.writeFileSync(path.join(root,'AGENTS.md'),'x'.repeat(65537));
 const large=tools.projectRules(sub,root)[0];assert.equal(large.complete,false);assert.equal(large.text,undefined);assert.match(large.error,/complete file in pages/);
 assert.throws(()=>tools.projectRules(path.dirname(root),root),/outside/);
});
