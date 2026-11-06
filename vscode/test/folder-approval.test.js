"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const approval = require("../folder-approval");
const review = require("../code-review");

function vscodeAnswering(answer, asked) {
  return { window: { showWarningMessage: async (text, options, ...items) => {
    asked.push({ text, options, items }); return answer; } } };
}

/* A VS Code whose review page answers with MESSAGE once it is open. */
function vscodeReviewing(message, seen) {
  return { window: { createWebviewPanel: () => {
    let handler, dispose;
    const panel = { webview: { set html(value) { seen.html = value; },
      onDidReceiveMessage: fn => { handler = fn; }, postMessage: async m => { seen.posted.push(m); } },
    onDidDispose: fn => { dispose = fn; } };
    setImmediate(() => message === "close" ? dispose() : handler(message));
    return panel;
  } }, ViewColumn: { Beside: 2 }, commands: { executeCommand: async () => {} } };
}

const decision = result => JSON.parse(result.content[0].text);
const FILE = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";

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

test("an edit of any file opens VERTEX's review; all blocks approved allow it unchanged", async () => {
  const seen = { posted: [] };
  const input = { file_path: "C:\\p\\app.py", old_string: "b\n", new_string: "B\n" };
  const result = await approval.set(vscodeReviewing({ action: "apply", approved: [0] }, seen), () => FILE)
    .call({}, "approve_action", { tool_name: "Edit", input });
  assert.deepEqual(decision(result), { behavior: "allow", updatedInput: input });
  assert.match(seen.html, /id="deny"/);
  assert.match(seen.html, />Allow</);
  assert.doesNotMatch(seen.html, /class="keyword"/, "no ABAP keywords marked in a Python file");
});

test("Deny and a closed review refuse the change", async () => {
  const input = { file_path: "x.ts", old_string: "b", new_string: "B" };
  for (const message of [{ action: "deny" }, "close"]) {
    const result = await approval.set(vscodeReviewing(message, { posted: [] }), () => FILE)
      .call({}, "approve_action", { tool_name: "Edit", input });
    assert.equal(decision(result).behavior, "deny");
  }
});

test("a declined block is left out of the edit Claude Code makes, CRLF kept", () => {
  const before = FILE.replace(/\n/g, "\r\n");
  const input = { file_path: "f", old_string: "b\r\nc\r\nd\r\ne\r\nf\r\ng\r\n", new_string: "B\r\nc\r\nd\r\ne\r\nf\r\nG\r\n" };
  const seen = approval.change("Edit", input, () => before);
  const parts = review.hunks(seen.before, seen.after);
  assert.equal(parts.length, 2);
  const kept = approval.approvedInput("Edit", input, seen, parts, [1]);
  assert.equal(kept.new_string, "b\r\nc\r\nd\r\ne\r\nf\r\nG\r\n");
  assert.equal(kept.old_string, input.old_string);
});

test("a new file is reviewed against nothing; a write keeps only the approved blocks", () => {
  const missing = () => { const e = new Error("no"); e.code = "ENOENT"; throw e; };
  const created = approval.change("Write", { file_path: "n.md", content: "x\n" }, missing);
  assert.equal(created.before, "");
  const input = { file_path: "w", content: FILE.replace("b", "B").replace("i", "I") };
  const seen = approval.change("Write", input, () => FILE);
  const parts = review.hunks(seen.before, seen.after);
  assert.equal(approval.approvedInput("Write", input, seen, parts, [0]).content, FILE.replace("b", "B"));
});

test("an edit that cannot be shown is denied with the reason", async () => {
  const result = await approval.set(vscodeReviewing("close", { posted: [] }), () => FILE)
    .call({}, "approve_action", { tool_name: "Edit", input: { file_path: "f", old_string: "zzz", new_string: "y" } });
  assert.match(decision(result).message, /not in f/);
});
