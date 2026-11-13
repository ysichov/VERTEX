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
  // Read again each step: a toolset the model enabled adds tools to options.tools during the request.
  const toolsNow = () => options.structuredResult ? [{name:"submit_vertex_answer",description:"Return the required structured result directly.",inputSchema:options.schema}] : options.textOnly ? [] : (options.tools || []).map(tool => ({ name: tool.name, description: tool.description,
    inputSchema: tool.inputSchema })).concat([{ name: "submit_vertex_answer",
    description: "Submit the final VERTEX answer and navigation plan.", inputSchema: options.schema }]);
  async function retryAnswer(plan){
    const feedback=await options.onBeforeAnswer?.(plan);if(!feedback)return false;
    messages.push(vscode.LanguageModelChatMessage.Assistant(plan.answer||""),vscode.LanguageModelChatMessage.User(feedback));return true;
  }
  const cancellation = new vscode.CancellationTokenSource();
  const abort = () => cancellation.cancel();
  options.signal?.addEventListener('abort',abort,{once:true});
  if(options.signal?.aborted) abort();
  try {
  for (let round = 0; round < (options.maxRounds || 12); round += 1) {
    const tools = toolsNow();
    const response = await model.sendRequest(messages, tools.length ? { tools } : {}, cancellation.token);
    const parts = [];
    for await (const part of response.stream) { parts.push(part); }
    const calls = parts.filter(part => part instanceof vscode.LanguageModelToolCallPart);
    const final = calls.find(call => call.name === "submit_vertex_answer");
    if (final) {
      if(await retryAnswer(final.input))continue;
      if (options.onModelCall) options.onModelCall({ model: model.id, usage: null, text: options.structuredResult?JSON.stringify(final.input):final.input?.answer || "" });
      return { plan: final.input, model: model.id, usage: null };
    }
    const responseText = parts.filter(part => part instanceof vscode.LanguageModelTextPart)
      .map(part => part.value || "").join("").trim();
    if (!calls.length && options.structuredResult){
      options.onModelCall?.({model:model.id,usage:null,text:responseText});
      let structured;try{structured=JSON.parse(responseText);}catch(_){throw Object.assign(new Error("Copilot returned invalid structured JSON."),{code:"STRUCTURED_FORMAT"});}
      return {plan:structured,model:model.id,usage:null};
    }
    if (!calls.length) {
      if(responseText&&await retryAnswer({answer:responseText,navigation:null}))continue;
      if (options.onModelCall) options.onModelCall({ model: model.id, usage: null, text: responseText });
      if (responseText) { return { plan: { answer: responseText, navigation: null }, model: model.id, usage: null }; }
      throw new Error("Copilot answered without text or a VERTEX plan.");
    }
    if (options.onModelCall) options.onModelCall({ model: model.id, usage: null, text: responseText });
    messages.push(vscode.LanguageModelChatMessage.Assistant(parts));
    const results = [];
    for (const call of calls) {
      options.signal?.throwIfAborted();
      let content;
      try {
        if (!(options.tools || []).some(tool => tool.name === call.name)) {
          const error=new Error("Copilot requested an unavailable tool: " + call.name + ". Only supplied functions are available; report the missing capability.");
          if(!options.recoverUnavailableTools)throw Object.assign(error,{orchestratorFatal:true});
          throw error;
        }
        content = require("./tool-result").bound(await options.callTool(call.name, call.input || {})); }
      catch (error) { if(error.orchestratorFatal||options.signal?.aborted)throw error;content = JSON.stringify({ error: error.message }); }
      results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(content)]));
    }
    messages.push(vscode.LanguageModelChatMessage.User(results));
  }
  throw new Error("Copilot did not finish the VERTEX plan.");
  } finally { options.signal?.removeEventListener('abort',abort); cancellation.dispose(); }
}

module.exports = { models, ask };
