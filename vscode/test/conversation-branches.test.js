const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const log = require('../session-log'), report = require('../log-report');
test('forked history excludes later original answers and survives provider changes and reload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-branches-'));
  try {
    log.reset();
    const first = log.current(root, 'claude', {questions:true, answers:true});
    first.user('one'); first.assistant({text:'answer one'});
    await new Promise(r => setTimeout(r, 5));
    first.user('two'); first.assistant({text:'answer two'});
    let read = report.readSessions(root), source = read.sessions[0];
    const fork = report.conversationTurns(read, source.id, source.prompts[0].key);
    assert.deepEqual(fork.turns.map(t=>t.question), ['one']);
    assert.notEqual(fork.branch.id, 'main');
    log.reset(fork.conversation, fork.branch);
    await new Promise(r => setTimeout(r, 5));
    const next = log.current(root, 'codex', {questions:true, answers:true});
    next.user('alternative'); next.assistant({text:'alternative answer'});
    read = report.readSessions(root);
    const resumed = report.conversationTurns(read, source.id);
    assert.deepEqual(resumed.turns.map(t=>t.question), ['one', 'alternative']);
    assert.equal(resumed.branch.id, fork.branch.id);
    assert.deepEqual(report.conversationTurns(read, source.id, source.prompts[1].key).turns.map(t=>t.question), ['one','two']);
    assert.throws(()=>report.conversationTurns(read, source.id, 'gone'), /no longer/);
  } finally { log.reset(); fs.rmSync(root, {recursive:true, force:true}); }
});
