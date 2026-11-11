"use strict";
/* VERTEX: MCP Servers - every server of vertex.chat.mcpServers with its description, the version and tool list
   kept from its last start, its toolsets, and Update when npm has a newer version of its package. Nothing is
   installed or started unless the user presses Update or Read tools. */

function open(vscode, chatMcp) {
  const panel = vscode.window.createWebviewPanel("vertex.mcpServers", "VERTEX: MCP Servers", vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
  const nonce = require("crypto").randomBytes(24).toString("hex");
  panel.webview.html = html(nonce);
  // A start in progress and its error belong to the server, not to one drawing: every redraw carries them.
  const starting = new Set(), errors = new Map();
  const show = (extra = {}) => panel.webview.postMessage({ servers: chatMcp.overview(), selected: chatMcp.selected(),
    starting: [...starting], errors: Object.fromEntries(errors), ...extra });
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== "object") return;
    // What is kept shows at once; npm is asked again each time the window opens, as Check for updates does.
    if (message.action === "ready") {
      await show({ checking: true });
      await chatMcp.checkUpdates();
      await show();
      return;
    }
    const name = String(message.name || "");
    if (message.action === "update" || message.action === "refresh") {
      if (starting.has(name)) return;
      starting.add(name); errors.delete(name);
      await show();
      try { await chatMcp[message.action](name); starting.delete(name); await show({ done: name }); }
      catch (error) { starting.delete(name); errors.set(name, error.message); await show(); }
      return;
    }
    if (message.action === "check") {
      await chatMcp.checkUpdates();
      await show();
    }
  });
  return panel;
}

function html(nonce) {
  const fs = require("fs"), path = require("path");
  const controls = require("./vertex-logo").fill(fs.readFileSync(path.join(__dirname, "resources", "vertex-controls.css"), "utf8"));
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font: var(--vscode-font-size) var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 10px 14px; }
${controls}
.server { border: 1px solid var(--vscode-panel-border); margin: 0 0 10px; padding: 8px 10px; background: var(--vscode-sideBar-background, transparent); }
.server h2 { font-size: 1.1em; margin: 0 6px 0 0; display: inline; }
.head { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.note { color: var(--vscode-descriptionForeground); }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; }
.update { color: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); }
p.desc { margin: 6px 0; }
table { border-collapse: collapse; width: 100%; margin-top: 6px; }
th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
th { font-weight: 600; }
td.name { font-family: var(--vscode-editor-font-family); white-space: nowrap; }
details > summary { cursor: pointer; margin-top: 6px; }
.wrap { overflow-x: auto; }
</style></head><body>
<div class="head"><strong>MCP servers of the VERTEX chat</strong><button type="button" id="check">Check for updates</button><span id="status" class="note" role="status"></span></div>
<p class="note">Tool lists and versions are those kept from each server's last start in VERTEX. Servers are configured in vertex.chat.mcpServers, toolsets in vertex.chat.toolsets.</p>
<div id="list"></div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
const el = (tag, props, children) => { const n = Object.assign(document.createElement(tag), props || {}); (children || []).forEach(c => n.append(c)); return n; };
function draw(data) {
  const list = document.getElementById("list"); list.replaceChildren();
  if (!data.servers.length) { list.append(el("p", { className: "note", textContent: "No MCP server is configured in vertex.chat.mcpServers." })); return; }
  for (const s of data.servers) {
    const box = el("section", { className: "server" });
    const head = el("div", { className: "head" }, [el("h2", { textContent: s.name })]);
    head.append(el("span", { className: "note", textContent: s.version ? "version " + s.version : "not started in VERTEX yet" }));
    if (s.packages.length) head.append(el("span", { className: "note", textContent: s.packages.map(p => p.name + "@" + p.version).join(", ") }));
    if (data.selected === s.name) head.append(el("span", { className: "note", textContent: "chosen in the VERTEX panel" }));
    if (Array.isArray(s.update) && s.update.length) {
      head.append(el("span", { className: "update", textContent: s.update.map(u => u.name + " " + u.latest + " is out (installed " + u.installed + ")").join("; ") }));
      const b = el("button", { type: "button", textContent: "Update", disabled: data.starting.includes(s.name), title: "Use the newer version and read its tool list" });
      b.addEventListener("click", () => api.postMessage({ action: "update", name: s.name }));
      head.append(b);
    } else if (s.update && s.update.error) head.append(el("span", { className: "error", textContent: s.update.error }));
    const read = el("button", { type: "button", textContent: s.tools ? "Read tools again" : "Read tools", disabled: data.starting.includes(s.name), title: "Start the server once and keep its version and tool list" });
    read.addEventListener("click", () => api.postMessage({ action: "refresh", name: s.name }));
    head.append(read);
    if (data.starting.includes(s.name)) head.append(el("span", { className: "note", textContent: "Starting… (up to two minutes)" }));
    box.append(head);
    if (data.errors[s.name]) box.append(el("p", { className: "error", textContent: data.errors[s.name] }));
    box.append(el("p", { className: "desc" + (s.description ? "" : " note"), textContent: s.description || "No description configured." }));
    if (s.toolsets.length) {
      const sets = el("table");
      sets.append(el("tr", {}, [el("th", { textContent: "Toolset" }), el("th", { textContent: "Description" }), el("th", { textContent: "Tools" })]));
      for (const t of s.toolsets) sets.append(el("tr", {}, [el("td", { textContent: t.name + (t.always ? " (offered with every server)" : "") }), el("td", { textContent: t.description }), el("td", { textContent: s.tools ? String(t.tools.length) : "—" })]));
      box.append(el("div", { className: "wrap" }, [sets]));
    }
    if (s.tools) {
      const details = el("details", {}, [el("summary", { textContent: s.tools.length + (s.tools.length === 1 ? " tool" : " tools") + (s.outside ? " · " + s.outside + " in no toolset" : "") })]);
      const table = el("table");
      table.append(el("tr", {}, [el("th", { textContent: "Tool" }), el("th", { textContent: "Toolset" }), el("th", { textContent: "Changes SAP" }), el("th", { textContent: "Description" })]));
      for (const t of s.tools) table.append(el("tr", {}, [el("td", { className: "name", textContent: t.name }), el("td", { className: t.toolsets.length ? "" : "note", textContent: t.toolsets.join(", ") || "none" }),
        el("td", { textContent: t.readOnly ? "no" : "may" }), el("td", { textContent: t.description })]));
      details.append(el("div", { className: "wrap" }, [table]));
      box.append(details);
    }
    list.append(box);
  }
}
let last = null;
window.addEventListener("message", event => {
  const m = event.data || {};
  if (m.servers) { last = m; draw(m); document.getElementById("status").textContent = m.checking ? "Checking npm…" : m.done ? m.done + ": tool list kept." : ""; document.getElementById("check").disabled = !!m.checking; }
});
document.getElementById("check").addEventListener("click", () => { document.getElementById("check").disabled = true; document.getElementById("status").textContent = "Checking npm…"; api.postMessage({ action: "check" }); });
api.postMessage({ action: "ready" });
</script></body></html>`;
}

module.exports = { open };
