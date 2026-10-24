"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSource } = require('../value-origin-linter');
const { callsIn } = require('../value-origin-model');

// A program's Calls diagram drew offset/length access and inline FIELD-SYMBOL( ) declarations as unresolved calls.
test('offset/length access and inline declarations are no calls; functional calls are', () => {
  const text = ['REPORT z.', 'START-OF-SELECTION.', '  lv = s370(4).', '  WRITE gt_name(10).', '  lv = gt_tab[ 1 ]-low(2).',
    '  LOOP AT gt_name ASSIGNING FIELD-SYMBOL(<fs>).', '  ENDLOOP.', '  DATA(n) = lines( gt_name ).', '  lo->run( ).',
    '  zcl_x=>go( a = 1 ).', '  DATA(o) = NEW zcl_y( ).'].join('\n');
  const statements = parseSource({ id: 'z', name: 'Z', objectName: 'Z', objectType: 'PROG', text }).source.aceStatements;
  const methods = statements.flatMap(s => callsIn(s.tokens).map(c => c.method));
  assert.deepEqual(methods, ['LINES', 'RUN', 'GO', 'CONSTRUCTOR']);
});

test('PERFORM f(prog) names the other program as IN PROGRAM does', () => {
  const { buildIndex } = require('../value-origin-model');
  const text = ['REPORT z.', 'START-OF-SELECTION.', '  PERFORM f1(zother) TABLES gt USING lv.', '  PERFORM f2 IN PROGRAM ztwo.', '  PERFORM f3.', 'FORM f3.', 'ENDFORM.'].join('\n');
  const index = buildIndex([parseSource({ id: 'z', name: 'Z', objectName: 'Z', objectType: 'PROG', text }).source]);
  const graph = require('../call-graph').create(index);
  const owners = index.procedures.flatMap(p => (p.body || []).flatMap(s => graph.calls(p, s).map(r => r.call.method + ':' + r.call.owner)));
  assert.deepEqual(owners, ['F1:ZOTHER', 'F2:ZTWO', 'F3:']);
});

test('built-in functions are no calls unless the routine has a method of that name', () => {
  const { buildIndex } = require('../value-origin-model');
  const text = ['REPORT z.', 'CLASS lcl DEFINITION.', '  PUBLIC SECTION.', '    METHODS: run, lines RETURNING VALUE(r) TYPE i.', 'ENDCLASS.',
    'CLASS lcl IMPLEMENTATION.', '  METHOD run.', '    DATA(a) = lines( ).', '  ENDMETHOD.', '  METHOD lines.', '  ENDMETHOD.', 'ENDCLASS.',
    'START-OF-SELECTION.', '  DATA(n) = lines( gt ).', '  DATA(b) = xsdbool( n > 1 ).'].join('\n');
  const index = buildIndex([parseSource({ id: 'z', name: 'Z', objectName: 'Z', objectType: 'PROG', text }).source]);
  const graph = require('../call-graph').create(index);
  const calls = index.procedures.flatMap(p => (p.body || []).flatMap(s => graph.calls(p, s).map(r => p.name + ':' + r.call.method + ':' + r.targets.length)));
  assert.deepEqual(calls, ['RUN:LINES:1']);
});

// A Calls diagram drew ZCL_MOD_CUSTOMS->IN: WHERE country IN ( @a, @b ) read as a method IN called with arguments.
test('IN ( ... ) of a WHERE is no call; a call has its parenthesis at its name', () => {
  const text = ['REPORT z.', 'START-OF-SELECTION.', '  SELECT tax FROM zgeo WHERE country IN ( @lv_a, @lv_b ) INTO @DATA(ls).',
    '  ENDSELECT.', '  lo->run( ).'].join('\n');
  const statements = parseSource({ id: 'z', name: 'Z', objectName: 'Z', objectType: 'PROG', text }).source.aceStatements;
  assert.deepEqual(statements.flatMap(s => callsIn(s.tokens).map(c => c.method)), ['RUN']);
});
