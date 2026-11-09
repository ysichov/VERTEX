"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Where LM Studio and Ollama leave a trace once installed (macOS, Windows, Linux).
function places(id, home = os.homedir(), env = process.env) {
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  if (id === "lmstudio-local") return ["/Applications/LM Studio.app", path.join(home, "Applications", "LM Studio.app"),
    path.join(home, ".lmstudio"), path.join(home, ".cache", "lm-studio"), path.join(local, "Programs", "LM Studio")];
  if (id === "ollama-local") return ["/Applications/Ollama.app", path.join(home, "Applications", "Ollama.app"),
    path.join(home, ".ollama"), "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama", "/usr/bin/ollama",
    path.join(local, "Programs", "Ollama")];
  return [];
}

const seen = new Map();
// True when the app is found on this computer; read once per session.
function installed(id, exists = fs.existsSync) {
  if (!seen.has(id)) seen.set(id, places(id).some(place => { try { return exists(place); } catch (_) { return false; } }));
  return seen.get(id);
}

const SITES = { "lmstudio-local": "https://lmstudio.ai", "ollama-local": "https://ollama.com" };
const HOW = { "lmstudio-local": "In LM Studio, download a model and turn on Developer → Start Server.",
  "ollama-local": "Start Ollama (open the app or run `ollama serve`) and pull a model, e.g. `ollama pull qwen2.5-coder`." };

// What stands between VERTEX and the local server: not installed, not running, no models, or ready.
async function diagnose(id, options = {}) {
  const compatible = require("./openai-compatible");
  const label = compatible.PROVIDERS[id].label, base = compatible.baseUrl(id);
  const request = options.request || ((route) => compatible.requestJson(id, "local", route, undefined, 64000, 3000));
  let models;
  try { models = await request("/models"); }
  catch (error) {
    const isInstalled = (options.installed || installed)(id);
    if (!isInstalled) return { state: "missing", site: SITES[id], text: label + " is not installed on this computer. Download it from " + SITES[id] + "." };
    return { state: "stopped", text: label + " is installed, but its server does not answer at " + base + ". " + HOW[id] };
  }
  const count = Array.isArray(models?.data) ? models.data.length : 0;
  if (!count) return { state: "empty", text: label + " is running at " + base + " but has no models. " + HOW[id] };
  return { state: "ready", count, text: label + " is running at " + base + " with " + count + " model" + (count === 1 ? "" : "s") + "." };
}

module.exports = { places, installed, diagnose, SITES };
