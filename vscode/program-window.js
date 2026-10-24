"use strict";
/* The program window: a program run with the ABAP transpiler as SAP GUI shows a report - its selection screen, Execute
   (F8), the list it writes, Back (F3) to the screen - in an editor tab, in the colours of the VS Code theme. Each run is
   recorded; See flow history opens VERTEX Smart Debugger on that record, and a run that stops at a breakpoint opens it at once.
   host: { selection(), run(selection), flow(), recompile() | null, builtAt }. */
const fs = require("fs");
const path = require("path");

let current = null;

function html(initial) {
  const ui = fs.readFileSync(path.join(__dirname, "pages", "selection-screen-ui.js"), "utf8");
  return fs.readFileSync(path.join(__dirname, "pages", "program-window.html"), "utf8")
    .replace("/*INIT*/null/*INIT*/", () => JSON.stringify(initial).replace(/</g, "\\u003c"))
    .replace("/*SELECTION-SCREEN-UI*/", () => ui);
}

function open(vscode, { name, host }) {
  current?.panel.dispose();
  const panel = vscode.window.createWebviewPanel("vertex.programWindow", name + " · ABAP program", vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true });
  const self = { panel };
  current = self;
  panel.onDidDispose(() => { if (current === self) current = null; });
  panel.webview.html = html({ name, recompile: !!host.recompile, builtAt: host.builtAt || "", pending: !!host.pending,
    deferred: !!host.deferred, autoSelection: host.autoSelection || null });
  panel.webview.onDidReceiveMessage(async message => {
    const reply = (value, error) => panel.webview.postMessage({ type: "reply", id: message.id, value, error });
    try {
      if (message.call === "selection") return reply(await host.selection());
      if (message.call === "run") return reply(await host.run(message.selection || {}));
      if (message.call === "flow") return reply(await host.flow());
      // The named variants of a method's or module's values, kept by the debug adapter.
      if (message.call === "adapter" && ["variants", "saveVariant", "deleteVariant"].includes(message.command))
        return reply(await host.adapter(message.command, message.args || {}));
      if (message.call === "recompile" && host.recompile) return reply(await host.recompile());
      throw new Error("Unsupported request of the program window: " + message.call);
    } catch (error) { reply(null, error.message); }
  });
  return self;
}

/* The window in front again, when it is still open: VERTEX Smart Debugger's way back to the program. */
function reveal() { if (!current) return false; current.panel.reveal(); return true; }
const isOpen = () => !!current;
/* The editor column the window stands in, while it is open and in sight. */
const column = () => current && current.panel.visible ? current.panel.viewColumn : undefined;

module.exports = { open, html, reveal, isOpen, column };
