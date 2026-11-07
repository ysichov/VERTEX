"use strict";
// Negative runtime evidence is scoped to provider, credential and model, never a model-name blacklist.
const { createHash } = require("crypto");
const STORE = "vertex.toolSupportRejections", TTL = 24 * 60 * 60 * 1000;
let state, entries = {};
function configure(storage) {
  state = storage;
  entries = state?.get(STORE, {}) || {};
}
function key(provider, credential, model) {
  return createHash("sha256").update(JSON.stringify([provider, credential || "", model])).digest("hex");
}
function rejection(provider, credential, model) {
  const record = entries[key(provider, credential, model)];
  return record && Date.now() - record.at < TTL ? record : null;
}
async function reject(provider, credential, model) {
  const record = { at: Date.now(), reason: "The API rejected tool calling for this model and credential." };
  entries[key(provider, credential, model)] = record;
  entries = Object.fromEntries(Object.entries(entries).filter(([,value]) => Date.now() - value.at < TTL).sort((a,b)=>b[1].at-a[1].at).slice(0,256));
  try { await state?.update(STORE, entries); } catch (_) { /* In-memory evidence still applies. */ }
  return record;
}
function model(provider, credential, item) {
  const evidence = rejection(provider, credential, item.id);
  return evidence ? { ...item, capabilities: { ...item.capabilities, tools: false }, toolSupportEvidence: evidence } : item;
}
module.exports = { configure, rejection, reject, model };
