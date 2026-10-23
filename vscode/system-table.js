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

function open(vscode, { test, login }) {
  const panel = vscode.window.createWebviewPanel("vertex.systemTable", "VERTEX: SAP Systems",
    vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
  const nonce = require("crypto").randomBytes(24).toString("hex");
  panel.webview.html = html(nonce);
  const draw = () => panel.webview.postMessage({ rows: rows(vscode) });
  const changes = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration("vertex.systems") || event.affectsConfiguration("vertex.active")) { draw(); }
  });
  panel.onDidDispose(() => changes.dispose());
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== "object") { return; }
    try {
      if (message.action === "ready") { draw(); return; }
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
        if (answer !== "Remove") { draw(); return; }
        await change(vscode, index, name, (all, i) => all.filter((_, at) => at !== i));
      } else if (message.action === "test" || message.action === "login") {
        const entry = (vscode.workspace.getConfiguration("vertex").get("systems") || [])[index];
        if (!entry || (entry.name || "(unnamed)") !== name) { throw new Error(name + " is no longer at this place in vertex.systems."); }
        // Log in: the password entered is kept, then tried at once.
        if (message.action === "login" && !(await login(entry))) { panel.webview.postMessage({ tested: index, text: "No password entered; the kept one is unchanged." }); return; }
        panel.webview.postMessage({ tested: index, text: "Testing..." });
        const text = await test(entry);
        panel.webview.postMessage({ tested: index, text, ok: /^OK - /.test(text) });
        return;
      }
      draw();
    } catch (error) {
      panel.webview.postMessage({ error: error.message });
      draw();
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
button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
       border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 8px; cursor: pointer; }
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
function draw(rows) {
  shown = rows;
  const body = document.getElementById("rows");
  if (!rows.length) { body.innerHTML = '<tr><td colspan="11" class="note">No system yet: Import fills the table from SAP Logon and Eclipse.</td></tr>'; return; }
  body.innerHTML = rows.map(r => '<tr class="' + (r.on ? '' : 'off') + '" data-index="' + r.index + '">'
    + '<td class="c"><input type="radio" name="active" data-act="active"' + (r.active ? ' checked' : '') + (r.on ? '' : ' disabled') + ' aria-label="Active system"></td>'
    + '<td>' + esc(r.name) + '</td><td class="url">' + esc(r.url) + '</td><td>' + esc(r.client) + '</td><td>' + esc(r.user) + '</td>'
    + '<td class="c"><input type="checkbox" data-act="snc"' + (r.snc ? ' checked' : '') + ' aria-label="SNC"></td>'
    + '<td class="c keep"><input type="checkbox" data-act="on"' + (r.on ? ' checked' : '') + ' aria-label="Switched on"></td>'
    + '<td><button type="button" data-act="login" title="Enter the SAP password for ' + esc(r.user) + '; it is kept in the OS credential store"' + (r.on && !r.snc ? '' : ' disabled') + '>Log in</button></td>'
    + '<td><button type="button" data-act="test"' + (r.on ? '' : ' disabled') + '>Test</button></td>'
    + '<td class="keep"><button type="button" data-act="delete">Delete</button></td>'
    + '<td class="result" id="result-' + r.index + '"></td></tr>').join("");
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
    const cell = document.getElementById("result-" + m.tested);
    if (cell) { cell.textContent = m.text; cell.className = "result " + (m.ok === true ? "ok" : m.ok === false ? "bad" : "note"); }
  }
});
api.postMessage({ action: "ready" });
</script></body></html>`;
}

module.exports = { open, rows };
