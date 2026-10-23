"use strict";

/* The SAP Systems table: vertex.systems as rows, each with its own SNC switch, on/off switch, test and delete, and
   the active one chosen in it. Import and settings.json stay a click away for what the table does not edit. Every
   change is written to the setting where the systems are kept; the table is drawn again from the setting. */

function target(vscode, config, key) {
  const scope = config.inspect && config.inspect(key);
  return scope && scope.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : scope && scope.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
}

function rows(vscode) {
  const config = vscode.workspace.getConfiguration("vertex");
  const active = (config.get("active") || "").trim();
  const all = config.get("systems") || [];
  const firstOn = all.find(s => s && s.name && s.disabled !== true);
  return all.map((s, index) => ({ index, name: s && s.name || "(unnamed)", url: s && (s.url || s.destination) || "",
    client: s && s.client || "", user: s && s.user || "", snc: !!(s && s.authType === "snc"), on: !(s && s.disabled === true),
    active: !!(s && s.name) && (active ? s.name === active : s === firstOn) }));
}

/* Changes one entry, found by its index and checked by its name, so a setting edited meanwhile is not overwritten. */
async function change(vscode, index, name, edit) {
  const config = vscode.workspace.getConfiguration("vertex");
  const all = (config.get("systems") || []).map(s => ({ ...s }));
  if (!all[index] || (all[index].name || "(unnamed)") !== name) { throw new Error(name + " is no longer at this place in vertex.systems; the table is drawn again."); }
  const next = edit(all, index);
  await config.update("systems", next, target(vscode, config, "systems"));
}

// The last test result of each system, by name, until the window is reloaded - also when the table is closed.
const lastResults = new Map();

function open(vscode, { test, login, hasPassword = async () => false }) {
  const panel = vscode.window.createWebviewPanel("vertex.systemTable", "VERTEX: SAP Systems",
    vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
  const nonce = require("crypto").randomBytes(24).toString("hex");
  panel.webview.html = html(nonce);
  // Each row says whether a password is kept for it; the kept password itself never reaches the page.
  const draw = async () => {
    const shown = rows(vscode), all = vscode.workspace.getConfiguration("vertex").get("systems") || [];
    for (const row of shown) {
      row.password = !row.snc && await hasPassword(all[row.index]).catch(() => false);
      row.result = lastResults.get(row.name) || null;
    }
    return panel.webview.postMessage({ rows: shown });
  };
  const changes = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration("vertex.systems") || event.affectsConfiguration("vertex.active")) { draw(); }
  });
  panel.onDidDispose(() => changes.dispose());
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== "object") { return; }
    try {
      if (message.action === "ready") { await draw(); return; }
      if (message.action === "import") { await vscode.commands.executeCommand("vertex.importSystems"); return; }
      if (message.action === "json") { await vscode.commands.executeCommand("workbench.action.openSettingsJson"); return; }
      const index = Number(message.index), name = String(message.name || "");
      if (message.action === "snc") {
        await require("./system-setup").setSystemAuthType(vscode, name, !!message.on);
      } else if (message.action === "on") {
        await change(vscode, index, name, (all, i) => {
          if (message.on) { delete all[i].disabled; } else { all[i].disabled = true; }
          return all;
        });
      } else if (message.action === "active") {
        const config = vscode.workspace.getConfiguration("vertex");
        await config.update("active", name, target(vscode, config, "active"));
      } else if (message.action === "delete") {
        const answer = await vscode.window.showWarningMessage("Remove " + name + " from vertex.systems?", { modal: true }, "Remove");
        if (answer !== "Remove") { await draw(); return; }
        await change(vscode, index, name, (all, i) => all.filter((_, at) => at !== i));
      } else if (message.action === "test" || message.action === "login") {
        const entry = (vscode.workspace.getConfiguration("vertex").get("systems") || [])[index];
        if (!entry || (entry.name || "(unnamed)") !== name) { throw new Error(name + " is no longer at this place in vertex.systems."); }
        // Log in: the password entered is kept, then tried at once.
        if (message.action === "login" && !(await login(entry))) { panel.webview.postMessage({ tested: index, text: "No password entered; the kept one is unchanged." }); return; }
        panel.webview.postMessage({ tested: index, text: "Testing..." });
        const text = await test(entry);
        lastResults.set(name, { text, ok: /^OK - /.test(text) });
        panel.webview.postMessage({ tested: index, text, ok: /^OK - /.test(text) });
        // A 401 drops the kept password, an entered one is kept: the button says which.
        await draw();
        return;
      }
      await draw();
    } catch (error) {
      panel.webview.postMessage({ error: error.message });
      await draw();
    }
  });
  return panel;
}

function html(nonce) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font: var(--vscode-font-size) var(--vscode-font-family); color: var(--vscode-foreground);
       background: var(--vscode-editor-background); padding: 10px 14px; }
/* VERTEX's rounded buttons; the theme's focus colour glows under the one the pointer is on. */
button { --accent: var(--vscode-focusBorder); font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
       border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 6px; padding: 3px 10px; cursor: pointer;
       white-space: nowrap; transition: box-shadow .12s, border-color .12s; }
button:hover:not(:disabled) { border-color: var(--accent); box-shadow: 0 0 6px -1px var(--accent); }
button:disabled { opacity: .5; cursor: default; }
input[type=checkbox], input[type=radio] { accent-color: var(--vscode-focusBorder); }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: var(--vscode-keybindingTable-headerBackground, transparent); }
td.c { text-align: center; }
td.url { font-family: var(--vscode-editor-font-family); }
tr.off td:not(.keep) { opacity: .55; }
.row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
.note { color: var(--vscode-descriptionForeground); }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
.ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
.bad { color: var(--vscode-errorForeground); }
.result { max-width: 420px; }
</style></head><body>
<div class="row"><button id="import" type="button">Import from SAP Logon and Eclipse</button><button id="json" type="button">Edit in settings.json</button></div>
<p class="note">A system switched off stays in vertex.systems but is left out of every list, switch and test. SNC needs snc and rfc in the entry - Import fills them from SAP Logon.</p>
<div id="said" class="error"></div>
<table><thead><tr><th>Active</th><th>System</th><th>Address</th><th>Client</th><th>User</th><th>SNC</th><th>On</th><th></th><th></th><th></th><th>Test result</th></tr></thead>
<tbody id="rows"><tr><td colspan="11" class="note">Loading...</td></tr></tbody></table>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let shown = [];
// A row's last test result, kept while the table is drawn again; keyed by name, as rows can move.
const results = {};
const showResult = (name, index) => { const cell = document.getElementById("result-" + index), r = results[name];
  if (cell && r) { cell.textContent = r.text; cell.className = "result " + (r.ok === true ? "ok" : r.ok === false ? "bad" : "note"); } };
function draw(rows) {
  shown = rows;
  const body = document.getElementById("rows");
  if (!rows.length) { body.innerHTML = '<tr><td colspan="11" class="note">No system yet: Import fills the table from SAP Logon and Eclipse.</td></tr>'; return; }
  body.innerHTML = rows.map(r => '<tr class="' + (r.on ? '' : 'off') + '" data-index="' + r.index + '">'
    + '<td class="c"><input type="radio" name="active" data-act="active"' + (r.active ? ' checked' : '') + (r.on ? '' : ' disabled') + ' aria-label="Active system"></td>'
    + '<td>' + esc(r.name) + '</td><td class="url">' + esc(r.url) + '</td><td>' + esc(r.client) + '</td><td>' + esc(r.user) + '</td>'
    + '<td class="c"><input type="checkbox" data-act="snc"' + (r.snc ? ' checked' : '') + ' aria-label="SNC"></td>'
    + '<td class="c keep"><input type="checkbox" data-act="on"' + (r.on ? ' checked' : '') + ' aria-label="Switched on"></td>'
    + '<td><button type="button" data-act="login" title="' + (r.password ? 'A password is kept for ' + esc(r.user) + '; enter a new one' : 'Enter the SAP password for ' + esc(r.user)) + ' - it is kept in the OS credential store"' + (r.on && !r.snc ? '' : ' disabled') + '>' + (r.snc ? 'SNC' : r.password ? 'Save new password' : 'Log in') + '</button></td>'
    + '<td><button type="button" data-act="test"' + (r.on ? '' : ' disabled') + '>Test</button></td>'
    + '<td class="keep"><button type="button" data-act="delete">Delete</button></td>'
    + '<td class="result" id="result-' + r.index + '"></td></tr>').join("");
  rows.forEach(r => { if (r.result && !results[r.name]) { results[r.name] = r.result; } showResult(r.name, r.index); });
}
document.getElementById("rows").addEventListener("click", event => {
  const control = event.target.closest("[data-act]");
  if (!control) { return; }
  const row = shown.find(r => String(r.index) === control.closest("tr").dataset.index);
  if (!row) { return; }
  document.getElementById("said").textContent = "";
  const act = control.dataset.act;
  if (act === "snc" || act === "on") { control.disabled = true; }
  api.postMessage({ action: act, index: row.index, name: row.name, on: control.checked });
});
document.getElementById("import").addEventListener("click", () => api.postMessage({ action: "import" }));
document.getElementById("json").addEventListener("click", () => api.postMessage({ action: "json" }));
window.addEventListener("message", event => {
  const m = event.data || {};
  if (m.rows) { draw(m.rows); }
  if (m.error) { document.getElementById("said").textContent = m.error; }
  if (m.tested !== undefined) {
    const row = shown.find(r => r.index === m.tested);
    if (row) { results[row.name] = { text: m.text, ok: m.ok }; showResult(row.name, row.index); }
  }
});
api.postMessage({ action: "ready" });
</script></body></html>`;
}

module.exports = { open, rows };
