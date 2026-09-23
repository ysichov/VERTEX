"use strict";

// Which models VERTEX offers, per provider: the ones a person switched off are
// left out of every model list, and a Claude version checked by its full id is
// added to Claude's. Kept in the setting vertex.ai.modelConfig as
//   { "<provider>": { hidden: [...], enabled: [...], versions: [{ id, label }], off: true } }
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
           versions: Array.isArray(own.versions) ? own.versions.filter(v => v && v.id) : [],
           off: own.off === true };
}

// A provider switched off keeps its model ticks; it is only left out of every
// provider choice. The one in use cannot be switched off.
function isOn(vscode, id) { return !read(vscode, id).off; }
function offered(vscode) { return PROVIDERS.filter(p => isOn(vscode, p.id)); }

async function write(vscode, id, config) {
  const settings = vscode.workspace.getConfiguration("vertex.ai");
  const all = Object.assign({}, settings.get("modelConfig", {}) || {});
  const next = config.models === false ? Object.assign({}, all[id] || {})
    : id === "claude" ? { enabled: config.enabled, versions: config.versions } : { hidden: config.hidden };
  if (config.off) { next.off = true; } else { delete next.off; }
  all[id] = next;
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
  panel.webview.html = html(nonce, active ? active.id : PROVIDERS[0].id,
    PROVIDERS.map(p => ({ id: p.id, label: p.label, on: isOn(vscode, p.id) })));
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
      const settings = vscode.workspace.getConfiguration("vertex.ai");
      const plan = Array.isArray(message.providers) ? message.providers : [];
      const use = PROVIDERS.find(p => p.id === message.use);
      const fail = text => post({ provider: id, saveError: text });
      if (!use) { fail("Choose the provider in use."); return; }
      const mine = plan.find(p => p && p.id === use.id);
      if (!mine || !mine.on) { fail(use.label + " is in use and stays switched on. Switch to another provider first."); return; }
      for (const p of plan) {
        const known = PROVIDERS.find(x => x.id === (p && p.id));
        if (!known) { fail("Unknown provider."); return; }
        // At least one model stays on: an empty list would leave the provider
        // with nothing to ask.
        if (Array.isArray(p.rows) && !p.rows.some(r => r && r.on)) {
          fail(known.label + ": keep at least one model switched on."); return;
        }
      }
      for (const p of plan) {
        const list = Array.isArray(p.rows) ? p.rows : null;
        // A provider that could not be read keeps its model settings; only its switch is saved.
        await write(vscode, p.id, list ? {
          off: !p.on,
          hidden: list.filter(r => r && !r.on).map(r => String(r.id)),
          enabled: list.filter(r => r && r.on).map(r => String(r.id)),
          versions: p.id === "claude"
            ? list.filter(r => r && r.version).map(r => ({ id: String(r.id), label: String(r.label || r.id) }))
            : []
        } : { off: !p.on, models: false });
      }
      // A model chosen for another provider, or just switched off, is chosen
      // no longer: the weakest one switched on takes its place.
      const switched = settings.get("provider", "") !== use.setting;
      const current = settings.get("model", "");
      const inUse = Array.isArray(mine.rows) ? mine.rows : [];
      const reset = !!current && (switched || inUse.some(r => r && !r.on && String(r.id) === current));
      if (switched) { await settings.update("provider", use.setting, vscode.ConfigurationTarget.Global); }
      if (reset) { await settings.update("model", "", vscode.ConfigurationTarget.Global); }
      post({ provider: id, saved: true, reset: reset ? current : "" });
    }
  });
  return panel;
}

function html(nonce, selected, providers) {
  const init = JSON.stringify({ use: selected, providers }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font: var(--vscode-font-size) var(--vscode-font-family); color: var(--vscode-foreground);
       background: var(--vscode-editor-background); padding: 10px 14px; }
input, button { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
       border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; }
input[type=checkbox], input[type=radio] { padding: 0; }
button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); cursor: pointer; }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.prov { margin: 0 0 14px; }
.phead { display: flex; gap: 8px; align-items: center; padding: 5px 8px; font-weight: 600; max-width: 600px;
         background: var(--vscode-sideBar-background, transparent); border: 1px solid var(--vscode-panel-border); }
.phead .use { margin-left: auto; font-weight: normal; display: flex; gap: 4px; align-items: center; }
.pbody { margin-left: 22px; }
.prov.off .pbody { opacity: .55; }
table { border-collapse: collapse; margin: 6px 0; min-width: 420px; }
th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; }
th { background: var(--vscode-keybindingTable-headerBackground, transparent); }
td.id { font-family: var(--vscode-editor-font-family); }
.row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
.note { color: var(--vscode-descriptionForeground); }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
</style></head><body>
<div id="tree"></div>
<div class="row"><button class="primary" id="save">Save</button><span id="said"></span></div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const INIT = ${init};
let use = INIT.use;
// Per provider: on, and its rows once read (null while loading or when it could not be read).
const state = {};
INIT.providers.forEach(p => { state[p.id] = { label: p.label, on: p.on, rows: null }; });
const $ = id => document.getElementById(id);
function say(text, kind) { $("said").textContent = text || ""; $("said").className = kind || "note"; }
function el(tag, props) { return Object.assign(document.createElement(tag), props || {}); }
function build() {
  const tree = $("tree"); tree.innerHTML = "";
  INIT.providers.forEach(p => {
    const s = state[p.id];
    const box = el("div", { className: "prov" + (s.on ? "" : " off") });
    const head = el("div", { className: "phead" });
    const on = el("input", { type: "checkbox", checked: s.on, disabled: use === p.id,
      title: use === p.id ? "In use - switch to another provider first" : "Offer this provider" });
    on.addEventListener("change", () => { s.on = on.checked; say(""); build(); });
    head.appendChild(on);
    head.appendChild(el("span", { textContent: p.label }));
    const useLabel = el("label", { className: "use" });
    const radio = el("input", { type: "radio", name: "use", checked: use === p.id, disabled: !s.on,
      title: s.on ? "Use this provider" : "Switch the provider on first" });
    radio.addEventListener("change", () => { use = p.id; say(""); build(); });
    useLabel.appendChild(radio); useLabel.appendChild(document.createTextNode("In use"));
    head.appendChild(useLabel);
    box.appendChild(head);
    box.appendChild(el("div", { className: "pbody", id: "body-" + p.id }));
    tree.appendChild(box);
    fill(p.id);
  });
}
function fill(id) {
  const s = state[id], body = $("body-" + id); body.innerHTML = "";
  if (s.error) {
    body.appendChild(el("div", { className: "error", textContent: s.error }));
    if (s.needKey) {
      const key = el("button", { textContent: "Enter API key" });
      key.addEventListener("click", () => api.postMessage({ action: "key", provider: id }));
      body.appendChild(el("div", { className: "row" })).appendChild(key);
    }
    return;
  }
  if (!s.rows) { body.appendChild(el("div", { className: "note", textContent: "Loading ..." })); return; }
  const table = el("table");
  table.innerHTML = "<thead><tr><th>On</th><th>Model</th><th>Id</th><th></th></tr></thead>";
  const tbody = el("tbody");
  s.rows.forEach((r, i) => {
    const tr = el("tr");
    const box = el("input", { type: "checkbox", checked: r.on });
    box.addEventListener("change", () => { r.on = box.checked; say(""); });
    tr.appendChild(el("td")).appendChild(box);
    tr.appendChild(el("td", { textContent: r.label }));
    tr.appendChild(el("td", { className: "id", textContent: r.id === "" ? "(default)" : r.id }));
    const act = tr.appendChild(el("td"));
    if (r.version) {
      const remove = el("button", { textContent: "Remove" });
      remove.addEventListener("click", () => { s.rows.splice(i, 1); fill(id); say("Removed - Save to keep it.", "note"); });
      act.appendChild(remove);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); body.appendChild(table);
  if (id === "claude") {
    const row = el("div", { className: "row" });
    const input = el("input", { placeholder: "claude-opus-5", spellcheck: false });
    const check = el("button", { id: "check", textContent: "Check and add" });
    check.addEventListener("click", () => {
      const model = input.value.trim(); if (!model) { return; }
      if (s.rows.some(r => r.id === model)) { say(model + " is already in the table.", "error"); return; }
      check.disabled = true; say("Checking " + model + " with Claude Code ...", "note");
      api.postMessage({ action: "check", provider: id, model });
    });
    input.addEventListener("keydown", e => { if (e.key === "Enter") { check.click(); } });
    row.appendChild(input); row.appendChild(check); body.appendChild(row);
  }
}
$("save").addEventListener("click", () => {
  if (!state[use] || !state[use].on) { say("The provider in use stays switched on.", "error"); return; }
  const bad = INIT.providers.find(p => state[p.id].rows && !state[p.id].rows.some(r => r.on));
  if (bad) { say(bad.label + ": keep at least one model switched on.", "error"); return; }
  api.postMessage({ action: "save", provider: use, use,
    providers: INIT.providers.map(p => ({ id: p.id, on: state[p.id].on, rows: state[p.id].rows })) });
});
window.addEventListener("message", event => {
  const m = event.data; if (!m || !state[m.provider]) { return; }
  const s = state[m.provider];
  if (m.error) { s.error = m.error; s.needKey = m.needKey; fill(m.provider); return; }
  if (m.rows) { s.error = null; s.rows = m.rows; fill(m.provider); return; }
  if (m.probed) {
    s.rows.push({ id: m.probed.id, label: m.probed.label, version: true, on: true }); fill(m.provider);
    say(m.probed.label + " answered - Save to keep it.", "ok"); return;
  }
  if (m.probeError) { const c = $("check"); if (c) { c.disabled = false; } say(m.probeError, "error"); return; }
  if (m.saveError) { say(m.saveError, "error"); return; }
  if (m.saved) { say(m.reset ? "Saved. " + m.reset + " is no longer offered - the weakest model switched on is used." : "Saved.", "ok"); }
});
build();
INIT.providers.forEach(p => api.postMessage({ action: "load", provider: p.id }));
</script></body></html>`;
}

module.exports = { PROVIDERS, shortLabel, read, rows, apply, open, isOn, offered };
