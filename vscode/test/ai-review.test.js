"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const review = require("../ai-review");
const { aiContext } = require("../worktree-review");

const changes = [
  { file: "src/new.js", before: "", after: "const name = '<script>';", status: "added" },
  { file: "old.js", before: "obsolete();", after: "", status: "deleted" },
  { file: "image.png", before: "", after: "", binary: true }
];

test("assistant review covers all text changes including deletions and scopes a file without leaking others", () => {
  const all = aiContext(changes, "project", "Implement the task");
  assert.equal(all.blocks.length, 2);
  assert.deepEqual(all.blocks.map(block => block.file), ["src/new.js", "old.js"]);
  assert.equal(all.blocks[1].before[0], "obsolete();");
  const one = aiContext(changes, "project", "", { file: "src/new.js" });
  assert.equal(one.blocks.length, 1);
  assert.deepEqual(one.files, ["src/new.js"]);
  const html = review.page(all);
  assert.ok(!html.includes("<script>';"));
  new vm.Script(html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1]);
});

test("review requests include only explicit review history and optionally the task", () => {
  const context = aiContext(changes, "project", "Original requirement");
  const prepared = { ...context, instruction: "Find bugs" };
  const history = [{ role: "user", content: "Review follow-up" }];
  assert.match(review.request(context, prepared, history, "Check deletion", true), /Original requirement/);
  const prompt = review.request(context, prepared, history, "Check deletion", false);
  assert.doesNotMatch(prompt, /Original requirement/);
  assert.match(prompt, /Review follow-up/);
  assert.match(prompt, /old.js/);
});

test("embedded review reuses the sidebar surface instead of creating an editor window", async () => {
  let receive,html,options,prompt;
  const surface={embedding:{nonce:'parent-nonce',id:'review-child'},webview:{
    set html(value){html=value;},onDidReceiveMessage(fn){receive=fn;},postMessage:async()=>{}},onDidDispose(){}};
  const vscode={window:{createWebviewPanel(){assert.fail('Review must stay in the sidebar');}}};
  review.open(vscode,{...aiContext(changes,'project'),task:'Unrelated first main question'},async(text,o)=>{prompt=text;options=o;return{answer:'Done'};},surface);
  assert.match(html,/nonce="parent-nonce"/);
  assert.doesNotMatch(html,/Unrelated first main question/);
  await receive({action:'send',text:'Review this',task:'Current requirements'});
  assert.match(prompt,/Current requirements/);
  assert.doesNotMatch(prompt,/Unrelated first main question/);
  assert.ok(options.logScope.conversation);
});

test("review chat keeps follow-ups separate, reports stale snapshots, resets and cancels on close", async () => {
  let receive, close;
  const sent = [], runs = [];
  const panel = { webview: { onDidReceiveMessage: fn => { receive = fn; }, postMessage: async m => sent.push(m) },
    onDidDispose: fn => { close = fn; } };
  const vscode = { ViewColumn: { Beside: 2 }, window: { createWebviewPanel: () => panel } };
  const context = { ...aiContext(changes, "project", "Requirement"), isCurrent: async () => false };
  review.open(vscode, context, async (prompt, options) => { runs.push({ prompt, options }); return { answer: "Review answer", model: "test" }; });
  await receive({ action: "ready" });
  assert.equal(sent.at(-1).stale, true);
  await receive({ action: "send", text: "First", includeTask: false });
  await receive({ action: "send", text: "Follow-up", includeTask: false });
  assert.match(runs[1].prompt, /Review answer/);
  assert.equal(runs[0].options.logScope.conversation, runs[1].options.logScope.conversation);
  assert.doesNotMatch(runs[1].prompt, /Requirement/);
  await receive({ action: "restart" });
  await receive({ action: "send", text: "New review" });
  assert.doesNotMatch(runs[2].prompt, /Review answer/);
  assert.notEqual(runs[1].options.logScope.conversation, runs[2].options.logScope.conversation);
  close();
});

test("review logs have an independent identity and do not change the main logger", () => {
  const fs=require('fs'),os=require('os'),path=require('path'),logger=require('../session-log'),report=require('../log-report');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-review-scope-'));
  try {
    logger.reset();const include={questions:true,answers:true};
    const main=logger.current(root,'claude',include);main.user('Main task');main.assistant({text:'Main answer'});
    const scope=logger.independentScope();
    for(let i=0;i<2;i++){const log=logger.create(root,'claude','review_'+i,include,'AI Review',scope);log.user('Review '+i);log.assistant({text:'Review answer'});}
    main.user('Main follow-up');
    const sessions=report.readSessions(root).sessions,primary=sessions.find(s=>s.prompts[0].text==='Main task');
    const reviews=sessions.filter(s=>s.prompts[0].operation==='AI Review');
    assert.equal(reviews.length,2);
    assert.ok(reviews.every(s=>s.conversation===scope.conversation&&s.conversation!==primary.conversation&&s.relatedConversation===primary.conversation));
    assert.deepEqual(report.conversationTurns({sessions},primary.id).turns.map(t=>t.question),['Main task','Main follow-up']);
    const legacy=report.parseSession(JSON.stringify({timestamp:new Date().toISOString(),vertex_conversation:primary.conversation,vertex_operation:'AI Review',type:'user',message:{content:'Old review'}}),'claude_old.jsonl');
    assert.notEqual(legacy.conversation,primary.conversation);
  } finally {logger.reset();fs.rmSync(root,{recursive:true,force:true});}
});

test("Discuss in Main attaches the chosen answer and its snapshot without sending a model request", async () => {
  let receive,runs=0;
  const sent=[],commands=[];
  const surface={webview:{onDidReceiveMessage:fn=>{receive=fn;},postMessage:async message=>sent.push(message)},onDidDispose(){}};
  const vscode={commands:{executeCommand:async(...args)=>commands.push(args)}};
  review.open(vscode,aiContext(changes,'project'),async()=>({answer:'Finding '+(++runs),model:'reviewer'}),surface);
  await receive({action:'send',text:'First question',includeTask:true,task:'Check duplicates'});
  const first=sent.find(message=>message.handoffId);
  await receive({action:'send',text:'Second question'});
  await receive({action:'discuss',id:first.handoffId});
  assert.equal(runs,2,'handoff never invokes a model');
  assert.equal(commands[0][0],'vertex.discussAiReview');
  const attachment=commands[0][1];
  assert.equal(attachment.review_result.answer,'Finding 1');
  assert.equal(attachment.review_result.requirements,'Check duplicates');
  assert.deepEqual(attachment.files,changes.map(change=>change.file));
  const prompt=require('../code-review').askRequest('Check these findings and fix confirmed defects',attachment);
  assert.match(prompt,/Finding 1/);assert.match(prompt,/obsolete\(\)/);assert.match(prompt,/Check duplicates/);
  assert.match(prompt,/Check these findings and fix confirmed defects/);
  await receive({action:'discuss',id:'unknown'});assert.equal(commands.length,1);
  await receive({action:'restart'});
  await receive({action:'discuss',id:first.handoffId});assert.equal(commands.length,1,'old answer IDs are invalid after restarting');
});

test("closing an in-flight review aborts its request without posting its late answer", async () => {
  let receive, close, finish, signal;
  const sent = [];
  const vscode = { ViewColumn: { Beside: 2 }, window: { createWebviewPanel: () => ({ webview: {
    onDidReceiveMessage: fn => { receive = fn; }, postMessage: async m => sent.push(m) },
    onDidDispose: fn => { close = fn; } }) } };
  review.open(vscode, aiContext(changes, "project"), async (_, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = receive({ action: "send", text: "Review" });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  close(); assert.equal(signal.aborted, true);
  finish({ answer: "Late answer" }); await pending;
  assert.ok(!sent.some(message => message.reply));
});

test("AI Review provider request has no tools, working directory or main conversation", async () => {
  const compatible = require("../openai-compatible"), keys = require("../key-profiles");
  const savedAsk = compatible.ask, savedKey = keys.getActiveKey;
  let received;
  compatible.ask = async options => { received = options; return { model: "test", plan: { answer: "Review" } }; };
  keys.getActiveKey = async () => ({ key: "test-key" });
  try {
    const settings = { provider: "openai-api", model: "test" };
    const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) } };
    const ask = require("../chat").create(vscode, {}, null, {}, null, null);
    const signal = new AbortController().signal;
    const result = await ask.reviewChanges("Only review data", { signal });
    assert.equal(result.answer, "Review");
    assert.equal(received.prompt, "Only review data");
    assert.deepEqual(received.tools, []);
    assert.equal(received.capabilities.tools, false);
    assert.equal(received.workDir, undefined);
    assert.equal(received.signal, signal);
  } finally { compatible.ask = savedAsk; keys.getActiveKey = savedKey; }
});


test("prompt drafts never run the review and edited text replaces the selected template", async () => {
 let receive;const sent=[],runs=[],copied=[];
 const panel={webview:{onDidReceiveMessage:fn=>receive=fn,postMessage:async m=>sent.push(m)},onDidDispose(){}};
 const vscode={ViewColumn:{Beside:2},window:{createWebviewPanel:()=>panel},env:{clipboard:{writeText:async text=>copied.push(text)}}};
 review.open(vscode,aiContext(changes,'project'),async prompt=>{runs.push(prompt);return{answer:'Done'};});
 await receive({action:'ready'});
 await receive({action:'draftPrompt',kind:'git-tests',id:7});
 assert.equal(runs.length,0);
 assert.equal(sent.at(-1).draftPrompt.id,7);
 assert.equal(sent.at(-1).draftPrompt.text,await require('../git-prompts').opening('git-tests'));
 await receive({action:'copyPrompt',kind:'git-tests',text:'Only check the deletion path'});
 assert.equal(runs.length,0);
 assert.match(copied[0],/^Only check the deletion path/);
 await receive({action:'send',kind:'git-tests',text:'Only check the deletion path'});
 assert.match(runs[0],/^Only check the deletion path/);
 assert.doesNotMatch(runs[0],/Generate a test plan|The reader adds to this prompt/);
 assert.match(runs[0],/old.js/);
 await receive({action:'send',kind:'git-tests',text:'Explain your second finding'});
 assert.match(runs[1],/^Explain your second finding/);
 assert.match(runs[1],/Only check the deletion path/);
});
