"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const copilot = require("../copilot");

class TextPart { constructor(value) { this.value = value; } }
class ToolCallPart { constructor(callId, name, input) { Object.assign(this, { callId, name, input }); } }
class ToolResultPart { constructor(callId, content) { Object.assign(this, { callId, content }); } }

function fixture(responses) {
  const requests = [];
  const model = { id: "copilot-test", name: "Copilot Test", sendRequest: async (messages, options, token) => {
    requests.push({ messages: [...messages], options, token });
    const parts = responses.shift();
    return { stream: (async function* () { for (const part of parts) { yield part; } })() };
  } };
  return { requests, vscode: { lm: { selectChatModels: async filter => {
    assert.deepEqual(filter, { vendor: "copilot" }); return [model];
  } }, CancellationTokenSource: class { constructor() { this.token = { isCancellationRequested: false }; } dispose() {} },
  LanguageModelTextPart: TextPart,
  LanguageModelToolCallPart: ToolCallPart, LanguageModelToolResultPart: ToolResultPart,
  LanguageModelChatMessage: { User: content => ({ role: "user", content }),
    Assistant: content => ({ role: "assistant", content }) } } };
}

test("Copilot model uses VERTEX tools and returns a navigation plan", async () => {
  const { vscode, requests } = fixture([
    [new ToolCallPart("1", "read_sap_object", { object_name: "ZCL_TEST" })],
    [new ToolCallPart("2", "submit_vertex_answer", { answer: "Готово", navigation: null })]
  ]);
  assert.deepEqual(await copilot.models(vscode), [{ id: "copilot-test", label: "Copilot Test" }]);
  const calls = [], rounds = [];
  const result = await copilot.ask(vscode, { model: "copilot-test", instructions: "SAP instructions",
    prompt: "Read class", schema: { type: "object" },
    onModelCall: round => rounds.push(round),
    tools: [{ name: "read_sap_object", description: "Read", inputSchema: { type: "object" } }],
    callTool: async (name, args) => { calls.push([name, args]); return { source: "CLASS zcl_test." }; } });
  assert.deepEqual(calls, [["read_sap_object", { object_name: "ZCL_TEST" }]]);
  assert.deepEqual(result.plan, { answer: "Готово", navigation: null });
  assert.equal(requests.length, 2);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[1].text, "Готово");
  assert.equal(requests[0].token.isCancellationRequested, false);
  assert.match(requests[0].messages[0].content, /SAP instructions.*Read class/s);
  assert.equal(requests[1].messages[2].content[0].callId, "1");
  assert.match(requests[1].messages[2].content[0].content[0].value, /CLASS zcl_test/);
});

test("Copilot accepts a plain text answer for a question that needs no tools", async () => {
  const { vscode } = fixture([[new TextPart("This method appends a row.")]]);
  const result = await copilot.ask(vscode, { model: "copilot-test", instructions: "Explain", prompt: "What does it do?", tools: [] });
  assert.deepEqual(result.plan, { answer: "This method appends a row.", navigation: null });
});

test('Copilot commit generation omits all tools including submit_vertex_answer',async()=>{
 const {vscode,requests}=fixture([[new TextPart('Improve review')]]);
 const result=await copilot.ask(vscode,{model:'copilot-test',instructions:'Draft only',prompt:'Diff',textOnly:true,tools:[]});
 assert.equal(result.plan.answer,'Improve review');assert.deepEqual(requests[0].options,{});
});
