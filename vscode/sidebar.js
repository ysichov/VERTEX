"use strict";

// The sidebar is deliberately one free-prompt surface. Tools remain internal to
// the orchestrator; it decides which SAP operation is needed.
const ACTIONS = Object.freeze({
  tools: "vertex.tools",
  selector: "vertex.open",
  metrics: "vertex.metrics",
  versions: "vertex.versions",
  logs: "vertex.showLogs",
  executionLogs: "vertex.openSapDebugRuns",
  system: "vertex.switchSystem"
});

function register(vscode, context, active, ask, systems, toolContext) {
  let currentView, ready = false, nextRequest = 0;
  // ASK AI of a review: the blocks on the chip above the input, attached to the next question only when it is sent.
  let reviewAsk = null;
  const review = require("./code-review");
  const showReview = () => currentView && ready ? currentView.webview.postMessage({ review: reviewAsk ? review.askLabel(reviewAsk) : "", draft: reviewAsk && reviewAsk.question || "" }) : undefined;
  // Beside the gear in the panel's title: LLM providers (the SAP Systems table is extension.js's).
  context.subscriptions.push(vscode.commands.registerCommand("vertex.openModelSettings", () => ask.configModels()));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.askReviewBlock", async blocks => {
    reviewAsk = review.mergeAsk(reviewAsk, blocks);
    await vscode.commands.executeCommand("vertex.launcher.focus");
    await showReview();
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
          // What the list shows: a system reached through SAP's extension says so beside its name.
          labels: systems().map(item => item.name),
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
          await showReview();
          return;
        }
        if (message.action === "clearReview") {
          reviewAsk = null;
          await showReview();
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
        if (message.action === "newConversation") {
          // A new conversation writes to a new log file.
          require("./session-log").reset();
          await vscode.commands.executeCommand("vertex.resetTranspilerRunNumbers");
          ask.newConversation();
          reviewAsk = null;
          await view.webview.postMessage({ cleared: true });
          await showReview();
          return;
        }
        if (message.action === "copyAnswer") {
          // The host's clipboard: a webview's own clipboard access depends on permissions VS Code may not give it.
          try { await vscode.env.clipboard.writeText(String(message.text || "")); await view.webview.postMessage({ copied: true }); }
          catch (error) { await view.webview.postMessage({ copied: false, error: error.message }); }
          return;
        }
        if (message.action === "openRun") {
          await vscode.commands.executeCommand("vertex.openTranspilerRun", { run_id: String(message.run_id), step: Number(message.step) });
          return;
        }
        if (message.action === "openSession") {
          await vscode.commands.executeCommand("vertex.openDebugSession", { session_id: String(message.session_id), step: Number(message.step) });
          return;
        }
        if (message.action === "openObject") {
          try { await ask.openObject({ object_type: String(message.object_type), object_name: String(message.object_name) }); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "chat") {
          const requestId = ++nextRequest;
          // The window shows the question as written; the review's blocks go to the model with it, unseen.
          const asked = reviewAsk;
          if (asked) { reviewAsk = null; await showReview(); }
          const shown = String(message.text || "").trim() || (asked ? "What does this change do, and is there a real problem with it?" : "");
          if (!shown) { return; }
          await view.webview.postMessage({ chat: "You: " + shown + (asked ? "  [" + review.askLabel(asked) + "]" : "") });
          await view.webview.postMessage({ progress: { id: requestId, status: "VERTEX is working…" } });
          try {
            const scope = asked ? { review_ask: { object: asked.object, all: asked.all, blocks: asked.blocks.map(block => block.block) } } : undefined;
            const state = (await toolContext(scope)) || {};
            if (asked) {
              state.review_ask = { object: asked.object, all: asked.all, blocks: asked.blocks.map(block => block.block) };
              delete state.review_source;
              delete state.selected_fragment;
            }
            const reply = await ask(asked ? review.askRequest(message.text, asked) : message.text, {model: message.model, state,
              onProgress: update => { Promise.resolve(view.webview.postMessage({ progress: { id: requestId, ...update } })).catch(() => {}); } });
            if (reply.superseded) { await view.webview.postMessage({ progress: { id: requestId, remove: true } }); return; }
            await view.webview.postMessage({ progress: { id: requestId, answer: reply.answer,
              done: true, usage: usageLine(reply), choices: reply.choices || [],
              runs: (await vscode.commands.executeCommand("vertex.knownEvidenceSessions")) || [] } });
            // The answer names a VERTEX function to run - a table's data, a
            // class's diff - and the panel has no view of its own for it, so
            // a Tools window opens on it, on the panel's system.
            if (reply.navigation) { await vscode.commands.executeCommand("vertex.tools", reply.navigation); }
          }
          catch (error) { await view.webview.postMessage({ progress: { id: requestId,
            answer: "Request failed: " + error.message, done: true } }); }
          return;
        }
        if (!Object.hasOwn(ACTIONS, message.action)) { return; }
        try {
          await vscode.commands.executeCommand(ACTIONS[message.action],
            ...(message.action === "system" ? [message.name] : []));
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
/* The attached review context: a quiet tag above the input, its name cut with an ellipsis, × to drop it. */
#review-chip { display: flex; align-items: center; gap: 6px; box-sizing: border-box; max-width: 100%; width: fit-content; margin-bottom: 6px;
  padding: 2px 2px 2px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent)); border-left: 3px solid var(--vscode-focusBorder);
  border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-input-background)); color: var(--vscode-foreground); font-size: 12px; }
#review-chip[hidden] { display: none; }
#review-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#chat #review-chip button { flex: none; width: auto; margin: 0; padding: 0 6px; line-height: 18px; border-radius: 3px; background: transparent; color: var(--vscode-foreground); opacity: .7; }
#chat #review-chip button:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); box-shadow: none; }
#messages .copy-answer { margin: -0.6em 0 1em; padding: 2px 8px; font-size: 11px; }
#messages p.usage { font-size: 11px; opacity: .7; margin: -0.6em 0 1em; }
#messages p.tool-status { font-size: 11px; opacity: .8; }
#messages p.you { color: var(--vscode-charts-blue); }
#messages .vertex { color: var(--vscode-charts-green); white-space: normal; line-height: 1.5; margin: 1em 0; }
#messages .streaming-answer { white-space: pre-wrap; overflow-wrap: anywhere; }
#messages .vertex p, #messages .vertex ul, #messages .vertex ol { margin: .4em 0; color: inherit; }
#messages .vertex ul, #messages .vertex ol { padding-left: 1.4em; }
#messages .vertex code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
#messages .vertex pre { white-space: pre; overflow-x: auto; background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 3px; }
#messages .vertex pre code { background: none; padding: 0; }
#messages .reasoning { margin: 0.5em 0; }
#messages .reasoning summary { cursor: pointer; opacity: .8; }
#messages .reasoning pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 20em; overflow-y: auto; }
textarea, select { box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; font: inherit; }
textarea { width: 100%; resize: vertical; padding: 8px; }
#prompt { min-height: 5.5em; max-height: 14em; overflow-y: auto; padding-right: 30px; }
#prompt.expanded { min-height: 60vh; max-height: 70vh; }
.prompt-box { position: relative; }
#chat #expand-prompt { position: absolute; top: 4px; right: 4px; width: auto; margin: 0; padding: 0 6px; font-size: 14px; line-height: 20px; opacity: .75; }
#chat #expand-prompt:hover { opacity: 1; }
button { margin: 8px 0; padding: 8px 12px; border: 0; border-radius: 4px; cursor: pointer; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { background: var(--vscode-button-hoverBackground); }
#chat button { width: 100%; }
.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.link { color: var(--vscode-textLink-foreground); text-decoration: none; }
.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
#logs { margin: 0 0 0 auto; padding: 3px 6px; font-size: 17px; line-height: 1; background: transparent; color: var(--vscode-foreground); }
#logs:hover { background: var(--vscode-list-hoverBackground); }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.line button { margin: 4px 0; padding: 4px 10px; }
.line select { padding: 3px 4px; }
.chat-head { margin-bottom: 4px; }
#new-conversation { margin-left: auto; }
#tools { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border-radius: 6px; font-size: 1.7em; font-weight: 600; }
#tools img { width: 40px; height: 40px; }
</style></head><body>
<div class="line"><span>SAP system</span>
<select id="system-select" aria-label="SAP system"><option>Loading…</option></select>
<button type="button" data-action="logs" id="logs" title="AI conversation logs" aria-label="Open AI conversation logs">📜 AI</button>
<button type="button" data-action="executionLogs" id="execution-logs" title="SAP debug and transpiler recordings" aria-label="Open SAP debug and transpiler logs">📜 SAP</button></div>
<main id="messages" aria-live="polite"><p>Ask about SAP code, data or a transport.</p></main>
<div class="dock">
<div class="line chat-head"><select id="provider-select" aria-label="AI provider" title="AI provider"></select><select id="model-select" aria-label="Model" title="Model"><option>Loading…</option></select><button class="secondary" data-action="newConversation" id="new-conversation">New conversation</button></div><div class="note" id="model-status" role="status" aria-live="polite"></div>
<form id="chat"><div id="review-chip" hidden><span id="review-label"></span><button type="button" id="review-clear" class="secondary" title="Ask without the review's blocks" aria-label="Remove the review context">×</button></div><div class="prompt-box"><button type="button" id="expand-prompt" class="secondary" title="Expand the message field" aria-label="Expand the message field" aria-pressed="false">⤢</button><textarea id="prompt" rows="4" placeholder="Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)" aria-label="Message"></textarea></div></form>
<button class="secondary" data-action="tools" id="tools"><img src="${LOGO}" alt="">VERTEX Tools</button>
</div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
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
  // With a review's blocks on the chip an empty question asks the default one.
  if (!text && document.getElementById('review-chip').hidden) return;
  api.postMessage({ action: 'chat', text, model: document.getElementById('model-select').value });
  field.value = '';
  fitPrompt();
});
// The message field grows with what is typed or pasted, up to a few lines; ⤢ lets it take most of the panel.
const promptField = document.getElementById('prompt'), expandPrompt = document.getElementById('expand-prompt');
function fitPrompt() { promptField.style.height = 'auto'; promptField.style.height = promptField.scrollHeight + 2 + 'px'; }
promptField.addEventListener('input', fitPrompt);
expandPrompt.addEventListener('click', () => {
  const open = promptField.classList.toggle('expanded');
  expandPrompt.setAttribute('aria-pressed', String(open));
  expandPrompt.textContent = open ? '⤡' : '⤢';
  expandPrompt.title = expandPrompt.ariaLabel = open ? 'Shrink the message field' : 'Expand the message field';
  fitPrompt(); promptField.focus();
});
document.getElementById('review-clear').addEventListener('click', () => api.postMessage({ action: 'clearReview' }));
document.getElementById('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.ctrlKey) {
    event.preventDefault();
    document.getElementById('chat').requestSubmit();
  }
});
let lastCopy = null;
function copySelectedText(event) {
  const field = document.activeElement;
  const text = field && typeof field.selectionStart === 'number' && field.selectionEnd > field.selectionStart
    ? String(field.value).slice(field.selectionStart, field.selectionEnd)
    : String(window.getSelection ? window.getSelection() || '' : '');
  if (!text) return;
  event.preventDefault(); event.stopPropagation();
  lastCopy = null;
  api.postMessage({ action: 'copyAnswer', text });
}
document.addEventListener('copy', copySelectedText);
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'c') copySelectedText(event);
});
const progressItems = new Map();
window.addEventListener('message', event => {
  if (event.data && event.data.draft && !document.getElementById('prompt').value) { document.getElementById('prompt').value = event.data.draft; fitPrompt(); }
  if (event.data && typeof event.data.copied === 'boolean' && lastCopy) {
    lastCopy.textContent = event.data.copied ? 'Copied' : 'Copy failed: ' + event.data.error;
    const button = lastCopy; setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  }
  if (event.data && typeof event.data.review === 'string') {
    const chip = document.getElementById('review-chip');
    chip.hidden = !event.data.review;
    document.getElementById('review-label').textContent = event.data.review;
    chip.title = event.data.review;
    const field = document.getElementById('prompt');
    field.placeholder = event.data.review ? 'Ask about this change… (Enter with nothing typed: what it does and any real problem)' : 'Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)';
    if (event.data.review) field.focus();
  }
  if (event.data && event.data.cleared) {
    const box = document.getElementById('messages');
    box.textContent = '';
    const hint = document.createElement('p');
    hint.textContent = 'Ask about SAP code, data or a transport.';
    box.appendChild(hint);
    progressItems.clear();
  }
  if (event.data && event.data.progress) {
    const update = event.data.progress;
    let item = progressItems.get(update.id);
    if (!item && !update.remove) {
      item = document.createElement('div'); item.className = 'vertex';
      document.getElementById('messages').appendChild(item);
      progressItems.set(update.id, item);
    }
    if (item && update.remove) { item.remove(); progressItems.delete(update.id); }
    else if (item) {
      let body = item.querySelector('.progress-body');
      if (!body) { body = document.createElement('div'); body.className = 'progress-body streaming-answer'; item.appendChild(body); }
      const previous = item.dataset.answer || '';
      if (typeof update.answer === 'string' && (update.answer || !previous)) {
        const answer = update.answer;
        if (answer.startsWith(previous) && previous) body.textContent += answer.slice(previous.length);
        else body.textContent = 'VERTEX:\\n' + answer;
        item.dataset.answer = answer;
        item.dataset.status = '';
      }
      if (typeof update.status === 'string') item.dataset.status = update.status;
      if (!item.dataset.answer) body.textContent = 'VERTEX:\\n' + (item.dataset.status || 'VERTEX is working…');
      let status = item.querySelector('.tool-status');
      if (item.dataset.answer && item.dataset.status && !update.done) {
        if (!status) { status = document.createElement('p'); status.className = 'tool-status'; item.appendChild(status); }
        status.textContent = item.dataset.status;
      } else if (status) status.remove();
      if (typeof update.thinking === 'string' && update.thinking) {
        let details = item.querySelector('.reasoning');
        if (!details) {
          details = document.createElement('details'); details.className = 'reasoning';
          const summary = document.createElement('summary'); summary.textContent = 'Claude reasoning';
          const pre = document.createElement('pre'); details.append(summary, pre); item.appendChild(details);
        }
        details.querySelector('pre').textContent = update.thinking;
      }
      if (update.done) {
        const answer = item.dataset.answer || '';
        body.classList.remove('streaming-answer'); body.replaceChildren();
        markdown('VERTEX:\\n' + (answer || 'No answer returned.'), body);
        if (status) status.remove();
        links(item, update.choices || []);
        runLinks(item, update.runs || []);
        const copy = document.createElement('button');
        copy.className = 'secondary copy-answer'; copy.textContent = 'Copy'; copy.title = 'Copy this answer to the clipboard';
        copy.addEventListener('click', () => { lastCopy = copy; api.postMessage({ action: 'copyAnswer', text: answer }); });
        item.appendChild(copy);
        if (update.usage) {
          const line = document.createElement('p'); line.className = 'usage'; line.textContent = update.usage;
          item.appendChild(line);
        }
        progressItems.delete(update.id);
      }
      const box = document.getElementById('messages'); box.scrollTop = box.scrollHeight;
    }
  }
  if (event.data && Array.isArray(event.data.systems)) {
    const select = document.getElementById('system-select');
    const selected = event.data.system || '';
    select.replaceChildren(...event.data.systems.map((name, i) => {
      const option = new Option((event.data.labels || [])[i] || name, name);
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
      const status = document.getElementById('model-status');
      if (status) status.textContent = data.error;
    } else {
      select.title = 'Model';
      const status = document.getElementById('model-status');
      if (status) status.textContent = '';
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
    // Each found object is a link: a click opens it, as a single match is opened.
    if (!mine) { links(item, event.data.choices || []); }
    let copy = null;
    if (!mine) {
      copy = document.createElement('button');
      copy.className = 'secondary copy-answer'; copy.textContent = 'Copy'; copy.title = 'Copy this answer to the clipboard';
      const text = event.data.chat.replace(/^VERTEX:\\s*/, '');
      copy.addEventListener('click', () => { lastCopy = copy; api.postMessage({ action: 'copyAnswer', text }); });
    }
    document.getElementById('messages').appendChild(item);
    if (event.data.usage) {
      const line = document.createElement('p');
      line.className = 'usage';
      line.textContent = event.data.usage;
      document.getElementById('messages').appendChild(line);
    }
    if (copy) document.getElementById('messages').appendChild(copy);
    const box = document.getElementById('messages');
    box.scrollTop = box.scrollHeight;
  }
});
function links(item, choices) {
  const used = new Set();
  item.querySelectorAll('strong').forEach(name => {
    const li = name.closest('li');
    const type = li && li.firstChild && li.firstChild.nodeType === 3 ? li.firstChild.textContent.trim() : '';
    // The object and package may have identical visible names. Assign each
    // occurrence to the next matching destination so both remain clickable.
    const index = choices.findIndex((choice, i) => !used.has(i) && choice.object_name === name.textContent
      && (!type || choice.object_type === type));
    const object = index >= 0 ? choices[index] : null;
    if (!object) return;
    used.add(index);
    const link = document.createElement('a');
    link.href = '#'; link.className = 'link'; link.title = 'Open ' + object.object_type + ' ' + object.object_name;
    link.appendChild(name.cloneNode(true));
    link.addEventListener('click', event => { event.preventDefault(); api.postMessage({ action: 'openObject', object_type: object.object_type, object_name: object.object_name }); });
    name.replaceWith(link);
  });
}
// A citation whose id begins exactly one known session opens it at the cited step.
function runLinks(item, runs) {
  item.querySelectorAll('.run-cite').forEach(cite => {
    const matches = runs.filter(run => run.session_id.startsWith(cite.dataset.run)
      && (cite.dataset.kind !== 'run' || run.kind === 'transpiler'));
    if (matches.length !== 1) return;
    const run = matches[0], link = document.createElement('a');
    link.href = '#'; link.className = 'link'; link.title = 'Open ' + run.kind + ' session ' + run.session_id + ' at step ' + cite.dataset.step + ' in VERTEX Smart Debugger';
    // A run of this conversation reads as its number; one from elsewhere keeps the cited id.
    link.textContent = run.kind === 'transpiler' && run.number ? 'run ' + run.number + ', step ' + cite.dataset.step : cite.textContent;
    link.addEventListener('click', event => { event.preventDefault();
      api.postMessage(run.kind === 'transpiler'
        ? { action: 'openRun', run_id: run.run_id, step: Number(cite.dataset.step) }
        : { action: 'openSession', session_id: run.session_id, step: Number(cite.dataset.step) }); });
    cite.replaceWith(link);
  });
}
// Markdown built as DOM nodes with textContent only, so an answer cannot inject markup.
function inline(text, parent) {
  text.split(/(\\[(?:run|session) [0-9a-f-]{6,36} step \\d+\\]|\\x60[^\\x60]+\\x60|\\*\\*[^*]+\\*\\*|\\*[^*\\s][^*]*\\*)/).forEach(token => {
    if (!token) return;
    let node;
    const cite = /^\\[(run|session) ([0-9a-f-]{6,36}) step (\\d+)\\]$/.exec(token);
    // A cited step of a transpiler run: a link once the run is known (runLinks), plain text otherwise.
    if (cite) { node = document.createElement('span'); node.className = 'run-cite'; node.dataset.kind = cite[1]; node.dataset.run = cite[2]; node.dataset.step = cite[3]; node.textContent = token; }
    else if (/^\\x60[^\\x60]+\\x60$/.test(token)) { node = document.createElement('code'); node.textContent = token.slice(1, -1); }
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
