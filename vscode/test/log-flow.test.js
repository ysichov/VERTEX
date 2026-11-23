"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const flow = require("../log-flow"), logs = require("../log-report");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

// Model browser clamping: an empty/new viewport cannot retain a scroll offset.
function flowHost() {
  const elements = [], observers = [];
  const win = { getComputedStyle: () => ({ color: "rgb(100,100,100)", backgroundColor: "rgb(30,30,30)" }),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} disconnect() {} } };
  const doc = { defaultView: win, createElement(tag) {
    let left = 0, top = 0;
    const node = { tagName: tag.toUpperCase(), ownerDocument: doc, children: [], dataset: {},
      style: { setProperty() {} }, classList: { add() {}, toggle() {} }, listeners: new Map(),
      clientWidth: 600, clientHeight: 300, calls: [],
      setAttribute() {}, append(...items) { items.forEach(item => this.appendChild(item)); },
      appendChild(item) { item.parent = this; this.children.push(item); return item; },
      after() {}, prepend(item) { this.appendChild(item); },
      replaceChildren() { this.children = []; }, querySelectorAll() { return []; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); },
      addEventListener(name, fn) { this.listeners.set(name, fn); },
      removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); },
      scrollTo(options) { this.calls.push(options); this.scrollLeft = options.left; },
      get options() { return this.children; }, get offsetWidth() { return parseFloat(this.style.width) || 0; },
      get scrollLeft() { return left; }, set scrollLeft(value) {
        const width = parseFloat(this.children[0]?.style.width) || 0;
        left = Math.max(0, Math.min(value, width - this.clientWidth));
      },
      get scrollTop() { return top; }, set scrollTop(value) {
        const height = parseFloat(this.children[0]?.style.height) || 0;
        top = Math.max(0, Math.min(value, height - this.clientHeight));
      } };
    elements.push(node); return node;
  } };
  doc.body = doc.createElement("body");
  return { root: doc.createElement("div"), elements, observers,
    viewport: () => elements.find(node => node.className === "flow-viewport") };
}

test("Flow restores scroll after sizing on remount and smoothly follows appended columns", () => {
  const session = count => ({ prompts: [{ text: "Fix", model: "model", flow: { eventItems:
    Array.from({ length: count }, (_, i) => ({ kind: i % 2 ? "tool" : "note", title: "Stage " + i, time: i + 1 })) } }] });
  const state = {}, first = flowHost();
  const dispose = flow.mount(first.root, session(8), { state, followRight: true });
  const old = first.viewport();
  assert.ok(old.scrollLeft > 0);
  old.scrollTop = 20;
  dispose();
  assert.equal(old.listeners.has("scroll"), false);
  const next = flowHost();
  const close = flow.mount(next.root, session(10), { state, followRight: true });
  const viewport = next.viewport();
  assert.equal(viewport.scrollTop, 20);
  assert.equal(viewport.calls.length, 1);
  assert.equal(viewport.calls[0].behavior, "smooth");
  assert.ok(viewport.calls[0].left > state.scrollLeft);
  viewport.listeners.get("scroll")();
  viewport.scrollLeft = 180; viewport.listeners.get("scroll")();
  close();
  assert.equal(state.followPaused, true);
  const paused = flowHost();
  const finish = flow.mount(paused.root, session(12), { state, followRight: true });
  assert.equal(paused.viewport().scrollLeft, 180);
  assert.equal(paused.viewport().calls.length, 0);
  paused.observers[0]();
  assert.equal(paused.viewport().scrollLeft, 180);
  finish();
});

test("saved non-live Flow keeps both offsets without forcing follow", () => {
  const host = flowHost(), state = { scrollLeft: 450, scrollTop: 20, view: "step" };
  const dispose = flow.mount(host.root, { prompts: [{ text: "Saved request" }] }, { state });
  assert.equal(host.viewport().scrollLeft, 450);
  assert.equal(host.viewport().scrollTop, 20);
  assert.equal(host.viewport().calls.length, 0);
  dispose();
});

test("model steps link their own notes, answers and tool calls with bounded previews", () => {
  const rows = [
    { type: "user", message: { content: "Fix" } },
    { type: "vertex_provider_response", scope: "model_response", response: { id: "round-1", usage: {} } },
    { type: "vertex_provider_response", scope: "model_response", response: { id: "round-1", usage: { output_tokens: 10 } } },
    { type: "assistant", vertex_step: "local", message: { content: [{ type: "tool_use", id: "read", name: "Read", input: { file_path: "a.js" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read", content: "file body" }] } },
    { type: "assistant", vertex_step: "claude_note", message: { content: [{ type: "vertex_note", text: "Final streamed text" }] } },
    { type: "vertex_provider_response", scope: "model_response", response: { id: "round-2" } },
    { type: "vertex_provider_response", scope: "cli_run", response: {} },
    { type: "assistant", message: { content: [{ type: "text", text: "Final answer" }] } },
    { type: "user", message: { content: "Next question" } },
    { type: "vertex_provider_response", scope: "model_response", response: { id: "round-3" } }
  ];
  const parsed = logs.parseSession(rows.map(row => JSON.stringify({ timestamp: "2026-11-23T00:00:00Z", ...row })).join("\n"), "codemie_test.jsonl");
  const prompt = parsed.prompts[0], models = flow.summary(prompt).eventItems.filter(item => item.kind === "model");
  assert.equal(models.length, 2, "duplicate metadata does not create another model round");
  assert.deepEqual(models[0].detailIndices.map(index => prompt.details[index].type), ["tool"]);
  assert.deepEqual(models[0].noteEventIndices, []);
  assert.deepEqual(models[1].detailIndices.map(index => prompt.details[index].text), ["Final answer"]);
  assert.equal(prompt.events[models[1].noteEventIndices[0]].model.text, "Final streamed text");
  assert.match(models[0].preview, /Read: a\.js/);
  assert.equal(models[1].preview, "Final answer");
  assert.doesNotMatch(JSON.stringify(models), /file body/);
  assert.deepEqual(flow.summary(parsed.prompts[1]).eventItems[0].detailIndices, []);
});

test("model links respect request boundaries and notes logged after metadata", () => {
  const prompt = { details: [{ type: "answer", text: "First" }, { type: "tool", tool_id: "x" }], events: [
    { kind: "model" }, { kind: "note", model: { text: "Reasoning" } }, { kind: "detail", detail: 0 },
    { kind: "request", details: [] }, { kind: "model" }, { kind: "tool", detail: 1 }
  ] };
  const models = flow.summary(prompt).eventItems.filter(item => item.kind === "model");
  assert.deepEqual(models.map(item => item.detailIndices), [[0], [1]]);
  assert.deepEqual(models.map(item => item.noteEventIndices), [[1], []]);
});

test("model cards distinguish rounds, bounded tool purposes, text and metadata-only responses", () => {
  const prompt = { model: "gpt", details: [
    { type: "tool", name: "Bash", input: { description: "Check log updates", command: "private command" } },
    { type: "answer", text: "Final result " + "x".repeat(400) }
  ], events: [{ kind: "model", model: { usage: { input_tokens: 100, output_tokens: 0 } } },
    { kind: "tool", detail: 0 }, { kind: "model" }, { kind: "detail", detail: 1 }, { kind: "model" }] };
  const models = flow.summary(prompt).eventItems.filter(item => item.kind === "model");
  assert.deepEqual(models.map(item => item.title), ["LLM processing · round 1", "LLM processing · round 2", "LLM processing · round 3"]);
  assert.equal(models[0].preview, "Bash: Check log updates");
  assert.match(models[0].label, /1 tool call · 100 in · 0 out/);
  assert.match(models[1].label, /Text response/);
  assert.equal(models[1].preview.length, 360);
  assert.match(models[2].label, /Metadata only/);
  assert.equal(models[2].preview, "");
  assert.doesNotMatch(JSON.stringify(models), /private command/);
});

test("Flow preserves the panel model selection while retaining exact response metadata", () => {
  const rows = [
    { type: "user", message: { content: "Fix", model: "gpt-6.1-sol" } },
    { type: "vertex_request", request: { prompt: "Fix" } },
    { type: "vertex_provider_response", scope: "model_response", response: { id: "r", model: "codemie-gpt-6.1-sol-2026-09-29" } },
    { type: "assistant", message: { model: "gpt-6.1-sol-2026-09-29", content: [{ type: "text", text: "Done" }] } }
  ];
  const session = logs.parseSession(rows.map(row => JSON.stringify({ timestamp: "2026-11-23T00:00:00Z", ...row })).join("\n"), "codemie_test.jsonl");
  const prompt = session.prompts[0];
  assert.equal(prompt.model, "gpt-6.1-sol-2026-09-29");
  assert.equal(prompt.displayModel, "gpt-6.1-sol");
  prompt.flow = flow.summary(prompt);
  const steps = flow.chronologicalStages(prompt);
  assert.match(steps.find(item => item.kind === "request").title, /^gpt-6\.1-sol request/);
  assert.match(steps.find(item => item.kind === "model").label, /^gpt-6\.1-sol ·/);
  const host = flowHost(), dispose = flow.mount(host.root, session, { state: {} });
  assert.ok(host.elements.some(node => node.tagName === "STRONG" && node.textContent === "gpt-6.1-sol"));
  assert.ok(!host.elements.some(node => /2026-09-29/.test(node.textContent || "")));
  dispose();
  const old = flow.summary({ model: "custom-v2", events: [{ kind: "model" }] });
  assert.match(old.eventItems[0].label, /^custom-v2 ·/);
});

test("Flow uses the panel catalog for older selected IDs and preserves recorded labels", () => {
  const rows = [
    { type: "user", message: { content: "Old", model: "gpt-6.1-terra-2026-10-26" } },
    { type: "vertex_provider_response", scope: "model_response", response: { model: "response-id" } },
    { type: "user", message: { content: "New", model: "gpt-6.1-terra-2026-10-26", model_label: "GPT-6.1 Terra at the time" } },
    { type: "user", message: { content: "Unknown", model: "unknown-id" } }
  ];
  const session = logs.parseSession(rows.map(row => JSON.stringify({ timestamp: "2026-11-23T00:00:00Z", ...row })).join("\n"), "codemie_20261123_071208_abcdef.jsonl");
  logs.setModelCatalog("codemie", [{ id: "gpt-6.1-terra-2026-10-26", label: "GPT-6.1 Terra" }]);
  try {
    const prompts = logs.listReport({ sessions: [session] }).sessions[0].prompts;
    assert.deepEqual(prompts.map(p => p.displayModel), ["GPT-6.1 Terra", "GPT-6.1 Terra at the time", "unknown-id"]);
    assert.equal(prompts[0].model, "response-id");
    const shown = { ...prompts[0], details: [{ type: "tool", name: "Read" }], events: [{ kind: "model" }, { kind: "tool", detail: 0 }] };
    shown.flow = flow.summary(shown);
    const host = flowHost(), close = flow.mount(host.root, { prompts: [shown] }, { state: {} });
    assert.ok(host.elements.some(node => /GPT-6\.1 Terra · processing$/.test(node.textContent || "")));
    close();
    logs.setModelCatalog("other-provider", [{ id: "unknown-id", label: "Wrong provider" }]);
    assert.equal(logs.listReport({ sessions: [session] }).sessions[0].prompts[2].displayModel, "unknown-id");
  } finally { logs.setModelCatalog("codemie", []); logs.setModelCatalog("other-provider", []); }
});

test("Thinking cards use their available body for multiline previews, not a truncated heading", () => {
  const text = "Добавлю на карточки краткое содержание шага.\nКакие инструменты вызвала модель и что она ответила. " + "Текст ".repeat(150);
  const prompt = { text: "Fix", details: [], events: [{ kind: "note", model: { text } }] };
  prompt.flow = flow.summary(prompt);
  assert.equal(prompt.flow.eventItems[0].preview.length, 600);
  assert.match(prompt.flow.eventItems[0].preview, /Какие инструменты/);
  const host = flowHost(), dispose = flow.mount(host.root, { prompts: [prompt] }, { state: {} });
  const card = host.elements.find(node => node.className?.includes("flow-thinking-note"));
  assert.equal(card.children[0].textContent, "Thinking");
  assert.equal(card.children[1].className, "flow-step-preview");
  assert.equal(card.children[1].textContent, prompt.flow.eventItems[0].preview);
  assert.equal(card.style.height, "75px");
  dispose();
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/log-report.html"), "utf8");
  assert.match(page, /\.flow-node\.flow-thinking-note \.flow-step-preview \{ -webkit-line-clamp: 10; color: var\(--vscode-charts-purple/);
});

test("Step draws directional chronological connections in the non-WebGL host", () => {
  const host = flowHost(), prompt = { text: "Fix", model: "gpt", details: [
    { type: "tool", name: "Read", input: { file_path: "a.js" } }
  ], events: [{ kind: "request" }, { kind: "model" }, { kind: "tool", detail: 0 }, { kind: "model" }] };
  prompt.flow = flow.summary(prompt);
  const dispose = flow.mount(host.root, { prompts: [prompt] }, { state: {} });
  const connections = host.elements.filter(node => node.className === "flow-connection");
  assert.equal(connections.length, 4);
  assert.ok(connections.some(node => node.children.some(child => child.textContent === "↓")));
  assert.ok(connections.some(node => node.children.some(child => child.textContent === "→")));
  assert.ok(connections.every(node => /recorded order/.test(node.title)));
  const cards = host.elements.filter(node => node.className?.includes("flow-step-node") && node.className.includes("model"));
  assert.equal(cards[0].style.height, "75px");
   assert.ok(cards[0].children.some(node => node.textContent === "1 tool call"));
   assert.ok(!cards[0].children.some(node => node.className === "flow-step-preview"));
  dispose();
});

test("Step keeps each tool round as a compact VERTEX header above its calls", () => {
  const prompt = { text: "Fix", displayModel: "panel-model", model: "exact-model-2026", details: [
    ...["a", "b", "c", "d"].map(id => ({ type: "tool", name: "Read", tool_id: id, input: { file_path: id + ".js" } })),
    { type: "tool result", tool_id: "a", text: "read result" }, { type: "answer", text: "Done" }
  ], events: [
    { kind: "model" }, { kind: "tool", detail: 0 }, { kind: "tool", detail: 1 }, { kind: "tool", detail: 2 },
    { kind: "tool_result", detail: 4 }, { kind: "model" }, { kind: "tool", detail: 3 },
    { kind: "model" }, { kind: "detail", detail: 5 }
  ] };
  prompt.flow = flow.summary(prompt);
  const host = flowHost(), selected = [];
  const dispose = flow.mount(host.root, { prompts: [prompt] }, { state: {}, details: (...args) => selected.push(args) });
  const cards = host.elements.filter(node => node.className?.includes("flow-step-node"));
  const rounds = cards.filter(node => node.className.includes("model"));
  const tools = cards.filter(node => node.className.includes("flow-operation"));
  assert.equal(rounds.length, 3);
  assert.equal(tools.length, 4);
  assert.deepEqual(tools.map(card => card.children[0].textContent), ["1. Read · a.js", "2. Read · b.js", "3. Read · c.js", "4. Read · d.js"]);
  assert.ok(rounds.every(card => !/^\d+\./.test(card.children[0].textContent)));
  assert.ok(cards.filter(card => !card.className.includes("flow-operation")).every(card => !/^\d+\./.test(card.children[0].textContent)));
  assert.ok(cards.every(card => card.style.height === "75px"), "all Step card types use the same half-height");
  assert.deepEqual(rounds.slice(0, 2).map(node => node.style.height), ["75px", "75px"]);
  assert.match(rounds[0].children[0].textContent, /panel-model · processing$/);
  assert.equal(rounds[0].children[1].textContent, "3 tool calls");
  assert.equal(rounds[1].children[1].textContent, "1 tool call");
  assert.equal(rounds[0].style.left, tools[0].style.left);
  assert.equal(rounds[1].style.left, tools[3].style.left);
  assert.notEqual(rounds[0].style.left, rounds[1].style.left, "each round starts its own VERTEX column");
  assert.equal(tools[0].style.top, "224px");
  assert.equal(tools[2].style.top, "422px");
  assert.equal(rounds[2].style.height, "75px", "text-only rounds are compact too");
  const owners = host.elements.filter(node => node.tagName === "STRONG" && node.style.top === "96px");
  assert.deepEqual(owners.map(node => node.textContent), ["User", "Round 1", "Round 2", "Round 3"]);
  const dialog = host.elements.find(node => node.tagName === "DIALOG");
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  rounds[0].onclick();
  assert.equal(selected[0][1].kind, "model");
  assert.deepEqual(selected[0][1].detailIndices, [0, 1, 2]);
  tools[0].onclick();
  assert.equal(selected[1][1].detailIndex, 0);
  assert.match(tools[0].children[1].textContent, /read result/);
  dispose();
  const timeline = flowHost(), close = flow.mount(timeline.root, { prompts: [prompt] }, { state: { view: "steps" } });
  const model = timeline.elements.find(node => node.className === "flow-node recorded model");
  assert.equal(model.style.height, "132px");
  assert.ok(model.children.some(node => node.className === "flow-step-preview"));
  assert.ok(!/^\d+\./.test(model.children[0].textContent));
  assert.deepEqual(timeline.elements.filter(node => node.className?.includes("flow-operation")).map(card => card.children[0].textContent),
    ["1. Read · a.js", "2. Read · b.js", "3. Read · c.js", "4. Read · d.js"]);
  close();
});

test("tool numbering restarts per request and ignores non-tool events", () => {
  const makePrompt = text => ({ text, details: [
    { type: "tool", name: "Read", tool_id: "r" }, { type: "tool result", tool_id: "r", text: "ok" },
    { type: "answer", text: "done" }, { type: "tool", name: "Bash", tool_id: "b" }
  ], events: [{ kind: "request" }, { kind: "model" }, { kind: "tool", detail: 0 },
    { kind: "tool_result", detail: 1 }, { kind: "note", model: { text: "Thinking" } },
    { kind: "detail", detail: 2 }, { kind: "model" }, { kind: "tool", detail: 3 }] });
  for (const prompt of [makePrompt("first"), makePrompt("second")]) {
    const cards = flow.chronologicalStages({ ...prompt, flow: flow.summary(prompt) });
    assert.deepEqual(cards.filter(card => card.kind === "tool").map(card => card.toolNumber), [1, 2]);
    assert.ok(cards.filter(card => card.kind !== "tool").every(card => card.toolNumber === undefined));
  }
});

test("tool cards prefer paired results to requests, including Bash output and unsuccessful edits", () => {
  const details = [
    { type: "tool", name: "Bash", tool_id: "b", input: { command: "secret-command", description: "Run checks" } },
    { type: "tool result", tool_id: "b", text: JSON.stringify({ purpose: "command", code: 0, stdout: "tests 50\nfail 2", stderr: "", output_truncated: true }) },
    { type: "tool", name: "Bash", tool_id: "f", input: { command: "bad" } },
    { type: "tool result", tool_id: "f", text: JSON.stringify({ code: 2, stdout: "partial output", stderr: "permission denied" }), failed: true },
    { type: "tool", name: "Grep", tool_id: "g", input: { pattern: "request-pattern" } },
    { type: "tool result", tool_id: "g", text: "matched result" },
    { type: "tool", name: "Edit", tool_id: "e", input: { old_string: "old", new_string: "new" } },
    { type: "tool result", tool_id: "e", text: "Edit rejected", failed: true },
    { type: "tool", name: "Read", tool_id: "pending", input: { file_path: "pending.js" } },
    { type: "tool", name: "Read", tool_id: "empty" },
    { type: "tool result", tool_id: "empty", text: "" }
  ];
  const prompt = { text: "Fix", details, events: details.map((detail, index) => ({ kind: detail.type === "tool" ? "tool" : "tool_result", detail: index })) };
  prompt.flow = flow.summary(prompt);
  const cards = prompt.flow.eventItems.filter(item => item.kind === "tool");
  assert.equal(cards[0].operationPreview, "Result: Exit code: 0 · Output truncated · tests 50 fail 2");
  assert.equal(cards[1].operationPreview, "Result: Exit code: 2 · permission denied");
  assert.equal(cards[2].operationPreview, "Result: matched result");
  assert.equal(cards[3].operationPreview, "Result: Edit rejected");
  assert.equal(cards[3].operationDiff, undefined);
  assert.equal(cards[4].operationPreview, "Result not recorded");
  assert.equal(cards[5].operationPreview, "Result recorded (empty)");
  const host = flowHost(), dispose = flow.mount(host.root, { prompts: [prompt] }, { state: {} });
  const bash = host.elements.find(node => node.className?.includes("flow-operation") && node.children.some(child => /Exit code: 0/.test(child.textContent || "")));
  assert.ok(bash);
  assert.doesNotMatch(bash.children.map(child => child.textContent).join(" "), /secret-command|Run checks/);
  dispose();
});

test("CLI usage cards show recorded aggregate and model values while empty details stay compact", () => {
  const rows = [
    { type: "user", message: { content: "Fix" } },
    { type: "vertex_provider_response", provider: "codemie", scope: "cli_run", response: {
      total_cost_usd: 0.25, usage: { input_tokens: 100, output_tokens: 0 },
      modelUsage: { "model-a": { inputTokens: 100, outputTokens: 0, cacheReadInputTokens: 25, costUSD: 0.25 } }
    } },
    { type: "vertex_provider_response", provider: "codemie", scope: "cli_run", response: {} }
  ];
  const parsed = logs.parseSession(rows.map(row => JSON.stringify({ timestamp: "2026-11-23T00:00:00Z", ...row })).join("\n"), "codemie_test.jsonl");
  const prompt = parsed.prompts[0]; prompt.flow = flow.summary(prompt);
  const previews = prompt.flow.eventItems.filter(item => item.usagePreview);
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].usagePreview, ["Estimated run cost · $0.25", "Run tokens · 100 input · 0 output", "model-a · 100 input · 0 output · 25 cache read · estimated $0.25"]);
  const host = flowHost(), dispose = flow.mount(host.root, parsed, { state: {} });
  const cards = host.elements.filter(node => node.className?.includes("flow-step-node") && node.className.includes("detail"));
  assert.equal(cards[0].style.height, "75px");
  assert.ok(cards[0].children.some(node => /Estimated run cost/.test(node.textContent || "")));
  assert.equal(cards[1].style.height, "75px");
  dispose();
  assert.deepEqual(flow.providerUsage({ type: "Provider usage (cli_run)", text: "not JSON" }), []);
  assert.deepEqual(flow.providerUsage({ type: "Provider usage (cli_run)", text: JSON.stringify({ provider: "claude", response: { total_cost_usd: 0 } }) }), ["Provider-reported run cost · $0"]);
});

test("live Flow reveals newly recorded tool batches in order without replaying old cards", async () => {
  const state = {}, prompt = { key: "live", text: "Fix", flow: { eventItems: [{ kind: "model", title: "Thinking", time: 1 }] } };
  const first = flowHost(), stop = flow.mount(first.root, { prompts: [prompt] }, { state, followRight: true });
  stop();
  prompt.flow.eventItems.push(...["a", "b", "c"].map((title, i) => ({ kind: "tool", title, time: i + 2 })));
  const host = flowHost(), close = flow.mount(host.root, { prompts: [prompt] }, { state, followRight: true });
  const count = () => host.elements.filter(node => node.className?.includes("flow-operation") && node.parent).length;
  assert.equal(count(), 1);
  await new Promise(resolve => setTimeout(resolve, 280));
  const lane = host.elements.filter(node => node.className?.includes("flow-step-lane")).pop();
  assert.equal(lane.children.filter(node => node.className?.includes("flow-operation")).length, 3);
  close();
});

test("screenshot recognition previews unwrap structured answers without altering plain text", () => {
  for (const text of [JSON.stringify({ answer: "A visible dialog", navigation: null, build_command: "" }), "A visible dialog"]) {
    const prompt = { operation: "Screenshot recognition", details: [{ type: "answer", text }], events: [{ kind: "model" }, { kind: "detail", detail: 0 }] };
    const index = flow.summary(prompt);
    assert.equal(index.answerPreview, "A visible dialog");
    assert.equal(index.eventItems.find(item => item.kind === "model").preview, "A visible dialog");
    assert.equal(index.eventItems.find(item => item.title === "Response").preview, "A visible dialog");
  }
});

test("absent stages are omitted, not drawn as successful or empty steps", () => {
  assert.deepEqual(flow.stages({text:"Hello",details:[],timeline:[]}).map(s=>s.kind),["prompt"]);
  assert.deepEqual(flow.stages({text:"Hello",details:[{type:"answer",text:"Hi"}],timeline:[]}).map(s=>s.kind),["prompt","answer"]);
});

test("routing reduction shows included content and hides excluded blocks", () => {
  const prompt={text:"Explain",details:[{type:"Topic routing (Jev)",routing:{contextReduction:{beforeCharacters:1200,afterCharacters:400,
    estimatedSavedTokens:200,method:"characters/4",blocks:[{index:0,role:"user",sourcePromptNumber:1,topicId:"topic_0001",topic:"Current task",included:true,estimatedTokens:50,preview:"Explain"},{index:1,role:"user",sourcePromptNumber:2,topicId:"topic_0002",topic:"Old build task",included:false,estimatedTokens:200,preview:"Build"}]}},text:"private routing state"}],timeline:[]};
  const index=flow.summary(prompt),steps=flow.contextStages({...prompt,flow:index},3);
  assert.equal(index.contextReduction.estimatedSavedTokens,200);
  assert.match(steps[0].label,/102 \/ 302 tokens/);
  assert.match(steps[0].label,/200 saved/);
  assert.deepEqual(steps.map(step=>step.kind),["prompt","section","included","included"]);
  assert.match(steps[2].title,/^1\. Prompt 3 · Included/);
  assert.doesNotMatch(JSON.stringify(steps),/Old build task|From prompt 2/);
  assert.equal(steps[1].title,"Included · 2 blocks");
  assert.equal(flow.stages({...prompt,flow:index}).some(step=>step.kind==="excluded"),false);
  assert.doesNotMatch(JSON.stringify(index),/private routing state/);
});

test("first request shows its question as fully included context", () => {
  const stages=flow.contextStages({text:"First question",flow:{contextReduction:{beforeCharacters:2,afterCharacters:2,
    currentPromptCharacters:14,estimatedSavedTokens:0,blocks:[]}}});
  assert.deepEqual(stages.map(stage=>stage.kind),["prompt","section","included"]);
  assert.match(stages[0].label,/100% included/);
  assert.match(stages[0].label,/0 saved/);
  assert.match(stages[2].label,/First question/);
});

test("Context totals measure cumulative savings across covered requests", () => {
  const groups=[
    {prompt:{text:"1234",flow:{contextReduction:{beforeCharacters:396,afterCharacters:196}}}},
    {prompt:{text:"1234",flow:{contextReduction:{beforeCharacters:196,afterCharacters:96,reconstructed:true}}}},
    {prompt:{text:"No context record"}}
  ];
  assert.deepEqual(flow.contextStats(groups),{before:150,after:75,saved:75,percent:50,duplicateSaved:0,topicSaved:50,skillSaved:0,
    unattributedSaved:25,covered:2,total:3,reconstructed:1});
});

test("Context totals split topic and duplicate savings when the routing stages are recorded",()=>{
  const groups=[{prompt:{text:"1234",flow:{contextReduction:{beforeCharacters:396,topicAfterCharacters:196,afterCharacters:96}}}}];
  assert.deepEqual(flow.contextStats(groups),{before:100,after:25,saved:75,percent:75,duplicateSaved:25,topicSaved:50,skillSaved:0,
    unattributedSaved:0,covered:1,total:1,reconstructed:0});
});

test("prompt lane keeps executor usage separate from linked Jev usage",()=>{
  const usage=flow.groupUsage({prompt:{usage:{input:36269,cacheRead:223872,output:620}},
    children:[{costKind:"jev",usage:{input:461,output:22,cost:0.000019362,costEstimated:1}}]});
  assert.equal(usage.input,36269);
  assert.equal(usage.cacheRead,223872);
  assert.equal(usage.output,620);
  assert.equal(usage.costMissing,true);
  const lines=flow.usageLines(usage);
  assert.match(lines[0],/260\D141 in \(36\D269 new, 223\D872 cache read\) · 620 out/);
  assert.equal(lines[1],"Cost not reported");
  const jev=flow.groupUsage({prompt:{usage:{input:36269}},children:[{costKind:"jev",usage:{input:461,output:22,cost:0.000019362,costEstimated:1}}]},"jev");
  assert.equal(jev.input,461);assert.equal(jev.output,22);assert.equal(jev.cost,0.000019362);
  assert.equal(flow.usageLines(flow.groupUsage({prompt:{usage:{input:10}}}))[1],"Cost not reported");
});

test("skill search and topic choice have distinct flow titles",()=>{
 const prompt={time:1,details:[{type:"Skill search",routing:{status:"skill",skill:"build-vertex-vsix"}}],events:[{kind:"detail",detail:0,time:2}]};
 const stages=flow.chronologicalStages(prompt,[{operation:"Topic routing with Jev",time:2}]);
 assert.equal(stages.find(stage=>stage.kind==="jev"&&stage.prompt).title,"Choose topic · Jev");
 assert.equal(stages.find(stage=>stage.title==="Skill search").label,"Matched build-vertex-vsix · previous messages excluded");
});

test("step timing separates tool intervals without double-counting overlap",()=>{
  const prompt={time:1000,end:11000,details:[{tool_id:"a"},{tool_id:"b"},{tool_id:"a"},{tool_id:"b"}],
    events:[{kind:"tool",detail:0,time:2000},{kind:"tool",detail:1,time:4000},
      {kind:"tool_result",detail:2,time:6000},{kind:"tool_result",detail:3,time:7000}]};
  assert.deepEqual(flow.timeBreakdown(prompt),{totalMs:10000,toolMs:5000,modelHostMs:5000,incompleteTools:false});
});

test("matched skill excludes every prior prompt and attributes savings to skill",()=>{
  const prompt={text:"Rebuild",flow:{contextReduction:{skill:"build-vertex-vsix",beforeCharacters:400,topicAfterCharacters:400,afterCharacters:0,skillCharacters:40,
    currentPromptCharacters:7,estimatedSavedTokens:100,blocks:[]}}};
  const stages=flow.contextStages(prompt,2);
  assert.equal(stages.length,1);
  assert.match(stages[0].title,/Skill matched · build-vertex-vsix/);
  assert.equal(stages[0].label,"100% of previous conversation excluded");
  const totals=flow.contextStats([{prompt}]);
  assert.equal(totals.skillSaved,100);
  assert.equal(totals.duplicateSaved,0);
  assert.equal(totals.topicSaved,0);
});

test("Context omits a removed repetition from its visible blocks",()=>{
  const prompt={text:"Rebuild",flow:{contextReduction:{beforeCharacters:100,afterCharacters:20,estimatedSavedTokens:20,
    blocks:[{index:0,role:"user",sourcePromptNumber:2,included:false,reason:"duplicate",preferredPromptNumber:4,estimatedTokens:20,preview:"Build again"}]}}};
  const stages=flow.contextStages(prompt,5);
  assert.deepEqual(stages.map(stage=>stage.kind),["prompt","section","included"]);
  assert.doesNotMatch(JSON.stringify(stages),/Build again|Represented by prompt 4/);
});

test("Flow numbers only tool calls in the chronology, including around linked Jev and paired results", () => {
  const prompt={key:"chat:0",text:"Fix",time:10,contextSize:{estimatedTokens:120},details:[{type:"tool",name:"Read",tool_id:"x",input:{file_path:"main.js"}},
    {type:"tool result",tool_id:"x",text:"result"},{type:"answer",text:"Done"}],
    events:[{kind:"request",details:[],time:11},{kind:"tool",detail:0,time:12},{kind:"tool_result",detail:1,time:13},{kind:"detail",detail:2,time:15}]};
  const child={operation:"Change verification with Jev",time:14,flow:{jevOutcome:"Passed"}};
  const steps=flow.chronologicalStages({...prompt,flow:flow.summary(prompt)},[child]);
  assert.deepEqual(steps.map(step=>step.toolNumber),[undefined,undefined,1,undefined,undefined]);
  assert.deepEqual(steps.map(step=>step.title),["User question","Model unknown request with system prompt and tools","Read","Change verification with Jev","Response"]);
  assert.match(steps[1].label,/120 context tokens/);
  assert.equal(steps[2].detailIndex,0);
});

test("older routing indices reconstruct context only when saved history matches", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-flow-history-"));
  try {
    const log=require("../session-log").create(root,"test","older",{questions:true,answers:true});
    log.user("First question");log.assistant({model:"m",usage:{},text:"First answer"});
    log.user("Second question");log.routing({status:"routed",beforeMessages:2,keptIndices:[0],topic:{id:"topic_0001",label:"First",scope:"test"}});
    const prompt=logs.readSessions(root).sessions[0].prompts[1],index=flow.summary(prompt);
    assert.equal(index.contextReduction.reconstructed,true);
    const steps=flow.contextStages({...prompt,flow:index},2);
    assert.deepEqual(steps.map(item=>item.kind),["prompt","section","included","included"]);
    assert.match(steps[3].title,/From prompt 1/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("graph index preserves verification retries, Jev and review without bodies", () => {
  const prompt={key:"s:0",text:"Change",details:[
    {type:"Topic routing (Jev)",text:"sensitive routing state"},
    {type:"tool",name:"Read",tool_id:"r",text:"secret file body"},
    {type:"tool",name:"Verification",tool_id:"v1"},
    {type:"tool result",tool_id:"v1",text:"VERTEX automatic checks: FAILED",failed:true},
    {type:"tool",name:"Verification",tool_id:"v2"},
    {type:"tool result",tool_id:"v2",text:"VERTEX automatic checks: PASSED"},
    {type:"answer",text:"large answer body"},{type:"tool",name:"Review",tool_id:"review"}
  ],timeline:[{kind:"model",usageScope:"cli_turn"}],events:[{kind:"detail",detail:0,time:2},{kind:"tool",detail:1,time:3},
    {kind:"tool",detail:2,time:4},{kind:"tool_result",detail:3,time:5},{kind:"tool",detail:4,time:6},{kind:"tool_result",detail:5,time:7},
    {kind:"detail",detail:6,time:8},{kind:"tool",detail:7,time:9}]};
  const report=logs.listReport({sessions:[{prompts:[prompt]}]}),index=report.sessions[0].prompts[0];
  assert.equal(index.details,undefined);assert.equal(index.timeline,undefined);
  assert.deepEqual(index.flow.checks.map(c=>c.state),["failed","passed"]);
  assert.equal(index.flow.tools,1);assert.equal(index.flow.cliTurns,1);
  assert.doesNotMatch(JSON.stringify(index.flow),/sensitive|secret|large answer/);
  const steps=flow.chronologicalStages(index);
  assert.equal(steps.length,7);
  assert.deepEqual(steps.filter(s=>s.title.startsWith("Verification")).map(s=>s.state),["failed","passed"]);
  assert.equal(steps.at(-1).title,"Review");
});

test("operation groups carry a bounded first-line note preview and portable file names", () => {
  const prompt = { details: [{ type: "tool", name: "Read", input: { file_path: "C:\\src\\main.js", description: "Inspect source" } },
    { type: "tool", name: "Edit", input: { path: "src/view.js" } }], events: [
    { kind: "note", model: { text: "\nInspect the source\nFull explanation" } }, { kind: "tool", detail: 0 },
    { kind: "note", model: { text: "Update the view" } }, { kind: "tool", detail: 1 }] };
  const items = flow.summary(prompt).eventItems;
  assert.deepEqual(items.map(item => item.kind), ["note", "tool", "note", "tool"]);
  assert.deepEqual(items.filter(item => item.kind === "tool").map(item => item.notePreview), ["Inspect the source", "Update the view"]);
  assert.deepEqual(items.filter(item => item.kind === "tool").map(item => item.noteEventIndex), [0, 2]);
  assert.deepEqual(items.filter(item => item.kind === "tool").map(item => item.fileName), ["main.js", "view.js"]);
  const stages = flow.chronologicalStages({ ...prompt, flow: flow.summary(prompt) });
  assert.deepEqual(stages.filter(item => item.kind === "note" || item.kind === "tool").map(item => item.kind), ["note", "tool", "note", "tool"]);
  assert.equal(items[0].preview, "Inspect the source Full explanation");
  assert.doesNotMatch(JSON.stringify(items.filter(item => item.kind === "tool")), /Full explanation/);
});

test("missing check outcomes remain unknown and tool failures remain failed", () => {
  assert.equal(flow.summary({details:[{type:"tool",name:"Verification",tool_id:"u"},{type:"tool result",tool_id:"u",failed:true,text:"VERTEX automatic checks: UNVERIFIED"}]}).checks[0].state,"unverified");
  assert.equal(flow.summary({details:[{type:"tool",name:"Verification",tool_id:"x"}]}).checks[0].state,"unknown");
  const parsed=logs.parseSession([
    {type:"user",message:{content:"Fix"}},
    {type:"assistant",message:{content:[{type:"tool_use",id:"c",name:"Verification",input:{}}]}},
    {type:"user",message:{content:[{type:"tool_result",tool_use_id:"c",is_error:true,content:"failed to start"}]}}
  ].map(r=>JSON.stringify({timestamp:"2026-11-15T01:00:00Z",...r})).join("\n"),"codex_test.jsonl");
  assert.equal(flow.summary(parsed.prompts[0]).checks[0].state,"failed");
});
