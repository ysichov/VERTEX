"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../assistant");
const chat = require("../chat");
const copilot = require("../copilot");
const compatible = require("../openai-compatible");
const rawCompatibleAsk = compatible.ask;
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

for (const allow of [false, true]) test(`Folder build with SAP Orchestrator selected preserves command approval (${allow ? "allow" : "deny"})`, async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-folder-orchestrator-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 t.mock.method(require('../agent-worktree'),'open',async()=>null);
 t.mock.method(require('../orchestrator-plan'),'connect',async()=>assert.fail('Folder work must not invoke SAP tool selection'));
 const vscode=fakeVscode({provider:'codex-subscription',model:'test-model'});
 vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
 let approvals=0,executed=false,served;
 vscode.window.showWarningMessage=async(message,options,choice)=>{approvals++;assert.equal(message,'VERTEX assistant: Run command');assert.match(options.detail,/build/);return allow?choice:undefined;};
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:set=>{served=set;return {route:'/chat/test',dispose(){}};}};
 t.mock.method(assistant,'ask',async options=>{
  assert.ok(options.tools.includes('Bash'));
  assert.ok(options.tools.includes('Edit'),'release preparation remains available for review');
  const args={command:process.platform==='win32'?'Write-Output vertex-build-ok':'printf vertex-build-ok',purpose:'build',target:'project'};
  const result=await served.call({},'Bash',args);
  const value=JSON.parse(result.content[0].text);
  assert.equal(value.code,0);assert.match(value.stdout,/vertex-build-ok/);assert.equal(value.cwd,root);executed=true;
  return {plan:{answer:'Built',navigation:null,build_command:''},model:'test-model'};
 });
 const ask=chat.create(vscode,{schemas:[],orchestrator:()=>true,editorContext:()=>null},server,{get:async()=>null});
 try {
  if(allow)assert.equal((await ask('собери всикс 0.9.96',{contextMode:'folder'})).answer,'Built');
  else await assert.rejects(ask('собери всикс 0.9.96',{contextMode:'folder'}),/declined|denied/i);
  assert.equal(approvals,1);assert.equal(executed,allow);
 } finally {await ask.dispose();}
});

test.beforeEach(t => { t.mock.method(assistant, "resolveAssistant", async (vscode, id) => "/ext/" + id); });
test.beforeEach(t => { t.mock.method(require('../orchestrator-plan'), 'verifyStage', async()=>({status:'passed',checks:[],usage:{}})); });
test.beforeEach(t => { t.mock.method(require('../task-verification'), 'verifyTask', async()=>({status:'passed',checks:[],usage:{}})); });

test("Zero context sends the chat only and bypasses workspace tools and routing", async t => {
 const vscode = fakeVscode({provider:"openai-api", model:"fixture"});
 t.mock.method(require("../topic-routing"), "route", async () => assert.fail("Jev routing must not run"));
 let requests = 0;
 t.mock.method(compatible, "ask", async request => {
  assert.equal(request.instructions, "");
  assert.deepEqual(request.tools, []);
  assert.doesNotMatch(request.prompt, /PRIVATE_REVIEW|PRIVATE_WORKSPACE/);
  if (++requests === 1) assert.equal(request.prompt, "First question");
  else assert.match(request.prompt, /First question[\s\S]*First answer[\s\S]*Follow-up/);
  return { plan: { answer: "First answer" }, model: "fixture" };
 });
 const ask = chat.create(vscode, {editorContext: () => assert.fail("Editor context must not be read")},
   {start: async () => assert.fail("MCP must not start")}, {get: async () => null});
 try {
  await ask("First question", {contextMode:"zero", web:true, routeTopics:true, state:{workspace:"PRIVATE_WORKSPACE"}});
  await ask("Follow-up", {contextMode:"zero", routeTopics:true});
  assert.equal(requests, 2);
 } finally { await ask.dispose(); }
});

for (const provider of ['openai-api', 'claude-subscription']) test(`Zero context shows screenshot recognition before the ${provider} request`, async t => {
 const vscode = fakeVscode({provider, model:'fixture'}), progress = [];
 const images = [{media_type:'image/png', data:'aW1hZ2U='}];
 t.mock.method(require('../topic-routing'), 'route', async () => assert.fail('Zero context must not route'));
 t.mock.method(provider === 'openai-api' ? compatible : assistant, 'ask', async request => {
  assert.equal(progress.length, 1, 'recognition must start before waiting for the provider');
  assert.equal(progress[0].kind, 'recognize');assert.equal(progress[0].imageIndex, 0);
  assert.match(progress[0].status, /Recognizing screenshot/);
  assert.deepEqual(request.images, images);assert.deepEqual(request.tools, []);assert.equal(request.instructions, '');
  request.onProgress({status:'Model request 1'});
  return {plan:{answer:'Visible error'}, model:'fixture'};
 });
 const ask = chat.create(vscode, {editorContext:()=>assert.fail('Do not read editor context')},
  {start:async()=>assert.fail('Do not start MCP')}, {get:async()=>null});
 try {
  assert.equal((await ask('', {contextMode:'zero', images, onProgress:update=>progress.push(update)})).answer, 'Visible error');
  assert.equal(progress.length, 2);assert.equal(progress[1].status, 'Model request 1');
 } finally {await ask.dispose();}
});

test('read-only Git folder chat does not create a review copy',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-readonly-chat-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 t.mock.method(require('../agent-worktree'),'repositoryOf',async()=>root);
 t.mock.method(require('../agent-worktree'),'open',async()=>assert.fail('read-only chat must not create a copy'));
 t.mock.method(assistant,'ask',async()=>({model:'test',plan:{answer:'Here is the answer',navigation:null,build_command:''}}));
 const vscode=fakeVscode({provider:'codex-subscription',model:'test'});
 vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:()=>({route:'/readonly',dispose(){}})};
 const ask=chat.create(vscode,{schemas:[],editorContext:()=>null},server,{get:async()=>null});
 try{assert.equal((await ask('Explain this project',{contextMode:'folder'})).answer,'Here is the answer');}
 finally{await ask.dispose();}
});
test('loading model placeholder is never sent to Codex',async t=>{
 let selected;
 t.mock.method(assistant,'ask',async options=>{selected=options.model;return {model:selected,plan:{answer:'Ready',navigation:null,build_command:''}};});
 const vscode=fakeVscode({provider:'codex-subscription',model:'gpt-6-luna'});
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:()=>({route:'/loading',dispose(){}})};
 const ask=chat.create(vscode,{schemas:[],editorContext:()=>null},server,{get:async()=>null});
 try{await ask('Explain this request in plain language',{model:'Loading…'});assert.equal(selected,'gpt-6-luna');}
 finally{await ask.dispose();}
});

for(const fixed of [true,false])test(`Jev sends a rejected exact Edit back for one real reread and recovery (${fixed})`,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-jev-recovery-')),file=path.join(root,'index.js'),before='const value = 1;\r\n';
 fs.writeFileSync(file,before);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const copy={folder:root,top:root,dir:root,cwd:root,refresh:async()=>[],remove:async()=>{},changes:async()=>{const after=fs.readFileSync(file,'utf8');return after===before?[]:[{file:'index.js',path:file,before,after,status:'changed'}];}};
 t.mock.method(require('../agent-worktree'),'open',async()=>copy);
 t.mock.method(require('../agent-worktree'),'repositoryOf',async()=>root);
 t.mock.method(require('../worktree-review'),'open',()=>({dispose(){},panel:{}}));
 t.mock.method(require('../build-runner'),'remembered',()=> '');
 let served,calls=0,decisions=0;
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:set=>{served=set;return {route:'/recover',dispose(){}};}};
 t.mock.method(assistant,'ask',async options=>{
   calls++;if(calls===2){assert.match(options.prompt,/old_string is not/);assert.match(options.prompt,/Read, Glob, Grep, Edit, Write and Bash are available/);assert.match(options.instructions,/one host-controlled recovery/);}
   await served.call({},'Read',{file_path:'index.js'});
   try{await served.call({},'Edit',{file_path:'index.js',old_string:calls===2&&fixed?'const value = 1;':'   const value = 1;',new_string:'const value = 2;'});}catch(error){assert.match(error.message,/old_string is not/);}
   return {model:'test',plan:{answer:calls===2&&fixed?'Fixed':'Edit failed',navigation:null,build_command:''},usage:{input_tokens:10,output_tokens:2}};
 });
 t.mock.method(require('../task-verification'),'verifyTask',async()=>{decisions++;return {status:decisions===2&&fixed?'passed':'failed',checks:[{check:'Requested edit',status:decisions===2&&fixed?'passed':'failed'}]};});
 const vscode=fakeVscode({provider:'codex-subscription',model:'test',logPath:root});vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
 const ask=chat.create(vscode,{schemas:[],editorContext:()=>null},server,{get:async()=>null});
 try{const result=await ask('Change value to 2',{contextMode:'folder'});assert.equal(calls,2);assert.equal(decisions,2);assert.equal(result.usage.input_tokens,20);assert.equal(result.taskVerification.status,fixed?'passed':'failed');assert.equal(fs.readFileSync(file,'utf8').includes('value = 2'),fixed);
 if(!fixed){
   assert.match(result.answer,/Continue working\?/);
   t.mock.method(assistant,'ask',async options=>{assert.equal(options.model,'better-model');assert.match(options.prompt,/Change value to 2/);assert.match(options.prompt,/Last recorded tool error/);await served.call({},'Read',{file_path:'index.js'});await served.call({},'Edit',{file_path:'index.js',old_string:'const value = 1;',new_string:'const value = 2;'});return {model:'better-model',plan:{answer:'Fixed after continuation',navigation:null,build_command:''}};});
   t.mock.method(require('../task-verification'),'verifyTask',async()=>({status:'passed',checks:[]}));
   assert.equal((await ask('continue',{contextMode:'folder',model:'better-model'})).answer.includes('Fixed after continuation'),true);
 }
 }finally{await ask.dispose();}
});

test("Jev change verification receives the user requests of the routed topic",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-topic-verification-")),file=path.join(root,"index.js"),before='const label = "Folder";\n';
 fs.writeFileSync(file,before);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const copy={folder:root,top:root,dir:root,cwd:root,refresh:async()=>[],remove:async()=>{},changes:async()=>{const after=fs.readFileSync(file,"utf8");return after===before?[]:[{file:"index.js",path:file,before,after,status:"changed"}];}};
 t.mock.method(require("../agent-worktree"),"open",async()=>copy);
 t.mock.method(require("../agent-worktree"),"repositoryOf",async()=>root);
 t.mock.method(require("../worktree-review"),"open",()=>({dispose(){},panel:{}}));
 t.mock.method(require("../build-runner"),"remembered",()=>"");
 t.mock.method(require("../review-jev"),"enabled",()=>true);
 t.mock.method(require("../skill-match"),"isVertexRepository",async()=>false);
 const topic={id:"topic_0001",label:"Replace Folder label",scope:"folder"};
 t.mock.method(require("../topic-routing"),"route",async(_v,_prompt,history)=>({topic,history,report:{status:"routed",keptIndices:history.map((_,i)=>i)}}));
 let served,verifiedTask;
 const server={token:"test",start:async()=>({url:"http://127.0.0.1:1/mcp"}),registerTools:set=>{served=set;return {route:"/chat",dispose(){}};}};
 t.mock.method(assistant,"ask",async()=>{await served.call({},"Read",{file_path:"index.js"});await served.call({},"Edit",{file_path:"index.js",old_string:before.trim(),new_string:'const label = "Project";'});return {model:"test",plan:{answer:"Updated",navigation:null,build_command:""},usage:{}};});
 t.mock.method(require("../task-verification"),"verifyTask",async(_v,task)=>{verifiedTask=task;return {status:"passed",checks:[]};});
 const vscode=fakeVscode({provider:"codex-subscription",model:"test"});vscode.workspace.workspaceFolders=[{uri:{scheme:"file",fsPath:root}}];
 const ask=chat.create(vscode,{schemas:[],editorContext:()=>null},server,{get:async()=>null});
 ask.restoreConversation([{question:"Remove the Folder label",answer:"First attempt failed",topic}]);
 try{await ask("repeat the changes",{contextMode:"folder",routeTopics:true});assert.match(verifiedTask,/Remove the Folder label.*repeat the changes/s);assert.doesNotMatch(verifiedTask,/First attempt failed/);}finally{await ask.dispose();}
});

test('standalone Folder builds do not trigger the code-change review check',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-global-build-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 t.mock.method(require('../agent-worktree'),'open',async()=>({folder:root,top:root,dir:root,cwd:root,refresh:async()=>[],remove:async()=>{},changes:async()=>[{file:'pending.js',before:'const x = 1;',after:'const x = 2;'}]}));
 t.mock.method(require('../worktree-review'),'open',()=>({dispose(){},panel:{}}));
 t.mock.method(require('../build-runner'),'remembered',()=> '');
 t.mock.method(require('../orchestrator-plan'),'connect',async()=>assert.fail('Not an MCP orchestration request'));
 const vscode=fakeVscode({provider:'codex-subscription',model:'test',logPath:root});vscode.window.showWarningMessage=async()=>"Allow";
 vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];let served,verified=0;
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:set=>{served=set;return {route:'/global',dispose(){}};}};
 t.mock.method(assistant,'ask',async()=>{const result=JSON.parse((await served.call({},'Bash',{command:'exit 0',purpose:'build'})).content[0].text);assert.equal(result.code,0);return {model:'test',plan:{answer:'Built',navigation:null,build_command:''}};});
 t.mock.method(require('../task-verification'),'verifyTask',async(_v,task,answer,evidence)=>{verified++;assert.equal(task,'Build now');assert.equal(answer,'Built');assert.equal(evidence.pending,0);assert.equal(evidence.tools[0].result.code,0);return {status:'passed',checks:[]};});
 const ask=chat.create(vscode,{schemas:[],orchestrator:()=>false,editorContext:()=>null},server,{get:async()=>null});
 try{const result=await ask('Build now',{contextMode:'folder'});assert.equal(result.taskVerification,null);assert.equal(verified,0);
 const text=fs.readFileSync(fs.readdirSync(path.join(root,'claude_compatible')).map(f=>path.join(root,'claude_compatible',f))[0],'utf8');assert.doesNotMatch(text,/vertex_task_verification/);
 }finally{await ask.dispose();}
});
test('ordinary API answers do not trigger a whole-task completion decision',async t=>{
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(require('../orchestrator-plan'),'connect',async()=>assert.fail('No MCP selection'));
 t.mock.method(compatible,'ask',async()=>({model:'test',plan:{answer:'Done',navigation:null,build_command:''}}));
 t.mock.method(require('../task-verification'),'verifyTask',async()=>({status:'failed',checks:[{check:'Unsupported action claim',status:'failed'}]}));
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'test',contextMode:'folder'}),{schemas:[],editorContext:()=>null},null,{get:async()=>null});
 try{const result=await ask('Explain');assert.equal(result.taskVerification,null);assert.equal(result.answer,'Done');}finally{await ask.dispose();}
});
test('Stop cancels the global decision and does not publish a late verification',async t=>{
 t.mock.method(require('../task-verification'),'createEvidence',()=>({record(){},step(){},snapshot:()=>({tools:[{tool:'Edit'}]})}));
 let ready;const started=new Promise(resolve=>{ready=resolve;});
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(compatible,'ask',async()=>({model:'test',plan:{answer:'Done',navigation:null,build_command:''}}));
 t.mock.method(require('../task-verification'),'verifyTask',async(_v,_t,_a,_e,options)=>{ready();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));});
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'test',contextMode:'folder'}),{schemas:[],editorContext:()=>null},null,{get:async()=>null});
 const pending=ask('Explain');await started;ask.stop();assert.equal((await pending).stopped,true);await ask.dispose();
});

test('a premature CLI answer waits for the command and receives completed results before finishing',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-late-build-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 t.mock.method(require('../agent-worktree'),'open',async()=>null);
 const vscode=fakeVscode({provider:'codex-subscription',model:'test',logPath:root});
 vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];vscode.window.showWarningMessage=async()=>"Allow";
 let served,calls=0,command;
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:set=>{served=set;return {route:'/late',dispose(){}};}};
 t.mock.method(assistant,'ask',async options=>{
   if(++calls===1){command=served.call({},'Bash',{command:process.platform==='win32'?'Write-Output completed-build':'printf completed-build',purpose:'build'});return {plan:{answer:'Still working'},model:'test'};}
   assert.match(options.prompt,/VERTEX host completion results/);assert.match(options.prompt,/completed-build/);
   const result=JSON.parse((await command).content[0].text);assert.equal(result.code,0);
   return {plan:{answer:'Build finished',navigation:null,build_command:''},model:'test'};
 });
 const ask=chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},server,{get:async()=>null});
 try{assert.equal((await ask('Build now',{contextMode:'folder'})).answer,'Build finished');assert.equal(calls,2);}finally{await ask.dispose();}
});

test('a timed-out Codex tool cannot run after a late Allow',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-stale-allow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 t.mock.method(require('../agent-worktree'),'open',async()=>null);
 const vscode=fakeVscode({provider:'codex-subscription',model:'test',logPath:root});
 vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
 let allow,shown;const dialog=new Promise(resolve=>{shown=resolve;});
 vscode.window.showWarningMessage=()=>{shown();return new Promise(resolve=>{allow=resolve;});};
 let served,calls=0,toolError;
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:set=>{served=set;return {route:'/stale',dispose(){}};}};
 t.mock.method(assistant,'ask',async()=>{
   if(++calls===1){const command=process.platform==='win32'?'Set-Content -LiteralPath stale.txt -Value stale':'printf stale > stale.txt';served.call({},'Bash',{command,purpose:'build'}).catch(error=>{toolError=error;});return {plan:{answer:'Tool timed out'},model:'test'};}
   return {plan:{answer:'The tool did not run',navigation:null,build_command:''},model:'test'};
 });
 const ask=chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},server,{get:async()=>null});
 try {
   const result=ask('Build now',{contextMode:'folder'});
   await dialog;
   assert.equal((await result).answer,'The tool did not run');
   allow('Allow');await new Promise(resolve=>setImmediate(resolve));
   assert.match(toolError.message,/model request ended/);
   assert.equal(fs.existsSync(path.join(root,'stale.txt')),false);
 } finally {await ask.dispose();}
});

function fakeVscode(settings) {
  return {
    ConfigurationTarget: { Global: 1 },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => (key in settings ? settings[key] : fallback),
      update: async (key, value) => { settings[key] = value; } }) },
    extensions: { getExtension: () => ({ extensionPath: "/ext" }) },
    window: { tabGroups: { all: [{ isActive: true, tabs: [{ label: "z_calc.prog.abap", isActive: true, isDirty: false,
      input: { uri: { scheme: "file", fsPath: "C:\\git\\z_calc.prog.abap" } } }] }] } }
  };
}

test("VERTEX can select a project folder without changing the VS Code workspace",async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-open-workspace-"));
 const selected=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-selected-project-"));
 t.after(()=>{fs.rmSync(workspace,{recursive:true,force:true});fs.rmSync(selected,{recursive:true,force:true});});
 const vscode=fakeVscode({provider:"codex-subscription",contextMode:"folder"});
 vscode.workspace.workspaceFolders=[{uri:{scheme:"file",fsPath:workspace}}];
 vscode.Uri={file:fsPath=>({fsPath,scheme:"file"})};
 vscode.window.showOpenDialog=async()=>[{fsPath:selected}];
 const stored=new Map(),memory={get:(key,fallback)=>stored.get(key)??fallback,update:async(key,value)=>stored.set(key,value)};
 const ask=chat.create(vscode,{schemas:[],editorContext:()=>null},null,{get:async()=>null},null,null,memory);
 assert.equal(chat.currentWorkingFolder(vscode),workspace);
 const state=await ask.chooseContextFolder();
 assert.equal(state.contextFolder,selected);assert.equal(chat.currentWorkingFolder(vscode),selected);
 assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath,workspace);
  assert.equal(stored.get("vertex.ai.selectedFolder:"+workspace),selected);
  vscode.window.activeTextEditor={document:{uri:{scheme:"file",fsPath:path.join(workspace,"README.md")}}};
  vscode.workspace.getWorkspaceFolder=()=>vscode.workspace.workspaceFolders[0];
  assert.equal(chat.currentWorkingFolder(vscode),selected,"explicit selection overrides the active editor's workspace folder");
  vscode.window.showQuickPick=async items=>items.find(item=>item.kind==="auto");
  assert.equal((await ask.chooseContextFolder()).contextFolder,workspace);
  assert.equal(chat.currentWorkingFolder(vscode),workspace);
 await ask.dispose();
});
test("review task contains only user requests of the selected topic, in order",()=>{
 const topic={id:"topic_0002"};
 const conversation=[{role:"user",content:"Another project",topic:{id:"topic_0001"}},
  {role:"user",content:"Show percent progress for 20000 entries",topic},
  {role:"assistant",content:"I already changed it",topic},
  {role:"user",content:"Improve the existing program",topic}];
 const task=chat.reviewTask(conversation,topic,"Update the progress indicator");
 assert.match(task,/Show percent progress.*Improve the existing program.*Update the progress indicator/s);
 assert.doesNotMatch(task,/Another project|I already changed it/);
});

test("matched VSIX build uses Jev decision and local Bash without the selected LLM", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-skill-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vscode = fakeVscode({ provider: "codex-subscription", model: "test-model" });
  vscode.workspace.workspaceFolders = [{ uri: { scheme: "file", fsPath: root } }];
  t.mock.method(require("../agent-worktree"), "repositoryOf", async () => root);
  t.mock.method(require("../review-jev"), "enabled", () => true);
  t.mock.method(require("../skill-match"), "match", async () => ({ matched: true, skill: { name: "build-vertex-vsix", content: "VSIX" }, versionChoice: "current", usage: {} }));
  t.mock.method(require("../vsix-workflow"), "prepare", () => ({ action: "current", version: "0.9.104", command: "package-command" }));
  let calls = 0;
  t.mock.method(require("../folder-tools"), "create", () => ({ schemas: [], dispose() {}, call: async (name, args) => {
    calls++; assert.equal(name, "Bash"); assert.equal(args.purpose, "build");
    return { code: 0, verified_vsix: { file: path.join(root, "vscode", "vertex-abap-0.9.104.vsix") } };
  } }));
  t.mock.method(assistant, "ask", async () => assert.fail("The selected LLM must not run"));
  const ask = chat.create(vscode, { schemas: [], editorContext: () => null }, {}, { get: async () => null });
  try { assert.match((await ask("собери всикс", { contextMode: "folder" })).answer, /built and verified/); assert.equal(calls, 1); }
  finally { await ask.dispose(); }
});

test("matched VSIX version stages review and builds only after every file is applied", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-skill-version-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vscode = fakeVscode({ provider: "codex-subscription", model: "test-model" });
  vscode.workspace.workspaceFolders = [{ uri: { scheme: "file", fsPath: root } }];
  vscode.window.showInformationMessage = () => {};
  vscode.window.showErrorMessage = () => {};
  t.mock.method(require("../agent-worktree"), "repositoryOf", async () => root);
  t.mock.method(require("../review-jev"), "enabled", () => true);
  t.mock.method(require("../skill-match"), "match", async () => ({ matched: true, skill: { name: "build-vertex-vsix", content: "VSIX" }, versionChoice: "increment", usage: {} }));
  t.mock.method(require("../vsix-workflow"), "prepare", () => ({ action: "version", current: "0.9.104", version: "0.9.105", command: ".\\vscode\\package.ps1" }));
  let staged = false, onDone, built = 0;
  const changes = [{ file: "vscode/package.json", path: path.join(root, "vscode/package.json"), before: "old", after: "new" }];
  const copy = { folder: root, cwd: root, top: root, refresh: async () => [], remove: async () => {}, changes: async () => staged ? changes : [] };
  t.mock.method(require("../agent-worktree"), "open", async () => copy);
  t.mock.method(require("../vsix-workflow"), "stage", () => { staged = true; });
  t.mock.method(require("../worktree-review"), "open", (_v, _copy, _changes, callback) => { onDone = callback; return { dispose() {} }; });
  t.mock.method(require("../build-runner"), "remembered", () => "");
  t.mock.method(require("../build-runner"), "run", async () => { built++; return { code: 1, stderr: "build failed" }; });
  t.mock.method(assistant, "ask", async () => assert.fail("The selected LLM must not run"));
  const ask = chat.create(vscode, { schemas: [], editorContext: () => null }, {}, { get: async () => null });
  try {
    assert.match((await ask("VSIX +1", { contextMode: "folder" })).answer, /Review the diff/);
    assert.equal(built, 0); assert.equal(typeof onDone, "function");
    onDone({ applied: [], failed: [], reworked: [], dropped: [changes[0].file] });
    assert.equal(built, 0);
    onDone({ applied: [changes[0].file], failed: [], reworked: [], dropped: [] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(built, 1);
  } finally { await ask.dispose(); }
});

for (const fix of [true, false]) test(`host checks run before review and permit only one repair (${fix ? 'fixed' : 'still broken'})`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-host-check-'));
  const file = path.join(root, 'index.js'); fs.writeFileSync(file, 'const x = 1;');
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const copy = {folder:root,top:root,dir:root,cwd:root,refresh:async()=>[],remove:async()=>{},changes:async()=>{
    const after=fs.readFileSync(file,'utf8');return after==='const x = 1;'?[]:[{file:'index.js',path:file,before:'const x = 1;',after,status:'changed'}];
  }};
  t.mock.method(require('../agent-worktree'),'open',async()=>copy);
  t.mock.method(require('../agent-worktree'),'repositoryOf',async()=>root);
  t.mock.method(require('../build-runner'),'remembered',()=> '');
  let reviews=0,served,calls=0;
  let checked=0;
  t.mock.method(require('../task-verification'),'verifyTask',async(_v,_task,_answer,evidence)=>{checked++;assert.equal(calls,2);assert.equal(reviews,0);assert.equal(evidence.hostChecks.state,fix?'passed':'failed');return {status:fix?'passed':'failed',checks:[]};});
  t.mock.method(require('../worktree-review'),'open',()=>{reviews++;assert.equal(calls,2);return {dispose(){}};});
  const vscode=fakeVscode({provider:'codex-subscription',model:'test-model'});
  vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
  const server={token:'t',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:set=>{served=set;return {route:'/chat/test',dispose(){}};}};
  t.mock.method(assistant,'ask',async options=>{
    calls++;
    if(calls===2)assert.match(options.prompt,/no-undef.*missing/);
    await served.call({},'Read',{file_path:'index.js'});
    await served.call({},'Write',{file_path:'index.js',content:calls===2&&fix?'const x = 2;':'missing();'});
    return {plan:{answer:'Done',build_command:''},model:'test-model',usage:{input_tokens:10,output_tokens:2}};
  });
  const ask=chat.create(vscode,{schemas:[],editorContext:()=>null},server,{get:async()=>null});
  const result=await ask('Change the project',{contextMode:'folder'});
  assert.equal(calls,2);assert.equal(reviews,1);
  assert.equal(checked,1);
  assert.equal(result.verification.state,fix?'passed':'failed');
  assert.match(result.answer,fix?/automatic checks: PASSED/:/automatic checks: FAILED/);
  assert.equal(result.usage.input_tokens,20);
  await ask.dispose();
});

test("API model catalogs survive restart, coalesce loads and refresh only explicitly",async t=>{
 const settings={provider:'openrouter-api',model:'vendor/a',modelConfig:{'openrouter-api':{enabled:['vendor/a'],known:['vendor/a','vendor/b']}}};
 const saved=new Map(),memory={get:k=>saved.get(k),update:async(k,v)=>{saved.set(k,JSON.parse(JSON.stringify(v)));}};
 let calls=0,key='private-test-key';t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key}));
 t.mock.method(compatible,'models',async()=>{calls++;await new Promise(r=>setTimeout(r,10));return [{id:'vendor/a',label:'Model A',revision:calls},{id:'vendor/b',label:'Model B',revision:calls}];});
 const create=()=>chat.create(fakeVscode(settings),{schemas:[],instructions:'',editorContext:()=>null},null,{},null,null,memory);
 const first=create();await Promise.all([first.listModels(),first.listModels()]);assert.equal(calls,1);
 const restarted=create();assert.equal((await restarted.listModels()).models[0].label,'Model A');assert.equal(calls,1,'restart reads the persisted catalog');
 settings.modelConfig['openrouter-api'].enabled=['vendor/b'];assert.equal((await restarted.listModels()).models[0].id,'vendor/b');assert.equal(calls,1,'selection changes use the saved full catalog');
 let load,forget;t.mock.method(require('../model-config'),'open',(_v,full,_e,invalidate)=>{load=full;forget=invalidate;});
 restarted.configModels();await load('openrouter-api');assert.equal(calls,1,'opening settings does not rebuild catalogs');
 forget('openrouter-api');await load('openrouter-api');assert.equal(calls,2,'settings refresh explicitly rebuilds the catalog');
 await restarted.listModels(true);assert.equal(calls,3);
 assert.equal((await first.listModels()).models[0].revision,3,'other panels see the explicitly rebuilt shared catalog');assert.equal(calls,3);
 key='another-private-key';await restarted.listModels();assert.equal(calls,4,'a new credential scope needs its own catalog');
 key='private-test-key';await restarted.listModels();assert.equal(calls,4,'returning to a cached credential scope uses its catalog');
 assert.doesNotMatch(JSON.stringify([...saved]),/private-test-key|another-private-key/);
});

test("local loaded-model lists remain live instead of using persisted catalogs",async t=>{
 let calls=0;t.mock.method(compatible,'models',async()=>{calls++;return [{id:'local',loaded:true}];});
 const memory={get(){throw Error('Local catalog must not use persistent cache');},update(){throw Error('Local catalog must not be saved');}};
 const ask=chat.create(fakeVscode({provider:'lmstudio-local'}),{schemas:[]},null,null,null,null,memory);
 await ask.listModels();await ask.listModels();assert.equal(calls,2);
});

test("the VS Code chat sends the conversation so far, and a new conversation starts empty", async (t) => {
  const prompts = [];
  let instructions = "";
  t.mock.method(assistant, "ask", async options => {
    prompts.push(options.prompt);
    instructions = options.instructions;
    return { plan: { answer: "Answer " + prompts.length }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const server = { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools, server);

  assert.equal((await ask("show Z_CALC")).answer, "Answer 1");
  await ask("and the second method?");
  assert.match(prompts[1], /show Z_CALC/);
  assert.match(prompts[1], /Answer 1/);
  assert.match(prompts[1], /Request:\nand the second method\?/);
  assert.match(prompts[1], /z_calc\.prog\.abap/);
  assert.match(instructions, /If a tool fails/);

  ask.newConversation();
  await ask("hello there");
  assert.doesNotMatch(prompts[2], /show Z_CALC|Answer 1/);
});

test("restored unanswered screenshots are references instead of repeated image input", async t => {
  let received;
  t.mock.method(assistant, "ask", async options => { received=options; return {plan:{answer:"Seen"},model:"haiku"}; });
  const ask=chat.create(fakeVscode({provider:"claude-subscription",model:"haiku"}),
    {schemas:[],instructions:"",editorContext:()=>null},{start:async()=>({url:"http://127.0.0.1:1/mcp"}),token:"t"});
  const image={media_type:"image/png",data:Buffer.from("restored screenshot").toString("base64")};
  assert.equal(ask.restoreConversation([{question:"Last screenshot question",answer:"Session limit reached",failed:true,images:[image]}]),1);
  await ask("Continue from the last screenshot");
  assert.equal(received.images,undefined);
  assert.match(received.prompt,/reattach to inspect/);
  assert.match(received.prompt,/Last screenshot question/);
  assert.doesNotMatch(received.prompt,/Session limit reached/);
});

test("historical screenshots do not intercept a new SAP object-name navigation", async t => {
  t.mock.method(assistant,'ask',async()=>{assert.fail('No model expected for a bare object name');});
  const calls=[];
  const tools={schemas:[],editorContext:()=>null,execute:async(name,args)=>{calls.push([name,args]);return name==='search_sap_objects'?{objects:[{object_type:'PROG',object_name:'Z_FIORI_TILES_AI_TRANSLATOR'}]}:{opened:true};}};
  const ask=chat.create(fakeVscode({provider:'claude-subscription',contextMode:'sap'}),tools,{start:async()=>{assert.fail('No model endpoint expected');}});
  ask.restoreConversation([{question:'Earlier screenshot',answer:'Earlier answer',images:[{media_type:'image/png',data:'aW1hZ2U='}]}]);
  const reply=await ask('Z_FIORI_TILES_AI_TRANSLATOR',{contextMode:'sap'});
  assert.equal(reply.direct,true);
  assert.deepEqual(calls.map(([name])=>name),['search_sap_objects','open_sap_object']);
  assert.equal(calls[1][1].object_name,'Z_FIORI_TILES_AI_TRANSLATOR');
});

test("a current screenshot keeps a SAP-looking name in the model question", async t => {
  let received;
  t.mock.method(assistant,'ask',async options=>{received=options;return{plan:{answer:'Screenshot answer'},model:'test'};});
  const tools={schemas:[],instructions:'',editorContext:()=>null,execute:async()=>{assert.fail('No direct navigation when the current message has a screenshot');}};
  const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test',contextMode:'sap'}),tools,{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
  const images=[{media_type:'image/png',data:'aW1hZ2U='}];
  const reply=await ask('Z_FIORI_TILES_AI_TRANSLATOR',{contextMode:'sap',images});
  assert.equal(reply.answer,'Screenshot answer');assert.equal(received.images,undefined);
});

test("direct SAP navigation is retained in the conversation log", async t => {
  const logger=require('../session-log'),report=require('../log-report');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-direct-navigation-'));
  try {
    logger.reset();
    t.mock.method(assistant,'ask',async()=>{assert.fail('No model expected');});
    const tools={schemas:[],editorContext:()=>null,execute:async name=>name==='search_sap_objects'?{objects:[{object_type:'PROG',object_name:'Z_TEST'}]}:{opened:true}};
    const ask=chat.create(fakeVscode({provider:'claude-subscription',contextMode:'sap',logPath:root,'log.questions':true,'log.answers':true}),tools,{});
    await ask('Z_TEST',{contextMode:'sap'});
    const data=report.readSessions(root);
    assert.equal(data.sessions.length,1);
    const turns=report.conversationTurns(data,data.sessions[0].id).turns;
    assert.equal(turns[0].question,'Z_TEST');assert.match(turns[0].answer,/Opened PROG/);
  } finally {logger.reset();fs.rmSync(root,{recursive:true,force:true});}
});

test("a generic debug request cannot call the SAP debugger", async t => {
  const calls = [];
  t.mock.method(assistant, "ask", async options => {
    calls.push(options);
    return { plan: { answer: "Done" }, model: "sonnet", usage: null };
  });
  const tools = { schemas: ["run_abap_transpiler", "debug_start", "debug_wait"].map(name => ({ name, inputSchema: {} })),
    instructions: "", editorContext: () => null, execute: async name => ({ name }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "sonnet" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("Найди ошибку в Z_CALC дебаггером");
  assert.deepEqual(calls[0].tools, ["run_abap_transpiler"]);
  await ask("Запусти Z_CALC в SAP debugger");
  assert.deepEqual(calls[1].tools, ["run_abap_transpiler", "debug_start", "debug_wait"]);
});

test("a new conversation accepts a request while an old SAP debug wait is still running", async t => {
  let finishOld;
  const prompts = [];
  t.mock.method(assistant, "ask", options => {
    prompts.push(options.prompt);
    if (prompts.length === 1) return new Promise(resolve => { finishOld = resolve; });
    return Promise.resolve({ plan: { answer: "New answer" }, model: "sonnet", usage: null });
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const server = { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "sonnet" }), tools, server);
  const old = ask("debug in SAP");
  await new Promise(resolve => setImmediate(resolve));
  ask.newConversation();
  const next = await ask("find the error with the transpiler", { model: "new-selected-model" });
  assert.equal(next.answer, "New answer");
  assert.doesNotMatch(prompts[1], /debug in SAP/);
  assert.equal(assistant.ask.mock.calls[1].arguments[0].model, "new-selected-model");
  finishOld({ plan: { answer: "Old debugger answer" }, model: "haiku", usage: null });
  assert.equal((await old).superseded, true);
  await ask("follow up");
  assert.doesNotMatch(prompts[2], /Old debugger answer|debug in SAP/);
});

test("the VERTEX chat routes Copilot through VS Code with its SAP tools", async (t) => {
  let received;
  t.mock.method(copilot, "models", async () => [{ id: "model-one", label: "Model One" }]);
  t.mock.method(copilot, "ask", async (vscode, options) => {
    received = options;
    return { plan: { answer: "Done", navigation: null }, model: options.model, usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", description: "Read", inputSchema: {} }],
    instructions: "Read SAP", editorContext: () => null, execute: async () => ({ source: "ok" }) };
  const ask = chat.create(fakeVscode({ provider: "copilot", model: "" }), tools,
    { start: async () => { throw new Error("Copilot must not start an MCP server"); } });
  assert.equal((await ask("explain this class")).answer, "Done");
  assert.equal(received.model, "model-one");
  assert.deepEqual(received.tools.map(tool => tool.name), ["read_sap_object"]);
  assert.deepEqual(await received.callTool("read_sap_object", {}), { source: "ok" });
});

test("the VERTEX chat routes a key provider through its API with SAP tools", async (t) => {
  let received;
  t.mock.method(compatible, "models", async id => {
    assert.equal(id, "groq-api"); return [{ id: "groq-test", label: "Groq Test" }];
  });
  t.mock.method(compatible, "ask", async options => {
    received = options;
    return { plan: { answer: "Done", navigation: null }, model: options.model, usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", description: "Read", inputSchema: {} }],
    instructions: "Read SAP", editorContext: () => null, execute: async () => ({ source: "ok" }) };
  const ask = chat.create(fakeVscode({ provider: "groq-api", model: "" }), tools,
    { start: async () => { throw new Error("API provider must not start an MCP server"); } },
    { get: async key => key === "vertex.provider.groq-api.apiKey" ? "secret" : null });
  assert.equal((await ask("explain this class")).answer, "Done");
  assert.equal(received.assistant, "groq-api");
  assert.equal(received.apiKey, "secret");
  assert.equal(received.model, "groq-test");
  assert.deepEqual(received.tools.map(tool => tool.name), ["read_sap_object"]);
});

test("debug secrets are removed from model prompts and tool results while live values stay intact",async t=>{
  const secret='live-context-fixture-secret';let received;
  t.mock.method(compatible,'ask',async options=>{received=options;return{plan:{answer:'Done',navigation:null},model:options.model};});
  const live={session_id:'fixture',recorded:{stops:1,steps:[],value_history:{stops:[{values:[{name:'I_APIKEY',value:secret}]}]}},alias:secret};
  const tools={schemas:[{name:'read_sap_object',inputSchema:{}}],instructions:'SAP',editorContext:()=>null,
    execute:async()=>({variables:[{name:'PASSWORD',value:'tool-password-fixture'}],source:'DATA lv_text TYPE string.'})};
  const ask=chat.create(fakeVscode({provider:'groq-api',model:'test'}),tools,{}, {get:async()=>''},()=>live);
  await ask('Explain the recorded values');
  assert.ok(!received.prompt.includes(secret));assert.match(received.prompt,/session fixture step 1/);assert.doesNotMatch(received.prompt,/REDACTED|"recorded"|"suspects"/);
  assert.equal(live.alias,secret);
  const result=await received.callTool('read_sap_object',{});assert.ok(!JSON.stringify(result).includes('tool-password-fixture'));assert.match(JSON.stringify(result),/DATA lv_text TYPE string\./,'code in a tool result goes as written');
});

test("native CLI requests use the same protected context scope for later tool responses",async t=>{
  const secret='native-fixture-credential';let endpoint,disposed=false;
  const live={recorded:{stops:1,variables:[{name:'I_APIKEY',value:secret}]},session_id:'fixture'};
  const server={start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t',registerTools:tools=>{endpoint=tools;return{route:'/private-test',dispose(){disposed=true;}};}};
  t.mock.method(assistant,'ask',async options=>{
    assert.match(options.url,/private-test/);
    const result=await endpoint.call(null,'read_sap_object',{});
    assert.ok(!JSON.stringify(result).includes(secret));
    return{plan:{answer:'Done'},model:'test'};
  });
  const tools={schemas:[{name:'read_sap_object',inputSchema:{}}],instructions:'SAP',editorContext:()=>null,execute:async()=>({variables:[{name:'I_APIKEY',value:secret}]})};
  const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test',contextMode:'sap'}),tools,server,{},()=>live);
  await ask('Explain recorded state',{contextMode:'sap'});
  assert.equal(disposed,true);
});

test("every direct model round is a separate Anthropic-format log entry", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-rounds-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(compatible, "ask", async options => {
    options.onModelCall({ model: "mistral-test", usage: { input_tokens: 10, output_tokens: 2 }, text: "" });
    options.onModelCall({ model: "mistral-test", usage: { input_tokens: 20, output_tokens: 3 }, text: "Done" });
    return { plan: { answer: "Done", navigation: null }, model: "mistral-test",
      usage: { input_tokens: 30, output_tokens: 5 } };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const ask = chat.create(fakeVscode({ provider: "mistral-api", model: "mistral-test", logPath: root,
    "log.questions": true, "log.answers": true }), tools, {}, { get: async () => "secret" });
  await ask("Explain this");
  const dir = path.join(root, "claude_compatible");
  const file = fs.readdirSync(dir).find(name => name.endsWith(".jsonl"));
  const lines = fs.readFileSync(path.join(dir, file), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(line => line.type), ["user", "vertex_context_size", "assistant", "assistant"]);
  const answers = lines.filter(line => line.type === "assistant");
  assert.deepEqual(answers.map(line => line.message.usage.output_tokens), [2, 3]);
  assert.equal(answers[1].message.content[0].text, "Done");
});

test("a selected fragment from an external ADT editor is sent to VERTEX chat", async (t) => {
  let prompt = "";
  t.mock.method(assistant, "ask", async options => {
    prompt = options.prompt;
    return { plan: { answer: "It is a type declaration." }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", execute: async () => ({}), editorContext: () => ({
    selected_fragment: { text: "TYPES: BEGIN OF ty_part.", path: "C:\\work\\zcl_test.clas.abap", language: "abap", start_line: 15, end_line: 15 }
  }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("а выделенная часть кода");
  assert.match(prompt, /Selected code fragment/);
  assert.match(prompt, /TYPES: BEGIN OF ty_part/);
  assert.doesNotMatch(prompt, /Active SAP editor context/);
});

test("the active editor's full source is never silently added to a chat prompt", async (t) => {
  let prompt = "";
  t.mock.method(assistant, "ask", async options => {
    prompt = options.prompt;
    return { plan: { answer: "Done." }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => ({ source: "SECRET_FULL_SOURCE_".repeat(10000) }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("найди транспорт Z12345");
  assert.doesNotMatch(prompt, /SECRET_FULL_SOURCE/);
});

test("a question about the open SAP code uses the tab source without a redundant read", async (t) => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "Visible program.", navigation: null }, model: "haiku", usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", inputSchema: {} }], instructions: "SAP tools",
    editorContext: () => ({ system_name: "ALC", object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB",
      source: "REPORT zvertex_debug_lab.\nSTART-OF-SELECTION." }) };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("что видишь");
  assert.match(request.prompt, /Active SAP editor source/);
  assert.match(request.prompt, /REPORT zvertex_debug_lab/);
  assert.match(request.instructions, /Do not read the same object again/);
});

test("the chat reads the active local ABAP document without a SAP system", async (t) => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "It calls ZCL_CALC.", navigation: null }, model: "haiku", usage: null };
  });
  const vscode = fakeVscode({ provider: "claude-subscription", model: "haiku", systems: [] });
  vscode.window.activeTextEditor = { document: { languageId: "abap",
    uri: { scheme: "file", fsPath: "C:\\work\\zvertex_debug_lab.prog.abap" },
    getText: () => "REPORT zvertex_debug_lab.\nDATA(result) = NEW zcl_calc( )->run( )." } };
  const tools = { schemas: [{ name: "read_sap_object", description: "Read SAP", inputSchema: {} }],
    instructions: "SAP system tools", editorContext: () => null };
  const ask = chat.create(vscode, tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  assert.equal((await ask("можешь прочитать этот код?")).answer, "It calls ZCL_CALC.");
  assert.match(request.prompt, /REPORT zvertex_debug_lab/);
  assert.match(request.prompt, /NEW zcl_calc/);
  assert.match(request.instructions, /No SAP system is configured/);
  assert.deepEqual(request.tools, []);
});

test("the chat reads the whole ABAP source another extension's editor holds, not a fragment of it", async (t) => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "It reads notifications.", navigation: null }, model: "haiku", usage: null };
  });
  const vscode = fakeVscode({ provider: "claude-subscription", model: "haiku", systems: [] });
  // ABAP remote filesystem: an adt:// document, opened from a system VERTEX does not have.
  const text = "REPORT zman_test_ccs.\nTYPES BEGIN OF type_data.\nDATA lt_data TYPE ttype_data.";
  vscode.window.activeTextEditor = { document: { languageId: "abap",
    uri: { scheme: "adt", path: "/Local Objects ($TMP)/zman_test_ccs.prog.abap", toString: () => "adt://icd_001/Local%20Objects/zman_test_ccs.prog.abap" },
    getText: () => text } };
  const ask = chat.create(vscode, { schemas: [], instructions: "", editorContext: () => null },
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  assert.equal((await ask("видишь ли ты весь код этой программы?")).answer, "It reads notifications.");
  assert.match(request.prompt, /DATA lt_data TYPE ttype_data/);
  assert.match(request.prompt, /adt:\/\/icd_001/);
  assert.match(request.instructions, /another extension \(adt\) opened it/);
  assert.match(request.instructions, /do not say only a fragment is visible/);
  // VERTEX's own SAP tab comes through editorContext, not as another editor's document.
  vscode.window.activeTextEditor = { document: { languageId: "abap", uri: { scheme: "vertex-sap", path: "/zx.prog.abap" }, getText: () => "REPORT zx." } };
  assert.equal(chat.localAbapContext(vscode), null);
});

test("an active UML view is sent as diagram context and is analysed without requesting an object", async (t) => {
  let prompt = "", instructions = "";
  t.mock.method(assistant, "ask", async options => {
    prompt = options.prompt; instructions = options.instructions;
    return { plan: { answer: "The package has one implementation relationship." }, model: "haiku", usage: null };
  });
  const tools = { schemas: [], instructions: "", editorContext: () => null };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("UML видишь?", { state: { vertex_view: { type: "DEVC", name: "Z_AVE", view: "uml",
    object_count: 2, uml: { nodes: [{ name: "ZCL_A", kind: "class", methods: ["RUN"] },
      { name: "ZIF_B", kind: "interface", methods: [] }],
      edges: [{ source: "ZCL_A", target: "ZIF_B", kind: "implementation" }] } } } });
  assert.match(prompt, /function-specific context/);
  assert.match(prompt, /ZCL_A/);
  assert.match(prompt, /implementation/);
  assert.match(instructions, /supplied code or UML/);
  assert.match(instructions, /do not search the package again/);
});

test("the package Navigator gives the assistant its loaded objects and asks for a substantive answer", async t => {
  let request;
  t.mock.method(assistant, "ask", async options => {
    request = options;
    return { plan: { answer: "The package calculates shipping prices.", navigation: null }, model: "haiku", usage: null };
  });
  const tools = { schemas: [{ name: "read_sap_object", description: "Read SAP source", inputSchema: {} }],
    instructions: "SAP tools", editorContext: () => null };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("Что делается в пакете?", { state: { workspace: { name: "Z_RIG", type: "DEVC" },
    vertex_view: { view: "navigator", name: "Z_RIG", type: "DEVC", loaded_nodes: [
      { depth: 2, label: "ZCL_CALC_FACADE", name: "ZCL_CALC_FACADE", type: "CLAS" },
      { depth: 2, label: "ZVERTEX_DEBUG_LAB", name: "ZVERTEX_DEBUG_LAB", type: "PROG" } ] } } });
  assert.match(request.prompt, /ZCL_CALC_FACADE/);
  assert.match(request.prompt, /ZVERTEX_DEBUG_LAB/);
  assert.match(request.instructions, /read a small representative set of sources/);
  assert.match(request.instructions, /do not merely open the Navigator/);
  assert.deepEqual(request.tools, ["read_sap_object"]);
});

test("a question about the visible method keeps the tools and is told to answer from the screen", async (t) => {
  let available = [], told = "";
  t.mock.method(assistant, "ask", async options => {
    available = options.tools; told = options.instructions;
    return { plan: { answer: "It appends a diagnostic." }, model: "haiku", usage: null };
  });
  const tools = { instructions: "", editorContext: () => null, schemas: [
    { name: "search_sap_objects", description: "search", inputSchema: {} },
    { name: "read_sap_object", description: "read", inputSchema: {} },
    { name: "open_sap_object", description: "open", inputSchema: {} }
  ] };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }), tools,
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("кратко: что делает метод?", { state: { selected_fragment: { kind: "visible_part",
    text: "METHOD add_cr_diag. APPEND iv_text TO mt_cr_diag. ENDMETHOD." } } });
  // A window on screen no longer takes the tools away; the model is told to
  // answer from what it shows and not to read the object again.
  assert.deepEqual(available, ["search_sap_objects", "read_sap_object", "open_sap_object"]);
  assert.match(told, /answer from it and do not read the object again/);
});

test("a bare object name is searched and opened without a model", async (t) => {
  const direct = require("../direct-search");
  assert.equal(direct.isObjectName("Z_CALC"), true);
  assert.equal(direct.isObjectName("ZCL_TR_*"), true);
  assert.equal(direct.isObjectName("show Z_CALC"), false);
  assert.deepEqual(direct.objectRequest("Open Z_CALC please"), { query: "Z_CALC", openEditor: true });
  assert.equal(direct.isObjectName("123"), false);
  assert.equal(direct.isObjectName("hello"), false);
  assert.equal(direct.isObjectName("ZREPORT"), true);
  assert.equal(direct.isObjectName("RSUSR003"), true);

  const calls = [];
  const asked = t.mock.method(assistant, "ask", async () => { throw new Error("no model expected"); });
  const tools = { schemas: [], instructions: "", editorContext: () => null,
    execute: async (tool, args) => {
      calls.push([tool, args]);
      if (tool === "open_sap_object") { return { opened: true }; }
      return { system: "QAS / DEV / 100", objects: args.query === "Z_CALC"
        ? [{ object_name: "Z_CALC", object_type: "PROG", package: "$TMP" }, { object_name: "Z_CALC2", object_type: "PROG", package: "$TMP" }]
        : [], truncated: false };
    } };
  const server = { start: async () => { throw new Error("no server expected"); } };
  const ask = chat.create(fakeVscode({ provider: "claude-subscription" }), tools, server);

  const opened = await ask("z_calc");
  assert.equal(opened.direct, true);
  assert.match(opened.answer, /Opened PROG \*\*Z_CALC\*\*.*QAS/);
  assert.deepEqual(opened.choices, [
    { object_type: "PROG", object_name: "Z_CALC" },
    { object_type: "DEVC", object_name: "$TMP" }
  ]);
  assert.match(opened.answer, /package \*\*\$TMP\*\*/);
  assert.deepEqual(calls[1], ["open_sap_object", { object_type: "PROG", object_name: "Z_CALC" }]);
  const explicit = await ask("Open Z_CALC please", { state: { workspace: { type: "CLAS", name: "Z_OTHER" } } });
  assert.equal(explicit.direct, true);
  assert.deepEqual(calls[3], ["open_sap_object", { object_type: "PROG", object_name: "Z_CALC" }]);
  assert.match((await ask("ZNOTHING")).answer, /No program, class, function module or package named \*\*ZNOTHING\*\*/);
  assert.equal(asked.mock.callCount(), 0);
});

test("a name pattern with one result opens it without asking again", async () => {
  const direct = require("../direct-search");
  const opened = [], choices = [];
  const text = await direct.answer("ZVERTEX*LAB", {
    system: "A4H",
    search: async () => ({ objects: [{ object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB", package: "Z_RIG" }] }),
    open: async object => { opened.push(object); },
    choices: objects => { choices.push(...objects); }
  });
  assert.match(text, /Opened PROG \*\*ZVERTEX_DEBUG_LAB\*\*.*A4H/);
  assert.deepEqual(opened, [{ object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB" }]);
  assert.deepEqual(choices, [
    { object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB" },
    { object_type: "DEVC", object_name: "Z_RIG" }
  ]);
});

test("a plain name tries exact, prefix and contains patterns in order", async () => {
  const direct = require("../direct-search");
  const queries = [], opened = [];
  await direct.answer("Z_RIG", { search: async ({ query }) => {
    queries.push(query);
    return { objects: query === "*Z_RIG*" ? [{ object_type: "DEVC", object_name: "Z_MY_RIG" }] : [] };
  }, open: async object => { opened.push(object); } });
  assert.deepEqual(queries, ["Z_RIG", "Z_RIG*", "*Z_RIG*"]);
  assert.deepEqual(opened, [{ object_type: "DEVC", object_name: "Z_MY_RIG" }]);
  queries.length = 0;
  await direct.answer("Z_RIG*", { search: async ({ query }) => { queries.push(query); return { objects: [] }; }, open: async () => {} });
  assert.deepEqual(queries, ["Z_RIG*"]);
});

test("multiple search results are returned as openable choices", async () => {
  const direct = require("../direct-search");
  let choices = [];
  await direct.answer("ZTEST*", { search: async () => ({ objects: [
    { object_type: "PROG", object_name: "ZTEST_ONE" }, { object_type: "CLAS", object_name: "ZTEST_TWO" }
  ] }), open: async () => { throw new Error("must not open ambiguously"); }, choices: found => { choices = found; } });
  assert.deepEqual(choices.map(choice => choice.object_name), ["ZTEST_ONE", "ZTEST_TWO"]);
});

test("same-name program and package remain separate direct-search choices", async () => {
  const direct = require("../direct-search");
  let choices = [];
  const answer = await direct.answer("Z_AVE", { search: async () => ({ objects: [
    { object_type: "PROG", object_name: "Z_AVE" }, { object_type: "DEVC", object_name: "Z_AVE" }
  ] }), open: async () => { throw new Error("ambiguous name must not open automatically"); }, choices: found => { choices = found; } });
  assert.match(answer, /PROG \*\*Z_AVE\*\*/);
  assert.match(answer, /DEVC \*\*Z_AVE\*\*/);
  assert.deepEqual(choices.map(choice => choice.object_type), ["PROG", "DEVC"]);
});

test("automatic debugger context contains only its session reference", () => {
  assert.equal(chat.debugFlowSection(null), "");
  assert.equal(chat.debugFlowSection({recorded:{steps:[{at:"PRIVATE_SOURCE"}]},analysis:{secret:"PRIVATE_VALUE"}}), "");
  const section=chat.debugFlowSection({session_id:"48647647",recorded:{steps:[{at:"PRIVATE_SOURCE"}]},analysis:{secret:"PRIVATE_VALUE"}});
  assert.match(section,/\[session 48647647 step 1\]/);
  assert.match(section,/recording is not attached/);
  assert.doesNotMatch(section,/PRIVATE_SOURCE|PRIVATE_VALUE|steps"|analysis"/);
  assert.match(chat.debugFlowSection({saved_session:{session_id:"saved-id"}}),/session saved-id/);
  assert.equal(chat.debugFlowSection({session_id:'bad\nInjected'}), "");
});

test("the open Value origin window reaches the question as the screen shows it, labelled as analysis", () => {
  assert.equal(chat.originFlowSection(null), "");
  assert.equal(chat.originFlowSection({ kind: "flow", flow: [] }), "");
  const flow = chat.originFlowSection({ value: "LS_X", kind: "flow", screen: { mode: "flow", view: "tree", depth: 2 }, flow: [{ depth: 1, text: "a = b.", in_slice: true }] });
  assert.match(flow, /flow, tree, depth 2/);
  assert.match(flow, /not a run/);
  assert.match(flow, /"in_slice":true/);
  const formula = chat.originFlowSection({ kind: "formula", screen: { mode: "formula", view: "tree", depth: "all" }, formula: [{ level: 1, text: "x = y * 2" }] });
  assert.match(formula, /formula, tree, depth all/);
  assert.match(formula, /x = y \* 2/);
});

test("the Expression screen reaches the question as the steps and where they come from", () => {
  const section = chat.originFlowSection({ kind: "expression", screen: { mode: "expression", view: "tree", depth: "all" },
    expression: { text: "A = A₁", steps: [{ name: "A₁", text: "x * 2" }], where: [{ name: "x", text: "SELECT x" }] } });
  assert.match(section, /expression, tree/);
  assert.match(section, /"steps":\[\{"name"/);
});

test("an explicit review-block question is not widened by the visible object's full diff", async t => {
  let prompt = "";
  t.mock.method(assistant, "ask", async options => { prompt = options.prompt; return { plan: { answer: "Block one" } }; });
  const ask = chat.create(fakeVscode({ provider: "claude-subscription", model: "haiku" }),
    { schemas: [], instructions: "", editorContext: () => null },
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  await ask("Explain selected block 1: ONLY_BLOCK_ONE", { state: {
    review_ask: { object: "RUN", all: false, blocks: [1] },
    vertex_view: { view: "review_object", name: "K1", review_object: "RUN" },
    review_source: { object: "RUN", text: "OTHER_BLOCKS_FULL_DIFF" },
    selected_fragment: { text: "UNRELATED_SELECTION" }
  } });
  assert.match(prompt, /ONLY_BLOCK_ONE/);
  assert.doesNotMatch(prompt, /OTHER_BLOCKS_FULL_DIFF|UNRELATED_SELECTION/);
});

test("ChatGPT subscription forwards screenshots to Codex", async t => {
  const images = [{ media_type: "image/png", data: "iVBORw0KGgo=" }];
  let received;
  t.mock.method(assistant, "ask", async options => { received = options; return { plan: { answer: "Screenshot received" }, model: "codex" }; });
  const ask = chat.create(fakeVscode({ provider: "codex-subscription" }),
    { schemas: [], instructions: "", editorContext: () => null },
    { start: async () => ({ url: "http://127.0.0.1:1/mcp" }), token: "t" });
  assert.equal((await ask("Explain this screenshot", { images })).answer, "Screenshot received");
  assert.equal(received.assistant, "codex");
  assert.equal(received.images, undefined);
  await ask("Identify the application from my first screenshot");
  assert.equal(received.images, undefined, "follow-up sends only references");
  assert.match(received.prompt, /"screenshots": \[/);
  assert.match(received.prompt,/Screenshot received/);
  assert.doesNotMatch(received.prompt, /iVBORw0KGgo=/, "image bytes are attachments, not prompt text");
  ask.newConversation();
  await ask("A separate question");
  assert.equal(received.images, undefined, "new conversations do not inherit screenshots");
});


test("a visible Git review snapshot reaches ordinary chat; explicit blocks keep priority", async t => {
 const gitHistory=require('../git-history');
 t.mock.method(gitHistory,'reviewContext',()=>({title:'Uncommitted changes',folder:'project',truncated:false,text:'VISIBLE_GIT_DIFF before old after new'}));
 const calls=[];
 t.mock.method(assistant,'ask',async options=>{calls.push(options);return {plan:{answer:'Summary'}};});
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'haiku'}),
  {schemas:[],instructions:'',editorContext:()=>null},
  {start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 await ask('Сформируй краткое описание для коммита');
 assert.match(calls[0].prompt,/VISIBLE_GIT_DIFF/);
 assert.match(calls[0].prompt,/Do not run Git, Grep, Glob, Read or shell commands/);
 await ask('Explain ONLY_SELECTED_BLOCK',{state:{review_ask:{object:'RUN',all:false,blocks:[1]}}});
 assert.doesNotMatch(calls[1].prompt,/VISIBLE_GIT_DIFF/);
 t.mock.method(gitHistory,'reviewContext',()=>null);
 await ask('Another question');
 assert.doesNotMatch(calls[2].prompt,/VISIBLE_GIT_DIFF/);
});


test('Vercel chat rejects screenshots before inference for a declared text-only model',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'text',label:'Text',capabilities:{vision:false,tools:true}}]);
 let calls=0;t.mock.method(compatible,'ask',async()=>{calls++;});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'text'}),{schemas:[],instructions:'',editorContext:()=>null},{},{get:async()=>null});
 await assert.rejects(()=>ask('Explain screenshot',{images:[{media_type:'image/png',data:'abcd'}]}),/no Vision/);
 assert.equal(calls,0);
});

test('Vercel Vision chat forwards images and removes tools when the model cannot call them',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'vision',label:'Vision',capabilities:{vision:true,tools:false}}]);
 let received;t.mock.method(compatible,'ask',async options=>{received=options;return {plan:{answer:'Image described'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'vision'}),{schemas:[{name:'read_sap_object'}],instructions:'',editorContext:()=>null},{},{get:async()=>null});
 const images=[{media_type:'image/png',data:'abcd'}];
 assert.equal((await ask('Explain screenshot',{images})).answer,'Image described');
 assert.equal(received.images,undefined);assert.deepEqual(received.tools,[]);
 assert.match(received.instructions,/cannot call tools/);
 const next=[{media_type:'image/jpeg',data:'efgh'}];
 await ask('Compare with this screenshot',{images:next});
 assert.equal(received.images,undefined);
 await ask('What application was in the first screenshot?');
 assert.equal(received.images,undefined, 'history does not resend either image');
 assert.doesNotMatch(received.prompt,/abcd|efgh/);
});

test('commit and PR logs link only while the chat has messages, including restored history',async t=>{
 const logs=require('../session-log'),report=require('../log-report');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-commit-scope-'));
 t.after(()=>{logs.reset();fs.rmSync(root,{recursive:true,force:true});});
 logs.reset('old-chat');
 t.mock.method(compatible,'ask',async()=>({model:'text',plan:{answer:'Improve logs\n\nKeep utility operations separate.'}}));
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'text',logPath:root,'log.questions':true,'log.answers':true}),{schemas:[],instructions:''},{},{get:async()=>null});
 await ask.generateCommitMessage({text:'diff'},{});
 ask.restoreConversation([{question:'Review these changes',answer:'Reviewed'}]);
 await ask.generateCommitMessage({text:'diff'},{});
 await ask.generateCommitMessage({text:'diff'},{},'pr');
 ask.newConversation();
 await ask.generateCommitMessage({text:'diff'},{},'pr');
 const sessions=report.readSessions(root).sessions;
 assert.equal(sessions.length,4);assert.equal(new Set(sessions.map(s=>s.conversation)).size,4);
 const commits=sessions.filter(s=>s.prompts[0].operation==='Commit message'),prs=sessions.filter(s=>s.prompts[0].operation==='Pull request description');
 for(const group of [commits,prs]){assert.equal(group.filter(s=>s.relatedConversation==='old-chat').length,1);assert.equal(group.filter(s=>!s.relatedConversation).length,1);}
});

test('commit message generation is isolated and supplies no action tools',async t=>{
 let options;t.mock.method(compatible,'ask',async value=>{options=value;return {model:'text',plan:{answer:'Improve Git review\n\nAdd a draft commit form.'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'text'}),{schemas:[{name:'read_sap_object'}],instructions:'',editorContext:()=>{throw Error('No editor access needed');}},{start:()=>{throw Error('No MCP needed');}},{get:async()=>null});
 const result=await ask.generateCommitMessage({text:'SUPPLIED_DIFF'},{summary:'Draft'});
 assert.equal(result.summary,'Improve Git review');assert.deepEqual(options.tools,[]);assert.equal(options.textOnly,true);assert.equal(options.capabilities.tools,false);assert.equal(options.maxOutputTokens,4096);assert.match(options.instructions,/plain text only/);assert.doesNotMatch(options.instructions,/Put the entire commit message in the answer field/);assert.match(options.prompt,/SUPPLIED_DIFF/);assert.equal(options.workDir,undefined);assert.equal(options.callTool,undefined);
});

test('Web mode bypasses local editor, worktree and SAP context',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'web',label:'Web',capabilities:{tools:true}}]);let received;
 t.mock.method(compatible,'ask',async options=>{received=options;return {model:'web',plan:{answer:'Answer with source'}};});
 const vscode=fakeVscode({provider:'vercel-api',model:'web'});
 const ask=chat.create(vscode,{editorContext(){throw Error('No editor context');},schemas:[{name:'read_sap_object'}]},{start(){throw Error('No MCP');}},{get:async()=>null});
 const answer=await ask('ABAP benchmarks',{web:true,state:{git_review:{text:'PRIVATE_DIFF'},selected_fragment:{text:'PRIVATE_SOURCE'}}});
 assert.equal(answer.navigation,null);assert.equal(received.webSearch,true);assert.deepEqual(received.tools,[]);assert.equal(received.webQuery,'ABAP benchmarks');assert.doesNotMatch(received.prompt,/PRIVATE_DIFF|PRIVATE_SOURCE/);
});

test('commit header metadata reports actual model and cost separately for repeated generations',async t=>{
 let attempt=0;t.mock.method(compatible,'ask',async options=>{const model=++attempt===1?'inclusionai/ling-3.0-flash':'nvidia/free',usage={input_tokens:attempt===1?40964:42055,output_tokens:attempt===1?461:177,cost_usd:attempt===1?0.00088929:0};options.onModelCall({model,usage,text:'Update commit dialog'});return {model,usage,plan:{answer:'Update commit dialog\n\nShow generation cost.'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'configured-model'}),{schemas:[],instructions:''},{},{get:async()=>null});
 const first=await ask.generateCommitMessage({text:'diff'},{}),second=await ask.generateCommitMessage({text:'diff'},{});
 assert.match(first.description,/Generated by: inclusionai\/ling-3\.0-flash$/);assert.match(second.description,/Generated by: nvidia\/free$/);assert.doesNotMatch(second.description,/configured-model|ling-3/);assert.equal(first.generation.model,'inclusionai/ling-3.0-flash');assert.equal(first.generation.cost_usd,0.00088929);assert.equal(first.generation.usage.output_tokens,461);assert.equal(second.generation.model,'nvidia/free');assert.equal(second.generation.cost_usd,0);assert.equal(second.generation.usage.input_tokens,42055);
});
test('failed commit generation retains reported charge metadata',async t=>{
 t.mock.method(compatible,'ask',async options=>{options.onModelCall({model:'failed-model',usage:{input_tokens:10,output_tokens:3,cost_usd:0.001},text:'[empty]'});throw new Error('No final text');});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'configured'}),{schemas:[],instructions:''},{},{get:async()=>null});await assert.rejects(()=>ask.generateCommitMessage({text:'diff'},{}),error=>error.generation.model==='failed-model'&&error.generation.cost_usd===0.001);
});

test('natural-language Web request bypasses local and SAP context without a checkbox',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'web',label:'Web',capabilities:{tools:true}}]);let received;
 t.mock.method(compatible,'ask',async options=>{received=options;return {model:'web',plan:{answer:'Found'}};});
 const ask=chat.create(fakeVscode({provider:'vercel-api',model:'web'}),{editorContext(){throw Error('No SAP context');},schemas:[]},{},{get:async()=>null});
 await ask('Найди в интернете ABAP benchmarks',{state:{git_review:{text:'PRIVATE_DIFF'}}});assert.equal(received.webSearch,true);assert.doesNotMatch(received.prompt,/PRIVATE_DIFF/);
});
test('explicit SAP and Folder modes select context, and text-only models can read supplied source',async t=>{
 t.mock.method(compatible,'models',async()=>[{id:'text',label:'Text',capabilities:{tools:false}}]);let received;
 t.mock.method(compatible,'ask',async options=>{received=options;return {model:'text',plan:{answer:'Shown'}};});
 const vscode=fakeVscode({provider:'vercel-api',model:'text'}),tools={schemas:[{name:'read_sap_object'},{name:'run_abap_transpiler'}],instructions:'SAP_RULES',editorContext:()=>({source:'REPORT VISIBLE_SAP_SOURCE.',object_name:'Z_REPORT',object_type:'PROG'})};
 const sap=chat.create(vscode,tools,{},{get:async()=>null},()=>({analysis:{methods:['VISIBLE_METHOD']}}));
 await sap('видишь Z_REPORT?',{contextMode:'sap',state:{git_review:{text:'PRIVATE_DIFF'}}});assert.match(received.prompt,/VISIBLE_SAP_SOURCE|VISIBLE_METHOD/);assert.doesNotMatch(received.prompt,/PRIVATE_DIFF/);assert.match(received.instructions,/supplied source, review and debugger context are available/);
 const folder=chat.create(vscode,tools,{},{get:async()=>null},()=>{throw Error('No SAP debugger in Folder mode');});
 await folder('список файлов',{contextMode:'folder',state:{vertex_view:{secret:'PRIVATE_SAP_VIEW'}}});assert.doesNotMatch(received.prompt,/PRIVATE_SAP_VIEW|VISIBLE_SAP_SOURCE/);assert.deepEqual(received.tools.map(x=>x.name),[]);
});

test('changing model or provider cancels a pending rate-limit retry without losing history', async t => {
  t.mock.method(require('../model-config'), 'isOn', () => true);
  for (const change of ['model','provider']) {
    const settings={provider:'claude-subscription',model:'old'};
    const vscode=fakeVscode(settings);
    vscode.ConfigurationTarget={Global:1};
    vscode.workspace.getConfiguration=()=>({get:(key,fallback)=>settings[key]??fallback,update:async(key,value)=>{settings[key]=value;}});
    let waiting, calls=0; const ready=new Promise(resolve=>{waiting=resolve;}); const prompts=[];
    t.mock.method(assistant,'ask',async options=>{
      prompts.push(options.prompt);
      if(options.prompt.endsWith('blocked question')) return compatible.rateLimitedRequest(async()=>{
        calls++;throw Object.assign(new Error('rate limited'),{status:429,retryAfter:'60'});
      },{...options,onRetryWait:cancel=>{options.onRetryWait(cancel);if(cancel)waiting();}});
      return {plan:{answer:'kept answer'},model:'test',usage:null};
    });
    const ask=chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
    await ask('first question');
    const old=ask('blocked question');await ready;
    if(change==='model')await ask.setModel('new');else await ask.setProvider('codex-subscription');
    assert.equal((await old).superseded,true);
    const next=await ask('next question',{model:'new'});
    assert.equal(next.answer,'kept answer');assert.equal(calls,1);
    assert.match(prompts.at(-1),/first question/);assert.match(prompts.at(-1),/kept answer/);
    assert.doesNotMatch(prompts.at(-1),/blocked question/);
    ask.dispose();
  }
});

test('OpenRouter shows remaining daily requests when a request is rate limited', async t => {
  t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
  t.mock.method(compatible,'models',async()=>[{id:'test',label:'Test'}]);
  let checks=0;
  t.mock.method(compatible,'keyLimits',async()=>{checks++;return {free:{used:50,limit:50,remaining:0},usage_daily:0,limit_remaining:null};});
  t.mock.method(compatible,'ask',async options=>compatible.rateLimitedRequest(async()=>{throw Object.assign(new Error('Daily rate limit'),{status:429,retryAfter:'120'});},options));
  const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},null,{});
  const progress=[];
  await assert.rejects(ask('explain this',{onProgress:update=>progress.push(update)}),/Daily rate limit/);
  assert.ok(checks>0);assert.ok(progress.some(update=>/free today 0 of 50 left/.test(update.limits||'')));
  t.mock.method(compatible,'ask',async options=>{
    assert.doesNotMatch(options.prompt,/Daily rate limit|Request failed:/);
    return {plan:{answer:'new answer'},model:'test',usage:null};
  });
  assert.equal((await ask('next question')).answer,'new answer');
  ask.dispose();
});

test("a wrong navigation keeps the answer and names the error", () => {
  const { navigationOf } = require("../chat");
  assert.deepEqual(navigationOf({ type: "FUNC", name: "Z_F", action: "review", part: null }),
    { navigation: null, navigationError: "Review is unavailable for Function module" });
  assert.equal(navigationOf({ type: "FUNC", name: "Z_F", action: "metrics", part: null }).navigation.action, "metrics");
  assert.deepEqual(navigationOf(null), { navigation: null });
});


test('Stop aborts the active provider, suppresses late tools and retains completed conversation', async t => {
  let ready, blockedOptions; const started=new Promise(resolve=>ready=resolve),prompts=[];
  t.mock.method(assistant,'ask',async options=>{
    prompts.push(options.prompt);
    if(options.prompt.endsWith('blocked turn')) {
      blockedOptions=options;ready();
      await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
    }
    return {plan:{answer:'kept answer'},model:'test',usage:null};
  });
  const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
  assert.equal(ask.stop(),false);
  await ask('completed turn');
  const blocked=ask('blocked turn');await started;
  assert.equal(ask.stop(),true);assert.equal(ask.stop(),false);
  assert.equal(blockedOptions.signal.aborted,true);
  assert.equal(blockedOptions.isActive(),false);
  assert.equal((await blocked).stopped,true);
  await ask('next turn');
  assert.match(prompts.at(-1),/completed turn/);assert.match(prompts.at(-1),/kept answer/);assert.doesNotMatch(prompts.at(-1),/blocked turn/);
  ask.dispose();
});

test('Stop wakes a rate-limit retry without sending another request', async t => {
  let ready,calls=0;const waiting=new Promise(resolve=>ready=resolve);
  t.mock.method(assistant,'ask',options=>compatible.rateLimitedRequest(async()=>{
    calls++;throw Object.assign(new Error('rate limited'),{status:429,retryAfter:'60'});
  },{...options,onRetryWait:cancel=>{options.onRetryWait(cancel);if(cancel)ready();}}));
  const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
  const blocked=ask('please explain this blocked request');await waiting;ask.stop();
  assert.equal((await blocked).stopped,true);assert.equal(calls,1);ask.dispose();
});

test('Stop is logged as a stop with a cost note, not as a request error', async t => {
  const logs=require('../session-log');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-stop-log-'));
  t.after(()=>{logs.reset();fs.rmSync(root,{recursive:true,force:true});});
  logs.reset('stop-chat');
  let ready;const waiting=new Promise(resolve=>ready=resolve);
  t.mock.method(assistant,'ask',options=>compatible.rateLimitedRequest(async()=>{
    throw Object.assign(new Error('rate limited'),{status:429,retryAfter:'60'});
  },{...options,onRetryWait:cancel=>{options.onRetryWait(cancel);if(cancel)ready();}}));
  const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test',logPath:root,'log.questions':true,'log.answers':true}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
  const pending=ask('please explain this blocked request');await waiting;ask.stop();
  assert.equal((await pending).stopped,true);ask.dispose();
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const text=walk(root).filter(f=>f.endsWith('.jsonl')).map(f=>fs.readFileSync(f,'utf8')).join('\n');
  assert.match(text,/request_stopped/);assert.match(text,/Stopped by user/);assert.doesNotMatch(text,/request_error/);
});

test('Stop of a CLI run logs the tokens of its finished messages, not "no usage"', async t => {
  const logs=require('../session-log');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-stop-cli-'));
  t.after(()=>{logs.reset();fs.rmSync(root,{recursive:true,force:true});});
  logs.reset('stop-cli');
  let ready;const waiting=new Promise(resolve=>ready=resolve);
  t.mock.method(assistant,'ask',options=>new Promise((_,reject)=>{
    const message={id:'m1',model:'claude-haiku-5-5',usage:{input_tokens:2,output_tokens:8,cache_read_input_tokens:100,cache_creation_input_tokens:50}};
    // Claude Code repeats a message once per content block; it is one call.
    options.onProviderResponse({provider:'claude',scope:'model_response',response:message});
    options.onProviderResponse({provider:'claude',scope:'model_response',response:message});
    options.signal.addEventListener('abort',()=>reject(new Error('Claude Code stopped')));ready();
  }));
  const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test',logPath:root,'log.questions':true,'log.answers':true}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
  const pending=ask('please explain this request');await waiting;ask.stop();
  assert.equal((await pending).stopped,true);ask.dispose();
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const text=walk(root).filter(f=>f.endsWith('.jsonl')).map(f=>fs.readFileSync(f,'utf8')).join('\n');
  assert.match(text,/request_stopped/);assert.match(text,/"cli_run"/);
  assert.match(text,/1 finished model call\(s\) of the stopped run used 2 input, 8 output, 100 cache read and 50 cache write tokens/);
  assert.doesNotMatch(text,/reported no usage/);assert.doesNotMatch(text,/Estimated cost/,'a Claude subscription has no bill to estimate');
  // The final assistant message must carry the actual tokens, not all zeros.
  const lines=text.split('\n').filter(l=>l.trim()).map(l=>JSON.parse(l));
  const assistant=lines.filter(l=>l.type==='assistant' && l.message?.usage).pop();
  assert.ok(assistant,'final assistant message with usage not found');
  assert.equal(assistant.message.usage.input_tokens,2,'input_tokens must be 2, not 0');
  assert.equal(assistant.message.usage.output_tokens,8,'output_tokens must be 8, not 0');
  assert.equal(assistant.message.usage.cache_read_input_tokens,100,'cache_read must be 100, not 0');
  assert.equal(assistant.message.usage.cache_creation_input_tokens,50,'cache_write must be 50, not 0');
});

test('a stopped CodeMie run gets a list-price estimate the usage report attributes to its messages', () => {
  const usage={input_tokens:2,output_tokens:8,cache_read_input_tokens:18954,cache_creation_input_tokens:4637,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:4637},service_tier:'standard'};
  const account=chat.stoppedRunAccount('codemie',[{model:'claude-haiku-5-5',usage}]);
  const expected=require('../anthropic-pricing').priceUsage('claude-haiku-5-5',usage).cost_usd;
  assert.ok(expected>0);assert.equal(account.cost,expected);
  assert.equal(account.response.total_cost_usd,expected);assert.match(account.text,/Estimated cost ≈ \$/);
  const line=record=>JSON.stringify({timestamp:'2026-11-17T19:55:40.000Z',vertex_operation:'Chat',...record});
  const rows=require('../usage-report').parseUsage([{name:'codemie_20261117_215519_7ce7bb.jsonl',text:[
    line({type:'user',message:{role:'user',content:'question'}}),
    line({type:'vertex_provider_response',provider:'codemie',scope:'model_response',response:{id:'m1',model:'claude-haiku-5-5',usage}}),
    line({type:'vertex_provider_response',provider:'codemie',scope:'cli_run',response:account.response}),
    line({type:'vertex_provider_response',provider:'codemie',scope:'request_stopped',response:{is_error:false,error:'Stopped by user'}}),
    line({type:'assistant',message:{model:'claude-haiku-5-5',usage:{input_tokens:2,output_tokens:8,cache_creation_input_tokens:4637,cache_read_input_tokens:18954,estimated_cost_usd:expected},content:[{type:'text',text:account.text}]}})].join('\n')}]);
  assert.equal(rows.length,1);assert.equal(rows[0].cost,expected);assert.equal(rows[0].estimated,true);assert.equal(rows[0].cacheRead,18954);
  assert.equal(chat.stoppedRunAccount('codemie',[]),null);
  const unknown=chat.stoppedRunAccount('codemie',[{model:'some-other-model',usage}]);
  assert.equal(unknown.cost,undefined);assert.doesNotMatch(unknown.text,/Estimated cost/);
});

test('Stop during a model call of an API provider lets the call finish and report its usage', async t => {
  t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
  let ready,release,received;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  t.mock.method(compatible,'ask',async options=>{
    received=options;options.onRequestState(true);ready();await gate;options.onRequestState(false);
    return {plan:{answer:'Paused here.'},model:'test',usage:{input_tokens:10,output_tokens:2}};
  });
  const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},null,{});
  t.mock.method(compatible,'keyLimits',async()=>({free:null,usage_daily:0,limit_remaining:null}));
  const pending=ask('please explain this');await started;
  assert.equal(ask.stop(),true);
  assert.equal(received.signal.aborted,false);assert.equal(received.isActive(),true);assert.equal(received.wrapUp(),true);
  release();
  const reply=await pending;
  assert.equal(reply.stopped,true);assert.equal(reply.answer,'Paused here.');assert.equal(reply.usage.input_tokens,10);
  ask.dispose();
});

function routingTools(orchestrator=true){const schemas=[{name:'read_evidence',description:'Read evidence',inputSchema:{type:'object',properties:{}}},{name:'write_evidence',description:'Write evidence',inputSchema:{type:'object',properties:{}}}];return {orchestrator:()=>orchestrator,orchestratorTools:async()=>schemas,schemas,instructions:'Available tools',editorContext:()=>null};}
function jsonPlan(task='user question'){return {goal:task,stages:[{id:1,task,operation:"read",depends_on:[],completion_checks:['Evidence obtained']}]};}
function stageReport(answer,id=1){return {answer,navigation:null,build_command:'',stage_id:id,stage_status:'complete',evidence:['Verified result'],remaining:[]};}
test('Jev chooses direct execution and functions in one request without a planning model call',async t=>{
 const router=require('../orchestrator-plan'),events=[];
 t.mock.method(require('../task-verification'),'verifyTask',async(_v,_task,_answer,evidence)=>{events.push('verify');assert.ok(Array.isArray(evidence.tools));return {status:'passed',usage:{input_tokens:2}};});
 t.mock.method(router,'connect',async()=>({provider:'typesafe-api',model:'jev-latest',key:'test'}));
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(router,'select',async(_v,task,_c,tools,options)=>{events.push('jev');assert.ok(options.decideMode);assert.equal(task,'user question');return {tools:tools.filter(t=>t.name==='read_evidence'),executionMode:'direct',model:'jev-latest',provider:'typesafe-api',permissions:{write:false,execute:false},usage:{input_tokens:10}};});
 t.mock.method(compatible,'ask',async options=>{events.push('execute');assert.ok(!options.structuredResult);assert.equal(options.schema.properties.stage_id,undefined);assert.deepEqual(options.tools.map(t=>t.name),['read_evidence']);await assert.rejects(async()=>options.callTool('write_evidence',{}),/unavailable/);return {plan:{answer:'done',navigation:null,build_command:''},model:'weak'};});
 const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'weak'}),routingTools(),null,{});
 const result=await ask('user question');assert.deepEqual(events,['jev','execute']);assert.equal(result.answer,'done');assert.equal(result.planner.usage.input_tokens,10);assert.equal(result.taskVerification,null);ask.dispose();
});
test('Jev failure blocks execution and Stop cancels initial selection after the JSON plan',async t=>{
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 const router=require('../orchestrator-plan');let executions=0,ready;
 t.mock.method(router,'connect',async()=>({provider:'typesafe-api',model:'jev-latest',key:'test'}));
 t.mock.method(compatible,'ask',async options=>{if(options.structuredResult)return {plan:jsonPlan()};executions++;return {plan:stageReport('unexpected')};});
 t.mock.method(router,'select',async()=>{throw new Error('decision unavailable');});
 let ask=chat.create(fakeVscode({provider:'openrouter-api',model:'weak'}),routingTools(),null,{});
 await assert.rejects(ask('user question'),/decision unavailable/);ask.dispose();
 const started=new Promise(resolve=>ready=resolve);
 t.mock.method(router,'select',async(_v,_q,_c,_t,options)=>{ready();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));});
 ask=chat.create(fakeVscode({provider:'openrouter-api',model:'weak'}),routingTools(),null,{});
 const pending=ask('user question');await started;ask.stop();assert.equal((await pending).stopped,true);assert.equal(executions,0);ask.dispose();
});
test('Other MCP modes do not invoke JSON planning or Jev selection',async t=>{
 t.mock.method(require('../orchestrator-plan'),'select',async()=>{throw Error('unexpected routing');});
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(compatible,'ask',async options=>{assert.ok(!options.structuredResult);return {plan:{answer:'done'}};});
 const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'weak'}),routingTools(false),null,{});
 assert.equal((await ask('user question')).answer,'done');ask.dispose();
});

test('saved historical screenshots keep file references without attaching their bytes',async t=>{
 let received;t.mock.method(assistant,'ask',async options=>{received=options;return{plan:{answer:'Reference only'},model:'test'};});
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 ask.restoreConversation([{question:'Saved image',answer:'Earlier description',images:[{media_type:'image/png',data:'PRIVATE_IMAGE_BYTES',file:'C:/logs/session/screenshot-1.png'}]}]);
 await ask('Continue our discussion');
 assert.equal(received.images,undefined);assert.match(received.prompt,/C:\/logs\/session\/screenshot-1.png/);assert.doesNotMatch(received.prompt,/PRIVATE_IMAGE_BYTES/);
 assert.match(received.prompt,/Do not claim to see image pixels/);
});
test('stale manual topic options cannot override Full history',async t=>{
 let received;t.mock.method(assistant,'ask',async options=>{received=options;return {plan:{answer:'Answer'},model:'test'};});
 t.mock.method(require('../topic-routing'),'route',()=>assert.fail('Full history must not route'));
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 ask.restoreConversation([{question:'First task',answer:'FIRST_MARKER'},{question:'Other task',answer:'OTHER_MARKER'}]);
 await ask('New question',{topicId:'topic_0006',routeTopics:false});assert.match(received.prompt,/FIRST_MARKER/);assert.match(received.prompt,/OTHER_MARKER/);
});

test('screenshot-only task is recognized without history and enriches Jev and future context with references',async t=>{
 const calls=[],routing=require('../topic-routing');let routed;
 t.mock.method(assistant,'ask',async options=>{calls.push(options);return {plan:{answer:options.images?'Save selected failed: Z_TILE_TRANSLATOR, missing transport':'Helpful answer'},model:'test'};});
 t.mock.method(require('../model-config'),'isOn',()=>true);
 t.mock.method(routing,'route',async(_v,question,history)=>{routed=question;return {history:[],topic:null,report:{status:'fallback',reason:'fixture'}};});
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'PRIVATE_SAP_INSTRUCTIONS',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 ask.restoreConversation([{question:'PRIVATE_OLD_MISTRAL_TASK',answer:'PRIVATE_OLD_ANSWER'}]);
 await ask('',{images:[{media_type:'image/png',data:'aW1hZ2U='}],routeTopics:true});
 assert.equal(calls.length,2);assert.equal(calls[0].images.length,1);assert.deepEqual(calls[0].tools,[]);
 assert.doesNotMatch(calls[0].prompt+calls[0].instructions,/PRIVATE_OLD|PRIVATE_SAP|Previous conversation|workspace/);
 assert.match(routed,/Save selected failed: Z_TILE_TRANSLATOR/);assert.equal(calls[1].images,undefined);
 assert.match(calls[1].prompt,/Current screenshot references and descriptions/);assert.doesNotMatch(calls[1].prompt,/aW1hZ2U=/);
 await ask('What failed?');assert.equal(calls.length,3);assert.equal(calls[2].images,undefined);
 assert.match(calls[2].prompt,/Save selected failed: Z_TILE_TRANSLATOR/);assert.match(calls[2].prompt,/screenshot\.png/);
 assert.doesNotMatch(calls[2].prompt,/aW1hZ2U=/);
});

test('live log contains the question while screenshot recognition is pending and records its description afterwards',async t=>{
 const logger=require('../session-log'),report=require('../log-report');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-live-image-'));logger.reset();
 let release,started;const waiting=new Promise(resolve=>{started=resolve;});const progress=[];
 t.mock.method(assistant,'ask',async options=>{
  if(options.images){started();await new Promise(resolve=>{release=resolve;});return {plan:{answer:'Visible error'},model:'test'};}
  return {plan:{answer:'Answer'},model:'test'};
 });
 const vscode=fakeVscode({provider:'claude-subscription',model:'test',logPath:root,'log.questions':true,'log.answers':true});
 const ask=chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 try{
  const running=ask('Explain image',{images:[{media_type:'image/png',data:'aW1hZ2U='}],onProgress:update=>progress.push(update)});
  await waiting;
  const update=progress.find(item=>item.kind==='recognize');assert.ok(update.logSessionId);
  let sessions=report.readSessions(root).sessions;let main=sessions.find(item=>item.id===update.logSessionId);
  assert.equal(main.prompts[0].text,'Explain image');assert.equal(main.prompts[0].screenshots.length,1);
  assert.ok(sessions.some(item=>item.relatedConversation===main.conversation&&item.prompts.some(p=>p.operation==='Screenshot recognition')));
  release();await running;
  sessions=report.readSessions(root).sessions;main=sessions.find(item=>item.id===update.logSessionId);
  assert.equal(main.prompts.length,1);assert.equal(main.prompts[0].screenshots[0].description,'Visible error');
 }finally{await ask.dispose();logger.reset();fs.rmSync(root,{recursive:true,force:true});}
});

test('clarifications preserve and total usage across interrupted CodeMie model rounds', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-clarification-cost-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let ask,release,started;const waiting=new Promise(resolve=>{started=resolve;});let calls=0;
  const tool={name:'read_evidence',description:'read',inputSchema:{type:'object',properties:{}}};
  const tools={schemas:[tool],instructions:'',editorContext:()=>null,execute:async()=>({ok:true})};
  t.mock.method(assistant,'ask',async options=>{
    calls++;
    if(calls===1){started();await new Promise(resolve=>{release=resolve;});return {model:'claude-fable-5-2',plan:{answer:'First draft'},usage:{input_tokens:12,output_tokens:4},cost:0.002};}
    return {model:'claude-fable-5-2',plan:{answer:'Refined'},usage:{input_tokens:8,output_tokens:3},cost:0.001};
  });
  const vscode=fakeVscode({provider:'codemie',model:'claude-fable-5-2',logPath:root,'log.questions':true,'log.answers':true});
  ask=chat.create(vscode,tools,{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'test'});
  const pending=ask('Inspect the existing logic');await waiting;
  assert.equal(ask.interject('Use a different interpretation'),true);
  release();const result=await pending;
  assert.equal(result.answer,'Refined');assert.equal(result.usage.input_tokens,20);assert.equal(result.usage.output_tokens,7);assert.equal(result.cost,0.003);
  const records=fs.readFileSync(fs.readdirSync(path.join(root,'claude_compatible')).map(name=>path.join(root,'claude_compatible',name))[0],'utf8').trim().split('\\n').map(JSON.parse);
  const usage=records.filter(record=>record.type==='assistant'&&record.message?.usage).map(record=>record.message.usage);
  assert.deepEqual(usage.map(value=>[value.input_tokens,value.output_tokens]),[[12,4],[8,3]]);
  assert.equal(usage.reduce((sum,value)=>sum+(value.cost_usd||0),0),0.003);
  assert.equal(records.filter(record=>record.type==='vertex_provider_response'&&record.scope==='request_interrupted_by_user').length,1);
  await ask.dispose();
});

test('screenshots added during processing are independently recognized before the next model step',async t=>{
 const calls=[],progress=[];let ask,release,started;
 const waiting=new Promise(resolve=>{started=resolve;});
 t.mock.method(assistant,'ask',async options=>{
  calls.push(options);
  if(options.images)return {plan:{answer:'Visible error ADDED_SCREENSHOT'},model:'test'};
  if(calls.length===1){started();await new Promise(resolve=>{release=resolve;});}
  return {plan:{answer:'Helpful answer'},model:'test'};
 });
 ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'PRIVATE_INSTRUCTIONS',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 const running=ask('Inspect the problem');await waiting;
 assert.equal(ask.interject('',null,[{media_type:'image/png',data:'PRIVATE_BYTES'}],update=>progress.push(update)),true);
 assert.equal(progress[0].kind,'recognize');
 release();await running;
 assert.equal(calls.length,3);
 assert.deepEqual(calls[1].tools,[]);assert.doesNotMatch(calls[1].prompt+calls[1].instructions,/PRIVATE_INSTRUCTIONS|Inspect the problem/);
 assert.match(calls[2].prompt,/ADDED_SCREENSHOT/);assert.doesNotMatch(calls[2].prompt,/PRIVATE_BYTES/);
 assert.equal(progress.at(-1).remove,true);
});

test('failed screenshot recognition stops before routing or answering from old history',async t=>{
 let calls=0;t.mock.method(assistant,'ask',async()=>{calls++;throw Error('Vision unavailable');});
 t.mock.method(require('../topic-routing'),'route',async()=>assert.fail('Do not route an unread screenshot'));
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},{});
 await assert.rejects(ask('',{images:[{media_type:'image/png',data:'aW1hZ2U='}],routeTopics:true}),/Vision unavailable/);assert.equal(calls,1);
});


test('Session Logs continuation restores screenshot descriptions into Jev input without image bytes',async t=>{
 const logger=require('../session-log'),report=require('../log-report'),routing=require('../topic-routing');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-image-description-'));logger.reset();
 let routed;
 t.mock.method(assistant,'ask',async options=>({plan:{answer:options.images?'Visible tile save error Z_TILE_SAVE':'Answer'},model:'test'}));
 const settings={provider:'claude-subscription',model:'test',logPath:root,'log.questions':true,'log.answers':true};
 const vscode=fakeVscode(settings),tools={schemas:[],instructions:'',editorContext:()=>null},server={start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'};
 try {
  const ask=chat.create(vscode,tools,server);await ask('',{images:[{media_type:'image/png',data:'aW1hZ2U='}]});
  const parsed=report.readSessions(root),session=parsed.sessions.find(s=>s.prompts.some(p=>p.operation==='Chat'));
  assert.ok(session);const restored=report.conversationTurns(parsed,session.id).turns;
  assert.equal(restored[0].images[0].description,'Visible tile save error Z_TILE_SAVE');
  const next=chat.create(vscode,tools,server);next.restoreConversation(restored);
  t.mock.method(require('../model-config'),'isOn',()=>true);
  t.mock.method(routing,'route',async(_v,_q,history)=>{routed=history;return {history,topic:null,report:{status:'fallback',reason:'fixture'}};});
  await next('Continue saving',{routeTopics:true});
  assert.match(routed[0].content,/Visible tile save error Z_TILE_SAVE/);assert.ok(routed[0].images[0].file);
  assert.equal(routed[0].images[0].data,undefined);assert.doesNotMatch(JSON.stringify(routed),/aW1hZ2U=/);
 } finally {logger.reset();fs.rmSync(root,{recursive:true,force:true});}
});


test('resuming a topic gives Jev a one-request starting context and reclassifies subsequent requests',async t=>{
 const routing=require('../topic-routing'),calls=[],topics=[{id:'topic_0001',label:'Translations',scope:'sap'},{id:'topic_0002',label:'HR',scope:'sap'}];
 t.mock.method(require('../model-config'),'isOn',()=>true);
 t.mock.method(routing,'route',async(_v,question,history,_scope,options)=>{calls.push({question,history,options});return {history:[],topic:topics[1],report:{status:'routed',basis:'jev',keptIndices:[]}};});
 t.mock.method(assistant,'ask',async()=>({plan:{answer:'HR answer'},model:'test'}));
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 ask.restoreConversation([{question:'Translate tiles',answer:'Translation context',topic:topics[0]},{question:'Employee card',answer:'HR context',topic:topics[1]}],{topic:topics[0]});
 const first=await ask('Show employee HR data',{routeTopics:true});assert.equal(first.topic.id,'topic_0002');assert.equal(calls[0].options.continuationTopic,'topic_0001');
 await ask('Another HR question',{routeTopics:true});assert.equal(calls.length,2);assert.equal(calls[1].options.continuationTopic,null);
 assert.ok(calls[1].history.some(m=>m.content==='Translate tiles'),'archive remains available to the router');
});


test('direct SAP navigation retains the preceding topic without a model call',async t=>{
 t.mock.method(assistant,'ask',async()=>{assert.fail('No LLM for navigation');});
 const tools={schemas:[],editorContext:()=>null,execute:async name=>name==='search_sap_objects'?{objects:[{object_type:'DEVC',object_name:'Z_ABAP_AI'}]}:{opened:true}};
 const ask=chat.create(fakeVscode({provider:'claude-subscription',contextMode:'sap'}),tools,{start:async()=>{assert.fail('No model endpoint');}});
 const topic={id:'topic_0001',label:'Packages created by user',scope:'sap'};
 ask.restoreConversation([{question:'Which packages?',answer:'Z_ABAP_AI',topic}]);
 const reply=await ask('Z_ABAP_AI',{contextMode:'sap'});
 assert.equal(reply.direct,true);assert.deepEqual(reply.topic,topic);
});

test('untyped SAP links resolve exact objects and disambiguate types before opening',async()=>{
 const vscode=fakeVscode({provider:'claude-subscription',contextMode:'sap'}),calls=[];
 vscode.window.showQuickPick=async items=>items.find(item=>item.object.object_type==='DEVC');
 const ask=chat.create(vscode,{schemas:[],execute:async(name,args)=>{calls.push([name,args]);return name==='search_sap_objects'?{objects:[{object_type:'PROG',object_name:'Z_AVE'},{object_type:'DEVC',object_name:'Z_AVE'},{object_type:'DEVC',object_name:'Z_AVE_OTHER'}]}:{opened:true};}},{start:async()=>{}});
 await ask.openObject({object_name:'Z_AVE'});
 assert.deepEqual(calls[1],['open_sap_object',{object_type:'DEVC',object_name:'Z_AVE'}]);
 await assert.rejects(ask.openObject({object_name:'not a name'}),/exact SAP object/);
});

test('CLI planning has no endpoint or action tools; execution receives only the selected function',async t=>{
 t.mock.method(require('../orchestrator-plan'),'connect',async()=>({provider:'typesafe-api',model:'jev-latest',key:'test'}));
 t.mock.method(require('../orchestrator-plan'),'select',async(_v,_q,_c,tools)=>({tools:tools.filter(t=>t.name==='read_evidence'),executionMode:'direct',model:'jev-latest',provider:'typesafe-api',permissions:{write:false,execute:false},usage:{input_tokens:2}}));
 let endpointTools;const tools=routingTools();tools.instructions='RAW_SERVER_GUIDANCE write_evidence';tools.execute=async name=>'result:'+name;
 const server={token:'t',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:options=>{endpointTools=options;return {route:'/selected',dispose(){}};}};
 t.mock.method(assistant,'ask',async options=>{if(options.structuredResult){assert.deepEqual(options.tools,[]);assert.equal(options.url,undefined);assert.equal(options.workDir,undefined);return {plan:jsonPlan()};}assert.doesNotMatch(options.instructions,/RAW_SERVER_GUIDANCE|write_evidence/);assert.deepEqual(options.tools,['read_evidence']);assert.deepEqual(endpointTools.tools.map(t=>t.name),['read_evidence']);assert.equal((await endpointTools.call(null,'read_evidence',{})).content[0].text,'"result:read_evidence"');await assert.rejects(endpointTools.call(null,'write_evidence',{}),/unavailable/);return {plan:stageReport('done'),model:'test'};});
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),tools,server,{});assert.equal((await ask('user question')).answer,'done');ask.dispose();
});
for(const native of [false,true])test((native?'CLI':'API')+' follows the JSON stages without model-controlled transitions',async t=>{
 const routing=require('../orchestrator-plan');let selections=0,served,toolCalls=[];
 t.mock.method(routing,'connect',async()=>({provider:'typesafe-api',model:'jev-latest',key:'test'}));
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 const schemas=[{name:'read_evidence',inputSchema:{type:'object'}},{name:'read_dependencies',inputSchema:{type:'object'}},{name:'run_atc_check',annotations:{readOnlyHint:true},inputSchema:{type:'object'}}];
 const tools={schemas,instructions:'',editorContext:()=>null,orchestrator:()=>true,orchestratorTools:async()=>schemas,execute:async(name,args)=>{toolCalls.push({name,args});return {id:'ZCL_TEST'};}};
 t.mock.method(routing,'select',async(_v,task,context,candidates,options)=>{if(options.decideMode)return {tools:[],executionMode:'staged',permissions:{write:false,execute:false},model:'jev-latest',provider:'typesafe-api',usage:{input_tokens:1}};selections++;if(selections===2){assert.equal(task,'Inspect dependencies of ZCL_TEST');assert.match(JSON.stringify(context),/ZCL_TEST/);assert.deepEqual(options.permissions,{write:false,execute:false});}return {tools:[candidates[selections===1?0:1],candidates[2]],permissions:{write:false,execute:false},model:'jev-latest',provider:'typesafe-api',usage:{input_tokens:3}};});
 const server={token:'t',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:set=>{served=set;return {route:'/planned',dispose(){}};}};
 const execute=async options=>{
  if(options.structuredResult && options.schema.properties.stages)return {plan:{goal:'Investigate changes',stages:[{id:1,task:'Find the changed object',operation:'discover',depends_on:[],completion_checks:['Object identified']},{id:2,task:'Inspect dependencies of ZCL_TEST',operation:'inspect',depends_on:[1],completion_checks:['Dependencies verified']}]}};
  if(options.structuredResult){assert.deepEqual(options.tools,[]);assert.match(options.prompt,/Found ZCL_TEST/);assert.match(options.prompt,/Dependencies verified/);return {plan:{answer:'Dependencies verified',navigation:null,build_command:''}};}
  const stage=options.schema.properties.stage_id.enum[0];
  const call=native?async(name,args)=>JSON.parse((await served.call(null,name,args)).content[0].text):options.callTool;
  const name=stage===1?'read_evidence':'read_dependencies';
  assert.deepEqual((native?options.tools:options.tools.map(t=>t.name)),[name]);
  if(stage===2)assert.match(options.prompt,/ZCL_TEST/);
  await call(name,{});await assert.rejects(call('run_atc_check',{}),/unavailable/);
  return {plan:stageReport(stage===1?'Found ZCL_TEST':'Dependencies verified',stage),model:'test'};
 };
 t.mock.method(native?assistant:compatible,'ask',execute);
 const ask=chat.create(fakeVscode({provider:native?'claude-subscription':'openrouter-api',model:'test'}),tools,server,{});
 const result=await ask('Investigate changes without executing anything');assert.equal(selections,2);assert.deepEqual(toolCalls.map(t=>t.name),['read_evidence','read_dependencies']);assert.equal(result.planner.usage.input_tokens,7);assert.equal(result.answer,'Dependencies verified');ask.dispose();
});

test('Textual stage announcements cannot start Jev or execute actions without a JSON plan',async t=>{
 const routing=require('../orchestrator-plan');let decisions=0;
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(routing,'connect',async()=>({provider:'typesafe-api',model:'jev-latest',key:'test'}));
 t.mock.method(routing,'select',async(_v,_q,_c,_t,options)=>{decisions++;assert.ok(options.decideMode);return {tools:[],executionMode:'staged',permissions:{write:false,execute:false},model:'jev-latest',provider:'typesafe-api'};});
 t.mock.method(compatible,'ask',async options=>{assert.deepEqual(options.tools,[]);return {plan:{answer:'First I will find transports, then compare versions'}};});
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'test'}),routingTools(),null,{});
 await assert.rejects(ask('Investigate changes'),/valid JSON stage plan/);assert.equal(decisions,1);ask.dispose();
});

test('A stage exceeding six actions is cancelled and summarized as blocked instead of continuing to the next stage',async t=>{
 const routing=require('../orchestrator-plan');let actions=0,selections=0;
 t.mock.method(routing,'connect',async()=>({provider:'typesafe-api',model:'jev-latest',key:'test'}));
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(routing,'select',async(_v,_task,_context,tools,options)=>{if(options.decideMode)return {tools:[],executionMode:'staged',permissions:{write:false,execute:false},model:'jev-latest',provider:'typesafe-api'};selections++;return {tools:[tools[0]],permissions:{write:false,execute:false},model:'jev-latest',provider:'typesafe-api',usage:{input_tokens:1}};});
 const tools=routingTools();tools.execute=async()=>{actions++;return 'read result';};
 t.mock.method(compatible,'ask',async options=>{
  if(options.structuredResult && options.schema.properties.stages)return {plan:jsonPlan()};
  if(options.structuredResult)return {plan:{answer:'Stopped at the stage action limit',navigation:null,build_command:''}};
  for(let i=0;i<7;i++)await options.callTool('read_evidence',{i});
  return {plan:stageReport('must not reach')};
 });
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'test'}),tools,null,{});const result=await ask('Investigate changes');assert.equal(actions,6);assert.equal(selections,1);assert.match(result.answer,/action limit/);ask.dispose();
});

test('an explicit build without tests runs through Bash without requiring source edits',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-build-request-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'AGENTS.md'),'Project rule: update change history for features.\nEND_OF_RULES');
 fs.writeFileSync(path.join(root,'build.js'),"require('fs').writeFileSync('example.vsix','packaged');");
 const copyDir=path.join(root,'working-copy');fs.mkdirSync(copyDir);fs.copyFileSync(path.join(root,'AGENTS.md'),path.join(copyDir,'AGENTS.md'));
 const copy={folder:root,top:root,cwd:copyDir,refresh:async()=>[],changes:async()=>[],remove:async()=>{}};
 t.mock.method(require('../agent-worktree'),'open',async()=>copy);
 t.mock.method(compatible,'models',async()=>[{id:'build-model',capabilities:{tools:true}}]);
 let received;
 t.mock.method(compatible,'ask',async options=>{
  received=options;
  const result=await options.callTool('Bash',{command:(process.platform==='win32'?'& ':'')+'"'+process.execPath+'" build.js',purpose:'build',description:'Package without tests',timeout:300000});
  assert.equal(result.cwd,fs.realpathSync(root));assert.equal(result.target,'project');
  assert.equal(result.code,0,result.stderr);
  return {model:'build-model',plan:{answer:'Built example.vsix; tests skipped as requested.',navigation:null,build_command:''}};
 });
 const vscode=fakeVscode({provider:'vercel-api',model:'build-model',shellWithoutAsking:true,logPath:path.join(root,'actual-logs')});
 vscode.window.showWarningMessage=async()=>"Allow";
 vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
 const ask=chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},null,{get:async()=>null});
 const result=await ask('Build the VSIX now without tests',{contextMode:'folder'});
 assert.match(result.answer,/Built example/);
 assert.equal(fs.readFileSync(path.join(root,'example.vsix'),'utf8'),'packaged');
 assert.match(received.instructions,/purpose=build: it defaults to the real project folder/);
 assert.match(received.instructions,/skip optional test suites/);
 assert.match(received.instructions,/regardless of its language or build system/);
 assert.match(received.instructions,/do not assume Node, PowerShell, VSIX or any particular project/);
 assert.doesNotMatch(received.instructions,/do not run them in the working copy/);
 assert.ok(received.prompt.includes('END_OF_RULES'));
 assert.ok(received.prompt.includes(path.join(root,'actual-logs','claude_compatible')));
 assert.match(received.prompt,/current_file/);assert.match(received.prompt,/configured_root/);
 assert.match(received.instructions,/Never claim a rule is absent from a partial read/);
 assert.match(received.instructions,/Explicit user instructions and later corrections override project defaults/);
 assert.match(received.schema.properties.build_command.description,/standalone build request with no edits/);
});

test('CLI assistants use the same host-controlled command targets instead of a separate native shell',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-native-targets-')),copyDir=path.join(root,'copy');fs.mkdirSync(copyDir);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 t.mock.method(require('../agent-worktree'),'open',async()=>({folder:root,top:root,cwd:copyDir,refresh:async()=>[],changes:async()=>[],remove:async()=>{}}));
 let endpoint,seen=[];
 const server={token:'test',start:async()=>({url:'http://127.0.0.1:1/mcp'}),registerTools:options=>{endpoint=options;return {route:'/targets',dispose(){}};}};
 t.mock.method(assistant,'ask',async options=>{
  seen.push(options.assistant);assert.equal(options.localTools,true);
  const result=JSON.parse((await endpoint.call(null,'Bash',{purpose:'build',command:process.platform==='win32'?'(Get-Location).Path':'pwd'})).content[0].text);
  assert.equal(result.target,'project');assert.equal(result.cwd,fs.realpathSync(root));assert.equal(result.code,0);
  return {model:'test',plan:{answer:'Built',navigation:null,build_command:''}};
 });
 for(const provider of ['claude','codemie','codex']){
  const vscode=fakeVscode({provider:provider==='claude'?'claude-subscription':provider==='codex'?'codex-subscription':provider,model:'test'});vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];vscode.window.showWarningMessage=async()=> 'Allow';
  await chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},server)('Build in my project',{contextMode:'folder'});
 }
 assert.deepEqual(seen,['claude','codemie','codex']);
});

test('host edit completion and a subsequent Bash command clear the edit scene',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-scene-host-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'a.txt'),'before');
 t.mock.method(require('../agent-worktree'),'open',async()=>({folder:root,top:root,cwd:root,refresh:async()=>[],changes:async()=>[],remove:async()=>{}}));
 t.mock.method(require('../agent-worktree'),'repositoryOf',async()=>root);
 t.mock.method(compatible,'models',async()=>[{id:'model',capabilities:{tools:true}}]);
 t.mock.method(compatible,'ask',async options=>{
  await options.callTool('Read',{file_path:'a.txt'});
  await options.callTool('Grep',{pattern:'before',path:root});
  await options.callTool('Edit',{file_path:'a.txt',old_string:'before',new_string:'after'});
  await options.callTool('Bash',{command:'exit 0',purpose:'command'});
  return {model:'model',plan:{answer:'done',navigation:null,build_command:''}};
 });
 const vscode=fakeVscode({provider:'vercel-api',model:'model',shellWithoutAsking:true});vscode.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
 const updates=[];await chat.create(vscode,{schemas:[],instructions:'',editorContext:()=>null},null,{get:async()=>null})('Edit then inspect',{contextMode:'folder',onProgress:update=>updates.push(update)});
 const edit=updates.findIndex(update=>update.kind==='edit');assert.ok(edit>=0);
 const search=updates.findIndex(update=>update.kind==='search');assert.ok(search>=0);assert.equal(updates[search+1].kind,null,'search result restores the waiting logo');
 assert.equal(updates[edit+1].kind,null,'edit result clears the helix');
 assert.equal(updates.find(update=>/— Bash/.test(update.status||'')).kind,'tooling','Bash uses the local tool scene');
 assert.equal(fs.readFileSync(path.join(root,'a.txt'),'utf8'),'after');
});
