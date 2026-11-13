"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../openai-compatible");
const modelConfig = require("../model-config");
const assistant = require("../assistant");

test("API provider catalog matches the ABAP-AI-Code key providers", () => {
  assert.deepEqual(Object.keys(api.PROVIDERS), ["openai-api", "mistral-api", "gemini-api", "groq-api",
    "cerebras-api", "openrouter-api", "nvidia-api", "vercel-api", "opencode-api", "typesafe-api", "lmstudio-local", "ollama-local"]);
  for (const id of Object.keys(api.PROVIDERS)) {
    assert.ok(modelConfig.PROVIDERS.some(provider => provider.id === id && provider.setting === id));
    assert.match(api.PROVIDERS[id].base, api.PROVIDERS[id].local ? /^http:\/\/localhost:\d+\/v1$/ : /^https:\/\//);
  }
});

test("local LM Studio and Ollama servers are reached over HTTP without a key", async () => {
  const http = require("http");
  const keyProfiles = require("../key-profiles");
  assert.deepEqual(await keyProfiles.getActiveKey({ get: async () => "" }, "ollama-local"), { name: "LOCAL", key: "local" });
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.headers.authorization); res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "qwen2.5-coder:7b" }, { id: "text-embedding-nomic-embed-text-v1.5" }, { id: "nomic-embed-text:latest" }] })); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  api.setLocalBase("ollama-local", "http://127.0.0.1:" + server.address().port + "/v1");
  try {
    assert.deepEqual(await api.models("ollama-local", "local"), [{ id: "qwen2.5-coder:7b", label: "qwen2.5-coder:7b" }]);
    assert.deepEqual(seen, [undefined, undefined]);
    await new Promise(resolve => server.close(resolve));
    await assert.rejects(api.requestJson("ollama-local", "local", "/models"), /Ollama is (?:installed, but its server does not answer|not installed on this computer)/);
  } finally { api.setLocalBase("ollama-local", ""); }
  assert.equal(api.baseUrl("ollama-local"), "http://localhost:11434/v1");
});

test("LLM Providers offers an independent fold control for each model list", () => {
  const panel = { onDidDispose() {}, webview: { onDidReceiveMessage: () => {} } };
  const vscode = { ViewColumn: { Active: 1 }, window: { createWebviewPanel: () => panel },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => key === "provider" ? "copilot" : fallback }) } };
  modelConfig.open(vscode, async () => [], () => "", () => {}, null);
  assert.match(panel.webview.html, /Collapse models/);
  assert.match(panel.webview.html, /s\.expanded = !s\.expanded/);
  assert.match(panel.webview.html, /body\.hidden = !s\.expanded/);
  assert.match(panel.webview.html, /if \(!s\.rows\.length\)/);
  assert.match(panel.webview.html, /no models were returned/);
  assert.match(panel.webview.html, /this is not an account sign-in check/);
  assert.match(panel.webview.html, /select-key/);
  assert.match(panel.webview.html, /all \? "Clear all" : "Select all"/);
  assert.match(panel.webview.html, /targets\.forEach\(r => \{ r\.on = next && r\.available !== false; \}\)/);
  assert.match(panel.webview.html, /Open logging settings/);
});

test("LLM Providers gear opens the logging settings", async () => {
  let receive, command;
  const panel = { onDidDispose() {}, webview: { onDidReceiveMessage: callback => { receive = callback; } } };
  const vscode = { ViewColumn: { Active: 1 }, commands: { executeCommand: async (...args) => { command = args; } },
    window: { createWebviewPanel: () => panel },
    workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback }) } };
  modelConfig.open(vscode, async () => [], () => "", () => {}, null);
  await receive({ action: "log-settings" });
  assert.deepEqual(command, ["workbench.action.openSettings", "vertex.ai.log"]);
});

test("LLM Providers selects the Codex installation before loading its models", async t => {
  t.mock.method(assistant, "sources", id => id === "codex"
    ? { extension: "/extension/codex", cli: "/app/codex" } : { extension: "", cli: "" });
  let receive, calls = 0, forgotten = "";
  const posted = [], values = { codexSource: "ask", provider: "codex-subscription", model: "gpt-5.2" };
  const panel = { onDidDispose() {}, webview: { onDidReceiveMessage: callback => { receive = callback; },
    postMessage: message => posted.push(message) } };
  const vscode = { ViewColumn: { Active: 1 }, ConfigurationTarget: { Global: 1 },
    window: { createWebviewPanel: () => panel },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => key in values ? values[key] : fallback,
      update: async (key, value) => { values[key] = value; } }) } };
  modelConfig.open(vscode, async () => { calls++; return [{ id: "codex-model", label: "Codex" }]; },
    () => "/extension", id => { forgotten = id; }, null);
  assert.match(panel.webview.html, /Run via/);
  assert.match(panel.webview.html, /Choose installation/);
  await receive({ action: "load", provider: "codex" });
  assert.equal(calls, 0);
  assert.equal(posted.at(-1).source.selected, "ask");
  await receive({ action: "source", provider: "codex", source: "cli" });
  assert.equal(values.codexSource, "cli");
  assert.equal(forgotten, "codex");
  assert.equal(calls, 1);
  assert.equal(posted.at(-1).source.selected, "cli");
  values.model = "gpt-5.2";
  await receive({ action: "load", provider: "codex" });
  assert.equal(forgotten, "codex");
  assert.equal(calls, 2);
  assert.equal(values.model, "gpt-5.2", "a model the catalog dropped stays chosen; the VERTEX panel reports it");
  assert.doesNotMatch(panel.webview.html, /Refresh models/);
});

test("log folder button picks a directory and saves its path", async () => {
  let receive, saved;
  const folder = { scheme: "file", fsPath: "C:\\logs" };
  const panel = { onDidDispose() {}, webview: { onDidReceiveMessage: callback => { receive = callback; }, postMessage: () => {} } };
  const vscode = { ViewColumn: { Active: 1 }, ConfigurationTarget: { Global: 1 }, Uri: { file: fsPath => ({ fsPath }) },
    window: { createWebviewPanel: () => panel, showOpenDialog: async options => {
      assert.equal(options.canSelectFolders, true); assert.equal(options.canSelectFiles, false); return [folder]; } },
    workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback,
      update: async (key, value) => { saved = [key, value]; } }) } };
  modelConfig.open(vscode, async () => [], () => "", () => {}, null);
  await receive({ action: "choose-log-folder" });
  assert.deepEqual(saved, ["logPath", "C:\\logs"]);
});

test("API model list uses the selected provider and labels", async () => {
  const calls = [];
  const list = await api.models("gemini-api", "secret", async (...args) => {
    calls.push(args); return { data: [{ id: "gemini-z", name: "Z" }, { id: "gemini-a", name: "A" }] };
  });
  assert.deepEqual(calls, [["gemini-api", "secret", "/models"]]);
  assert.deepEqual(list.filter(m=>m.modelKind!=="decision"), [{ id: "gemini-a", label: "A" }, { id: "gemini-z", label: "Z" }]);
  assert.equal(list.find(m=>m.id==="gemini-decision-1").modelKind,"decision");
});

test("OpenAI-compatible provider executes SAP tools and accepts a final plan", async () => {
  const requests = [], toolCalls = [], modelCalls = [];
  const answers = [{ usage: { prompt_tokens: 120, completion_tokens: 15, prompt_tokens_details: { cached_tokens: 20 } }, choices: [{ message: { role: "assistant", content: null, tool_calls: [{
    id: "call-1", type: "function", function: { name: "read_sap_object", arguments: '{"object_name":"ZCL_A"}' }
  }] } }] }, { usage: { prompt_tokens: 160, completion_tokens: 25, prompt_tokens_details: { cached_tokens: 30 } }, choices: [{ message: { role: "assistant", content: null, tool_calls: [{
    id: "call-2", type: "function", function: { name: "submit_vertex_answer",
      arguments: '{"answer":"Класс прочитан","navigation":null}' }
  }] } }] }];
  const result = await api.ask({ assistant: "mistral-api", apiKey: "secret", model: "mistral-test",
    instructions: "Use SAP tools", prompt: "Read class", schema: { type: "object" },
    onModelCall: call => modelCalls.push(call),
    tools: [{ name: "read_sap_object", description: "Read", inputSchema: { type: "object" } }],
    request: async (id, key, route, body) => { requests.push({ id, key, route, body }); return answers.shift(); },
    callTool: async (name, args) => { toolCalls.push([name, args]); return { source: "CLASS zcl_a." }; } });
  assert.deepEqual(result.plan, { answer: "Класс прочитан", navigation: null });
  assert.deepEqual(result.usage, { input_tokens: 230, output_tokens: 40,
    cache_read_input_tokens: 50, cache_creation_input_tokens: 0 });
  assert.equal(modelCalls.length, 2);
  assert.deepEqual(modelCalls.map(call => call.usage.input_tokens), [100, 130]);
  assert.equal(modelCalls[1].text, "Класс прочитан");
  assert.deepEqual(toolCalls, [["read_sap_object", { object_name: "ZCL_A" }]]);
  assert.equal(requests[0].route, "/chat/completions");
  assert.equal(requests[0].body.tools[0].function.name, "read_sap_object");
  assert.deepEqual(requests[1].body.messages.at(-1), {
    role: "tool", tool_call_id: "call-1", content: '{"source":"CLASS zcl_a."}'
  });
});

test("Vercel AI Gateway lists only language models", async () => {
  const request = async () => ({ data: [{ id: "openai/gpt-x", name: "GPT X", type: "language" },
    { id: "openai/img", type: "image" }, { id: "openai/emb", type: "embedding" }] });
  assert.deepEqual((await api.models("vercel-api", "k", request)).map(({id,label})=>({id,label})), [{ id: "openai/gpt-x", label: "GPT X" }]);
});


test("chat catalogs exclude batch variants by model id and display name", async () => {
  const data = [
    { id: "anthropic/claude-fable-5", name: "Claude Fable 5", type: "language" },
    { id: "anthropic/claude-fable-5-batch", type: "language" },
    { id: "anthropic/claude-fable-5:batch", type: "language" },
    { id: "anthropic/claude-fable-5-batch-v2", type: "language" },
    { id: "anthropic/alias", name: "Claude Fable 5 (Batch)", type: "language" },
    { id: "anthropic/alias2", display_name: "Claude Fable 5 (BATCH)", type: "language" }
  ];
  const request = async () => ({ data });
  assert.deepEqual((await api.models("vercel-api", "k", request)).map(({id,label})=>({id,label})), [
    { id: "anthropic/claude-fable-5", label: "Claude Fable 5" }
  ]);
  for (const provider of ["openrouter-api", "openai-api", "mistral-api"]) assert.deepEqual((await api.models(provider, "k", request)).map(m=>m.id), ["anthropic/claude-fable-5"]);
});


test('availability probe makes one capped request without history or tools',async()=>{
 const calls=[];
 await api.probe('vercel-api','key','model',async(...args)=>{calls.push(args);return {choices:[{message:{content:'OK'}}]};});
 assert.equal(calls.length,1);assert.equal(calls[0][2],'/chat/completions');
 assert.deepEqual(calls[0][3],{model:'model',messages:[{role:'user',content:'Reply OK.'}],stream:false,max_tokens:16});
});


test('Vercel metadata distinguishes declared support, no image input and unknown fields',async()=>{
 const result=await api.models('vercel-api','k',async()=>({data:[{id:'test/text',type:'language',name:'Text',description:'Specialized extraction model',supported_parameters:['tools','response_format'],modalities:{input:['text']},tags:['reasoning'],context_window:1000000}]}));
 assert.deepEqual(result[0].capabilities,{tools:true,json:true,reasoning:true,vision:false,web:null});
 assert.equal(result[0].contextWindow,1000000);assert.equal(result[0].description,'Specialized extraction model');
 const unknown=require('../model-capabilities').metadata({});assert.equal(unknown.capabilities.vision,null);
 const vscode={ConfigurationTarget:{Global:1},workspace:{getConfiguration:(()=>{const v={};return()=>({get:(k,f)=>k in v?v[k]:f,update:async(k,x)=>{v[k]=x;}});})()}};
 await modelConfig.adopt(vscode,'vercel-api',result);
 assert.deepEqual(modelConfig.apply(vscode,'vercel-api',result)[0].capabilities,result[0].capabilities);
});

test('Vision images reach the API as image content; text-only models send no tools',async()=>{
 let body;
 await api.ask({assistant:'vercel-api',apiKey:'k',model:'vision',prompt:'See this',instructions:'Explain',images:[{media_type:'image/png',data:'abcd'}],capabilities:{vision:true,tools:false},tools:[{name:'read',inputSchema:{}}],schema:{},request:async(_,__,___,value)=>{body=value;return {choices:[{message:{content:'Screenshot answer'}}]};}});
 assert.equal(body.tools,undefined);
 assert.deepEqual(body.messages[1].content,[{type:'text',text:'See this'},{type:'image_url',image_url:{url:'data:image/png;base64,abcd'}}]);
 let calls=0;
 await assert.rejects(()=>api.ask({capabilities:{vision:false},images:[{}],request:async()=>{calls++;}}),/screenshots/);
 assert.equal(calls,0);
});


test('catalog pricing is preserved and displayed per million, with zero and tiered rates',async()=>{
 const model=(await api.models('vercel-api','k',async()=>({data:[{id:'price',type:'language',pricing:{input:'0.00000015',output:'0.0000006',input_cache_read:'0.000000015',varies_by_provider:true}}]})))[0];
 const {priceInfo}=require('../model-capabilities');
 assert.match(priceInfo(model).text,/In \$0.15 · Out \$0.6 \/1M \*/);
 assert.match(priceInfo(model).title,/provider/);assert.match(priceInfo(model).title,/\$0.015/);
 assert.equal(priceInfo({pricing:{input:'0',output:'0'}}).text,'In $0 · Out $0 /1M');
 assert.equal(priceInfo({}),null);
 assert.match(priceInfo({pricing:{input:'invalid'}}).text,/In —/);
});


test('model columns sort prices numerically, preserve zero and put unknown last in both directions',()=>{
 const {sortModels}=require('../model-capabilities');
 const models=[{id:'high',pricing:{input:'0.00001'},capabilities:{vision:true}},
 {id:'low',pricing:{input:'0.000002'},capabilities:{vision:false}},
 {id:'unknown'},{id:'free',pricing:{input:'0'}}];
 assert.deepEqual(sortModels(models,'inputPrice').map(m=>m.id),['free','low','high','unknown']);
 assert.deepEqual(sortModels(models,'inputPrice',true).map(m=>m.id),['high','low','free','unknown']);
 assert.deepEqual(sortModels(models,'cap.vision',true).map(m=>m.id),['high','low','unknown','free']);
 assert.equal(models[0].id,'high');
});


test('a 429 retries only the pending model request after Retry-After, without repeating tools',async()=>{
 let requests=0,tools=0;const delays=[],progress=[];
 const result=await api.ask({assistant:'vercel-api',apiKey:'k',model:'free',prompt:'Run once',instructions:'Use tools',schema:{},tools:[{name:'run_abap_transpiler',inputSchema:{}}],
 callTool:async()=>{tools++;return {run_id:'run1'};},sleep:async ms=>delays.push(ms),onProgress:update=>progress.push(update),
 request:async()=>{
  requests++;
  if(requests===1)return {choices:[{message:{tool_calls:[{id:'call1',function:{name:'run_abap_transpiler',arguments:'{}'}}]}}]};
  if(requests===2)throw Object.assign(new Error('API returned 429: Retry after 11s'),{status:429,retryAfter:'11'});
  return {choices:[{message:{content:'Done'}}]};
 }});
 assert.equal(result.plan.answer,'Done');assert.equal(tools,1);assert.equal(requests,3);
 assert.deepEqual(delays,[11250]);assert.ok(progress.some(update=>/Rate limit/.test(update.status)));
});

test('rate-limit retries are bounded and stop when the conversation is superseded',async()=>{
 let calls=0;
 await assert.rejects(()=>api.rateLimitedRequest(async()=>{calls++;throw Object.assign(new Error('429'),{status:429});},{sleep:async()=>{}}),/429/);
 assert.equal(calls,3);
 let active=true;calls=0;
 await assert.rejects(()=>api.rateLimitedRequest(async()=>{calls++;throw Object.assign(new Error('429'),{status:429});},{isActive:()=>active,sleep:async()=>{active=false;}}),/superseded/);
 assert.equal(calls,1);
});

test('Vercel costs survive logging and aggregate without double counting', async () => {
 const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-cost-'));
 try {
 const log=require('../session-log').create(root,'vercel-api','20261107_120000',{});log.user('Check cost');
 let lookups=0;let inference=0;
 const result=await api.ask({assistant:'vercel-api',apiKey:'test',model:'x',prompt:'x',instructions:'x',capabilities:{tools:false},sleep:async()=>{},
 onProviderResponse:event=>log.providerResponse(event),onModelCall:event=>log.assistant(event),request:async(id,key,route)=>{
 if(route.startsWith('/generation')){lookups++;if(lookups===1)throw Object.assign(new Error('Usage event not found'),{status:404});return {data:{total_cost:0.0123}};}
 inference++;return {id:'gen_test',usage:{prompt_tokens:10,completion_tokens:2},choices:[{message:{content:'Done'}}]};}});
 assert.equal(inference,1);assert.equal(lookups,2);assert.equal(result.usage.cost_usd,0.0123);
 const session=require('../log-report').parseSession(fs.readFileSync(log.file,'utf8'),log.file);
 assert.equal(session.usage.cost,0.0123);assert.equal(session.prompts[0].usage.cost,0.0123);
 assert.equal(session.prompts[0].timeline[0].usage.cost_usd,0.0123);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Vercel zero cost is preserved and billing failure never fails the answer',async()=>{
 for(const cost of [0,null]){
 let lookup=0;let call;
 const result=await api.ask({assistant:'vercel-api',apiKey:'test',model:'x',prompt:'x',instructions:'x',capabilities:{tools:false},onModelCall:e=>call=e,request:async(id,key,route)=>{
 if(route.startsWith('/generation')){lookup++;throw Object.assign(new Error('Forbidden'),{status:403});}
 return {id:'gen_test',providerMetadata:{gateway:{cost}},choices:[{message:{content:'OK'}}]};}});
 assert.equal(call.usage.cost_usd,cost);assert.equal(lookup,cost===0?0:1);
 assert.equal(result.usage.cost_missing||0,cost===null?1:0);
 if(cost===null)assert.equal(result.usage.cost_usd,undefined);
 }
});

test('failed model request carries its step and operation',async()=>{
 await assert.rejects(()=>api.ask({assistant:'vercel-api',apiKey:'test',model:'x',prompt:'x',instructions:'x',request:async()=>{throw new Error('API timed out');}}),error=>error.model_step===1 && error.operation==='Model request' && /timed out/.test(error.message));
});

test('Vercel actual response usage cost needs no generation lookup',async()=>{
 let requests=0,call;
 await api.ask({assistant:'vercel-api',apiKey:'test',model:'x',prompt:'x',instructions:'x',capabilities:{tools:false},onModelCall:e=>call=e,request:async()=>{requests++;return {id:'gen_x',usage:{prompt_tokens:4,completion_tokens:1,cost:0.2,gateway_cost:0.1},choices:[{message:{content:'Done'}}]};}});
 assert.equal(requests,1);assert.equal(call.usage.cost_usd,0.1);
});

test('tool support rejection retries once without tools and is remembered per key',async()=>{
 const support=require('../tool-support');support.configure(undefined);
 const bodies=[],events=[],notices=[];let executions=0;
 const options={assistant:'vercel-api',apiKey:'tool-key',model:'catalog-tools-test',prompt:'Describe supplied diff',instructions:'Context',capabilities:{tools:true},schema:{type:'object'},tools:[{name:'Read',inputSchema:{}}],callTool:async()=>{executions++;},onProviderResponse:e=>events.push(e),onToolUnsupported:e=>notices.push(e),request:async(id,key,route,body)=>{bodies.push(body);if(body.tools)throw Object.assign(new Error("API returned 400: This model doesn't support tool use."),{status:400});return {choices:[{message:{content:'Text answer'}}]};}};
 const answer=await api.ask(options);assert.equal(answer.plan.answer,'Text answer');assert.equal(answer.plan.navigation,null);
 assert.equal(bodies.length,2);assert.ok(bodies[0].tools.some(t=>t.function.name==='submit_vertex_answer'));assert.ok(!('tools' in bodies[1]));assert.match(bodies[1].messages[0].content,/Tools are unavailable/);assert.equal(executions,0);assert.equal(notices.length,1);assert.ok(events.some(e=>e.scope==='tool_support_rejected'));
 bodies.length=0;await api.ask(options);assert.equal(bodies.length,1);assert.ok(!bodies[0].tools);
 assert.equal(support.rejection('vercel-api','another-key',options.model),null);
 assert.equal(support.rejection('groq-api',options.apiKey,options.model),null);
 support.configure(undefined);
});
test('unrelated 400 errors are never treated as unsupported tools',async()=>{
 let requests=0;
 await assert.rejects(()=>api.ask({assistant:'groq-api',apiKey:'k',model:'bad-schema',prompt:'x',instructions:'x',request:async()=>{requests++;throw Object.assign(new Error('Invalid tools schema'),{status:400});}}),/Invalid tools schema/);
 assert.equal(requests,1);
});
test('tool rejection after executed actions stops without replaying them',async()=>{
 const support=require('../tool-support');support.configure(undefined);let requests=0,actions=0;
 await assert.rejects(()=>api.ask({assistant:'groq-api',apiKey:'k',model:'changed-route',prompt:'x',instructions:'x',tools:[{name:'Read',inputSchema:{}}],callTool:async()=>{actions++;return 'data';},request:async()=>{if(++requests===1)return {choices:[{message:{tool_calls:[{id:'a',function:{name:'Read',arguments:'{}'}}]}}]};throw Object.assign(new Error('Tool calling is not supported'),{status:400});}}),/Earlier tool operations were not repeated/);
 assert.equal(requests,2);assert.equal(actions,1);assert.ok(support.rejection('groq-api','k','changed-route'));support.configure(undefined);
});
test('runtime tool support evidence persists without storing credentials and expires',async()=>{
 const support=require('../tool-support');let saved;const storage={get:()=>saved||{},update:async(key,value)=>{saved=value;}};
 support.configure(storage);await support.reject('vercel-api','private-key','model');assert.ok(!JSON.stringify(saved).includes('private-key'));
 support.configure(storage);assert.equal(support.model('vercel-api','private-key',{id:'model',capabilities:{tools:true}}).capabilities.tools,false);
 const original=Date.now;try{Date.now=()=>original()+25*60*60*1000;assert.equal(support.rejection('vercel-api','private-key','model'),null);}finally{Date.now=original;support.configure(undefined);}
});

test('draft generation retries one network reset and does not enable retries for normal actions',async()=>{
 let calls=0;const delays=[],events=[];
 const answer=await api.rateLimitedRequest(async()=>{if(++calls===1)throw Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'});return 'draft';},{retryNetwork:true,sleep:async ms=>delays.push(ms),onProviderResponse:e=>events.push(e)});
 assert.equal(answer,'draft');assert.equal(calls,2);assert.deepEqual(delays,[1500]);assert.equal(events[0].scope,'network_retry');
 calls=0;await assert.rejects(()=>api.rateLimitedRequest(async()=>{calls++;throw Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'});},{retryNetwork:true,sleep:async()=>{}}),error=>error.networkAttempts===2);assert.equal(calls,2);
 calls=0;await assert.rejects(()=>api.rateLimitedRequest(async()=>{calls++;throw Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET'});}),/ECONNRESET/);assert.equal(calls,1);
});

test('an aborted HTTP response rejects with a recoverable transport code',async t=>{
 const https=require('node:https'),{EventEmitter}=require('node:events');
 t.mock.method(https,'request',(_url,_options,receive)=>{
  const req=new EventEmitter();req.setTimeout=()=>req;req.end=()=>{const res=new EventEmitter();res.setEncoding=()=>{};res.statusCode=200;receive(res);res.emit('aborted');};return req;
 });
 await assert.rejects(()=>api.requestJson('vercel-api','test','/chat/completions',{model:'x'}),error=>error.code==='ECONNRESET');
});

test('Web mode requires server search and exposes no client tools',async()=>{
 let body,tools=0,usage;
 const result=await api.ask({assistant:'vercel-api',apiKey:'web-key',model:'web-model',webSearch:true,webQuery:'ABAP benchmarks',prompt:'Question',instructions:'Search',capabilities:{tools:true,web:false},tools:[{name:'read_sap_object'}],callTool:()=>{tools++;},onModelCall:event=>usage=event.usage,request:async(_,__,___,value)=>{body=value;return {model:'web-model',usage:{prompt_tokens:10,completion_tokens:2,gateway_cost:0.01},choices:[{message:{content:'See [Source](https://example.com)',provider_metadata:{gateway:{gatewayToolCalls:{perplexity_search:1}}}}}]};}});
 assert.equal(body.tool_choice,'required');assert.deepEqual(body.tools,[{type:'vercel:perplexity_search',config:{query:'ABAP benchmarks',max_results:5}}]);assert.equal(tools,0);assert.equal(usage.web_search_calls,1);assert.equal(usage.cost_usd,0.01);assert.equal(result.plan.navigation,null);
});
test('Web mode never silently falls back to unsearched text',async()=>{
 let calls=0;
 await assert.rejects(()=>api.ask({assistant:'vercel-api',apiKey:'web-key',model:'web-failed',webSearch:true,prompt:'Query',instructions:'Search',request:async()=>{calls++;throw Object.assign(new Error("This model doesn't support tool use."),{status:400});}}),/support tool use/);assert.equal(calls,1);
 await assert.rejects(()=>api.ask({assistant:'vercel-api',model:'web-zero',webSearch:true,prompt:'Q',instructions:'Search',request:async()=>({choices:[{message:{content:'Unverified',provider_metadata:{gateway:{gatewayToolCalls:0}}}}]})}),/did not confirm/);
});

test('reasoning-only response records usage, finish diagnostics and the reasoning as a thinking note, not as the answer',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-reasoning-only-'));
 try{const log=require('../session-log').create(root,'vercel-api','20261107_160000',{answers:true});log.user('Commit draft');let calls=0,recorded;
 await assert.rejects(()=>api.ask({assistant:'vercel-api',apiKey:'k',model:'nemotron-test',prompt:'Draft',instructions:'Plain message',capabilities:{tools:false},maxOutputTokens:4096,onProviderResponse:event=>log.providerResponse(event),onModelCall:event=>{recorded=event;log.assistant(event);},request:async(id,key,route,body)=>{calls++;assert.equal(body.max_tokens,4096);return {id:'gen_only_reasoning',model:'nemotron-test',usage:{prompt_tokens:36632,completion_tokens:284,completion_tokens_details:{reasoning_tokens:284},cost:0},choices:[{finish_reason:'stop',message:{content:null,reasoning_content:'PRIVATE_THINKING'}}]};}}),error=>/reasoning only/.test(error.message)&&/Finish reason: stop/.test(error.message)&&error.model_step===1&&!error.message.includes('PRIVATE_THINKING'));
 assert.equal(calls,1);assert.equal(recorded.usage.output_tokens,284);assert.equal(recorded.usage.cost_usd,0);const text=fs.readFileSync(log.file,'utf8');assert.match(text,/"note":"thinking","text":"[^"]*PRIVATE_THINKING/);assert.ok(!/"type":"text","text":"[^"]*PRIVATE_THINKING/.test(text));assert.match(text,/"finish_reason":"stop"/);assert.match(text,/"reasoning_tokens":284/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('compatible API reads text content arrays and diagnoses truncated empty replies',async()=>{
 const result=await api.ask({assistant:'groq-api',model:'parts',prompt:'Draft',instructions:'Plain',capabilities:{tools:false},request:async()=>({choices:[{message:{content:[{type:'text',text:'Fix commit generation'},{type:'output_text',text:'Preserve usage.'}]}}]})});assert.equal(result.plan.answer,'Fix commit generation\nPreserve usage.');
 await assert.rejects(()=>api.ask({assistant:'groq-api',model:'limit',prompt:'Draft',instructions:'Plain',capabilities:{tools:false},request:async()=>({choices:[{finish_reason:'length',message:{content:''}}]})}),/reached its output limit/);
});
test('OpenAI output limit uses max_completion_tokens',async()=>{
 let body;await api.ask({assistant:'openai-api',model:'limit',prompt:'Draft',instructions:'Plain',capabilities:{tools:false},maxOutputTokens:4096,request:async(id,key,route,value)=>{body=value;return {choices:[{message:{content:'Done'}}]};}});assert.equal(body.max_completion_tokens,4096);assert.equal(body.max_tokens,undefined);
});

test('text-only JSON answer wrapper is unwrapped, empty JSON remains an accountable error',async()=>{
 for(const content of ['{"answer":"Visible methods"}','{}']){
 let logged;const options={assistant:'vercel-api',model:'text',apiKey:'test',prompt:'methods',instructions:'Reply',schema:{type:'object'},capabilities:{tools:false},onModelCall:event=>logged=event,request:async()=>({model:'text',usage:{prompt_tokens:10,completion_tokens:7,cost:0.0001},choices:[{message:{content},finish_reason:'stop'}]})};
 if(content==='{}')await assert.rejects(api.ask(options),/empty JSON object without an answer/);else assert.equal((await api.ask(options)).plan.answer,'Visible methods');assert.equal(logged.usage.cost_usd,0.0001);
 }
});

test('availability probe fails immediately on rate limits without sleeping or retries',async()=>{
 let calls=0,sleeps=0;
 const error=Object.assign(new Error('API returned 429'),{status:429,retryAfter:'60'});
 await assert.rejects(()=>api.probe('openrouter-api','key','model',async(...args)=>{
  calls++;assert.equal(args[5],10000);throw error;
 },{sleep:async()=>{sleeps++;}}),e=>e===error);
 assert.equal(calls,1);assert.equal(sleeps,0);
});

test('OpenRouter records response cost for chat and probes without billing lookups',async()=>{
 for(const cost of [0,0.000000123456789,'0.0123',null,undefined,'',false,'invalid',-1]){
  const expected=(typeof cost==='number'&&cost>=0||typeof cost==='string'&&cost==='0.0123')?Number(cost):null;
  for(const probe of [false,true]){
   let requests=0,record;
   const request=async(id,key,route)=>{requests++;assert.equal(id,'openrouter-api');assert.equal(route,'/chat/completions');return {id:'gen_or',usage:{cost,prompt_tokens:10,completion_tokens:2,cost_details:{upstream_inference_cost:123}},choices:[{message:{content:'OK'}}]};};
   const options={assistant:'openrouter-api',apiKey:'key',model:'x',prompt:'x',instructions:'x',textOnly:true,onModelCall:e=>record=e,request};
   const result=probe?await api.probe('openrouter-api','key','x',request,options):await api.ask(options);
   assert.equal(requests,1);assert.equal(record.usage.cost_usd,expected);
   if(expected!==null)assert.equal(result.usage.cost_usd,expected);
   else if(!probe)assert.equal(result.usage.cost_missing,1);
  }
 }
});
test('OpenRouter multi-round costs survive logs without double counting, including partial costs',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-or-cost-'));
 try{
 for(const second of [0.02,undefined]){
  const log=require('../session-log').create(root,'openrouter-api','cost-'+String(second),{});log.user('Check costs');
  let requests=0;
  const result=await api.ask({assistant:'openrouter-api',apiKey:'key',model:'x',prompt:'x',instructions:'x',schema:{type:'object'},tools:[{name:'read',description:'read',inputSchema:{type:'object'}}],callTool:async()=>({ok:true}),onProviderResponse:e=>log.providerResponse(e),onModelCall:e=>log.assistant(e),request:async()=>{
   requests++;return {id:'gen_'+requests,usage:{prompt_tokens:10,completion_tokens:2,cost:requests===1?0.01:second},choices:[{message:requests===1?{tool_calls:[{id:'call',function:{name:'read',arguments:'{}'}}]}:{tool_calls:[{id:'final',function:{name:'submit_vertex_answer',arguments:JSON.stringify({answer:'Done'})}}]}}]};
  }});
  const expected=second===undefined?0.01:0.03;assert.equal(requests,2);assert.equal(result.usage.cost_usd,expected);assert.equal(result.usage.cost_missing||0,second===undefined?1:0);
  const session=require('../log-report').parseSession(fs.readFileSync(log.file,'utf8'),log.file);assert.equal(session.usage.cost,expected);assert.equal(session.prompts[0].usage.cost,expected);
 }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('probe accepts empty reasoning-only messages and retains billed usage and diagnostics',async()=>{
 let call,event;
 await api.probe('openrouter-api','key','reasoner',async()=>({id:'gen_empty',usage:{cost:0.00012,completion_tokens:16,completion_tokens_details:{reasoning_tokens:16}},choices:[{finish_reason:'length',message:{content:'',reasoning:'private reasoning'}}]}),{onModelCall:e=>call=e,onProviderResponse:e=>event=e});
 assert.equal(call.usage.cost_usd,0.00012);assert.equal(call.usage.output_tokens,16);assert.equal(call.text,'');assert.equal(event.response.finish_reason,'length');assert.equal(event.response.message_diagnostics.content_characters,0);
 const result=await api.probe('openrouter-api','key','array',async()=>({usage:{cost:0},choices:[{message:{content:[{type:'text',text:'OK'}]}}]}));assert.equal(result.usage.cost_usd,0);
});

test('OpenRouter free classification uses explicit free routes or zero catalog pricing, not unknown prices',async()=>{
 const data=[{id:'a:free'},{id:'openrouter/free'},{id:'zero',pricing:{prompt:'0',completion:'0'}},{id:'paid',pricing:{prompt:'0',completion:'0.01'}},{id:'unknown'},{id:'empty',pricing:{prompt:'',completion:''}},{id:'fee',pricing:{prompt:'0',completion:'0',request:'0.01'}}];
 const rows=await api.models('openrouter-api','k',async()=>({data}));assert.deepEqual(rows.filter(m=>m.free).map(m=>m.id).sort(),['a:free','openrouter/free','zero']);
});

test("OpenRouter key limits: free requests left and spend in the usage line", async () => {
  const compatible = require("../openai-compatible");
  const limits = await compatible.keyLimits("k", async (id, key, route) => {
    assert.equal(route, "/key");
    return { data: { usage_daily: 0.009, limit_remaining: null, free_model_daily_requests: { used: 25, limit: 50, remaining: 25 } } };
  });
  assert.equal(compatible.limitsText(limits), "OpenRouter: free today 25 of 50 left · spent today $0.009");
  assert.equal(compatible.limitsText({ error: "HTTP 401" }), "OpenRouter limits not reported: HTTP 401");
  const { usageLine } = require("../sidebar");
  assert.match(usageLine({ model: "m", usage: { input_tokens: 1, output_tokens: 1 }, limits }), /\nOpenRouter: free today 25 of 50 left/);
});

test('daily free quota exhaustion stops without sleeping or retrying', async () => {
  let calls=0,sleeps=0;
  const daily=Object.assign(new Error('API returned 429: free-models-per-day'),{status:429});
  await assert.rejects(()=>api.rateLimitedRequest(async()=>{calls++;throw daily;},{sleep:async()=>{sleeps++;}}),error=>error===daily);
  assert.equal(calls,1);assert.equal(sleeps,0);
  const generic=Object.assign(new Error('API returned 429'),{status:429});
  calls=0;
  await assert.rejects(()=>api.rateLimitedRequest(async()=>{calls++;throw generic;},{onRateLimit:async()=>({retry:false}),sleep:async()=>{sleeps++;}}),error=>error===generic);
  assert.equal(calls,1);assert.equal(sleeps,0);
});

test("a picked local server is diagnosed: missing, stopped, empty or ready", async () => {
  const { diagnose } = require("../local-servers");
  const down = async () => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); };
  assert.equal((await diagnose("lmstudio-local", { request: down, installed: () => false })).state, "missing");
  assert.match((await diagnose("lmstudio-local", { request: down, installed: () => false })).text, /not installed.*lmstudio\.ai/);
  assert.match((await diagnose("ollama-local", { request: down, installed: () => true })).text, /installed, but its server does not answer/);
  assert.equal((await diagnose("ollama-local", { request: async () => ({ data: [] }) })).state, "empty");
  const ready = await diagnose("ollama-local", { request: async () => ({ data: [{ id: "a" }, { id: "b" }] }) });
  assert.equal(ready.state, "ready"); assert.match(ready.text, /2 models/);
  const places = require("../local-servers").places("ollama-local", "/Users/me", {});
  assert.ok(places.includes("/Applications/Ollama.app") && places.includes("/Users/me/.ollama"));
});

test("a local context-length error says how to load the model with a larger context", async () => {
  const http = require("http");
  const server = http.createServer((req, res) => { res.statusCode = 400; res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message: "The number of tokens to keep from the initial prompt is greater than the context length." } })); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  api.setLocalBase("lmstudio-local", "http://127.0.0.1:" + server.address().port + "/v1");
  try { await assert.rejects(api.requestJson("lmstudio-local", "local", "/chat/completions", { model: "m" }), /larger Context Length/); }
  finally { api.setLocalBase("lmstudio-local", ""); server.close(); }
  const full = http.createServer((req, res) => { res.statusCode = 400; res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message: "Model loading was stopped due to insufficient system resources. This model requires approximately 25.63 GB of memory." } })); });
  await new Promise(resolve => full.listen(0, "127.0.0.1", resolve));
  api.setLocalBase("lmstudio-local", "http://127.0.0.1:" + full.address().port + "/v1");
  try { await assert.rejects(api.requestJson("lmstudio-local", "local", "/chat/completions", { model: "m" }), /Unload the others in LM Studio/); }
  finally { api.setLocalBase("lmstudio-local", ""); full.close(); }
});

test("a local Qwen commit request opens with an empty think block and its reasoning reaches the log", async () => {
  const bodies = [], calls = [];
  const request = async (id, key, route, body) => { bodies.push(body); return { model: body.model, choices: [{ finish_reason: "stop",
    message: { role: "assistant", content: "Fix typo\n\nCorrects README.", reasoning_content: "Let me think." } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }; };
  const base = { assistant: "lmstudio-local", apiKey: "local", model: "qwen3.6-27b", prompt: "diff", instructions: "x", schema: {}, tools: [],
    capabilities: { tools: false }, textOnly: true, maxRounds: 1, request, onModelCall: event => calls.push(event) };
  await api.ask({ ...base, noThinking: true });
  assert.deepEqual(bodies[0].messages.at(-1), { role: "assistant", content: "<think>\n\n</think>\n\n" });
  assert.equal(calls[0].reasoning, "Let me think.");
  await api.ask({ ...base });
  assert.equal(bodies[1].messages.at(-1).role, "user");
  await api.ask({ ...base, noThinking: true, model: "gemma-3-12b" });
  assert.equal(bodies[2].messages.at(-1).role, "user");
  await api.ask({ ...base, noThinking: true, assistant: "openai-api" });
  assert.equal(bodies[3].messages.at(-1).role, "user");
});

test("model reasoning is written to the session log as a thinking note", () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-log-"));
  const log = require("../session-log").create(dir, "lmstudio-local", "s1", { answers: true });
  log.assistant({ model: "qwen3.6-27b", usage: {}, text: "Answer", reasoning: "Thinking it through" });
  const text = fs.readdirSync(dir, { recursive: true }).filter(f => /\.jsonl$/.test(f)).map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("");
  assert.match(text, /"note":"thinking","text":"Thinking it through"/);
  assert.match(text, /"text":"Answer"/);
});

test("local servers start switched off in LLM Providers unless switched on or in use", async () => {
  let stored = {}, provider = "codex-subscription";
  const vscode = { ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: () => ({
    get: (key, fallback) => key === "modelConfig" ? stored : key === "provider" ? provider : fallback,
    update: async (key, value) => { if (key === "modelConfig") stored = value; } }) } };
  assert.equal(modelConfig.isOn(vscode, "lmstudio-local"), false);
  assert.equal(modelConfig.isOn(vscode, "ollama-local"), false);
  assert.equal(modelConfig.isOn(vscode, "openai-api"), true);
  assert.ok(!modelConfig.offered(vscode).some(p => p.id === "ollama-local"));
  provider = "lmstudio-local";
  assert.equal(modelConfig.isOn(vscode, "lmstudio-local"), true);
  provider = "codex-subscription";
  stored = { "ollama-local": { off: false } };
  assert.equal(modelConfig.isOn(vscode, "ollama-local"), true);
});

test("Uncommitted changes offers a vertex-toggle for hidden .md/.log files and says they are still committed", () => {
  const review = require("../code-review");
  const files = [{ id: "f1", path: "a.js", label: "a.js", kind: "changed", parts: review.hunks("x\n", "y\n"), before: "x\n", after: "y\n" }];
  const html = review.filesReviewHtml(files, { readonly: { title: "Uncommitted changes", commit: true, refresh: true, hidden: { exts: ["md", "log"], count: 3, shown: false } } });
  assert.match(html, /id="hidden-files" class="vertex-toggle" aria-pressed="false"[^>]*>\.md, \.log \(3\)</);
  assert.match(html, /plus 3 hidden \.md, \.log files \(not sent to AI\)/);
  assert.match(html, /action:'toggleHidden'/);
  const on = review.filesReviewHtml(files, { readonly: { title: "Uncommitted changes", commit: true, refresh: true, hidden: { exts: ["md", "log"], count: 3, shown: true } } });
  assert.match(on, /class="vertex-toggle on" aria-pressed="true"/);
  assert.doesNotMatch(on, /hidden \.md, \.log files/);
  const none = review.filesReviewHtml(files, { readonly: { title: "Uncommitted changes", commit: true, refresh: true, hidden: { exts: ["md", "log"], count: 0, shown: false } } });
  assert.doesNotMatch(none, /id="hidden-files"/);
});

test("a local server lists every model for LLM Providers and the panel offers only the loaded ones", async () => {
  const lm = async (id, key, route) => route === "/models"
    ? { data: [{ id: "qwen3.6-27b" }, { id: "nvidia/nemotron-3-nano-omni" }, { id: "text-embedding-nomic-embed-text-v1.5" }] }
    : { data: [{ id: "nvidia/nemotron-3-nano-omni", state: "loaded", loaded_context_length: 8192 }, { id: "qwen3.6-27b", state: "not-loaded" }] };
  const all = await api.models("lmstudio-local", "local", lm);
  assert.deepEqual(all, [{ id: "nvidia/nemotron-3-nano-omni", label: "nvidia/nemotron-3-nano-omni · context 8192", loaded: true }, { id: "qwen3.6-27b", label: "qwen3.6-27b", loaded: false }]);
  const vscode = { workspace: { getConfiguration: () => ({ get: (key, fallback) => fallback }) } };
  assert.deepEqual(modelConfig.apply(vscode, "lmstudio-local", all), [{ id: "nvidia/nemotron-3-nano-omni", label: "nvidia/nemotron-3-nano-omni · context 8192" }]);
  assert.throws(() => modelConfig.apply(vscode, "lmstudio-local", [{ id: "q", label: "q", loaded: false }]), /No model is loaded in LM Studio/);
  const old = async (id, key, route) => { if (route === "/models") return { data: [{ id: "a" }] }; throw new Error("404"); };
  assert.deepEqual(modelConfig.apply(vscode, "lmstudio-local", await api.models("lmstudio-local", "local", old)).map(m => m.id), ["a"]);
  const ollama = async (id, key, route) => route === "/models" ? { data: [{ id: "qwen3:8b" }, { id: "llama3.1:8b" }] } : { models: [{ name: "qwen3:8b", context_length: 32768 }] };
  assert.deepEqual(modelConfig.apply(vscode, "ollama-local", await api.models("ollama-local", "local", ollama)).map(m => m.label), ["qwen3:8b · context 32768"]);
});

test("checking a local model that is not started does not load it", async () => {
  const sent = [];
  const lm = async (id, key, route, body) => { sent.push(route); return route === "/models" ? { data: [{ id: "big" }] } : { data: [{ id: "big", state: "not-loaded" }] }; };
  await assert.rejects(api.probe("lmstudio-local", "local", "big", lm), /big is not loaded in LM Studio\. Start it there/);
  assert.ok(!sent.includes("/chat/completions"));
});

test('Gemini decisions use native URL and x-goog-api-key rather than the chat endpoint',async t=>{
 const https=require('https'),{EventEmitter}=require('events');let target,headers;
 t.mock.method(https,'request',(url,options,callback)=>{target=url;headers=options.headers;const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>{const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>{};callback(res);res.emit('data',JSON.stringify({answers:{passed:{type:'noul',noul:0.9}},usage:{total_input_tokens:10,total_output_tokens:0}}));res.emit('end');req.emit('close');};return req;});
 const result=await api.probe('gemini-api','gemini-fixture','gemini-decision-1');assert.equal(target.href,'https://generativelanguage.googleapis.com/v1beta/decisions');assert.equal(headers['x-goog-api-key'],'gemini-fixture');assert.equal(headers.authorization,undefined);assert.equal(result.usage.input_tokens,10);assert.equal(result.usage.cost_usd,undefined);
 await assert.rejects(api.ask({assistant:'gemini-api',apiKey:'gemini-fixture',model:'gemini-decision-1',prompt:'chat'}),/decision model/);
});

test('Gemini prefixed Decision ID from its model catalog is classified once and uses the native probe',async()=>{
 const models=await api.models('gemini-api','key',async()=>({data:[{id:'models/gemini-decision-1',name:'Gemini Decision 1'}]}));assert.equal(models.length,1);assert.equal(models[0].modelKind,'decision');assert.equal(models[0].id,'models/gemini-decision-1');
 const r=await api.probe('gemini-api','key',models[0].id,async(id,key,route,body)=>{assert.equal(route,'/decisions');assert.equal(body.model,'gemini-decision-1');return{answers:{passed:{type:'noul',noul:0.99}},usage:{total_input_tokens:10,total_output_tokens:0}};});assert.equal(r.model,'gemini-decision-1');assert.equal(r.usage.cost_usd,undefined);
});
