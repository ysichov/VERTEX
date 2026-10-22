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
const brief = items => items.map(item => item.line + ' ' + item.verdict + (item.children ? '[' + brief(item.children) + ']' : ''));

test('a line nested in branches and a loop: enclosing branches, avoided exits and CHECKs, as written', () => {
  const result = reachPath(statements, at(19), 19);
  assert.equal(result.unreachable, null);
  assert.deepEqual(brief(result.path), ['3 true', '4 avoid', '6 when[7 avoid]', '11 entered', '12 true', '13 case', '14 false', '16 true', '17 true']);
  assert.equal(result.path.find(item => item.line === 17).text, 'IF q > p AND q < 9.');
  assert.deepEqual(result.path[1].reason, { line: 5, text: 'RETURN.' });
});

test('a line under ELSE lists the IF before it as false', () => {
  assert.deepEqual(brief(reachPath(statements, at(21), 21).path).slice(-3), ['16 true', '17 false', '20 else']);
});

test('what only leaves a pass of a loop does not condition a line after the loop', () => {
  assert.deepEqual(brief(reachPath(statements, at(25), 25).path), ['3 true', '4 avoid', '6 when[7 avoid]']);
});

test('a line after an unconditional RETURN is reported as not reachable', () => {
  assert.equal(reachPath(statements, at(27), 27).unreachable.line, 26);
});

test('a line outside a METHOD or FORM fails loudly', () => {
  assert.throws(() => reachPath(statements, at(29), 29), /METHOD or FORM/);
});
