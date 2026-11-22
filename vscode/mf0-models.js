"use strict";

const { randomUUID } = require("node:crypto");

// Fixed MF0.AI text-model list and published prices supplied for VERTEX.
// Prices are USD per one million tokens; strings preserve the ranges as given.
const catalog = [
  ["GPT-6.2 Astra", "gpt-6.2-astra", "8–16", "40–60", "ChatGPT"],
  ["GPT-6.2 Sol", "gpt-6.2-sol", "2–4", "10–15", "ChatGPT"],
  ["Claude Fable 5.2", "claude-fable-5-2", "8.00", "40.00", "Claude"],
  ["Claude Opus 5", "claude-opus-5", "5.00", "25.00", "Claude"],
  ["Claude Opus", "claude-opus-4-8", "5.00", "25.00", "Claude"],
  ["Claude Opus 4.6", "claude-opus-4-6", "5.00", "25.00", "Claude"],
  ["Claude Haiku", "claude-haiku-4-5", "1.00", "5.00", "Claude"],
  ["Claude Haiku 5.5", "claude-haiku-5-5", "0.10", "0.50", "Claude"],
  ["Claude Sonnet 5.5", "claude-sonnet-5-5", "2.00", "10.00", "Claude"],
  ["Claude Sonnet 5", "claude-sonnet-5", "2.00", "10.00", "Claude"],
  ["Claude Sonnet", "claude-sonnet-4-6", "3.00", "15.00", "Claude"],
  ["DeepSeek V4.1 Flash Economy", "deepseek-v4-1-flash-economy-261017", "0.12–0.24", "0.48–0.96", "DeepSeek"],
  ["DeepSeek V4.1 Flash", "deepseek-v4-1-flash-261017", "0.15–0.30", "0.60–1.20", "DeepSeek"],
  ["DeepSeek V4 Pro GA", "deepseek-v4-pro-ga-260813", "1.32", "3.96", "DeepSeek"],
  ["DeepSeek V4 Flash GA", "deepseek-v4-flash-ga-260731", "0.44", "1.32", "DeepSeek"],
  ["DeepSeek V4 Flash", "deepseek-v4-flash-260425", "0.44", "1.32", "DeepSeek"],
  ["GLM 5.3", "glm-5.3", "0.90", "4.00", "GLM"],
  ["GLM 5.3 Flash", "glm-5.3-flash", "0.075", "0.25", "GLM"],
  ["GLM 5.3 Flash", "glm-5-3-flash-260828", "0.15", "0.50", "GLM"],
  ["GLM 5.2", "glm-5-2-260617", "1.40", "4.40", "GLM"],
  ["Dola Seed 2.1 Turbo", "dola-seed-2-1-turbo-260628", "0.50", "2.50", "Seed"],
  ["Seed 2.0 Mini", "seed-2-0-mini-260428", "0.10–0.20", "0.40–0.80", "Seed"],
  ["Seed 2.0 Lite", "seed-2-0-lite-260428", "0.25–0.50", "2.00–4.00", "Seed"],
  ["Seed 2.0 Code Preview", "seed-2-0-code-preview-260328", "0.50", "3.00", "Seed"]
].map(([label, id, input, output, modelProvider]) => ({ id, label, kind: "text", modelKind: "language", modelProvider,
  pricingPerMillion: { input, output }, metadataSource: "MF0.AI fixed catalog" }));

const catalogIds = new Set(catalog.map(model => model.id));

function providerFor(id) {
  if (/^gpt-/i.test(id)) return "ChatGPT";
  if (/^claude-/i.test(id)) return "Claude";
  if (/^deepseek-/i.test(id)) return "DeepSeek";
  if (/^glm-/i.test(id)) return "GLM";
  if (/^(?:dola-)?seed-/i.test(id)) return "Seed";
  if (/^qwen-/i.test(id)) return "Qwen";
  if (/^seedream-/i.test(id)) return "Seedream";
  if (/^seedance-/i.test(id)) return "Seedance";
  if (/^wan-/i.test(id)) return "Wan";
  if (/^hitem3d-/i.test(id)) return "Hitem3D";
  if (/^hyper3d-/i.test(id)) return "Hyper3D";
  return "Other";
}

function errorDetails(body, key) {
  const fields = [typeof body?.error === "string" ? body.error : body?.error?.code,
    body?.message, body?.error?.message, body?.error?.details, body?.error?.hint, body?.detail, body?.details];
  return [...new Set(fields.filter(value => typeof value === "string" && value.trim())
    .map(value => value.trim().replaceAll(key, "[REDACTED]").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300)))]
    .join(" · ");
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

function generationOf(body) { return body?.generation || body; }

function answerOf(body) {
  const generation = generationOf(body);
  return [generation?.result?.text, generation?.text, body?.text, body?.result?.text,
    body?.output?.text, body?.data?.text, body?.data?.result?.text, body?.output,
    body?.result, body?.choices?.[0]?.message?.content]
    .find(value => typeof value === "string" && value.trim());
}

function generationUsage(generation, body) {
  const usage = { ...(generation?.usage || generation?.result?.usage || body?.usage || body?.data?.usage || {}) };
  const rawCost = generation?.costUsd ?? body?.costUsd;
  const cost = Number(rawCost);
  if (rawCost !== null && rawCost !== undefined && Number.isFinite(cost) && cost >= 0) usage.cost_usd = cost;
  return usage;
}

async function pollGeneration(key, generation, { request = fetch, signal, timeout = 20 * 60 * 1000, onStatus } = {}) {
  const id = generation?.id;
  if (!id) throw new Error("MF0.AI accepted the request but returned no generation.id.");
  const expires = Date.parse(generation.expiresAt || "");
  const deadline = Math.min(Date.now() + timeout, Number.isFinite(expires) ? expires : Infinity);
  const url = "https://www.mf0.ai/api/v1/generations/" + encodeURIComponent(id);
  let current = generation;

  while (true) {
    const status = String(current?.status || "unknown").toLowerCase();
    onStatus?.(current);
    if (["succeeded", "success", "completed", "complete", "done"].includes(status)) return current;
    if (["failed", "cancelled", "canceled", "expired", "rejected"].includes(status)) {
      const details = errorDetails({ error: current.error }, key);
      throw new Error("MF0.AI generation " + id + " ended with status " + status
        + (details ? " · " + details : ""));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("MF0.AI generation " + id + " is still " + status
      + "; result polling timed out. The generation may remain available until " + (generation.expiresAt || "its expiry" ) + ".");

    await new Promise(resolve => setTimeout(resolve, Math.min(2000, remaining)));
    const requestLimit = AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now())));
    const pollSignal = signal ? AbortSignal.any([signal, requestLimit]) : requestLimit;
    const response = await request(url, {
      method: "GET",
      headers: { "X-API-Key": key },
      redirect: "error",
      signal: pollSignal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) {
      const details = errorDetails(body, key);
      throw new Error("MF0.AI generation " + id + " · GET /api/v1/generations/{id} · HTTP " + response.status
        + (details ? " · " + details : " · No error details returned"));
    }
    current = generationOf(body);
    if (!current || typeof current !== "object") throw new Error("MF0.AI returned an invalid generation status for " + id + ".");
  }
}

async function ask(options) {
  const model = typeof options.model === "string" ? options.model.trim() : "";
  if (!model) throw new Error("Add a model ID in MF0.AI provider settings first.");
  if (options.images?.length) throw new Error("MF0.AI text chat does not accept screenshots.");
  const structured = options.structuredResult ? "\nReturn JSON matching this schema: " + JSON.stringify(options.schema) : "";
  const prompt = [options.instructions, "Answer from the supplied context. You cannot call tools.", options.prompt, structured].filter(Boolean).join("\n\n");
  const timeout = options.timeout || 20 * 60 * 1000;
  const { response, body } = await generate(options.apiKey, { model, prompt, maxTokens: options.maxOutputTokens || 4096 },
    { signal: options.signal, timeout, request: options.mf0Request });
  if (!response.ok || body?.ok === false) {
    const details = errorDetails(body, options.apiKey);
    throw new Error("MF0.AI " + model + " · POST /api/v1/generations · HTTP " + response.status
      + (details ? " · " + details : " · No error details returned")
      + (response.status === 400 ? " · Prompt sent: " + prompt.length + " characters" : ""));
  }
  let completed = generationOf(body);
  let answer = answerOf(body);
  if (!answer && completed?.id) {
    options.onProviderResponse?.({ provider: "mf0-api", scope: "generation_accepted",
      response: { model, generation_id: completed.id, status: completed.status } });
    completed = await pollGeneration(options.apiKey, completed,
      { signal: options.signal, timeout, request: options.mf0Request || fetch,
        onStatus: generation => options.onProgress?.({ status: "MF0.AI generation "
          + (generation.status || "pending") + "; waiting for the result…", kind: "provider" }) });
    answer = answerOf(completed);
  }
  if (!answer) {
    const id = completed?.id ? " (generation " + completed.id + ", status " + (completed.status || "unknown") + ")" : "";
    throw new Error("MF0.AI returned no text" + id + (completed?.result ? "; result has an unrecognized format." : "; generation may still be pending."));
  }
  const plan = options.structuredResult ? JSON.parse(answer) : { answer, navigation: null };
  const usage = generationUsage(completed, body);
  options.onProviderResponse?.({ provider: "mf0-api", scope: "model_response", response: {
    model, usage, generation_id: completed?.id, status: completed?.status } });
  options.onModelCall?.({ model, usage, text: answer });
  return { plan, model, usage };
}

module.exports = { catalog, catalogIds, providerFor, ask };
