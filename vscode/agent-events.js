"use strict";

/** Small provider-neutral event bus for the VS Code agent UI. */
function createEmitter() {
  const listeners = new Set();
  return {
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(event) {
      // A detached or broken view must not interrupt a SAP operation.
      for (const listener of listeners) {
        try { listener(event); } catch (_) { /* observers cannot fail the operation */ }
      }
    }
  };
}

module.exports = { createEmitter };
