"use strict";
/* A per-model input-token budget per minute, entered by hand in LLM Providers from the tier's own
   conditions. VERTEX keeps requests inside it and waits when the next one would not fit, so the
   chosen model finishes the work instead of failing on a rate limit.

   What it cannot promise: it counts only what this VERTEX process spent. Another window, another
   tool or another machine on the same key spends the same quota unseen, a provider may also cap
   requests per minute or per day, and a restart starts the minute empty. The provider's own
   retry-after stays the safety net; see waitAfterLimit. */
const WINDOW_MS = 60000;
const WAIT_CAP_MS = 60250;
const BYTES_PER_TOKEN = 4.24; // Measured on VERTEX orchestrator packets: 110,673 bytes = 26,098 input tokens.
const windows = new Map();

function key(provider, model) { return String(provider) + "\u0000" + String(model); }
function limits(vscode, provider) {
  const all = vscode?.workspace?.getConfiguration?.("vertex.ai")?.get("modelConfig", {}) || {};
  const own = all[provider];
  return own && own.limits && typeof own.limits === "object" && !Array.isArray(own.limits) ? own.limits : {};
}
/** The budget entered for this model, or 0 when none: 0 means every request goes out at once. */
function budget(vscode, provider, model) {
  const value = Number(limits(vscode, provider)[model]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
/* A tier can state two limits and enforce both independently: input tokens per minute and requests
   per minute, and a provider may publish only one of them. A few large requests break the first, a
   stream of small ones breaks the second, so each model carries both numbers and a request waits
   for whichever is not ready. A number left out is simply not enforced here. */
function callLimits(vscode, provider) {
  const all = vscode?.workspace?.getConfiguration?.("vertex.ai")?.get("modelConfig", {}) || {};
  const own = all[provider];
  return own && own.calls && typeof own.calls === "object" && !Array.isArray(own.calls) ? own.calls : {};
}
function callBudget(vscode, provider, model) {
  const value = Number(callLimits(vscode, provider)[model]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function estimateTokens(payload) {
  return Math.ceil(Buffer.byteLength(typeof payload === "string" ? payload : JSON.stringify(payload ?? ""), "utf8") / BYTES_PER_TOKEN);
}
function entries(provider, model, now) {
  const id = key(provider, model);
  const list = (windows.get(id) || []).filter(e => now - e.at < WINDOW_MS);
  windows.set(id, list);
  return list;
}
function spent(vscode, provider, model, now = Date.now()) {
  return entries(provider, model, now).reduce((total, e) => total + e.tokens, 0);
}
function record(provider, model, tokens, now = Date.now()) {
  entries(provider, model, now).push({ at: now, tokens: Math.max(0, Number(tokens) || 0) });
}
/* The charged count replaces the estimate, so the next pause is paced on what was really spent. */
function correct(provider, model, estimated, actual) {
  const list = windows.get(key(provider, model)) || [];
  if (!Number.isFinite(Number(actual)) || Number(actual) < 0) return false;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].tokens === estimated) { list[i].tokens = Number(actual); return true; }
  return false;
}
/** How long until one more request of `tokens` fits under both limits; 0 when it already fits. */
function waitFor(provider, model, tokens, limit, now = Date.now(), callLimit = 0) {
  const list = entries(provider, model, now);
  let wait = 0;
  if (limit && tokens > 0) {
    let used = list.reduce((total, e) => total + e.tokens, 0), index = 0;
    while (used + tokens > limit && index < list.length) { used -= list[index].tokens; index++; }
    // A single request larger than the whole budget can never fit: let the provider answer for it.
    if (used + tokens <= limit && index) wait = Math.max(0, list[index - 1].at + WINDOW_MS - now);
  }
  if (callLimit) {
    const over = list.length + 1 - callLimit;
    // One request alone always goes: a limit under 1 must not stop everything for ever.
    if (over > 0 && over <= list.length) wait = Math.max(wait, Math.max(0, list[over - 1].at + WINDOW_MS - now));
  }
  return wait;
}
/** Requests this model has made inside the current minute. */
function calls(provider, model, now = Date.now()) { return entries(provider, model, now).length; }
/* Exhaustion and outage only. A rejected or malformed request must fail where it happened. */
const SUBSTITUTABLE = new RegExp("\\b(429|503|529)\\b|rate limit|rate-limit|quota|exhausted|resource_exhausted|overloaded|temporarily unavailable|service unavailable|timed out|timeout", "i");
function retryable(error) { return SUBSTITUTABLE.test(String(error && error.message || error || "")); }
/** The delay the provider itself stated, from its header or its message; 0 when it stated none. */
function retryDelay(error) {
  const after = error && error.retryAfter;
  if (after !== undefined && after !== null && after !== "" && Number.isFinite(Number(after))) return Number(after) * 1000;
  if (after && Number.isFinite(Date.parse(after))) return Date.parse(after) - Date.now();
  const hint = new RegExp("retry(?: again)?(?: in| after)\\s+(\\d+(?:\\.\\d+)?)\\s*(m?s|seconds?|minutes?)?", "i")
    .exec(String(error && error.message || ""));
  if (!hint) return 0;
  const value = Number(hint[1]), unit = (hint[2] || "s").toLowerCase();
  return unit === "ms" ? value : unit.startsWith("m") && unit !== "ms" ? value * 60000 : value * 1000;
}
function sleep(ms, options = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    options.signal?.addEventListener?.("abort", () => { clearTimeout(timer); reject(new Error("Request stopped.")); }, { once: true });
  });
}
/** Wait inside the budget, run, and on a rate limit that states its delay wait once and ask again. */
async function paced(vscode, provider, model, size, run, options = {}) {
  const limit = module.exports.budget(vscode, provider, model);
  const callLimit = module.exports.callBudget(vscode, provider, model);
  const delay = limit || callLimit ? waitFor(provider, model, size, limit, Date.now(), callLimit) : 0;
  if (delay > 0) {
    options.onWait?.({ provider, model, ms: delay, tokens: size, limit, callLimit, reason: "budget" });
    await (options.sleep || sleep)(delay, options);
    if (options.signal?.aborted) throw new Error("Request stopped.");
  }
  record(provider, model, size);
  try { return await run({ estimatedTokens: size, waitedMs: delay }); }
  catch (error) {
    if (options.signal?.aborted || !retryable(error)) throw error;
    const after = module.exports.retryDelay(error);
    if (!(after > 0 && after <= WAIT_CAP_MS)) throw error;
    options.onWait?.({ provider, model, ms: after, tokens: size, limit, reason: String(error.message || error) });
    await (options.sleep || sleep)(after, options);
    if (options.signal?.aborted) throw error;
    record(provider, model, size);
    return run({ estimatedTokens: size, waitedMs: delay + after, retriedAfterLimit: true });
  }
}
function forget() { windows.clear(); }
module.exports = { WINDOW_MS, WAIT_CAP_MS, BYTES_PER_TOKEN, budget, callBudget, limits, callLimits, calls, estimateTokens,
  spent, record, correct, waitFor, retryable, retryDelay, paced, forget };
