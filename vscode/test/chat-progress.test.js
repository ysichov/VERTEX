"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("a tool call at the /chat endpoint reaches the waiting request until it stops listening", () => {
  const progress = require("../chat-progress");
  const seen = [];
  const stop = progress.listen(name => seen.push(name));
  progress.listen(() => { throw new Error("a broken listener"); });
  progress.report("abap_objects_generator_run");
  stop();
  progress.report("after the request");
  assert.deepEqual(seen, ["abap_objects_generator_run"]);
});

test("Codex steps are counted from the endpoint, Claude Code's from its own stream", () => {
  const source = require("node:fs").readFileSync(require.resolve("../chat"), "utf8");
  assert.match(source, /if \(id !== "claude" && !compatible\.PROVIDERS\[id\] && id !== "anthropic-api" && id !== "copilot"\) \{\s*unlisten = require\("\.\/chat-progress"\)\.listen/);
  assert.match(require("node:fs").readFileSync(require.resolve("../extension"), "utf8"), /require\("\.\/chat-progress"\)\.report\(toolName\)/);
});
