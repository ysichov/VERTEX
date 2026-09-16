"use strict";
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { reviewHtml } = require('../code-review');
test('review escapes source and metadata, uses nonce CSP and emits valid script', () => {
  const hostile = '</script><img src=x onerror="alert(1)">';
  const html = reviewHtml([{ beforeFrom: 0, beforeTo: 1, afterFrom: 0, afterTo: 1,
    before: ['REPORT demo.'], after: [hostile] }], { before: 'REPORT demo.', after: hostile,
    objectName: hostile, objectType: 'PROG', system: hostile });
  assert.equal(html.includes(hostile), false);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /&lt;img/);
  assert.equal(html.includes('Add Comment'), false);
  assert.equal(html.includes('<textarea'), false);
  const scripts = [...html.matchAll(/<script nonce="([a-f0-9]+)">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][2]));
});
test('both editor actions are scoped to SAP files', () => {
  const { contributes } = require('../package.json');
  for (const id of ['vertex.saveAndActivate', 'vertex.reviewCodeChanges']) {
    assert.ok(contributes.commands.some(c => c.command === id));
    assert.ok(contributes.menus['editor/context'].some(c => c.command === id && c.when === 'resourceScheme == vertex-sap'));
  }
});
