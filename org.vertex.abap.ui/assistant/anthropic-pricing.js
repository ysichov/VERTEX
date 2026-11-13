"use strict";
// Standard Claude API list prices, USD / million tokens, verified 2026-11-13.
// https://platform.claude.com/docs/en/about-claude/pricing
// Kept separate from the transport so old logs and Eclipse can use the same calculation.
function priceUsage(model, usage) {
  if (!usage || typeof usage.cost_usd === "number") return usage;
  const id = String(model || "").replace(/-\d{8}$/, "");
  const rates = {
    "claude-haiku-5-5": [0.1, 0.5, 0.01], "claude-sonnet-5-5": [2, 10, 0.1],
    "claude-opus-5-5": [4, 20, 0.2], "claude-fable-5-2": [8, 40, 0.2],
    "claude-mythos-5-2": [8, 40, 0.2], "claude-fable-5-1": [10, 50, 0.25],
    "claude-mythos-5-1": [10, 50, 0.25], "claude-fable-5": [10, 50, 1],
    "claude-mythos-5": [10, 50, 1], "claude-opus-5": [5, 25, 0.5],
    "claude-opus-4-8": [5, 25, 0.5], "claude-opus-4-7": [5, 25, 0.5],
    "claude-opus-4-6": [5, 25, 0.5], "claude-opus-4-5": [5, 25, 0.5],
    "claude-opus-4-1": [15, 75, 1.5], "claude-opus-4": [15, 75, 1.5],
    "claude-sonnet-5": [2, 10, 0.2], "claude-sonnet-4-6": [3, 15, 0.3],
    "claude-sonnet-4-5": [3, 15, 0.3], "claude-sonnet-4": [3, 15, 0.3],
    "claude-haiku-4-5": [1, 5, 0.1]
  };
  let rate = rates[id];
  if (!rate || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) return usage;
  const input = usage.input_tokens, output = usage.output_tokens;
  const read = usage.cache_read_input_tokens || 0, write = usage.cache_creation_input_tokens || 0;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  if ([input, output, read, write, hour].some(n => !Number.isFinite(n) || n < 0) || hour > write) return usage;
  if (id === "claude-haiku-5-5" && input + read + write > 100000) rate = [0.5, 2.5, 0.05];
  // The direct client uses standard synchronous requests; never invent a rate for unknown service modes.
  if (usage.speed && usage.speed !== "standard" || usage.service_tier && !["standard", "default"].includes(usage.service_tier)) return usage;
  const geo = usage.inference_geo === "us" ? 1.1 : 1;
  const cost = (input * rate[0] + output * rate[1] + read * rate[2] + (write - hour) * rate[0] * 1.25 + hour * rate[0] * 2) * geo / 1e6;
  return {...usage, cost_usd: Number(cost.toPrecision(15)), cost_source: "anthropic_list_price", pricing_date: "2026-11-13"};
}
module.exports = {priceUsage};

