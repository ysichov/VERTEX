"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');

// A request that names a class deleted since: the review is built from what is left, the class is listed, not fatal.
test('a review built from ADT lists an object the system no longer has instead of failing on it', async () => {
  const versions = require('../versions-front');
  const partsOf = versions.partsOf;
  versions.partsOf = async (api, type, name) => { if (name === 'ZCL_GONE') throw new Error('Class/Interface ZCL_GONE does not exist'); return []; };
  try {
    const api = { query: async sql => {
      if (/FROM e070 WHERE trkorr/.test(sql)) return { values: [{ TRKORR: 'A4HK900001' }] };
      if (/FROM e070 WHERE strkorr/.test(sql)) return { values: [] };
      if (/FROM e071/.test(sql)) return { values: [{ PGMID: 'R3TR', OBJECT: 'CLAS', OBJ_NAME: 'ZCL_GONE' }, { PGMID: 'R3TR', OBJECT: 'PROG', OBJ_NAME: 'ZKEPT' }] };
      if (/FROM tadir/.test(sql)) return { values: [] };
      return { values: [] };
    } };
    const payload = await require('../review-live').build(api, 'A4HK900001', () => {});
    assert.deepEqual(payload.MISSING, [{ object: 'CLAS', name: 'ZCL_GONE', reason: 'deleted since' }]);
    assert.ok(!JSON.stringify(payload).includes('MISSING'));
  } finally { versions.partsOf = partsOf; }
});

test('an object that exists and fails to read is listed with the error, and the review goes on', async () => {
  const versions = require('../versions-front');
  const partsOf = versions.partsOf;
  versions.partsOf = async () => { throw new Error('ADT is down'); };
  try {
    const api = { query: async sql => {
      if (/FROM e070 WHERE trkorr/.test(sql)) return { values: [{ TRKORR: 'A4HK900002' }] };
      if (/FROM e071/.test(sql)) return { values: [{ PGMID: 'R3TR', OBJECT: 'CLAS', OBJ_NAME: 'ZCL_HERE' }] };
      if (/FROM tadir/.test(sql)) return { values: [{ OBJ_NAME: 'ZCL_HERE' }] };
      return { values: [] };
    } };
    const payload = await require('../review-live').build(api, 'A4HK900002', () => {});
    assert.deepEqual(payload.MISSING, [{ object: 'CLAS', name: 'ZCL_HERE', reason: 'ADT is down' }]);
  } finally { versions.partsOf = partsOf; }
});

test('a part whose versions ADT will not give is listed in the words of SAP, and the review goes on', async () => {
  const versions = require('../versions-front');
  const saved = { partsOf: versions.partsOf, partOf: versions.partOf };
  versions.partsOf = async (api, type, name) => [{ name, part_type: type === 'DTEL' ? 'DTED' : 'REPS', unit: '' }];
  versions.partOf = async (api, type, name) => ({ url: '/x/' + name, include: '' });
  try {
    const api = { query: async sql => {
      if (/FROM e070 WHERE trkorr/.test(sql)) return { values: [{ TRKORR: 'A4HK900003' }] };
      if (/FROM e071/.test(sql)) return { values: [{ PGMID: 'R3TR', OBJECT: 'DTEL', OBJ_NAME: 'ZDE' }, { PGMID: 'R3TR', OBJECT: 'PROG', OBJ_NAME: 'ZP' }] };
      return { values: [] };
    }, revisions: async url => { if (url === '/x/ZDE') throw new Error('Request version for DTEL is not supported'); return []; } };
    const payload = await require('../review-live').build(api, 'A4HK900003', () => {});
    // ZP has no version at all: it is listed too, not dropped without a word.
    assert.deepEqual(payload.MISSING, [{ object: 'DTEL', name: 'ZDE', reason: 'Request version for DTEL is not supported' },
      { object: 'PROG', name: 'ZP', reason: 'no version of this part, and no active state' }]);
  } finally { Object.assign(versions, saved); }
});
