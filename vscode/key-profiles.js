"use strict";

const crypto = require("crypto");

function legacyKey(id) {
  return id === "anthropic-api" ? "vertex.provider.anthropic.apiKey" : "vertex.provider." + id + ".apiKey";
}
function indexKey(id) { return "vertex.provider." + id + ".profiles"; }
function valueKey(id, name) {
  return "vertex.provider." + id + ".profile." + crypto.createHash("sha256").update(name).digest("hex");
}
function validName(name) {
  const value = String(name || "").trim();
  if (!value || value.length > 30 || /[\r\n\x00-\x1f]/.test(value)) {
    throw new Error("Key name must be 1–30 printable characters.");
  }
  return value;
}
async function readIndex(secrets, id) {
  let parsed;
  try { parsed = JSON.parse(await secrets.get(indexKey(id)) || "{}"); } catch (_) { parsed = {}; }
  const names = Array.isArray(parsed.names) ? [...new Set(parsed.names.filter(name =>
    typeof name === "string" && name.length && name.length <= 30))] : [];
  if (await secrets.get(legacyKey(id)) && !names.includes("DEFAULT")) { names.unshift("DEFAULT"); }
  return { names, active: names.includes(parsed.active) ? parsed.active : names[0] || "" };
}
async function list(secrets, id) { return readIndex(secrets, id); }
async function getActiveKey(secrets, id) {
  // Local servers (LM Studio, Ollama) take no key; a placeholder lets the keyed paths run.
  if (require("./openai-compatible").isLocal(id)) { return { name: "LOCAL", key: "local" }; }
  if (!secrets) { return { name: "", key: "" }; }
  const index = await readIndex(secrets, id);
  if (!index.active) { return { name: "", key: "" }; }
  const key = await secrets.get(valueKey(id, index.active))
    || (index.active === "DEFAULT" ? await secrets.get(legacyKey(id)) : "");
  return { name: index.active, key: key || "" };
}
async function save(secrets, id, name, key) {
  name = validName(name);
  key = String(key || "").trim();
  if (!key) { throw new Error("Enter an API key."); }
  const index = await readIndex(secrets, id);
  if (!index.names.includes(name)) { index.names.push(name); }
  index.active = name;
  await secrets.store(valueKey(id, name), key);
  await secrets.store(indexKey(id), JSON.stringify(index));
  return index;
}
async function select(secrets, id, name) {
  const index = await readIndex(secrets, id);
  if (!index.names.includes(name)) { throw new Error("Unknown key profile: " + name); }
  index.active = name;
  await secrets.store(indexKey(id), JSON.stringify(index));
  return index;
}

module.exports = { legacyKey, list, getActiveKey, save, select };
