"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const report = require("../log-report");

test("visible log report follows file changes, retries failures and stops polling on disposal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-live-logs-"));
  const folder = path.join(root, "claude_compatible");
  const posted = [], timers = new Map();
  let receive, dispose, visibility, configuredRoot = root, reads = 0, rejectRead = false;
  const realRequire = require("node:module").createRequire(path.join(__dirname, "../log-report.js"));
  const fakeFs = { ...fs, readFileSync(file, ...args) {
    if (String(file).endsWith(".jsonl")) {
      reads++;
      if (rejectRead) throw new Error("temporary log read failure");
    }
    const relative = path.relative(path.join(__dirname, "../resources"), String(file));
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      file = path.join(__dirname, "../../org.vertex.abap.ui/resources", relative);
    }
    return fs.readFileSync(file, ...args);
  } };
  const panel = { visible: true, webview: {
    postMessage: async message => { posted.push(message); return true; },
    onDidReceiveMessage: fn => { receive = fn; }
  }, onDidDispose: fn => { dispose = fn; }, onDidChangeViewState: fn => {
    visibility = fn; return { dispose() { visibility = null; } };
  }, reveal() {} };
  const vscode = { ViewColumn: { Beside: 2 }, workspace: {
    getConfiguration: () => ({ get: (key, fallback) => key === "logPath" ? configuredRoot : fallback })
  }, window: { createWebviewPanel: () => panel } };
  const sandbox = { module: { exports: {} }, __dirname: path.join(__dirname, ".."),
    require: name => name === "fs" ? fakeFs : name === "./usage-report" ?
      { ...realRequire("./usage-report"), browserEngine: () => "" } :
      name === "./review-jev" ? { enabled: () => false } : realRequire(name),
    setInterval: (fn, delay) => { assert.equal(delay, 500); timers.set(1, fn); return 1; },
    clearInterval: id => timers.delete(id)
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../log-report.js"), "utf8"), sandbox);
  sandbox.module.exports.open(vscode);
  const tick = async () => { await timers.get(1)?.(); };
  const write = (name, rows) => fs.writeFileSync(path.join(folder, name),
    rows.map(row => JSON.stringify({ timestamp: "2026-11-19T10:00:00Z", ...row })).join("\n") + "\n");
  try {
    await tick(); assert.equal(posted.length, 0, "wait for webview ready");
    await receive({ action: "ready" });
    assert.equal(posted.at(-1).report.sessions.length, 0, "missing log directory is supported");
    await tick(); assert.equal(posted.length, 1, "unchanged folder is not republished");
    fs.mkdirSync(folder);
    write("codex_live.jsonl", [{ type: "user", message: { content: "New question" } }]);
    await tick();
    assert.equal(posted.at(-1).report.sessions[0].prompts[0].text, "New question");
    assert.equal(posted.at(-1).automatic, true);
    const readCount = reads;
    await tick(); assert.equal(reads, readCount, "unchanged logs are not reparsed");
    panel.visible = false;
    fs.appendFileSync(path.join(folder, "codex_live.jsonl"), JSON.stringify({
      timestamp: "2026-11-19T10:00:01Z", type: "assistant",
      message: { id: "answer", content: [{ type: "text", text: "New answer" }], usage: { input_tokens: 2 } }
    }) + "\n");
    await tick(); assert.equal(reads, readCount, "hidden panels do no file reads");
    panel.visible = true; await visibility();
    assert.equal(posted.at(-1).report.sessions[0].usage.input, 2);
    await receive({ action: "promptDetail", key: posted.at(-1).report.sessions[0].prompts[0].key });
    assert.ok(posted.at(-1).prompt.details.some(detail => detail.text === "New answer"));
    fs.appendFileSync(path.join(folder, "codex_live.jsonl"), "\n");
    rejectRead = true; const count = posted.length;
    await tick(); assert.equal(posted.length, count, "transient errors keep the readable report");
    rejectRead = false; await tick(); assert.equal(posted.length, count + 1, "failed updates retry");
    fs.unlinkSync(path.join(folder, "codex_live.jsonl")); await tick();
    assert.equal(posted.at(-1).report.sessions.length, 0, "deleted logs disappear");
    configuredRoot = path.join(root, "other"); await tick();
    assert.equal(posted.at(-1).report.folder, path.join(configuredRoot, "claude_compatible"));
    dispose(); assert.equal(timers.size, 0); assert.equal(visibility, null);
  } finally { dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("automatic log updates wait for the Flow detail dialog to close and retain only the latest report", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  let dialogOpen = true, receive, close;
  const rendered = [];
  const sandbox = {
    document: { querySelector: () => dialogOpen ? {} : null, addEventListener: (name, fn) => { close = fn; } },
    window: { scrollX: 0, scrollY: 10, scrollTo() {}, addEventListener: (name, fn) => { receive = fn; },
      dispatchEvent: event => receive(event) },
    MessageEvent: class MessageEvent { constructor(name, options) { this.data = options.data; } },
    rememberReading() {}, render: report => rendered.push(report.id), reportMode: "logs",
    waitingDetail: {}, conversationState: null, vscode: { postMessage() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(page.slice(page.indexOf("  function readingAnchor()"), page.indexOf('  vscode.postMessage({ action: "ready" });')), sandbox);
  receive({ data: { action: "data", automatic: true, report: { id: 1 } } });
  receive({ data: { action: "data", automatic: true, report: { id: 2 } } });
  assert.deepEqual(rendered, []);
  dialogOpen = false; close();
  assert.deepEqual(rendered, [2]);
  close(); assert.deepEqual(rendered, [2], "a close event cannot replay an older report");
});
test("automatic log update keeps the row being read at the same screen position", () => {
  const page=fs.readFileSync(path.join(__dirname,"../../org.vertex.abap.ui/resources/log-report.html"),"utf8");
  let receive,top=80,shift=0;
  const row={dataset:{sessionId:"old"},getBoundingClientRect:()=>({top:top+shift,bottom:top+shift+30})};
  const sandbox={document:{querySelector:()=>null,querySelectorAll:()=>[row],addEventListener(){}},
    window:{scrollX:0,scrollY:200,scrollTo(){},scrollBy(_x,y){shift-=y;},addEventListener(_name,fn){receive=fn;}},
    conversationState:null,conversationScreen:{hidden:true},rememberReading(){},render(){top+=45;},reportMode:"logs",
    waitingDetail:{},vscode:{postMessage(){}}};
  vm.createContext(sandbox);
  vm.runInContext(page.slice(page.indexOf("  function readingAnchor()"),page.indexOf('  vscode.postMessage({ action: "ready" });')),sandbox);
  receive({data:{action:"data",automatic:true,report:{}}});
  assert.equal(shift,-45);
  assert.equal(row.getBoundingClientRect().top,80);
});
test("automatic log update preserves scrolling inside an open conversation", () => {
  const page=fs.readFileSync(path.join(__dirname,"../../org.vertex.abap.ui/resources/log-report.html"),"utf8");
  let receive,pane={scrollTop:320,scrollLeft:40};
  const sandbox={document:{querySelector:selector=>selector.includes("table-scroll")?pane:null,querySelectorAll:()=>[],addEventListener(){}},
    window:{scrollX:0,scrollY:0,scrollTo(){},addEventListener(_name,fn){receive=fn;}},
    conversationState:{id:"one"},conversationScreen:{hidden:false},rememberReading(){},render(){pane={scrollTop:0,scrollLeft:0};},reportMode:"logs",
    waitingDetail:{},vscode:{postMessage(){}}};
  vm.createContext(sandbox);
  vm.runInContext(page.slice(page.indexOf("  function readingAnchor()"),page.indexOf('  vscode.postMessage({ action: "ready" });')),sandbox);
  receive({data:{action:"data",automatic:true,report:{}}});
  assert.equal(pane.scrollTop,320);
  assert.equal(pane.scrollLeft,40);
});

test("log refresh restores lazy nested disclosures while keeping new steps closed", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  const element = (tag, text = "") => ({
    tagName: tag.toUpperCase(), textContent: text, children: [], open: false,
    querySelector() { return this.children.find(child => child.tagName === "SUMMARY"); },
    dispatchEvent() { if (this.populate) { const fn = this.populate; this.populate = null; fn(); } }
  });
  const detail = label => { const node = element("details"); node.children.push(element("summary", label)); return node; };
  const before = element("div"), steps = detail("Steps (1 model call, 1 tool call)"), tool = detail("1. Read");
  before.children.push(steps); steps.children.push(tool); steps.open = tool.open = true;
  const sandbox = { Event: class Event {}, document: {} }; vm.createContext(sandbox);
  vm.runInContext(page.slice(page.indexOf("  function disclosureState("), page.indexOf("  function rememberReading(")), sandbox);
  const saved = sandbox.disclosureState(before);
  const after = element("div"), updatedSteps = detail("Steps (2 model calls, 2 tool calls)");
  const updatedTool = detail("1. Read"), newTool = detail("2. Write");
  updatedSteps.populate = () => updatedSteps.children.push(updatedTool, newTool);
  after.children.push(updatedSteps);
  sandbox.disclosureState(after, saved);
  assert.equal(updatedSteps.open, true); assert.equal(updatedTool.open, true); assert.equal(newTool.open, false);
});
test("unchanged open prompt reuses its detail across automatic refreshes", () => {
  const page=fs.readFileSync(path.join(__dirname,"../../org.vertex.abap.ui/resources/log-report.html"),"utf8");
  const requests=[];
  const sandbox={vscode:{postMessage:value=>requests.push(value)}};
  vm.createContext(sandbox);
  vm.runInContext(page.slice(page.indexOf("  var waitingDetail = {}"),page.indexOf("  function serviceResult(")),sandbox);
  const first={key:"prompt-1",end:42,lazy:true};
  sandbox.loadPromptDetails(first,()=>{});
  assert.equal(requests.length,1);
  sandbox.waitingDetail[first.key][0]({prompt:{details:[{type:"answer",text:"Done"}]}});
  delete sandbox.waitingDetail[first.key];
  const again={key:"prompt-1",end:42,lazy:true};
  sandbox.loadPromptDetails(again,()=>{});
  assert.equal(requests.length,1);
  assert.equal(again.lazy,false);
  assert.equal(again.details[0].text,"Done");
  sandbox.loadPromptDetails({key:"prompt-1",end:43,lazy:true},()=>{});
  assert.equal(requests.length,2);
});


test('chronology renders streamed thinking and text between tool steps',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
  const element=label=>({label,children:[],querySelector(){return null;},appendChild(child){this.children.push(child);},addEventListener(type,callback){this[type]=callback;}});
  const context={section:(label,kind,text)=>({...element(label),kind,text}),Date,Map,Set};
  vm.createContext(context);
  vm.runInContext(page.slice(page.indexOf('  function chronology('),page.indexOf('  function conversation(')),context);
  const prompt={time:1,details:[],events:[
    {kind:'note',time:2,model:{note:'thinking',text:'First reasoning part'}},
    {kind:'note',time:3,model:{note:'text',text:'Partial reply'}},
    {kind:'note',time:4,model:{note:'thinking',text:'Next reasoning part'}}]};
  const box=context.chronology(prompt,element('User'));box.toggle();
  assert.deepEqual(Array.from(box.children.slice(1),entry=>entry.text),['First reasoning part','Partial reply','Next reasoning part']);
  assert.match(box.children[1].label,/2\. .*Thinking/);
  assert.match(box.children[2].label,/3\. .*Assistant text/);
});

test('matched skill is labeled Skill search in the recorded chronology',()=>{
 const rows=[{type:'user',message:{content:'собери всикс'}},{type:'vertex_topic_routing',report:{status:'skill',skill:'build-vertex-vsix',beforeMessages:6,afterMessages:0}}];
 const session=report.parseSession(rows.map(row=>JSON.stringify({timestamp:'2026-11-16T18:41:51Z',...row})).join('\n'),'codex_skill.jsonl');
 assert.equal(session.prompts[0].details[0].type,'Skill search');
});
test('skill search audit from an older log joins its parent conversation',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const source=page.slice(page.indexOf('    var internal = function (s)'),page.indexOf('    var parents ='));
 const context={};vm.createContext(context);vm.runInContext(source+'\nthis.internal=internal;',context);
 assert.equal(context.internal({prompts:[{operation:'Skill match with Jev'}]}),true);
});

test('question links expose recorded prompt parts in assembly order for older and skill logs',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const source=page.slice(page.indexOf('  function promptSources('),page.indexOf('  function promptSourceLinks('));
 const context={};vm.createContext(context);vm.runInContext(source,context);
 const parts=context.promptSources({details:[
  {type:'VERTEX instructions',text:'Context mode: folder.\nVERTEX Code Agent (alpha): rules\nYou are VERTEX, an AI code agent: answer'},
  {type:'Model request and context',text:'Previous conversation:\n[]\n\nMatched project skill (instructions for this request):\nbuild\n\nCurrent local project access:\n{"project_rules":[{"path":"AGENTS.md","text":"project rule"}]}\n\nRequest:\nпересобери'},
  {type:'Available tools',text:'Bash'}, {type:'Answer schema',text:'answer'}]});
 assert.deepEqual(Array.from(parts,p=>p.label),[
  'System · Environment and host rules','System · Code Agent','System · VERTEX agent',
  'Prompt · Previous conversation','Prompt · Matched project skill (instructions for this request)',
  'Prompt · Current local project access','Project rule · AGENTS.md','Prompt · Request',
  'Tools · available functions','Output · answer schema']);
 const skill=context.promptSources({details:[{type:'VERTEX instructions',text:'You are VERTEX. Run Bash once.'},
  {type:'Model request and context',text:'Matched local skill:\nBuild VSIX\n\nProject root: C:\\soft\\GitHub\\VERTEX\n\nCurrent request: пересобери'},
  {type:'Available tools',text:'Bash'}]});
 assert.deepEqual(Array.from(skill,p=>p.label),['System · Environment and host rules','Prompt · Matched local skill',
  'Prompt · Project root','Prompt · Current request','Tools · available functions']);
});

test('lazy prompt starts with chronological disclosures instead of repeated legacy sections', () => {
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const element=()=>({children:[],appendChild(child){this.children.push(child);},addEventListener(){}});
 const context={el:element,section:label=>({...element(),label})};vm.createContext(context);
 vm.runInContext(page.slice(page.indexOf('  var waitingDetail = {};'),page.indexOf('  function section(')),context);
 const holder=context.lazyConversation({lazy:true,sections:['User','Task verification with Jev','Task verification with Jev']});
 assert.deepEqual(Array.from(holder.children,entry=>entry.label),['User','Steps (chronological)']);
});

test('every AI Review round is a chat step of its own, not a technical step of a question',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const context={};vm.createContext(context);
 vm.runInContext(page.slice(page.indexOf('  function chatStep('),page.indexOf('  function chronology('))+'\nthis.promptSteps=promptSteps;',context);
 const chat={operation:'Chat',text:'Change it',time:1000,key:'a',turnId:'turn1'};
 const jev={operation:'Task verification with Jev',time:1500,key:'b'};
 const round=(text,time)=>({operation:'AI Review',text,time,key:text,relatedTurnId:'turn1',sourceConversation:'r1'});
 const later={operation:'Chat',text:'Next',time:5000,key:'z'};
 const steps=context.promptSteps([later,round('Follow-up',3000),jev,round('First review',2000),chat]);
 assert.deepEqual(Array.from(steps.rows,p=>p.text),['Change it','First review','Follow-up','Next']);
 assert.deepEqual(Array.from(steps.technicalByChat.get(chat),p=>p.operation),['Task verification with Jev']);
 assert.equal(steps.technicalByChat.has(steps.rows[1]),false);
 const lone=context.promptSteps([round('Only review',2000)]);
 assert.deepEqual(Array.from(lone.rows,p=>p.text),['Only review']);
 assert.doesNotMatch(page,/AI Review · "\+rounds\.length/);
});

test('legacy checks and recovery states retain file order as distinct chronological actors',()=>{
 const rows=[{type:'user',message:{content:'Edit'}},{type:'vertex_topic_routing',report:{topic:{id:'t'}}},{type:'vertex_request',request:{instructions:'Rules',prompt:'Edit',tools:[],schema:null}},
 {type:'assistant',vertex_step:'local',message:{content:[{type:'tool_use',id:'lint',name:'Verification',input:{files:['x.js']}}]}},
 {type:'user',message:{content:[{type:'tool_result',tool_use_id:'lint',content:'PASSED'}]}},
 {type:'vertex_task_verification',report:{status:'failed',checks:[]}},{type:'vertex_task_verification',report:{status:'failed',checks:[],recovery:'started',attempt:1}},
 {type:'vertex_provider_response',provider:'codex',scope:'model_response',response:{id:'run',usage:{input_tokens:10}}},
 {type:'vertex_task_verification',report:{status:'passed',checks:[]}},{type:'vertex_task_recovery',report:{status:'passed',recovery:'finished',attempt:1}}];
 const session=report.parseSession(rows.map((r,i)=>JSON.stringify({timestamp:new Date(Date.UTC(2026,10,15,7,0,i)).toISOString(),...r})).join('\n'),'codex_20261115_090000.jsonl');
 const prompt=session.prompts[0];assert.deepEqual(prompt.events.map(e=>e.actor),['Jev','LLM','Checks','Checks','Jev','VERTEX orchestrator','LLM','Jev','VERTEX orchestrator']);
 assert.deepEqual(prompt.events.map(e=>e.time),prompt.events.map(e=>e.time).slice().sort((a,b)=>a-b));assert.equal(prompt.details.filter(d=>d.verification).length,2);assert.equal(prompt.details.filter(d=>/^Recovery:/.test(d.type)).length,2);
 assert.equal(report.listReport({sessions:[session]}).sessions[0].prompts[0].events,undefined);
});

test('global task verification is a distinct detail and does not double executor token usage',()=>{
 const records=[{type:'user',message:{content:'Build'}},{type:'assistant',message:{id:'answer',usage:{input_tokens:10,output_tokens:2},content:[]}},{type:'vertex_task_verification',report:{status:'failed',usage:{input_tokens:100}}}];
 const session=report.parseSession(records.map(r=>JSON.stringify({timestamp:'2026-11-15T06:00:00Z',...r})).join('\n'),'codex_20261115_080000.jsonl');
 assert.equal(session.usage.input,10);const detail=session.prompts[0].details.find(d=>d.type==='Task verification with Jev');assert.equal(detail.failed,true);assert.match(detail.text,/failed/);
});

test('Codex turn totals are marked separately from individual API model responses',()=>{
 const records=[{type:'user',message:{content:'Inspect'}},{type:'vertex_provider_response',provider:'codex',scope:'model_response',response:{id:'turn:1',usage:{input_tokens:100}}}];
 const session=report.parseSession(records.map(record=>JSON.stringify({timestamp:'2026-11-14T01:00:00Z',...record})).join('\n'),'codex_fixture.jsonl');
 assert.equal(session.prompts[0].timeline[0].usageScope,'cli_turn');
});

test('historical version links retain the exact revision URI and tool result identity',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const el=(tag,cls='',text='')=>({tag,cls,text,children:[],appendChild(child){this.children.push(child);return child;}});
 const messages=[],context={el,window:{vertexCanReadVersions:true},document:{getElementById:()=>({value:'',textContent:''}),createTextNode:text=>({text})},vscode:{postMessage:message=>messages.push(message)}};vm.createContext(context);
 vm.runInContext(page.slice(page.indexOf('  function line('),page.indexOf('  function drawStep(')),context);
 const target=el('div'),uri='/sap/bc/adt/programs/programs/Z_OLD/source/main/versions/20261023/00001/content';
 context.fields(target,{object:{name:'Z_OLD'},revisions:[{id:'00001',uri,author:'AUTHOR'}]},'prompt:1','tool-1');
 const link=target.children[0].children.find(node=>node.tag==='button');assert.ok(link);link.onclick();
 assert.equal(messages[0].uri,uri);assert.equal(messages[0].toolId,'tool-1');assert.equal(messages[0].key,'prompt:1');
});

test('old clipped serialized query responses retain only complete rows and an explicit warning',()=>{
 const data={totalRows:1502,columns:['ID','TEXT'],rows:[{ID:1,TEXT:'Quoted "value" with \\ path'},{ID:2,TEXT:'Second'},{ID:3,TEXT:'Incomplete'}]};
 for(const source of [JSON.stringify(data),JSON.stringify(JSON.stringify(data))]){
  const cut=source.indexOf('Incomplete')+3;
  const result=JSON.parse(report.prettyJson(source.slice(0,cut)+'\n[139824 more characters not logged]'));
  assert.deepEqual(result.rows,data.rows.slice(0,2));assert.equal(result.totalRows,1502);assert.match(result.log_truncated,/Only 2 complete rows/);
 }
 assert.equal(report.prettyJson('ordinary text\n[12 more characters not logged]'),'ordinary text\n[12 more characters not logged]');
});

test('SQL arguments use the existing link style and send the full statement with its prompt key',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const el=(tag,cls='',text='')=>({tag,cls,text,children:[],appendChild(child){this.children.push(child);return child;}});
 const messages=[],context={el,document:{getElementById:()=>({value:'',textContent:''}),createTextNode:text=>({text})},vscode:{postMessage:message=>messages.push(message)}};vm.createContext(context);
 vm.runInContext(page.slice(page.indexOf('  function line('),page.indexOf('  function diffBlock(')),context);
 const target=el('div'),sql='SELECT * FROM e070 WHERE trkorr = '+"'ALCK900781'";
 context.line(target,'sql',sql,'prompt:1');const link=target.children[0].children[1];
 assert.equal(link.cls,'recording-link');link.onclick();assert.equal(messages[0].sql,sql);assert.equal(messages[0].key,'prompt:1');assert.equal(messages[0].action,'openSelect');
});

test('tool results decode serialized JSON layers and preserve ordinary text backslashes',()=>{
 const result={columns:['NAME'],rows:[{NAME:'First\nSecond'}],rowsReturned:1};
 const parse=content=>report.parseSession([
  {type:'user',message:{content:'Read'}},
  {type:'user',message:{content:[{type:'tool_result',content}]}}
 ].map(record=>JSON.stringify({timestamp:'2026-11-14T01:00:00Z',...record})).join('\n'),'test.jsonl').prompts[0].details.find(d=>d.type==='tool result').text;
 assert.deepEqual(JSON.parse(parse(JSON.stringify(JSON.stringify(result)))),result);
 assert.equal(parse(JSON.stringify('First\nSecond')),'First\nSecond');
 assert.equal(parse('C:\\new\\test'),'C:\\new\\test');
});

test('SAP tool headings show operation, object, part and SQL source tables',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const context={};vm.createContext(context);
 vm.runInContext(page.slice(page.indexOf('  function fileName('),page.indexOf('  function line(')),context);
 const title=(name,input)=>context.stepTitle({name,text:name+'\n'+JSON.stringify(input)});
 assert.equal(title('SAPRead',{type:'VERSIONS',name:'ZCL_TR_TRANSLATE'}),'SAPRead: VERSIONS ZCL_TR_TRANSLATE');
 assert.equal(title('SAPRead',{object_type:'CLAS',object_name:'ZCL_TEST',include:'testclasses'}),'SAPRead: CLAS ZCL_TEST testclasses');
 assert.equal(title('SAPQuery',{action:'sql',sql:"SELECT 'FROM fake' AS label FROM e070 AS a INNER JOIN e071 AS b ON a~trkorr = b~trkorr"}),'SAPQuery: SELECT FROM e070 JOIN e071');
 assert.equal(title('SAPQuery',{action:'sql',sql:'SELECT * FROM /vertex/table'}),'SAPQuery: SELECT FROM /vertex/table');
});

test('tabular tool results render ordered text-only cells and retain metadata',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const el=(tag,cls='',text='')=>({tag,cls,text,children:[],appendChild(child){this.children.push(child);return child;}});
 const context={el,document:{getElementById:()=>({value:'',textContent:''}),createTextNode:text=>({text})}};vm.createContext(context);
 vm.runInContext(page.slice(page.indexOf('  function line('),page.indexOf('  function drawStep(')),context);
 const target=el('div');
 assert.equal(context.fields(target,JSON.stringify({totalRows:1502,rowsReturned:2,columns:JSON.stringify(['NAME','VALUE']),rows:[{VALUE:42,NAME:'<script>bad()</script>'},{NAME:'Second\nline',VALUE:null}]})),true);
 const nodes=[];const walk=n=>{nodes.push(n);n.children?.forEach(walk);};walk(target);
 assert.deepEqual(nodes.filter(n=>n.tag==='th').map(n=>n.text),['NAME','VALUE']);
 assert.deepEqual(nodes.filter(n=>n.tag==='td').map(n=>n.text),['<script>bad()</script>','42','Second\nline','—']);
 assert.ok(nodes.some(n=>n.text==='1502'));assert.ok(nodes.some(n=>n.cls==='table-scroll'));
 const empty=el('div');context.fields(empty,{columns:['NAME'],rows:[]});assert.equal(empty.children[1].children[0].children[1].children.length,0);
});

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

test("one dollar title action opens the unified theme-aware report from the configured log folder", async () => {
  const commands = new Map(), posted = [], executed = [], created = [], revealed = [];
  let receive;
  const panel = { webview: { postMessage: message => posted.push(message), onDidReceiveMessage: callback => { receive = callback; }, html: "" },
    onDidDispose() {}, reveal: (...args) => revealed.push(args) };
  const vscode = { ViewColumn: { Active: 1, Beside: 2 }, workspace: { getConfiguration: () => ({ get: () => "" }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; },
      executeCommand: async (...args) => { if (commands.has(args[0])) return commands.get(args[0])(); executed.push(args); } },
    window: { createWebviewPanel: (...args) => { created.push(args); return panel; } } };
  report.register(vscode, { subscriptions: [] });
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.ok(manifest.contributes.menus["view/title"].some(item => item.command === "vertex.showUsage" && item.when === "view == vertex.launcher"));
  assert.match(JSON.stringify(manifest.contributes.commands.find(c => c.command === "vertex.showUsage").icon), /dollar-light\.svg/);
  assert.ok(!manifest.contributes.menus["view/title"].some(item => item.command === "vertex.showLogs"));
  require("../usage-report").register(vscode, { subscriptions: [] });
  await commands.get("vertex.showUsage")();
  assert.equal(created[0][2], vscode.ViewColumn.Beside);
  commands.get("vertex.showLogs")();
  assert.deepEqual(revealed[0], [vscode.ViewColumn.Beside, false]);
  await receive({ action: "ready" });
  await receive({ action: "settings" });
  assert.equal(posted[0].report.configured, false);
  assert.deepEqual(posted[0].usageRows, []);
  assert.equal(created.length, 1);
  assert.match(panel.webview.html, /vertex-segment-toggle/);
  assert.match(panel.webview.html, /window.vertexUsage=/);
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
  assert.doesNotMatch(page, /\.entry[^{}]*\{[^}]*border-left/, "no side bars on log entries");
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
  const content=node('main');let rendered=0,opened=0;
  const context={content,status:{},selected:new Set(),selectionChanged(){},closeConversation(){},openConversation(){opened++;},window:{},el:node,listState:{query:'',hiddenKinds:{}},
    document:{getElementById:()=>({value:'',textContent:''}),createTextNode:text=>({text})},time:String,span:()=>'',n:String,newInput:u=>Number(u.input||0)+Number(u.cacheWrite||0),costText:()=>'',promptTime:String,
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
  assert.equal(opened,1,'clicking a conversation opens the full-window screen');
  assert.equal(body.children.length,0,'the list does not build an inline body');
  assert.equal(rendered,0,'prompt details remain lazy');
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

test('session model list shows the model name without the provider route a proxy glues on',()=>{
 const rows=[{type:'user',message:{content:'Fix'}},{type:'vertex_provider_response',scope:'model_response',response:{id:'a',model:'codemie-gpt-6-luna-2026-09-22'}},{type:'assistant',message:{id:'b',model:'gpt-6-luna'}},{type:'vertex_provider_response',scope:'model_response',response:{id:'c',model:'openai.gpt-5.6-sol'}},{type:'assistant',message:{id:'d',model:'us.anthropic.claude-haiku-5-5'}}].map(r=>({timestamp:'2026-11-17T12:00:00Z',...r}));
 const parsed=report.parseSession(rows.map(JSON.stringify).join('\n'),'codemie_20261117_120000.jsonl');
 assert.deepEqual(parsed.models,['gpt-6-luna-2026-09-22','gpt-6-luna','gpt-5.6-sol','claude-haiku-5-5']);
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

test('task verification reuses the Jev decision table with probabilities and legacy missing-confidence support',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const node=(tag,cls='',text='')=>({tag,cls,text,children:[],appendChild(child){this.children.push(child);return child;}});
 const table=new Function('el',page.slice(page.indexOf('  function routingTable('),page.indexOf('  var waitingDetail'))+';return verificationTable;')(node);
 const data={checks:[{check:'Requested edit applied',status:'failed',confidence:0.64,probabilities:{passed:0.03,failed:0.76,unverified:0.21}}]};
 const rows=table(data).children;assert.deepEqual(rows[1].children.slice(0,4).map(x=>x.text),['1','Requested edit applied','failed','0.64']);assert.equal(rows[1].children[4].children.find(x=>x.cls==='chosen').text,'failed: 0.76');
 assert.equal(table({checks:[{check:'Old record',status:'failed'}]}).children[1].children[3].text,'—');
});

test("the list sent to the page leaves each prompt's details, steps and Jev input on the host", () => {
  const { listReport } = require("../log-report.js");
  const report = { configured: true, folder: "logs", sessions: [{ id: "s", prompts: [{ key: "s:0", text: "Q", usage: {}, details: [{ type: "answer", text: "A".repeat(1000) }], timeline: [{ kind: "model" }], decision: { questions: {} } }] }] };
  const prompt = listReport(report).sessions[0].prompts[0];
  assert.equal(prompt.lazy, true);
  assert.equal(prompt.text, "Q");
  assert.equal("details" in prompt || "timeline" in prompt || "decision" in prompt, false);
  assert.equal(report.sessions[0].prompts[0].details.length, 1, "the host keeps the full record");
  assert.equal(prompt.toolCalls, 0);
  report.sessions[0].prompts[0].details.push({ type: "tool" }, { type: "tool result" }, { type: "tool" });
  assert.equal(listReport(report).sessions[0].prompts[0].toolCalls, 2, "Run counts calls without sending their bodies or counting results");
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
  const context={content,status:{},selected:new Set(),selectionChanged(){},closeConversation(){},window:{},el:node,listState:{query:'',hiddenKinds:{},context:''},
    document:{getElementById:()=>({value:'',textContent:''}),createTextNode:text=>({text})},time:String,span:()=>'',n:String,newInput:u=>Number(u.input||0)+Number(u.cacheWrite||0),costText:()=>'',promptTime:String,
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

test('internal routing, tagging, recognition and orchestrator selection join their parent with totals, files and lazy details intact',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/log-report.html'),'utf8');
 const node=(tag,cls='',text='')=>({tag,cls,text,value:'',children:[],events:{},style:{},classList:{toggle(){},add(){},remove(){}},appendChild(c){this.children.push(c);return c;},setAttribute(){},removeAttribute(){},addEventListener(n,f){this.events[n]=f;}});
 const content=node('main'),context={content,status:{},selected:new Set(),selectionChanged(){},closeConversation(){},openConversation(){},window:{},el:node,listState:{query:'',hiddenKinds:{}},document:{getElementById:()=>({value:'',textContent:''}),createTextNode:text=>({text})},time:String,span:()=>'',n:String,newInput:u=>Number(u.input||0)+Number(u.cacheWrite||0),costText:()=>'',promptTime:String,usageText:()=>'',promptPreview:p=>p.find(x=>x.operation==='Chat')?.text||p[0]?.text||'',conversation:()=>node('div')};
 vm.createContext(context);vm.runInContext(page.slice(page.indexOf('  var waitingDetail'),page.indexOf('  function section('))+page.slice(page.indexOf('  function sortableHead('),page.indexOf('  var lastReport = null'))+page.slice(page.indexOf('  function render(report)'),page.indexOf('  window.addEventListener("message"')),context);
 const session=(id,operation,related)=>({id,conversation:id,relatedConversation:related,provider:id,start:1,end:3,usage:{input:10,cost:0.01},prompts:[{key:id+':0',operation,text:id,time:1,usage:{input:10,cost:0.01}}]});
 const parent=session('parent','Chat');parent.context={mode:'folder',folder:'C:/project'};
 const routing=session('routing','Topic routing with Jev','parent'),tagging=session('tagging','Topic tagging with Jev','parent'),recognition=session('image','Screenshot recognition','parent');
 routing.usage.costEstimated=1;
 const review=session('review','AI Review','parent');
 const selection=session('selection','Orchestrator tool selection','parent');
 const verification=session('verification','Orchestrator stage verification with Jev','parent');
 const taskCheck=session('task-check','Task verification with Jev','parent');
 const orphan=session('orphan','Screenshot recognition','missing');
 const other=session('other','AI Review','parent');other.context={mode:'folder',folder:'C:/other'};
 const check=session('check','Model check');
 const evaluation=session('evaluation','Jev evaluation');
 const records=context.render({configured:true,folder:'logs',sessions:[routing,tagging,recognition,review,selection,verification,taskCheck,orphan,other,check,evaluation,parent]});
 assert.equal(records.length,5,'linked calls merge, orphan and differently placed review remain separate');
 assert.equal(records.find(r=>r.item.id==='orphan').rows[0].hidden,true);
 assert.equal(records.find(r=>r.item.id==='other').rows[0].hidden,true);
 assert.equal(records.find(r=>r.item.id==='check').rows[0].hidden,true);
 assert.equal(records.find(r=>r.item.id==='evaluation').rows[0].hidden,false);
 const group=records.find(r=>r.item.id==='parent').item;
 assert.equal(group.context.folder,'C:/project');assert.equal(group.prompts.length,8);assert.equal(group.usage.input,80);assert.ok(Math.abs(group.usage.cost-0.08)<1e-12);assert.equal(group.usage.costEstimated,1);
 assert.deepEqual(Array.from(group.fileIds).sort(),['image','parent','review','routing','selection','tagging','task-check','verification']);assert.equal(group.prompts.find(p=>p.provider==='image').key,'image:0');
 const tools=content.children.find(c=>c.cls==='list-tools');assert.equal(tools.children.filter(c=>c.cls==='kind-filter').length,2,'only standalone evaluation and model-check filters remain');
 const row=records.find(r=>r.item.id==='parent');row.toggle();assert.equal(row.rows[1].hidden,true);
});

test('Jev estimates enter report usage once and are marked estimated',()=>{
 const records=[{type:'user',message:{content:'Routing'}},{type:'assistant',message:{id:'a',usage:{input_tokens:100,output_tokens:2,estimated_cost_usd:0.0000042},content:[]}}];
 const s=report.parseSession(records.map(r=>JSON.stringify({timestamp:'2026-11-13T14:00:00Z',...r})).join('\n'),'typesafe-api_20261113_160000.jsonl');
 assert.equal(s.usage.cost,0.0000042);assert.equal(s.usage.costEstimated,1);assert.equal(s.prompts[0].usage.cost,0.0000042);
});

test('Orchestrator selection log retains the task, decisions, probabilities and selected set without doubling usage',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-orchestrator-log-'));
 try {
  const logs=require('../session-log'),router=require('../orchestrator-plan'),jev=require('../jev');
  const log=logs.create(root,'typesafe-api','fixture',{questions:true,answers:true},router.OPERATION,logs.independentScope());
  const request=router.input('Read the source',{},[{name:'read_sap_method',description:'Read source',inputSchema:{type:'object'}}]);
  const answers={tool_0:{type:'choice',choice:'include',confidence:0.9,probabilities:{include:0.95,exclude:0.05}}};
  log.user('Read the source');log.decision(request);
  log.assistant({model:'jev-latest',usage:{input_tokens:20},text:jev.formatAnswers(request.questions,answers)});
  log.toolSelection({selected:['read_sap_method'],elapsedMs:12,answers});
  const parsed=report.readSessions(root).sessions[0],prompt=parsed.prompts[0];
  assert.equal(prompt.operation,router.OPERATION);assert.equal(prompt.text,'Read the source');assert.equal(prompt.decision.questions.tool_0.type,'choice');
  assert.ok(prompt.details.some(d=>d.type===router.OPERATION && /read_sap_method/.test(d.text) && /0.95/.test(d.text)));
  assert.equal(parsed.usage.input,20);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('Structured orchestrator plan and stage results appear as log details and respect answer logging',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-json-plan-log-'));
 try {
  const logs=require('../session-log');
  const log=logs.create(root,'test','planned',{questions:true,answers:false});
  log.user('Investigate changes');log.orchestration({kind:'plan',plan:{goal:'Investigate',stages:[{id:1,task:'Find transports',depends_on:[]}]}});
  log.orchestration({kind:'stage_result',stage:1,report:{stage_status:'complete',answer:'SECRET_MODEL_BODY',evidence:['SECRET_EVIDENCE']}});
  const text=fs.readFileSync(log.file,'utf8');assert.doesNotMatch(text,/SECRET_MODEL_BODY|SECRET_EVIDENCE/);
  const parsed=report.readSessions(root).sessions[0].prompts[0];assert.ok(parsed.details.some(d=>d.type==='Orchestrator JSON plan' && /Find transports/.test(d.text)));assert.ok(parsed.details.some(d=>d.type==='Orchestrator stage' && /complete/.test(d.text)));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});


test("New in includes historical Claude cache creation and preserves Codex counts", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  const source = page.match(/function newInput\(u\) \{[\s\S]*?\n  \}/)[0];
  const newInput = vm.runInNewContext("(" + source + ")");
  const claude = report.parseSession(JSON.stringify({ timestamp: "2026-11-14T00:55:19Z", type: "user", message: {content: "Historical question"} }) + "\n" + JSON.stringify({ timestamp: "2026-11-14T00:56:31Z", type: "assistant", message: { id: "old", usage: { input_tokens: 76, cache_creation_input_tokens: 54339, cache_read_input_tokens: 331350 }, content: [] } }), "claude_20261114_005519.jsonl");
  assert.equal(newInput(claude.usage), 54415);
  assert.equal(claude.usage.input, 76);
  assert.equal(claude.usage.cacheRead, 331350);
  assert.equal(newInput({ input: 76054, cacheWrite: 0 }), 76054);
  assert.equal(newInput({}), 0);
  assert.match(page, /return newInput\(s.usage\)/);
  assert.match(page, /return newInput\(p.usage\)/);
  assert.match(page, /n\(newInput\(s.usage\)\)/);
  assert.match(page, /n\(newInput\(p.usage\)\)/);
});
