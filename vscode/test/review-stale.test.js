"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');

// A request naming one program, ZP: the versions ADT gives it, and the texts of those versions.
function fixture(feed, texts) {
  const versions = require('../versions-front');
  const kept = { partsOf: versions.partsOf, partOf: versions.partOf, sourceAt: versions.sourceAt };
  versions.partsOf = async () => [{ name: 'ZP', part_type: 'REPS', unit: '' }];
  versions.partOf = async () => ({ url: '/zp' });
  versions.sourceAt = async (api, uri) => texts[uri];
  const api = {
    query: async sql => {
      if (/FROM e070 WHERE trkorr/.test(sql)) return { values: [{ TRKORR: 'A4HK900001' }] };
      if (/FROM e071/.test(sql)) return { values: [{ PGMID: 'R3TR', OBJECT: 'PROG', OBJ_NAME: 'ZP' }] };
      return { values: [] };
    },
    revisions: async () => feed,
    revisionSource: async uri => texts[uri]
  };
  return { api, restore: () => Object.assign(versions, kept) };
}
const saved = (fresh, old, diff) => ({ OBJ_STATS: [{ OBJTYPE: 'REPS', OBJ_NAME: 'ZP', VERSNO_NEW: fresh, VERSNO_OLD: old }],
  DIFF_DATA: diff ? [{ KEY: { OBJTYPE: 'REPS', OBJNAME: 'ZP', VERSNO_O: old, VERSNO_N: fresh }, DIFF: diff }] : [] });
const { staleness } = require('../review-live');

test('a saved review whose versions are still the pair is up to date, and no source is read', async () => {
  const f = fixture([{ id: '00002', transport: 'A4HK900001', uri: 'v2' }, { id: '00001', transport: 'A4HK900000', uri: 'v1' }], {});
  try { assert.deepEqual(await staleness(f.api, 'A4HK900001', saved('00002', '00001')), { changed: [], unchecked: [] }); }
  finally { f.restore(); }
});

test('a newer version of the request makes the saved review stale', async () => {
  const f = fixture([{ id: '00003', transport: 'A4HK900001', uri: 'v3' }, { id: '00001', transport: 'A4HK900000', uri: 'v1' }], {});
  try {
    const result = await staleness(f.api, 'A4HK900001', saved('00002', '00001'));
    assert.equal(result.changed.length, 1);
    assert.match(result.changed[0].reason, /00003 now/);
  } finally { f.restore(); }
});

test('an active state that moved without a new version is found by its text', async () => {
  const feed = [{ id: '00000', transport: 'A4HK900001', uri: 'act' }, { id: '00001', transport: 'A4HK900000', uri: 'v1' }];
  const diff = [{ OP: '=', TEXT: 'REPORT zp.' }, { OP: '+', TEXT: 'WRITE 1.' }];
  const same = fixture(feed, { act: 'REPORT zp.\nWRITE 1.' });
  try { assert.deepEqual((await staleness(same.api, 'A4HK900001', saved('99998', '00001', diff))).changed, []); }
  finally { same.restore(); }
  const moved = fixture(feed, { act: 'REPORT zp.\nWRITE 2.' });
  try { assert.deepEqual((await staleness(moved.api, 'A4HK900001', saved('99998', '00001', diff))).changed.map(c => c.reason), ['its active state changed']); }
  finally { moved.restore(); }
});

test('a part the review holds that the request no longer changes makes it stale', async () => {
  const f = fixture([{ id: '00002', transport: 'A4HK900001', uri: 'v2' }, { id: '00001', transport: 'A4HK900000', uri: 'v1' }], {});
  try {
    const review = saved('00002', '00001');
    review.OBJ_STATS.push({ OBJTYPE: 'REPS', OBJ_NAME: 'ZGONE', VERSNO_NEW: '00004', VERSNO_OLD: '00003' });
    assert.deepEqual((await staleness(f.api, 'A4HK900001', review)).changed, [{ name: 'ZGONE', reason: 'no longer changed by the request' }]);
  } finally { f.restore(); }
});
