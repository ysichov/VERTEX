const { test } = require('node:test');
const assert = require('node:assert/strict');
const { html } = require('../value-origin-view');

test('formula follows a component through a structure transfer and keeps SQL only for selected fields', () => {
  const nodes = [
    { id: 'result', kind: 'value', text: 'RESULT-AMOUNT' },
    { id: 'transfer', kind: 'calculation', text: 'result = context.' },
    { id: 'context', kind: 'value', text: 'CONTEXT' },
    { id: 'load', kind: 'select', text: 'SELECT weight FROM shipments INTO CORRESPONDING FIELDS OF @context.' },
    { id: 'calc', kind: 'calculation', text: 'context-amount = context-weight * 2.' },
    { id: 'weight', kind: 'value', text: 'CONTEXT-WEIGHT' }
  ].map(n => ({ source: 'demo', line: 1, ...n }));
  const edges = [
    ['transfer', 'result'], ['context', 'transfer'], ['load', 'context'],
    ['calc', 'context'], ['weight', 'calc'], ['load', 'weight']
  ].map(([from, to]) => ({ from, to, label: 'operand' }));
  const page = html({ nodes, edges, root: 'result', selectedVariable: 'RESULT-AMOUNT', codeFlow: { rows: [], sites: [] } }, 'test');
  const formula = page.split('Formula derivation — click a branch to expand its input formulas</p>')[1]
    .split('</template>')[0];
  const plain = formula.replace(/<[^>]*>/g, ' ');
  assert(plain.indexOf('context-amount') < plain.indexOf('SELECT'));
  assert.equal((plain.match(/SELECT\s+weight/g) || []).length, 1);
});
