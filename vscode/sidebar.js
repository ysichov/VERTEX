"use strict";

// The sidebar is deliberately one free-prompt surface. Tools remain internal to
// the orchestrator; it decides which SAP operation is needed.
const ACTIONS = Object.freeze({
  tools: "vertex.tools",
  selector: "vertex.open",
  metrics: "vertex.metrics",
  versions: "vertex.versions",
  system: "vertex.switchSystem",
  settings: "workbench.action.openSettings"
});

function register(vscode, context, active, ask, systems, toolContext) {
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
        return view.webview.postMessage({
          system: chosen.error ? "" : chosen.system.name,
          systems: systems().map(item => item.name),
          ai: ask.state()
        }).then(async () => {
          // The model list comes after: it may have to ask the provider.
          try { await view.webview.postMessage({ models: await ask.listModels() }); }
          catch (error) { await view.webview.postMessage({ models: { error: error.message } }); }
        });
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
        if (message.action === "setProvider") {
          try { await view.webview.postMessage({ ai: await ask.setProvider(message.provider) }); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "setModel") {
          try { await ask.setModel(message.model); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "configModels") {
          try { ask.configModels(); }
          catch (e) { vscode.window.showErrorMessage(e.message); }
          return;
        }
        if (message.action === "newConversation") {
          // A new conversation writes to a new log file.
          require("./session-log").reset();
          ask.newConversation();
          await view.webview.postMessage({ cleared: true });
          return;
        }
        if (message.action === "chat") {
          await view.webview.postMessage({ chat: "You: " + message.text });
          try {
            const reply = await ask(message.text, {state: (await toolContext()) || {}});
            await view.webview.postMessage({ chat: "VERTEX: " + reply.answer, usage: usageLine(reply) });
            // The answer names a VERTEX function to run - a table's data, a
            // class's diff - and the panel has no view of its own for it, so
            // a Tools window opens on it, on the panel's system.
            if (reply.navigation) { await vscode.commands.executeCommand("vertex.tools", reply.navigation); }
          }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (!Object.hasOwn(ACTIONS, message.action)) { return; }
        try {
          await vscode.commands.executeCommand(ACTIONS[message.action],
            ...(message.action === "settings" ? ["vertex.systems"] :
              message.action === "system" ? [message.name] : []));
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

/* One line under an answer: the model and what it cost in tokens. */
function usageLine(reply) {
  const usage = reply.usage;
  if (reply.direct) { return "searched the system directly · no tokens"; }
  if (!usage) { return reply.model ? reply.model + " · token usage not reported" : ""; }
  const k = n => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n || 0);
  const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  return (reply.model ? reply.model + " · " : "") + k(input) + " in (" + k(usage.cache_read_input_tokens) + " from cache) · "
    + k(usage.output_tokens) + " out";
}

// The extension's own mark, inline: the view loads nothing from disk.
const LOGO = "data:image/png;base64,"
  + require("fs").readFileSync(require("path").join(__dirname, "images", "icon.png")).toString("base64");

function html(nonce) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
html, body { height: 100%; margin: 0; }
body { box-sizing: border-box; display: flex; flex-direction: column; padding: 16px 16px 8px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h2 { font-size: 12px; text-transform: uppercase; margin: 8px 0 12px; }
p { line-height: 1.5; color: var(--vscode-descriptionForeground); }
#system { overflow-wrap: anywhere; margin-bottom: 16px; }
#messages { flex: 1 1 auto; min-height: 80px; overflow-y: auto; white-space: pre-wrap; }
/* The question box and VERTEX Tools stay at the bottom; the answers scroll. */
.dock { flex: none; }
#messages p.usage { font-size: 11px; opacity: .7; margin: -0.6em 0 1em; }
#messages p.you { color: var(--vscode-charts-blue); }
#messages .vertex { color: var(--vscode-charts-green); white-space: normal; line-height: 1.5; margin: 1em 0; }
#messages .vertex p, #messages .vertex ul, #messages .vertex ol { margin: .4em 0; color: inherit; }
#messages .vertex ul, #messages .vertex ol { padding-left: 1.4em; }
#messages .vertex code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
#messages .vertex pre { white-space: pre; overflow-x: auto; background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 3px; }
#messages .vertex pre code { background: none; padding: 0; }
textarea, select { box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); font: inherit; }
textarea { width: 100%; resize: vertical; padding: 8px; }
button { margin: 8px 0; padding: 8px 12px; border: 0; border-radius: 2px; cursor: pointer; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { background: var(--vscode-button-hoverBackground); }
#chat button { width: 100%; }
.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.link { color: var(--vscode-textLink-foreground); text-decoration: none; }
.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
#llm-settings { margin-left: auto; }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.line button { margin: 4px 0; padding: 4px 10px; }
.line select { padding: 3px 4px; }
.chat-head { margin-bottom: 4px; }
#new-conversation { margin-left: auto; }
#tools { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; font-size: 1.7em; font-weight: 600; }
#tools img { width: 40px; height: 40px; }
</style></head><body>
<div class="line"><a href="#" class="link" id="system-settings" title="Configure SAP systems">SAP system</a>
<select id="system-select" aria-label="SAP system"><option>Loading…</option></select>
<a href="#" class="link" id="llm-settings" title="Providers and the models they offer">LLM Providers</a></div>
<main id="messages" aria-live="polite"><p>Ask about SAP code, data or a transport.</p></main>
<div class="dock">
<div class="line chat-head"><select id="provider-select" aria-label="AI provider" title="AI provider"></select><select id="model-select" aria-label="Model" title="Model"><option>Loading…</option></select><button class="secondary" data-action="newConversation" id="new-conversation">New conversation</button></div>
<form id="chat"><textarea id="prompt" rows="4" placeholder="Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)" aria-label="Message"></textarea></form>
<button class="secondary" data-action="tools" id="tools"><img src="${LOGO}" alt="">VERTEX Tools</button>
</div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
document.getElementById('system-settings').addEventListener('click', event => {
  event.preventDefault();
  api.postMessage({ action: 'settings' });
});
document.getElementById('llm-settings').addEventListener('click', event => {
  event.preventDefault();
  api.postMessage({ action: 'configModels' });
});
document.getElementById('provider-select').addEventListener('change', event => {
  api.postMessage({ action: 'setProvider', provider: event.target.value });
});
document.getElementById('model-select').addEventListener('change', event => {
  api.postMessage({ action: 'setModel', model: event.target.value });
});
document.querySelectorAll('button[data-action]').forEach(button => {
  button.addEventListener('click', () => api.postMessage({ action: button.dataset.action }));
});
document.getElementById('system-select').addEventListener('change', event => {
  api.postMessage({ action: 'system', name: event.target.value });
});
document.getElementById('chat').addEventListener('submit', event => {
  event.preventDefault();
  const field = document.getElementById('prompt');
  const text = field.value.trim();
  if (!text) return;
  api.postMessage({ action: 'chat', text });
  field.value = '';
});
document.getElementById('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.ctrlKey) {
    event.preventDefault();
    document.getElementById('chat').requestSubmit();
  }
});
window.addEventListener('message', event => {
  if (event.data && typeof event.data.prompt === 'string') {
    document.getElementById('prompt').value = event.data.prompt;
    document.getElementById('prompt').focus();
  }
  if (event.data && event.data.cleared) {
    const box = document.getElementById('messages');
    box.textContent = '';
    const hint = document.createElement('p');
    hint.textContent = 'Ask about SAP code, data or a transport.';
    box.appendChild(hint);
  }
  if (event.data && Array.isArray(event.data.systems)) {
    const select = document.getElementById('system-select');
    const selected = event.data.system || '';
    select.replaceChildren(...event.data.systems.map(name => {
      const option = new Option(name, name);
      option.selected = name === selected;
      return option;
    }));
    if (!event.data.systems.length) select.add(new Option('No SAP systems configured', ''));
  }
  if (event.data && event.data.ai) {
    const select = document.getElementById('provider-select');
    select.replaceChildren(...(event.data.ai.providers || []).map(p => new Option(p.short, p.setting)));
    select.value = event.data.ai.provider;
  }
  if (event.data && event.data.models) {
    const select = document.getElementById('model-select');
    const data = event.data.models;
    if (data.error) {
      select.replaceChildren(new Option('no models', ''));
      select.title = data.error;
    } else {
      select.title = 'Model';
      select.replaceChildren(...data.models.map(m => new Option(m.label, m.id)));
      // A chosen model no longer switched on is shown as it is, not swapped.
      if (data.model && !data.models.some(m => m.id === data.model)) { select.add(new Option(data.model + ' (off)', data.model)); }
      // No model chosen runs the first one switched on, so that is what shows.
      select.value = data.model || (data.models[0] ? data.models[0].id : '');
    }
  }
  if (event.data && event.data.chat) {
    const mine = event.data.chat.startsWith('You: ');
    const item = document.createElement(mine ? 'p' : 'div');
    item.className = mine ? 'you' : 'vertex';
    if (mine) { item.textContent = event.data.chat; } else { markdown(event.data.chat, item); }
    document.getElementById('messages').appendChild(item);
    if (event.data.usage) {
      const line = document.createElement('p');
      line.className = 'usage';
      line.textContent = event.data.usage;
      document.getElementById('messages').appendChild(line);
    }
    const box = document.getElementById('messages');
    box.scrollTop = box.scrollHeight;
  }
});
// Markdown built as DOM nodes with textContent only, so an answer cannot inject markup.
function inline(text, parent) {
  text.split(/(\\x60[^\\x60]+\\x60|\\*\\*[^*]+\\*\\*|\\*[^*\\s][^*]*\\*)/).forEach(token => {
    if (!token) return;
    let node;
    if (/^\\x60[^\\x60]+\\x60$/.test(token)) { node = document.createElement('code'); node.textContent = token.slice(1, -1); }
    else if (/^\\*\\*[^*]+\\*\\*$/.test(token)) { node = document.createElement('strong'); node.textContent = token.slice(2, -2); }
    else if (/^\\*[^*\\s][^*]*\\*$/.test(token)) { node = document.createElement('em'); node.textContent = token.slice(1, -1); }
    else { node = document.createTextNode(token); }
    parent.appendChild(node);
  });
}
function markdown(text, target) {
  const lines = text.replace(/\\r\\n/g, '\\n').split('\\n');
  let list = null, paragraph = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\\s*\\x60\\x60\\x60/.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^\\s*\\x60\\x60\\x60/.test(lines[i]); i++) { code.push(lines[i]); }
      const pre = document.createElement('pre'), inner = document.createElement('code');
      inner.textContent = code.join('\\n'); pre.appendChild(inner); target.appendChild(pre);
      list = paragraph = null; continue;
    }
    const bullet = /^\\s*[-*]\\s+(.*)$/.exec(line), numbered = /^\\s*\\d+[.)]\\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? 'UL' : 'OL';
      if (!list || list.tagName !== kind) { list = document.createElement(kind); target.appendChild(list); }
      const li = document.createElement('li'); inline((bullet || numbered)[1], li); list.appendChild(li);
      paragraph = null; continue;
    }
    list = null;
    if (!line.trim()) { paragraph = null; continue; }
    const heading = /^#{1,6}\\s+(.*)$/.exec(line);
    if (heading) {
      const p = document.createElement('p'), strong = document.createElement('strong');
      inline(heading[1], strong); p.appendChild(strong); target.appendChild(p); paragraph = null; continue;
    }
    if (paragraph) { paragraph.appendChild(document.createElement('br')); }
    else { paragraph = document.createElement('p'); target.appendChild(paragraph); }
    inline(line, paragraph);
  }
}
api.postMessage({ action: 'ready' });
</script></body></html>`;
}

module.exports = { register };
