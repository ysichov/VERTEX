"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

test("sidebar HTML contains an executable chat script", () => {
  const folder = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(folder, "sidebar.js"), "utf8");
  const sandbox = { module: { exports: {} }, require, __dirname: folder };
  vm.runInNewContext(source + "\nmodule.exports.renderForTest = html;", sandbox);
  const html = sandbox.module.exports.renderForTest("test-nonce");
  const script = html.slice(html.indexOf('<script nonce="test-nonce">') + '<script nonce="test-nonce">'.length, html.indexOf("</script>"));
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /requestSubmit\(\)/);
  assert.doesNotMatch(html,/id="web-search"|id="web-search-option"/);
  assert.match(html,/id="context-mode"/);
  assert.match(script, /action: 'ready'/);
  assert.match(html, /id="model-status" role="status"/);
  assert.match(html, /class="model-picker"><select id="model-select"[\s\S]*?id="model-details-button"[\s\S]*?>\$<\/button><\/span>/);
  assert.match(html, /<dialog id="model-details-dialog"[\s\S]*?<div id="model-capabilities"><\/div>/);
  assert.match(script, /getElementById\('model-details-dialog'\)\.showModal\(\)/);

  // The AI and SAP logs are the view's title actions, not buttons in the panel; the folder shares the SAP system line.
  assert.doesNotMatch(html, /data-action="(logs|executionLogs)"/);
  assert.match(html, /<span id="folder-line" hidden>/);
  const title = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).contributes.menus["view/title"]
    .filter(item => item.when === "view == vertex.launcher").map(item => item.command);
  // Just before the settings gear, the last of the title actions.
  assert.deepEqual(title.slice(-3), ["vertex.showLogs", "vertex.openSapDebugRuns", "vertex.openSettings"]);
  assert.match(script, /status\.textContent = data\.error/);
  assert.doesNotMatch(html, /system-snc/);
});

test("conversation history searches saved chats and continues the selected conversation", () => {
  const folder=path.join(__dirname,'..'),sandbox={module:{exports:{}},require,__dirname:folder};
  vm.runInNewContext(fs.readFileSync(path.join(folder,'sidebar.js'),'utf8')+'\nmodule.exports.renderForTest=html;',sandbox);
  const html=sandbox.module.exports.renderForTest('test');
  const script=html.slice(html.indexOf('<script nonce="test">')+21,html.indexOf('</script>'));
  const nodes=new Map(),events=[],posted=[];
  const make=()=>({value:'',children:[],append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  const scopeButtons=[false,true].map(all=>({dataset:{all:String(all)},classList:{toggle(){}},setAttribute(){}}));
  const context={document:{getElementById:get,createElement:make,querySelectorAll:()=>scopeButtons},window:{addEventListener:(_,fn)=>events.push(fn)},api:{postMessage:m=>posted.push(m)},chatRunning:false};
  vm.runInNewContext(script.slice(script.indexOf('let historyItems='),script.indexOf("document.querySelectorAll('[data-context]')")),context);
  get('conversation-history').open=true;get('conversation-history').ontoggle();
  assert.equal(posted.pop().action,'conversationHistory');
  const receive=events[0];
  receive({data:{conversationHistory:{items:[{id:'a',title:'Translator',lastQuestion:'last screenshot',providers:'claude',count:3,time:1},{id:'b',title:'Other chat',lastQuestion:'hello',providers:'codex',count:1,time:2}]}}});
  assert.equal(get('history-list').children.length,2);
  get('history-search').value='screenshot';get('history-search').oninput();
  assert.equal(get('history-list').children.length,1);
  get('history-list').children[0].onclick();
  assert.equal(posted.at(-1).action,'continueHistory');assert.equal(posted.at(-1).id,'a');
  receive({data:{historyContinued:true}});
  assert.equal(get('conversation-history').open,false);
  scopeButtons[1].onclick();assert.equal(posted.at(-1).all,true);
});

test("run and saved SAP-session citations link only when their session is known", () => {
  const folder = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(folder, "sidebar.js"), "utf8");
  const sandbox = { module: { exports: {} }, require, __dirname: folder };
  vm.runInNewContext(source + "\nmodule.exports.renderForTest = html;", sandbox);
  const html = sandbox.module.exports.renderForTest("test-nonce");
  const script = html.slice(html.indexOf('<script nonce="test-nonce">') + '<script nonce="test-nonce">'.length, html.indexOf("</script>"));
  const pick = name => script.slice(script.indexOf("function " + name + "("), script.indexOf("\n}\n", script.indexOf("function " + name + "(")) + 2);
  const node = tag => ({ tag, children: [], dataset: {}, appendChild(child) { this.children.push(child); },
    replaceWith(other) { this.replaced = other; }, addEventListener(_, f) { this.click = f; } });
  const posted = [], parent = node("p");
  const context = { document: { createElement: node, createTextNode: text => ({ text }) }, api: { postMessage: m => posted.push(m) } };
  vm.runInNewContext(pick("inline") + pick("runLinks"), context);
  const bold = node("p");
  context.inline("**`anthropic.test.js`**: see *`ZDEMO` too*", bold);
  const strong = bold.children.find(child => child.tag === "strong");
  assert.equal(strong.children[0].tag, "code", "bold text holds the code, not literal backticks");
  assert.equal(strong.children[0].textContent, "anthropic.test.js");
  assert.equal(bold.children.find(child => child.tag === "em").children[0].tag, "code");
  context.inline("both read 4712 [run d6c436b8 step 13], [session a1b2c3d4 step 4] and [session 99999999 step 2]", parent);
  const cites = parent.children.filter(child => child.className === "run-cite");
  assert.deepEqual(cites.map(c => [c.dataset.kind, c.dataset.run, c.dataset.step]),
    [["run", "d6c436b8", "13"], ["session", "a1b2c3d4", "4"], ["session", "99999999", "2"]]);
  context.runLinks({ querySelectorAll: () => cites }, [
    { kind: "transpiler", session_id: "d6c436b8-0000-4000-8000-000000000000", run_id: "d6c436b8-0000-4000-8000-000000000000", number: 2 },
    { kind: "sap", session_id: "a1b2c3d4-0000-4000-8000-000000000000" }
  ]);
  assert.ok(cites[0].replaced && cites[1].replaced && !cites[2].replaced);
  assert.equal(cites[0].replaced.textContent, "run 2, step 13");
  cites[0].replaced.click({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ action: "openRun", run_id: "d6c436b8-0000-4000-8000-000000000000", step: 13 }]);
  cites[1].replaced.click({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(posted[1])), { action: "openSession", session_id: "a1b2c3d4-0000-4000-8000-000000000000", step: 4 });
});

test("direct search answer links both the program and its package", () => {
  const folder = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(folder, "sidebar.js"), "utf8");
  const sandbox = { module: { exports: {} }, require, __dirname: folder };
  vm.runInNewContext(source + "\nmodule.exports.renderForTest = html;", sandbox);
  const html = sandbox.module.exports.renderForTest("test-nonce");
  const script = html.slice(html.indexOf('<script nonce="test-nonce">') + '<script nonce="test-nonce">'.length, html.indexOf("</script>"));
  const start = script.indexOf("function links("), end = script.indexOf("\n}", start) + 2;
  const posted = [];
  const context = { document: { createElement: () => ({ appendChild() {}, addEventListener(_, callback) { this.click = callback; } }) },
    api: { postMessage: message => posted.push(message) } };
  vm.runInNewContext(script.slice(start, end), context);
  const names = ["ZVERTEX_DEBUG_LAB", "Z_RIG"].map(textContent => ({ textContent,
    closest: () => null, cloneNode: () => ({}), replaceWith(link) { this.link = link; } }));
  context.links({ querySelectorAll: () => names }, [
    { object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB" },
    { object_type: "DEVC", object_name: "Z_RIG" }
  ]);
  names.forEach(name => name.link.click({ preventDefault() {} }));
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [
    { action: "openObject", object_type: "PROG", object_name: "ZVERTEX_DEBUG_LAB" },
    { action: "openObject", object_type: "DEVC", object_name: "Z_RIG" }
  ]);
});

test("sidebar selection uses the VS Code clipboard for macOS Copy", () => {
  const source = fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8");
  const sent = [], handlers = {};
  const context = vm.createContext({ api: { postMessage: value => sent.push(value) }, window: { getSelection: () => "Selected answer" },
    document: { activeElement: null, addEventListener: (name, fn) => { handlers[name] = fn; } } });
  vm.runInContext(source.slice(source.indexOf("let lastCopy = null;"), source.indexOf("const progressItems")), context);
  let prevented = false;
  handlers.keydown({ key: "c", metaKey: true, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.ok(prevented);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, "copyAnswer");
  assert.equal(sent[0].text, "Selected answer");
});

test("task logo turns, and is hidden only without motion unless vertex.animations is on",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","sidebar.js"),"utf8");
 assert.match(source,/#messages \.vertex\.task\.working::before \{ animation: vertex-task-turn 6s linear infinite;/);
 assert.doesNotMatch(source,/^#messages \.vertex\.task\.working::before \{ animation: none;/m);
 assert.match(source,/body\.vscode-reduce-motion:not\(\.vertex-motion-on\) #messages \.vertex\.task::before \{ display: none; \}/);
});

test('web citations create only HTTP links through host openExternal',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','sidebar.js'),'utf8'),sandbox={module:{exports:{}},require,__dirname:path.join(__dirname,'..')};
 vm.runInNewContext(source+'\nmodule.exports.render=html;',sandbox);const html=sandbox.module.exports.render('n');const script=html.match(/<script nonce="n">([\s\S]*?)<\/script>/)[1];const start=script.indexOf('function inline('),end=script.indexOf('\n}\n',start)+2;
 const children=[],posted=[];const context={document:{createElement:tag=>({tag,attrs:{},on:{},setAttribute(name,value){this.attrs[name]=value;},addEventListener(name,fn){this.on[name]=fn;}}),createTextNode:text=>({text})},api:{postMessage:m=>posted.push(m)}};vm.runInNewContext(script.slice(start,end),context);
 context.inline('[Source](https://example.com) [bad](javascript:alert)',{appendChild:n=>children.push(n)});const link=children.find(n=>n.tag==='a');assert.equal(link.href,undefined,'no href: VS Code would open it itself, and the host would ask again');assert.equal(link.title,'https://example.com');assert.equal(JSON.parse(link.attrs['data-vscode-context']).url,'https://example.com');assert.equal(children.filter(n=>n.tag==='a').length,1);link.on.click({preventDefault(){}});assert.equal(posted[0].action,'openWebLink');assert.equal(posted[0].url,'https://example.com');link.on.keydown({key:'Enter',preventDefault(){}});assert.equal(posted.length,2);
});

for (const gateway of ['vercel-api','openrouter-api','opencode-api']) test(gateway+' chat selects a model provider and filters models without losing current or off selection',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','sidebar.js'),'utf8'),sandbox={module:{exports:{}},require,__dirname:path.join(__dirname,'..')};vm.runInNewContext(source+'\nmodule.exports.render=html;',sandbox);const html=sandbox.module.exports.render('test');const script=html.match(/<script nonce="test">([\s\S]*?)<\/script>/)[1];
 const pick=name=>{const start=script.indexOf('function '+name+'(');return script.slice(start,script.indexOf('\n}\n',start)+2);};
 const nodes=Object.fromEntries(['provider-select','subprovider-select','model-select','model-status'].map(id=>[id,{value:'',replaceChildren(...items){this.options=items;}}]));nodes['provider-select'].value=gateway;const posted=[];
 const context={document:{getElementById:id=>nodes[id]},Option:function(text,value){this.text=text;this.value=value;},groupModels:require('../model-capabilities').groupModels,sortModels:require('../model-capabilities').sortModels,lastVercelModels:new Map(),modelCatalog:[{id:'openai/a',label:'A'},{id:'google/g1',label:'G1'},{id:'google/g2',label:'G2'}],drawModelCapabilities(){},api:{postMessage:m=>posted.push(m)}};
 vm.runInNewContext(pick('vercelGroups')+pick('drawModelPickers')+pick('chooseVercelProvider'),context);
 context.drawModelPickers('google/g2');assert.equal(nodes['subprovider-select'].value,'google');assert.deepEqual(nodes['model-select'].options.map(o=>o.value),['google/g1','google/g2']);assert.equal(nodes['model-select'].value,'google/g2');assert.equal(nodes['subprovider-select'].hidden,false);
 nodes['subprovider-select'].value='openai';context.chooseVercelProvider();assert.equal(nodes['model-select'].value,'openai/a');assert.equal(posted.at(-1).model,'openai/a');nodes['subprovider-select'].value='google';context.chooseVercelProvider();assert.equal(nodes['model-select'].value,'google/g2');
 context.drawModelPickers('old/disabled');assert.equal(nodes['subprovider-select'].value,'old');assert.equal(nodes['model-select'].options[0].text,'old/disabled (off)');
 nodes['provider-select'].value='claude-subscription';context.drawModelPickers('openai/a');assert.equal(nodes['subprovider-select'].hidden,true);assert.equal(nodes['model-select'].options.length,3);
 nodes['provider-select'].value=gateway;context.modelCatalog=[{id:'openai/high',label:'High',pricing:{input:'0.00001',output:'0.00002'}},{id:'openai/unknown',label:'Unknown'},{id:'openai/tie-high',label:'Tie high',pricing:{input:'0.000001',output:'0.000004'}},{id:'openai/free',label:'Free',pricing:{input:'0',output:'0'}},{id:'openai/tie-low',label:'Tie low',pricing:{input:'0.000001',output:'0.000002'}}];context.drawModelPickers('openai/high');assert.deepEqual(nodes['model-select'].options.map(o=>o.value),['openai/free','openai/tie-low','openai/tie-high','openai/high','openai/unknown']);assert.equal(nodes['model-select'].value,'openai/high');
 context.modelCatalog=[];context.drawModelPickers('');assert.equal(nodes['model-select'].disabled,true);assert.equal(nodes['subprovider-select'].disabled,true);
});

test("answer footer preserves actual Vercel cost precision, zero and missing costs", () => {
 const {usageLine}=require('../sidebar');
 const reply={model:'test/model',usage:{input_tokens:10,output_tokens:2,cost_usd:0.00088929}};
 assert.match(usageLine(reply),/\$0\.00088929/);
 reply.usage.cost_usd=0.000000000123456789;assert.match(usageLine(reply),/\$0\.000000000123456789/);
 reply.usage.cost_usd=0;assert.match(usageLine(reply),/\$0(?: ·|$)/);
 reply.usage.cost_missing=1;assert.match(usageLine(reply),/partial/);
 delete reply.usage.cost_usd;assert.match(usageLine(reply),/cost not reported/);
});

test('focused model selector copies the exact model ID rather than its display label',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../sidebar.js'),'utf8'),sent=[],handlers={};
 const field={id:'model-select',value:'claude-fable-5-2'};
 vm.runInNewContext(source.slice(source.indexOf('let lastCopy = null;'),source.indexOf('const progressItems')),{
  api:{postMessage:m=>sent.push(m)},window:{getSelection:()=>''},document:{activeElement:field,addEventListener:(name,fn)=>{handlers[name]=fn;}}
 });
 handlers.keydown({key:'c',ctrlKey:true,preventDefault(){},stopPropagation(){}});
 assert.equal(sent.at(-1).text,'claude-fable-5-2');assert.equal(sent.at(-1).action,'copyAnswer');
 field.value='';handlers.keydown({key:'c',metaKey:true});assert.equal(sent.length,1);
});

test("with no provider offered the provider, model and effort choice is hidden", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "sidebar.js"), "utf8");
  assert.match(source, /body\.no-providers #provider-select,[^{]*body\.no-providers \.model-picker,[^{]*body\.no-providers #effort-select[^{]*\{ display:none !important; \}/);
  assert.match(source, /document\.body\.classList\.toggle\('no-providers', !select\.options\.length\);/);
});
test('topic badges accept numeric IDs and expose manual continuation using theme variables',()=>{const folder=path.join(__dirname,'..'),sandbox={module:{exports:{}},require,__dirname:folder};vm.runInNewContext(fs.readFileSync(path.join(folder,'sidebar.js'),'utf8')+'\nmodule.exports.renderForTest=html;',sandbox);const page=sandbox.module.exports.renderForTest('topic-test');assert.doesNotMatch(page,/id="optimize-context"/);assert.doesNotMatch(page,/id="route-topics"/);assert.match(page,/<option value="full">Full history<\/option><option value="auto">Auto \(Jev\)<\/option>/);assert.match(page,/class="vertex-segment-toggle" id="history-mode"/);assert.doesNotMatch(page,/New topic/);const start=page.indexOf('function setTopic('),end=page.indexOf("window.addEventListener('message'",start);const item={dataset:{},style:{},firstChild:null,querySelector:()=>null,insertBefore(value){this.badge=value;}};vm.runInNewContext(page.slice(start,end)+'\nsetTopic(item,{id:"topic_0001",label:"Code",dependencies:["topic_0002"]});',{item,document:{createElement:()=>({})}});assert.equal(item.dataset.topicId,'topic_0001');assert.match(item.style.borderLeft,/var\(--vscode-charts-/);assert.equal(item.badge.textContent,'topic_0001 · Code');assert.equal(item.badge.onclick,undefined);assert.match(item.badge.title,/topic_0002/);});


test('topic catalog refresh updates existing badges and stale incoming labels use the canonical title',()=>{
 const folder=path.join(__dirname,'..'),sandbox={module:{exports:{}},require,__dirname:folder};
 vm.runInNewContext(fs.readFileSync(path.join(folder,'sidebar.js'),'utf8')+'\nmodule.exports.renderForTest=html;',sandbox);
 const page=sandbox.module.exports.renderForTest('badge-test'),start=page.indexOf('function setTopic('),eventStart=page.indexOf("window.addEventListener('message'",start),end=page.indexOf("window.addEventListener('message'",eventStart+1);
 const item={dataset:{},style:{},firstChild:null,querySelector(){return this.badge||null;},insertBefore(badge){this.badge=badge;}},events=[];
 const picker={value:'full',options:[],append(option){this.options.push(option);}},prompt={focus(){this.focused=true;}};
 const context={item,window:{addEventListener:(_name,fn)=>events.push(fn)},document:{createElement:()=>({}),querySelectorAll:()=>[item],getElementById:id=>id==='topic-picker'?picker:prompt},drawTopicPicker(){},paintHistory(){}};
 vm.createContext(context);vm.runInContext('let topicCatalog=[];'+page.slice(start,end),context);
 vm.runInContext('setTopic(item,{id:"topic_0006",label:"что это Screenshot observations Visible facts"});',context);
 events[0]({data:{topicList:[{id:'topic_0006',label:'Launchpad Content Manager — SAP_GRC_RM'}]}});
 assert.equal(item.badge.textContent,'topic_0006 · Launchpad Content Manager — SAP_GRC_RM');
 vm.runInContext('setTopic(item,{id:"topic_0006",label:"stale Screenshot observations"});',context);
 assert.equal(item.badge.textContent,'topic_0006 · Launchpad Content Manager — SAP_GRC_RM');
 assert.equal(item.badge.onclick,undefined);assert.equal(picker.value,'full');assert.equal(picker.options.length,0);
});
