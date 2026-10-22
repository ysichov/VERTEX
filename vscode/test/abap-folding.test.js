"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSource } = require('../value-origin-linter');
const { foldingRanges } = require('../abap-folding');

const text = `REPORT z.
FORM f USING p.
  IF p = 1 AND
     p < 9.
    WRITE 1.
  ELSEIF p = 2.
    WRITE 2.
  ELSE.
    LOOP AT t INTO w.
      WRITE w.
    ENDLOOP.
  ENDIF.
  CASE p.
    WHEN 1.
      WRITE 1.
    WHEN OTHERS.
      WRITE 0.
  ENDCASE.
ENDFORM.`;
const ranges = source => foldingRanges(parseSource({ id: 'z', name: 'z', objectName: 'Z', objectType: 'PROG', text: source })
  .source.aceStatements).map(r => r.start + '-' + r.end).sort();

test('blocks fold to the line before their end, branches to the next branch; a split condition stays visible', () => {
  assert.deepEqual(ranges(text), ['13-17', '14-15', '16-17', '2-18', '4-11', '6-7', '8-11', '9-10'].sort());
});

test('unformatted code folds the same as formatted code', () => {
  assert.deepEqual(ranges(text.split('\n').map(line => line.trim()).join('\n')), ranges(text));
});

test('a call parameter named CLASS at the start of a line opens no block for the jumps', () => {
  const source = ['REPORT z.', 'FORM f.', '  LOOP AT t INTO w.', '    LOOP AT w-t INTO v.', '      x = y=>m(', '        class = v ).', '    ENDLOOP.', '  ENDLOOP.', 'ENDFORM.'].join('\n');
  const jumps = require('../abap-folding').blockJumps(parseSource({ id: 'z', name: 'z', objectName: 'Z', objectType: 'PROG', text: source }).source.aceStatements, false);
  assert.equal(jumps.get(8).line, 3);
  assert.equal(jumps.get(3).line, 8);
  assert.equal(jumps.get(7).line, 4);
});
