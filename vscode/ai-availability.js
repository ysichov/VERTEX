"use strict";
/* Whether the chat has anything to ask: a provider with models. The AI panel learns it when it lists models;
   review pages hide their ASK AI buttons while it is false and keep the prompt buttons. Unknown (null) hides nothing. */
let available = null;
const listeners = new Set();

function set(value) {
  value = Boolean(value);
  if (value === available) return;
  available = value;
  for (const listener of listeners) listener(available);
}
function get() { return available; }

/** Keeps PANEL told: now, and on every change until it closes. The page handles { aiAvailable }. */
function attach(panel) {
  const send = value => { if (value !== null) void panel.webview.postMessage({ aiAvailable: value }); };
  send(available);
  listeners.add(send);
  panel.onDidDispose(() => listeners.delete(send));
}

/** The page side: hides button.ask while no AI is available - the state at build time, then each message. */
const pageScript = () => "document.documentElement.classList.toggle('no-ai'," + (available === false) + ");window.addEventListener('message',e=>{if(e.data&&typeof e.data.aiAvailable==='boolean')document.documentElement.classList.toggle('no-ai',!e.data.aiAvailable);});";
// Stronger than the review's own rule that forces a block's ASK AI visible.
const PAGE_CSS = "html.no-ai button.ask,html.no-ai .file .hunk .hunk-tools [data-action=ask]{display:none!important}";

module.exports = { set, get, attach, pageScript, PAGE_CSS };
