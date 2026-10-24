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
    'allBreakpoints', 'openRuns', 'restore', 'saveRecord', 'selection', 'toProgram', // VS Code only for now
    'watchpointAdd', 'watchpointRemove',
    'localSnapshot', 'sapRecompile', 'sapTranspile', // the transpiler, not offered in Eclipse
  ].sort());
});
