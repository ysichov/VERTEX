"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../assistant");
const chat = require("../chat");
const copilot = require("../copilot");
const compatible = require("../openai-compatible");
const rawCompatibleAsk = compatible.ask;
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

test.beforeEach(t => { t.mock.method(assistant, "resolveAssistant", async (vscode, id) => "/ext/" + id); });

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
  assert.deepEqual(lines.map(line => line.type), ["user", "assistant", "assistant"]);
  assert.deepEqual(lines.slice(1).map(line => line.message.usage.output_tokens), [2, 3]);
  assert.equal(lines[2].message.content[0].text, "Done");
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


const executionPlan={goal:'Answer the actual task',context:['Assumption: verify identifiers'],steps:[{id:1,action:'Discover schemas, then query evidence',tools:['read_evidence'],depends_on:[],success_criteria:['Evidence belongs to the requested entity'],on_failure:'Read the actual schema'}],recovery:['Inspect the error and change the request'],completion_checks:['Prove the result belongs to the requested entity']};
function plannerTools(orchestrator=true){return {orchestrator:()=>orchestrator,schemas:[{name:'read_evidence',description:'Read evidence',inputSchema:{type:'object',properties:{id:{type:'string'}}}}],instructions:'Available tool constraints',editorContext:()=>null};}
test('Orchestrator plans with ChatGPT Sol medium before a separate executor without changing its model',async t=>{
 const events=[],prompts=[];
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(assistant,'ask',async options=>{
  events.push('planner');assert.equal(options.assistant,'codex');assert.equal(options.model,'gpt-5.6-sol');assert.equal(options.effort,'medium');assert.deepEqual(options.tools,[]);
  assert.equal(options.workDir,undefined);assert.equal(options.url,undefined);assert.equal(options.callTool,undefined);
  assert.match(options.prompt,/read_evidence/);assert.match(options.prompt,/user question/);
  return {plan:executionPlan,model:'gpt-5.6-sol',usage:{input_tokens:10,output_tokens:20}};
 });
 t.mock.method(compatible,'ask',async options=>{
  events.push('executor');prompts.push(options.prompt);assert.equal(options.assistant,'openrouter-api');assert.equal(options.model,'weak');assert.match(options.prompt,/Orchestrator execution plan/);assert.match(options.prompt,/Prove the result belongs/);
  return {plan:{answer:'verified answer'},model:'weak',usage:null};
 });
 const settings={provider:'openrouter-api',model:'weak'},ask=chat.create(fakeVscode(settings),plannerTools(),null,{});
 const result=await ask('user question');assert.deepEqual(events,['planner','executor']);assert.equal(result.answer,'verified answer');assert.equal(result.planner.model,'gpt-5.6-sol');assert.equal(settings.model,'weak');ask.dispose();
});
test('Orchestrator settings are independent, planning stays off in other modes and when disabled',async t=>{
 let planners=0,executors=0;
 t.mock.method(assistant,'ask',async()=>{planners++;throw new Error('unexpected planner');});
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(compatible,'ask',async()=>{executors++;return {plan:{answer:'done'},model:'weak',usage:null};});
 for(const [mode,disabled] of [[false,false],[true,true]]){
  const settings={provider:'openrouter-api',model:'weak',...(disabled?{orchestratorProvider:''}:{})};
  const ask=chat.create(fakeVscode(settings),plannerTools(mode),null,{});await ask('user question');ask.dispose();
 }
 assert.equal(planners,0);assert.equal(executors,2);
});
test('Invalid planner output or planner failure never silently runs the weak executor',async t=>{
 let executions=0;
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(compatible,'ask',async()=>{executions++;return {plan:{answer:'unexpected'}};});
 for(const invalid of ['not JSON','{"goal":"Guess","context":[],"steps":[],"recovery":[],"completion_checks":[]}']){
  t.mock.method(assistant,'ask',async()=>({plan:{answer:invalid},model:'gpt-5.6-sol',usage:null}));
  const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'weak'}),plannerTools(),null,{});
  await assert.rejects(ask('user question'),/Orchestrator planning failed/);ask.dispose();
 }
 assert.equal(executions,0);
});
test('Stop during orchestration cancels the planner and never starts the executor',async t=>{
 let ready,executions=0;const started=new Promise(resolve=>ready=resolve);
 t.mock.method(assistant,'ask',async options=>{ready();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));});
 t.mock.method(compatible,'ask',async()=>{executions++;return {plan:{answer:'unexpected'}};});
 const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'weak'}),plannerTools(),null,{});
 const pending=ask('user question');await started;ask.stop();assert.equal((await pending).stopped,true);assert.equal(executions,0);ask.dispose();
});


test('Planner pickers save provider, exact model and effort without altering executor settings',async t=>{
 const modelConfig=require('../model-config'),ai={provider:'openrouter-api',model:'weak',effort:'low'},planning={},titles=[];
 t.mock.method(modelConfig,'offered',()=>[{id:'codex',setting:'codex-subscription',label:'ChatGPT subscription'}]);
 t.mock.method(modelConfig,'adopt',async()=>{});t.mock.method(modelConfig,'apply',(_v,_id,list)=>list);
 t.mock.method(assistant,'models',async()=>[{id:'gpt-5.6-sol',label:'GPT-5.6-Sol'},{id:'',label:'Codex default'}]);
 const vscode=fakeVscode(ai),picks=[{id:'codex-subscription'},{id:'gpt-5.6-sol'},{id:'medium'}];
 vscode.workspace.getConfiguration=section=>({get:(key,fallback)=>(section==='vertex.chat'?planning:ai)[key]??fallback,update:async(key,value)=>{(section==='vertex.chat'?planning:ai)[key]=value;}});
 vscode.window.showQuickPick=async(items,options)=>{titles.push(options.title);assert.ok(items.every(item=>item.id!==undefined));if(options.title.endsWith('model'))assert.ok(items.every(item=>item.id));return picks.shift();};
 const ask=chat.create(vscode,plannerTools(),null,{});await ask.configOrchestrator();
 assert.deepEqual(planning,{orchestratorModel:'gpt-5.6-sol',orchestratorEffort:'medium',orchestratorProvider:'codex-subscription'});
 assert.equal(ai.provider,'openrouter-api');assert.equal(ai.model,'weak');assert.equal(ai.effort,'low');assert.equal(titles.length,3);ask.dispose();
});
test('Planner can use a configured API provider and effort independently',async t=>{
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(require('../anthropic'),'ask',async options=>{
  assert.equal(options.model,'strong-planner');assert.equal(options.effort,'high');assert.equal(options.apiKey,'test');assert.deepEqual(options.tools,[]);
  return {plan:executionPlan,model:'strong-planner',usage:null};
 });
 t.mock.method(compatible,'ask',async options=>{assert.equal(options.model,'weak');return {plan:{answer:'done'},model:'weak',usage:null};});
 const ask=chat.create(fakeVscode({provider:'openrouter-api',model:'weak',orchestratorProvider:'anthropic-api',orchestratorModel:'strong-planner',orchestratorEffort:'high'}),plannerTools(),null,{});
 const result=await ask('user question');assert.equal(result.planner.provider,'anthropic-api');assert.equal(result.model,'weak');ask.dispose();
});


test('Orchestrator recovers from a failed duplicate, preserves evidence and rejects an unfinished API answer',async t=>{
 const apiAsk=rawCompatibleAsk;let plannerCalls=0,actions=0,requests=0;const bodies=[],stream=[];
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(assistant,'ask',async options=>{
  plannerCalls++;assert.match(options.prompt,/next model step in this same request/);
  if(plannerCalls===1)return {plan:executionPlan,model:'gpt-5.6-sol',usage:{input_tokens:1}};
  if(plannerCalls===2){assert.match(options.prompt,/Repeated failed call blocked/);return {plan:{...executionPlan,steps:[{...executionPlan.steps[0],action:'Use read_evidence with id good'}]},model:'gpt-5.6-sol',usage:{input_tokens:2}};}
  assert.match(options.prompt,/verified result/);return {plan:plannerCalls===3?{accept:false,feedback:'You have evidence; finish the answer yourself'}:{accept:true,feedback:''},model:'gpt-5.6-sol',usage:{input_tokens:3}};
 });
 const replies=[{tool_calls:[{id:'1',type:'function',function:{name:'read_evidence',arguments:'{"id":"bad"}'}}]},
 {tool_calls:[{id:'2',type:'function',function:{name:'read_evidence',arguments:'{"id":"bad"}'}}]},
 {tool_calls:[{id:'3',type:'function',function:{name:'read_evidence',arguments:'{"id":"good"}'}}]},
 {content:'Please run the read tool yourself'},{content:'The verified result is 42'}];
 t.mock.method(compatible,'ask',options=>apiAsk({...options,request:async(_id,_key,_route,body)=>{requests++;bodies.push(JSON.parse(JSON.stringify(body)));return {choices:[{message:replies.shift()}],usage:{prompt_tokens:10,completion_tokens:2}};}}));
 const tools=plannerTools();tools.execute=async(_name,args)=>{actions++;if(args.id==='bad')throw new Error('invalid field');return {value:42,evidence:'verified result'};};
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'weak'}),tools,null,{});
 const result=await ask('user question',{onProgress:update=>{if(update.answer)stream.push(update.answer);}});
 assert.equal(result.answer,'The verified result is 42');assert.equal(plannerCalls,4);assert.equal(actions,2);assert.equal(requests,5);assert.equal(result.planner.usage.input_tokens,9);
 assert.match(JSON.stringify(bodies[2].messages),/Orchestrator recovery advice/);assert.match(JSON.stringify(bodies[4].messages),/finish the answer yourself/);
 assert.ok(!stream.includes('Please run the read tool yourself'));assert.ok(!stream.some(text=>text.includes('Draft withheld')));ask.dispose();
});


test('CLI orchestrator tool endpoint uses the same recovery guard without replaying the request',async t=>{
 let endpoint,actions=0,executions=0,disposed=0;
 t.mock.method(assistant,'ask',async options=>{
  if(options.instructions.startsWith('You are the planning model'))return {plan:executionPlan,model:'gpt-5.6-sol',usage:null};
  if(options.instructions.startsWith('Review the executor'))return {plan:{accept:true,feedback:''},model:'gpt-5.6-sol',usage:null};
  executions++;assert.match(options.url,/scoped/);
  await assert.rejects(endpoint.call(null,'read_evidence',{id:'bad'}),/bad field/);
  await assert.rejects(endpoint.call(null,'read_evidence',{id:'bad'}),/Orchestrator recovery advice/);
  await endpoint.call(null,'read_evidence',{id:'good'});
  return {plan:{answer:'supported result'},model:'executor',usage:null};
 });
 const tools=plannerTools();tools.execute=async(_name,args)=>{actions++;if(args.id==='bad')throw new Error('bad field');return {result:'supported result'};};
 const server={start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'test',registerTools:options=>{endpoint=options;return {route:'/scoped',dispose(){disposed++;}};}};
 const ask=chat.create(fakeVscode({provider:'codex-subscription',model:'executor'}),tools,server,{});
 const result=await ask('user question');assert.equal(result.answer,'supported result');assert.equal(actions,2);assert.equal(executions,1);assert.equal(disposed,1);ask.dispose();
});


test('Planner output is schema-bound and one malformed response gets exactly one format retry',async t=>{
 let calls=0,executions=0;
 t.mock.method(assistant,'ask',async options=>{
  calls++;assert.equal(options.structuredResult,true);assert.equal(options.schema.additionalProperties,false);assert.equal(options.schema.properties.answer,undefined);assert.ok(options.schema.properties.goal);assert.deepEqual(options.tools,[]);
  return {plan:calls===1?{answer:'nested malformed JSON'}:executionPlan,model:'gpt-5.6-sol',usage:{input_tokens:7}};
 });
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));
 t.mock.method(compatible,'ask',async()=>{executions++;return {plan:{answer:'done'},model:'weak'};});
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'weak'}),plannerTools(),null,{});const result=await ask('user question');assert.equal(calls,2);assert.equal(executions,1);assert.equal(result.planner.usage.input_tokens,14);ask.dispose();
});
test('Planner retries are limited to format failures, never transport failures',async t=>{
 let calls=0;t.mock.method(assistant,'ask',async()=>{calls++;throw Object.assign(new Error('connection reset'),{code:'ECONNRESET'});});
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'weak'}),plannerTools(),null,{});await assert.rejects(ask('user question'),/connection reset/);assert.equal(calls,1);ask.dispose();
});


test('Malformed native output still accounts reported usage before the bounded retry',async t=>{
 let calls=0;t.mock.method(assistant,'ask',async options=>{
  if(++calls===1){options.onProviderResponse({scope:'model_response',response:{model:'gpt-5.6-sol',usage:{input_tokens:10,cached_input_tokens:3,output_tokens:2}}});throw Object.assign(new Error('invalid native JSON'),{code:'STRUCTURED_FORMAT'});}
  return {plan:executionPlan,model:'gpt-5.6-sol',usage:{input_tokens:4,output_tokens:1}};
 });
 t.mock.method(require('../key-profiles'),'getActiveKey',async()=>({key:'test'}));t.mock.method(compatible,'ask',async()=>({plan:{answer:'done'},model:'weak'}));
 const ask=chat.create(fakeVscode({provider:'openai-api',model:'weak'}),plannerTools(),null,{});const result=await ask('user question');assert.equal(calls,2);assert.equal(result.planner.usage.input_tokens,11);assert.equal(result.planner.usage.cache_read_input_tokens,3);assert.equal(result.planner.usage.output_tokens,3);ask.dispose();
});

test('saved historical screenshots keep file references without attaching their bytes',async t=>{
 let received;t.mock.method(assistant,'ask',async options=>{received=options;return{plan:{answer:'Reference only'},model:'test'};});
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test'}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 ask.restoreConversation([{question:'Saved image',answer:'Earlier description',images:[{media_type:'image/png',data:'PRIVATE_IMAGE_BYTES',file:'C:/logs/session/screenshot-1.png'}]}]);
 await ask('Continue our discussion');
 assert.equal(received.images,undefined);assert.match(received.prompt,/C:\/logs\/session\/screenshot-1.png/);assert.doesNotMatch(received.prompt,/PRIVATE_IMAGE_BYTES/);
 assert.match(received.prompt,/Do not claim to see image pixels/);
});
test('Main chat uses the selected history without changing its stored conversation, and logs the selection',async t=>{
 const optimizer=require('../context-optimizer'),logs=require('../session-log'),report=require('../log-report');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vx-context-selection-'));logs.reset();
 let received,calls=0;const original=[];
 for(let i=0;i<6;i++)original.push({question:'User constraint '+i,answer:'Earlier answer '+i});
 t.mock.method(optimizer,'optimize',async(_v,question,history)=>{calls++;assert.equal(question,'Explain current behavior');return{history:history.map((m,i)=>i===1?{role:'assistant',content:'[selected history marker]'}:m),report:{status:'optimized',beforeCharacters:1000,afterCharacters:700,savedCharacters:300,savedPercent:30,decisions:[{index:1,action:'omit'}]}};});
 t.mock.method(assistant,'ask',async options=>{received=options;return{plan:{answer:'Done'},model:'test'};});
 const ask=chat.create(fakeVscode({provider:'claude-subscription',model:'test','logPath':root,'log.questions':true,'log.answers':true}),{schemas:[],instructions:'',editorContext:()=>null},{start:async()=>({url:'http://127.0.0.1:1/mcp'}),token:'t'});
 try{ask.restoreConversation(original);await ask('Explain current behavior',{optimizeContext:true});assert.equal(calls,1);assert.match(received.prompt,/selected history marker/);assert.doesNotMatch(received.prompt,/Earlier answer 0/);assert.match(received.prompt,/User constraint 0/);
 const parsed=report.readSessions(root);assert.ok(parsed.sessions[0].prompts[0].details.some(d=>d.type==='Context optimization (Jev)'&&d.text.includes('300')));
 await ask('Show the earlier reasoning',{optimizeContext:false});assert.equal(calls,1);assert.match(received.prompt,/Earlier answer 0/);
 }finally{await ask.dispose();logs.reset();fs.rmSync(root,{recursive:true,force:true});}
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
