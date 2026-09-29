const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html } = require('../value-origin-view');
const { analyze } = require('../value-origin');
const page = () => html(analyze([{ id: 'demo', text: 'b = 2.\nc = 3.\na = b + c.\nWRITE a.' }],
  { source: 'demo', variable: 'a', line: 4 }), 'test');

test('Formula diagram contains the calculations and operand edges rendered by Formula tree', () => {
  const output = page();
  const graph = JSON.parse(output.match(/<script id="mermaid-data" type="application\/json">(.*?)<\/script>/s)[1]).formula;
  assert.equal(graph.nodes.length, 3);
  const root = graph.nodes.find(n => n.text === 'a = b + c.');
  assert(root);
  assert.deepEqual(graph.edges.filter(e => e.from === root.id).map(e => graph.nodes.find(n => n.id === e.to).text).sort(),
    ['b = 2.', 'c = 3.']);
  assert.deepEqual(graph.edges.filter(e => e.from === root.id).map(e => e.label).sort(), ['B', 'C']);
  assert.match(output, /edgeText=edge=>\{const target=drawing\.nodes\.find/);
});

test('Formula diagram uses only nodes visible in the expanded Formula tree', () => {
  const output = page();
  assert.match(output, /data-formula-node="n1"/);
  assert.match(output, /const formulaVisible=\(\)=>new Set/);
  assert.match(output, /shown=formulaMode\?formulaVisible\(\):visible\(\)/);
  assert.match(output, /details\.execution-node, details\.formula-node/);
  assert.match(output, /formulaMode\?\[\.\.\.document\.querySelectorAll\('details\.formula-node'\)\]/);
  assert.match(output, /\[data-formula-node="'\+id\+'"\]/);
});

test('Formula tree starts collapsed and the diagram defaults to left-right', () => {
  const output = page();
  assert.doesNotMatch(output, /class="formula-node" data-formula-node="n1" open/);
  assert.match(output, /data-mermaid-direction="LR" title="Caller left of callee">→ Left-right/);
  assert.match(output, /direction='LR'/);
  assert.match(output, /\},400\);\};/);
});

test('Formula diagram groups modifier implementations as runtime pipeline choices', () => {
  const { html } = require('../value-origin-view');
  const { analyze } = require('../value-origin');
  const output = html(analyze(require('./fixtures/value-origin-demo.json'),
    { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount' }), 'test');
  assert.match(output, /pipelineCandidate/);
  assert.match(output, /Runtime pipeline — configured modifier classes \(not parallel\)/);
  assert.match(output, /'sub'\+'graph pipeline_candidates/);
});

test('switching visualizers preserves Formula and displays its tree again', () => {
  const output = page();
  const source = output.slice(output.indexOf('const selectView='), output.indexOf("document.querySelectorAll('.bse-view-toggle [data-view]').forEach(button=>button.addEventListener"));
  const context = {
    document: { body: { classList: { contains: name => name === 'formula-mode' } }, querySelectorAll: () => [] },
    treePane: {}, formulaPane: {}, diagramPane: {}, rebuild: () => {}, requestAnimationFrame: () => {}
  };
  vm.runInNewContext(source + ";selectView('diagram');", context);
  assert.equal(context.diagramPane.hidden, false);
  assert.equal(context.formulaPane.hidden, true);
  vm.runInNewContext("selectView('tree');", context);
  assert.equal(context.formulaPane.hidden, false);
  assert.equal(context.treePane.hidden, true);
  assert.equal(context.diagramPane.hidden, true);
});
