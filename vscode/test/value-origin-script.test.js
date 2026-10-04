"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { html } = require('../value-origin-view');
const { analyze } = require('../value-origin');
const { pathRows, siteRows } = require('../value-origin-points');

test('all executable scripts in the generated Value Origin page parse', () => {
  const graph = analyze([{ id: 'demo', text: 'x = 2.\nWRITE x.' }],
    { source: 'demo', variable: 'x', line: 2 });
  const sources = [{ id: 'demo', name: 'demo', objectName: 'DEMO', objectType: 'PROG' }];
  const page = html({ ...graph, codeFlow: { rows: pathRows(graph, sources), sites: siteRows(graph, sources) } }, 'test');
  let count = 0;
  for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (match[1].includes('application/json') || !match[2].trim()) continue;
    assert.doesNotThrow(() => new vm.Script(match[2]), 'inline script ' + (++count));
  }
  // Besides the page's own: the shared magnifier and flow view (carried inline when there is no address to load them
  // from) and the guard that says so when the flow view did not load.
  assert.equal(count, 5);
});
