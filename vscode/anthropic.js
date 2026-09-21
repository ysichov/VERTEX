"use strict";

// Direct Anthropic Messages API. The key stays in VS Code SecretStorage; this
// module only receives it for the duration of one request.
const https = require("https");
const MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "haiku" },
  { id: "claude-sonnet-5", label: "sonnet" },
  { id: "claude-opus-5", label: "opus" }
];

function request(apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    // Enforce at the transport boundary, including history, schemas and tool
    // results. This is a byte ceiling, not an estimated token count.
    if (Buffer.byteLength(payload, "utf8") > 64000) {
      reject(new Error("VERTEX: request exceeds 64 KB; nothing was sent to Anthropic. Start a new conversation or narrow the context."));
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
  const apiTools = (options.tools || []).map(tool => ({ name: tool.name, description: tool.description,
    input_schema: tool.inputSchema })).concat([{ name: "submit_vertex_answer",
      description: "Submit the final VERTEX answer and navigation plan.", input_schema: options.schema }]);
  const messages = [{ role: "user", content: options.prompt }];
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (let round = 0; round < 12; round += 1) {
    const response = await request(options.apiKey, { model: options.model || MODELS[0].id, max_tokens: 16000,
      system: options.instructions, messages, tools: apiTools });
    let answer;
    try { answer = JSON.parse(response.text); } catch (_) { answer = null; }
    if (response.status !== 200 || !answer) {
      throw new Error("Anthropic API returned " + response.status + ": "
        + (answer && answer.error && answer.error.message || response.text.substring(0, 500)));
    }
    for (const key of Object.keys(usage)) { usage[key] += Number(answer.usage && answer.usage[key]) || 0; }
    const calls = (answer.content || []).filter(block => block.type === "tool_use");
    const final = calls.find(call => call.name === "submit_vertex_answer");
    if (final) { return { plan: final.input, model: options.model || MODELS[0].id, usage }; }
    if (!calls.length) {
      // The Messages API is allowed to answer with text even when tools were
      // offered. A concise explanation of a supplied method is already a
      // useful completed answer; only navigation is absent in that case.
      const text = (answer.content || []).filter(block => block.type === "text")
        .map(block => block.text || "").join("\n").trim();
      if (text) { return { plan: { answer: text, navigation: null }, model: options.model || MODELS[0].id, usage }; }
      throw new Error("Anthropic API answered without text or a VERTEX plan.");
    }
    messages.push({ role: "assistant", content: answer.content });
    messages.push({ role: "user", content: calls.map(async call => {
      if (!(options.tools || []).some(tool => tool.name === call.name)) {
        throw new Error("Anthropic requested an unavailable tool: " + call.name);
      }
      const content = JSON.stringify(await options.callTool(call.name, call.input || {}));
      return { type: "tool_result", tool_use_id: call.id,
        is_error: Buffer.byteLength(content, "utf8") > 24000,
        content: Buffer.byteLength(content, "utf8") > 24000
          ? "Result too large for chat. Ask the user to open the relevant method in VERTEX; the full source was not sent." : content };
    }) });
    // Tool results must be resolved before sending the next Messages request.
    messages[messages.length - 1].content = await Promise.all(messages[messages.length - 1].content);
  }
  throw new Error("Anthropic API did not finish the VERTEX plan.");
}

module.exports = { MODELS, ask };
