"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { detect } = require("../model-detection");
test("discovery distinguishes models that answer, models that fail, and missing providers", async () => {
  const progress = [];
  const result = await detect([{id:"one"},{id:"missing"}], async id => {
    if (id === "missing") throw new Error("No key");
    return [{id:"ok",label:"OK"},{id:"no",label:"No"}];
  }, async (_,model) => { if (model === "no") throw new Error("Forbidden"); }, p => progress.push(p));
  assert.deepEqual(result.results[0].rows.map(r => [r.id,r.on,r.available]), [["ok",true,true],["no",false,false]]);
  assert.equal(result.results[0].rows[1].reason,"Forbidden");
  assert.equal(result.results[1].error,"No key");
  assert.equal(progress.length,2);
});
test("stopping discovery never applies a partially checked provider", async () => {
  let stop = false;
  const result = await detect([{id:"one"}], async () => [{id:"a"},{id:"b"}], async () => {stop=true;}, () => {}, () => stop);
  assert.equal(result.cancelled,true);
  assert.deepEqual(result.results,[]);
});
test("the LLM settings page script compiles and uses the existing button theme", () => {
  const { open } = require("../model-config");
  let page;
  const vscode = { ViewColumn: { Active: 1 }, workspace: { getConfiguration: () => ({ get: (_,fallback) => fallback }) },
    window: { createWebviewPanel: () => (page = { webview: { postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {} }) } };
  open(vscode,async () => [], () => "", () => {}, {});
  const code = page.webview.html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  new (require("node:vm").Script)(code);
  assert.match(page.webview.html,/textContent: scanningProvider === p.id/);
  assert.match(page.webview.html,/action: "detect", provider: p.id/);
  assert.doesNotMatch(page.webview.html,/id="detect"/);
  assert.match(page.webview.html,/One button for all of VERTEX/);
  assert.match(page.webview.html,/id: "check-status-" \+ p.id/);
});
test("the settings host scans only the requested provider and rejects global scans", async () => {
  let handler;
  const asked = [];
  const vscode = { ViewColumn: { Active: 1 }, workspace: { getConfiguration: () => ({ get: (_,fallback) => fallback }) },
    window: { createWebviewPanel: () => ({ webview: { postMessage() {}, onDidReceiveMessage(fn) { handler=fn; } }, onDidDispose() {} }) } };
  require("../model-config").open(vscode, async id => { asked.push(id); return []; }, () => "", () => {}, {});
  await handler({action:"detect"});
  await handler({action:"detect",provider:"unknown"});
  assert.deepEqual(asked,[]);
  await handler({action:"detect",provider:"copilot"});
  assert.deepEqual(asked,["copilot"]);
});
test("checking shows progress next to the provider, and finishes with its result there", () => {
  let panel, onMessage;
  const vscode = { ViewColumn: { Active: 1 }, workspace: { getConfiguration: () => ({ get: (_,fallback) => fallback }) },
    window: { createWebviewPanel: () => (panel = { webview: { postMessage() {}, onDidReceiveMessage() {} }, onDidDispose() {} }) } };
  require("../model-config").open(vscode, async () => [], () => "", () => {}, {});
  const ids = new Map(), nodes = [], messages = [];
  class Element {
    constructor() { this.children=[]; this.listeners={}; nodes.push(this); }
    set id(id) { this._id=id; ids.set(id,this); }
    get id() { return this._id; }
    set innerHTML(value) { this.children=[]; }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name,value) { this[name]=value; }
    addEventListener(event,fn) { this.listeners[event]=fn; }
  }
  for(const id of ["tree","save","stop-detection","choose-log-folder","log-settings","said"]) { const node=new Element(); node.id=id; }
  const document = { getElementById: id => ids.get(id), createElement: () => new Element(), createTextNode: text => ({textContent:text}) };
  require("node:vm").runInNewContext(panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1], {
    document, acquireVsCodeApi: () => ({postMessage: message => messages.push(message)}),
    window: {addEventListener: (_,fn) => {onMessage=fn;}}
  });
  nodes.find(n => n.textContent === "Check models").listeners.click();
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{action:"detect",provider:"claude"});
  assert.equal(ids.get("check-status-claude").textContent,"Reading model list…");
  onMessage({data:{detectionProgress:{provider:"claude",model:"Sonnet"}}});
  assert.equal(ids.get("check-status-claude").textContent,"Checking Sonnet…");
  onMessage({data:{detection:{results:[{provider:"claude",rows:[{id:"sonnet",label:"Sonnet",on:true}]}],cancelled:false}}});
  assert.equal(ids.get("check-status-claude").textContent,"1 / 1 working");
  assert.equal(ids.get("save").disabled,false);
});
