'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { bound, LIST_ENTRIES, TEXT_BYTES } = require('../tool-result');

const entries = count => Array.from({ length: count }, (_, i) => ({ objectType: 'CLAS/OC', objectName: 'ZCL_TEST_' + i,
  description: 'Test class ' + i, packageName: 'Z_TEST', uri: '/sap/bc/adt/oo/classes/zcl_test_' + i }));
// A tool result arrives as the string an MCP server returned; bound keeps that JSON encoding.
const text = value => JSON.parse(bound(value));
const data = value => JSON.parse(text(value).split('\n[')[0]);

test('a list longer than the limit keeps its first entries and says how many were left out', () => {
  const out = text(JSON.stringify(entries(1087), null, 2));
  assert.equal(data(JSON.stringify(entries(1087), null, 2)).length, LIST_ENTRIES);
  assert.match(out, /\[showing 100 of 1087 entries; the rest was not sent\./);
  assert.match(out, /Narrow the request/);
});

test('a list carried as objects keeps the fields around it', () => {
  const result = { system: 'A4H', truncated: false, objects: entries(400) };
  const kept = data(JSON.stringify(result));
  assert.equal(kept.objects.length, LIST_ENTRIES);
  assert.equal(kept.system, 'A4H');
  assert.match(text(JSON.stringify(result)), /showing 100 of 400 entries/);
});

test('a result within the limits is passed through untouched', () => {
  assert.equal(text(JSON.stringify(entries(3))).length, JSON.stringify(entries(3)).length);
  assert.equal(bound('ok'), '"ok"');
  assert.equal(bound({ message: 'done' }), '{"message":"done"}');
});

test('a long result that is not a list is cut by bytes, on whole characters, with the count', () => {
  const out = text('б'.repeat(30000));
  const body = out.split('\n[')[0];
  assert.ok(Buffer.byteLength(body, 'utf8') <= TEXT_BYTES);
  assert.ok(!/�/.test(body), 'a multi-byte character must not be split in half');
  assert.match(out, /\[cut after \d+ of 30000 characters; the rest was not sent\./);
});

test('no result is ever replaced by a bare refusal: data and numbers always reach the model', () => {
  for (const value of [JSON.stringify(entries(5000), null, 2), 'x'.repeat(60000), JSON.stringify({ objects: entries(900) })]) {
    const out = bound(value);
    assert.doesNotMatch(out, /Result too large for chat/);
    assert.match(out, /of \d+ (entries|characters)/);
    assert.ok(out.length > 1000, 'the model still receives the result itself');
  }
});
