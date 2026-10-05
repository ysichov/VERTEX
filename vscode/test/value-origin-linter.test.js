"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createParser } = require('../value-origin-linter');
const { analyze } = require('../value-origin');

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
