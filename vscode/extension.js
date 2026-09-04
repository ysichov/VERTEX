"use strict";

// VS Code host for resources/table.html - the same page the Eclipse plugin serves.
// Eclipse gets its connection from the ABAP project's ADT session; here there is
// no such thing to borrow, so this host holds its own: settings for the system,
// the password in the OS credential store, and a plain HTTPS request.

const vscode = require("vscode");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PAGE = path.join(__dirname, "..", "org.selector.adt.ui", "resources", "table.html");
const SECRET = "selector.password";

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

/* ---------- connection ---------- */

function settings() {
  const c = vscode.workspace.getConfiguration("selector");
  return {
    url: (c.get("url") || "").trim(),
    client: (c.get("client") || "").trim(),
    user: (c.get("user") || "").trim(),
    insecure: c.get("allowInsecureCertificate") === true
  };
}

function missing(cfg) {
  const gaps = [];
  if (!cfg.url) { gaps.push("selector.url"); }
  if (!cfg.user) { gaps.push("selector.user"); }
  return gaps;
}

// Asked once, then kept by VS Code in the OS credential store. This extension
// never writes it to a file and never puts it in a URL.
async function password(context, user) {
  const stored = await context.secrets.get(SECRET);
  if (stored) {
    return stored;
  }
  const entered = await vscode.window.showInputBox({
    prompt: "SAP password for " + user,
    password: true,
    ignoreFocusOut: true
  });
  if (entered) {
    await context.secrets.store(SECRET, entered);
  }
  return entered;
}

function resourcePath(cfg, name, rows, query) {
  let p = "/sap/bc/adt/zsde/table/" + encodeURIComponent(String(name).toUpperCase())
        + "?rows=" + encodeURIComponent(rows);
  if (cfg.client) {
    p += "&sap-client=" + encodeURIComponent(cfg.client);
  }
  if (query) {
    p += "&" + query;
  }
  return p;
}

function request(cfg, pw, requestPath) {
  return new Promise(function (resolve, reject) {
    let base;
    try {
      base = new URL(cfg.url);
    } catch (e) {
      reject(new Error("selector.url is not a valid URL: " + cfg.url));
      return;
    }

    const secure = base.protocol === "https:";
    const options = {
      hostname: base.hostname,
      port: base.port || (secure ? 443 : 80),
      path: requestPath,
      method: "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(cfg.user + ":" + pw).toString("base64"),
        Accept: "application/json"
      }
    };
    if (secure) {
      options.rejectUnauthorized = !cfg.insecure;
    }

    const req = (secure ? https : http).request(options, function (res) {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", function (chunk) { body += chunk; });
      res.on("end", function () {
        resolve({ status: res.statusCode, headers: res.headers, body: body });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** ADT reports failures as XML; pull the human sentence out of it. */
function describeFailure(status, body) {
  const match = /<message[^>]*>([\s\S]*?)<\/message>/.exec(body);
  const detail = match ? match[1].trim() : body.substring(0, 500).trim();
  return "HTTP " + status + (detail ? ": " + detail : "");
}

function describeConnection(error) {
  const code = String(error.code || "");
  let text = "Cannot reach the system: " + (error.message || String(error));
  if (code.indexOf("CERT") !== -1 || code.indexOf("SELF_SIGNED") !== -1) {
    text += "\n\nThe server certificate could not be verified. Development systems often carry "
          + "one that cannot be. If you accept that, set selector.allowInsecureCertificate to "
          + "true - it is off by default because it disables the check entirely.";
  }
  return text;
}

async function fetchTable(context, name, rows, query) {
  const cfg = settings();
  const gaps = missing(cfg);
  if (gaps.length) {
    return "ERROR:Set " + gaps.join(" and ") + " in the settings first.";
  }

  const pw = await password(context, cfg.user);
  if (!pw) {
    return "ERROR:No password was entered, so the request was not sent.";
  }

  let response;
  try {
    response = await request(cfg, pw, resourcePath(cfg, name, rows, query));
  } catch (e) {
    return "ERROR:" + describeConnection(e);
  }

  if (response.status === 401) {
    // A wrong password kept in the store would block every later attempt with no
    // way out, so drop it and say that it was dropped.
    await context.secrets.delete(SECRET);
    return "ERROR:HTTP 401: the system rejected user " + cfg.user
         + ". The stored password has been discarded; loading again will ask for it.";
  }
  if (response.status !== 200) {
    return "ERROR:" + describeFailure(response.status, response.body);
  }
  if (!response.body || !response.body.trim()) {
    // A 200 carrying nothing is not success. Name what actually came back
    // instead of letting the page fail on an empty parse.
    return "ERROR:HTTP 200 with an empty body."
         + " content-type: " + (response.headers["content-type"] || "(none)")
         + " | content-length: " + (response.headers["content-length"] || "(none)")
         + " | location: " + (response.headers["location"] || "(none)");
  }
  return response.body;
}

/* ---------- panels ---------- */

function open(context, initial, beside) {
  const panel = vscode.window.createWebviewPanel(
    "selector",
    initial || "SelecTor",
    beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = pageHtml(initial);

  panel.webview.onDidReceiveMessage(
    async function (message) {
      if (message.type === "load") {
        const payload = await fetchTable(context, message.name, message.rows, message.query);
        panel.webview.postMessage({ type: "result", payload: payload });
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
    }),
    vscode.commands.registerCommand("selector.forgetPassword", async function () {
      await context.secrets.delete(SECRET);
      vscode.window.showInformationMessage("SelecTor: the stored password was removed.");
    })
  );
}

function deactivate() {
}

exports.activate = activate;
exports.deactivate = deactivate;
