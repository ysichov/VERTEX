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

test("task logo animation is disabled only by reduced-motion rules",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","sidebar.js"),"utf8");
 assert.match(source,/#messages \.vertex\.task\.working::before \{ animation: vertex-task-turn 6s linear infinite;/);
 assert.doesNotMatch(source,/^#messages \.vertex\.task\.working::before \{ animation: none;/m);
 assert.match(source,/body\.vscode-reduce-motion #messages \.vertex\.task\.working::before \{ animation: none;/);
});

test('web citations create only HTTP links through host openExternal',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','sidebar.js'),'utf8'),sandbox={module:{exports:{}},require,__dirname:path.join(__dirname,'..')};
 vm.runInNewContext(source+'\nmodule.exports.render=html;',sandbox);const html=sandbox.module.exports.render('n');const script=html.match(/<script nonce="n">([\s\S]*?)<\/script>/)[1];const start=script.indexOf('function inline('),end=script.indexOf('\n}\n',start)+2;
 const children=[],posted=[];const context={document:{createElement:tag=>({tag,addEventListener(name,fn){this.click=fn;}}),createTextNode:text=>({text})},api:{postMessage:m=>posted.push(m)}};vm.runInNewContext(script.slice(start,end),context);
 context.inline('[Source](https://example.com) [bad](javascript:alert)',{appendChild:n=>children.push(n)});const link=children.find(n=>n.tag==='a');assert.equal(link.href,'https://example.com');assert.equal(children.filter(n=>n.tag==='a').length,1);link.click({preventDefault(){}});assert.equal(posted[0].action,'openWebLink');
});
