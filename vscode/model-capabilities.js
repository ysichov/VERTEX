"use strict";
// Catalog declarations, not results of the paid connectivity probe. Null means unknown.
const definitions = [
  { key: "tools", icon: "⚒", label: "Tools", yes: "Catalog declares tool calling; actual availability depends on the serving API.", no: "No tool calling: text answers only; VERTEX actions are unavailable." },
  { key: "json", icon: "{}", label: "Structured output", yes: "Declares structured JSON output; this does not guarantee answer correctness.", no: "No structured-output API support declared." },
  { key: "reasoning", icon: "💭", label: "Reasoning", yes: "Supports reasoning; thinking tokens may be billed. This is not a quality rating." },
  { key: "vision", icon: "▣", label: "Vision", yes: "Accepts images and screenshots.", no: "Does not accept images or screenshots. Use a Vision model or remove the image." },
  { key: "web", icon: "🌐", label: "Web search", yes: "Provider declares web search support. Catalog support does not mean search is enabled in this chat." }
];
function metadata(item) {
  const tags = new Set(item.tags || []), params = Array.isArray(item.supported_parameters) ? item.supported_parameters : null;
  const inputs = Array.isArray(item.modalities?.input) ? item.modalities.input : null;
  const parameter = names => params ? names.some(name => params.includes(name)) : null;
  return { ...(typeof item.description==="string"&&item.description.trim()?{description:item.description.trim()}:{}), capabilities: {
    tools: tags.has("tool-use") ? true : parameter(["tools"]),
    json: tags.has("structured-output") ? true : parameter(["response_format", "structured_outputs"]),
    reasoning: tags.has("reasoning") || (item.reasoning_options || []).length > 0 ? true : null,
    vision: tags.has("vision") ? true : inputs ? inputs.includes("image") : null,
    web: tags.has("web-search") ? true : null
  }, ...(Number.isFinite(item.context_window) ? { contextWindow: item.context_window } : {}),
  ...(item.pricing && typeof item.pricing === "object" ? { pricing: item.pricing } : {}),
  metadataSource: "Vercel catalog" };
}
function priceInfo(model) {
  const price = model?.pricing;
  if (!price) return null;
  const rate = value => value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0
    ? "$" + (Number(value) * 1000000).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—";
  const variable = price.varies_by_provider || Object.keys(price).some(key => key.endsWith("_tiers"));
  let title = "USD per 1,000,000 text tokens: input / output. Base catalog rates, not the price of one request.";
  if (price.varies_by_provider) title += " Price varies by serving provider.";
  if (Object.keys(price).some(key => key.endsWith("_tiers"))) title += " Context-dependent pricing tiers apply.";
  if (price.input_cache_read != null) title += " Cached input read: " + rate(price.input_cache_read) + " per 1M tokens.";
  if (price.input_cache_write != null) title += " Cache write: " + rate(price.input_cache_write) + " per 1M tokens.";
  return { variable: !!variable, input: rate(price.input), output: rate(price.output), text: "In " + rate(price.input) + " · Out " + rate(price.output) + " /1M" + (variable ? " *" : ""), title };
}
function sortModels(models, key, down = false) {
  if (!key) return models.slice();
  const value = model => {
    if (key.startsWith("cap.")) return model.capabilities?.[key.slice(4)] ?? null;
    if (key === "inputPrice" || key === "outputPrice") {
      const price = model.pricing?.[key === "inputPrice" ? "input" : "output"];
      return price == null || price === "" || !Number.isFinite(Number(price)) ? null : Number(price);
    }
    if (key === "availability") return model.available ?? null;
    return model[key] ?? null;
  };
  return models.slice().sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null || y == null) return x == null ? y == null ? 0 : 1 : -1;
    const order = typeof x === "string" ? x.localeCompare(String(y)) : Number(x) - Number(y);
    return order * (down ? -1 : 1);
  });
}
function groupModels(models, key, down = false, hideUnavailable = true) {
  const names={openai:"OpenAI",anthropic:"Anthropic",google:"Google",deepseek:"DeepSeek",mistral:"Mistral",nvidia:"NVIDIA",meta:"Meta",amazon:"Amazon",alibaba:"Alibaba",xai:"xAI",minimax:"MiniMax",moonshotai:"Moonshot AI",zai:"Z.AI",inclusionai:"InclusionAI",typesafe:"TypeSafe AI",opencode:"OpenCode"};
  const groups=new Map();
  for(const model of sortModels(models,key,down)){
    if(hideUnavailable&&model.available===false)continue;
    const prefix=model.modelProvider||(String(model.id||"").includes("/")?String(model.id).split("/")[0]:"other");
    if(!groups.has(prefix))groups.set(prefix,{id:prefix,label:Object.prototype.hasOwnProperty.call(names,prefix)?names[prefix]:(prefix==="other"?"Other":prefix),models:[]});
    groups.get(prefix).models.push(model);
  }
  return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
function detailLines(model, capabilityDefinitions, priceInfo) {
  const lines=[model.id,
    "Source: Vercel AI Gateway /models API (catalog declarations, not a capability or quality test).",
    "Catalog cached for the current provider/key session. Reload Window fetches a fresh catalog.",
    model.description || "Description / specialization: not provided by the catalog API."];
  if(model.toolSupportEvidence)lines.push(model.toolSupportEvidence.reason+" Source: observed API response; text-only mode for this provider/key/model, expires after 24 hours.");
  for(const d of capabilityDefinitions){const value=model.capabilities?.[d.key];lines.push(d.icon+" "+d.label+": "+(value===true?d.yes:value===false?d.no||"Not supported by the catalog declaration.":"Not reported by the catalog; not tested."));}
  lines.push("▤ Context: "+(model.contextWindow?model.contextWindow.toLocaleString()+" tokens":"Not reported"));
  const price=priceInfo(model);if(price)lines.push(price.text,price.title);else lines.push("Price: not reported by this provider.");
  return lines;
}
module.exports = { definitions, metadata, priceInfo, sortModels, groupModels, detailLines };
