"use strict";
// Explicit decision inputs only: no chat history, SAP context or tool execution.
function validate(state, questions) {
  if (state === undefined || state === null || typeof state === "string" && !state.trim()) throw new Error("Enter State text or JSON.");
  if (!questions || typeof questions !== "object" || Array.isArray(questions) || !Object.keys(questions).length) throw new Error("Questions must be a non-empty JSON object.");
  for (const [name, q] of Object.entries(questions)) {
    if (!name.trim() || !q || typeof q !== "object" || !["noul", "choice", "score"].includes(q.type)) throw new Error("Question " + name + ": type must be noul, choice or score.");
    if (typeof q.instructions !== "string" || !q.instructions.trim()) throw new Error("Question " + name + ": instructions are required.");
    if (q.type === "choice" && (!q.criteria || typeof q.criteria !== "object" || Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 255 || Object.values(q.criteria).some(v => typeof v !== "string" || !v.trim()))) throw new Error("Question " + name + ": choice requires 2–255 named criteria with descriptions.");
    if (q.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10 || q.criteria.some(v => typeof v !== "string" || !v.trim()))) throw new Error("Question " + name + ": score requires 2–10 ordered criteria.");
  }
  if (Buffer.byteLength(JSON.stringify({state, questions}), "utf8") > 256000) throw new Error("Decision input exceeds 250 KiB; narrow State or Questions.");
}
function formatAnswers(questions, answers) {
  const percent = value => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) + "%" : "—";
  return Object.entries(questions).map(([name, q], index) => {
    const a = answers?.[name];
    const title = "Question " + (index + 1) + ": " + q.instructions;
    if (!a || a.type !== q.type) return title + "\nInvalid or missing decision response.";
    const label = key => q.criteria?.[key] || a.legend?.[key] || key;
    const value = a.type === "noul" ? (a.noul >= 0.5 ? "Yes" : "No") : a.type === "choice" ? label(a.choice) : String(a.score);
    const probabilities = a.type === "noul" ? "Yes: " + percent(a.noul) + " · No: " + percent(1 - a.noul)
      : Object.entries(a.probabilities || {}).map(([key, p]) => label(key) + ": " + percent(p)).join("\n");
    return title + "\nAnswer: " + value + "\nConfidence: " + percent(a.confidence)
      + (probabilities ? "\nProbabilities: " + probabilities : "");
  }).join("\n\n");
}
// TypeSafe published rate, verified 2026-11-11:
// https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost
function priceUsage(provider, usage = {}) {
  const result = { ...usage };
  const reported = [usage.cost_usd, usage.cost].find(v => typeof v === "number" && Number.isFinite(v) && v >= 0);
  if (reported !== undefined) result.cost_usd = reported;
  else if (provider === "typesafe-api" && typeof usage.input_tokens === "number" && Number.isFinite(usage.input_tokens) && usage.input_tokens >= 0) {
    result.estimated_cost_usd = usage.input_tokens * 42 / 1000000000;
    result.input_usd_per_million = 0.042;
  }
  return result;
}
async function evaluate(provider, key, model, state, questions, options = {}) {
  validate(state, questions);
  const api = require("./openai-compatible");
  if (provider !== "typesafe-api" && !(provider === "opencode-api" && require("./opencode-models").isDecision(model))) throw new Error("Select a Jev decision model.");
  const started = Date.now();
  const response = await (options.request || api.requestJson)(provider, key, provider === "typesafe-api" ? "/systemone" : "/systemone/v1/systemone", {model, state, questions}, 262144, 60000, options.signal);
  options.onProviderResponse?.({provider, scope:"model_response", response});
  const usage = priceUsage(provider, response.usage || {});
  options.onModelCall?.({model:response.model || model, usage, text:formatAnswers(questions, response.answers) + (usage.estimated_cost_usd !== undefined ? "\n\nEstimated cost: $" + usage.estimated_cost_usd + " (input tokens × $0.042 / 1M; output free)" : "")});
  for (const [name, q] of Object.entries(questions)) {
    const a = response.answers?.[name];
    const probability = v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
    if (!a || a.type !== q.type || q.type === "noul" && !probability(a.noul)
      || q.type === "choice" && !Object.hasOwn(q.criteria, a.choice)
      || q.type === "score" && (typeof a.score !== "number" || !Number.isFinite(a.score) || a.score < 0 || a.score > q.criteria.length - 1)) throw new Error("Invalid decision response for question " + name + ".");
  }
  return {model:response.model || model, answers:response.answers, usage, elapsedMs:Date.now()-started};
}
module.exports = { validate, evaluate, formatAnswers, priceUsage };
