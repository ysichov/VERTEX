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
const mcp = require("./mcp");
const selector = require("./selector");
const versions = require("./versions");
const assistant = require("./assistant");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

/* The pages are the Eclipse plugin's, and that is where they are read from in
   a checkout. A vsix carries only this folder, so vscode:prepublish copies them
   in and the packaged extension finds them here. One source of truth, one copy
   made at packaging time, and no guessing at run time about which it is. */
const PACKAGED = path.join(__dirname, "resources");
const PAGES = fs.existsSync(PACKAGED)
  ? PACKAGED
  : path.join(__dirname, "..", "org.vertex.abap.ui", "resources");

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
    },
    // name, type, mode, include, unit, expand, depth. The include comes for
    // the scheme, because it is what identifies the code: for a class it is
    // the method's own include, for a program it is not. The flow is about
    // the whole object and names neither.
    flow: function (args) {
      let p = "/sap/bc/adt/zsde/flow/" + upper(args[0])
            + "?mode=" + encodeURIComponent(args[2] || "scheme");
      if (args[3]) {
        p += "&include=" + encodeURIComponent(args[3]);
      }
      if (args[1]) {
        p += "&type=" + encodeURIComponent(args[1]);
      }
      if (args[4]) {
        // A method is named CLASS=>METHOD, which an untouched query string
        // would split at the equals sign.
        p += "&unit=" + encodeURIComponent(args[4]);
      }
      if (args[5]) {
        p += "&expand=" + encodeURIComponent(args[5]);
      }
      if (args[6]) {
        p += "&depth=" + encodeURIComponent(args[6]);
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
    // request, remote, part, ptype - a review compared against another system is
    // a different review, so the other system belongs in the request. An empty
    // part asks for the summary; a named one asks for that object's blocks.
    review: function (args) {
      let p = "/sap/bc/adt/zsde/review/" + upper(args[0]);
      let lead = "?";
      if (args[1]) {
        p += lead + "remote=" + encodeURIComponent(args[1]);
        lead = "&";
      }
      if (args[2]) {
        p += lead + "part=" + encodeURIComponent(args[2]);
        p += "&ptype=" + encodeURIComponent(args[3] || "");
      }
      return p;
    },
    // request, remote, part, ptype, body - a write goes to the review's own
    // path; what it does is in the body, and the answer is the part as it now
    // stands.
    act: function (args) {
      return SERVICES.versions.review(args);
    }
  }
};

/* Calls that change something on the server, and which of their arguments is
   the body. Everything not named here reads. */
const WRITES = { act: 4 };

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
  "  window.sdeFlow = send('flow');",
  "  window.sdeAsset = send('asset');",
  "  window.sdeJoin = send('join');",
  "  window.sdeOpen = send('open');",
  "  window.sdeReview = send('review');",
  "  window.sdeAct = send('act');",
  "  window.sdeTitle = send('title');",
  "  window.sdeBrowse = send('browse');",
  "  window.sdeAsk = send('ask');",
  "  window.sdeModels = send('models');",
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
  // The assistant answers on a channel of its own: a reply that takes a
  // minute must not land in the middle of whatever the grid is doing.
  "    if (e.data && e.data.type === 'assistant' && typeof sdeAssistant === 'function') {",
  "      sdeAssistant(e.data.payload);",
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

function request(system, pw, requestPath, extra) {
  const settings = extra || {};
  return new Promise(function (resolve, reject) {
    let base;
    try {
      base = new URL(system.url);
    } catch (e) {
      reject(new Error("The url of " + system.name + " is not a valid one: " + system.url));
      return;
    }

    const secure = base.protocol === "https:";
    const headers = {
      Authorization: "Basic " + Buffer.from(system.user + ":" + pw).toString("base64"),
      Accept: "application/json"
    };
    Object.keys(settings.headers || {}).forEach(function (name) {
      headers[name] = settings.headers[name];
    });
    if (settings.body) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(settings.body, "utf8");
    }

    const options = {
      hostname: base.hostname,
      port: base.port || (secure ? 443 : 80),
      path: requestPath,
      method: settings.method || "GET",
      headers: headers
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
    if (settings.body) {
      req.write(settings.body, "utf8");
    }
    req.end();
  });
}

/* A write needs a CSRF token, and the token belongs to the session that was
   given it - so the cookies of that response have to travel with it. Eclipse
   never needed this: its ADT communication layer holds a destination and does
   the same dance out of sight. */
async function csrf(system, pw) {
  const res = await request(system, pw, withClient(system, "/sap/bc/adt/discovery"), {
    headers: { "x-csrf-token": "fetch" }
  });
  const token = res.headers["x-csrf-token"];
  if (!token || token.toLowerCase() === "required") {
    throw new Error("HTTP " + res.status + ": " + system.name
                  + " did not hand out a CSRF token, so nothing was written.");
  }
  const cookies = (res.headers["set-cookie"] || [])
    .map(function (one) { return one.split(";")[0]; })
    .join("; ");
  return { token: token, cookies: cookies };
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

/**
 * Reads one resource and answers in the shape the page expects. Given a BODY it
 * writes instead, which needs a CSRF token first.
 */
async function fetch(context, requestPath, body) {
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

  let extra;
  if (body) {
    try {
      const ticket = await csrf(system, pw);
      extra = {
        method: "POST",
        body: body,
        headers: { "x-csrf-token": ticket.token, Cookie: ticket.cookies }
      };
    } catch (e) {
      // CSRF already says what went wrong in a sentence; a connection failure
      // does not, and describeConnection is what turns one into words.
      return "ERROR:" + (e && e.message ? e.message : describeConnection(e));
    }
  }

  let response;
  try {
    response = await request(system, pw, withClient(system, requestPath), extra);
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
  if (response.status === 404) {
    // A resource that is not there is a setup state, not a failure: the
    // extension is installed here and the ABAP half has never been put on the
    // system. The page says what to install; it needs to be told which of the
    // two this is.
    return "ERROR:NOBACKEND:" + describeFailure(response.status, response.body);
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

/** One of the libraries that travel with the pages, as text. */
function asset(name) {
  if (name !== "mermaid") {
    return "ERROR:This host ships no asset called " + name + ".";
  }
  const file = path.join(PAGES, "mermaid.min.js");
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    return "ERROR:" + file + " could not be read: " + e.message;
  }
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
      if (message.call === "browse") {
        // Opening a link belongs to the window manager, not to the webview.
        if (args[0]) {
          vscode.env.openExternal(vscode.Uri.parse(String(args[0])));
        }
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
      if (message.call === "asset") {
        // A library the page needs, shipped with the extension rather than
        // fetched: these windows have to work on a machine with no way out to
        // the internet. The names are a fixed list, so this can never read
        // anything the extension did not mean to ship.
        panel.webview.postMessage({
          type: "result",
          payload: asset(String(args[0] || ""))
        });
        return;
      }
      if (message.call === "models" || message.call === "ask") {
        const payload = !ASSISTED[service]
          ? { error: "This window has no assistant." }
          : message.call === "models"
            ? await assistantModels(args)
            : await assistantAsk(context, service, args);
        payload.call = message.call;
        try {
          await panel.webview.postMessage({ type: "assistant", payload: JSON.stringify(payload) });
        } catch (e) {
          // The window was closed while the assistant was still working;
          // there is nobody left to tell.
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
      // A writing call carries its body in one of its arguments; WRITES says
      // which. Everything else reads.
      const bodyAt = WRITES[message.call];
      const body = bodyAt === undefined ? undefined : String(args[bodyAt] || "");
      panel.webview.postMessage({
        type: "result",
        payload: await fetch(context, build(args), body)
      });
    },
    undefined,
    context.subscriptions
  );

  return panel;
}

/* ---------- the window assistants ----------

   The person picks Claude Code or Codex, as they do for the MCP address, and
   the model that assistant offers. The request goes to that assistant with
   the window's own endpoint as its only tool source; what it hands back is
   checked against the system here before the page is given it.

   Each window that has one names what its assistant knows - the rules, the
   tools, the shape of a plan and the check - and the address its tools are
   served at, beside the review on the same local server. */

const ASSISTED = {
  table: { brain: selector, route: "/selector" },
  versions: { brain: versions, route: "/versions" }
};

function windowTools() {
  const pages = {};
  Object.keys(ASSISTED).forEach(function (service) {
    const brain = ASSISTED[service].brain;
    pages[ASSISTED[service].route] = { tools: brain.TOOLS, call: brain.callTool };
  });
  return pages;
}

function assistantExtension(id) {
  const described = assistant.ASSISTANTS[id];
  const found = described ? vscode.extensions.getExtension(described.extension) : null;
  return found ? found.extensionPath : "";
}

async function assistantModels(args) {
  const id = String(args[0] || "");
  try {
    return { assistant: id,
             models: await assistant.models({ assistant: id, extensionPath: assistantExtension(id) }) };
  } catch (e) {
    return { assistant: id, error: e.message };
  }
}

async function assistantAsk(context, service, args) {
  const id = String(args[0] || "");
  const brain = ASSISTED[service].brain;
  const chosen = active();
  if (chosen.error) {
    return { error: chosen.error };
  }
  let state;
  try {
    state = JSON.parse(String(args[3] || "{}"));
  } catch (e) {
    return { error: "The page sent a state that is not JSON." };
  }
  let running;
  try {
    running = await tools.start();
  } catch (e) {
    return { error: "The VERTEX tool server did not start, so the assistant would have no tools: "
                    + e.message };
  }
  try {
    const answer = await assistant.ask({
      assistant: id,
      model: String(args[1] || ""),
      extensionPath: assistantExtension(id),
      url: running.url.replace(/\/mcp$/, ASSISTED[service].route),
      token: tools.token,
      instructions: brain.INSTRUCTIONS,
      prompt: brain.preparePrompt
        ? await brain.preparePrompt({ fetch: fetch, context: context }, String(args[2] || ""), state)
        : brain.prompt(String(args[2] || ""), state),
      schema: brain.PLAN_SCHEMA,
      tools: brain.TOOLS.map(function (t) { return t.name; })
    });
    const plan = await brain.checkPlan({ fetch: fetch, context: context }, answer.plan);
    return { plan: plan, model: answer.model, system: chosen.system.name };
  } catch (e) {
    return { error: e.message, model: e.model || "", system: chosen.system.name };
  }
}

/* An agent already in the editor - Copilot, Claude Code, Codex - can be handed
   what VERTEX knows about SAP instead of VERTEX growing an agent of its own.
   The way in is MCP, and the server is this extension: it already holds the
   system, the user and the password, so nothing of that has to be passed to
   another process. */
function serveTools(context, server) {
  const label = "VERTEX SAP";
  const version = vscode.extensions.getExtension("YuriiSychov.vertex-abap");
  const shown = version && version.packageJSON ? version.packageJSON.version : "0";

  context.subscriptions.push(
    vscode.commands.registerCommand("vertex.mcpAddress", async function () {
      const client = await vscode.window.showQuickPick(["Codex", "Claude Code"], {
        title: "Connect VERTEX to which assistant?"
      });
      if (!client) { return; }
      let running;
      try {
        running = await server.start();
      } catch (e) {
        vscode.window.showErrorMessage("The VERTEX tool server did not start: "
                                       + (e && e.message ? e.message : String(e)));
        return;
      }
      // Ready to paste: Claude Code and Codex are told where to connect and
      // with which token. Copilot needs none of this - it is handed the same
      // address through the provider below.
      // User scope, not the default local one: local ties the server to the
      // directory Claude Code happens to be started in, and this one belongs
      // to the machine, not to a folder.
      const line = client === "Codex"
        ? '[mcp_servers.vertex]\nurl = "' + running.url
          + '"\nhttp_headers = { Authorization = "Bearer ' + server.token + '" }\n'
        : 'claude mcp add --transport http vertex --scope user ' + running.url
                 + ' --header "Authorization: Bearer ' + server.token + '"';
      await vscode.env.clipboard.writeText(line);
      vscode.window.showInformationMessage(
        (client === "Codex"
          ? "Copied Codex configuration. Paste into ~/.codex/config.toml, replacing any existing [mcp_servers.vertex] section, then restart the Codex extension and start a new conversation. "
          : "Copied the Claude Code terminal command. If vertex is already registered, run claude mcp remove vertex --scope user first. ")
        + (vscode.workspace.getConfiguration("vertex").get("mcp.port", 37777) === 0
          ? "Port 0 changes the address on reload. Set vertex.mcp.port for a stable connection."
          : "The port and token persist across window reloads."));
    })
  );

  if (!hasMcpApi()) {
    // Said once, where it can be seen: the tools simply will not appear
    // otherwise, and an empty tool list explains nothing.
    console.log("VERTEX: this VS Code has no vscode.lm MCP API, so no tools are offered.");
    return;
  }

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("vertex", {
      provideMcpServerDefinitions: async function () {
        const running = await server.start();
        return [
          new vscode.McpHttpServerDefinition(
            label,
            vscode.Uri.parse(running.url),
            { Authorization: "Bearer " + server.token },
            shown)
        ];
      }
    })
  );
}

function hasMcpApi() {
  return !!(vscode.lm
         && typeof vscode.lm.registerMcpServerDefinitionProvider === "function"
         && typeof vscode.McpHttpServerDefinition === "function");
}

let tools = null;

function activate(context) {
  const port = vscode.workspace.getConfiguration("vertex").get("mcp.port", 37777);
  tools = mcp.create({ fetch: fetch, context: context, port: port, pages: windowTools() });
  serveTools(context, tools);
  // External clients cannot trigger a VS Code MCP provider. Start on activation
  // so a registered Codex/Claude connection also works after a window reload.
  if (port !== 0) {
    tools.start().catch(function (error) {
      vscode.window.showErrorMessage("VERTEX: " + error.message);
    });
  }

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
  if (tools) { tools.stop(); tools = null; }
}

exports.activate = activate;
exports.deactivate = deactivate;
