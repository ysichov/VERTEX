"use strict";

// Availability checks are explicit, tiny requests without SAP or workspace context.
const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
async function probe(vscode, secrets, id, model, extensionPath, executable) {
  const options = { assistant: id, model, tools: [], schema, token: "", timeout: 60000, maxRounds: 1, maxOutputTokens: 16,
    instructions: "This is a connectivity check. Return the answer OK. Do not use tools.", prompt: "Reply OK." };
  let result;
  const compatible = require("./openai-compatible");
  if (id === "copilot") result = await require("./copilot").ask(vscode, options);
  else if (id === "anthropic-api" || compatible.PROVIDERS[id]) {
    const apiKey = (await require("./key-profiles").getActiveKey(secrets, id)).key;
    if (id === "anthropic-api") result = await require("./anthropic").ask({ ...options, apiKey });
    else { await compatible.probe(id, apiKey, model); return; }
  } else result = await require("./assistant").ask({ ...options, extensionPath: extensionPath(id), executable: await executable(id),
    profile: require("./assistant").profileFor(vscode, id) });
  if (!result?.plan?.answer?.trim()) throw new Error("The model returned no answer.");
}

async function detect(providers, list, check, report, cancelled = () => false) {
  const results = [];
  for (const provider of providers) {
    if (cancelled()) break;
    let models;
    try { models = await list(provider.id); }
    catch (error) { results.push({ provider: provider.id, error: String(error.message || error), rows: null }); continue; }
    const rows = models.map(model => ({ ...model, checked: model.available === true }));
    let checked = 0, stopReason = "";
    for (const [index, model] of models.entries()) {
      if (cancelled()) break;
      if (model.available === true) { checked++; continue; }
      report({ provider: provider.id, model: model.label || model.id, index: index + 1, total: models.length });
      try { await check(provider.id, model.id); rows[index] = { ...model, on: true, available: true, checked: true }; }
      catch (error) {
        const reason = String(error.message || error);
        rows[index] = { ...model, on: false, available: false, checked: true, reason, availabilitySource: "probe" };
        // Only a missing credit card stops the provider; other failures may be model-specific.
        if (/credit[ -]?card/i.test(reason)) stopReason = reason;
      }
      checked++;
      if (stopReason) break;
    }
    results.push({ provider: provider.id, rows, checked, total: models.length, partial: checked < models.length,
      ...(stopReason ? { stopReason } : {}) });
    if (cancelled()) return { results, cancelled: true };
  }
  return { results, cancelled: cancelled() };
}
module.exports = { probe, detect };
