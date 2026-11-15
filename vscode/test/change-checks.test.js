"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const checks = require("../change-checks");
const change = (file, after, before = "") => ({ file, before, after, status: "changed" });

test("static webview checking catches the actual Enter regression without executing project code", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../sidebar.js"), "utf8");
  const broken = source.replace("let nextRequest = 0;\n", "");
  assert.notEqual(source, broken);
  const result = await checks.run({ changes: [change("sidebar.js", broken, source)] });
  assert.equal(result.state, "failed");
  assert.ok(result.checks[0].errors.some(e => e.rule === "no-undef" && /nextRequest/.test(e.message) && e.script));
});

test("syntax, JSON and browser scripts are checked; ESM and standard globals are accepted", async () => {
  const result = await checks.run({ changes: [
    change("a.js", "export const x = process.cwd();"),
    change("a.json", '{"valid":true}'),
    change("page.html", '<script>document.title="ok"; missing();</script>'),
    change("broken.cjs", "const = ;"), change("bad.json", "{")
  ] });
  assert.deepEqual(result.checks.map(c => c.state), ["passed", "passed", "failed", "failed", "failed"]);
});

test("existing errors are counted separately, shifted lines do not create new errors", async () => {
  const result = await checks.run({ changes: [change("a.js", "\n\nlegacy();\nnewError();", "legacy();")] });
  assert.equal(result.checks[0].existingErrors, 1);
  assert.equal(result.checks[0].errors.length, 1);
  assert.match(result.checks[0].errors[0].message, /newError/);
});

test("unknown languages and generated template code are explicitly unverified", async () => {
  const result = await checks.run({ changes: [change("a.py", "x = 1"), change("a.js", 'const html = `<script>const x=${JSON.stringify(1)};</script>`;')] });
  assert.equal(result.state, "unverified");
  assert.equal(result.checks[1].errors.length, 0);
  assert.match(checks.report(result), /runtime test/);
});

test("project commands run once for matching changes; failure and permission denial are distinct", async () => {
  const commands = [{ glob: "**/*.py", command: "python -m compileall ." }, { glob: "**/*.js", command: "npm test" }];
  const calls = [];
  const result = await checks.run({ changes: [change("src/a.py", ""), change("src/b.py", "")], commands,
    execute: async command => { calls.push(command); return { code: 1, stderr: "SyntaxError" }; } });
  assert.deepEqual(calls, ["python -m compileall ."]);
  assert.equal(result.state, "failed");
  assert.equal(result.checks.at(-1).code, 1);
  const denied = await checks.run({ changes: [change("a.js", "const x = 1;")], commands,
    execute: async () => { throw Error("The user denied this command"); } });
  assert.equal(denied.state, "unverified");
  assert.match(checks.report(denied), /denied/);
});

test("required project tests catch a data-contract error that static checking cannot", async () => {
  const result = await checks.run({ changes: [change("page.html", '<script>function count(p){return p.details.filter(d=>d.type==="tool").length;}</script>')],
    commands: [{ glob: "**/*.html", command: "node --test test/log-report.test.js" }],
    execute: async () => ({ code: 1, stderr: "TypeError: Cannot read properties of undefined (reading 'filter')" }) });
  assert.equal(result.checks[0].state, "passed");
  assert.equal(result.state, "failed");
});

test("cancellation prevents configured commands from starting", async () => {
  await assert.rejects(checks.run({ changes: [change("a.js", "")], isActive: () => false }), /cancelled/);
});
