"use strict";

// Portability spike. This host serves the very same resources/table.html the
// Eclipse plugin uses, with stub data instead of SAP. If the page works here
// unchanged, the UI is portable and only the host has to be written twice.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const PAGE = path.join(__dirname, "..", "org.selector.adt.ui", "resources", "table.html");

// The page expects four globals. In Eclipse they are BrowserFunctions; here they
// are postMessage, which is the only thing a webview can do. The contract fits
// unchanged because sdeLoad never returned a value in the first place - the
// asynchronous shape was forced on us by the WebView2 callback deadlock, and it
// happens to be exactly what VS Code requires.
const SHIM = [
  "<script>",
  "(function () {",
  "  const api = acquireVsCodeApi();",
  "  let pending = null;",
  "  window.sdeLoad = function (name, rows, query) {",
  "    api.postMessage({ type: 'load', name: name, rows: rows, query: query });",
  "  };",
  "  window.sdeOpen = function (name) {",
  "    api.postMessage({ type: 'open', name: name });",
  "  };",
  "  window.sdeTake = function () {",
  "    const taken = pending;",
  "    pending = null;",
  "    return taken;",
  "  };",
  "  window.addEventListener('message', function (e) {",
  "    if (e.data && e.data.type === 'result') {",
  "      pending = e.data.payload;",
  "      sdeReady();",
  "    }",
  "  });",
  "}());",
  "</script>"
].join("\n");

function pageHtml(initial) {
  let html = fs.readFileSync(PAGE, "utf8");
  html = html.replace("<script>", SHIM + "\n<script>");
  html = html.replace("/*INIT*/null/*INIT*/", initial ? "'" + initial + "'" : "null");
  return html;
}

// Fixed rows, shaped exactly like the ABAP resource answers.
function stub(name, query) {
  const fields = [
    { name: "mandt", position: 1, key: true, datatype: "CLNT", length: 3, decimals: 0,
      text: "Client" },
    { name: "bukrs", position: 2, key: true, datatype: "CHAR", length: 4, decimals: 0,
      text: "Company Code" },
    { name: "butxt", position: 3, key: false, datatype: "CHAR", length: 25, decimals: 0,
      text: "Name of Company Code" },
    { name: "land1", position: 4, key: false, datatype: "CHAR", length: 3, decimals: 0,
      text: "Country/Region Key" }
  ];

  const rows = [
    { mandt: "100", bukrs: "0001", butxt: "Stub Industries", land1: "DE" },
    { mandt: "100", bukrs: "0002", butxt: "Stub Trading", land1: "UA" },
    { mandt: "100", bukrs: "0003", butxt: "Stub Holding", land1: "US" }
  ];

  // The selection panel is the part worth proving. Rather than dropping the
  // query the page built, send it back as a visible row.
  rows.push({
    mandt: "",
    bukrs: "",
    butxt: query ? "query: " + query : "query: (none)",
    land1: ""
  });

  return JSON.stringify({
    table: String(name).toLowerCase(),
    count: rows.length,
    fields: fields,
    rows: rows
  });
}

function open(context, initial, beside) {
  const panel = vscode.window.createWebviewPanel(
    "selector",
    initial || "SelecTor",
    beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = pageHtml(initial);

  panel.webview.onDidReceiveMessage(
    function (message) {
      if (message.type === "load") {
        panel.webview.postMessage({
          type: "result",
          payload: stub(message.name, message.query)
        });
      } else if (message.type === "open") {
        // What needed surgery on the E4 model in Eclipse is one argument here.
        open(context, message.name, true);
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("selector.open", function () {
      open(context, null, false);
    })
  );
}

function deactivate() {
}

exports.activate = activate;
exports.deactivate = deactivate;
