"use strict";

// Which models VERTEX offers, per provider: the ones a person switched off are
// left out of every model list, and a Claude version checked by its full id is
// added to Claude's. Kept in the setting vertex.ai.modelConfig as
//   { "<provider>": { hidden: [...], enabled: [...], versions: [{ id, label }] } }
// Codex and the Anthropic API list their own models; for them hidden is
// stored, so a model they add later is offered until switched off. Claude's
// list is VERTEX's own (CLAUDE_VERSIONS): until it is saved once, the models
// marked on are on; after that, enabled says which.

const assistant = require("./assistant");

// id is the assistant, setting what vertex.ai.provider holds. The label names
// what is paid for and, in brackets, what it runs through; short is for the
// VERTEX panel's button.
const PROVIDERS = [
  { id: "claude", setting: "claude-subscription", label: "Claude subscription (Claude Code)", short: "Claude" },
  { id: "codex", setting: "codex-subscription", label: "ChatGPT subscription (Codex)", short: "ChatGPT" },
  { id: "anthropic-api", setting: "anthropic-api", label: "Anthropic API (key)", short: "Anthropic API" }
];

function shortLabel(setting) {
  const found = PROVIDERS.find(p => p.setting === setting);
  return found ? found.short : setting;
}

function read(vscode, id) {
  const all = vscode.workspace.getConfiguration("vertex.ai").get("modelConfig", {}) || {};
  const own = all[id] || {};
  return { hidden: Array.isArray(own.hidden) ? own.hidden : [],
           enabled: Array.isArray(own.enabled) ? own.enabled : null,
           versions: Array.isArray(own.versions) ? own.versions.filter(v => v && v.id) : [] };
}

async function write(vscode, id, config) {
  const settings = vscode.workspace.getConfiguration("vertex.ai");
  const all = Object.assign({}, settings.get("modelConfig", {}) || {});
  all[id] = id === "claude" ? { enabled: config.enabled, versions: config.versions }
                            : { hidden: config.hidden };
  await settings.update("modelConfig", all, vscode.ConfigurationTarget.Global);
}

/** The provider's full list plus the checked versions, each marked on or off. */
function rows(list, config, id) {
  if (id !== "claude") {
    return list.map(m => ({ id: m.id, label: m.label, on: config.hidden.indexOf(m.id) < 0 }));
  }
  const listed = list.map(m => ({ id: m.id, label: m.label, on: !!m.on }));
  config.versions.forEach(v => {
    if (!listed.some(m => m.id === v.id)) { listed.push({ id: v.id, label: v.label || v.id, version: true, on: true }); }
  });
  if (config.enabled) { listed.forEach(m => { m.on = config.enabled.indexOf(m.id) >= 0; }); }
  return listed;
}

/** What a model list offers: the switched-on rows. */
function apply(vscode, id, list) {
  const offered = rows(list, read(vscode, id), id).filter(m => m.on).map(m => ({ id: m.id, label: m.label }));
  if (!offered.length) {
    throw new Error("No " + id + " model is switched on. Open Config models in the VERTEX panel.");
  }
  return offered;
}

/* ---------- the table ---------- */

/**
 * Opens the table - also where the provider is chosen. full(id) is the
 * provider's whole list, forget(id) drops what was read of it; extensionPath(id)
 * is where its assistant lives, for checking a Claude version; secrets keeps
 * the Anthropic API key.
 */
function open(vscode, full, extensionPath, forget, secrets) {
  const panel = vscode.window.createWebviewPanel("vertex.modelConfig", "VERTEX: LLM Providers",
    vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
  const nonce = require("crypto").randomBytes(24).toString("hex");
  const active = PROVIDERS.find(p => p.setting === vscode.workspace.getConfiguration("vertex.ai").get("provider", ""));
  panel.webview.html = html(nonce, active ? active.id : PROVIDERS[0].id);
  const post = message => panel.webview.postMessage(message);

  async function load(id) {
    try {
      post({ provider: id, rows: rows(await full(id), read(vscode, id), id) });
    } catch (e) {
      post({ provider: id, error: e.message, needKey: id === "anthropic-api" });
    }
  }

  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== "object") { return; }
    const id = String(message.provider || "");
    if (!PROVIDERS.some(p => p.id === id)) { return; }
    if (message.action === "load") { await load(id); return; }
    if (message.action === "key") {
      if (id !== "anthropic-api" || !secrets) { return; }
      const key = await vscode.window.showInputBox({ prompt: "Anthropic API key (stored in VS Code SecretStorage)",
        password: true, ignoreFocusOut: true });
      if (key && key.trim()) {
        await secrets.store("vertex.provider.anthropic.apiKey", key.trim());
        forget(id);
      }
      await load(id);
      return;
    }
    if (message.action === "check") {
      if (id !== "claude") { return; }
      try {
        const probed = await assistant.probe({ assistant: "claude", extensionPath: extensionPath("claude"),
                                               model: message.model });
        post({ provider: id, probed: probed });
      } catch (e) {
        post({ provider: id, probeError: e.message });
      }
      return;
    }
    if (message.action === "save") {
      const list = Array.isArray(message.rows) ? message.rows : [];
      // At least one model stays on: an empty list would leave the provider
      // with nothing to ask.
      if (!list.some(r => r && r.on)) {
        post({ provider: id, saveError: "Keep at least one model switched on." });
        return;
      }
      await write(vscode, id, {
        hidden: list.filter(r => r && !r.on).map(r => String(r.id)),
        enabled: list.filter(r => r && r.on).map(r => String(r.id)),
        versions: id === "claude"
          ? list.filter(r => r && r.version).map(r => ({ id: String(r.id), label: String(r.label || r.id) }))
          : []
      });
      // The provider saved is the one in use. A model chosen for another
      // provider, or just switched off, is chosen no longer: the weakest one
      // switched on takes its place.
      const settings = vscode.workspace.getConfiguration("vertex.ai");
      const setting = PROVIDERS.find(p => p.id === id).setting;
      const switched = settings.get("provider", "") !== setting;
      const current = settings.get("model", "");
      const reset = !!current && (switched || list.some(r => r && !r.on && String(r.id) === current));
      if (switched) { await settings.update("provider", setting, vscode.ConfigurationTarget.Global); }
      if (reset) { await settings.update("model", "", vscode.ConfigurationTarget.Global); }
      post({ provider: id, saved: true, reset: reset ? current : "" });
    }
  });
  return panel;
}

function html(nonce, selected) {
  const options = PROVIDERS.map(p => '<option value="' + p.id + '"' + (p.id === selected ? " selected" : "") + ">"
    + p.label + "</option>").join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font: var(--vscode-font-size) var(--vscode-font-family); color: var(--vscode-foreground);
       background: var(--vscode-editor-background); padding: 10px 14px; }
select, input, button { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
       border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; }
button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
table { border-collapse: collapse; margin: 10px 0; min-width: 420px; }
th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; }
th { background: var(--vscode-keybindingTable-headerBackground, transparent); }
td.id { font-family: var(--vscode-editor-font-family); }
.row { display: flex; gap: 6px; align-items: center; margin: 8px 0; }
.note { color: var(--vscode-descriptionForeground); }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
</style></head><body>
<div class="row"><label for="provider">Provider</label><select id="provider">${options}</select></div>
<div id="body" class="note">Loading ...</div>
<div class="row" id="add" hidden>
  <input id="version" placeholder="claude-opus-5" spellcheck="false">
  <button id="check">Check and add</button>
</div>
<div class="row" id="keyrow" hidden><button id="key">Enter API key</button></div>
<div class="row"><button class="primary" id="save">Save</button><span id="said"></span></div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
let rows = [];
const $ = id => document.getElementById(id);
function provider() { return $("provider").value; }
function say(text, kind) { $("said").textContent = text || ""; $("said").className = kind || "note"; }
function render() {
  const body = $("body"); body.className = ""; body.innerHTML = "";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>On</th><th>Model</th><th>Id</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const on = document.createElement("td"); const box = document.createElement("input");
    box.type = "checkbox"; box.checked = r.on; box.addEventListener("change", () => { r.on = box.checked; say(""); });
    on.appendChild(box); tr.appendChild(on);
    const label = document.createElement("td"); label.textContent = r.label; tr.appendChild(label);
    const id = document.createElement("td"); id.className = "id"; id.textContent = r.id === "" ? "(default)" : r.id; tr.appendChild(id);
    const act = document.createElement("td");
    if (r.version) {
      const remove = document.createElement("button"); remove.textContent = "Remove";
      remove.addEventListener("click", () => { rows.splice(i, 1); render(); say("Removed - Save to keep it.", "note"); });
      act.appendChild(remove);
    }
    tr.appendChild(act); tbody.appendChild(tr);
  });
  table.appendChild(tbody); body.appendChild(table);
}
function load() {
  rows = []; $("body").className = "note"; $("body").textContent = "Loading ..."; say("");
  $("add").hidden = provider() !== "claude";
  $("keyrow").hidden = true;
  api.postMessage({ action: "load", provider: provider() });
}
$("provider").addEventListener("change", load);
$("key").addEventListener("click", () => api.postMessage({ action: "key", provider: provider() }));
$("check").addEventListener("click", () => {
  const model = $("version").value.trim(); if (!model) { return; }
  if (rows.some(r => r.id === model)) { say(model + " is already in the table.", "error"); return; }
  $("check").disabled = true; say("Checking " + model + " with Claude Code ...", "note");
  api.postMessage({ action: "check", provider: provider(), model });
});
$("version").addEventListener("keydown", e => { if (e.key === "Enter") { $("check").click(); } });
$("save").addEventListener("click", () => {
  if (!rows.some(r => r.on)) { say("Keep at least one model switched on.", "error"); return; }
  api.postMessage({ action: "save", provider: provider(), rows });
});
window.addEventListener("message", event => {
  const m = event.data; if (!m || m.provider !== provider()) { return; }
  if (m.error) { $("body").className = "error"; $("body").textContent = m.error; $("keyrow").hidden = !m.needKey; return; }
  if (m.rows) { rows = m.rows; render(); return; }
  if (m.probed) {
    $("check").disabled = false; $("version").value = "";
    rows.push({ id: m.probed.id, label: m.probed.label, version: true, on: true }); render();
    say(m.probed.label + " answered - Save to keep it.", "ok"); return;
  }
  if (m.probeError) { $("check").disabled = false; say(m.probeError, "error"); return; }
  if (m.saveError) { say(m.saveError, "error"); return; }
  if (m.saved) { say(m.reset ? "Saved. " + m.reset + " is no longer offered - the weakest model switched on is used." : "Saved.", "ok"); }
});
load();
</script></body></html>`;
}

module.exports = { PROVIDERS, shortLabel, read, rows, apply, open };
