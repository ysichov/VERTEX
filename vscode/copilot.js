"use strict";

// Run the VERTEX assistant with a Copilot model exposed through VS Code's
// Language Model API. The SAP tools stay private to this request.
async function models(vscode) {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
    throw new Error("This VS Code does not expose the Language Model API.");
  }
  const found = await vscode.lm.selectChatModels({ vendor: "copilot" });
  if (!found.length) {
    throw new Error("No GitHub Copilot models are available. Install and sign in to GitHub Copilot in VS Code.");
  }
  return found.map(model => ({ id: model.id, label: model.name || model.id }));
}

async function ask(vscode, options) {
  const found = await vscode.lm.selectChatModels({ vendor: "copilot" });
  const model = found.find(item => item.id === options.model);
  if (!model) { throw new Error("Copilot model " + options.model + " is unavailable. Open VERTEX: LLM Providers and choose an available model."); }
  const messages = [vscode.LanguageModelChatMessage.User(options.instructions + "\n\n" + options.prompt)];
  const tools = options.textOnly ? [] : (options.tools || []).map(tool => ({ name: tool.name, description: tool.description,
    inputSchema: tool.inputSchema })).concat([{ name: "submit_vertex_answer",
    description: "Submit the final VERTEX answer and navigation plan.", inputSchema: options.schema }]);
  const cancellation = new vscode.CancellationTokenSource();
  try {
  for (let round = 0; round < (options.maxRounds || 12); round += 1) {
    const response = await model.sendRequest(messages, tools.length ? { tools } : {}, cancellation.token);
    const parts = [];
    for await (const part of response.stream) { parts.push(part); }
    const calls = parts.filter(part => part instanceof vscode.LanguageModelToolCallPart);
    const final = calls.find(call => call.name === "submit_vertex_answer");
    if (final) {
      if (options.onModelCall) options.onModelCall({ model: model.id, usage: null, text: final.input?.answer || "" });
      return { plan: final.input, model: model.id, usage: null };
    }
    const responseText = parts.filter(part => part instanceof vscode.LanguageModelTextPart)
      .map(part => part.value || "").join("").trim();
    if (options.onModelCall) options.onModelCall({ model: model.id, usage: null, text: responseText });
    if (!calls.length) {
      if (responseText) { return { plan: { answer: responseText, navigation: null }, model: model.id, usage: null }; }
      throw new Error("Copilot answered without text or a VERTEX plan.");
    }
    messages.push(vscode.LanguageModelChatMessage.Assistant(parts));
    const results = [];
    for (const call of calls) {
      if (!(options.tools || []).some(tool => tool.name === call.name)) {
        throw new Error("Copilot requested an unavailable tool: " + call.name);
      }
      let content;
      try { content = JSON.stringify(await options.callTool(call.name, call.input || {})); }
      catch (error) { content = JSON.stringify({ error: error.message }); }
      if (Buffer.byteLength(content, "utf8") > 24000) {
        content = "Result too large for chat. Ask the user to narrow the request; the full result was not sent.";
      }
      results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(content)]));
    }
    messages.push(vscode.LanguageModelChatMessage.User(results));
  }
  throw new Error("Copilot did not finish the VERTEX plan.");
  } finally { cancellation.dispose(); }
}

module.exports = { models, ask };
