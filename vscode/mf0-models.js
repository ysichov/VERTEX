"use strict";

const { randomUUID } = require("node:crypto");
const groups = {
  text: [
    "gpt-6.2-astra", "gpt-6.2-sol",
    "claude-fable-5-2", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-6",
    "claude-haiku-4-5", "claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6",
    "deepseek-v4-1-flash-economy-261017", "deepseek-v4-1-flash-261017", "deepseek-v4-pro-ga-260813",
    "deepseek-v4-flash-ga-260731", "deepseek-v4-flash-260425",
    "glm-5.3", "glm-5.3-flash", "glm-5-3-flash-260828", "glm-5-2-260617",
    "dola-seed-2-1-turbo-260628", "seed-2-0-mini-260428", "seed-2-0-lite-260428", "seed-2-0-code-preview-260328"
  ],
  image: ["qwen-2-pro", "qwen-image-3", "seedream-5-5", "seedream-5-flash", "seedream-5-pro", "seedream-5-lite", "seedream-4-5"],
  video: ["seedance-2", "seedance-2-5", "seedance-2-0-mini", "seedance-2-0-fast", "wan-2-7", "wan-3-0", "wan-3-0-prime"],
  "3d": ["hitem3d-2-0", "hyper3d-gen2"]
};
const catalog = Object.entries(groups).flatMap(([kind, ids]) => ids.map(id => ({ id, kind })));

async function probe(key, { id, kind }, request = fetch) {
  const payload = { model: id, prompt: kind === "text" ? "Reply OK." : "A small green triangle" };
  if (kind === "text") payload.maxTokens = 8;
  if (kind === "image") payload.aspect = "1:1";
  if (kind === "video") Object.assign(payload, { duration: 4, aspect: "16:9", resolution: "480p", audio: false });
  const { response, body } = await generate(key, payload, { request });
  if (response.status === 402 && body?.error === "insufficient_balance") {
    return { available: true, status: "Detected · insufficient balance" };
  }
  if (response.ok && body && body.ok !== false) return { available: true, status: "Accepted by MF0.AI" };
  return { available: false, status: "Not confirmed · HTTP " + response.status, httpStatus: response.status };
}

async function generate(key, payload, { request = fetch, signal, timeout = 15000 } = {}) {
  if (!key) throw new Error("Add an MF0.AI API key first.");
  const limit = AbortSignal.timeout(timeout);
  const response = await request("https://www.mf0.ai/api/v1/generations", {
    method: "POST",
    headers: { "X-API-Key": key, "Idempotency-Key": randomUUID(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, limit]) : limit
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function ask(options) {
  const model = catalog.find(entry => entry.id === options.model);
  if (model?.kind !== "text") throw new Error("Select a text model for MF0.AI chat.");
  if (options.images?.length) throw new Error("MF0.AI text chat does not accept screenshots.");
  const structured = options.structuredResult ? "\nReturn JSON matching this schema: " + JSON.stringify(options.schema) : "";
  const prompt = [options.instructions, "Answer from the supplied context. You cannot call tools.", options.prompt, structured].filter(Boolean).join("\n\n");
  const { response, body } = await generate(options.apiKey, { model: model.id, prompt, maxTokens: options.maxOutputTokens || 4096 },
    { signal: options.signal, timeout: options.timeout || 60000, request: options.mf0Request });
  if (!response.ok || body?.ok === false) {
    const balance = body?.error === "insufficient_balance" ? " (insufficient_balance)" : "";
    throw new Error("MF0.AI generation returned HTTP " + response.status + balance + ".");
  }
  const answer = [body?.text, body?.result?.text, body?.output?.text, body?.data?.text, body?.data?.result?.text, body?.output, body?.result, body?.choices?.[0]?.message?.content]
    .find(value => typeof value === "string" && value.trim());
  if (!answer) throw new Error("MF0.AI returned no text. The generation may still be pending or use an unrecognized response format.");
  const plan = options.structuredResult ? JSON.parse(answer) : { answer, navigation: null };
  const usage = body.usage || body.data?.usage || {};
  options.onProviderResponse?.({ provider: "mf0-api", scope: "model_response", response: { model: model.id, usage } });
  options.onModelCall?.({ model: model.id, usage, text: answer });
  return { plan, model: model.id, usage };
}

module.exports = { catalog, probe, ask };
