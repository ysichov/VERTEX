"use strict";

// The sidebar is deliberately one free-prompt surface. Tools remain internal to
// the orchestrator; it decides which SAP operation is needed.
const ACTIONS = Object.freeze({
  selector: "vertex.open",
  metrics: "vertex.metrics",
  versions: "vertex.versions",
  review: "vertex.reviewCodeChanges",
  system: "vertex.switchSystem",
  settings: "workbench.action.openSettings"
});

function register(vscode, context, active, ask) {
  let currentView, pendingPrompt, ready = false;
  context.subscriptions.push(vscode.commands.registerCommand("vertex.askReviewBlock", async text => {
    pendingPrompt = text;
    await vscode.commands.executeCommand("vertex.launcher.focus");
    if (currentView && ready && pendingPrompt) { await currentView.webview.postMessage({ prompt: pendingPrompt }); pendingPrompt = undefined; }
  }));
  const provider = {
    resolveWebviewView(view) {
      currentView = view;
      ready = false;
      const nonce = require("crypto").randomBytes(24).toString("hex");
      view.webview.options = { enableScripts: true, localResourceRoots: [] };
      view.webview.html = html(nonce);
      const refresh = () => {
        const chosen = active();
        return view.webview.postMessage({ system: chosen.error ? "No system selected" : chosen.system.name, ai: ask.state() });
      };
      const messages = view.webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== "object") { return; }
        if (message.action === "ready") {
          ready = true;
          await refresh();
          if (pendingPrompt) { await view.webview.postMessage({ prompt: pendingPrompt }); pendingPrompt = undefined; }
          return;
        }
        if (message.action === "provider" || message.action === "model") {
          try { const state = await ask[message.action === "provider" ? "selectProvider" : "selectModel"](); await view.webview.postMessage({ ai: state }); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "chat") {
          await view.webview.postMessage({ chat: "You: " + message.text });
          try { await view.webview.postMessage({ chat: "VERTEX: " + await ask(message.text) }); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (!Object.hasOwn(ACTIONS, message.action)) { return; }
        try {
          await vscode.commands.executeCommand(ACTIONS[message.action],
            ...(message.action === "settings" ? ["vertex.systems"] : []));
        } catch (error) {
          vscode.window.showErrorMessage("VERTEX: " + error.message);
        }
      });
      const changes = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("vertex")) { void refresh(); }
      });
      view.onDidDispose(() => { currentView = undefined; ready = false; messages.dispose(); changes.dispose(); });
    }
  };
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("vertex.launcher", provider));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.showPanel", () =>
    vscode.commands.executeCommand("vertex.launcher.focus")));
}

function html(nonce) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body { padding: 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h2 { font-size: 12px; text-transform: uppercase; margin: 8px 0 12px; }
p { line-height: 1.5; color: var(--vscode-descriptionForeground); }
#system { overflow-wrap: anywhere; margin-bottom: 16px; }
#messages { min-height: 180px; white-space: pre-wrap; }
#messages p.you { color: var(--vscode-charts-blue); }
#messages p.vertex { color: var(--vscode-charts-green); }
textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font: inherit; }
button { margin: 8px 0; padding: 8px 12px; border: 0; border-radius: 2px; cursor: pointer; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { background: var(--vscode-button-hoverBackground); }
#chat button { width: 100%; }
.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
</style></head><body>
<h2>VERTEX chat</h2><p id="system" aria-live="polite">Loading system…</p>
<p><button class="secondary" data-action="provider" id="provider">AI provider</button> <button class="secondary" data-action="model" id="model">Default model</button></p>
<main id="messages" aria-live="polite"><p>Ask about SAP code, data or a transport.</p></main>
<form id="chat"><textarea id="prompt" rows="4" placeholder="Ask VERTEX…" aria-label="Message"></textarea><button type="submit">Send</button></form>
<h2>Quick launch</h2>
<button class="secondary" data-action="selector">SelecTor</button>
<button class="secondary" data-action="metrics">Metrics</button>
<button class="secondary" data-action="versions">Versions</button>
<button class="secondary" data-action="review">Review &amp; save current code</button>
<p><button class="secondary" data-action="system">Switch system</button> <button class="secondary" data-action="settings">Configure systems</button></p>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
document.querySelectorAll('button[data-action]').forEach(button => {
  button.addEventListener('click', () => api.postMessage({ action: button.dataset.action }));
});
document.getElementById('chat').addEventListener('submit', event => {
  event.preventDefault();
  const field = document.getElementById('prompt');
  const text = field.value.trim();
  if (!text) return;
  api.postMessage({ action: 'chat', text });
  field.value = '';
});
window.addEventListener('message', event => {
  if (event.data && typeof event.data.prompt === 'string') {
    document.getElementById('prompt').value = event.data.prompt;
    document.getElementById('prompt').focus();
  }
  if (event.data && typeof event.data.system === 'string') {
    document.getElementById('system').textContent = event.data.system;
  }
  if (event.data && event.data.ai) {
    document.getElementById('provider').textContent = event.data.ai.provider;
    document.getElementById('model').textContent = event.data.ai.model || 'Default model';
  }
  if (event.data && event.data.chat) {
    const item = document.createElement('p'); item.textContent = event.data.chat;
    item.className = event.data.chat.startsWith('You: ') ? 'you' : 'vertex';
    document.getElementById('messages').appendChild(item);
  }
});
api.postMessage({ action: 'ready' });
</script></body></html>`;
}

module.exports = { register };
