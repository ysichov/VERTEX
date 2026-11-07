"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../openai-compatible");
const modelConfig = require("../model-config");
const assistant = require("../assistant");

test("API provider catalog matches the ABAP-AI-Code key providers", () => {
  assert.deepEqual(Object.keys(api.PROVIDERS), ["openai-api", "mistral-api", "gemini-api", "groq-api",
    "cerebras-api", "openrouter-api", "nvidia-api", "vercel-api"]);
  for (const id of Object.keys(api.PROVIDERS)) {
    assert.ok(modelConfig.PROVIDERS.some(provider => provider.id === id && provider.setting === id));
    assert.match(api.PROVIDERS[id].base, /^https:\/\//);
  }
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
  assert.match(panel.webview.html, /s\.rows\.forEach\(r => \{ r\.on = next && r\.available !== false; \}\)/);
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
  assert.equal(values.model, "", "a removed CLI model is no longer selected");
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
  assert.deepEqual(list, [{ id: "gemini-a", label: "A" }, { id: "gemini-z", label: "Z" }]);
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


test("Vercel excludes batch variants by model id and display name", async () => {
  const data = [
    { id: "anthropic/claude-fable-5", name: "Claude Fable 5", type: "language" },
    { id: "anthropic/claude-fable-5-batch", type: "language" },
    { id: "anthropic/claude-fable-5-batch-v2", type: "language" },
    { id: "anthropic/alias", name: "Claude Fable 5 (Batch)", type: "language" },
    { id: "anthropic/alias2", display_name: "Claude Fable 5 (BATCH)", type: "language" }
  ];
  const request = async () => ({ data });
  assert.deepEqual((await api.models("vercel-api", "k", request)).map(({id,label})=>({id,label})), [
    { id: "anthropic/claude-fable-5", label: "Claude Fable 5" }
  ]);
  assert.equal((await api.models("openrouter-api", "k", request)).length, data.length);
});


test('availability probe makes one capped request without history or tools',async()=>{
 const calls=[];
 await api.probe('vercel-api','key','model',async(...args)=>{calls.push(args);return {choices:[{message:{content:'OK'}}]};});
 assert.equal(calls.length,1);assert.equal(calls[0][2],'/chat/completions');
 assert.deepEqual(calls[0][3],{model:'model',messages:[{role:'user',content:'Reply OK.'}],stream:false,max_tokens:16});
});


test('Vercel metadata distinguishes declared support, no image input and unknown fields',async()=>{
 const result=await api.models('vercel-api','k',async()=>({data:[{id:'test/text',type:'language',name:'Text',supported_parameters:['tools','response_format'],modalities:{input:['text']},tags:['reasoning'],context_window:1000000}]}));
 assert.deepEqual(result[0].capabilities,{tools:true,json:true,reasoning:true,vision:false,web:null});
 assert.equal(result[0].contextWindow,1000000);
 const unknown=require('../model-capabilities').metadata({});assert.equal(unknown.capabilities.vision,null);
 const vscode={workspace:{getConfiguration:()=>({get:(_,fallback)=>fallback})}};
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
 await api.ask({assistant:'vercel-api',apiKey:'test',model:'x',prompt:'x',instructions:'x',capabilities:{tools:false},onModelCall:e=>call=e,request:async(id,key,route)=>{
 if(route.startsWith('/generation')){lookup++;throw Object.assign(new Error('Forbidden'),{status:403});}
 return {id:'gen_test',providerMetadata:{gateway:{cost}},choices:[{message:{content:'OK'}}]};}});
 assert.equal(call.usage.cost_usd,cost);assert.equal(lookup,cost===0?0:1);
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

test('reasoning-only response records usage and finish diagnostics without exposing reasoning as answer',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-reasoning-only-'));
 try{const log=require('../session-log').create(root,'vercel-api','20261107_160000',{answers:true});log.user('Commit draft');let calls=0,recorded;
 await assert.rejects(()=>api.ask({assistant:'vercel-api',apiKey:'k',model:'nemotron-test',prompt:'Draft',instructions:'Plain message',capabilities:{tools:false},maxOutputTokens:4096,onProviderResponse:event=>log.providerResponse(event),onModelCall:event=>{recorded=event;log.assistant(event);},request:async(id,key,route,body)=>{calls++;assert.equal(body.max_tokens,4096);return {id:'gen_only_reasoning',model:'nemotron-test',usage:{prompt_tokens:36632,completion_tokens:284,completion_tokens_details:{reasoning_tokens:284},cost:0},choices:[{finish_reason:'stop',message:{content:null,reasoning_content:'PRIVATE_THINKING'}}]};}}),error=>/reasoning only/.test(error.message)&&/Finish reason: stop/.test(error.message)&&error.model_step===1&&!error.message.includes('PRIVATE_THINKING'));
 assert.equal(calls,1);assert.equal(recorded.usage.output_tokens,284);assert.equal(recorded.usage.cost_usd,0);const text=fs.readFileSync(log.file,'utf8');assert.ok(!text.includes('PRIVATE_THINKING'));assert.match(text,/"finish_reason":"stop"/);assert.match(text,/"reasoning_tokens":284/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('compatible API reads text content arrays and diagnoses truncated empty replies',async()=>{
 const result=await api.ask({assistant:'groq-api',model:'parts',prompt:'Draft',instructions:'Plain',capabilities:{tools:false},request:async()=>({choices:[{message:{content:[{type:'text',text:'Fix commit generation'},{type:'output_text',text:'Preserve usage.'}]}}]})});assert.equal(result.plan.answer,'Fix commit generation\nPreserve usage.');
 await assert.rejects(()=>api.ask({assistant:'groq-api',model:'limit',prompt:'Draft',instructions:'Plain',capabilities:{tools:false},request:async()=>({choices:[{finish_reason:'length',message:{content:''}}]})}),/reached its output limit/);
});
test('OpenAI output limit uses max_completion_tokens',async()=>{
 let body;await api.ask({assistant:'openai-api',model:'limit',prompt:'Draft',instructions:'Plain',capabilities:{tools:false},maxOutputTokens:4096,request:async(id,key,route,value)=>{body=value;return {choices:[{message:{content:'Done'}}]};}});assert.equal(body.max_completion_tokens,4096);assert.equal(body.max_tokens,undefined);
});
