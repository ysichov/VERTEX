// VERTEX Smart Debugger is one page with a host per editor. What the page asks of a host - its sde* functions and its
// debug("...") commands - is compared here with what each host gives, so a feature added to one host is not missing
// from the other unnoticed (Where used was VS Code's only until it was looked for). A known gap is listed with its
// reason; closing one fails the test as well, so the lists stay true.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const names = (text, pattern) => new Set([...text.matchAll(pattern)].map(m => m[1]));

const page = read('vscode/pages/visual-debug.html');
const pageOwn = names(page, /(?:window\.|function\s+)(sde[A-Z]\w*)\s*(?:=|\()/g);
const pageNeeds = [...names(page, /\b(sde[A-Z]\w*)/g)].filter(name => !pageOwn.has(name)).sort();
const javaViews = ['DebugMonitorView', 'ToolsView', 'ChatView', 'PageView', 'AssistantBridge']
  .map(name => read('org.vertex.abap.ui/src/org/vertex/abap/ui/' + name + '.java')).join('\n');
const eclipseHost = read('eclipse/visual-debug-host.js');

const given = {
  vscode: names(read('vscode/tools-window.js'), /window\.(sde[A-Z]\w*)\s*=/g),
  eclipse: new Set([
    ...names(eclipseHost, /window\.(sde[A-Z]\w*)\s*=/g),
    ...names(read('org.vertex.abap.ui/resources/eclipse-frontend.js'), /window\.(sde[A-Z]\w*)\s*=/g),
    ...names(javaViews, /BrowserFunction\([^,]+,\s*"(sde\w+)"/g),
  ]),
};
const missing = host => pageNeeds.filter(name => !given[host].has(name));

test('VS Code gives every sde* function the page uses, but those only Eclipse needs', () => {
  // sdeQuietDebugViews hides Eclipse's own debugger windows; sdeRevealStop moves the editor, which VS Code does itself.
  assert.deepEqual(missing('vscode'), ['sdeQuietDebugViews', 'sdeRevealStop']);
});

test('Eclipse gives every sde* function the page uses', () => {
  assert.deepEqual(missing('eclipse'), []);
});

test('Eclipse answers every debug command the page sends, but the known gaps', () => {
  const sent = [...names(page, /\bdebug\(\s*"(\w+)"/g)].sort();
  const answered = new Set([
    ...names(read('org.vertex.abap.ui/src/org/vertex/abap/ui/VisualDebugSession.java'), /case "(\w+)"/g),
    'asset', 'run', 'opendump', // DebugMonitorView answers these itself
    ...names(eclipseHost, /name === '(\w+)'/g),
  ]);
  assert.deepEqual(sent.filter(name => !answered.has(name)), [
    'allBreakpoints', 'restore', 'saveRecord', 'selection', 'toProgram', // VS Code only for now
    'watchpointAdd', 'watchpointRemove',
    'localSnapshot', 'sapRecompile', 'sapTranspile', // the transpiler, not offered in Eclipse
  ].sort());
});

// The Tools window is one page in both hosts too. What it calls of its host unguarded - not behind `typeof` - each
// host must give: the request finder once called a function only VS Code's bridge had, and in Eclipse Find did nothing.
test('both hosts give every sde* function the Tools window calls unguarded', () => {
  const tools = read('org.vertex.abap.ui/resources/tools.html');
  const own = names(tools, /(?:window\.|function\s+)(sde[A-Z]\w*)\s*(?:=|\()/g);
  const guarded = names(tools, /typeof\s+(?:window\.)?(sde[A-Z]\w*)/g);
  const needs = [...names(tools, /(?<![.\w"])(sde[A-Z]\w*)\s*\(/g)].filter(name => !own.has(name) && !guarded.has(name)).sort();
  const bridge = read('vscode/tools-window.js');
  const vscode = names(bridge, /window\.(sde[A-Z]\w*)\s*=/g);
  const loop = bridge.match(/for\(const call of \[([^\]]*)\]/);
  assert.ok(loop, 'the VS Code bridge lists its calls in one loop');
  [...loop[1].matchAll(/"(\w+)"/g)].forEach(m => vscode.add('sde' + m[1][0].toUpperCase() + m[1].slice(1)));
  // The debug monitor panel is drawn only when the window is opened with initial.debugMonitor, which no host sets.
  const unused = ['sdeMonitorRefresh'];
  assert.deepEqual(needs.filter(name => !vscode.has(name)), unused);
  assert.deepEqual(needs.filter(name => !given.eclipse.has(name)), unused);
});
