"use strict";

async function decide(vscode, text, options = {}) {
  const connection = await require("./review-jev").connection(vscode);
  if (!connection) return { web: false, status: "unavailable" };
  const state = { request: require("./context-protection").protect(String(text || "").slice(0, 4000)) };
  const questions = { web: { type: "noul", instructions: "Does this request require fresh public internet information to answer accurately? Answer yes for current facts, prices, weather, news, websites or an explicit request to search. Answer no for supplied context, local code, SAP data, general knowledge, historical explanation, or when the user asks not to use the internet." } };
  try {
    const result = await require("./jev").evaluate(connection.provider, connection.key, connection.model, state, questions, { signal: options.signal });
    const web = result.answers.web.noul >= 0.8;
    return { web, status: "decided", provider: connection.provider, model: connection.model, state, questions, result };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { web: false, status: "fallback", error: error.message };
  }
}

module.exports = { decide };
