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
const compatible = require("./openai-compatible");
const keyProfiles = require("./key-profiles");

// id is the assistant, setting what vertex.ai.provider holds. The label names
// what is paid for and, in brackets, what it runs through; short is for the
// VERTEX panel's button.
const PROVIDERS = [
  { id: "claude", setting: "claude-subscription", label: "Claude subscription (Claude Code)", short: "Claude" },
  { id: "codex", setting: "codex-subscription", label: "ChatGPT subscription (Codex)", short: "ChatGPT" },
  { id: "copilot", setting: "copilot", label: "GitHub Copilot (VS Code)", short: "Copilot" },
  { id: "codemie", setting: "codemie", label: "EPAM CodeMie (CodeMie CLI)", short: "CodeMie" },
  { id: "vercel-api", setting: "vercel-api", label: "Vercel AI Gateway API (key)", short: "Vercel AI Gateway API" },
  { id: "anthropic-api", setting: "anthropic-api", label: "Anthropic API (key)", short: "Anthropic API" },
  ...Object.entries(compatible.PROVIDERS).filter(([id]) => id !== "vercel-api").map(([id, provider]) => ({
    id, setting: id, label: provider.label + " API (key)", short: provider.label + " API"
  }))
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
           off: own.off === true,
           unavailable: own.unavailable && typeof own.unavailable === "object" ? own.unavailable : {},
           availabilityMigrated: own.availabilityMigrated === true };
}

// A provider switched off keeps its model ticks; it is only left out of every
// provider choice. The one in use cannot be switched off.
function isOn(vscode, id) { return !read(vscode, id).off; }
function offered(vscode) { return PROVIDERS.filter(p => isOn(vscode, p.id)); }

async function write(vscode, id, config) {
  const settings = vscode.workspace.getConfiguration("vertex.ai");
  const all = Object.assign({}, settings.get("modelConfig", {}) || {});
  const next = config.models === false ? Object.assign({}, all[id] || {})
    : { ...(all[id] || {}), ...(id === "claude" ? { enabled: config.enabled, versions: config.versions } : { hidden: config.hidden }),
        ...(config.unavailable ? { unavailable: config.unavailable } : {}) };
  if (config.off) { next.off = true; } else { delete next.off; }
  all[id] = next;
  await settings.update("modelConfig", all, vscode.ConfigurationTarget.Global);
}

/** Selection and availability are independent model properties. */
function rows(list, config, id) {
  const unavailable = config.unavailable || {};
  const decorate = model => {
    const stored = unavailable[model.id];
    if (!stored) return model;
    return { ...model, available: false, reason: stored.reason || "Marked unavailable.", availabilitySource: stored.source || "probe",
      ...(stored.source === "migration" ? {} : { checked: true }) };
  };
  if (id !== "claude") return list.map(m => decorate({ ...m, on: config.hidden.indexOf(m.id) < 0 }));
  const listed = list.map(m => ({ ...m, on: !!m.on }));
  config.versions.forEach(v => {
    if (!listed.some(m => m.id === v.id)) listed.push({ id: v.id, label: v.label || v.id, version: true, on: true });
  });
  if (config.enabled) listed.forEach(m => { m.on = config.enabled.indexOf(m.id) >= 0; });
  return listed.map(decorate);
}
let migrationQueue = Promise.resolve();
function migrateUnavailable(vscode, id, list) {
  if (id !== "vercel-api") return Promise.resolve();
  const job = migrationQueue.then(async () => {
    const settings = vscode.workspace.getConfiguration("vertex.ai");
    const all = { ...(settings.get("modelConfig", {}) || {}) }, own = all[id] || {};
    if (own.availabilityMigrated === true) return;
    const unavailable = { ...(own.unavailable || {}) };
    for (const model of rows(list, read(vscode, id), id)) {
      if (!model.on && !Object.hasOwn(unavailable, model.id)) unavailable[model.id] = {
        reason: "Unavailable", source: "probe"
      };
    }
    all[id] = { ...own, unavailable, availabilityMigrated: true };
    await settings.update("modelConfig", all, vscode.ConfigurationTarget.Global);
  });
  migrationQueue = job.catch(() => {});
  return job;
}

/** What a model list offers: the switched-on rows. */
function apply(vscode, id, list) {
  const offered = rows(list, read(vscode, id), id).filter(m => m.on && m.available !== false).map(({ on, ...model }) => model);
  if (!offered.length) {
    throw new Error("No " + id + " model is switched on. Open Config models in the VERTEX panel.");
  }
  return offered;
}

/* ---------- the table ---------- */

async function chooseLogFolder(vscode) {
  const settings = vscode.workspace.getConfiguration("vertex.ai");
  const current = settings.get("logPath", "");
  const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true,
    canSelectMany: false, openLabel: "Use for VERTEX logs",
    defaultUri: current ? vscode.Uri.file(current) : vscode.workspace.workspaceFolders?.[0]?.uri });
  if (!picked?.length) return null;
  await settings.update("logPath", picked[0].fsPath, vscode.ConfigurationTarget.Global);
  return picked[0].fsPath;
}

/**
 * Opens the table - also where the provider is chosen. full(id) is the
 * provider's whole list, forget(id) drops what was read of it; extensionPath(id)
 * is where its assistant lives, for checking a Claude version; secrets keeps
 * the Anthropic API key.
 */
function open(vscode, full, extensionPath, forget, secrets, executable) {
  const panel = vscode.window.createWebviewPanel("vertex.modelConfig", "VERTEX: LLM Providers",
    vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
  const nonce = require("crypto").randomBytes(24).toString("hex");
  const active = PROVIDERS.find(p => p.setting === vscode.workspace.getConfiguration("vertex.ai").get("provider", ""));
  panel.webview.html = html(nonce, active ? active.id : PROVIDERS[0].id,
    PROVIDERS.map(p => ({ id: p.id, label: p.label, on: isOn(vscode, p.id) })));
  const post = message => panel.webview.postMessage(message);

  const loadGeneration = new Map(), availableModels = new Map();
  async function load(id, fresh = false) {
    const generation = loadGeneration.get(id) || 0;
    const send = message => { if (generation === (loadGeneration.get(id) || 0)) post(message); };
    const profiles = (id === "anthropic-api" || compatible.PROVIDERS[id]) && secrets
      ? await keyProfiles.list(secrets, id) : null;
    let source = null;
    const codemie = id === "codemie" ? Object.assign(assistant.codemieProfiles(),
      { selected: assistant.profileFor(vscode, id) }) : undefined;
    if (id === "claude" || id === "codex") {
      const found = assistant.sources(id, extensionPath(id));
      const choice = vscode.workspace.getConfiguration("vertex.ai").get(id + "Source", "ask");
      source = { extension: found.extension, cli: found.cli,
        selected: found.extension && found.cli ? choice : found.extension ? "extension" : found.cli ? "cli" : "" };
      if (found.extension && found.cli && choice === "ask") {
        send({ provider: id, source, profiles });
        return;
      }
    }
    try {
      if (fresh) { forget(id); availableModels.delete(id); }
      const models = await full(id);
      await migrateUnavailable(vscode, id, models);
      const settings = vscode.workspace.getConfiguration("vertex.ai");
      const selected = settings.get("model", "");
      if (settings.get("provider", "") === PROVIDERS.find(p => p.id === id).setting && selected
          && !models.some(model => model.id === selected)) {
        await settings.update("model", "", vscode.ConfigurationTarget.Global);
      }
      send({ provider: id, rows: rows(models, read(vscode, id), id), profiles, source, codemie });
    } catch (e) {
      send({ provider: id, error: e.message, profiles, source, codemie });
    }
  }

  let detecting = false, cancelled = false;
  panel.onDidDispose(() => { cancelled = true; });
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== "object") { return; }
    if (message.action === "open-error-link") {
      try {
        const url = new URL(String(message.url || ""));
        if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only HTTP links are allowed.");
        await vscode.env.openExternal(vscode.Uri.parse(url.href));
      } catch (error) { post({ errorCopied: false, copyError: error.message }); }
      return;
    }
    if (message.action === "copy-error") {
      try {
        await vscode.env.clipboard.writeText(String(message.text || ""));
        post({ errorCopied: true });
      } catch (error) { post({ errorCopied: false, copyError: error.message }); }
      return;
    }
    if (message.action === "log-settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "vertex.ai.log");
      return;
    }
    if (message.action === "choose-log-folder") {
      try { const selected = await chooseLogFolder(vscode); if (selected) post({ logFolder: selected }); }
      catch (error) { post({ logFolderError: error.message }); }
      return;
    }
    if (message.action === "stop-detection") { cancelled = true; return; }
    if (message.action === "detect-model") {
      const provider = PROVIDERS.find(p => p.id === message.provider);
      if (detecting || !provider || typeof message.model !== "string") return;
      detecting = true; cancelled = false;
      try {
        const models = await full(provider.id);
        if (!models.some(model => String(model.id) === message.model)) throw new Error("Model is not in this provider's list.");
        await require("./model-detection").probe(vscode, secrets, provider.id, message.model, extensionPath, executable);
        if (!availableModels.has(provider.id)) availableModels.set(provider.id, new Set());
        availableModels.get(provider.id).add(message.model);
        post({ modelCheck: { provider: provider.id, model: message.model, available: true } });
      } catch (error) { availableModels.get(provider.id)?.delete(message.model); post({ modelCheck: { provider: provider.id, model: message.model, available: false, reason: error.message } }); }
      finally { detecting = false; }
      return;
    }
    if (message.action === "detect") {
      const provider = PROVIDERS.find(p => p.id === message.provider);
      if (detecting || !provider) return;
      detecting = true; cancelled = false; loadGeneration.set(provider.id, (loadGeneration.get(provider.id) || 0) + 1);
      try {
        const detection = require("./model-detection");
        const result = await detection.detect([provider], async id => {
          forget(id);
          return rows(await full(id), read(vscode, id), id).map(row => availableModels.get(id)?.has(String(row.id))
            ? { ...row, available: true, checked: true, on: true, reason: "", availabilitySource: "probe" } : row);
        }, (id, model) => detection.probe(vscode, secrets, id, model, extensionPath, executable),
        progress => post({ detectionProgress: progress }), () => cancelled);
        for (const checked of result.results) {
          if (!availableModels.has(checked.provider)) availableModels.set(checked.provider, new Set());
          for (const row of checked.rows || []) {
            if (row.available === true) availableModels.get(checked.provider).add(String(row.id));
            else if (row.checked) availableModels.get(checked.provider).delete(String(row.id));
          }
        }
        post({ detection: result });
      } catch (error) { post({ detectionError: error.message }); }
      finally { detecting = false; }
      return;
    }
    const id = String(message.provider || "");
    if (!PROVIDERS.some(p => p.id === id)) { return; }
    if (message.action === "load") { await load(id, true); return; }
    if (message.action === "source") {
      if (id !== "claude" && id !== "codex") { return; }
      const choice = String(message.source || "");
      const found = assistant.sources(id, extensionPath(id));
      if ((choice !== "extension" || !found.extension) && (choice !== "cli" || !found.cli)) {
        post({ provider: id, saveError: "That installation is no longer available." }); return;
      }
      try {
        await vscode.workspace.getConfiguration("vertex.ai").update(id + "Source", choice, vscode.ConfigurationTarget.Global);
        availableModels.delete(id); forget(id);
        await load(id);
      } catch (e) { post({ provider: id, saveError: e.message }); }
      return;
    }
    if (message.action === "codemie-profile") {
      if (id !== "codemie") { return; }
      const name = String(message.name || "");
      if (name && !assistant.codemieProfiles().names.includes(name)) {
        post({ provider: id, saveError: "CodeMie has no profile " + name + "." }); return;
      }
      try {
        const settings = vscode.workspace.getConfiguration("vertex.ai");
        await settings.update("codemieProfile", name, vscode.ConfigurationTarget.Global);
        // Another profile can be another project with other models.
        if (settings.get("provider", "") === "codemie") { await settings.update("model", "", vscode.ConfigurationTarget.Global); }
        availableModels.delete(id); forget(id);
        await load(id);
      } catch (e) { post({ provider: id, saveError: e.message }); }
      return;
    }
    if (message.action === "key") {
      if ((id !== "anthropic-api" && !compatible.PROVIDERS[id]) || !secrets) { return; }
      const provider = PROVIDERS.find(item => item.id === id);
      const profile = await vscode.window.showInputBox({ prompt: "Name for the " + provider.label + " key (existing name replaces that key)",
        value: "DEFAULT", ignoreFocusOut: true,
        validateInput: name => !String(name || "").trim() ? "Enter a name." : undefined });
      if (profile === undefined) { return; }
      const key = await vscode.window.showInputBox({ prompt: provider.label + " (stored in VS Code SecretStorage)",
        password: true, ignoreFocusOut: true });
      if (key && key.trim()) {
        try { await keyProfiles.save(secrets, id, profile, key); }
        catch (e) { post({ provider: id, saveError: e.message }); return; }
        availableModels.delete(id); forget(id);
      }
      await load(id);
      return;
    }
    if (message.action === "select-key") {
      if (!secrets || (id !== "anthropic-api" && !compatible.PROVIDERS[id])) { return; }
      try { await keyProfiles.select(secrets, id, String(message.name || "")); }
      catch (e) { post({ provider: id, saveError: e.message }); return; }
      availableModels.delete(id); forget(id);
      await load(id);
      return;
    }
    if (message.action === "check") {
      if (id !== "claude") { return; }
      const audit=require("./ai-accounting").begin(vscode,"claude",String(message.model||""));
      try {
        const probed = await assistant.probe({ ...audit.callbacks,assistant: "claude", extensionPath: extensionPath("claude"),
                                               executable: executable ? await executable("claude") : undefined,
                                               model: message.model });
        audit.finish(probed);
        post({ provider: id, probed: probed });
      } catch (e) {
        audit.fail(e);
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
      const api = use.id === "anthropic-api" || compatible.PROVIDERS[use.id];
      if (api && (!secrets || !(await keyProfiles.getActiveKey(secrets, use.id)).key)) {
        fail("Enter the " + use.label + " key first."); return;
      }
      for (const p of plan) {
        const known = PROVIDERS.find(x => x.id === (p && p.id));
        if (!known) { fail("Unknown provider."); return; }
        // At least one model stays on: an empty list would leave the provider
        // with nothing to ask.
      if (p.on && Array.isArray(p.rows) && !p.rows.some(r => r && r.on)) {
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
          unavailable: Object.fromEntries(list.filter(r => r && r.available === false).map(r => [String(r.id), {
            reason: String(r.reason || "Marked unavailable."), source: r.availabilitySource || "probe"
          }])),
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
  const controls = require("fs").readFileSync(require("path").join(__dirname, "resources", "vertex-controls.css"), "utf8");
  const init = JSON.stringify({ use: selected, providers }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font: var(--vscode-font-size) var(--vscode-font-family); color: var(--vscode-foreground);
       background: var(--vscode-editor-background); padding: 10px 14px; }
input, select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background);
       border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; }
input[type=checkbox], input[type=radio] { padding: 0; }
button { font: inherit; }
.prov { margin: 0 0 6px; }
.phead { display: grid; grid-template-columns: 36px 18px minmax(110px, 1fr) 70px 110px 56px; gap: 6px 8px; align-items: center; padding: 5px 8px; font-weight: 600; max-width: 600px;
         background: var(--vscode-sideBar-background, transparent); border: 1px solid var(--vscode-panel-border); }
/* EPAM CodeMie's row, in CodeMie's gradient as in the VERTEX panel (light and dark themes; high
   contrast keeps the theme's colours). Its buttons keep theirs. */
body.vscode-dark .phead.codemie, body.vscode-light .phead.codemie { color: #fff; border-color: transparent;
  background: linear-gradient(90deg, #4f46e5, #9333ea 55%, #c026d3); }
.phead .use { margin-left: 0; white-space: nowrap; font-weight: normal; display: flex; gap: 4px; align-items: center; }
.phead .provider-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.phead button { box-sizing: border-box; width: 100%; white-space: nowrap; }
.phead .stop.idle { visibility: hidden; }
.phead .check-status { grid-column: 1 / -1; min-width: 0; height: 1.4em; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.phead .check-status:empty { display: none; }
.phead.group-header { grid-template-columns: 36px 1fr; margin: 0 0 6px; }
.pbody { margin-left: 22px; }
.prov.off .pbody { opacity: .55; }
table { border-collapse: collapse; margin: 6px 0; min-width: 420px; }
th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; }
th { background: var(--vscode-keybindingTable-headerBackground, transparent); }
.model-table-scroll { overflow-x: auto; }
.model-sort { cursor: pointer; white-space: nowrap; }
.model-sort:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.models-table td.numeric { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.models-table td.cap-cell { text-align: center; }
td.id { font-family: var(--vscode-editor-font-family); }
.row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
.note { color: var(--vscode-descriptionForeground); }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
a.error-link, #error-dialog a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
#error-dialog { color: var(--vscode-foreground); background: var(--vscode-editorWidget-background,var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); padding: 14px 18px; width: min(760px,80vw); max-height: 80vh; overflow: auto; }
#error-dialog::backdrop { background: var(--vscode-widget-shadow,transparent); }
#error-text { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; margin: 12px 0; }
.capability { display: inline-block; margin-left: 5px; font-weight: normal; }
.capability.missing { opacity: .45; }
.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
</style><style>${controls}</style></head><body>
<dialog id="error-dialog" aria-labelledby="error-title"><strong id="error-title">Model check error</strong><div id="error-text"></div><div class="row"><button id="copy-dialog-error" type="button">Copy error</button><button id="close-error" type="button">Close</button><span id="error-copy-status" role="status"></span></div></dialog>
<div id="tree"></div>
<div class="row"><button class="primary" id="save">Save</button><button id="stop-detection" type="button" hidden>Stop</button><button id="choose-log-folder" type="button">Choose log folder...</button><button id="log-settings" type="button" title="Open logging settings" aria-label="Open logging settings">⚙</button><span id="said"></span></div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const INIT = ${init};
const capabilityDefinitions = ${JSON.stringify(require("./model-capabilities").definitions)};
const priceInfo = ${require("./model-capabilities").priceInfo.toString()};
const sortModels = ${require("./model-capabilities").sortModels.toString()};
let use = INIT.use;
let apiExpanded = use.endsWith("-api") && use !== "vercel-api";
let scanning = false, scanningProvider = "";
const checkStatus = {}, checkErrors = {};
// Per provider: on, and its rows once read (null while loading or when it could not be read).
const state = {};
INIT.providers.forEach(p => { state[p.id] = { label: p.label, on: p.on, rows: null, profiles: null,
  source: null, hideUnavailable: true, expanded: p.id === INIT.use }; });
const $ = id => document.getElementById(id);
function say(text, kind) { $("said").textContent = text || ""; $("said").className = kind || "note"; }
function el(tag, props) { return Object.assign(document.createElement(tag), props || {}); }
function copyErrorButton(text) {
  const button = el("button", { type: "button", textContent: "Copy error", title: "Copy the full error, including links" });
  button.addEventListener("click", () => api.postMessage({ action: "copy-error", text }));
  return button;
}
let shownError = "";
function showError(text) {
  shownError = text;
  const content = $("error-text"); content.replaceChildren();
  $("error-copy-status").textContent = "";
  let at = 0;
  for (const match of text.matchAll(/https?:[/][/][^\\s<>"']+/g)) {
    content.appendChild(document.createTextNode(text.slice(at, match.index)));
    const url = match[0].replace(/[.,;!?]+$/, "");
    const link = el("a", { href: url, textContent: url });
    link.addEventListener("click", event => { event.preventDefault(); api.postMessage({ action: "open-error-link", url }); });
    content.appendChild(link); at = match.index + url.length;
  }
  content.appendChild(document.createTextNode(text.slice(at)));
  $("error-dialog").showModal();
}
$("copy-dialog-error").addEventListener("click", () => api.postMessage({ action: "copy-error", text: shownError }));
$("close-error").addEventListener("click", () => $("error-dialog").close());
function build() {
  const tree = $("tree"); tree.innerHTML = "";
  let apiBody;
  INIT.providers.forEach(p => {
    const grouped = p.id.endsWith("-api") && p.id !== "vercel-api";
    if (grouped && !apiBody) {
      const header = el("div", { className: "phead group-header" });
      const fold = el("button", { className: "fold", type: "button", textContent: apiExpanded ? "▾" : "▸",
        title: apiExpanded ? "Collapse API providers" : "Expand API providers" });
      fold.setAttribute("aria-expanded", String(apiExpanded));
      fold.addEventListener("click", () => { apiExpanded = !apiExpanded; build(); });
      header.appendChild(fold); header.appendChild(el("span", { textContent: "API providers" }));
      tree.appendChild(header);
      apiBody = el("div", { id: "api-providers" }); apiBody.hidden = !apiExpanded;
      tree.appendChild(apiBody);
    }
    const s = state[p.id];
    const box = el("div", { className: "prov" + (s.on ? "" : " off") });
    const head = el("div", { className: "phead" + (p.id === "codemie" ? " codemie" : "") });
    const fold = el("button", { className: "fold", type: "button", textContent: s.expanded ? "▾" : "▸",
      title: s.expanded ? "Collapse models" : "Expand models" });
    fold.setAttribute("aria-expanded", String(s.expanded));
    fold.addEventListener("click", () => { s.expanded = !s.expanded; build(); });
    head.appendChild(fold);
    const on = el("input", { type: "checkbox", checked: s.on, disabled: use === p.id,
      title: use === p.id ? "In use - switch to another provider first" : "Offer this provider" });
    on.addEventListener("change", () => { s.on = on.checked; say(""); build(); });
    head.appendChild(on);
    head.appendChild(el("span", { className: "provider-name", textContent: p.label, title: p.label }));
    const useLabel = el("label", { className: "use" });
    const radio = el("input", { type: "radio", name: "use", checked: use === p.id, disabled: !s.on,
      title: s.on ? "Use this provider" : "Switch the provider on first" });
    radio.addEventListener("change", () => { use = p.id; say(""); build(); });
    useLabel.appendChild(radio); useLabel.appendChild(document.createTextNode("In use"));
    head.appendChild(useLabel);
    const check = el("button", { className: "check-models", type: "button", textContent: scanningProvider === p.id ? "Checking…" : "Check models", disabled: scanning,
      title: "Test only this provider’s models with short requests; normal provider usage applies." });
    check.addEventListener("click", () => {
      scanning = true; scanningProvider = p.id; checkErrors[p.id] = ""; checkStatus[p.id] = "Reading model list…";
      api.postMessage({ action: "detect", provider: p.id });
      build(); $("save").disabled = true; $("stop-detection").hidden = false;
      say("Checking " + p.label + "…");
    });
    head.appendChild(check);
    {
      const stop = el("button", { className: "stop" + (scanningProvider === p.id ? "" : " idle"),
        type: "button", textContent: "Stop", disabled: scanningProvider !== p.id });
      stop.addEventListener("click", () => { api.postMessage({ action: "stop-detection" }); stop.disabled = true;
        checkStatus[p.id] = "Stopping after the current request…"; $("check-status-" + p.id).textContent = checkStatus[p.id]; });
      head.appendChild(stop);
    }
    const status = el("span", { id: "check-status-" + p.id, className: "note check-status", textContent: checkStatus[p.id] || "", title: checkStatus[p.id] || "" });
    status.setAttribute("role", "status");
    head.appendChild(status);
    box.appendChild(head);
    const body = el("div", { className: "pbody", id: "body-" + p.id });
    body.hidden = !s.expanded;
    box.appendChild(body);
    (grouped ? apiBody : tree).appendChild(box);
    fill(p.id);
  });
}
function fill(id) {
  const s = state[id], body = $("body-" + id); body.innerHTML = "";
  if (s.source && (s.source.extension || s.source.cli)) {
    const source = s.source;
    const both = source.extension && source.cli;
    const row = el("div", { className: "row" });
    row.appendChild(el("span", { textContent: "Run via" }));
    if (both) {
      const picker = el("select", { title: "Installation used by VERTEX" });
      picker.appendChild(el("option", { value: "ask", textContent: "Choose installation..." }));
      picker.appendChild(el("option", { value: "extension", textContent: "VS Code extension" }));
      picker.appendChild(el("option", { value: "cli", textContent: "CLI" }));
      picker.value = source.selected || "ask";
      picker.addEventListener("change", () => {
        if (picker.value === "ask") { return; }
        picker.disabled = true;
        say("Saving " + id + " installation...", "note");
        api.postMessage({ action: "source", provider: id, source: picker.value });
      });
      row.appendChild(picker);
    } else {
      row.appendChild(el("span", { textContent: source.cli ? "CLI" : "VS Code extension" }));
    }
    const activePath = source.selected === "cli" ? source.cli
      : source.selected === "extension" ? source.extension : "";
    if (activePath) { row.appendChild(el("span", { className: "note", textContent: activePath })); }
    body.appendChild(row);
    if (both && source.selected === "ask") {
      body.appendChild(el("div", { className: "note", textContent: "Choose an installation to load its models." }));
      return;
    }
  }
  // With one profile or none there is nothing to choose: the active one is used.
  if (id === "codemie" && s.codemie && s.codemie.names.length > 1) {
    const row = el("div", { className: "row" });
    row.appendChild(el("span", { textContent: "Profile" }));
    const picker = el("select", { title: "CodeMie profile used by VERTEX" });
    picker.appendChild(el("option", { value: "", textContent: "Active in CodeMie" + (s.codemie.active ? " (" + s.codemie.active + ")" : "") }));
    s.codemie.names.forEach(name => picker.appendChild(el("option", { value: name, textContent: name })));
    picker.value = s.codemie.names.includes(s.codemie.selected) ? s.codemie.selected : "";
    picker.addEventListener("change", () => {
      picker.disabled = true;
      say("Saving CodeMie profile...", "note");
      api.postMessage({ action: "codemie-profile", provider: id, name: picker.value });
    });
    row.appendChild(picker); body.appendChild(row);
  }
  if (id === "anthropic-api" || id.endsWith("-api")) {
    const row = el("div", { className: "row" });
    const profiles = s.profiles || { names: [], active: "" };
    if (profiles.names.length) {
      const picker = el("select", { title: "Active API key" });
      profiles.names.forEach(name => picker.appendChild(el("option", { value: name, textContent: name })));
      picker.value = profiles.active;
      picker.addEventListener("change", () => api.postMessage({ action: "select-key", provider: id, name: picker.value }));
      row.appendChild(picker);
    }
    const key = el("button", { textContent: "Add or replace key" });
    key.addEventListener("click", () => api.postMessage({ action: "key", provider: id }));
    row.appendChild(key); body.appendChild(row);
  }
  if (checkErrors[id] || s.error) {
    const row = el("div", { className: "row" });
    row.appendChild(copyErrorButton(s.label + "\\n" + (checkErrors[id] || s.error)));
    body.appendChild(row);
  }
  if (s.error) {
    body.appendChild(el("div", { className: "error", textContent: s.error }));
    return;
  }
  if (!s.rows) { body.appendChild(el("div", { className: "note", textContent: "Loading ..." })); return; }
  if (!s.rows.length) {
    body.appendChild(el("div", { className: "error", textContent: s.label + ": no models were returned. Reopen Config models to retry." }));
    if (id === "claude") {
      body.appendChild(el("div", { className: "note", textContent: "Claude's model list is built into VERTEX; this is not an account sign-in check." }));
    }
    return;
  }
  const bulk = el("button", { type: "button" });
  const updateBulk = () => {
    const all = s.rows.length > 0 && s.rows.every(r => r.on);
    bulk.textContent = all ? "Clear all" : "Select all";
    bulk.title = all ? "Clear all models for this provider" : "Select all models for this provider";
  };
  bulk.addEventListener("click", () => {
    const next = !s.rows.every(r => r.on);
    s.rows.forEach(r => { r.on = next && r.available !== false; });
    table.querySelectorAll('tbody input[type="checkbox"]').forEach(box => { box.checked = next && !box.disabled; });
    updateBulk(); say("");
  });
  updateBulk();
  const toolbar = el("div", { className: "row" }); toolbar.appendChild(bulk);
  const hideLabel = el("label", { className: "row" });
  const hide = el("input", { type: "checkbox", checked: !!s.hideUnavailable, title: "Hide unavailable models" });
  hide.addEventListener("change", () => { s.hideUnavailable = hide.checked; fill(id); });
  hideLabel.appendChild(hide); hideLabel.appendChild(document.createTextNode("Hide unavailable"));
  toolbar.appendChild(hideLabel); body.appendChild(toolbar);
  const table = el("table", { className: "models-table" });
  const hasMetadata = s.rows.some(row => row.capabilities || row.pricing || row.contextWindow);
  const columns = [{ key: "on", label: "On" }, { key: "label", label: "Model" }, { key: "id", label: "ID" }];
  if (hasMetadata) {
    capabilityDefinitions.forEach(d => columns.push({ key: "cap." + d.key, label: d.icon, title: d.label }));
    columns.push({ key: "contextWindow", label: "Context" }, { key: "inputPrice", label: "In $/1M" }, { key: "outputPrice", label: "Out $/1M" });
  }
  columns.push({ key: "availability", label: "Check" });
  const head = el("thead"), headerRow = el("tr");
  columns.forEach(column => {
    const selected = s.sort?.key === column.key;
    const th = el("th"); th.setAttribute("aria-sort", selected ? s.sort.down ? "descending" : "ascending" : "none");
    const label = el("span", { className: "model-sort", tabIndex: 0, textContent: column.label + (selected ? s.sort.down ? " ▼" : " ▲" : ""), title: (column.title || column.label) + " — click to sort; click again to reverse" });
    label.setAttribute("role", "button"); label.setAttribute("aria-label", label.title);
    const sort = () => { s.sort = { key: column.key, down: selected ? !s.sort.down : false }; fill(id); };
    label.addEventListener("click", sort); label.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sort(); } });
    th.appendChild(label);headerRow.appendChild(th);
  });
  head.appendChild(headerRow);table.appendChild(head);
  const tbody = el("tbody");
  sortModels(s.rows, s.sort?.key, s.sort?.down).forEach(r => {
    if (s.hideUnavailable && r.available === false) return;
    const i = s.rows.indexOf(r);
    const tr = el("tr");
    const box = el("input", { type: "checkbox", checked: r.on, disabled: r.available === false, title: r.reason || "" });
    box.addEventListener("change", () => { r.on = box.checked; updateBulk(); say(""); });
    tr.appendChild(el("td")).appendChild(box);
    tr.appendChild(el("td", { textContent: r.label }));
    tr.appendChild(el("td", { className: "id", textContent: r.id === "" ? "(default)" : r.id }));
    const price = priceInfo(r);
    if (hasMetadata) {
      capabilityDefinitions.forEach(d => {
        const value = r.capabilities?.[d.key];
        const title = d.label + ": " + (value === true ? d.yes : value === false ? d.no || "Not supported by the catalog declaration." : "Not reported by the catalog; not tested.");
        const td = el("td", { className: "cap-cell" });
        const badge = el("span", { className: "capability" + (value === true ? "" : " missing"), textContent: value === true ? d.icon : value === false ? "×" : "?", title, tabIndex: 0 });
        badge.setAttribute("aria-label", title);td.appendChild(badge);tr.appendChild(td);
      });
      tr.appendChild(el("td", { className: "numeric", textContent: r.contextWindow ? r.contextWindow.toLocaleString() : "—", title: "Context window in tokens" }));
      tr.appendChild(el("td", { className: "numeric", textContent: (price?.input || "—") + (price?.variable ? " *" : ""), title: price?.title || "Price not reported" }));
      tr.appendChild(el("td", { className: "numeric", textContent: (price?.output || "—") + (price?.variable ? " *" : ""), title: price?.title || "Price not reported" }));
    }
    const act = tr.appendChild(el("td"));
    const checkOne = el("button", { type: "button", textContent: "✓", disabled: scanning,
      title: "Check only this model with one short paid request (Reply OK, up to 16 output tokens)" });
    checkOne.setAttribute("aria-label", "Check model " + (r.label || r.id));
    checkOne.addEventListener("click", () => {
      scanning = true; scanningProvider = id; build(); $("save").disabled = true;
      say("Checking " + (r.label || r.id) + "…");
      api.postMessage({ action: "detect-model", provider: id, model: String(r.id) });
    });
    act.appendChild(checkOne);
    if (r.available === false) {
      const link = el("a", { className: "error-link", href: "#", textContent: "Unavailable", title: "Show model check error" });
      link.addEventListener("click", event => { event.preventDefault(); showError(s.label + " · " + (r.label || r.id) + " (" + r.id + ")\\n" + (r.reason || "The model is unavailable.")); });
      act.appendChild(link);
    }
    if (r.available !== false && r.checked === false) act.appendChild(el("span", { className: "note", textContent: "Not checked" }));
    if (r.version) {
      const remove = el("button", { textContent: "Remove" });
      remove.addEventListener("click", () => { s.rows.splice(i, 1); fill(id); say("Removed - Save to keep it.", "note"); });
      act.appendChild(remove);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); const scroll = el("div", { className: "model-table-scroll" });scroll.appendChild(table);body.appendChild(scroll);
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
  const bad = INIT.providers.find(p => state[p.id].on && state[p.id].rows && !state[p.id].rows.some(r => r.on));
  if (bad) { say(bad.label + ": keep at least one model switched on.", "error"); return; }
  api.postMessage({ action: "save", provider: use, use,
    providers: INIT.providers.map(p => ({ id: p.id, on: state[p.id].on, rows: state[p.id].rows })) });
});
$("stop-detection").addEventListener("click", () => {
  api.postMessage({ action: "stop-detection" }); $("stop-detection").disabled = true;
  say("Stopping after the current request…");
});
$("log-settings").addEventListener("click", () => api.postMessage({ action: "log-settings" }));
$("choose-log-folder").addEventListener("click", () => api.postMessage({ action: "choose-log-folder" }));
window.addEventListener("message", event => {
  const m = event.data;
  if (m?.modelCheck) {
    const result = m.modelCheck, s = state[result.provider];
    scanning = false; scanningProvider = "";
    const row = s?.rows?.find(row => String(row.id) === result.model);
    if (row) { row.checked = true; row.available = result.available; row.reason = result.reason || ""; row.on = result.available; row.availabilitySource = "probe"; }
    if (s) checkErrors[result.provider] = result.reason || "";
    build(); $("save").disabled = false;
    say(result.available ? "Model is available. Save to apply." : result.reason, result.available ? "ok" : "error"); return;
  }
  if (m?.detectionProgress) {
    const p = m.detectionProgress;
    checkStatus[p.provider] = p.model ? "Checking " + p.index + " / " + p.total + ": " + p.model + "…" : "Reading model list…";
    const status = $("check-status-" + p.provider); if (status) { status.textContent = checkStatus[p.provider]; status.title = checkStatus[p.provider]; }
    say(checkStatus[p.provider]); return;
  }
  if (m?.detection || m?.detectionError) {
    const checkedProvider = scanningProvider;
    scanning = false; scanningProvider = ""; build(); $("save").disabled = false; $("stop-detection").hidden = true; $("stop-detection").disabled = false;
    if (m.detectionError) { checkErrors[checkedProvider] = m.detectionError; checkStatus[checkedProvider] = m.detectionError; build(); say(m.detectionError, "error"); return; }
    m.detection.results.forEach(result => {
      const checked = result.checked ?? result.rows?.length ?? 0;
      const working = result.rows ? result.rows.filter(r => r.checked !== false && r.available !== false && r.on).length : 0;
      checkStatus[result.provider] = !result.rows ? result.error
        : result.partial || result.stopReason || m.detection.cancelled
          ? "Stopped: " + checked + " / " + (result.total ?? result.rows.length) + " checked · " + working + " working" + (result.stopReason ? " · " + result.stopReason : "")
          : working + " / " + result.rows.length + " working";
      checkErrors[result.provider] = result.stopReason || result.error || "";
      const s = state[result.provider];
      if (result.rows) { s.rows = result.rows; s.error = null; if (!result.partial) s.on = result.rows.some(r => r.on); }
      else { s.error = result.error; s.on = false; }
    });
    if (m.detection.cancelled && !m.detection.results.length) checkStatus[checkedProvider] = "Stopped before checking models";
    const first = INIT.providers.find(p => state[p.id].on);
    if (!state[use].on && first) use = first.id;
    const stopped = m.detection.cancelled || m.detection.results.some(r => r.stopReason);
    build(); say((stopped ? "Stopped. Checked results are kept; untested models are unchanged. " : "Check complete. Unavailable models are off. ")
      + "Save to apply." + (m.detection.results.find(r => r.stopReason)?.stopReason ? " " + m.detection.results.find(r => r.stopReason).stopReason : "")); return;
  }
  if (typeof m?.errorCopied === "boolean") {
    $("error-copy-status").textContent = m.errorCopied ? "Copied." : "Could not copy: " + (m.copyError || "");
    say(m.errorCopied ? "Full error copied to clipboard." : "Could not copy error: " + (m.copyError || ""), m.errorCopied ? "ok" : "error"); return;
  }
  if (m?.logFolder) { say("Logs: " + m.logFolder, "ok"); return; }
  if (m?.logFolderError) { say(m.logFolderError, "error"); return; }
  if (!m || !state[m.provider]) { return; }
  const s = state[m.provider];
  if (m.profiles) { s.profiles = m.profiles; }
  if (m.source) { s.source = m.source; }
  if (m.codemie) { s.codemie = m.codemie; }
  if (m.error) { s.error = m.error; fill(m.provider); return; }
  if (m.rows) { s.error = null; s.rows = m.rows; fill(m.provider); return; }
  if (m.source) { s.error = null; s.rows = null; fill(m.provider); return; }
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

module.exports = { PROVIDERS, shortLabel, read, rows, apply, open, isOn, offered, chooseLogFolder, migrateUnavailable };
