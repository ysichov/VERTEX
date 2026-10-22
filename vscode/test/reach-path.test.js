"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSource } = require('../value-origin-linter');
const { reachPath } = require('../reach-path');

const text = `REPORT z.
FORM f USING p q.
  CHECK p > 0.
  IF p = 1.
    RETURN.
  ELSEIF p = 2.
    IF q = 1.
      EXIT.
    ENDIF.
  ENDIF.
  LOOP AT t INTO w.
    CHECK w-a = 1.
    CASE w-b.
      WHEN 1.
        CONTINUE.
      WHEN 2.
        IF q > p AND
           q < 9.
          WRITE 'target'.
        ELSE.
          WRITE 'other'.
        ENDIF.
    ENDCASE.
  ENDLOOP.
  WRITE 'after'.
  RETURN.
  WRITE 'dead'.
ENDFORM.
WRITE 'outside'.`;
const statements = parseSource({ id: 'z', name: 'z', objectName: 'Z', objectType: 'PROG', text }).source.aceStatements;
const at = line => text.split('\n').slice(0, line - 1).join('\n').length + 3;
// A cursor on a continuation line of IF q > p AND ... belongs to that IF statement.
test('a cursor on a continuation line takes that statement', () => {
  assert.equal(reachPath(statements, at(18), 18).target.line, 17);
});
// Closed blocks come as groups that read as the code does; flattened here, each row with its depth.
const flat = (items, depth) => items.flatMap(item => item.verdict === 'group' ? flat(item.children.map(c => ({ ...c, depth: depth ?? item.depth })), depth)
  : [{ ...item, depth: (item.depth ?? depth) + (item.indent || 0) }, ...flat((item.children || []).map(c => c), (item.depth ?? depth) + 1)]);
const brief = items => flat(items).map(item => item.depth + ':' + item.line + ' ' + item.verdict);

test('a line nested in branches and a loop: enclosing branches, avoided exits and CHECKs, as written', () => {
  const result = reachPath(statements, at(19), 19);
  assert.equal(result.unreachable, null);
  assert.deepEqual(brief(result.path), ['0:3 true', '0:4 avoid', '0:6 when', '1:7 avoid', '1:9 end', '0:10 end', '0:11 entered', '1:12 true',
    '1:13 case', '2:14 false', '2:16 true', '3:17 true', '4:19 target', '3:22 end', '1:23 end', '0:24 end']);
  assert.equal(flat(result.path).find(item => item.line === 17).text, 'IF q > p AND q < 9.');
  assert.deepEqual(flat(result.path).find(item => item.line === 4).reason, { line: 5, endLine: 5, text: 'RETURN.' });
});

test('a line under ELSE lists the IF before it as false', () => {
  assert.deepEqual(brief(reachPath(statements, at(21), 21).path).slice(-7, -3), ['2:16 true', '3:17 false', '3:20 else', '4:21 target']);
});

test('what only leaves a pass of a loop does not condition a line after the loop', () => {
  assert.deepEqual(brief(reachPath(statements, at(25), 25).path), ['0:3 true', '0:4 avoid', '0:6 when', '1:7 avoid', '1:9 end', '0:10 end', '0:25 target']);
});

test('a line after an unconditional RETURN is reported as not reachable', () => {
  assert.equal(reachPath(statements, at(27), 27).unreachable.line, 26);
});

test('a line outside a METHOD or FORM fails loudly', () => {
  assert.throws(() => reachPath(statements, at(29), 29), /METHOD or FORM/);
});

test('reachLines gives each drawn line its path lines for the Logic view', () => {
  const map = require('../reach-path').reachLines(statements, [19, 25]);
  assert.deepEqual(map[19], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 22, 23, 24]);
  assert.deepEqual(map[25], [2, 3, 4, 5, 6, 7, 8, 9, 10, 25]);
});
