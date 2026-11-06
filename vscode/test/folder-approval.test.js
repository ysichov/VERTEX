"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const approval = require("../folder-approval");

function vscodeAnswering(answer, asked) {
  return { window: { showWarningMessage: async (text, options, ...items) => {
    asked.push({ text, options, items }); return answer; } } };
}

/* A VS Code with one review page at a time; the test drives it through `page`. */
function vscodeReviewing() {
  const page = { panels: 0, html: "", posted: [], send: null, close: null };
  return { page, vscode: { window: { createWebviewPanel: () => {
    page.panels++;
    return { webview: { set html(value) { page.html = value; }, onDidReceiveMessage: fn => { page.send = fn; },
      postMessage: async m => { page.posted.push(m); } }, onDidDispose: fn => { page.close = fn; }, reveal() {} };
  } }, ViewColumn: { Beside: 2 }, commands: { executeCommand: async () => {} } } };
}

const decision = result => JSON.parse(result.content[0].text);
const FILE = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
const tick = () => new Promise(resolve => setImmediate(resolve));
const ids = html => [...html.matchAll(/data-file="([^"]+)"/g)].map(m => m[1]);

test("a command asks in a modal dialog naming it; dismissing it denies", async () => {
  const asked = [];
  const result = await approval.set(vscodeAnswering("Allow", asked))
    .call({}, "approve_action", { tool_name: "Bash", input: { command: "npm test" } });
  assert.deepEqual(decision(result), { behavior: "allow", updatedInput: { command: "npm test" } });
  assert.match(asked[0].text, /npm test/);
  assert.equal(asked[0].options.modal, true);
  const denied = await approval.set(vscodeAnswering(undefined, []))
    .call({}, "approve_action", { tool_name: "Bash", input: { command: "rm x" } });
  assert.equal(decision(denied).behavior, "deny");
});

test("parallel edits of any files wait in one review, decided file by file", async () => {
  const { page, vscode } = vscodeReviewing();
  const tool = approval.set(vscode, () => FILE);
  const py = { file_path: "C:\\p\\app.py", old_string: "b\n", new_string: "B\n" };
  const md = { file_path: "C:\\p\\notes.md", old_string: "i\n", new_string: "I\n" };
  const first = tool.call({}, "approve_action", { tool_name: "Edit", input: py });
  const second = tool.call({}, "approve_action", { tool_name: "Edit", input: md });
  await tick();
  assert.equal(page.panels, 1, "one review page for both");
  const [pyId, mdId] = ids(page.html);
  assert.match(page.html, /app\.py/);
  assert.match(page.html, /notes\.md/);
  assert.doesNotMatch(page.html, /class="keyword"/, "no ABAP keywords marked outside .abap");
  await page.send({ action: "apply", approved: [pyId], declined: [] });
  assert.equal(page.posted.pop().action, "error", "every file needs a decision");
  await page.send({ action: "apply", approved: [pyId], declined: [mdId] });
  assert.deepEqual(decision(await first), { behavior: "allow", updatedInput: py });
  assert.equal(decision(await second).behavior, "deny");
});

test("Deny and closing the review refuse every waiting change", async () => {
  for (const how of ["deny", "close"]) {
    const { page, vscode } = vscodeReviewing();
    const tool = approval.set(vscode, () => FILE);
    const calls = ["b", "i"].map(s => tool.call({}, "approve_action",
      { tool_name: "Edit", input: { file_path: "x.ts", old_string: s, new_string: s.toUpperCase() } }));
    await tick();
    if (how === "deny") await page.send({ action: "deny" }); else page.close();
    for (const call of calls) assert.equal(decision(await call).behavior, "deny");
  }
});

test("a new file is reviewed against nothing; an edit that cannot be shown is denied with the reason", async () => {
  const missing = () => { const e = new Error("no"); e.code = "ENOENT"; throw e; };
  const created = approval.change("Write", { file_path: "n.md", content: "x\n" }, missing);
  assert.equal(created.before, "");
  assert.equal(created.created, true);
  const { vscode } = vscodeReviewing();
  const result = await approval.set(vscode, () => FILE)
    .call({}, "approve_action", { tool_name: "Edit", input: { file_path: "f", old_string: "zzz", new_string: "y" } });
  assert.match(decision(result).message, /not in f/);
});
