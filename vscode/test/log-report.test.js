"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const report = require("../log-report");

test("session report reads provider logs without treating tool results as prompts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-log-report-"));
  try {
    const folder = path.join(root, "claude_compatible");
    fs.mkdirSync(folder);
    const records = [
      { timestamp: "2026-10-12T10:00:00Z", type: "user", message: { role: "user", content: "Explain this class" } },
      { timestamp: "2026-10-12T10:00:01Z", type: "vertex_request", request: { instructions: "Use visible UML first", prompt: 'Current VERTEX view:\n{"name":"Z_RIG","nodes":["ZCL_TEST"]}', tools: [{ name: "read_sap_object" }], schema: { type: "object" } } },
      { timestamp: "2026-10-12T10:00:02Z", type: "assistant", message: { id: "m1", model: "mistral-test", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 10 }, content: [{ type: "tool_use", name: "read_sap_object", input: { object_name: "ZCL_TEST" } }] } },
      { timestamp: "2026-10-12T10:00:03Z", type: "user", message: { role: "user", content: [{ type: "tool_result", content: '{"object_name":"ZCL_TEST","opened":true}' }] } },
      { timestamp: "2026-10-12T10:00:04Z", type: "assistant", message: { id: "m2", model: "mistral-test", usage: { input_tokens: 50, output_tokens: 30, cache_creation_input_tokens: 5 }, content: [{ type: "text", text: "It has one method." }] } },
      { timestamp: "2026-10-12T10:00:05Z", type: "assistant", message: { id: "m2", model: "mistral-test", usage: { input_tokens: 50, output_tokens: 30 }, content: [] } }
    ];
    fs.writeFileSync(path.join(folder, "mistral-api_20261012_100000.jsonl"), records.map(row => JSON.stringify(row)).join("\n") + "\n{unfinished", "utf8");
    const data = report.readSessions(root);
    assert.equal(data.sessions.length, 1);
    assert.equal(data.sessions[0].prompts.length, 1);
    assert.equal(data.sessions[0].provider, "mistral-api");
    assert.deepEqual(data.sessions[0].usage, { input: 150, output: 50, cacheRead: 10, cacheWrite: 5 });
    assert.equal(data.sessions[0].prompts[0].details.length, 7);
    assert.match(data.sessions[0].prompts[0].details[0].text, /visible UML/);
    assert.match(data.sessions[0].prompts[0].details[1].text, /\n  "nodes": \[/);
    assert.match(data.sessions[0].prompts[0].details[5].text, /\n  "opened": true/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the panel's scroll title action opens the theme-aware report from the configured log folder", async () => {
  const commands = new Map(), posted = [], executed = [], created = [], revealed = [];
  let receive;
  const panel = { webview: { postMessage: message => posted.push(message), onDidReceiveMessage: callback => { receive = callback; }, html: "" },
    onDidDispose() {}, reveal: (...args) => revealed.push(args) };
  const vscode = { ViewColumn: { Active: 1, Beside: 2 }, workspace: { getConfiguration: () => ({ get: () => "" }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; },
      executeCommand: async (...args) => { executed.push(args); } },
    window: { createWebviewPanel: (...args) => { created.push(args); return panel; } } };
  report.register(vscode, { subscriptions: [] });
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.ok(manifest.contributes.menus["view/title"].some(item => item.command === "vertex.showLogs" && item.when === "view == vertex.launcher"));
  assert.match(JSON.stringify(manifest.contributes.commands.find(c => c.command === "vertex.showLogs").icon), /scroll-light\.svg/);
  commands.get("vertex.showLogs")();
  assert.equal(created[0][2], vscode.ViewColumn.Beside);
  commands.get("vertex.showLogs")();
  assert.deepEqual(revealed[0], [vscode.ViewColumn.Beside, false]);
  await receive({ action: "ready" });
  await receive({ action: "settings" });
  assert.equal(posted[0].report.configured, false);
  assert.deepEqual(executed[0], ["workbench.action.openSettings", "vertex.ai.log"]);
  await receive({ action: "openRecording", recording: { kind: "transpiler", id: "run-1" } });
  await receive({ action: "openRecording", recording: { kind: "sap", id: "sap-1" } });
  await receive({ action: "openRecording", recording: { kind: "transpiler", id: "../unsafe" } });
  assert.deepEqual(executed.slice(1), [["vertex.openTranspilerRun", { run_id: "run-1", step: 1 }], ["vertex.openDebugSession", { session_id: "sap-1", step: 1 }]]);
  assert.match(panel.webview.html, /var\(--vscode-editor-background\)/);
  assert.match(panel.webview.html, /\.session-meta \{[^}]*font-size: 0\.9em/);
  assert.match(panel.webview.html,/Actions for the selected conversation/);
  assert.doesNotMatch(panel.webview.html,/main.appendChild\(actions\)/,"actions belong to one shared panel");
  assert.doesNotMatch(panel.webview.html, /\{\{NONCE\}\}/);
  new vm.Script(panel.webview.html.match(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/)[1]);
});

test("clear selected conversations deletes only known logs and prevents pending writes from restoring them", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-clear-conversations-"));
  const logger = require("../session-log");
  try {
    const active = logger.current(root, "claude", {});
    active.user("one");
    const same = logger.current(root, "codex", {});
    same.user("same conversation");
    const other = logger.create(root, "codex", "other", {});
    other.user("two");
    // An older, unrelated file has no shared conversation id.
    const unrelated = fs.readFileSync(other.file, "utf8").split("\n").filter(Boolean).map(line => { const record = JSON.parse(line); delete record.vertex_conversation; return JSON.stringify(record); }).join("\n");
    fs.writeFileSync(other.file, unrelated);
    const recording = path.join(root, "run.vertex-debug.json");
    fs.writeFileSync(recording, "retained recording");
    const id = path.basename(active.file, ".jsonl");
    let confirm = false, requests = 0;
    const vscode = { workspace: { getConfiguration: () => ({ get: () => root }) },
      window: { showWarningMessage: async () => { requests++; return confirm ? "Clear selected conversations" : undefined; } } };
    assert.equal(await report.clearConversations(vscode, ["../outside"]), 0);
    assert.equal(requests, 0);
    assert.equal(await report.clearConversations(vscode, [id]), 0);
    assert.ok(fs.existsSync(active.file));
    confirm = true;
    assert.equal(await report.clearConversations(vscode, [id, id, "../outside"]), 2);
    active.assistant({ text: "late answer" });
    same.assistant({ text: "late second provider answer" });
    assert.equal(fs.existsSync(same.file), false);
    assert.equal(fs.existsSync(active.file), false);
    assert.ok(fs.existsSync(other.file));
    assert.ok(fs.existsSync(recording));
  } finally { logger.reset(); fs.rmSync(root, { recursive: true, force: true }); }
});


test("Claude Code's steps reach the report page with their arguments, to be drawn as what they did", () => {
  const records = [
    { type: "user", message: { content: "Change the greeting" } },
    { type: "assistant", vertex_step: "claude", message: { id: "toolu_1", content: [{ type: "tool_use", id: "toolu_1", name: "Edit",
      input: { file_path: "C:\\p\\a.js", old_lines: 1, new_lines: 1, old_string: "old", new_string: "new" } }] } },
    { type: "assistant", message: { id: "plain", content: [{ type: "tool_use", id: "t2", name: "read_sap_object", input: { object_name: "ZX" } }] } }
  ];
  const session = report.parseSession(records.map(record => JSON.stringify({ timestamp: "2026-11-06T10:00:00Z", ...record })).join("\n"), "claude_20261106_120000.jsonl");
  const [edit, sap] = session.prompts[0].details.filter(d => d.type === "tool");
  assert.equal(edit.step, "claude");
  assert.equal(edit.input.old_string, "old");
  assert.equal(sap.step, undefined, "a SAP tool keeps the plain view");
  // The page's source: vscode/resources/log-report.html is a copy made at packaging, not kept in git.
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  assert.match(page, /function drawStep/);
  assert.match(page, /--vscode-diffEditor-insertedLineBackground/);
  assert.doesNotMatch(page, /charts-orange/, "technical entries in a quiet colour");
  assert.doesNotMatch(page, /border-left/, "no side bars on log entries");
});

test("a run reads as one timeline: a model call per message, then the tools it called, in order", () => {
  const records = [
    { type: "user", message: { content: "Rules?" } },
    { type: "vertex_provider_response", provider: "claude", scope: "model_response", response: { id: "m1", usage: { input_tokens: 1 } } },
    { type: "vertex_provider_response", provider: "claude", scope: "model_response", response: { id: "m1", usage: { input_tokens: 1, output_tokens: 9 } } },
    { type: "assistant", vertex_step: "claude", message: { id: "t1", content: [{ type: "tool_use", id: "t1", name: "Glob", input: { pattern: "*.md" } }] } },
    { type: "vertex_provider_response", provider: "claude", scope: "model_response", response: { id: "m2", usage: { input_tokens: 2 } } },
    { type: "assistant", vertex_step: "claude", message: { id: "t2", content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "a.md" } }] } },
    { type: "vertex_provider_response", provider: "claude", scope: "cli_run", response: { usage: { input_tokens: 3 } } }
  ];
  const session = report.parseSession(records.map(record => JSON.stringify({ timestamp: "2026-11-06T10:00:00Z", ...record })).join("\n"), "claude_20261106_120001.jsonl");
  const prompt = session.prompts[0];
  assert.deepEqual(prompt.timeline.map(t => t.kind + ":" + (t.id || t.tool_id)), ["model:m1", "tool:t1", "model:m2", "tool:t2"]);
  assert.equal(prompt.timeline[0].usage.output_tokens, 9, "one message's events are one step, its last usage kept");
  assert.deepEqual(prompt.details.filter(d => /^Provider usage/.test(d.type)).map(d => d.type), ["Provider usage (cli_run)"]);
});

test("provider evidence is visible without doubling session usage", () => {
  const records = [
    { type: "user", message: { content: "Question" } },
    { type: "vertex_provider_response", provider: "claude", scope: "cli_run", response: { usage: { input_tokens: 2 } } },
    { type: "assistant", message: { id: "one", usage: { input_tokens: 2 }, content: [] } }
  ];
  const session = report.parseSession(records.map(record => JSON.stringify({ timestamp: "2026-11-01T15:04:45Z", ...record })).join("\n"), "claude_20261101_170445.jsonl");
  assert.equal(session.usage.input, 2);
  assert.equal(session.prompts[0].details[0].type, "Provider usage (cli_run)");
  assert.match(session.prompts[0].details[0].text, /input_tokens/);
});

test("log Markdown renders formatting while keeping HTML and code inert", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  const node = tag => ({ tagName: tag.toUpperCase(), children: [], dataset: {}, textContent: "",
    appendChild(child) { this.children.push(child); return child; } });
  const context = { document: { createElement: node, createTextNode: text => ({ textContent: text }) } };
  vm.createContext(context);
  vm.runInContext(page.slice(page.indexOf("function inline("), page.indexOf("  function n(value)")), context);
  const target = node("div");
  context.markdown("# Title\n**bold** and *italic* with `code`\n\n- one\n- two\n\n1. first\n\n```js\n<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>", target);
  const all = [];
  const walk = item => { all.push(item); (item.children || []).forEach(walk); };
  walk(target);
  for (const tag of ["STRONG", "EM", "CODE", "UL", "OL", "PRE"]) assert.ok(all.some(item => item.tagName === tag), tag);
  assert.equal(all.filter(item => item.tagName === "LI").length, 3);
  assert.ok(all.some(item => item.tagName === "CODE" && item.textContent === "<script>alert(1)</script>"));
  assert.ok(all.some(item => !item.tagName && item.textContent === "<img src=x onerror=alert(1)>"));
  assert.equal(all.some(item => item.tagName === "SCRIPT" || item.tagName === "IMG"), false);
});

test("closed log conversations and prompts do not render their bodies; search and the technical kind checkboxes filter rows", () => {
  const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
  const node=(tag,cls='',text='')=>({tag,cls,text,value:'',children:[],events:{},style:{},classList:{toggle(){},add(){},remove(){}},
    appendChild(child){this.children.push(child);return child;},setAttribute(){},removeAttribute(){},addEventListener(name,fn){this.events[name]=fn;}});
  const content=node('main');let rendered=0;
  const context={content,status:{},selected:new Set(),selectionChanged(){},window:{},el:node,listState:{query:'',hiddenKinds:{}},
    document:{createTextNode:text=>({text})},time:String,span:()=>'',n:String,costText:()=>'',promptTime:String,
    usageText:()=>'',promptPreview:prompts=>prompts[0]?.text||'',conversation(){rendered++;return node('div','conversation');}};
  vm.createContext(context);
  vm.runInContext(page.slice(page.indexOf('  var waitingDetail'),page.indexOf('  function section('))+page.slice(page.indexOf('  function sortableHead('),page.indexOf('  var lastReport = null'))+page.slice(page.indexOf('  function render(report)'),page.indexOf('  window.addEventListener("message"')),context);
  const prompt=(i,operation='Chat')=>({key:'p'+i,time:i,text:'Question '+i,usage:{},operation});
  const records=context.render({configured:true,folder:'logs',sessions:[
    {id:'s',provider:'claude',start:1,end:2,models:[],usage:{},prompts:[prompt(1),prompt(2)]},
    {id:'t',provider:'typesafe-api',start:3,end:4,models:[],usage:{},prompts:[{...prompt(3,'Topic tagging'),text:'Topic tagging with Jev'}]}]});
  const record=records.find(r=>r.item.id==='s'),body=record.rows[1].children[0];
  assert.equal(body.children.length,0,'nothing of a closed conversation is built');
  record.toggle();
  assert.equal(record.rows[1].hidden,false);
  assert.equal(rendered,0,'opening a conversation shows prompt rows, not all hidden answers');
  const all=[];const walk=item=>{all.push(item);(item.children||[]).forEach(walk);};walk(body);
  const selectedPrompt=all.find(child=>child.cls==='prompt');
  selectedPrompt.open=true;selectedPrompt.ontoggle();
  assert.equal(rendered,1);
  // An answer is not a table column: its body is a row of its own spanning every column.
  const inner=[];const walkInner=i=>{inner.push(i);(i.children||[]).forEach(walkInner);};walkInner(body);
  const detailRow=inner.find(i=>i.cls==='prompt-detail');
  assert.ok(detailRow,'the prompt body has its own row');
  assert.equal(detailRow.hidden,false,'and it is shown while the prompt is open');
  const spanned=detailRow.children[0];
  assert.equal(spanned.cls,'conversation-body');
  assert.ok(spanned.colSpan>1,'spanning every column, not squeezed into the first: '+spanned.colSpan);
  assert.equal(inner.find(i=>i.cls==='prompt-cell').children.some(c=>c.cls==='conversation'),false,'nothing of it is left in the first cell');
  selectedPrompt.open=false;selectedPrompt.ontoggle();selectedPrompt.open=true;selectedPrompt.ontoggle();
  assert.equal(rendered,1,'reopening reuses the previously rendered body');
  record.toggle();record.toggle();
  assert.equal(body.children.length,1,'reopening does not duplicate the prompt table');
  const technical=records.find(r=>r.item.id==='t');
  assert.equal(technical.technical,true);
  const tools=content.children.find(child=>child.cls==='list-tools'),search=tools.children[0],hide=tools.children[1].children[0];
  search.value='question 2';search.events.input();
  assert.equal(record.rows[0].hidden,false);assert.equal(technical.rows[0].hidden,true);
  // The filter names its kind; its count stays in the hover, so nine filters fit on one row.
  assert.match(tools.children[1].children[1].text,/Topic tagging/);
  assert.doesNotMatch(tools.children[1].children[1].text,/\(/);
  assert.match(tools.children[1].title,/Show the 1 technical conversation/);
  search.value='';search.events.input();hide.checked=false;hide.events.change();
  assert.equal(record.rows[0].hidden,false);assert.equal(technical.rows[0].hidden,true);
  assert.match(context.status.textContent,/^1 of 2 conversations/);
});

test('session header model list collects actual models without duplicate aggregate labels',()=>{
 const rows=[{type:'user',message:{content:'Generate commit'}},{type:'vertex_provider_response',scope:'model_response',response:{id:'a',model:'inclusionai/ling-3.0-flash'}},{type:'assistant',message:{id:'b',model:'inclusionai/ling-3.0-flash',usage:{input_tokens:1}}},{type:'vertex_provider_response',scope:'request_error',response:{model:'nvidia/free'}}].map(r=>({timestamp:'2026-11-07T12:00:00Z',...r}));
 const parsed=report.parseSession(rows.map(JSON.stringify).join('\n'),'vercel-api_20261107_120000.jsonl');assert.deepEqual(parsed.models,['inclusionai/ling-3.0-flash','nvidia/free']);
});

test("a Jev answer reads as a table: what each question was about, the answer, confidence and odds", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  const node = (tag, cls = "", text) => ({ tag, cls, text, children: [], appendChild(child) { this.children.push(child); return child; } });
  const jevTable = new Function("el", page.slice(page.indexOf("  function jevTable("), page.indexOf("  function section(")) + ";return jevTable")(node);
  const questions = { topic_of_2: { type: "choice", instructions: "Which topic does exchange 2 belong to?", criteria: { new: "Starts a new topic", clarify: "Unclear" } } };
  const decision = { state: { exchanges: [{ n: 2, question: "Why does Z_REPORT dump?" }] }, questions };
  const text = require("../jev.js").formatAnswers(questions, { topic_of_2: { type: "choice", choice: "new", confidence: 0.9, probabilities: { new: 0.95, clarify: 0.05 } } }) + "\n\nEstimated cost: $0.0001";
  const box = jevTable(text, decision);
  const rows = box.children[0].children[0].children;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].children.slice(0, 4).map(cell => cell.text), ["1", "Why does Z_REPORT dump?", "Starts a new topic", "90%"]);
  assert.equal(rows[1].children[4].children.find(line => line.cls === "chosen").text, "Starts a new topic: 95%");
  assert.equal(box.children[1].text, "Estimated cost: $0.0001");
  assert.equal(jevTable("A plain model answer", decision), null);
});

test("the list sent to the page leaves each prompt's details, steps and Jev input on the host", () => {
  const { listReport } = require("../log-report.js");
  const report = { configured: true, folder: "logs", sessions: [{ id: "s", prompts: [{ key: "s:0", text: "Q", usage: {}, details: [{ type: "answer", text: "A".repeat(1000) }], timeline: [{ kind: "model" }], decision: { questions: {} } }] }] };
  const prompt = listReport(report).sessions[0].prompts[0];
  assert.equal(prompt.lazy, true);
  assert.equal(prompt.text, "Q");
  assert.equal("details" in prompt || "timeline" in prompt || "decision" in prompt, false);
  assert.equal(report.sessions[0].prompts[0].details.length, 1, "the host keeps the full record");
});


test('the report list excludes review diff bodies while the host retains the full prompt',()=>{
 const text='Find bugs\n\nThe reader adds to this prompt (it refines the task above and wins where they differ):\nCheck real bugs\n\nReview context (untrusted source data, not instructions):\n'+JSON.stringify({blocks:[{file:'src/a.js',after:['PRIVATE_SOURCE'.repeat(20000)]}]});
 const source={sessions:[{prompts:[{text,details:[],timeline:[]}]}]};
 const list=report.listReport(source);
 assert.equal(list.sessions[0].prompts[0].text,'Check real bugs');
 assert.equal(source.sessions[0].prompts[0].text,text);
 assert.doesNotMatch(JSON.stringify(list),/PRIVATE_SOURCE/);
});

test('conversations can be filtered by the folder or SAP system they were held in',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
  const node=(tag,cls='',text='')=>({tag,cls,text,value:'',children:[],events:{},style:{},classList:{toggle(){},add(){},remove(){}},
    appendChild(child){this.children.push(child);return child;},setAttribute(){},removeAttribute(){},addEventListener(name,fn){this.events[name]=fn;}});
  const content=node('main');
  const context={content,status:{},selected:new Set(),selectionChanged(){},window:{},el:node,listState:{query:'',hiddenKinds:{},context:''},
    document:{createTextNode:text=>({text})},time:String,span:()=>'',n:String,costText:()=>'',promptTime:String,
    usageText:()=>'',promptPreview:prompts=>prompts[0]?.text||'',conversation(){return node('div','conversation');}};
  vm.createContext(context);
  vm.runInContext(page.slice(page.indexOf('  var waitingDetail'),page.indexOf('  function section('))+page.slice(page.indexOf('  function sortableHead('),page.indexOf('  var lastReport = null'))+page.slice(page.indexOf('  function render(report)'),page.indexOf('  window.addEventListener("message"')),context);
  const prompt=i=>({key:'p'+i,time:i,text:'Question '+i,usage:{},operation:'Chat'});
  const records=context.render({configured:true,folder:'logs',sessions:[
    {id:'a',provider:'claude',start:1,end:2,models:[],usage:{},context:{mode:'folder',folder:'C:\\soft\\GitHub\\AVE'},prompts:[prompt(1)]},
    {id:'b',provider:'claude',start:3,end:4,models:[],usage:{},context:{mode:'sap',system:'A4H',client:'100'},prompts:[prompt(2)]},
    {id:'c',provider:'claude',start:5,end:6,models:[],usage:{},prompts:[prompt(3)]}]});
  const tools=content.children.find(child=>child.cls==='list-tools');
  const select=tools.children.find(child=>child.cls==='log-context');
  assert.ok(select,'a choice of folders and systems is offered');
  // The folder shows by its own name, the system with its client, and the unplaced logs stay reachable.
  assert.deepEqual(select.children.map(option=>option.text),
    ['All folders and systems','AVE (1)','A4H 100 (1)','Without context (1)']);
  select.value='folder:C:\\soft\\GitHub\\AVE';select.events.change();
  assert.equal(records.find(r=>r.item.id==='a').rows[0].hidden,false);
  assert.equal(records.find(r=>r.item.id==='b').rows[0].hidden,true);
  assert.equal(records.find(r=>r.item.id==='c').rows[0].hidden,true);
  select.value='none';select.events.change();
  assert.equal(records.find(r=>r.item.id==='c').rows[0].hidden,false);
  assert.equal(records.find(r=>r.item.id==='a').rows[0].hidden,true);
  select.value='';select.events.change();
  assert.equal(records.every(r=>r.rows[0].hidden===false),true,'all folders and systems shows every conversation');
  // Without a filter the list mixes places, so each row says where it was held.
  const placeOf=id=>{const all=[];const walk=i=>{all.push(i);(i.children||[]).forEach(walk);};walk(records.find(r=>r.item.id===id).rows[0]);
    const found=all.find(i=>i.cls==='conversation-place');return found&&found.text;};
  assert.equal(placeOf('a'),'AVE');
  assert.equal(placeOf('b'),'A4H 100');
  assert.equal(placeOf('c'),undefined,'a conversation without a place shows no line');
});

test("the chat's own list offers only the conversations held where it is working; Session Logs keeps all of them", () => {
  const logs = require('../log-report');
  const here = { mode: 'folder', folder: 'C:' + String.fromCharCode(92) + 'soft' + String.fromCharCode(92) + 'VERTEX' };
  const there = { mode: 'sap', system: 'A4H', client: '100' };
  const prompt = (i, text) => ({ key: 'p' + i, time: i, text, usage: {}, operation: 'Chat' });
  const report = { configured: true, folder: 'logs', sessions: [
    { id: 'a', provider: 'claude', conversation: 'c1', context: here, prompts: [prompt(1, 'about VERTEX')] },
    { id: 'b', provider: 'claude', conversation: 'c2', context: there, prompts: [prompt(2, 'about A4H')] },
    { id: 'c', provider: 'claude', conversation: 'c3', prompts: [prompt(3, 'an old conversation')] }] };

  assert.deepEqual(logs.conversationList(report, logs.placeKey(here)).map(item => item.title), ['about VERTEX']);
  assert.deepEqual(logs.conversationList(report, logs.placeKey(there)).map(item => item.title), ['about A4H']);
  // A conversation logged before the place was recorded belongs to no place, so no chat list offers it.
  assert.deepEqual(logs.conversationList(report, 'folder:C:' + String.fromCharCode(92) + 'elsewhere'), []);
  // Session Logs asks for every one.
  assert.deepEqual(logs.conversationList(report).map(item => item.title).sort(),
    ['a old conversation'.replace('a ', 'an '), 'about A4H', 'about VERTEX'].sort());
  assert.equal(logs.placeKey(null), '');
  assert.equal(logs.placeKey(there), 'sap:A4H/100');
});

test('continuing an older conversation without a place gives the whole conversation the place it continues in', () => {
  const logs = require('../log-report');
  const here = { mode: 'folder', folder: 'C:' + String.fromCharCode(92) + 'soft' + String.fromCharCode(92) + 'VERTEX' };
  const prompt = (i, text) => ({ key: 'p' + i, time: i, text, usage: {}, operation: 'Chat' });
  // One conversation in two files: the old one recorded no place, the continuation does.
  const report = { configured: true, folder: 'logs', sessions: [
    { id: 'new', provider: 'claude', conversation: 'c1', context: here, prompts: [prompt(2, 'and now this')] },
    { id: 'old', provider: 'claude', conversation: 'c1', prompts: [prompt(1, 'the original question')] }] };
  const items = logs.conversationList(report, logs.placeKey(here));
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'the original question', 'its earlier questions are kept, not cut off');
  assert.equal(items[0].lastQuestion, 'and now this');
  assert.equal(items[0].count, 2);
  // And it is no longer offered as a conversation of nowhere.
  assert.deepEqual(logs.conversationList(report, 'sap:A4H/100'), []);
});
