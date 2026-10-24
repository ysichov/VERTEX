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

test('Path to line can number from the routine opening line, links still lead to the source line', () => {
  const { page } = require('../reach-path');
  const result = { procedure: { line: 10, text: 'METHOD m.' }, target: { line: 14 }, unreachable: null,
    path: [{ verdict: 'true', line: 12, endLine: 12 }] };
  const lines = Array.from({ length: 20 }, (_, i) => 'line' + (i + 1));
  const html = page(result, 'n', '', lines, true);
  assert.match(html, /data-line="14">5<\/a> in/);
  assert.match(html, /data-line="12">3<\/a>/);
  assert.match(page(result, 'n', '', lines), /data-line="14">14<\/a> in/);
});

test('value sources: each condition variable leads to its last write before the condition, one colour per variable', async () => {
  const { reachPath, valueSources, page } = require('../reach-path');
  const source = [
    'CLASS zcl_v DEFINITION PUBLIC.',
    '  PUBLIC SECTION.',
    '    METHODS m IMPORTING is_par TYPE zs_unknown.',
    'ENDCLASS.',
    'CLASS zcl_v IMPLEMENTATION.',
    '  METHOD m.',
    '    DATA lv_valid TYPE abap_bool.',
    '    lv_valid = abap_true.',
    '    CALL METHOD zcl_other=>check IMPORTING ev_enable = lv_valid.',
    '    SELECT SINGLE * FROM ztab INTO @DATA(ls_row).',
    '    DATA(lv_n) = 1.',
    '    IF lv_valid IS NOT INITIAL AND ls_row-a = lv_n.',
    '      IF is_par-infty = lv_n.',
    "        WRITE 'target'.",
    '      ENDIF.',
    '    ENDIF.',
    '  ENDMETHOD.',
    'ENDCLASS.'].join('\n');
  const parsed = parseSource({ id: 'v', name: 'v', objectName: 'ZCL_V', objectType: 'CLAS', text: source });
  const statements = (await parsed).aceStatements || (await parsed).source.aceStatements;
  const result = reachPath(statements, source.indexOf("WRITE"), 14);
  const found = valueSources(source, 'zcl_v.clas.abap', statements, result);
  const byName = name => found.variables.filter(v => v.name.toLowerCase() === name);
  assert.equal(byName('lv_valid')[0].source.line, 9);
  assert.equal(byName('ls_row')[0].source.line, 10);
  assert.equal(byName('lv_n')[0].source.line, 11);
  assert.equal(byName('is_par')[0].source, null);
  assert.equal(new Set(byName('lv_n').map(v => v.index)).size, 1);
  assert.notEqual(byName('lv_valid')[0].index, byName('lv_n')[0].index);
  const html = page(result, 'n', '', source.split('\n'), false, found, '.vertex-toggle{}');
  assert.match(html, /id="sources"/);
  assert.match(html, /Where the values come from/);
  assert.deepEqual(found.before[12].map(v => v.source.line).sort(), [10, 11, 9]);
  assert.deepEqual(found.before[13].map(v => v.name.toLowerCase()), ['lv_n']);
  assert.match(html, /<li class="feed"><a href="#" class="v v[0-9]" data-line="9">/);
  assert.ok(!found.variables.some(v => v.name.toLowerCase() === 'abap_true'));
});

test('the Path panel rebuilds for a mouse click on another line of its source, not for other selection changes', async () => {
  const { register } = require('../reach-path');
  const lines = text.split('\n'), listeners = [], commands = {};
  const document = { uri: { toString: () => 'file:///z.prog.abap' }, fileName: 'z.prog.abap', getText: () => text,
    offsetAt: p => lines.slice(0, p.line).join('\n').length + 1 + p.character };
  const panel = { title: '', webview: { cspSource: '', html: '', onDidReceiveMessage() {}, postMessage() {} }, onDidDispose() {}, dispose() {} };
  const vscode = {
    window: { activeTextEditor: { document, selection: { active: { line: 18, character: 4 } } },
      createWebviewPanel: () => panel, showErrorMessage() {}, showWarningMessage() {},
      onDidChangeTextEditorSelection: fn => { listeners.push(fn); return { dispose() {} }; } },
    workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
    commands: { registerCommand: (id, fn) => { commands[id] = fn; return {}; } },
    TextEditorSelectionChangeKind: { Mouse: 2, Keyboard: 1 }, ViewColumn: { Beside: 2 }
  };
  register(vscode, { subscriptions: [] });
  await commands['vertex.reachPath']();
  assert.equal(panel.title, 'Path to line 19');
  await listeners[0]({ textEditor: { document }, kind: 1, selections: [{ active: { line: 2, character: 2 } }] });
  assert.equal(panel.title, 'Path to line 19');
  await listeners[0]({ textEditor: { document }, kind: 2, selections: [{ active: { line: 3, character: 2 } }] });
  assert.equal(panel.title, 'Path to line 4');
});
