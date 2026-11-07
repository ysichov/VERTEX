"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const tools = require("../folder-tools");

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-local-tools-"));
  const page = {};
  const vscode = { ViewColumn: { Beside: 2 }, window: {
    showWarningMessage: async () => options.allow ? "Allow" : undefined,
    createWebviewPanel: () => ({ webview: { html: "", onDidReceiveMessage: fn => { page.send = fn; }, postMessage: async () => {} },
      onDidDispose: fn => { page.close = fn; }, dispose: () => page.close(), reveal() {} }) } };
  const steps = [];
  const agent = tools.create(vscode, { cwd: root, reviewAfter: true, onStep: step => steps.push(step), ...options });
  t.after(() => { agent.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  return { root, agent, page, steps };
}
test("a Glob pattern ending in / lists folders, not files", async t => {
  const { agent, root } = fixture(t);
  fs.mkdirSync(path.join(root, "docs", "img"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "docs", "x.md"), "x");
  assert.deepEqual((await agent.call("Glob", { pattern: "*/" })).matches, ["docs/", "src/"]);
  assert.deepEqual((await agent.call("Glob", { pattern: "**/" })).matches, ["docs/", "docs/img/", "src/"]);
  assert.deepEqual((await agent.call("Glob", { pattern: "*" })).matches, ["a.txt"]);
});
const tick = () => new Promise(resolve => setImmediate(resolve));

test("common tools search, page, edit and create files, and log every step", async t => {
  const { agent, root, steps } = fixture(t);
  assert.deepEqual((await agent.call("Glob", { pattern: "**/*.txt" })).matches, ["a.txt"]);
  assert.equal((await agent.call("Grep", { pattern: "TWO", ignore_case: true })).matches[0].line, 2);
  await assert.rejects(agent.call("Edit", { file_path: "a.txt", old_string: "one", new_string: "new" }), /Read the current/);
  assert.equal((await agent.call("Read", { file_path: "a.txt", offset: 2, limit: 1 })).text, "2: two");
  await agent.call("Edit", { file_path: "a.txt", old_string: "one", new_string: "new" });
  await agent.call("Write", { file_path: "sub/new.js", content: "export const x = 1;" });
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "new\ntwo\n");
  assert.ok(steps.some(step => step.is_error));
  assert.equal(steps.filter(step => step.kind === "use").length, 6);
  assert.equal(steps.filter(step => step.kind === "result").length, 6);
});

test("local paths cannot escape, access .git or follow directory links", async t => {
  const { agent, root } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "secret.txt"), "untouched");
  for (const file_path of ["../outside.txt", path.join(outside, "secret.txt"), ".git/config", "a.txt:stream"]) {
    await assert.rejects(agent.call("Write", { file_path, content: "bad" }), /outside|metadata|streams/);
  }
  fs.symlinkSync(outside, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(agent.call("Read", { file_path: "link/secret.txt" }), /Symbolic/);
  await assert.rejects(agent.call("Write", { file_path: "link/new.txt", content: "bad" }), /Symbolic/);
  assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
  assert.deepEqual((await agent.call("Glob", { pattern: "**" })).matches, ["a.txt"]);
});

test("stale edits are rejected and concurrent mutations are serialized", async t => {
  const { agent, root } = fixture(t);
  await agent.call("Read", { file_path: "a.txt" });
  fs.writeFileSync(path.join(root, "a.txt"), "user edit");
  await assert.rejects(agent.call("Write", { file_path: "a.txt", content: "lost" }), /changed/);
  await agent.call("Read", { file_path: "a.txt" });
  await Promise.all([
    agent.call("Edit", { file_path: "a.txt", old_string: "user", new_string: "first" }),
    agent.call("Edit", { file_path: "a.txt", old_string: "first", new_string: "second" })
  ]);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "second edit");
});

test("outside Git, a write waits for review; cancellation or concurrent user edits prevent it", async t => {
  const { agent, root, page } = fixture(t, { reviewAfter: false });
  await agent.call("Read", { file_path: "a.txt" });
  const request = agent.call("Edit", { file_path: "a.txt", old_string: "one", new_string: "approved" });
  await tick();
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "one\ntwo\n");
  await page.send({ action: "apply", approved: ["f1"], declined: [] });
  await request;
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "approved\ntwo\n");
  const next = agent.call("Write", { file_path: "a.txt", content: "overwrite" });
  await tick();
  fs.writeFileSync(path.join(root, "a.txt"), "user");
  await page.send({ action: "apply", approved: ["f2"], declined: [] });
  await assert.rejects(next, /changed while waiting/);
  const pending = agent.call("Write", { file_path: "new.txt", content: "cancelled" });
  await tick(); agent.dispose();
  await assert.rejects(pending, /no longer active/);
  assert.equal(fs.existsSync(path.join(root, "new.txt")), false);
});

test("shell commands require permission and never execute after denial", async t => {
  const { agent, root } = fixture(t);
  await assert.rejects(agent.call("Bash", { command: "echo forbidden" }), /denied/);
  agent.dispose();
  await assert.rejects(agent.call("Write", { file_path: "new.txt", content: "bad" }), /no longer active/);
  assert.equal(fs.existsSync(path.join(root, "new.txt")), false);
});

test("non-ASCII reads stay below the model tool-result byte budget", async t => {
  const { agent, root } = fixture(t);
  fs.writeFileSync(path.join(root, "unicode.txt"), ("界".repeat(1000) + "\n").repeat(100));
  const result = await agent.call("Read", { file_path: "unicode.txt", limit: 500 });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 24000);
  assert.ok(result.next_offset > 1);
});

test("approved commands run in the selected folder and report failed exits", async t => {
  const { agent, root, steps } = fixture(t, { allow: true });
  const result = await agent.call("Bash", { command: process.platform === "win32" ? "(Get-Location).Path" : "pwd" });
  assert.equal(result.code, 0);
  assert.equal(fs.realpathSync(result.stdout.trim()), fs.realpathSync(root));
  assert.equal((await agent.call("Bash", { command: "exit 7" })).code, 7);
  assert.equal(steps.at(-1).is_error, true);
});

test("Windows shell parsing failure explains that Git did not run", {skip:process.platform!=='win32'}, async t => {
 const {agent}=fixture(t,{allow:true});
 const result=await agent.call('Bash',{command:'git --version && git --version'});
 assert.notEqual(result.code,0);assert.match(result.hint,/Git did not run/);
});

test('environment identifies the executing host and separates bundled runtime from PATH', () => {
 const text=tools.environment('test folder');
 const data=JSON.parse(text.slice(text.indexOf('{')));
 assert.equal(data.platform,process.platform);assert.equal(data.architecture,process.arch);
 assert.equal(data.workingDirectory,'test folder');assert.equal(data.cwdAlreadySelected,true);
 assert.match(data.dependencyStatus,/not verified/);assert.match(data.dependencyStatus,/does not imply node is on PATH/);
 assert.equal(tools.environment('').includes('"workingDirectory":null'),true);
 assert.equal(text.includes(process.env.PATH||'impossible env value'),false);
});
