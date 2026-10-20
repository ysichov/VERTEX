"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../openai-compatible");
const modelConfig = require("../model-config");

test("API provider catalog matches the ABAP-AI-Code key providers", () => {
  assert.deepEqual(Object.keys(api.PROVIDERS), ["openai-api", "mistral-api", "gemini-api", "groq-api",
    "cerebras-api", "openrouter-api", "nvidia-api"]);
  for (const id of Object.keys(api.PROVIDERS)) {
    assert.ok(modelConfig.PROVIDERS.some(provider => provider.id === id && provider.setting === id));
    assert.match(api.PROVIDERS[id].base, /^https:\/\//);
  }
});

test("LLM Providers offers an independent fold control for each model list", () => {
  const panel = { webview: { onDidReceiveMessage: () => {} } };
  const vscode = { ViewColumn: { Active: 1 }, window: { createWebviewPanel: () => panel },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => key === "provider" ? "copilot" : fallback }) } };
  modelConfig.open(vscode, async () => [], () => "", () => {}, null);
  assert.match(panel.webview.html, /Collapse models/);
  assert.match(panel.webview.html, /s\.expanded = !s\.expanded/);
  assert.match(panel.webview.html, /body\.hidden = !s\.expanded/);
  assert.match(panel.webview.html, /if \(!s\.rows\.length\)/);
  assert.match(panel.webview.html, /no models were returned/);
  assert.match(panel.webview.html, /this is not an account sign-in check/);
  assert.match(panel.webview.html, /select-key/);
  assert.match(panel.webview.html, /all \? "Clear all" : "Select all"/);
  assert.match(panel.webview.html, /s\.rows\.forEach\(r => \{ r\.on = next; \}\)/);
  assert.match(panel.webview.html, /Open logging settings/);
});

test("LLM Providers gear opens the logging settings", async () => {
  let receive, command;
  const panel = { webview: { onDidReceiveMessage: callback => { receive = callback; } } };
  const vscode = { ViewColumn: { Active: 1 }, commands: { executeCommand: async (...args) => { command = args; } },
    window: { createWebviewPanel: () => panel },
    workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback }) } };
  modelConfig.open(vscode, async () => [], () => "", () => {}, null);
  await receive({ action: "log-settings" });
  assert.deepEqual(command, ["workbench.action.openSettings", "vertex.ai.log"]);
});

test("log folder button picks a directory and saves its path", async () => {
  let receive, saved;
  const folder = { scheme: "file", fsPath: "C:\\logs" };
  const panel = { webview: { onDidReceiveMessage: callback => { receive = callback; }, postMessage: () => {} } };
  const vscode = { ViewColumn: { Active: 1 }, ConfigurationTarget: { Global: 1 }, Uri: { file: fsPath => ({ fsPath }) },
    window: { createWebviewPanel: () => panel, showOpenDialog: async options => {
      assert.equal(options.canSelectFolders, true); assert.equal(options.canSelectFiles, false); return [folder]; } },
    workspace: { getConfiguration: () => ({ get: (_, fallback) => fallback,
      update: async (key, value) => { saved = [key, value]; } }) } };
  modelConfig.open(vscode, async () => [], () => "", () => {}, null);
  await receive({ action: "choose-log-folder" });
  assert.deepEqual(saved, ["logPath", "C:\\logs"]);
});

test("API model list uses the selected provider and labels", async () => {
  const calls = [];
  const list = await api.models("gemini-api", "secret", async (...args) => {
    calls.push(args); return { data: [{ id: "gemini-z", name: "Z" }, { id: "gemini-a", name: "A" }] };
  });
  assert.deepEqual(calls, [["gemini-api", "secret", "/models"]]);
  assert.deepEqual(list, [{ id: "gemini-a", label: "A" }, { id: "gemini-z", label: "Z" }]);
});

test("OpenAI-compatible provider executes SAP tools and accepts a final plan", async () => {
  const requests = [], toolCalls = [], modelCalls = [];
  const answers = [{ usage: { prompt_tokens: 120, completion_tokens: 15, prompt_tokens_details: { cached_tokens: 20 } }, choices: [{ message: { role: "assistant", content: null, tool_calls: [{
    id: "call-1", type: "function", function: { name: "read_sap_object", arguments: '{"object_name":"ZCL_A"}' }
  }] } }] }, { usage: { prompt_tokens: 160, completion_tokens: 25, prompt_tokens_details: { cached_tokens: 30 } }, choices: [{ message: { role: "assistant", content: null, tool_calls: [{
    id: "call-2", type: "function", function: { name: "submit_vertex_answer",
      arguments: '{"answer":"Класс прочитан","navigation":null}' }
  }] } }] }];
  const result = await api.ask({ assistant: "mistral-api", apiKey: "secret", model: "mistral-test",
    instructions: "Use SAP tools", prompt: "Read class", schema: { type: "object" },
    onModelCall: call => modelCalls.push(call),
    tools: [{ name: "read_sap_object", description: "Read", inputSchema: { type: "object" } }],
    request: async (id, key, route, body) => { requests.push({ id, key, route, body }); return answers.shift(); },
    callTool: async (name, args) => { toolCalls.push([name, args]); return { source: "CLASS zcl_a." }; } });
  assert.deepEqual(result.plan, { answer: "Класс прочитан", navigation: null });
  assert.deepEqual(result.usage, { input_tokens: 230, output_tokens: 40,
    cache_read_input_tokens: 50, cache_creation_input_tokens: 0 });
  assert.equal(modelCalls.length, 2);
  assert.deepEqual(modelCalls.map(call => call.usage.input_tokens), [100, 130]);
  assert.equal(modelCalls[1].text, "Класс прочитан");
  assert.deepEqual(toolCalls, [["read_sap_object", { object_name: "ZCL_A" }]]);
  assert.equal(requests[0].route, "/chat/completions");
  assert.equal(requests[0].body.tools[0].function.name, "read_sap_object");
  assert.deepEqual(requests[1].body.messages.at(-1), {
    role: "tool", tool_call_id: "call-1", content: '{"source":"CLASS zcl_a."}'
  });
});
