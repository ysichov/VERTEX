"use strict";

/* A tool call that reached VERTEX's /chat MCP endpoint, told to the chat request that is waiting for it. Claude
   Code reports its steps in its own event stream; Codex does not, so for it the endpoint is where a step shows. */
const listeners = new Set();

function listen(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function report(name) {
  for (const callback of [...listeners]) {
    try { callback(String(name || "")); } catch (_) { /* a listener's failure does not stop the tool call */ }
  }
}

module.exports = { listen, report };
