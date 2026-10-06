"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('../value-origin-linter');
const { analyze } = require('../value-origin');
const { collectDemandSources } = require('../value-origin-demand');
const { formula } = require('../value-origin-formula');

test('local abaplint index expands declaration chains and preserves the selected value slice', async () => {
  const parser = createParser();
  try {
    const result = await parser.parse({ id: 'report', name: 'ZTEST', objectName: 'ZTEST', objectType: 'PROG',
      text: 'REPORT ztest.\nDATA: x TYPE i, y TYPE i.\nx = 2.\ny = x * 3.\nWRITE y.' });
    const graph = analyze([result.source], { source: 'report', line: 5, variable: 'Y' });
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(graph.flow.map(p => [p.changed, p.dependencies, p.included]), [['X', [], true], ['Y', ['X'], true]]);
    assert.ok(graph.nodes.some(n => n.text === '2'));
  } finally { await parser.close(); }
});

test('local method calls follow RETURNING across procedures without treating formal names as reads', async () => {
  const parser = createParser();
  try {
    const result = await parser.parse({ id: 'class', name: 'ZCL_TEST', objectName: 'ZCL_TEST', objectType: 'CLAS',
      text: ['CLASS zcl_test DEFINITION.', 'PUBLIC SECTION.',
        'CLASS-METHODS calc IMPORTING iv TYPE i RETURNING VALUE(rv) TYPE i.', 'CLASS-METHODS run.',
        'ENDCLASS.', 'CLASS zcl_test IMPLEMENTATION.', 'METHOD calc.', 'rv = iv * 2.', 'ENDMETHOD.',
        'METHOD run.', 'DATA(x) = calc( iv = 3 ).', 'WRITE x.', 'ENDMETHOD.', 'ENDCLASS.'].join('\n') });
    const graph = analyze([result.source], { source: 'class', line: 12, variable: 'X' });
    assert.deepEqual(result.warnings, []);
    assert.ok(graph.nodes.some(n => n.text === 'rv = iv * 2.'));
    assert.ok(graph.nodes.some(n => n.text === '3'));
    assert.deepEqual(graph.flow.find(p => p.changed === 'X').dependencies, []);
    assert.equal(graph.calls[0].targets[0].label, 'ZCL_TEST->CALC');
  } finally { await parser.close(); }
});

test('demand-loaded demo resolves interface implementations and produces Formula and Expression without class extras', async () => {
  const parser = createParser();
  try {
    const fixture = require('./fixtures/value-origin-demo.json');
    const indexed = new Map();
    for (const source of fixture) {
      const parsed = await parser.parse({ ...source, objectName: source.name, include: 'main',
        objectType: source.id.includes('.intf.') ? 'INTF' : source.id.includes('.clas.') ? 'CLAS' : 'PROG' });
      indexed.set(source.name, parsed.source);
    }
    const main = indexed.get('ZVERTEX_DEBUG_LAB');
    const target = { source: main.id, line: 16, variable: 'LS_RESULT-AMOUNT' };
    const requests = [], extra = [];
    const result = await collectDemandSources([main], target, async name => {
      requests.push(name);
      if (!indexed.has(name)) throw new Error('Fixture has no ' + name);
      return [indexed.get(name)];
    }, async (name, include) => { extra.push(name + '.' + include); return []; });
    const graph = analyze(result.sources, target), derivation = formula(graph);
    assert.ok(graph.nodes.some(n => n.location === 'ZCL_PRICE_ROAD->ZIF_PRICING_STRATEGY~CALCULATE_BASE'));
    assert.ok(derivation.nodes.length > 0);
    assert.ok(derivation.expression.text.includes('WEIGHT_KG'));
    assert.ok(!graph.nodes.some(n => n.kind === 'unknown' && n.text.includes('calculate_base')));
    assert.deepEqual(extra, []);
    assert.equal(new Set(requests).size, requests.length);
  } finally { await parser.close(); }
});

test('demand closure does not fetch dependencies of an unrelated method', async () => {
  const source = { id: 'main', name: 'ZCL_TEST', objectName: 'ZCL_TEST', objectType: 'CLAS', text: [
    'CLASS zcl_test DEFINITION.', 'PUBLIC SECTION.', 'METHODS run.', 'METHODS unused.', 'ENDCLASS.',
    'CLASS zcl_test IMPLEMENTATION.', 'METHOD run.', 'DATA(x) = 2.', 'WRITE x.', 'ENDMETHOD.',
    'METHOD unused.', 'DATA(y) = zcl_unused=>calculate( ).', 'ENDMETHOD.', 'ENDCLASS.'].join('\n') };
  const requests = [];
  await collectDemandSources([source], { source: 'main', line: 9, variable: 'X' },
    async name => { requests.push(name); return []; }, async () => []);
  assert.deepEqual(requests, []);
});

test('unresolved local class loads definitions and implementation only when reached', async () => {
  const parser = createParser();
  try {
    const texts = {
      main: 'CLASS zcl_root DEFINITION. PUBLIC SECTION. METHODS run. ENDCLASS. CLASS zcl_root IMPLEMENTATION. METHOD run. DATA(x) = lcl_helper=>calculate( ).\nWRITE x. ENDMETHOD. ENDCLASS.',
      definitions: 'CLASS lcl_helper DEFINITION. PUBLIC SECTION. CLASS-METHODS calculate RETURNING VALUE(rv) TYPE i. ENDCLASS.',
      implementations: 'CLASS lcl_helper IMPLEMENTATION. METHOD calculate. rv = 42. ENDMETHOD. ENDCLASS.'
    };
    const part = async include => (await parser.parse({ id: include, name: 'ZCL_ROOT', objectName: 'ZCL_ROOT',
      objectType: 'CLAS', include, text: texts[include] })).source;
    const target = { source: 'main', line: 2, variable: 'X' }, requested = [];
    const result = await collectDemandSources([await part('main')], target,
      async () => { throw new Error('A local class is not a global ADT object.'); },
      async (name, include) => { requested.push(include); return [await part(include)]; });
    assert.deepEqual(requested, ['definitions', 'implementations']);
    assert.deepEqual(result.warnings, []);
    assert.ok(analyze(result.sources, target).nodes.some(n => n.text === '42'));
  } finally { await parser.close(); }
});
