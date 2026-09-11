"use strict";

// VS Code host for the pages the Eclipse plugin serves - the same files, from
// the same folder. Nothing about a service lives here that does not live there
// too, which is the whole point of the split.
//
// Eclipse gets its connection from the ABAP project's ADT session, and a window
// opened from an object inherits the system that object lives in. Here there is
// no project to inherit from, so the systems are a list in the settings and one
// of them is active.

const vscode = require("vscode");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PAGES = path.join(__dirname, "..", "org.vertex.abap.ui", "resources");

/** Passwords are filed per system: two systems are two users often enough. */
function secretKey(system) {
  return "vertex.password." + system.name;
}

/* ---------- what each service asks for ----------

   One entry per view in the Eclipse plugin, and the path builders are the same
   ones its Java writes. They are duplicated rather than shared because there is
   nowhere to share them: the two hosts have no language in common. Keeping them
   side by side in one table at least makes the divergence visible.           */

const SERVICES = {

  table: {
    page: "table.html",
    title: "SelecTor",
    // name, rows, query
    load: function (args) {
      let p = "/sap/bc/adt/zsde/table/" + upper(args[0])
            + "?rows=" + encodeURIComponent(args[1] || 100);
      if (args[2]) {
        p += "&" + args[2];
      }
      return p;
    },
    // table, taken, rows, query, cross, build
    join: function (args) {
      let p = "/sap/bc/adt/zsde/join/" + upper(args[0]);
      let n = 0;
      // The resource stops at the first missing t-parameter, so the numbering
      // has to be contiguous however gappy the list arrives.
      String(args[1] || "").split(",").forEach(function (raw) {
        const name = raw.trim();
        if (!name) {
          return;
        }
        n++;
        p += (n === 1 ? "?" : "&") + "t" + n + "=" + upper(name);
      });
      [args[2] > 0 ? "rows=" + args[2] : "", args[3] || "", args[4] || "", args[5] || ""]
        .forEach(function (part) {
          if (!part) {
            return;
          }
          p += (n === 0 && p.indexOf("?") === -1 ? "?" : "&") + part;
        });
      return p;
    }
  },

  metrics: {
    page: "metrics.html",
    title: "Metrics",
    // name, type - the ADT type travels with its subtype, CLAS/OC
    load: function (args) {
      let p = "/sap/bc/adt/zsde/metrics/" + upper(args[0]);
      if (args[1]) {
        p += "?type=" + encodeURIComponent(args[1]);
      }
      return p;
    }
  },

  versions: {
    page: "versions.html",
    title: "Versions",
    // name, type, part, ptype, from, to
    load: function (args) {
      let p = "/sap/bc/adt/zsde/versions/" + upper(args[0])
            + "?type=" + encodeURIComponent(args[1] || "");
      if (args[2]) {
        // A part name is a VRSD key: thirty characters of object padded with
        // blanks, then the method. encodeURIComponent writes a space as %20,
        // which is what the other side reads; a '+' would be a space only
        // under form encoding.
        p += "&part=" + encodeURIComponent(args[2]);
        p += "&ptype=" + encodeURIComponent(args[3] || "");
      }
      if (args[5]) {
        // An empty from is the oldest version, compared against nothing.
        p += "&from=" + encodeURIComponent(args[4] || "");
        p += "&to=" + encodeURIComponent(args[5]);
      }
      return p;
    },
    // request, remote - a review compared against another system is a different
    // review, so the other system belongs in the request.
    review: function (args) {
      let p = "/sap/bc/adt/zsde/review/" + upper(args[0]);
      if (args[1]) {
        p += "?remote=" + encodeURIComponent(args[1]);
      }
      return p;
    }
  }
};

function upper(value) {
  return encodeURIComponent(String(value || "").toUpperCase());
}

/* ---------- the page ---------- */

// In Eclipse these are BrowserFunctions; here they are postMessage, which is the
// only thing a webview can do. The contract fits unchanged because sdeLoad never
// returned a value in the first place - the asynchronous shape was forced on us
// by the WebView2 callback deadlock, and it happens to be exactly what VS Code
// requires.
//
// The arguments travel as an array rather than by name. Each service calls
// sdeLoad with its own, and a host that named them would need editing every time
// a page learned a new one; what they mean is the service's business, and the
// service is where it is written down.
const SHIM = [
  "<script>",
  "(function () {",
  "  const api = acquireVsCodeApi();",
  "  let pending = null;",
  "  function send(call) {",
  "    return function () {",
  "      api.postMessage({ type: 'call', call: call,",
  "                        args: Array.prototype.slice.call(arguments) });",
  "    };",
  "  }",
  "  window.sdeLoad = send('load');",
  "  window.sdeJoin = send('join');",
  "  window.sdeOpen = send('open');",
  "  window.sdeReview = send('review');",
  "  window.sdeTitle = send('title');",
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
].join(String.fromCharCode(10));

function pageHtml(service, initial) {
  let html = fs.readFileSync(path.join(PAGES, SERVICES[service].page), "utf8");
  html = html.replace("<script>", SHIM + String.fromCharCode(10) + "<script>");
  html = html.replace("/*INIT*/null/*INIT*/", initialLiteral(initial));
  return html;
}

/** What the page starts from, in the shape that page expects. */
function initialLiteral(initial) {
  if (!initial) {
    return "null";
  }
  if (typeof initial === "string") {
    return "'" + initial + "'";
  }
  return "{name:'" + initial.name + "',type:'" + (initial.type || "") + "'}";
}

/* ---------- the systems ---------- */

function systems() {
  return (vscode.workspace.getConfiguration("vertex").get("systems") || [])
    .filter(function (s) { return s && s.name; });
}

/**
 * The system to read from, or a sentence saying why there is none. An empty
 * vertex.active means the first one: with a single system configured, naming it
 * again would be ceremony.
 */
function active() {
  const all = systems();
  if (all.length === 0) {
    return { error: "No system configured. Put one in vertex.systems: a name, a url and a user." };
  }
  const wanted = (vscode.workspace.getConfiguration("vertex").get("active") || "").trim();
  if (!wanted) {
    return { system: all[0] };
  }
  const found = all.filter(function (s) { return s.name === wanted; });
  if (found.length === 0) {
    return {
      error: "vertex.active names " + wanted + ", which is not in vertex.systems. There is "
           + all.map(function (s) { return s.name; }).join(", ") + "."
    };
  }
  return { system: found[0] };
}

function missing(system) {
  const gaps = [];
  if (!system.url) { gaps.push("url"); }
  if (!system.user) { gaps.push("user"); }
  return gaps;
}

// Asked once per system, then kept by VS Code in the OS credential store. This
// extension never writes it to a file and never puts it in a URL.
async function password(context, system) {
  const stored = await context.secrets.get(secretKey(system));
  if (stored) {
    return stored;
  }
  const entered = await vscode.window.showInputBox({
    prompt: "SAP password for " + system.user + " on " + system.name,
    password: true,
    ignoreFocusOut: true
  });
  if (entered) {
    await context.secrets.store(secretKey(system), entered);
  }
  return entered;
}

/** The client belongs to every request, not to one of them. */
function withClient(system, requestPath) {
  if (!system.client) {
    return requestPath;
  }
  return requestPath + (requestPath.indexOf("?") === -1 ? "?" : "&")
       + "sap-client=" + encodeURIComponent(system.client);
}

function request(system, pw, requestPath) {
  return new Promise(function (resolve, reject) {
    let base;
    try {
      base = new URL(system.url);
    } catch (e) {
      reject(new Error("The url of " + system.name + " is not a valid one: " + system.url));
      return;
    }

    const secure = base.protocol === "https:";
    const options = {
      hostname: base.hostname,
      port: base.port || (secure ? 443 : 80),
      path: requestPath,
      method: "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(system.user + ":" + pw).toString("base64"),
        Accept: "application/json"
      }
    };
    if (secure) {
      options.rejectUnauthorized = system.allowInsecureCertificate !== true;
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
    text += String.fromCharCode(10, 10)
          + "The server certificate could not be verified. Development systems often carry "
          + "one that cannot be. If you accept that, set allowInsecureCertificate on this "
          + "system in vertex.systems - it is off by default because it disables the check "
          + "entirely.";
  }
  return text;
}

/** Reads one resource and answers in the shape the page expects. */
async function fetch(context, requestPath) {
  const chosen = active();
  if (chosen.error) {
    return "ERROR:" + chosen.error;
  }
  const system = chosen.system;
  const gaps = missing(system);
  if (gaps.length) {
    return "ERROR:System " + system.name + " has no " + gaps.join(" and ") + ".";
  }

  const pw = await password(context, system);
  if (!pw) {
    return "ERROR:No password was entered, so the request was not sent.";
  }

  let response;
  try {
    response = await request(system, pw, withClient(system, requestPath));
  } catch (e) {
    return "ERROR:" + describeConnection(e);
  }

  if (response.status === 401) {
    // A wrong password kept in the store would block every later attempt with no
    // way out, so drop it and say that it was dropped.
    await context.secrets.delete(secretKey(system));
    return "ERROR:HTTP 401: " + system.name + " rejected user " + system.user
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

function open(context, service, initial, beside) {
  const definition = SERVICES[service];
  const panel = vscode.window.createWebviewPanel(
    "vertex",
    typeof initial === "string" && initial ? initial : definition.title,
    beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = pageHtml(service, initial);

  panel.webview.onDidReceiveMessage(
    async function (message) {
      if (!message || message.type !== "call") {
        return;
      }
      const args = message.args || [];

      if (message.call === "open") {
        // What needed surgery on the E4 model in Eclipse is one argument here.
        open(context, service, String(args[0] || ""), true);
        return;
      }
      if (message.call === "title") {
        // The page reports what it loaded, so a panel driven from its own input
        // bar does not keep the name it was opened with.
        if (args[0]) {
          panel.title = definition.title + ": " + args[0];
        }
        return;
      }

      const build = definition[message.call];
      if (!build) {
        // A page asking for something this service does not answer is a gap in
        // the host, not a user error, and it says so where the user can see it.
        panel.webview.postMessage({
          type: "result",
          payload: "ERROR:This host has no " + message.call + " for " + service + "."
        });
        return;
      }
      panel.webview.postMessage({ type: "result", payload: await fetch(context, build(args)) });
    },
    undefined,
    context.subscriptions
  );

  return panel;
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("vertex.open", function () {
      open(context, "table", null, false);
    }),
    vscode.commands.registerCommand("vertex.metrics", function () {
      open(context, "metrics", null, false);
    }),
    vscode.commands.registerCommand("vertex.versions", function () {
      open(context, "versions", null, false);
    }),
    vscode.commands.registerCommand("vertex.switchSystem", async function () {
      const all = systems();
      if (all.length === 0) {
        vscode.window.showWarningMessage(
          "VERTEX: there is nothing to switch between. Put your systems in vertex.systems.");
        return;
      }
      const current = active();
      const picked = await vscode.window.showQuickPick(
        all.map(function (s) {
          return {
            label: s.name,
            description: s.user + "@" + s.url + (s.client ? " client " + s.client : ""),
            picked: !current.error && current.system.name === s.name
          };
        }),
        { title: "Read from which system?" }
      );
      if (!picked) {
        return;
      }
      await vscode.workspace.getConfiguration("vertex")
        .update("active", picked.label, vscode.ConfigurationTarget.Global);
      // Panels already open keep what they last read; the next Load goes to the
      // system chosen here.
      vscode.window.showInformationMessage("VERTEX: now reading from " + picked.label + ".");
    }),
    vscode.commands.registerCommand("vertex.forgetPassword", async function () {
      const chosen = active();
      if (chosen.error) {
        vscode.window.showWarningMessage("VERTEX: " + chosen.error);
        return;
      }
      await context.secrets.delete(secretKey(chosen.system));
      vscode.window.showInformationMessage(
        "VERTEX: the stored password for " + chosen.system.name + " was removed.");
    })
  );
}

function deactivate() {
}

exports.activate = activate;
exports.deactivate = deactivate;
