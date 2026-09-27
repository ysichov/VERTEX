"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyze, statements, mermaid } = require('../value-origin');
function graph(text, variable, line) { return analyze([{ id: 'demo', text }], { source: 'demo', variable, line }); }
test('multiline statements retain source lines and ignore comments/literal periods', () => {
  const s = statements("* comment\nx = 'a.b'. \" comment\ny =\n x * 1.2.");
  assert.equal(s.length, 2); assert.equal(s[1].line, 3); assert.equal(s[1].end, 4);
});
test('overwrites and self updates use previous definitions', () => {
  const g = graph('x = 2.\nx = x * 3.\ny = x + 1.\nWRITE y.', 'y', 4);
  assert(g.nodes.some(n => n.text === 'x = 2.'));
  assert(g.nodes.some(n => n.text === 'x = x * 3.'));
  const reset = graph('x = 2.\nx = 7.\nWRITE x.', 'x', 3);
  assert(!reset.nodes.some(n => n.text === 'x = 2.'));
});
test('conditional definitions retain baseline as a possible origin', () => {
  const g = graph('x = 2.\nIF flag = 1.\nx = 7.\nENDIF.\nWRITE x.', 'x', 5);
  assert(g.nodes.some(n => n.text === 'x = 2.'));
  assert(g.edges.some(e => e.label.includes('possible')));
});
test('static returning call binds actual expression to formal', () => {
  const g = graph('CLASS price DEFINITION.\nMETHODS calc IMPORTING iv_price TYPE i RETURNING VALUE(rv) TYPE i.\nENDCLASS.\nCLASS price IMPLEMENTATION.\nMETHOD calc.\nrv = iv_price * 2.\nENDMETHOD.\nENDCLASS.\np_price = 15.\nresult = price=>calc( iv_price = p_price ).\nWRITE result.', 'result', 11);
  assert(g.nodes.some(n => n.kind === 'parameter' && n.text === 'p_price → IV_PRICE'));
  assert(g.nodes.some(n => n.text === 'p_price = 15.'));
});
test('SQL includes statement, database and host-variable dependency', () => {
  const g = graph("key = 'CN'.\nSELECT SINGLE rate FROM zrates WHERE country = @key INTO @price.\nWRITE price.", 'price', 3);
  assert(g.nodes.some(n => n.kind === 'database' && n.text.includes('zrates')));
  assert(g.nodes.some(n => n.text === "key = 'CN'."));
});
test('dynamic dispatch is an explicit analysis boundary', () => {
  const g = graph('result = obj->calc( iv_price = price ).\nWRITE result.', 'result', 2);
  assert(g.nodes.some(n => n.kind === 'unknown' && n.text.includes('Unresolved call')));
  assert(mermaid(g).startsWith('flowchart BT'));
});

test('demo traces the returned amount through factories, CHANGING, all modifier candidates and SQL', () => {
  const sources = require('./fixtures/value-origin-demo.json');
  const g = analyze(sources, { source: 'zvertex_debug_lab.prog.abap', line: 16, variable: 'ls_result-amount' });
  assert.equal(g.truncated, false);
  assert(!g.nodes.some(n => n.kind === 'unknown' && n.text.includes('LS_RESULT-AMOUNT')));
  assert(g.nodes.some(n => n.text === 'rs_result = ls_context.'));
  assert(g.calls.some(c => c.callees.includes('ZCL_CALC_FACADE->RUN')));
  assert(g.calls.some(c => c.callees.includes('ZCL_PRICING_FACTORY->CREATE')));
  const modifiers = g.calls.find(c => c.method === 'APPLY');
  assert.equal(modifiers.callees.length, 5);
  assert.equal(modifiers.possible, true);
  for (const name of ['customs', 'discount', 'fuel', 'hazard', 'tax']) assert(g.nodes.some(n => n.kind === 'calculation' && n.source === 'zcl_mod_' + name + '.clas.abap'));
  assert(g.nodes.some(n => n.kind === 'database' && n.text.includes('zlog_pipeline')));
  assert(g.nodes.some(n => n.kind === 'select' && n.text.includes('ORDER BY step_no')));
  assert(g.nodes.some(n => n.kind === 'loop'));
  assert(!g.calls.some(c => ['DECFLOAT34', 'CHAR12'].includes(c.method)));
  assert(g.nodes.some(n => n.kind === 'literal' && n.text.includes('1200')));
});

test('field copies preserve suffixes and multiple assignments on one line preserve order', () => {
  const g = graph('a-price = 2. a-tax = a-price * 3.\nb = a.\nWRITE b-tax.', 'b-tax', 3);
  assert(g.nodes.some(n => n.text === 'a-price = 2.'));
  assert(g.nodes.some(n => n.text === 'a-tax = a-price * 3.'));
  assert(!g.nodes.some(n => n.kind === 'unknown'));
  const selected = graph('a-price = 2.\na-tax = 99.\nb = a.\nWRITE b-price.', 'b-price', 4);
  assert(!selected.nodes.some(n => n.text.includes('99')));
});

test('loading closure reads unopened references once, reports failures and honors cancellation', async () => {
  const { collectSources } = require('../value-origin');
  const seen = [];
  const loaded = await collectSources([{ id: 'r', name: 'R', text: 'x = NEW zclass( ). y = NEW zclass( ).' }], async (name, type) => {
    seen.push([name, type]); if (name === 'ZMISSING') throw Error('missing');
    return { id: name, name, text: 'CLASS zclass DEFINITION. ENDCLASS. x = NEW zmissing( ).' };
  });
  assert.deepEqual(seen, [['ZCLASS', 'CLAS'], ['ZMISSING', 'CLAS']]);
  assert.equal(loaded.sources.length, 2); assert.equal(loaded.warnings.length, 1);
  await assert.rejects(collectSources([{ id: 'r', text: '' }], async () => {}, { cancelled: () => true }), /cancelled/);
});

test('dependency closure keeps standard ABAP classes outside the customer-code source limit', async () => {
  const { collectSources } = require('../value-origin');
  const seen = [];
  const loaded = await collectSources([{ id: 'r', name: 'ZROOT', text: 'a = NEW cl_abap_classdescr( ). b = NEW znext( ).' }], async name => {
    seen.push(name); return { id: name, name, text: '' };
  }, { maxSources: 2 });
  assert.deepEqual(seen, ['ZNEXT']);
  assert.deepEqual(loaded.skipped, ['CL_ABAP_CLASSDESCR']);
  assert.equal(loaded.warnings.length, 0);
});

test('ACE statement boundaries, composite tokens and authoritative call targets drive the slice', () => {
  const { sourcesFromAce, locateTarget } = require('../value-origin-ace');
  // Deliberately no periods: boundaries below come exclusively from ACE.
  const lines = ['x = 2 y = x * 3', 'obj->bump( CHANGING cv = y )', 'WRITE y'];
  const tok = (str, row, col) => ({ str, row, col });
  const payload = { schema_version: 1, includes: [{ include: 'ZREPORT', source: lines, statements: [
    { idx: 1, line: 1, tokens: [tok('X',1,0),tok('=',1,2),tok('2',1,4)] },
    { idx: 2, line: 1, tokens: [tok('Y',1,6),tok('=',1,8),tok('X',1,10),tok('*',1,12),tok('3',1,14)] },
    { idx: 3, line: 2, tokens: [tok('OBJ->BUMP(',2,0),tok('CHANGING',2,11),tok('CV',2,20),tok('=',2,23),tok('Y',2,25),tok(')',2,27)], calls: [{ class: 'ZKNOWN', name: 'BUMP', bindings: [{ outer: 'Y', inner: 'CV', dir: 'C' }] }] },
    { idx: 4, line: 3, tokens: [tok('WRITE',3,0),tok('Y',3,6)] }
  ] }], params: [], units: [] };
  const sources = sourcesFromAce(payload, { object_name: 'ZREPORT', object_type: 'PROG' }, 'ace');
  sources.push({ id: 'known', text: 'CLASS zknown DEFINITION. METHODS bump CHANGING cv TYPE i. ENDCLASS. CLASS zknown IMPLEMENTATION. METHOD bump. cv = cv + 4. ENDMETHOD. ENDCLASS.' });
  const target = locateTarget(sources, lines.join('\n'), 'ZREPORT', 3, 'Y', 6);
  const g = analyze(sources, target);
  assert(g.nodes.some(n => n.text === 'x = 2'));
  assert(g.nodes.some(n => n.text === 'y = x * 3'));
  assert(g.nodes.some(n => n.text === 'cv = cv + 4.'));
  assert(g.calls.some(c => c.callees.includes('ZKNOWN->BUMP')));
  assert.throws(() => sourcesFromAce({}, {}, ''), /ACE origin index/);
});

test('ACE parameters and method includes work without an assembled class declaration', () => {
  const { sourcesFromAce } = require('../value-origin-ace');
  const sources = sourcesFromAce({ schema_version: 1, includes: [{ include: 'ZCALC=========================CM001', source: ['METHOD run.', 'rs-amount = iv * 2.', 'ENDMETHOD.'], statements: [
    { idx: 1, line: 1, tokens: [{ str: 'METHOD', row: 1, col: 0 }, { str: 'RUN', row: 1, col: 7 }] },
    { idx: 2, line: 2, tokens: [{ str: 'RS-AMOUNT', row: 2, col: 0 }, { str: '=', row: 2, col: 10 }, { str: 'IV', row: 2, col: 12 }, { str: '*', row: 2, col: 15 }, { str: '2', row: 2, col: 17 }] },
    { idx: 3, line: 3, tokens: [{ str: 'ENDMETHOD', row: 3, col: 0 }] }
  ] }], params: [{ class: 'ZCALC', event: 'RUN', param: 'RS', type: 'R' }, { class: 'ZCALC', event: 'RUN', param: 'IV', type: 'I' }], units: [] }, { object_name: 'ZCALC', object_type: 'CLAS' }, 'ace');
  sources.unshift({ id: 'report', text: 'price = 7.\nresult = NEW zcalc( )->run( iv = price ).\nWRITE result-amount.' });
  const g = analyze(sources, { source: 'report', line: 3, variable: 'result-amount' });
  assert(g.nodes.some(n => n.text === 'price = 7.'));
  assert(g.nodes.some(n => n.source.includes('CM001') && n.text === 'rs-amount = iv * 2.'));
  assert(g.nodes.some(n => n.location === 'ZCALC->RUN'));
  assert(sources[1].aceStatements[1].tokens.some(t => t.kind === 'symbol' && t.value === '*'));
});

test('ACE RETURNING keeps a structure component through rs_result = ls_context', () => {
  const { sourcesFromAce } = require('../value-origin-ace');
  const t = (str, row, col) => ({ str, row, col });
  const facade = sourcesFromAce({ schema_version: 1, includes: [{ include: 'ZCL_CALC_FACADE===============CM002', source: [
    'METHOD run.', 'ls_context-amount = iv_price * 2.', 'rs_result = ls_context.', 'ENDMETHOD.'
  ], statements: [
    { idx: 1, line: 1, tokens: [t('METHOD',1,0),t('RUN',1,7)] },
    { idx: 2, line: 2, tokens: [t('LS_CONTEXT-AMOUNT',2,0),t('=',2,18),t('IV_PRICE',2,20),t('*',2,29),t('2',2,31)] },
    { idx: 3, line: 3, tokens: [t('RS_RESULT',3,0),t('=',3,10),t('LS_CONTEXT',3,12)] },
    { idx: 4, line: 4, tokens: [t('ENDMETHOD',4,0)] }
  ] }], params: [
    { class: 'ZCL_CALC_FACADE', event: 'RUN', param: 'RS_RESULT', type: 'R' },
    { class: 'ZCL_CALC_FACADE', event: 'RUN', param: 'IV_PRICE', type: 'I' }
  ], units: [{ include: 'ZCL_CALC_FACADE===============CM002', class: 'ZCL_CALC_FACADE', eventtype: 'METHOD', eventname: 'RUN', index: 1, end_idx: 4 }] }, { object_name: 'ZCL_CALC_FACADE', object_type: 'CLAS' }, 'ace');
  facade.unshift({ id: 'report', objectName: 'ZVERTEX_DEBUG_LAB', text: 'price = 15.\nls_result = NEW zcl_calc_facade( )->run( iv_price = price ).\nWRITE ls_result-amount.' });
  const g = analyze(facade, { source: 'report', line: 3, variable: 'ls_result-amount' });
  assert(g.nodes.some(n => n.text === 'rs_result = ls_context.'));
  assert(g.nodes.some(n => n.text === 'ls_context-amount = iv_price * 2.'));
  assert(g.nodes.some(n => n.text === 'price = 15.'));
  assert(g.nodes.some(n => n.location === 'ZCL_CALC_FACADE->RUN'));
  assert(g.nodes.some(n => n.kind === 'call' && n.text.includes('NEW zcl_calc_facade')));
});

test('view exposes a call path and navigable dependency tree, with escaped code', () => {
  const { html } = require('../value-origin-view');
  const g = graph("x = '<script>'.\nWRITE x.", 'x', 2);
  const page = html(g, 'test');
  assert(page.includes('Call path contributing'));
  assert(page.includes('class="children"'));
  assert(page.includes('data-node="n0"'));
  assert(page.includes('&lt;script&gt;'));
  assert(!page.includes("x = '<script>'"));
});
