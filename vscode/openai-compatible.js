"use strict";

const https = require("https");

// Provider endpoints from ABAP-AI-Code's ZAICODE_PROVIDER seed list. The
// Assistant calls only these fixed HTTPS hosts; keys stay in SecretStorage.
const PROVIDERS = Object.freeze({
  "openai-api": { label: "OpenAI", base: "https://api.openai.com/v1" },
  "mistral-api": { label: "Mistral", base: "https://api.mistral.ai/v1" },
  "gemini-api": { label: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai" },
  "groq-api": { label: "Groq", base: "https://api.groq.com/openai/v1" },
  "cerebras-api": { label: "Cerebras", base: "https://api.cerebras.ai/v1" },
  "openrouter-api": { label: "OpenRouter", base: "https://openrouter.ai/api/v1" },
  "nvidia-api": { label: "NVIDIA", base: "https://integrate.api.nvidia.com/v1" },
  "vercel-api": { label: "Vercel AI Gateway", base: "https://ai-gateway.vercel.sh/v1" }
});

function secretKey(id) { return "vertex.provider." + id + ".apiKey"; }

function requestJson(id, apiKey, route, body, maxBytes = 64000) {
  const provider = PROVIDERS[id];
  if (!provider) { return Promise.reject(new Error("Unknown API provider: " + id)); }
  if (!apiKey) { return Promise.reject(new Error("No " + provider.label + " API key is configured. Enter it in LLM Providers.")); }
  const payload = body == null ? null : JSON.stringify(body);
  if (payload && Buffer.byteLength(payload, "utf8") > maxBytes) {
    return Promise.reject(new Error("VERTEX: request exceeds " + (maxBytes === 64000 ? "64 KB" : (maxBytes / 1024) + " KiB") + "; narrow the context or start a new conversation."));
  }
  const url = new URL(provider.base + route);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: payload ? "POST" : "GET", headers: {
      authorization: "Bearer " + apiKey, ...(payload ? { "content-type": "application/json",
        "content-length": Buffer.byteLength(payload, "utf8") } : {})
    } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", part => {
        text += part;
        if (Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024) {
          req.destroy(new Error(provider.label + " response exceeds 8 MB."));
        }
      });
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
        if (res.statusCode < 200 || res.statusCode >= 300 || !parsed) {
          reject(new Error(provider.label + " API returned " + res.statusCode + ": "
            + String(parsed && parsed.error && (parsed.error.message || parsed.error) || text).slice(0, 500)));
        } else { resolve(parsed); }
      });
    });
    req.on("error", reject);
    req.setTimeout(payload ? 180000 : 60000, () => req.destroy(new Error(provider.label + " API timed out.")));
    req.end(payload || undefined);
  });
}

async function models(id, apiKey, request = requestJson) {
  const response = await request(id, apiKey, "/models");
  if (!Array.isArray(response.data)) { throw new Error(PROVIDERS[id].label + " did not return a model list."); }
  // Vercel also lists non-chat models and asynchronous batch variants.
  const list = response.data.filter(item => item && item.id && (id !== "vercel-api" || (item.type === "language"
    && !/(?:^|[-_/])batch(?:$|[-_/])/i.test(String(item.id))
    && !/\bbatch\b/i.test(String(item.name || item.display_name || ""))))).map(item => ({
    id: String(item.id), label: String(item.name || item.display_name || item.id)
  }));
  if (!list.length) { throw new Error(PROVIDERS[id].label + " returned no models for this key."); }
  return list.sort((a, b) => a.label.localeCompare(b.label));
}

async function ask(options) {
  const id = options.assistant;
  const request = options.request || requestJson;
  const tools = (options.tools || []).map(tool => ({ type: "function", function: {
    name: tool.name, description: tool.description, parameters: tool.inputSchema
  } })).concat([{ type: "function", function: { name: "submit_vertex_answer",
    description: "Submit the final VERTEX answer and navigation plan.", parameters: options.schema } }]);
  const messages = [{ role: "system", content: options.instructions }, { role: "user", content: options.prompt }];
  let usage = null;
  for (let round = 0; round < (options.maxRounds || 12); round += 1) {
    const response = await request(id, options.apiKey, "/chat/completions", {
      model: options.model, messages, tools, stream: false
    }, options.localTools ? 2 * 1024 * 1024 : 64000);
    if (options.onProviderResponse) options.onProviderResponse({ provider: id, scope: "model_response", response });
    let roundUsage = null;
    if (response.usage) {
      const raw = response.usage;
      const cached = Number(raw.prompt_tokens_details?.cached_tokens ?? raw.cache_read_input_tokens ?? 0) || 0;
      const created = Number(raw.cache_creation_input_tokens ?? 0) || 0;
      const prompt = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0;
      const next = { input_tokens: raw.prompt_tokens == null ? prompt : Math.max(0, prompt - cached - created),
        output_tokens: Number(raw.completion_tokens ?? raw.output_tokens ?? 0) || 0,
        cache_read_input_tokens: cached, cache_creation_input_tokens: created };
      roundUsage = next;
      if (!usage) usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      for (const key of Object.keys(usage)) usage[key] += next[key];
    }
    const message = response.choices && response.choices[0] && response.choices[0].message;
    if (!message) { throw new Error(PROVIDERS[id].label + " answered without a chat message."); }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const final = calls.find(call => call.function && call.function.name === "submit_vertex_answer");
    if (final) {
      let plan;
      try { plan = JSON.parse(final.function.arguments || "{}"); } catch (_) { throw new Error(PROVIDERS[id].label + " returned an invalid VERTEX plan."); }
      if (typeof plan.answer !== "string") { throw new Error(PROVIDERS[id].label + " returned a VERTEX plan without an answer."); }
      if (options.onModelCall) options.onModelCall({ model: response.model || options.model, usage: roundUsage, text: plan.answer });
      return { plan, model: options.model, usage };
    }
    if (!calls.length) {
      const answer = typeof message.content === "string" ? message.content.trim() : "";
      if (answer) {
        if (options.onModelCall) options.onModelCall({ model: response.model || options.model, usage: roundUsage, text: answer });
        return { plan: { answer, navigation: null }, model: options.model, usage };
      }
      throw new Error(PROVIDERS[id].label + " answered without text or a VERTEX plan.");
    }
    if (options.onModelCall) options.onModelCall({ model: response.model || options.model, usage: roundUsage,
      text: typeof message.content === "string" ? message.content : "" });
    messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });
    for (const call of calls) {
      const name = call.function && call.function.name;
      if (!(options.tools || []).some(tool => tool.name === name)) {
        throw new Error(PROVIDERS[id].label + " requested an unavailable tool: " + name);
      }
      let content;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        content = JSON.stringify(await options.callTool(name, args));
      } catch (error) { content = JSON.stringify({ error: error.message }); }
      if (Buffer.byteLength(content, "utf8") > 24000) {
        content = "Result too large for chat. Ask the user to narrow the request; the full result was not sent.";
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new Error(PROVIDERS[id].label + " did not finish the VERTEX plan.");
}

module.exports = { PROVIDERS, secretKey, requestJson, models, ask };
