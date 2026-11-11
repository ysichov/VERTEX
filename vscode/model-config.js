"use strict";

// Which models VERTEX offers, per provider: the ones a person switched off are
// left out of every model list, and a Claude version checked by its full id is
// added to Claude's. Kept in the setting vertex.ai.modelConfig as
//   { "<provider>": { enabled: [...], known: [...], versions: [{ id, label }], off: true } }
// Only the models in enabled are offered: a model a provider adds to its
// catalog later is not in known, shows in the table as new and stays off until
// the person ticks it. A ticked model the catalog no longer has stays in the
// table as not in catalog and is not offered. A setting saved before enabled
// was kept for every provider holds hidden instead; adopt() turns it into
// enabled once, from the catalog read at that moment. Claude's list is
// VERTEX's own (CLAUDE_VERSIONS): until it is saved once, the models marked on
// are on; after that, enabled says which.

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
  { id: "openrouter-api", setting: "openrouter-api", label: "OpenRouter API (key)", short: "OpenRouter API" },
  { id: "opencode-api", setting: "opencode-api", label: "OpenCode Console API (key)", short: "OpenCode API" },
  { id: "typesafe-api", setting: "typesafe-api", label: "TypeSafe Jev API (key)", short: "TypeSafe Jev", decisionOnly: true },
  { id: "anthropic-api", setting: "anthropic-api", label: "Anthropic API (key)", short: "Anthropic API" },
  ...Object.entries(compatible.PROVIDERS).filter(([, provider]) => provider.local).map(([id, provider]) => ({
    id, setting: id, label: provider.label + " (local server)", short: provider.label
  })),
  ...Object.entries(compatible.PROVIDERS).filter(([id, provider]) => !["vercel-api", "openrouter-api", "opencode-api", "typesafe-api"].includes(id) && !provider.local).map(([id, provider]) => ({
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
           known: Array.isArray(own.known) ? own.known : null,
           versions: Array.isArray(own.versions) ? own.versions.filter(v => v && v.id) : [],
           // A local server (LM Studio, Ollama) starts switched off unless it is the provider in use.
           off: own.off === true || compatible.isLocal(id) && own.off !== false
             && vscode.workspace.getConfiguration("vertex.ai").get("provider", "") !== id,
           unavailable: own.unavailable && typeof own.unavailable === "object" ? own.unavailable : {},
           availabilityMigrated: own.availabilityMigrated === true };
}

// A provider switched off keeps its model ticks; it is only left out of every
// provider choice. The one in use cannot be switched off.
function isOn(vscode, id) { return !read(vscode, id).off; }
function offered(vscode, includeDecisions = false) { return PROVIDERS.filter(p => (includeDecisions || !p.decisionOnly) && isOn(vscode, p.id)); }

async function write(vscode, id, config) {
  const settings = vscode.workspace.getConfiguration("vertex.ai");
  const all = Object.assign({}, settings.get("modelConfig", {}) || {});
  const next = config.models === false ? Object.assign({}, all[id] || {})
    : { ...(all[id] || {}), ...(id === "claude" ? { enabled: config.enabled, versions: config.versions } : { enabled: config.enabled, known: config.known }),
        ...(config.unavailable ? { unavailable: config.unavailable } : {}) };
  if (config.models !== false && id !== "claude") delete next.hidden;
  if (config.off) { next.off = true; } else if (compatible.isLocal(id)) { next.off = false; } else { delete next.off; }
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
  if (id !== "claude") {
    if (!config.enabled) throw new Error("The " + id + " model table has not been taken over from its old form yet.");
    const listed = list.map(m => decorate({ ...m, on: config.enabled.indexOf(m.id) >= 0,
      ...(config.known && config.known.indexOf(m.id) < 0 ? { isNew: true } : {}) }));
    config.enabled.forEach(model => {
      if (!list.some(m => m.id === model)) listed.push({ id: model, label: model, on: true, missing: true });
    });
    return listed;
  }
  const listed = list.map(m => ({ ...m, on: !!m.on }));
  config.versions.forEach(v => {
    if (!listed.some(m => m.id === v.id)) listed.push({ id: v.id, label: v.label || v.id, version: true, on: true });
  });
  if (config.enabled) listed.forEach(m => { m.on = config.enabled.indexOf(m.id) >= 0; });
  return listed.map(decorate);
}
// The one-time move from hidden to enabled: what was offered stays offered,
// everything the catalog adds later arrives switched off.
// The table loads every provider at once, and each move rewrites the whole
// modelConfig setting: one at a time, each reading what the one before wrote.
let adoptQueue = Promise.resolve();
function adopt(vscode, id, list) {
  const job = adoptQueue.then(() => adoptOne(vscode, id, list));
  adoptQueue = job.catch(() => {});
  return job;
}
async function adoptOne(vscode, id, list) {
  if (id === "claude" || read(vscode, id).enabled) return;
  const settings = vscode.workspace.getConfiguration("vertex.ai");
  const all = Object.assign({}, settings.get("modelConfig", {}) || {});
  const own = Object.assign({}, all[id] || {});
  const hidden = Array.isArray(own.hidden) ? own.hidden : [];
  own.enabled = list.map(m => String(m.id)).filter(model => hidden.indexOf(model) < 0);
  own.known = list.map(m => String(m.id));
  delete own.hidden;
  all[id] = own;
  await settings.update("modelConfig", all, vscode.ConfigurationTarget.Global);
}
// What the panel says about the list beside the offered models: how many the
// catalog added since the table was last saved, and whether the chosen model
// is one the catalog no longer has.
function news(vscode, id, list, chosen) {
  if (id === "claude" || compatible.isLocal(id)) return { newCount: 0, missing: "" };
  const all = rows(list, read(vscode, id), id);
  return { newCount: all.filter(m => m.isNew).length,
           missing: chosen && all.some(m => m.missing && m.id === chosen) ? chosen : "" };
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
function apply(vscode, id, list, includeDecisions = false) {
  // A local server offers exactly the models loaded in it now; LLM Providers lists all downloaded ones.
  if (compatible.isLocal(id)) {
    const running = list.filter(m => m.loaded !== false).map(({ loaded, ...model }) => model);
    if (!running.length) throw new Error("No model is loaded in " + compatible.PROVIDERS[id].label + ". " + (id === "lmstudio-local"
      ? "Load one there (select a model at the top of LM Studio, or run `lms load <model>`)." : "Run one there (`ollama run <model>`)."));
    return running;
  }
  const offered = rows(list, read(vscode, id), id).filter(m => m.on && m.available !== false && !m.missing && (!m.modelKind || m.modelKind === "language" || includeDecisions && m.modelKind === "decision")).map(({ on, isNew, ...model }) => model);
  if (!offered.length) {
    if (id === "opencode-api" && list.some(m => m.modelKind === "decision")) throw new Error("No OpenCode chat model is enabled. Jev is tested in LLM Providers through the Decision API; enable a language model for chat.");
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
    PROVIDERS.map(p => ({ id: p.id, label: p.label, on: isOn(vscode, p.id), decisionOnly: !!p.decisionOnly })));
  const post = message => panel.webview.postMessage(message);

  const loadGeneration = new Map(), availableModels = new Map();
  const checksByScope = new Map();
  async function checkScope(id) {
    const keyed = id === "anthropic-api" || compatible.PROVIDERS[id];
    const key = keyed && secrets?.get ? (await keyProfiles.getActiveKey(secrets, id)).key : "";
    const scope = "vertex.modelChecks." + id + "." + require("crypto").createHash("sha256").update(key || id).digest("hex");
    if (!checksByScope.has(scope)) {
      let saved;
      try { saved = secrets?.get ? JSON.parse(await secrets.get(scope) || "{}") : {}; } catch (_) { saved = {}; }
      checksByScope.set(scope, saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {});
    }
    return { scope, checks: checksByScope.get(scope) };
  }
  async function checkedRows(id, models) {
    await adopt(vscode, id, models);
    const { checks } = await checkScope(id);
    return rows(models, read(vscode, id), id).map(row => {
      const saved = Object.hasOwn(checks, row.id) ? checks[row.id] : null;
      return saved && typeof saved.available === "boolean" ? { ...row, ...saved, checked: true,
        ...(saved.available ? {} : { on: false }), availabilitySource: "probe" } : row;
    });
  }
  async function checkModel(id, model) {
    const { scope, checks } = await checkScope(id);
    let error, result;
    try {
      await require("./model-detection").probe(vscode, secrets, id, model, extensionPath, executable);
      result = { available: true, reason: "", checkedAt: new Date().toISOString() };
    } catch (e) { error = e; result = { available: false, reason: String(e.message || e), checkedAt: new Date().toISOString() }; }
    Object.defineProperty(checks, model, { value: result, enumerable: true, configurable: true, writable: true });
    if (secrets?.store) await secrets.store(scope, JSON.stringify(checks));
    post({ checkedRow: { provider: id, model, ...result } });
    if (error) throw error;
  }

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
      await adopt(vscode, id, models);
      await migrateUnavailable(vscode, id, models);
      send({ provider: id, rows: await checkedRows(id, models), profiles, source, codemie });
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
    if (message.action === "copy-selection") {
      try { await vscode.env.clipboard.writeText(String(message.text || "")); }
      catch (error) { post({ error: "Could not copy text: " + error.message }); }
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
        await checkModel(provider.id, message.model);
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
          let models = await checkedRows(id, await full(id));
          if(["openrouter-api","opencode-api"].includes(id)&&message.filter==="free")models=models.filter(model=>model.free===true&&model.available!==false);
          if(["openrouter-api","opencode-api"].includes(id)&&message.filter==="available")models=models.filter(model=>model.available!==false);
          return typeof message.group === "string" ? models.filter(model => (model.modelProvider || (String(model.id).includes("/") ? String(model.id).split("/")[0] : "other")) === message.group) : models;
        }, (id, model) => checkModel(id, model),
        progress => post({ detectionProgress: progress }), () => cancelled);
        for (const checked of result.results) {
          if (!availableModels.has(checked.provider)) availableModels.set(checked.provider, new Set());
          for (const row of checked.rows || []) {
            if (row.available === true) availableModels.get(checked.provider).add(String(row.id));
            else if (row.checked) availableModels.get(checked.provider).delete(String(row.id));
          }
        }
        if (typeof message.group === "string") result.results.forEach(item => { item.group = message.group; });
        if(["openrouter-api","opencode-api"].includes(provider.id)&&["free","available"].includes(message.filter))result.results.forEach(item=>{item.filtered=true;});
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
        const { scope, checks } = await checkScope(id);
        const result = { available: true, reason: "", checkedAt: new Date().toISOString() };
        Object.defineProperty(checks, probed.id, { value: result, enumerable: true, configurable: true, writable: true });
        if (secrets?.store) await secrets.store(scope, JSON.stringify(checks));
        post({ provider: id, probed: { ...probed, ...result } });
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
      if (p.on && Array.isArray(p.rows) && !p.rows.some(r => r && r.on && !r.missing)) {
          fail(known.label + ": keep at least one model switched on."); return;
        }
      }
      for (const p of plan) {
        const list = Array.isArray(p.rows) ? p.rows : null;
        // A provider that could not be read keeps its model settings; only its switch is saved.
        await write(vscode, p.id, list ? {
          off: !p.on,
          enabled: list.filter(r => r && r.on).map(r => String(r.id)),
          known: list.filter(r => r && !r.missing).map(r => String(r.id)),
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
.model-table-scroll { max-height: 65vh; overflow: auto; }
.models-table thead th { position: sticky; top: 0; z-index: 2; background: var(--vscode-keybindingTable-headerBackground, var(--vscode-editor-background)); }
.group-sort-controls { display:inline-flex; align-items:center; gap:4px; margin-left:14px; font-weight:normal; }
.group-sort-controls select { padding:1px 6px; }
.model-sort { cursor: pointer; white-space: nowrap; }
.model-sort:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.models-table td.numeric { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.models-table td.cap-cell { text-align: center; }
td.id { font-family: var(--vscode-editor-font-family); }
.row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
.note { color: var(--vscode-descriptionForeground); }
#model-info-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
a.error-link, #error-dialog a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; }
#error-dialog, #model-info-dialog { color: var(--vscode-foreground); background: var(--vscode-editorWidget-background,var(--vscode-editor-background)); border: 1px solid var(--vscode-widget-border,var(--vscode-contrastBorder,var(--vscode-panel-border))); box-shadow: 0 4px 18px var(--vscode-widget-shadow,transparent); padding: 14px 18px; width: min(760px,80vw); max-height: 80vh; overflow: auto; }
#error-dialog::backdrop, #model-info-dialog::backdrop { background: var(--vscode-widget-shadow,transparent); }
#error-text { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; margin: 12px 0; }
.capability { display: inline-block; margin-left: 5px; font-weight: normal; }
.capability.missing { opacity: .45; }
.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
</style><style>${controls}</style></head><body>
<dialog id="model-info-dialog" aria-labelledby="model-info-title"><strong id="model-info-title">Model information</strong><div id="model-info-text"></div><p><button type="button" id="close-model-info">Close</button></p></dialog>
<dialog id="error-dialog" aria-labelledby="error-title"><strong id="error-title">Model check error</strong><div id="error-text"></div><div class="row"><button id="copy-dialog-error" type="button">Copy error</button><button id="close-error" type="button">Close</button><span id="error-copy-status" role="status"></span></div></dialog>
<div id="tree"></div>
<div class="row"><button class="primary" id="save">Save</button><button id="stop-detection" type="button" hidden>Stop</button><button id="choose-log-folder" type="button">Choose log folder...</button><button id="log-settings" type="button" title="Open logging settings" aria-label="Open logging settings">⚙</button><span id="said"></span></div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const INIT = ${init};
// Match the chat panel: copy through the extension host, since webview clipboard access varies by host.
function copySelectedText(event) {
  const field = document.activeElement;
  const text = field && typeof field.selectionStart === 'number' && field.selectionEnd > field.selectionStart
    ? String(field.value).slice(field.selectionStart, field.selectionEnd)
    : String(window.getSelection ? window.getSelection() || '' : '');
  if (!text) return;
  event.preventDefault(); event.stopPropagation();
  api.postMessage({ action: 'copy-selection', text });
}
document.addEventListener?.('copy', copySelectedText);
document.addEventListener?.('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'c') copySelectedText(event);
});
const capabilityDefinitions = ${JSON.stringify(require("./model-capabilities").definitions)};
const priceInfo = ${require("./model-capabilities").priceInfo.toString()};
const sortModels = ${require("./model-capabilities").sortModels.toString()};
const groupModels = ${require("./model-capabilities").groupModels.toString()};
const detailLines = ${require("./model-capabilities").detailLines.toString()};
let use = INIT.use;
let apiExpanded = use.endsWith("-api") && !["vercel-api", "openrouter-api", "opencode-api", "typesafe-api"].includes(use);
let scanning = false, scanningProvider = "";
const checkStatus = {}, checkErrors = {};
// Per provider: on, and its rows once read (null while loading or when it could not be read).
const state = {};
INIT.providers.forEach(p => { state[p.id] = { label: p.label, on: p.on, rows: null, profiles: null,
  source: null, hideUnavailable: true, filter: "available", grouped: false, collapsedGroups: new Set(), groupSorts: new Map(), expanded: p.id === INIT.use }; });
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
$("close-model-info").addEventListener("click",()=>$("model-info-dialog").close());
function showModelInfo(model){$("model-info-title").textContent=model.label||model.id;const text=$("model-info-text");text.replaceChildren();detailLines(model,capabilityDefinitions,priceInfo).forEach(value=>text.appendChild(el("p",{textContent:value})));$("model-info-dialog").showModal();}
function build() {
  const page = document.scrollingElement;
  const pageTop = page?.scrollTop || 0, pageLeft = page?.scrollLeft || 0;
  const positions = INIT.providers.map(p => { const node = $("models-scroll-" + p.id); return [p.id, node?.scrollTop || 0, node?.scrollLeft || 0]; });
  const tree = $("tree"); tree.innerHTML = "";
  let apiBody;
  INIT.providers.forEach(p => {
    const grouped = p.id.endsWith("-api") && !["vercel-api", "openrouter-api", "opencode-api", "typesafe-api"].includes(p.id);
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
      title: !s.on ? "Switch the provider on first" : p.decisionOnly ? "Use the Jev decision interface" : "Use this provider" });
    radio.addEventListener("change", () => { use = p.id; say(""); build(); });
    useLabel.appendChild(radio); useLabel.appendChild(document.createTextNode("In use"));
    head.appendChild(useLabel);
    const check = el("button", { className: "check-models", type: "button", textContent: scanningProvider === p.id ? "Checking…" : "Check models", disabled: scanning,
      title: "Test only this provider’s models with short requests; normal provider usage applies." });
    check.addEventListener("click", () => {
      scanning = true; scanningProvider = p.id; checkErrors[p.id] = ""; checkStatus[p.id] = "Reading model list…";
      api.postMessage({ action: "detect", provider: p.id, ...(["openrouter-api","opencode-api"].includes(p.id)?{filter:s.filter}:{}) });
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
  positions.forEach(([id, top, left]) => { const node = $("models-scroll-" + id); if (node) { node.scrollTop = top; node.scrollLeft = left; } });
  if (page) { page.scrollTop = pageTop; page.scrollLeft = pageLeft; }
}
function fill(id) {
  const s = state[id], body = $("body-" + id), oldScroll=$("models-scroll-"+id), scrollTop=oldScroll?.scrollTop||0, scrollLeft=oldScroll?.scrollLeft||0; body.innerHTML = "";
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
  const visibleRows = s.rows.filter(row=>["openrouter-api","opencode-api"].includes(id) ? s.filter==="all" || row.available!==false && (s.filter!=="free" || row.free===true) : !s.hideUnavailable || row.available!==false);
  const targets = ["openrouter-api","opencode-api"].includes(id) ? visibleRows : s.rows;
  const count = el("span", { className: "note", role: "status", ariaLive: "polite" });
  const bulk = el("button", { type: "button" });
  const allSelected = () => {
    const selectable = targets.filter(r => r.available !== false);
    return selectable.length ? selectable.every(r => r.on) : targets.some(r => r.on);
  };
  const updateBulk = () => {
    const all = allSelected();
    bulk.disabled = !targets.some(r => r.available !== false || r.on);
    count.textContent = "Models: " + s.rows.length + " · Shown: " + visibleRows.length + " · Selected: " + s.rows.filter(r => r.on).length;
    bulk.textContent = all ? "Clear all" : "Select all";
    bulk.title = all ? "Clear all models for this provider" : "Select all models for this provider";
  };
  bulk.addEventListener("click", () => {
    const next = !allSelected();
    targets.forEach(r => { r.on = next && r.available !== false; });
    table.querySelectorAll('tbody input[type="checkbox"]').forEach(box => { box.checked = next && !box.disabled; });
    updateBulk(); say("");
  });
  updateBulk();
  const toolbar = el("div", { className: "row" }); toolbar.appendChild(bulk);
  if(["openrouter-api","opencode-api"].includes(id)){
    const filters=el("span",{className:"vertex-segment-toggle"});filters.setAttribute("role","group");filters.setAttribute("aria-label",s.label+" model filter");
    [["all","All"],["available","Available"],["free","Free"]].forEach(([value,label])=>{
      const button=el("button",{type:"button",className:s.filter===value?"active":"",textContent:label,title:value==="free"?"Free models not marked unavailable":value==="available"?"Models not marked unavailable":"All models, including unavailable"});button.setAttribute("aria-pressed",String(s.filter===value));button.addEventListener("click",()=>{s.filter=value;fill(id);});filters.appendChild(button);
    });toolbar.appendChild(filters);
  }else{
  const hideLabel = el("label", { className: "row" });
  const hide = el("input", { type: "checkbox", checked: !!s.hideUnavailable, title: "Hide unavailable models" });
  hide.addEventListener("change", () => { s.hideUnavailable = hide.checked; fill(id); });
  hideLabel.appendChild(hide); hideLabel.appendChild(document.createTextNode("Hide unavailable"));
  toolbar.appendChild(hideLabel); } toolbar.appendChild(count);
  if(["vercel-api","openrouter-api","opencode-api"].includes(id)){
    const modes=el("span",{className:"vertex-segment-toggle"});modes.setAttribute("role","group");modes.setAttribute("aria-label",s.label+" model view");
    [[false,"All models"],[true,"By provider"]].forEach(([grouped,label])=>{
      const button=el("button",{type:"button",className:s.grouped===grouped?"active":"",textContent:label,title:grouped?"Group models by provider":"Show one sortable model list"});
      button.setAttribute("aria-pressed",String(s.grouped===grouped));button.addEventListener("click",()=>{s.grouped=grouped;fill(id);});modes.appendChild(button);
    });toolbar.appendChild(modes);
    if(s.grouped){
      [[true,"Collapse all"],[false,"Expand all"]].forEach(([collapsed,label])=>{
        const button=el("button",{type:"button",textContent:label,title:label+" provider groups"});
        button.addEventListener("click",()=>{
          if(collapsed)groupModels(s.rows,undefined,false,false).forEach(group=>s.collapsedGroups.add(group.id));
          else s.collapsedGroups.clear();
          fill(id);
        });toolbar.appendChild(button);
      });
    }
  }
  body.appendChild(toolbar);
  if(id==="typesafe-api")body.appendChild(el("div",{className:"note",textContent:"Direct TypeSafe API. Add your TypeSafe key, then use Check models for a small synthetic decision request. These models return probabilities and choices, not chat text. Normal TypeSafe usage charges apply."}));
  if(id==="opencode-api")body.appendChild(el("div",{className:"note",textContent:"Free models may require the OpenCode client; Check models verifies API access for this key. Jev (Decision API) is available here for checks; choose a language model for chat."}));
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
    if(id==="openrouter-api"){headerRow.appendChild(el("th",{textContent:column.label,title:column.title||column.label}));return;}
    const selected = s.sort?.key === column.key;
    const th = el("th"); th.setAttribute("aria-sort", selected ? s.sort.down ? "descending" : "ascending" : "none");
    const label = el("span", { className: "model-sort", tabIndex: 0, textContent: column.label + (selected ? s.sort.down ? " ▼" : " ▲" : ""), title: (column.title || column.label) + " — click to sort; click again to reverse" });
    label.setAttribute("role", "button"); label.setAttribute("aria-label", label.title);
    const sort = () => { s.sort = { key: column.key, down: selected ? !s.sort.down : false };s.groupSorts.clear();fill(id); };
    label.addEventListener("click", sort); label.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sort(); } });
    th.appendChild(label);headerRow.appendChild(th);
  });
  head.appendChild(headerRow);if(id!=="openrouter-api")table.appendChild(head);
  const groups=["vercel-api","openrouter-api","opencode-api"].includes(id)&&s.grouped?groupModels(visibleRows,s.sort?.key,s.sort?.down,false):[{id:"",models:sortModels(visibleRows,s.sort?.key,s.sort?.down)}];
  groups.forEach(group=>{
  const ownSort=s.groupSorts.get(group.id);if(ownSort)group.models=sortModels(group.models,ownSort.key,ownSort.down);
  const tbody=el("tbody"),modelRows=[];let fold;
  if(group.id){
    const tr=el("tr"),th=el("th",{colSpan:columns.length,scope:"rowgroup"});
    fold=el("button",{type:"button",className:"fold",title:"Expand or collapse "+group.label});
    const paint=()=>{const collapsed=s.collapsedGroups.has(group.id);fold.textContent=collapsed?"▸":"▾";fold.setAttribute("aria-expanded",String(!collapsed));modelRows.forEach(row=>{row.hidden=collapsed;});};
    fold.addEventListener("click",()=>{if(s.collapsedGroups.has(group.id))s.collapsedGroups.delete(group.id);else s.collapsedGroups.add(group.id);paint();});
    paint();th.appendChild(fold);th.appendChild(document.createTextNode(" "+group.label+" ("+group.models.length+")"));
    const checkGroup=el("button",{type:"button",className:"check-models",textContent:"Check models",disabled:scanning,title:"Check untested models in "+group.label});
    checkGroup.setAttribute("aria-label","Check models in "+group.label);
    checkGroup.addEventListener("click",()=>{scanning=true;scanningProvider=id;checkErrors[id]="";checkStatus[id]="Checking "+group.label+"…";build();$("save").disabled=true;api.postMessage({action:"detect",provider:id,group:group.id,...(["openrouter-api","opencode-api"].includes(id)?{filter:s.filter}:{})});});th.appendChild(checkGroup);
    if(["vercel-api","opencode-api"].includes(id)&&group.models.length>1){const controls=el("span",{className:"group-sort-controls"});controls.appendChild(document.createTextNode(" Sort "));
    const picker=el("select",{title:"Sort only "+group.label+"; Global order follows the table header"});picker.setAttribute("aria-label","Sort models in "+group.label);
    picker.appendChild(el("option",{value:"",textContent:"Global order"}));columns.forEach(column=>picker.appendChild(el("option",{value:column.key,textContent:column.title||column.label})));picker.value=ownSort?.key||"";
    picker.addEventListener("change",()=>{if(picker.value)s.groupSorts.set(group.id,{key:picker.value,down:ownSort?.down||false});else s.groupSorts.delete(group.id);fill(id);});controls.appendChild(picker);
    const direction=el("button",{type:"button",textContent:(ownSort?ownSort.down:s.sort?.down)?"↓":"↑",disabled:!ownSort,title:"Reverse sorting in "+group.label});direction.setAttribute("aria-label","Reverse sorting in "+group.label);direction.addEventListener("click",()=>{if(ownSort){s.groupSorts.set(group.id,{...ownSort,down:!ownSort.down});fill(id);}});controls.appendChild(direction);th.appendChild(controls);}tr.appendChild(th);tbody.appendChild(tr);
  }
  group.models.forEach(r => {
    const i = s.rows.indexOf(r);
    const tr = el("tr");
    const box = el("input", { type: "checkbox", checked: r.on, disabled: r.available === false, title: r.reason || "" });
    box.addEventListener("change", () => { r.on = box.checked; updateBulk(); say(""); });
    tr.appendChild(el("td")).appendChild(box);
    const nameCell=tr.appendChild(el("td"));
    if(id==="vercel-api"){const info=el("button",{type:"button",textContent:"ⓘ",title:"Model description from Vercel API",className:"model-info"});info.setAttribute("aria-label","Model information: "+(r.label||r.id));info.addEventListener("click",()=>showModelInfo(r));nameCell.appendChild(info);nameCell.appendChild(document.createTextNode(" "));}
    nameCell.appendChild(document.createTextNode(r.label||r.id));
    if(r.isNew)nameCell.appendChild(el("span",{className:"note",textContent:" · new",title:"Added to the provider's catalog since the table was last saved. Tick it to offer it."}));
    if(r.missing)nameCell.appendChild(el("span",{className:"note",textContent:" · not in catalog",title:"Ticked earlier, but the provider's catalog no longer lists it. It is not offered; untick it and save to drop it."}));
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
    const checkOne = el("button", { type: "button", textContent: "✓", disabled: scanning || !!r.missing,
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
    if (r.available === true && r.checked === true) act.appendChild(el("span", { className: "note", textContent: "Checked", title: r.checkedAt || "Model check completed" }));
    if (r.available !== false && r.checked !== true) act.appendChild(el("span", { className: "note", textContent: "Not checked" }));
    if (r.version) {
      const remove = el("button", { textContent: "Remove" });
      remove.addEventListener("click", () => { s.rows.splice(i, 1); fill(id); say("Removed - Save to keep it.", "note"); });
      act.appendChild(remove);
    }
    tr.hidden=!!group.id&&s.collapsedGroups.has(group.id);modelRows.push(tr);tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  });
  const scroll = el("div", { id:"models-scroll-"+id,className: "model-table-scroll" });scroll.appendChild(table);body.appendChild(scroll);scroll.scrollTop=scrollTop;scroll.scrollLeft=scrollLeft;
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
  if (m?.checkedRow) {
    const result = m.checkedRow, s = state[result.provider];
    const row = s?.rows?.find(row => String(row.id) === result.model);
    if (row) { Object.assign(row, { checked: true, available: result.available, reason: result.reason || "", on: result.available, availabilitySource: "probe" }); fill(result.provider); }
    return;
  }
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
      if (result.rows) { if(typeof result.group==="string"||result.filtered){const updated=new Map(result.rows.map(row=>[row.id,row]));s.rows=s.rows.map(row=>updated.get(row.id)||row);}else{s.rows=result.rows;if(!result.partial)s.on=result.rows.some(r=>r.on);} s.error=null; }
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
    s.rows.push({ id: m.probed.id, label: m.probed.label, version: true, on: true, checked: true, available: true, reason: "", checkedAt: m.probed.checkedAt, availabilitySource: "probe" }); fill(m.provider);
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

module.exports = { PROVIDERS, shortLabel, read, rows, apply, open, isOn, offered, chooseLogFolder, migrateUnavailable, adopt, news };
