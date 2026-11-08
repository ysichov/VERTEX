"use strict";

// Direct Anthropic Messages API. The key stays in VS Code SecretStorage; this
// module only receives it for the duration of one request.
const https = require("https");

/* The models this key can use, as GET /v1/models lists them - so a new model
   shows up without a new VERTEX. A haiku comes first: it is what a request
   uses when no model was chosen. */
function models(apiKey) {
  if (!apiKey) { return Promise.reject(new Error("No Anthropic API key is configured. Choose Anthropic API again and enter a key.")); }
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: "api.anthropic.com", path: "/v1/models?limit=1000", method: "GET",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", part => { text += part; });
      res.on("end", () => {
        let answer;
        try { answer = JSON.parse(text); } catch (_) { answer = null; }
        if (res.statusCode !== 200 || !answer || !Array.isArray(answer.data)) {
          reject(new Error("Anthropic API did not list its models (" + res.statusCode + "): "
            + (answer && answer.error && answer.error.message || text.substring(0, 500))));
          return;
        }
        const list = answer.data.map(m => ({ id: m.id, label: m.display_name || m.id }));
        if (!list.length) { reject(new Error("Anthropic API listed no models for this key.")); return; }
        const haiku = list.findIndex(m => /haiku/i.test(m.id));
        if (haiku > 0) { list.unshift(list.splice(haiku, 1)[0]); }
        resolve(list);
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Anthropic API did not list its models within a minute.")));
    req.end();
  });
}

function request(apiKey, body, maxBytes = 64000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    // Enforce at the transport boundary, including history, schemas and tool
    // results. This is a byte ceiling, not an estimated token count.
    if (Buffer.byteLength(payload, "utf8") > maxBytes) {
      reject(new Error("VERTEX: request exceeds " + (maxBytes === 64000 ? "64 KB" : (maxBytes / 1024) + " KiB") + "; nothing was sent to Anthropic. Start a new conversation or narrow the context."));
      return;
    }
    const req = https.request({ hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: {
      "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json",
      "content-length": Buffer.byteLength(payload) } }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", part => { text += part; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.setTimeout(180000, () => req.destroy(new Error("Anthropic API request timed out.")));
    req.end(payload);
  });
}

async function ask(options) {
  if (!options.apiKey) { throw new Error("No Anthropic API key is configured. Choose Anthropic API again and enter a key."); }
  // Read again each step: a toolset the model enabled adds tools to options.tools during the request.
  const toolsNow = () => options.textOnly ? [] : (options.tools || []).map(tool => ({ name: tool.name, description: tool.description,
    input_schema: tool.inputSchema })).concat([{ name: "submit_vertex_answer",
      description: "Submit the final VERTEX answer and navigation plan.", input_schema: options.schema }]);
  let apiTools = toolsNow();
  const messages = [{ role: "user", content: options.prompt }];
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (let round = 0; round < (options.maxRounds || 12); round += 1) {
    apiTools = toolsNow();
    const response = await request(options.apiKey, { model: options.model, max_tokens: options.maxOutputTokens || 16000,
      system: options.instructions, messages, ...(apiTools.length ? {tools:apiTools} : {}) },
      // The limit is on the conversation and its context; the tool definitions come on top of it.
      (options.maxInputBytes || (options.localTools ? 2 * 1024 * 1024 : 64000)) + (apiTools.length ? Buffer.byteLength(JSON.stringify(apiTools), "utf8") : 0));
    let answer;
    try { answer = JSON.parse(response.text); } catch (_) { answer = null; }
    if (answer && options.onProviderResponse) options.onProviderResponse({
      provider: "anthropic-api", scope: "model_response", response: answer });
    if (response.status !== 200 || !answer) {
      throw new Error("Anthropic API returned " + response.status + ": "
        + (answer && answer.error && answer.error.message || response.text.substring(0, 500)));
    }
    for (const key of Object.keys(usage)) { usage[key] += Number(answer.usage && answer.usage[key]) || 0; }
    const roundUsage = answer.usage || null;
    const calls = (answer.content || []).filter(block => block.type === "tool_use");
    const final = calls.find(call => call.name === "submit_vertex_answer");
    if (final) {
      if (options.onModelCall) options.onModelCall({ model: answer.model || options.model, usage: roundUsage, text: final.input?.answer || "" });
      return { plan: final.input, model: options.model, usage };
    }
    const responseText = (answer.content || []).filter(block => block.type === "text")
      .map(block => block.text || "").join("\n").trim();
    if (options.onModelCall) options.onModelCall({ model: answer.model || options.model, usage: roundUsage, text: responseText });
    if (!calls.length) {
      // The Messages API is allowed to answer with text even when tools were
      // offered. A concise explanation of a supplied method is already a
      // useful completed answer; only navigation is absent in that case.
      if (responseText) { return { plan: { answer: responseText, navigation: null }, model: options.model, usage }; }
      throw new Error("Anthropic API answered without text or a VERTEX plan.");
    }
    messages.push({ role: "assistant", content: answer.content });
    const results = [];
    for (const call of calls) {
      if (!(options.tools || []).some(tool => tool.name === call.name)) {
        throw new Error("Anthropic requested an unavailable tool: " + call.name);
      }
      let content, isError = false;
      try { content = JSON.stringify(await options.callTool(call.name, call.input || {})); }
      catch (error) { content = JSON.stringify({ error: error.message }); isError = true; }
      if (Buffer.byteLength(content, "utf8") > 24000) {
        content = "Result too large for chat. Ask the user to open the relevant method in VERTEX; the full source was not sent.";
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: call.id, is_error: isError, content });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("Anthropic API did not finish the VERTEX plan.");
}

module.exports = { models, ask };
