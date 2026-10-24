"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const analysis = require('../frontend-analysis');

// A program whose local class and form live in includes, as Z_INCL_TEST in debugger_tests.
const files = {
  ZP: 'REPORT zp.\nINCLUDE zp_top.\nINCLUDE zp_c01.\nSTART-OF-SELECTION.\n  lcl=>main( ).',
  ZP_TOP: 'CLASS lcl DEFINITION.\n  PUBLIC SECTION.\n    CLASS-METHODS: main, add IMPORTING i TYPE i.\nENDCLASS.\nDATA gv TYPE i.',
  ZP_C01: 'CLASS lcl IMPLEMENTATION.\n  METHOD main.\n    add( 1 ).\n    PERFORM show.\n  ENDMETHOD.\n  METHOD add.\n  ENDMETHOD.\nENDCLASS.\nFORM show.\nENDFORM.'
};
const api = { local: true, analysisReader: () => async ({ object_name }) => {
  const source = files[object_name.toUpperCase()];
  if (source == null) throw new Error(object_name + ' was not found');
  return { object_name, object_type: 'PROG', source_url: 'file:///' + object_name, source, includes: [] };
} };
const ask = path => analysis.request(api, '/sap/bc/adt/vertex/' + path, () => {}, () => false);

test('Calls reads the includes: the local class and the form resolve and open in their include', async () => {
  const result = await ask('flow/ZP?type=PROG&mode=calls&all=X&depth=4');
  assert.match(result.mermaid, /LCL->MAIN/);
  assert.match(result.mermaid, /LCL->ADD/);
  assert.match(result.mermaid, /FORM SHOW/);
  assert.doesNotMatch(result.mermaid, /unresolved/);
  assert.deepEqual(result.places['LCL->ADD'], { name: 'ZP_C01', type: 'PROG', line: 6 });
});

test('Metrics: an include of declarations has no event, and a unit in an include opens there', async () => {
  const result = await ask('metrics/ZP?type=PROG');
  assert.deepEqual(result.units.map(u => u.unit_name), ['START-OF-SELECTION', 'LCL=>MAIN', 'LCL=>ADD', 'SHOW']);
  assert.deepEqual(result.units.find(u => u.unit_name === 'SHOW').writtenIn, { name: 'ZP_C01', type: 'PROG', line: 9 });
});
