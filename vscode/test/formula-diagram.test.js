const { test } = require('node:test');
const assert = require('node:assert/strict');
// The flow's own markup - the view toggle and the diagram toolbar - belongs
// to the shared script, so that is where a test looks for it.
const flowView = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'org.vertex.abap.ui', 'resources', 'vertex-flow.js'), 'utf8');
const vm = require('node:vm');
const { html } = require('../value-origin-view');
const { analyze } = require('./origin-view-fixture');
const page = () => html(analyze([{ id: 'demo', text: 'b = 2.\nc = 3.\na = b + c.\nWRITE a.' }],
  { source: 'demo', variable: 'a', line: 4 }), 'test');

test('Formula diagram contains the calculations and operand edges rendered by Formula tree', () => {
  const output = page();
  const graph = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]).formula;
  assert.equal(graph.nodes.length, 4);
  const top = graph.nodes.find(n => n.id === 'formularoot');
  assert(top, 'the derivation has one top: the selected value');
  assert.equal(top.text, 'A');
  const root = graph.nodes.find(n => n.text === 'a = b + c.');
  assert(root);
  assert.deepEqual(graph.edges.filter(e => e.from === top.id).map(e => e.to), [root.id]);
  assert.deepEqual(graph.edges.filter(e => e.from === root.id).map(e => graph.nodes.find(n => n.id === e.to).text).sort(),
    ['b = 2.', 'c = 3.']);
  assert.deepEqual(graph.edges.filter(e => e.from === root.id).map(e => e.label).sort(), ['B', 'C']);
  assert.match(output, /edgeText=edge=>\{const target=drawing\.nodes\.find/);
});

test('Formula diagram uses only nodes visible in the expanded Formula tree', () => {
  const output = page();
  assert.match(output, /data-formula-node="n1"/);
  assert.match(output, /const formulaVisible=\(\)=>new Set/);
  assert.match(output, /shown=formulaMode\?formulaVisible\(\):\(flowMode\?flowVisible\(focusPath[^)]*\):visible\(\)\)/);
  assert.match(output, /details\.execution-node, details\.formula-node/);
  assert.match(output, /formulaMode\?\[\.\.\.document\.querySelectorAll\('details\.formula-node'\)\]/);
  assert.match(output, /\[data-formula-node="'\+id\+'"\]/);
});

test('Formula tree starts collapsed and the diagram defaults to left-right', () => {
  const output = page();
  assert.doesNotMatch(output, /class="formula-node" data-formula-node="n1" open/);
  assert.match(flowView, /data-mermaid-direction="LR" title="Caller left of callee">→ Left-right/);
  assert.match(output, /direction='LR'/);
  assert.match(output, /\},400\);\};/);
});

test('Formula keeps configuration out of the derivation and reduces a SELECT to source and fields', () => {
  const { html } = require('../value-origin-view');
  const { analyze } = require('./origin-view-fixture');
  const output = html(analyze(require('./fixtures/value-origin-demo.json'),
    { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount' }), 'test');
  assert.doesNotMatch(output, /pipelineCandidate/);
  assert.doesNotMatch(output, /Runtime pipeline/);
  assert.doesNotMatch(output, /pipeline_candidates/);
  const graph = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]).formula;
  const select = graph.nodes.find(node => /^SELECT/i.test(node.text));
  assert(select, 'the demo formula reaches a SELECT');
  assert.match(select.label, /^(?:[\w@-]+ = )?SELECT .* FROM \w+\.$/);
  assert(select.label.length < select.text.length);
});

test('switching visualizers preserves Formula and displays its tree again', () => {
  const output = page();
  const source = flowView.slice(flowView.indexOf('const selectView='), flowView.indexOf("document.querySelectorAll('[data-view-choice]').forEach(button=>button.addEventListener"));
  const context = {
    document: { body: { classList: { contains: name => name === 'formula-mode' } }, querySelectorAll: () => [] },
    treePane: {}, flowPane: {}, formulaPane: {}, diagramPane: {}, rebuild: () => {}, placeDepth: () => {}, requestAnimationFrame: () => {}
  };
  vm.runInNewContext(source + ";selectView('diagram');", context);
  assert.equal(context.diagramPane.hidden, false);
  assert.equal(context.formulaPane.hidden, true);
  vm.runInNewContext("selectView('tree');", context);
  assert.equal(context.formulaPane.hidden, false);
  assert.equal(context.treePane.hidden, true);
  assert.equal(context.diagramPane.hidden, true);
});

test('Formula is bounded by the breakpoint pair, as every other Type is', () => {
  const sources = [{ id: 'demo', text: 'b = 2.\nc = 3.\na = b + c.\nWRITE a.' }];
  const bounded = html(analyze(sources, { source: 'demo', variable: 'a', line: 4, flowBounds: { source: 'demo', from: 2, to: 4 } }), 'test');
  const graph = JSON.parse(bounded.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]).formula;
  const texts = graph.nodes.map(node => node.text);
  assert(texts.includes('c = 3.'), 'a definition inside the pair stays');
  assert(!texts.includes('b = 2.'), 'a definition of the entry program above the pair is left out');
});

test('every Type carries the call-stack depth of its procedure, and the page can bound it', () => {
  const { html } = require('../value-origin-view');
  const { analyze } = require('./origin-view-fixture');
  const output = html(analyze(require('./fixtures/value-origin-demo.json'),
    { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount' }), 'test');
  const slider = output.match(/id="bse-depth"[^>]*/)[0];
  assert.match(slider, /min="0"/);
  const graph = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]);
  // The maxima are stated in the graph the shared flow script is given, which
  // is where the slider reads them from.
  assert.equal(graph.maxStack, Math.max(...graph.bseFlow.nodes.map(node=>node.stack)), 'slider maximum follows the complete call tree');
  assert.ok(graph.maxStack>=3,'program root 0, event 1, facade 2 and its calls 3');
  assert(graph.formula.nodes.every(node => Number.isInteger(node.stack)));
  assert.match(output, /withinDepth=node=>depthOf\(node\)<=depthLimit/);
  assert.match(output, /element\.hidden=Number\(element\.dataset\[attribute\]\)>depthLimit/);
});

test('in Formula the control bounds the derivation, not the call stack', () => {
  const { html } = require('../value-origin-view');
  const { analyze } = require('./origin-view-fixture');
  const output = html(analyze(require('./fixtures/value-origin-demo.json'),
    { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount' }), 'test');
  // Formula nests by data: its axis is the number of derivation steps from the
  // value that was asked about, and it runs deeper than the call stack does.
  const data = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert(data.maxLevel > 0 && data.maxStack > 0);
  assert.match(output, /depthMax=\(\)=>formulaAxis\(\)\?graph\.maxLevel:graph\.maxStack/);
  assert.match(output, /depthOf=node=>\(formulaAxis\(\)\?node\.level:node\.stack\)\|\|0/);
  assert.match(output, /formulaAxis\(\)\?'level':'stack'/);
  assert.match(output, /depthLabel\.textContent=formulaAxis\(\)\?'Depth: derivation':'Depth: calls'/);
  assert.match(output, /data-level="3"/);
});

test('FLOW carries statements that run, not declarations', () => {
  const { analyze } = require('./origin-view-fixture');
  const graph = analyze(require('./fixtures/value-origin-demo.json'),
    { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount' });
  const program = (graph.fullFlow || []).filter(point => point.source === 'zvertex_debug_lab.prog.abap');
  const first = point => String(point.text).trim().split(/[\s(:.]/)[0].toUpperCase();
  assert(!program.some(point => ['REPORT', 'TYPE-POOL', 'TYPES', 'PARAMETERS', 'CONSTANTS', 'TABLES'].includes(first(point))),
    'a declaration does nothing and has no place in a flow');
  // An inline DATA(x) = ... declares, but it is an assignment and it runs.
  assert(program.some(point => /^DATA\(lv_scenario\) =/.test(point.text)));
  assert(program.some(point => /^WRITE:/.test(point.text)));
  // The event names the level the statements run in; it is not a step inside
  // itself, and a program with no event at all still runs as START-OF-SELECTION.
  assert(program.every(point => point.scope === 'ZVERTEX_DEBUG_LAB→START-OF-SELECTION'));
  assert(!program.some(point => /^START-OF-SELECTION\s*\.$/i.test(String(point.text).trim())));
});

test('BSE scope is what BSE found and the path that led to it', () => {
  const { html } = require('../value-origin-view');
  const { analyze } = require('./origin-view-fixture');
  const output = html(analyze(require('./fixtures/value-origin-demo.json'),
    // Bounded by breakpoints over the whole program, so the flow follows every call - the rule tested here is the tree's.
    { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount', flowBounds: { source: 'zvertex_debug_lab.prog.abap', from: 1, to: 100000 } }), 'test');
  const drawn = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]);
  const flow = require('../../org.vertex.abap.ui/resources/vertex-flow-graph.js').build(drawn.flowReadings.input, 'steps').bseFlow;
  const when = flow.nodes.filter(node => /^WHEN\b/i.test(node.text || ''));
  assert(when.length > 1, 'the demo has a CASE with several WHEN branches');
  assert(when.every(node => node.branch === true), 'a branch is a node on the path like any other');
  assert(flow.nodes.some(node => /^CASE\b/i.test(node.text || '') && node.branch === false));
  // The ancestor closure is the whole rule: nothing is kept for being beside
  // something kept, and nothing is kept for being under it.
  assert.doesNotMatch(output, /item\.branch&&keep\.has\(item\.id\)/);
  assert.doesNotMatch(output, /node\.branch&&keep\.has\(edge\.from\)/);
  assert.match(output, /if\(keep\.has\(edge\.to\)&&!keep\.has\(edge\.from\)\)\{keep\.add\(edge\.from\)/);
});


test('FLOW shows what a call passes, so nothing is lost with Code gone', () => {
  const { html } = require('../value-origin-view');
  const { analyze } = require('./origin-view-fixture');
  const output = html(analyze(require('./fixtures/value-origin-demo.json'),
    { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount' }), 'test');
  const flow = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]).bseFlow;
  const passed = flow.nodes.filter(node => node.type === 'parameter');
  assert(passed.length > 1, 'the demo passes values into the facade and on into the modifiers');
  assert(passed.some(node => /lv_scenario → IV_SCENARIO/.test(node.text)));
  // The node sits on the call edge: the caller's statement reaches it, and it
  // reaches the procedure that was called.
  const into = new Set(flow.edges.filter(edge => edge.from === passed[0].id).map(edge => edge.to));
  assert(into.size > 0);
  assert(flow.edges.some(edge => edge.to === passed[0].id));
});

test('the toolbar reads view, then Type, then what is shown', () => {
  const output = page();
  // The view toggle (Tree / Diagram) comes first, before the Type toggle, and
  // the controls that say what is shown are appended after them.
  const moved = output.indexOf("modeToggle.prepend(document.querySelector('[data-view-toggle]'))");
  const scope = output.indexOf('modeToggle.append(flowFilter)');
  const expand = output.indexOf('modeToggle.append(expandToggle)');
  const depth = output.indexOf("const depthToggle=expandToggle.querySelector('[data-depth-part]')");
  assert(moved > 0);
  assert(moved < scope && scope < expand && expand < depth);
});
