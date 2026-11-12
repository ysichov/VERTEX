"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("review pages are told when no AI is available, and only on a change", () => {
  const ai = require("../ai-availability.js");
  const sent = []; let dispose;
  ai.attach({ webview: { postMessage: m => sent.push(m) }, onDidDispose: f => { dispose = f; } });
  assert.deepEqual(sent, []); // unknown: nothing hidden
  ai.set(false); ai.set(false); ai.set(true);
  assert.deepEqual(sent, [{ aiAvailable: false }, { aiAvailable: true }]);
  dispose(); ai.set(false);
  assert.equal(sent.length, 2);
  assert.match(ai.pageScript(), /toggle\('no-ai',true\)/);
  assert.match(ai.PAGE_CSS, /button\.ask/);
});
