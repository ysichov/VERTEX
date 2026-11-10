"use strict";

// OpenCode's IDs are unprefixed. Keep the wire ID and infer grouping only
// when the catalog omits the original maker (owned_by is often "opencode").
function maker(item) {
  const canonical = typeof item.canonical_id === "string" && item.canonical_id.includes("/") ? item.canonical_id.split("/")[0] : null;
  const declared = item.model_provider || item.provider || canonical || item.owned_by;
  if (typeof declared === "string" && declared && declared !== "opencode") return ({zhipuai:"zai","typesafe-ai":"typesafe"})[declared] || declared;
  const id = String(item.id || "");
  const families = [
    [/^jev(?:-|$)/i, "typesafe"], [/^claude-/i, "anthropic"], [/^gpt-/i, "openai"],
    [/^gemini-/i, "google"], [/^grok-/i, "xai"], [/^deepseek-/i, "deepseek"],
    [/^glm-/i, "zai"], [/^kimi-/i, "moonshotai"], [/^minimax-/i, "minimax"],
    [/^qwen/i, "alibaba"], [/^mistral-/i, "mistral"], [/^nemotron-/i, "nvidia"]
  ];
  return families.find(([pattern]) => pattern.test(id))?.[1] || "opencode";
}
function isDecision(model) {
  return /^jev(?:-|$)/i.test(String(typeof model === "string" ? model : model?.id || ""))
    || ["evaluation", "decision"].includes(model?.type);
}
function decorate(item) {
  const decision = isDecision(item);
  const number = value => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const input = number(item.cost?.text?.input?.price), output = number(item.cost?.text?.output?.price);
  // Prices in the OpenCode catalog are USD per million tokens. Preserve
  // unknown prices and reject a free classification when any tier has a cost.
  const rates = value => value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => key === "when" ? [] : rates(child)) : number(value) === null ? [] : [number(value)];
  const costs = rates(item.cost);
  const free = input !== null && output !== null ? input === 0 && output === 0 && costs.every(value => value === 0) : !costs.some(value => value > 0) && /-free$/i.test(item.id);
  const caps = item.capabilities;
  const inputs = item.modalities?.input;
  return { id: String(item.id), label: String(item.name || item.display_name || item.id) + (decision ? " (Decision API)" : ""),
    modelProvider: maker(item), modelKind: decision ? "decision" : item.type && !["chat","language","model"].includes(item.type) ? item.type : "language",
    free, metadataSource: "OpenCode catalog",
    ...(input !== null || output !== null ? { pricing: {
      ...(input !== null ? { input: input / 1000000 } : {}), ...(output !== null ? { output: output / 1000000 } : {}),
      ...(item.cost.text.input?.overrides || item.cost.text.output?.overrides ? { input_tiers: item.cost.text.input?.overrides || [], output_tiers: item.cost.text.output?.overrides || [] } : {})
    } } : {}),
    ...(Number.isFinite(item.limit?.context) ? { contextWindow: item.limit.context } : {}),
    ...(typeof item.description === "string" ? { description: item.description } : {}),
    ...(decision ? { capabilities: { tools: false, json: true, reasoning: false, vision: null, web: false } }
      : caps || Array.isArray(inputs) ? { capabilities: { tools: caps?.tools?.supported ?? null, json: caps?.structured_output ?? null,
        reasoning: caps?.reasoning?.supported ?? null, vision: Array.isArray(inputs) ? inputs.some(type => type === "image" || type.startsWith("image/")) : null, web: null } } : {}) };
}
module.exports = { maker, isDecision, decorate };
