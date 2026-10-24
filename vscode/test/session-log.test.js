"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sessionLog = require("../session-log");

async function session(include) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-log-"));
  const log = sessionLog.create(root, "claude", "20260916_120000", include);
  log.user("explain Z_CALC");
  const call = sessionLog.tools(log, async (_deps, name) => name === "read_sap_object"
    ? { content: [{ type: "text", text: JSON.stringify({ object_name: "Z_CALC", object_type: "PROG", source: "REPORT z_calc. SECRET" }) }] }
    : { content: [{ type: "text", text: "Object not found." }], isError: true });
  await call({}, "read_sap_object", { object_type: "PROG", object_name: "Z_CALC" });
  await call({}, "modify_sap_object", { object_name: "Z_CALC", source: "REPORT z_calc. SECRET" });
  log.assistant({ model: "claude-sonnet-5", usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900 }, text: "The answer." });
  const raw = fs.readFileSync(path.join(root, "claude_compatible", "claude_20260916_120000.jsonl"), "utf8");
  fs.rmSync(root, { recursive: true, force: true });
  return { raw, lines: raw.trim().split("\n").map(l => JSON.parse(l)) };
}

test("no folder, no log", () => {
  assert.equal(sessionLog.create("", "claude"), null);
});

test("full VERTEX instructions and context are logged only when requested", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-request-log-"));
  try {
    const quiet = sessionLog.create(root, "claude", "quiet", {});
    quiet.user("show UML");
    quiet.request({ instructions: "system secret", prompt: "context secret", tools: [], schema: {} });
    assert.doesNotMatch(fs.readFileSync(quiet.file, "utf8"), /secret/);

    const full = sessionLog.create(root, "claude", "full", { request: true });
    full.user("show UML");
    full.request({ instructions: "Use the diagram", prompt: "Current VERTEX view: Z_RIG", tools: [{ name: "read_sap_object" }], schema: { type: "object" } });
    const records = fs.readFileSync(full.file, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(records[1].type, "vertex_request");
    assert.equal(records[1].request.instructions, "Use the diagram");
    assert.equal(records[1].request.prompt, "Current VERTEX view: Z_RIG");
    assert.equal(records[1].request.tools[0].name, "read_sap_object");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the minimal log is tokens only: no question, answer, tool call or code", async () => {
  const { raw, lines } = await session({});
  assert.deepEqual(lines.map(l => l.type), ["user", "assistant"]);
  assert.doesNotMatch(raw, /SECRET|explain Z_CALC|The answer|read_sap_object/);
  assert.deepEqual(lines[1].message.usage, { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 });
  assert.equal(lines[1].message.model, "claude-sonnet-5");
});

test("questions, answers and tool calls are optional; source is omitted even with legacy code enabled", async () => {
  const withoutCode = await session({ questions: true, answers: true, tools: true });
  assert.doesNotMatch(withoutCode.raw, /SECRET/);
  const lines = withoutCode.lines;
  assert.deepEqual(lines.map(l => l.type), ["user", "assistant", "user", "assistant", "user", "assistant"]);
  assert.equal(lines[0].message.content, "explain Z_CALC");
  assert.equal(lines[1].message.content[0].type, "tool_use");
  assert.equal(lines[2].message.content[0].tool_use_id, lines[1].message.content[0].id);
  assert.match(lines[2].message.content[0].content, /"object_name":"Z_CALC"/);
  assert.match(lines[3].message.content[0].input.source, /characters, not logged/);
  assert.equal(lines[4].message.content[0].is_error, true);
  assert.equal(lines[5].message.content[0].text, "The answer.");

  const withCode = await session({ tools: true, code: true });
  assert.doesNotMatch(withCode.raw, /SECRET/);
  assert.doesNotMatch(withCode.raw, /explain Z_CALC|The answer/);

  const codeWithoutTools = await session({ code: true });
  assert.doesNotMatch(codeWithoutTools.raw, /SECRET/);
});

test("direct Anthropic-style assistant tools keep the result and log the call", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-log-"));
  try {
    const log = sessionLog.create(root, "anthropic-api", "direct", { tools: true });
    const result = await sessionLog.assistantTool(log, "read_sap_object", { object_name: "ZCL_A" },
      async () => ({ object_name: "ZCL_A", source: "CLASS zcl_a." }));
    assert.equal(result.source, "CLASS zcl_a.");
    const lines = fs.readFileSync(log.file, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(lines.map(line => line.type), ["assistant", "user"]);
    assert.equal(lines[0].message.content[0].name, "read_sap_object");
    assert.equal(lines[1].message.content[0].tool_use_id, lines[0].message.content[0].id);
    assert.doesNotMatch(JSON.stringify(lines), /CLASS zcl_a/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("request context replaces nested source with object references and retains UML and metrics snapshots", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-context-"));
  try {
    const log = sessionLog.create(root, "claude", "context", { request: true, tools: true, code: true });
    const uml = { nodes: [{ name: "ZCL_A", kind: "class", methods: ["RUN"] }], edges: [{ source: "ZCL_A", target: "ZIF_A", kind: "implementation" }] };
    const metrics = { columns: ["unit_name", "complexity"], units: [{ unit_name: "RUN", complexity: 3 }], totals: { complexity: 3 } };
    const context = { object_type: "CLAS", object_name: "ZCL_A", source: "CLASS zcl_a. SECRET_BODY", selected_fragment: { text: "SECRET_FRAGMENT" },
      nested: { new_source: "SECRET_EDIT" }, vertex_view: { type: "CLAS", name: "ZCL_A", view: "uml", uml, metrics } };
    log.request({ instructions: "Explain visible code", prompt: "Current view:\n" + JSON.stringify(context, null, 2), tools: [], schema: null });
    const raw = fs.readFileSync(log.file, "utf8"), entry = JSON.parse(raw);
    assert.doesNotMatch(raw, /SECRET_BODY|SECRET_FRAGMENT|SECRET_EDIT/);
    assert.deepEqual(entry.vertex_snapshots.map(s => s.kind), ["uml", "metrics"]);
    assert.deepEqual(entry.vertex_snapshots[0].data, uml);
    assert.deepEqual(entry.vertex_snapshots[1].data, metrics);
    assert.ok(entry.vertex_objects.some(o => o.object_name === "ZCL_A" && o.object_type === "CLAS"));
    assert.match(entry.request.prompt, /"source": "ZCL_A"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("five assistant transpiler calls retain distinct recording links without source", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-run-links-"));
  try {
    const log = sessionLog.create(root, "anthropic-api", "runs", { tools: true });
    log.user("Run five cases");
    for (let n = 1; n <= 5; n++) await sessionLog.assistantTool(log, "run_abap_transpiler", { object_name: "Z_CALC", object_type: "PROG", selection: { CASE: n } },
      async () => ({ run_id: "run-" + n, session_id: "run-" + n, mode: "transpiler", recorded_steps: 4, source: "SECRET_SOURCE" }));
    const raw = fs.readFileSync(log.file, "utf8");
    assert.doesNotMatch(raw, /SECRET_SOURCE/);
    const session = require("../log-report").parseSession(raw, "anthropic-api_20261022_120000.jsonl");
    const calls = session.prompts[0].details.filter(d => d.type === "tool");
    assert.equal(calls.length, 5);
    assert.ok(calls.every(c => c.name === "run_abap_transpiler" && c.tool_id));
    assert.equal(new Set(calls.map(c => c.tool_id)).size, 5);
    assert.deepEqual(session.prompts[0].details.filter(d => d.type === "tool result").map(d => d.tool_id), calls.map(c => c.tool_id));
    assert.deepEqual(calls.map(c => c.recording.id), ["run-1", "run-2", "run-3", "run-4", "run-5"]);
    assert.ok(calls.every(c => c.recording.kind === "transpiler"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("SAP debug_run gains its saved-recording link when a later assistant tool saves a stop", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-link-"));
  try {
    const log = sessionLog.create(root, "claude", "sap", { tools: true });
    log.user("Debug in SAP");
    const run = log.toolUse("debug_run", { program: "Z_CALC" });
    log.toolResult(run, { content: [{ type: "text", text: "Opened browser" }], vertex_recording: { kind: "sap", id: "sap-run-1", recorded_steps: 0 } });
    const report = require("../log-report");
    assert.equal(report.parseSession(fs.readFileSync(log.file, "utf8"), "claude.jsonl").prompts[0].details[0].recording, undefined);
    const wait = log.toolUse("debug_wait", {});
    log.toolResult(wait, { content: [{ type: "text", text: "Stopped" }], vertex_recording: { kind: "sap", id: "sap-run-1", recorded_steps: 1 } });
    const calls = report.parseSession(fs.readFileSync(log.file, "utf8"), "claude.jsonl").prompts[0].details.filter(d => d.type === "tool");
    assert.ok(calls.every(c => c.recording.id === "sap-run-1" && c.recording.kind === "sap"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a review block in the context is logged as a reference to its part, not as its code', () => {
  const log = require('../session-log');
  const objects = [];
  const text = 'Review context:\n' + JSON.stringify({ selected_fragment: { compared_with: '', review_object: 'Z_TR_TEXT_TRANSFER', review_type: 'REPS',
    text: 'Review of Z_TR_TEXT_TRANSFER (REPS) in request ALCK900726:\n  TYPES: BEGIN OF ty_out,\n    sel TYPE abap_bool,\n  END OF ty_out.' } });
  const safe = log.sanitizeText(text, objects);
  assert.doesNotMatch(safe, /TYPES: BEGIN OF ty_out/);
  assert.match(safe, /not logged; open the referenced object/);
  assert.ok(objects.some(o => o.object_name === 'Z_TR_TEXT_TRANSFER' && o.object_type === 'PROG' && o.part && o.part.type === 'REPS'));
});
