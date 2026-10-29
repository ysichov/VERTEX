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
const anthropic = require("./anthropic");
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

let auth;
let stopDebugger;
let output;
const outputLogger = {};
["debug", "info", "warn", "error"].forEach(function (level) {
  outputLogger[level] = function (message) {
    if (!output) { output = vscode.window.createOutputChannel("VERTEX", { log: true }); }
    output[level](message);
  };
});

/* ---------- what each service asks for ----------

   One entry per view in the Eclipse plugin, and the path builders are the same
   ones its Java writes. They are duplicated rather than shared because there is
   nowhere to share them: the two hosts have no language in common. Keeping them
   side by side in one table at least makes the divergence visible.           */

const SERVICES = require(path.join(PAGES, "tool-routes.js")).SERVICES;

/* Which services the ABAP half on a system has, whichever window asks. */
const ABOUT = "/sap/bc/adt/vertex/about";

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
  "  window.sdeClass = send('class');",
  "  window.sdeFlow = send('flow');",
  "  window.sdeAsset = send('asset');",
  "  window.sdeJoin = send('join');",
  "  window.sdeOpen = send('open');",
  "  window.sdeReview = send('review');",
  "  window.sdeAct = send('act');",
  "  window.sdeRequests = send('requests');",
  "  window.sdeAbout = send('about');",
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
  "    if (e.data && e.data.type === 'progress' && typeof vertexProgress === 'function') {",
  "      vertexProgress(e.data.payload);",
  "    }",
  "    if (e.data && e.data.type === 'assistant' && typeof sdeAssistant === 'function') {",
  "      sdeAssistant(e.data.payload);",
  "    }",
  "  });",
  "}());",
  "</script>"
].join(String.fromCharCode(10));

function pageHtml(service, initial) {
  let html = fs.readFileSync(path.join(PAGES, SERVICES[service].page), "utf8");
  const controls = fs.readFileSync(path.join(PAGES, "vertex-controls.css"), "utf8");
  html = html.replace("</head>", "<style>" + controls + "</style></head>");
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
    .filter(function (s) { return s && s.name && s.disabled !== true; });
}

/**
 * The system to read from, or a sentence saying why there is none. An empty
 * vertex.active means the first one: with a single system configured, naming it
 * again would be ceremony.
 */
/* A VERTEX Tools window keeps the system it was opened on. Whatever it sets
   off - a read, the chat, an assistant's MCP calls - runs inside pinTo, and
   active() answers with that system instead of vertex.active. */
const pinnedSystem = new (require("async_hooks").AsyncLocalStorage)();

function pinTo(name, work) {
  return name ? pinnedSystem.run(name, work) : work();
}

function active() {
  const all = systems();
  if (all.length === 0) {
    return { error: "No system configured. VERTEX: Import SAP Systems fills vertex.systems from SAP Logon and Eclipse, or put one in by hand: a name, a url and a user." };
  }
  const pinned = pinnedSystem.getStore();
  const wanted = pinned || (vscode.workspace.getConfiguration("vertex").get("active") || "").trim();
  if (!wanted) {
    return auth.systemOf(all[0]);
  }
  const found = all.filter(function (s) { return s.name === wanted; });
  if (found.length === 0) {
    return {
      error: (pinned ? "This window reads from " + wanted + ", which is no longer"
                     : "vertex.active names " + wanted + ", which is not")
           + " in vertex.systems. There is " + all.map(function (s) { return s.name; }).join(", ") + "."
    };
  }
  return auth.systemOf(found[0]);
}

/** The client belongs to every request, not to one of them. */
function withClient(system, requestPath) {
  if (!system.client) {
    return requestPath;
  }
  return requestPath + (requestPath.indexOf("?") === -1 ? "?" : "&")
       + "sap-client=" + encodeURIComponent(system.client);
}

async function request(system, requestPath, extra) {
  const settings = extra || {};
  const headers = {
    Accept: requestPath.split("?")[0] === "/sap/bc/adt/discovery"
      ? "application/atomsvc+xml" : "application/json"
  };
  Object.keys(settings.headers || {}).forEach(function (name) {
    headers[name] = settings.headers[name];
  });
  if (settings.body) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Content-Length"] = Buffer.byteLength(settings.body, "utf8");
  }
  const wire = await auth.commandWire(system);
  const res = await wire.request({ url: withClient(system, requestPath),
    method: settings.method || "GET", headers: headers, body: settings.body });
  return { status: res.status, headers: res.headers, body: res.body };
}

/* A write needs a CSRF token, and the token belongs to the session that was
   given it - so the cookies of that response have to travel with it. Eclipse
   never needed this: its ADT communication layer holds a destination and does
   the same dance out of sight. */
async function csrf(system) {
  if (system.authType === "snc") { return { token: "", cookies: "" }; }
  const res = await request(system, "/sap/bc/adt/discovery", {
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

function reasonAndHint(r) {
  return r ? r.reason + (r.hint ? " " + r.hint : "") : "";
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

function failureText(system, error, sentence) {
  if (/^No password was entered/.test(error && error.message)) {
    return "No password was entered, so the request was not sent.";
  }
  if (error && typeof error.code === "string") return describeConnection(error);
  return sentence && error && error.message ? error.message : auth.explain(system, error);
}

/**
 * Reads one resource and answers in the shape the page expects. Given a BODY it
 * writes instead, which needs a CSRF token first.
 */
let frontendAnalysisRequest, frontendTableRequest, frontendTableWrite;
async function fetch(context, requestPath, body, progress, cancelled) {
  if (body == null && frontendAnalysisRequest && /^\/sap\/bc\/adt\/vertex\/(metrics|class|package|flow|navigator)\//.test(requestPath)) {
    try { return JSON.stringify(await frontendAnalysisRequest(requestPath, progress, cancelled)); }
    catch (error) { return 'ERROR:' + error.message; }
  }
  // SelecTor's table and join are read through ADT's data preview, not the VERTEX resource on SAP; a pivot still
  // goes to the resource.
  if (body == null && frontendTableRequest && /^\/sap\/bc\/adt\/vertex\/((table|join|versions|review)\/|requests(\?|$))/.test(requestPath)) {
    let answer;
    try { answer = await frontendTableRequest(requestPath, progress, cancelled); }
    catch (error) { return 'ERROR:' + error.message; }
    if (answer) { return JSON.stringify(answer); }
  }
  // A reviewer's action and the save of a review built from ADT are made on this side and stored in the table
  // (through VERTEX's store resource) or in a file, as vertex.review.storage says.
  if (body != null && frontendTableWrite && /^\/sap\/bc\/adt\/vertex\/review\//.test(requestPath)) {
    try { return JSON.stringify(await frontendTableWrite(requestPath, body, progress)); }
    catch (error) { return 'ERROR:' + error.message; }
  }
  if (body == null && requestPath === ABOUT) {
    const selected = active();
    if (selected.error) return 'ERROR:' + selected.error;
    const raw = await fetch(context, ABOUT + '?backend=1');
    let remote = {};
    try { if (!raw.startsWith('ERROR:')) remote = JSON.parse(raw); } catch (_) {}
    const local = ['metrics','class','package','flow','table','join','versions','requests','review'];
    const services = ['metrics','class','package','flow','table','join','versions','review','requests'].map(name =>
      local.includes(name) ? { name, active: 'X', backend: ['table','join','versions','requests','review'].includes(name) ? 'ADT data preview' : 'ADT + abaplint' } :
        (remote.services || []).find(s => s.name === name) || { name, active: '', backend: 'VERTEX', handler: name });
    return JSON.stringify({ ...remote, user: remote.user || selected.system.user,
      backends: remote.backends || [{ name: 'VERTEX', installed: false }], services });
  }
  const chosen = active();
  if (chosen.error) {
    return "ERROR:" + chosen.error;
  }
  const system = chosen.system;
  let extra;
  if (body) {
    try {
      const ticket = await csrf(system);
      extra = {
        method: "POST",
        body: body,
        headers: system.authType === "snc" ? {} : { "x-csrf-token": ticket.token, Cookie: ticket.cookies }
      };
    } catch (e) {
      // CSRF already says what went wrong in a sentence; a connection failure
      // does not, and describeConnection is what turns one into words.
      return "ERROR:" + failureText(system, e, true);
    }
  }

  // ADT's quick search answers in XML only; the VERTEX resources in JSON.
  if (!body && requestPath.startsWith("/sap/bc/adt/repository/informationsystem/search?")) {
    extra = { headers: { Accept: "application/xml" } };
  }

  let response;
  try {
    response = await request(system, requestPath, extra);
  } catch (e) {
    return "ERROR:" + failureText(system, e);
  }

  if (response.status === 401) {
    return "ERROR:HTTP 401: " + system.name + " rejected user " + system.user
         + ". " + reasonAndHint(auth.lastRefusal(system))
         + (system.authType === "basic" ? " The stored password has been discarded; loading again will ask for it." : "");
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
// The shared controls stylesheet is an asset like the diagram library: a page
// given to a webview as a string has no address to load one from, so it asks
// for what it needs by name. Both files live beside the pages.
const ASSETS = { mermaid: "mermaid.min.js", three: "three.min.js", controls: "vertex-controls.css", flow: "vertex-flow.js", lens: "vertex-lens.js", flowGraph: "vertex-flow-graph.js", abapControl: "vertex-abap-control.js" };
function asset(name) {
  if (!ASSETS[name]) {
    return "ERROR:This host ships no asset called " + name + ".";
  }
  const file = name === "abapControl" ? require("./abap-control").file : path.join(PAGES, ASSETS[name]);
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
      if (message.call === "about") {
        // What the ABAP half on this system has. Every window asks the same
        // question when it opens, so it is answered here rather than per service.
        panel.webview.postMessage({
          type: "result",
          payload: await fetch(context, ABOUT)
        });
        return;
      }
      if (message.call === "models" || message.call === "ask") {
        const payload = !ASSISTED[service]
          ? { error: "This window has no assistant." }
          : message.call === "models"
            ? await assistantModels(context, args)
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
      // What a long read is doing goes to the page's status line as it happens.
      const progress = text => { panel.webview.postMessage({ type: "progress", payload: String(text) }).then(undefined, () => {}); };
      panel.webview.postMessage({
        type: "result",
        payload: await fetch(context, build(args), body, progress)
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

async function assistantModels(context, args) {
  const id = String(args[0] || "");
  try {
    // What Config models in the VERTEX panel leaves switched on; versions are
    // added there too, so the page offers no field of its own for them.
    return { assistant: id, models: require("./model-config").apply(vscode, id, id === "anthropic-api"
      ? await anthropic.models((await require("./key-profiles").getActiveKey(context.secrets, id)).key)
      : await assistant.models({ assistant: id, extensionPath: assistantExtension(id),
        executable: id === "claude" || id === "codex"
          ? await assistant.resolveAssistant(vscode, id, assistantExtension(id)) : undefined })) };
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
      personalInstructions: vscode.workspace.getConfiguration("vertex.ai").get("personalInstructions", false),
      extensionPath: assistantExtension(id),
      executable: id === "claude" || id === "codex"
        ? await assistant.resolveAssistant(vscode, id, assistantExtension(id)) : undefined,
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
    // The gear in the VERTEX panel's title: every VERTEX setting in the Settings editor.
    vscode.commands.registerCommand("vertex.openSettings", async function () {
      await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:YuriiSychov.vertex-abap");
    }),
    vscode.commands.registerCommand("vertex.getStarted", async function () {
      await vscode.commands.executeCommand("workbench.action.openWalkthrough",
        "YuriiSychov.vertex-abap#vertex.start", false);
    }),
    ...["systems", "test", "ai", "mcp"].map(step =>
      vscode.commands.registerCommand("vertex." + step + "Info", async function () {
        await vscode.commands.executeCommand("markdown.showPreview",
          vscode.Uri.file(path.join(__dirname, "walkthrough", step + ".md")));
      })),
    vscode.commands.registerCommand("vertex.mcpAddress", async function () {
      const picked = await vscode.window.showQuickPick(["Codex", "Claude Code"], {
        title: "Connect VERTEX to which assistant?"
      });
      if (!picked) { return; }
      const client = picked;
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
      const entries = [{ name: "vertex", url: running.url },
        { name: "vertex-debug", url: running.url.replace(/\/mcp$/, "/debug") }];
      const line = entries.map(({ name, url }) => client === "Codex"
        ? '[mcp_servers.' + name + ']\nurl = "' + url
          + '"\nhttp_headers = { Authorization = "Bearer ' + server.token + '" }\n'
        : 'claude mcp add --transport http ' + name + ' --scope user ' + url
                 + ' --header "Authorization: Bearer ' + server.token + '"').join("\n");
      await vscode.env.clipboard.writeText(line);
      vscode.window.showInformationMessage(
        (client === "Codex"
          ? "Copied Codex configuration for review and debugger. Paste into ~/.codex/config.toml, replacing existing [mcp_servers.vertex] and [mcp_servers.vertex-debug] sections, then restart Codex and start a new conversation. "
          : "Copied two Claude Code terminal commands for review and debugger. If already registered, first run claude mcp remove vertex --scope user and claude mcp remove vertex-debug --scope user. ")
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

/* A Tools window showing a diff tells the panel which part and which two
   versions are on screen, but not the lines: the panel's chat has no tool to
   read a diff. So the changed lines are read here, from the window's system,
   and handed over as the selected fragment - the changes with three lines
   around each, capped like any fragment. */
async function withShownDiff(context, state) {
  const view = state && state.vertex_view;
  if (!view || (state.selected_fragment && state.selected_fragment.text)) { return state; }
  // A review's object is read the same way: the saved review of that object in the request, its blocks marked.
  const reviewing = view.view === "review_object" && !!view.review_object;
  if (!reviewing && (view.view !== "diff" || !view.part || !view.version)) { return state; }
  const route = reviewing ? SERVICES.versions.review([view.name, "", view.review_object, view.review_type])
    : SERVICES.versions.load([view.name, view.type, view.part, view.part_type, view.compared_with || "", view.version, "I"]);
  const raw = await pinTo(state.system, () => fetch(context, route));
  if (typeof raw !== "string" || raw.indexOf("ERROR:") === 0) {
    throw new Error("VERTEX could not read the diff shown in the Tools window: " + String(raw).substring(6));
  }
  const data = JSON.parse(raw);
  const ops = data.ops || [];
  const near = new Array(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.op === "=") { return; }
    for (let k = Math.max(0, i - 3); k <= Math.min(ops.length - 1, i + 3); k++) { near[k] = true; }
  });
  const lines = [], opens = {};
  (data.blocks || []).forEach(b => { if (b.op_from > 0) { opens[b.op_from - 1] = b; } });
  const verdict = b => b.action === "A" ? "approved" : b.action === "D" ? "declined" : "open";
  ops.forEach((o, i) => {
    if (opens[i]) { const b = opens[i]; lines.push("#" + b.hunk_no + " " + b.change_kind + ", " + b.change_count + " lines, line " + b.start_line
      + ", " + (b.author_name || b.author) + ", " + verdict(b)); }
    if (near[i]) { lines.push((o.op === "=" ? " " : o.op) + " " + o.text); }
    else if (lines[lines.length - 1] !== "...") { lines.push("..."); }
  });
  if (!lines.length) { return state; }
  if (reviewing) {
    return { ...state, selected_fragment: { view, text: "Review of " + view.review_object.trim() + " (" + (view.review_type || "")
      + ") in request " + view.name + ", versions " + (data.versno_old || "nothing") + " to " + data.versno_new
      + " ('-' removed, '+' added, #n a review block):\n" + lines.join("\n") } };
  }
  return { ...state, selected_fragment: { view,
    text: "Diff of " + view.part.trim() + " from " + (view.compared_with || "nothing") + " to " + view.version
          + " ('-' removed, '+' added):\n" + lines.join("\n") } };
}

function connectionKey(system) {
  return require("./auth/systems").connectionKey(system);
}

/* The debugger an assistant drives through /debug: one per window, on the
   active system, with the password VS Code keeps. The listener runs on a
   stateless session; each stopped program gets a stateful one of its own. */
function debuggerFor(context, auth) {
  const crypto = require("crypto");
  let connected = null;
  let id = context.globalState.get("vertex.debug.ideId");
  if (!id) {
    id = crypto.randomBytes(16).toString("hex").toUpperCase();
    context.globalState.update("vertex.debug.ideId", id);
  }
  const dbg = require("./debugger").create({
    assistantRecording: require("./assistant-debug-recording").create({
      enabled: () => { const config = vscode.workspace.getConfiguration("vertex.ai");
        return !!config.get("logPath", "") && config.get("log.tools", false); },
      folder: () => String(vscode.workspace.getConfiguration("vertex").get("debug.runPath", "") || "").trim()
        || path.join(context.globalStorageUri.fsPath, "sap-debug-runs")
    }),
    ideId: id,
    terminalId: id,
    openUrl: url => vscode.env.openExternal(vscode.Uri.parse(url)),
    // Which system is active now: a window's own, a chat's named one, or vertex.active.
    current: () => {
      const chosen = active();
      if (chosen.error) { return ""; }
      if (connected && connected.key === connectionKey(chosen.system)) { connected.system = chosen.system; }
      return connectionKey(chosen.system);
    },
    explain: error => auth.explain(connected ? connected.system : active().system, error),
    connect: async function () {
      const chosen = active();
      if (chosen.error) { throw new Error(chosen.error); }
      const system = chosen.system;
      const listener = await auth.makeClient(system, "listener");
      // The listener spends its life in a long poll, so the dump feed gets a
      // stateless session of its own rather than queueing behind it.
      let probe;
      try { probe = await auth.makeClient(system, "probe"); }
      catch (error) { await listener.dispose().catch(() => {}); throw error; }
      connected = {
        key: connectionKey(system), system, user: String(system.user).toUpperCase(), listener, probe,
        open: async function () {
          const client = await auth.makeClient(system, "debuggee");
          client.stateful = "stateful";
          try { await client.login(); }
          catch (error) { await client.dispose().catch(() => {}); throw error; }
          return client;
        }
      };
      return connected;
    }
  });
  // A closed window must not leave breakpoints and a listener behind on SAP.
  let stopping = null;
  const stop = () => stopping || (stopping = dbg.stop());
  stopDebugger = stop;
  context.subscriptions.push({ dispose: () => { stop().catch(() => {}); } });
  return dbg;
}

/* The source tools with the debugger's added: the schemas and the method the
   chat is told, and a call that sends debug_* to the debugger. The Anthropic
   API path calls execute directly, so it gets the answer as text. */
const TRANSPILER_AGENT_INSTRUCTIONS = "A request such as 'find the bug in the debugger' does not choose the SAP runtime. When execution or debugging is needed and the user has not specified a mode, use run_abap_transpiler first for a runnable report or method. It is a simulation, not proof of behavior in SAP. Use screen_only to inspect selection fields and ask for missing values. When the question concerns several scenarios or selections and no run of this request covers one of them, run it with run_abap_transpiler yourself instead of asking; a run shown in VERTEX Smart Debugger or in an earlier answer covers only the selection it ran with. The result's run_id permits paged read_abap_transpiler_history and virtual line breakpoints or variable watchpoints with find_abap_transpiler_stops. A SAP VERTEX Smart Debugger recording shown in the open window has a session_id from its first recorded step, whether or not it was saved; cite its recorded evidence as [session <first 8 characters of session_id> step <n>]. A session citation opens the live recording at the cited step, or its saved file later. Do not claim that a SAP recording lacks an ID when the open VERTEX Smart Debugger context supplies session_id. When VERTEX Smart Debugger context includes `transpiler_run`, cite that displayed run with [run <first 8 characters of run_id> step <n>]; the citation opens its saved trace. Do not reason from source code about what a run did. When the user asks to compare runs, explain a result or find a cause, call find_abap_transpiler_stops or read_abap_transpiler_history on the relevant run_ids before answering; finishing without those calls is not an answer to such a request. Every claim about values, control flow, a cause or a missing check must cite the run/session ID and the step, line and value that show it. If the history cannot be read, list what the available record shows, mark the rest as not verified and say why. Never reply with only a status line: report the results you have. Cite transpiler evidence as [run <first 8 characters of run_id> step <n>] and SAP recording evidence as [session <first 8 characters of session_id> step <n>], exactly in this form and in English whatever the reply language, one citation per run/session and step; VERTEX makes known citations clickable in its chat. For a local hypothesis, rerun with interventions at an executable ABAP line and occurrence; compare the original and modified runs using their histories. The history returns changes by default, and each applied intervention records its before and after values. Use include_state only when the full variable state is needed. Cite known runs by their run number in other text; the evidence citation remains clickable. Use transpiler output and history first; if a specific class method's source is needed, use read_sap_method before reading the whole object. If the transpiler cannot run the case, explain why and ask whether the user wants a SAP run; never silently switch modes. If the user explicitly requests a SAP run, use the SAP debugger tools.";

function withDebugger(sapCode, debugTools, runTranspiler, transpilerHistory) {
  // Getters, read when asked - as the source tools' own text is: it names the
  // systems configured at the time. Object.assign would read them now.
  return Object.create(sapCode, {
    schemas: { get: () => sapCode.schemas.concat(debugTools.tools, require("./transpiler-tool").schema,
      require("./transpiler-history").schema, require("./transpiler-history").findSchema) },
    instructions: { get: () => sapCode.instructions + "\n\n" + debugTools.instructions
      + "\n\n" + TRANSPILER_AGENT_INSTRUCTIONS },
    execute: { value: async function (name, args) {
      if (name === "run_abap_transpiler") return runTranspiler(args || {});
      if (name === "read_abap_transpiler_history") return transpilerHistory.read(args);
      if (name === "find_abap_transpiler_stops") return transpilerHistory.find(args);
      if (!/^debug_/.test(name)) { return sapCode.execute(name, args); }
      const answer = await debugTools.call({}, name, args || {});
      if (answer.isError) { throw new Error(answer.content[0].text); }
      if (answer.vertex_recording) return { result: answer.content[0].text, mode: "sap",
        session_id: answer.vertex_recording.id, recorded_steps: answer.vertex_recording.recorded_steps };
      return answer.content[0].text;
    } }
  });
}

function activate(context) {
  auth = require("./auth/clients").createAuth({ vscode, context, logger: outputLogger });
  const sapCode = require("./code-workbench").register(vscode, context, { active, auth, pin: pinTo,
    pinned: () => pinnedSystem.getStore() || "", systems });
  require("./local-navigation").register(vscode, context);
  require("./reach-path").register(vscode, context);
  require("./abap-folding").register(vscode, context);
  frontendAnalysisRequest = sapCode.frontendRequest;
  frontendTableRequest = sapCode.tableRequest;
  frontendTableWrite = sapCode.tableWrite;
  require('./local-run').setSelectorQuery(sapCode.selectorQuery);
  // A first start with no system: offered once per start, never imported without the reader's click.
  const listed = vscode.workspace.getConfiguration("vertex").get("systems");
  if (Array.isArray(listed) && !listed.some(function (s) { return s && s.name; })) {
    vscode.window.showInformationMessage("VERTEX: no SAP system is configured. Import them from SAP Logon and Eclipse?",
      "Import SAP Systems", "Settings").then(function (answer) {
        if (answer === "Import SAP Systems") { vscode.commands.executeCommand("vertex.importSystems"); }
        if (answer === "Settings") { vscode.commands.executeCommand("workbench.action.openSettings", "vertex.systems"); }
      });
  }
  // The panel's chat debugs too: its assistant gets the debugger tools beside
  // the source tools, on the same /chat address, with nothing to register.
  // VERTEX Smart Debugger in the Tools window draws this same debugger.
  const dbg = debuggerFor(context, auth);
  sapCode.attachDebugger(dbg);
  const debugTools = mcp.debugSet(dbg);
  const transpilerRunFolder = () => String(vscode.workspace.getConfiguration("vertex").get("transpiler.runPath", "") || "").trim()
    || (context.globalStorageUri?.fsPath ? path.join(context.globalStorageUri.fsPath, "transpiler-runs") : "");
  const transpilerHistory = require("./transpiler-history").create(transpilerRunFolder);
  const rememberTranspilerRun = (source, result) => {
    const records = result && (result.records || result.trace) || [];
    if (!records.length) return null;
    const main = result.url || source && source.document && source.document.uri && source.document.uri.fsPath;
    if (!main) return null;
    const run_id = transpilerHistory.save(records, { object_name: source.object_name, object_type: source.object_type,
      system: source.system_name || "local" }, { output: result.output || "", main });
    source.transpilerRun = { run_id, recorded_steps: records.length };
    return source.transpilerRun;
  };
  const agentSourceQueue = require("./transpiler-tool").createRunQueue();
  const agentBuilds = new Map();
  const chatTools = withDebugger(sapCode, debugTools, async args => {
    const request = require("./transpiler-tool").validate(args);
    const own = pinnedSystem.getStore() || "";
    const activeSystem = active();
    const selected = String(args.system || own || (activeSystem.error ? "" : activeSystem.system.name)).trim();
    const configured = systems().find(item => item.name.toUpperCase() === selected.toUpperCase());
    if (!configured) throw new Error("Select a configured SAP system before running the transpiler.");
    if (own && own !== configured.name) throw new Error("This VERTEX window works with " + own + " only.");
    return runSapTranspiler({ ...request, system_name: configured.name },
      { agentRun: true, screenOnly: args.screen_only === true, entryLine: request.entryLine,
        selection: request.selection, interventions: request.interventions, history: transpilerHistory });
  }, transpilerHistory);
  const toolsContextState = require("./tools-context-state").create();
  // What the VERTEX Smart Debugger panel shows - the record, and the flow of the analysis - for the chat to be given with a question.
  let latestDebugContext = null;
  // What VERTEX Smart Debugger shows, for the chat: a kept run says so, so it is not taken for a run of this request.
  const debugContextForChat = () => {
    const kept = dockedDebugSource?.storedRun;
    const savedRecord = dockedDebugSource?.storedDebugRecord;
    let context = latestDebugContext;
    if (kept && context) context = { ...context, kept_run: { run_id: kept.run_id, run_number: transpilerHistory.number(kept.run_id),
      note: "VERTEX Smart Debugger shows a kept transpiler run opened for viewing. It covers only the selection it ran with; run other cases with run_abap_transpiler." } };
    const liveRun = dockedDebugSource?.transpilerRun;
    if (liveRun && context) context = { ...context, transpiler_run: { run_id: liveRun.run_id,
      run_number: transpilerHistory.number(liveRun.run_id), recorded_steps: liveRun.recorded_steps,
      note: "VERTEX Smart Debugger shows this transpiler run. Cite its recorded evidence as [run <first 8 characters of run_id> step <n>]." } };
    if (savedRecord && context) context = { ...context, saved_session: { session_id: savedRecord.session_id,
      note: "VERTEX Smart Debugger shows this saved SAP debugger recording offline. Cite recorded steps with [session <first 8 characters of session_id> step <n>]." } };
    return context;
  };
  const port = vscode.workspace.getConfiguration("vertex").get("mcp.port", 37777);
  const chatSet = {
      instructions: chatTools.instructions,
      tools: chatTools.schemas.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      })),
    call: async function (deps, name, args) {
      const config = vscode.workspace.getConfiguration("vertex.ai");
      const provider = config.get("provider", "codex-subscription") === "claude-subscription" ? "claude" : "codex";
      const sessionLog = require("./session-log");
      return sessionLog.tools(sessionLog.current(config.get("logPath", ""), provider, sessionLog.fromConfig(config)),
        async function (_deps, toolName, toolArgs) {
          if (/^debug_/.test(toolName)) { return debugTools.call(_deps, toolName, toolArgs); }
          const result = await chatTools.execute(toolName, toolArgs);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        })(deps, name, args);
    }
  };
  const transpilerSchemas = [require("./transpiler-tool").schema, require("./transpiler-history").schema,
    require("./transpiler-history").findSchema];
  const agentDebugSet = {
    tools: debugTools.tools.concat(transpilerSchemas),
    instructions: debugTools.instructions + "\n\n" + TRANSPILER_AGENT_INSTRUCTIONS,
    call: async (deps, name, args) => {
      if (!transpilerSchemas.some(tool => tool.name === name)) return debugTools.call(deps, name, args);
      try { return { content: [{ type: "text", text: JSON.stringify(await chatTools.execute(name, args || {})) }] }; }
      catch (error) { return { isError: true, content: [{ type: "text", text: error.message }] }; }
    }
  };
  tools = mcp.create({ fetch: fetch, context: context, port: port,
    pin: pinTo, pinned: () => pinnedSystem.getStore() || "",
    pages: Object.assign(windowTools(), { "/chat": chatSet, "/debug": agentDebugSet }) });
  const showTools = (initial, embeddedPanel) => initial && initial.systemName
    ? pinTo(initial.systemName, () => openTools(initial, embeddedPanel)) : openTools(initial, embeddedPanel);
  const openTools = (initial, embeddedPanel) => require("./tools-window").open(vscode, context,
    { panel: embeddedPanel, pages: PAGES, fetch, asset, active, pin: pinTo, models: args => assistantModels(context, args),
      originPoints: args => sapCode.originPoints(args),
      openToolSource: args => sapCode.openToolSource(args),
      documentObject: document => sapCode.documentObject(document),
      setContext: (panel, value) => toolsContextState.update(panel, value),
      debugger: dbg,
      chat: () => require("./chat").create(vscode, chatTools, tools, context.secrets, debugContextForChat, () => require("./value-origin-view").originContext()) }, initial);
  // The normal source tab remains the sole code editor.  The debugger is a
  // docked panel, not another editor tab showing a second copy of that source.
  let dockedDebugView = null, dockedDebugSource = null, localDebugAdapter = null, sapDebugRunsPanel = null;
  const localHistoryMark = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.stackFrameHighlightBackground"),
    overviewRulerColor: new vscode.ThemeColor("editor.stackFrameHighlightBackground"),
    overviewRulerLane: vscode.OverviewRulerLane?.Full,
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, "images", "stopped.svg"),
    gutterIconSize: "contain"
  });
  context.subscriptions.push(localHistoryMark);
  let localHistoryEditor = null;
  let localRevealSequence = 0;
  let localRevealQueue = Promise.resolve();
  const clearLocalHistoryMark = () => {
    if (localHistoryEditor) localHistoryEditor.setDecorations(localHistoryMark, []);
    localHistoryEditor = null;
  };
  const localEntry = source => {
    try { return require("./local-run").entryScreen(source.document, source.entryLine); }
    catch (error) { return { error: error.message }; }
  };
  const dockedDebugInitial = () => !dockedDebugSource ? null : {
    name: dockedDebugSource.object_name,
    program: dockedDebugSource.program || "",
    type: dockedDebugSource.object_type,
    // A system reached through SAP's ADT extension has no ADT debugger here: the panel offers no SAP run, steps or session.
    line: dockedDebugSource.cursorLine || null,
    local: dockedDebugSource.local === true,
    // Opened to run, not to analyse: until a breakpoint is set the panel is the selection screen and the output.
    runOnly: dockedDebugSource.local === true && dockedDebugSource.runOnly === true,
    // Opened by the Run command, not by Clear: the program runs at once.
    autoRun: dockedDebugSource.local === true && dockedDebugSource.autoRun === true && !localDebugAdapter?.hasTrace(),
    // A run of the program window: VERTEX Smart Debugger offers the way back to it.
    programWindow: dockedDebugSource.local === true && require("./program-window").isOpen(),
    // An SAP object's run: when its build was read, for Recompile.
    sapBuild: dockedDebugSource.sapCopies ? { name: dockedDebugSource.sapCopies.root?.object_name || "", builtAt: dockedDebugSource.sapCopies.builtAt || "" } : null,
    // Opened again while its run is alive: the page takes the run's record instead of starting one.
    restore: dockedDebugSource.local === true && !!localDebugAdapter?.hasTrace(),
    scenarios: dockedDebugSource.local ? require("./local-run").scenariosFor(dockedDebugSource.document) : [],
    // A method or function module under the cursor: the screen of its parameters, or why it cannot be called.
    entry: dockedDebugSource.local ? localEntry(dockedDebugSource) : null,
    parameters: dockedDebugSource.local ? require("./local-run").parametersFor(dockedDebugSource.document) : [],
    // The whole selection screen with its texts, which the panel draws.
    screen: dockedDebugSource.local ? require("./local-run").screenFor(dockedDebugSource.document) : null,
    savedRecord: dockedDebugSource.storedDebugRecord || null,
    replayStep: dockedDebugSource.replayStep || null
  };
  // A transpiler run of an SAP program works on copies of its sources; the reader works in the SAP tabs. These turn one
  // into the other: a copy's path and its tab's address. A local file is its own path.
  const sapCopy = (by, value) => (dockedDebugSource?.sapCopies?.copies || []).find(copy =>
    by === "uri" ? copy.uri === value : copy.path.toLowerCase() === String(value || "").toLowerCase());
  const runPathOf = uri => uri?.scheme === "file" ? uri.fsPath : sapCopy("uri", uri?.toString())?.path || null;
  const runUriOf = file => { const copy = sapCopy("path", file); return copy ? vscode.Uri.parse(copy.uri) : vscode.Uri.file(file); };
  const runDocument = async file => {
    const copy = sapCopy("path", file);
    return copy ? pinTo(dockedDebugSource.sapCopies.system, () => sapCode.sourceOf(copy.object))
      : vscode.workspace.openTextDocument(vscode.Uri.file(file));
  };
  // Where a run's source is shown: the column it is already open in, else beside the program window rather than over
  // it, so the window's list stays in sight while the flow is followed.
  const runColumn = document => {
    const open = (vscode.window.visibleTextEditors || []).find(item => item.document.uri.toString() === document.uri.toString());
    if (open) return open.viewColumn;
    const program = require("./program-window").column();
    return program !== undefined && program === vscode.window.tabGroups?.activeTabGroup?.viewColumn ? vscode.ViewColumn.Beside : undefined;
  };
  const postDockedPicture = () => {
    if (dockedDebugSource?.storedDebugRecord) return;
    if (dockedDebugSource?.local && localDebugAdapter) {
      const frame = localDebugAdapter.picture().stopped?.frames?.[0];
      const editor = (vscode.window.visibleTextEditors || []).find(item =>
        frame && runPathOf(item.document.uri)?.toLowerCase() === String(frame.url || "").toLowerCase());
      if (localHistoryEditor && localHistoryEditor !== editor) clearLocalHistoryMark();
      if (editor && frame?.line > 0 && frame.line <= editor.document.lineCount) {
        editor.setDecorations(localHistoryMark, [editor.document.lineAt(frame.line - 1).range]);
        localHistoryEditor = editor;
      } else if (!frame) clearLocalHistoryMark();
    }
    if (dockedDebugView) void dockedDebugView.webview.postMessage({ type: "debug",
      payload: JSON.stringify(dockedDebugSource?.local ? localDebugAdapter?.picture() : dbg.picture()) });
  };
  let latestLocalVariables = null;
  // Each load of the panel's page has its number. The page asks one thing at a time and takes the answers in order, so
  // an answer to the page before - a request still running when the page was written again - must not reach the new
  // one: it would stand in the place of the new page's first answer, and every answer after it would be one off.
  let dockedGeneration = 0;
  const setDockedHtml = html => { dockedGeneration++; dockedDebugView.webview.html = html; };
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("vertex.visualDebug", {
    async resolveWebviewView(view) {
      // VS Code restores the view, but extension-host objects do not survive Reload Window.
      // Rebuild the adapter before giving the page its initial state; never execute on restore.
      if (!dockedDebugSource) {
        try {
          const source = await require("./debug-panel-state").restore(
            context.workspaceState.get("vertex.debug.panelSource"), vscode.workspace, vscode.Uri);
          if (source) await openVisualDebug(false, source, true);
        } catch (error) {
          void context.workspaceState.update("vertex.debug.panelSource", undefined);
          vscode.window.showWarningMessage("VERTEX: could not restore the debugger source: " + error.message
            + ". Open an ABAP source and choose VERTEX Smart Debugger to reconnect this panel.");
        }
      }
      dockedDebugView = view;
      view.webview.options = { enableScripts: true };
      dockedGeneration++;
      view.webview.html = require("./tools-window").debugHtml(dockedDebugInitial());
      if (dockedDebugSource?.local && latestLocalVariables) {
        setTimeout(() => void view.webview.postMessage({ type: "localVariables", state: latestLocalVariables }), 150);
      }
      let logicReceive=null,logicDisposers=[];
      const unwatch = dockedDebugSource?.storedDebugRecord ? () => {} : dbg.watch(postDockedPicture);
      // The reader's place in a VERTEX source, for the variables it shows before the program runs: the object and the line the
      // cursor is on, whichever VERTEX tab is in front. A change is sent once the cursor has rested a moment.
      let cursorTimer;
      const sendCursor = () => {
        if (dockedDebugSource?.storedDebugRecord) return;
        const editor = vscode.window.activeTextEditor, object = editor && (dockedDebugSource?.local
          ? require("./local-analysis").sourceObject(editor.document) : sapCode.documentObject(editor.document));
        if (!object) { return; }
        view.webview.postMessage({ type: "cursor", payload: JSON.stringify({ ...object, line: editor.selection.active.line + 1 }) });
      };
      const watchCursor = () => { clearTimeout(cursorTimer); cursorTimer = setTimeout(sendCursor, 150); };
      const cursorWatchers = [vscode.window.onDidChangeTextEditorSelection(watchCursor), vscode.window.onDidChangeActiveTextEditor(watchCursor)];
      setTimeout(sendCursor, 400);
      view.onDidDispose(() => { clearTimeout(cursorTimer); cursorWatchers.forEach(watcher => watcher.dispose()); });
      const receive = view.webview.onDidReceiveMessage(async message => {
        // The answer goes to the page that asked, not to one written since.
        const asked = dockedGeneration;
        const replyTo = payload => asked === dockedGeneration ? view.webview.postMessage({ type: "result", payload }) : undefined;
        try {
          if (message.call === "localPanelReady") {
            if (latestLocalVariables && dockedDebugSource?.local) {
              await view.webview.postMessage({ type: "localVariables", state: latestLocalVariables });
            }
            return;
          }
          if (message.call === "localRun") {
            if (!dockedDebugSource?.local) throw new Error("Open a local ABAP file in VERTEX Smart Debugger first.");
            clearLocalHistoryMark();
            latestLocalVariables = null;
            await require("./local-run").launch(vscode, true, {
              document: dockedDebugSource.document, selection: message.selection || {}
            });
            await view.webview.postMessage({ type: "localRunResult", message: "Debug session started. Breakpoints and variables are in the VS Code Debug view." });
            return;
          }
          if (message.call === "localStep") {
            clearLocalHistoryMark();
            const command = { into: "workbench.action.debug.stepInto", over: "workbench.action.debug.stepOver",
              out: "workbench.action.debug.stepOut", continue: "workbench.action.debug.continue",
              stop: "workbench.action.debug.stop" }[message.kind];
            if (!command) throw new Error("Unknown local debug action.");
            await vscode.commands.executeCommand(command);
            return;
          }
          if (message.call === "copyLocalVariables") {
            const state = latestLocalVariables || { frame: "", variables: [] };
            const lines = [state.frame || "", ...(state.variables || []).map(variable =>
              variable.name + " = " + String(variable.value ?? ""))].filter(Boolean);
            await vscode.env.clipboard.writeText(lines.join("\n"));
            return;
          }
          if(message.call==="inlineLogic"){if(logicReceive)await logicReceive(message.payload);return;}
          if (message.call === "source") {
            const args = message.args || [];
            const type = String(args[1] || "").toUpperCase();
            if (!["PROG", "CLAS", "FUNC"].includes(type)) { throw new Error("Unsupported source type."); }
            const source = await pinTo(dockedDebugSource && dockedDebugSource.system_name, () =>
              sapCode.execute("read_sap_object", { object_name: String(args[0] || ""), object_type: type }));
            await replyTo(JSON.stringify(source));
            return;
          }
          if (message.call === "asset") {
            const name = String((message.args || [])[0] || "");
            await replyTo(asset(name));
            return;
          }
          if (message.call === "origin") {
            // Where the chosen value can be changed, from the same analysis the
            // editor command runs. The window turns these into breakpoints. It takes
            // seconds and answers on a channel of its own, by the number of the request,
            // so that it runs beside the debugger instead of holding its queue - an
            // error included: it is the analysis's, not the next debugger answer's.
            const request = JSON.parse(String((message.args || [])[0] || "{}"));
            let reply;
            try { reply = { id: request.id, answer: request.pathFormula ? sapCode.originPath(request.pathFormula)
              : request.recordFormula ? require("./record-formula").build(request.recordFormula)
              : dockedDebugSource?.local && request.variables
              ? await require("./local-analysis").declaredVariables(dockedDebugSource.document, request.variables, vscode)
              : request.open ? await sapCode.originOpen(request.open) : request.variables ? await sapCode.originVariables(request.variables) : await sapCode.originPoints(request,progress=>view.webview.postMessage({type:"originProgress",payload:{id:request.id,...progress}}),dockedDebugSource?.local?dockedDebugSource.document:null) }; }
            catch (error) { reply = { id: request.id, error: error.message }; }
            await view.webview.postMessage({ type: "origin", payload: JSON.stringify(reply) });
            return;
          }
          if (message.call === "debugProgram") {
            const program = String(message.program || "").trim();
            if (!dockedDebugSource && program) dockedDebugSource = {
              object_name: program, object_type: "PROG", system_name: active().system?.name
            };
            if (dockedDebugSource) {
              dockedDebugSource.program = program;
              void context.workspaceState.update("vertex.debug.panelSource", require("./debug-panel-state").capture(dockedDebugSource));
            }
            return;
          }
          if (message.call === "debugContext") {
            try { latestDebugContext = JSON.parse(String((message.args || [])[0] || "null")); } catch (error) { latestDebugContext = null; }
            return;
          }
          if (message.call === "clear") {
            // Clear: the panel starts again for its object, as a new open does; breakpoints and a SAP session stay.
            if (dockedDebugSource) openVisualDebug(dockedDebugSource.runOnly === true, { ...dockedDebugSource, autoRun: false });
            return;
          }
          if (message.call === "backward") {
            // Where used from a breakpoint: Backward Usage Analysis from the point's line, of the value chosen in Variables
            // wherever it is named, else of the routine there.
            const point = JSON.parse(String((message.args || [])[0] || "{}"));
            let editor = null;
            if (dockedDebugSource?.local) {
              const shown = await runDocument(String(point.url || ""));
              editor = await vscode.window.showTextDocument(shown, { preview: false, viewColumn: runColumn(shown) });
            } else {
              await sapCode.revealFrame(point);
              const name = String(point.program || "").toLowerCase();
              editor = (vscode.window.visibleTextEditors || []).find(item => name && item.document.uri.toString().toLowerCase().includes(name)) || vscode.window.activeTextEditor;
              if (editor) editor = await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preview: false });
            }
            if (!editor) throw new Error("The source of " + point.program + " is not open.");
            const line = Math.max(0, Math.min(editor.document.lineCount - 1, Number(point.line || 1) - 1));
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            await vscode.commands.executeCommand("vertex.backwardUsage", { variable: point.variable || "" });
            return;
          }
          if (message.call === "reveal") {
            // The player walked to a recorded stop. In this panel the source is
            // the editor's, so that is what has to move.
            const frame = JSON.parse(String((message.args || [])[0] || "{}"));
            if (dockedDebugSource?.local) {
              const revealSequence = ++localRevealSequence;
              const source = String(frame.url || "");
              if (source && /\.abap$/i.test(source)) {
                // VS Code may finish opening an earlier step after a newer one.
                // Serialize editor changes, then skip any step the player left.
                localRevealQueue = localRevealQueue.catch(() => {}).then(async () => {
                  if (revealSequence !== localRevealSequence) return;
                  const document = await runDocument(source);
                  if (revealSequence !== localRevealSequence) return;
                  const line = Math.max(0, Math.min(document.lineCount - 1, Number(frame.line || 1) - 1));
                  const editor = await vscode.window.showTextDocument(document, { preserveFocus: true, preview: true, viewColumn: runColumn(document) });
                  if (revealSequence !== localRevealSequence) return;
                  const position = new vscode.Position(line, 0);
                  if (localHistoryEditor && localHistoryEditor !== editor) clearLocalHistoryMark();
                  editor.setDecorations(localHistoryMark, [document.lineAt(line).range]);
                  localHistoryEditor = editor;
                  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                });
                await localRevealQueue;
              }
            } else {
              await sapCode.revealFrame(frame);
            }
            return;
          }
          if (message.call === "debug" && (message.args || [])[0] === "copy") {
            // The step log to the clipboard, through VS Code rather than the page.
            await vscode.env.clipboard.writeText(String(JSON.parse((message.args || [])[1] || "{}").text || ""));
            await replyTo("{}");
            return;
          }
          if (message.call !== "debug") { throw new Error("Unsupported VERTEX Debug request."); }
          // The docked panel is opened from an ABAP editor and has no source
          // pane of its own: the stop is followed in that editor.
          if (typeof dbg.drivenBy === "function") { dbg.drivenBy("editor"); }
          const args = message.args || [];
          const command = String(args[0] || "");
          const commandArgs = JSON.parse(String(args[1] || "{}"));
          if (command === "saveRecord") {
            const folder = String(vscode.workspace.getConfiguration("vertex").get("debug.runPath", "") || "").trim()
              || path.join(context.globalStorageUri.fsPath, "sap-debug-runs");
            fs.mkdirSync(folder, { recursive: true });
            const safeName = String(commandArgs.meta?.name || "SAP").replace(/[^A-Za-z0-9_-]/g, "_");
            const now = new Date(), pad = value => String(value).padStart(2, "0");
            const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "_" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
            const file = path.join(folder, stamp + "_" + safeName + ".vertex-debug.json");
            require("./sap-debug-history").save(file, commandArgs);
            await replyTo(JSON.stringify({ path: file }));
            return;
          }
          if (command === "openRuns") {
            await vscode.commands.executeCommand("vertex.openSapDebugRuns");
            await replyTo("{}");
            return;
          }
          // Recompile: the SAP object of this run read and transpiled again, and the panel opened on that build.
          if (command === "sapRecompile") { await recompileSap(); return; }
          if (command === "toProgram") {
            // An SAP object's build whose window is gone (closed, or a Reload Window) gets it again on that build: nothing is read from SAP.
            const sap = dockedDebugSource?.sapCopies;
            if (!require("./program-window").reveal()) {
              if (!sap?.root) throw new Error("The program window is closed: Run with ABAP Transpiler opens it again.");
              await runSapTranspiler(sap.root, { entryLine: sap.root.object_type === "PROG" ? 0 : sap.entryLine });
            }
            await replyTo("{}");
            return;
          }
          if (dockedDebugSource?.local && localDebugAdapter) {
            if (["run", "step", "stop", "detach", "terminate"].includes(command)) clearLocalHistoryMark();
            if (command === "run") { dockedDebugSource.transpilerRun = null; latestDebugContext = null; }
            const answer = await localDebugAdapter.command(command, commandArgs);
            if (command === "run") rememberTranspilerRun(dockedDebugSource, answer);
            // The program is over: no line of it is running, so the editor shows none.
            if (["run", "step"].includes(command) && answer && answer.ended) clearLocalHistoryMark();
            if (["run", "stop", "detach", "terminate"].includes(command))
              await vscode.commands.executeCommand("setContext", "vertex.localHistory", localDebugAdapter.hasTrace());
            await replyTo(JSON.stringify(answer));
            return;
          }
          // The SAP program run with the ABAP transpiler: its sources are read into a folder of their own, and the panel
          // turns to the transpiler's, on the program written there.
          if (command === "sapTranspile") {
            await replyTo("{}");
            // The page has its answer already; a failure after it is sent to the page too, where it stays.
            try { await runSapTranspiler(dockedDebugSource); }
            catch (error) { void view.webview.postMessage({ type: "runFailed", payload: error && error.message || String(error) }); throw error; }
            return;
          }
          if(command==="logicTools"){
            logicDisposers.splice(0).forEach(dispose=>dispose());logicReceive=null;
            const embedded={title:"Logic",webview:{
              set html(value){void view.webview.postMessage({type:"inlineLogicHtml",payload:value});},
              postMessage:payload=>view.webview.postMessage({type:"inlineLogicReply",payload}),
              onDidReceiveMessage:handler=>{logicReceive=handler;return {dispose(){logicReceive=null;}};}
            },onDidDispose:handler=>{logicDisposers.push(handler);return {dispose(){}};}};
            const editor=vscode.window.activeTextEditor,editorObject=editor&&sapCode.documentObject(editor.document);
            const selected=editorObject?{name:editorObject.object_name,type:editorObject.object_type,cursorLine:editor.selection.active.line+1}:commandArgs;
            await showTools({...selected,action:"scheme",boundObject:true},embedded);
            await view.webview.postMessage({type:"result",payload:"{}"});return;
          }
          const handled = Date.now();
          const answer = await pinTo(dockedDebugSource && dockedDebugSource.system_name, () =>
            require("./tools-window").debugCommand(dbg, command, commandArgs,
              resource => fetch(context, resource)));
          // How long the host held a step, for the window's time per stage.
          if (command === "step" && answer && typeof answer === "object") { answer.handler = Date.now() - handled; }
          await replyTo(JSON.stringify(answer));
        } catch (error) {
          if (message.call === "localRun") {
            await view.webview.postMessage({ type: "localRunResult", error: error.message });
            return;
          }
          // Only a request the page waits on is answered: an answer to one it does not wait on (reveal, backward, clear...)
          // would be taken for the answer to its next request, and every answer after it would be one off.
          if (["debug", "source", "asset"].includes(message.call)) await replyTo("ERROR:" + error.message);
          else vscode.window.showErrorMessage("VERTEX Smart Debugger: " + error.message);
        }
      });
      view.onDidDispose(() => {
        if (dockedDebugView === view) { dockedDebugView = null; }
        logicDisposers.splice(0).forEach(dispose=>dispose());
        unwatch(); receive.dispose();
      });
      postDockedPicture();
    }
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  require("./local-debug-vars").register(vscode, context, state => {
    // A recorded transpiler run owns its variables. A native Node debug session that is still open must not
    // replace its stop, structure values, or error with a separate debugger's state.
    if (dockedDebugSource?.local && localDebugAdapter?.hasTrace()) return;
    latestLocalVariables = state;
    if (dockedDebugSource?.local && localDebugAdapter) localDebugAdapter.update(state);
    if (dockedDebugView && dockedDebugSource?.local) {
      void dockedDebugView.webview.postMessage({ type: "localVariables", state });
    }
  }, () => !!dockedDebugSource?.local);
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(() => {
    if (dockedDebugSource?.local && localDebugAdapter) localDebugAdapter.finish();
    void vscode.commands.executeCommand("setContext", "vertex.localHistory", false);
  }));
  // In the transpiler panel the breakpoints are VS Code's own: a point set or removed in the editor is shown at once.
  context.subscriptions.push(vscode.debug.onDidChangeBreakpoints(() => { if (dockedDebugSource?.local && localDebugAdapter) postDockedPicture(); }));
  const openVisualDebug = async (runOnly = false, again = null, restoring = false) => {
    void vscode.commands.executeCommand("setContext", "vertex.localHistory", false);
    const editor = vscode.window.activeTextEditor;
    const local = require("./local-analysis");
    const localObject = local.isLocalAbap(editor?.document) ? local.sourceObject(editor.document) : null;
    // Clear starts the same panel again, for the object it shows, whichever editor is in front.
    const source = again || (localObject ? { ...localObject, local: true, document: editor.document, entryLine: editor.selection.active.line + 1 } : sapCode.editorContext());
    // The line the panel was opened at: its variables are those of the routine there, before the cursor is first reported.
    if (source && !again && editor) { source.cursorLine = editor.selection.active.line + 1; }

    if (!source || !source.object_name) {
      vscode.window.showWarningMessage("VERTEX: open a local or SAP ABAP source tab first.");
      return;
    }
    // A new window starts clean: no record, no paused transpiler run, no analysed path, no values of an earlier
    // Node debug session, no history mark. A live SAP debug session and the breakpoints are the debugger's, and stay.
    localDebugAdapter?.dispose();
    latestLocalVariables = null;
    clearLocalHistoryMark();
    sapCode.forgetOrigin?.();
    dockedDebugSource = { ...source, runOnly: runOnly === true, autoRun: runOnly === true && (!again || again.autoRun === true) };
    delete dockedDebugSource.transpilerRun;
    void context.workspaceState.update("vertex.debug.panelSource", require("./debug-panel-state").capture(dockedDebugSource));
    latestDebugContext = null;
    // A kept transpiler run opens on its record: it is looked at, not run again.
    const stored = source.storedRun;
    localDebugAdapter = source.local ? require("./local-debug-adapter").create(vscode, source.document,
      stored ? () => { throw new Error("This is a kept run of " + source.object_name + ". Run the program from its SAP tab to execute it again."); }
        : selection => require("./local-run").launch(vscode, false, { document: source.document, selection, live: true, entryLine: source.entryLine }),
      postDockedPicture, stored ? () => ({ files: [...new Set(stored.records.map(record => record.file).filter(Boolean))] })
        : () => require("./local-run").runScope(vscode, source.document),
      { entry: () => localEntry(source), variants: context.workspaceState, pathOf: runPathOf, uriOf: runUriOf,
        ...(stored ? { trace: stored } : {}) }) : null;
    if (source.local && latestLocalVariables && dockedDebugView) {
      setTimeout(() => void dockedDebugView?.webview.postMessage({ type: "localVariables", state: latestLocalVariables }), 150);
    }
    // A program run to see what it does opens as SAP GUI shows a report: its own window, screen and list (program-window.js).
    // VERTEX Smart Debugger stays behind it, with the record of each run, until See flow history or a breakpoint brings it up.
    // A method or a function module shows the screen of its parameters there.
    if (runOnly === true && source.local) {
      // The panel only follows the window's runs: no automatic run of its own, no run screen of its own.
      dockedDebugSource.autoRun = false;
      dockedDebugSource.runOnly = false;
      require("./program-window").open(vscode, { name: source.object_name, host: {
        selection: () => localDebugAdapter.command("selection"),
        adapter: (command, args) => localDebugAdapter.command(command, args),
        run: async selection => {
          clearLocalHistoryMark();
          dockedDebugSource.transpilerRun = null;
          latestDebugContext = null;
          const result = await localDebugAdapter.command("run", { selection });
          rememberTranspilerRun(dockedDebugSource, result);
          // VERTEX Smart Debugger follows every run of the window: the run just made, never an earlier one.
          if (!result.ended) await showFlow();
          else refreshFlow();
          return result;
        },
        flow: showFlow,
        recompile: dockedDebugSource.sapCopies?.root ? recompileSap : null,
        autoSelection: source.autoSelection,
        builtAt: dockedDebugSource.sapCopies?.builtAt || "" } });
      // Written after the window opens, so the panel knows the window holds the run (its Run brings the window back).
      if (dockedDebugView) setDockedHtml(require("./tools-window").debugHtml(dockedDebugInitial()) + "<!-- " + Date.now() + " -->");
      return;
    }
    if (dockedDebugView) {
      // A page the same as the one shown is not loaded again by VS Code: the mark of this opening makes it new.
      setDockedHtml(require("./tools-window").debugHtml(dockedDebugInitial()) + "<!-- " + Date.now() + " -->");
      dockedDebugView.show(true);
      postDockedPicture();
    } else if (!restoring) {
      vscode.commands.executeCommand("workbench.view.extension.vertex-debug").catch(error =>
        vscode.window.showErrorMessage("VERTEX: could not open Debug panel: " + error.message));
    }
  };
  // VERTEX Smart Debugger on the record of the program window's runs: the whole panel - the debugger, not the plain run - taking the
  // run as it stands.
  const refreshFlow = () => {
    if (!dockedDebugView || !localDebugAdapter?.hasTrace()) return false;
    if (dockedDebugSource) dockedDebugSource.runOnly = false;
    setDockedHtml(require("./tools-window").debugHtml(dockedDebugInitial()) + "<!-- " + Date.now() + " -->");
    postDockedPicture();
    return true;
  };
  const showFlow = async () => {
    if (!localDebugAdapter?.hasTrace()) throw new Error("No run has been recorded yet.");
    if (refreshFlow()) dockedDebugView.show(true);
    else {
      if (dockedDebugSource) dockedDebugSource.runOnly = false;
      await vscode.commands.executeCommand("workbench.view.extension.vertex-debug");
    }
    return {};
  };
  // Recompile: the SAP object of this run read and transpiled again, and opened on that build.
  const recompileSap = async () => {
    const sap = dockedDebugSource?.sapCopies;
    if (!sap?.root) throw new Error("This run was not read from SAP.");
    localDebugAdapter?.dispose();
    await runSapTranspiler(sap.root, { recompile: true, entryLine: sap.root.object_type === "PROG" ? 0 : sap.entryLine });
    return {};
  };
  // An SAP program run with the ABAP transpiler: its sources are read into a folder of their own, and VERTEX Smart Debugger turns
  // to the transpiler's panel on the program written there, running at once.
  // options.recompile: read the object from SAP again and transpile it, rather than run its last build; options.entryLine:
  // the method's or module's line, as the last run had it, in place of the cursor's.
  const runSapTranspiler = async (shown, options = {}) => {
    const kind = String(shown?.object_type || "").toUpperCase();
    if (!["PROG", "CLAS", "FUNC"].includes(kind)) throw new Error("The transpiler runs an SAP program, a method of an SAP class or a function module; open one first.");
    // A class runs one method: the one the cursor stands in, in the tab of the class's own source.
    let entryLine = 1;
    if (options.entryLine) entryLine = options.entryLine;
    else if (kind === "CLAS") {
      const object = { object_name: shown.object_name, object_type: "CLAS", include: "main" };
      const tab = await pinTo(shown.system_name, () => sapCode.sourceUri(object)), editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.toString() !== tab)
        throw new Error("Put the cursor in a method of " + shown.object_name + ", in the tab of its class source.");
      entryLine = editor.selection.active.line + 1;
    }
    // A function module runs whole: from the cursor in its tab, else from its first line.
    if (kind === "FUNC" && !options.entryLine) {
      const tab = await pinTo(shown.system_name, () => sapCode.sourceUri({ object_name: shown.object_name, object_type: "FUNC", include: "main" }));
      const editor = vscode.window.activeTextEditor;
      entryLine = editor && editor.document.uri.toString() === tab ? editor.selection.active.line + 1 : 1;
    }
    // Opening the run window is a choice of what to do next. SAP is read only
    // after Execute (saved build if possible) or Recompile (fresh read).
    if (!options.agentRun && !options.started && !options.recompile) {
      const previous = dockedDebugSource?.sapCopies?.root?.object_name === shown.object_name
        && dockedDebugSource.sapCopies.root.system_name === shown.system_name ? dockedDebugSource : null;
      require("./program-window").open(vscode, { name: shown.object_name, host: {
        deferred: true, builtAt: previous?.sapCopies?.builtAt || "",
        selection: async () => previous?.document
          ? (kind === "PROG" ? { screen: require("./local-run").screenFor(previous.document) }
            : { entry: require("./local-run").entryScreen(previous.document, previous.entryLine) }) : {},
        adapter: (command, args) => localDebugAdapter?.command(command, args),
        run: async selection => {
          await runSapTranspiler(shown, { ...options, started: true, entryLine, selection });
          return { deferred: true };
        },
        recompile: async () => {
          await runSapTranspiler(shown, { ...options, started: true, recompile: true, entryLine });
          return {};
        } } });
      return;
    }
    // Show the run window before asking SAP for a new build. A failed read or
    // transpilation leaves Recompile available there instead of closing the
    // only route back to the object. Previous compiled parameters can still
    // be shown while the new build is prepared.
    let preparing = true, queuedRecompile = false;
    const previous = dockedDebugSource?.sapCopies?.root?.object_name === shown.object_name
      && dockedDebugSource.sapCopies.root.system_name === shown.system_name ? dockedDebugSource : null;
    const pendingPanel = options.agentRun ? null : require("./program-window").open(vscode, { name: shown.object_name, host: {
      pending: true, builtAt: previous?.sapCopies?.builtAt || "",
      selection: async () => previous?.document
        ? (kind === "PROG" ? { screen: require("./local-run").screenFor(previous.document) }
          : { entry: require("./local-run").entryScreen(previous.document, previous.entryLine) }) : {},
      adapter: (command, args) => localDebugAdapter?.command(command, args),
      run: async () => { throw new Error("Recompile the SAP object before running it."); },
      recompile: async () => {
        if (preparing) {
          queuedRecompile = true;
          void pendingPanel.panel.webview.postMessage({ type: "status", message: "Recompile queued after the current SAP read." });
          return {};
        }
        await runSapTranspiler(shown, { recompile: true, entryLine });
        return {};
      } } });
    const readSources = () => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
      title: "VERTEX: " + (options.recompile ? "recompiling " : "reading ") + shown.object_name + " for the transpiler" },
      report => pinTo(shown.system_name, () => sapCode.transpileSources(shown, name => report.report({ message: name }), { recompile: options.recompile === true,
        // A class's run reads what its method at the cursor reaches; a program and a module start whole.
        entryLine: kind === "CLAS" ? entryLine : 0 })));
    // SAP/cache reads share one system session and one vertex-read.json. Keep
    // that short phase ordered, then transpile/execute independent runs at once.
    const read = await (options.agentRun ? agentSourceQueue(readSources) : readSources()).catch(error => {
      if (queuedRecompile) return null;
      if (pendingPanel) void pendingPanel.panel.webview.postMessage({ type: "status", message: error.message, error: true });
      throw error;
    }).finally(() => { preparing = false; });
    if (queuedRecompile) return runSapTranspiler(shown, { recompile: true, entryLine });
    // The project is written again only when what was read changed; its fingerprint goes with it, for local-run to
    // take the transpiled code again (sap-cache.js).
    const transpile = require("./sap-transpile"), project = path.join(read.folder, "project"),
      stampFile = path.join(project, "vertex-fingerprint.json");
    let stamp = null; try { stamp = JSON.parse(fs.readFileSync(stampFile, "utf8")); } catch (_) { /* none yet */ }
    let file;
    if (read.cached && stamp && stamp.fingerprint === read.fingerprint && stamp.format_compat_version === 1
      && fs.existsSync(stamp.shown)) file = stamp.shown;
    else {
      file = transpile.writeProject(shown.system_name, read.sources, read.dictionary, project);
      fs.writeFileSync(stampFile, JSON.stringify({ fingerprint: read.fingerprint, shown: file, format_compat_version: 1 }));
    }
    // The programs' texts, for the selection screen the panel draws (local-run screenFor).
    fs.writeFileSync(path.join(project, "vertex-texts.json"), JSON.stringify(read.texts || {}));
    // Each copy and the SAP tab it was read from: the run steps, marks and stops in the tab, not in the copy.
    const folder = path.dirname(path.dirname(file)), copies = [];
    for (const source of read.sources) {
      // A function group's module is its FUNC tab; its main program and includes have no VERTEX tab and stay copies.
      if (source.type === "FUGR" && source.kind !== "module") continue;
      const object = source.type === "FUGR" ? { object_name: source.include, object_type: "FUNC", include: "main" }
        : { object_name: source.name, object_type: source.type, include: source.include };
      copies.push({ path: transpile.copyPath(folder, source), object,
        uri: await pinTo(shown.system_name, () => sapCode.sourceUri(object)) });
    }
    const module = kind === "FUNC" && read.sources.find(source => source.kind === "module" && source.include === String(shown.object_name).toUpperCase());
    if (kind === "FUNC" && !module) throw new Error(shown.object_name + " was not among the modules read of its function group.");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(module ? transpile.copyPath(folder, module) : file));
    if (kind === "FUNC") entryLine = Math.max(entryLine, module.signature.firstLine);
    const entry = kind !== "PROG" ? require("./local-run").entryScreen(document, entryLine) : null;
    if (kind !== "PROG" && !entry)
      throw new Error("Line " + entryLine + " of " + shown.object_name + " is in no method: put the cursor in the method to run.");
    if (options.agentRun) {
      const localRun = require("./local-run");
      const screen = kind === "PROG" ? localRun.screenFor(document) : null;
      if (options.screenOnly) return { status: "selection_screen", mode: "transpiler", object_name: shown.object_name,
        selection_screen: entry || require("./transpiler-tool").describeScreen(screen) };
      if (screen) options.selection = require("./transpiler-tool").normalizeSelection(screen, options.selection);
      const missing = require("./transpiler-tool").missingSelection(screen, options.selection || {});
      if (entry?.error) throw new Error(entry.error);
      if (entry) missing.push(...require("./transpiler-tool").missingEntry(entry, options.selection || {}));
      if (missing.length) return { status: "needs_input", mode: "transpiler", object_name: shown.object_name,
        missing, selection_screen: entry || require("./transpiler-tool").describeScreen(screen) };
      const selection = entry ? { ...options.selection, $entry: options.selection?.$entry || { parameters: {}, creation: {} } }
        : options.selection || {};
      const buildKey = project + "|" + read.fingerprint;
      let ready = agentBuilds.get(buildKey), result, privateDocument = null;
      if (!ready) {
        // The first selection prepares one shared build. Its execution can fail
        // while the build is valid; other selections still get that build.
        let resolveBuild, rejectBuild;
        ready = new Promise((resolve, reject) => { resolveBuild = resolve; rejectBuild = reject; });
        ready.catch(() => {});
        agentBuilds.set(buildKey, ready);
        let runError;
        try { result = await localRun.launch(vscode, false, { document, entryLine, selection, interventions: options.interventions, trace: true }); }
        catch (error) { runError = error; }
        try {
          if (!fs.existsSync(path.join(project, "output-pristine")) || !fs.existsSync(path.join(project, "vertex-built.json")))
            throw runError || new Error("The transpiler produced no reusable build.");
          const snapshot = path.join(fs.mkdtempSync(path.join(read.folder, "agent-build-")), "project");
          fs.cpSync(project, snapshot, { recursive: true });
          resolveBuild(snapshot);
        } catch (error) { agentBuilds.delete(buildKey); rejectBuild(error); if (!runError) runError = error; }
        if (runError) throw runError;
      } else {
        // Selection values and trace instrumentation mutate generated JS, so
        // each following run gets a private copy of the compiled project.
        const snapshot = await ready;
        const privateProject = path.join(fs.mkdtempSync(path.join(read.folder, "agent-run-")), "project");
        fs.cpSync(snapshot, privateProject, { recursive: true });
        const privateFile = path.join(privateProject, path.relative(project, document.uri.fsPath));
        privateDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(privateFile));
        result = await localRun.launch(vscode, false, { document: privateDocument, entryLine, selection, interventions: options.interventions, trace: true });
      }
      const run_id = options.history.save(result.records || [], { object_name: shown.object_name,
        object_type: kind, system: shown.system_name },
        { output: result.output, main: (privateDocument || document).uri.fsPath });
      return { status: "completed", mode: "transpiler", object_name: shown.object_name,
        session_id: run_id, run_id, run_number: options.history.number(run_id),
        output: String(result.output || "").slice(0, 12000), output_truncated: String(result.output || "").length > 12000,
        recorded_steps: result.records?.length || 0, duration_ms: result.durationMs || 0,
        interventions: options.interventions?.map(item => ({ ...item, applied: !!result.records?.some(record =>
          record.interventions?.some(change => change.id === item.id)) })) || undefined,
        note: "Local transpiler simulation. This is not proof of execution in SAP." };
    }
    openVisualDebug(true, { ...require("./local-analysis").sourceObject(document), local: true, document, entryLine, autoRun: true,
      autoSelection: options.selection && Object.keys(options.selection).length ? options.selection : null,
      sapCopies: { system: shown.system_name, copies, builtAt: read.builtAt || "",
        root: { object_name: shown.object_name, object_type: kind, system_name: shown.system_name }, entryLine } });
  };
  // F5-F8 are deliberately scoped in package.json to a VERTEX ABAP editor.
  // A stopped program is shared with VERTEX Smart Debugger, so stepping here redraws
  // the already open visual tab without a second debugger session.
  const stepFromSource = async kind => {
    // A step from a local file, or from the SAP tab of a source the transpiler run took a copy of.
    const fromRun = dockedDebugSource?.sapCopies && runPathOf(vscode.window.activeTextEditor?.document?.uri);
    if (require("./local-analysis").isLocalAbap(vscode.window.activeTextEditor?.document) || fromRun) {
      if (localDebugAdapter?.hasTrace() && dockedDebugView) {
        await dockedDebugView.webview.postMessage({ type: "historyStep", kind });
        return;
      }
      const command = { into: "workbench.action.debug.stepInto", over: "workbench.action.debug.stepOver",
        out: "workbench.action.debug.stepOut", continue: "workbench.action.debug.continue" }[kind];
      await vscode.commands.executeCommand(command);
      return;
    }
    if (!dbg.picture().stopped) {
      vscode.window.showWarningMessage("VERTEX: no stopped ABAP program. Open VERTEX Smart Debugger and run to a breakpoint first.");
      return;
    }
    dbg.drivenBy("editor");
    try { await dbg.advance(kind); }
    catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
  };
  context.subscriptions.push(vscode.commands.registerCommand("vertex.tools", initial => {
    if (!initial && require("./local-analysis").isLocalAbap(vscode.window.activeTextEditor?.document)) {
      const object = require("./local-analysis").sourceObject(vscode.window.activeTextEditor.document);
      return vscode.commands.executeCommand(object?.object_type === "CLAS" ? "vertex.tools.uml" : "vertex.tools.metrics");
    }
    return showTools(initial);
  }));
  require('./tools-context').register(vscode, context, sapCode, showTools);
  require('./local-run').register(vscode, context);
  context.subscriptions.push(
    vscode.commands.registerCommand("vertex.openVisualDebug", () => openVisualDebug(false)),
    // A transpiler run, from a chat citation (run_id and step) or from a run folder chosen here.
    vscode.commands.registerCommand("vertex.openTranspilerRun", async target => {
      try {
        let run;
        if (target?.run_id) run = transpilerHistory.get(target.run_id);
        else {
          const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
            openLabel: "Open transpiler run",
            defaultUri: transpilerRunFolder() ? vscode.Uri.file(transpilerRunFolder()) : undefined });
          if (!picked?.length) return;
          run = require("./transpiler-history").load(picked[0].fsPath);
        }
        if (!fs.existsSync(run.main)) throw new Error("The source of run " + run.run_id + " is gone: " + run.main + ".");
        const step = Number.isInteger(target?.step) ? target.step : run.records.length;
        if (step < 1 || step > run.records.length) throw new Error("Run " + run.run_id + " has " + run.records.length + " steps, not step " + step + ".");
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(run.main));
        await openVisualDebug(false, { object_name: run.meta.object_name || path.basename(run.main), object_type: run.meta.object_type || "PROG",
          local: true, document, entryLine: 1, autoRun: false,
          storedRun: { run_id: run.run_id, records: run.records, output: run.output, at: step - 1 } });
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }),
    vscode.commands.registerCommand("vertex.openSapDebugRuns", async () => {
      try {
        const folder = String(vscode.workspace.getConfiguration("vertex").get("debug.runPath", "") || "").trim()
          || path.join(context.globalStorageUri.fsPath, "sap-debug-runs");
        const history = require("./sap-debug-history");
        const recordings = () => history.list(folder).map(run => ({ ...run, kind: "sap", key: "sap:" + run.session_id }))
          .concat(transpilerHistory.list().map(run => ({ ...run, key: "transpiler:" + run.run_id })))
          .sort((a, b) => b.created.localeCompare(a.created));
        if (sapDebugRunsPanel) {
          sapDebugRunsPanel.reveal(vscode.ViewColumn.Beside);
          await sapDebugRunsPanel.webview.postMessage({ type: "runs", runs: recordings() });
          return;
        }
        sapDebugRunsPanel = vscode.window.createWebviewPanel("vertex.sapDebugRuns", "SAP & Transpiler Logs",
          vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
        const panel = sapDebugRunsPanel;
        const nonce = require("crypto").randomBytes(18).toString("base64");
        panel.webview.html = fs.readFileSync(path.join(__dirname, "pages", "sap-debug-runs.html"), "utf8")
          .replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'nonce-" + nonce
            + "'; script-src 'nonce-" + nonce + "';\">")
          .replace("<style>", "<style nonce=\"" + nonce + "\">")
          .replace("<script>", "<script nonce=\"" + nonce + "\">");
        panel.webview.onDidReceiveMessage(async message => {
          try {
            if (message.action === "ready" || message.action === "refresh") {
              await panel.webview.postMessage({ type: "runs", runs: recordings() });
            } else if (message.action === "open") {
              const item = recordings().find(run => run.key === message.key);
              if (!item) throw new Error("The selected execution recording is no longer available.");
              if (item.kind === "transpiler") {
                await vscode.commands.executeCommand("vertex.openTranspilerRun", { run_id: item.run_id, step: 1 });
              } else {
                const record = history.load(item.file);
                await openVisualDebug(false, { object_name: record.meta.name, object_type: record.meta.type,
                  storedDebugRecord: record, autoRun: false });
              }
            } else if (message.action === "rename") {
              const item = recordings().find(run => run.key === message.key && run.kind === "sap");
              if (!item) throw new Error("The selected SAP debug recording is no longer available.");
              const name = await vscode.window.showInputBox({ title: "Rename SAP debug log", value: item.name, prompt: "Name shown in the saved-log list" });
              if (name === undefined) return;
              history.rename(folder, item.file, name);
              await panel.webview.postMessage({ type: "runs", runs: recordings() });
            } else if (message.action === "delete" || message.action === "deleteSelected") {
              const keys = new Set(message.action === "delete" ? [message.key] : Array.isArray(message.keys) ? message.keys : []);
              const selected = recordings().filter(run => keys.has(run.key));
              if (!selected.length) return;
              const confirm = await vscode.window.showWarningMessage("Delete " + selected.length + " execution recording(s)? Links to these recordings will stop opening.", { modal: true }, "Delete");
              if (confirm !== "Delete") return;
              for (const item of selected) {
                if (item.kind === "transpiler") transpilerHistory.remove(item.run_id);
                else { history.remove(folder, item.file); dbg.discardRecording(item.session_id); }
              }
              await panel.webview.postMessage({ type: "runs", runs: recordings() });
            }
          } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
        });
        panel.onDidDispose(() => { if (sapDebugRunsPanel === panel) sapDebugRunsPanel = null; });
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }),
    vscode.commands.registerCommand("vertex.knownEvidenceSessions", () => {
      const folder = String(vscode.workspace.getConfiguration("vertex").get("debug.runPath", "") || "").trim()
        || path.join(context.globalStorageUri.fsPath, "sap-debug-runs");
      const saved = require("./sap-debug-history").list(folder)
        .map(run => ({ kind: "sap", session_id: run.session_id, name: run.name }));
      const liveId = latestDebugContext?.recorded && latestDebugContext.session_id;
      if (liveId && !saved.some(run => run.session_id === liveId))
        saved.push({ kind: "sap", session_id: liveId, name: latestDebugContext.object?.name || "SAP session" });
      const transpiler = transpilerHistory.known().map(run_id => ({ kind: "transpiler", session_id: run_id,
        run_id, number: transpilerHistory.number(run_id) }));
      return saved.concat(transpiler);
    }),
    vscode.commands.registerCommand("vertex.openDebugSession", async target => {
      try {
        const liveId = latestDebugContext?.recorded && latestDebugContext.session_id;
        const prefix = String(target?.session_id || "").toLowerCase();
        const step = Number(target?.step);
        if (liveId && liveId.startsWith(prefix)) {
          const total = latestDebugContext.recorded.stops;
          if (!Number.isInteger(step) || step < 1 || step > total)
            throw new Error("SAP debug session " + liveId + " has " + total + " steps, not step " + step + ".");
          if (!dockedDebugView) throw new Error("The live VERTEX Smart Debugger panel is closed.");
          dockedDebugView.show(true);
          await dockedDebugView.webview.postMessage({ type: "replayStep", step });
          return;
        }
        const folder = String(vscode.workspace.getConfiguration("vertex").get("debug.runPath", "") || "").trim()
          || path.join(context.globalStorageUri.fsPath, "sap-debug-runs");
        const matches = require("./sap-debug-history").list(folder).filter(item => item.session_id.startsWith(prefix));
        if (matches.length !== 1) throw new Error(matches.length ? "That SAP debug session ID is ambiguous." : "No saved SAP debug session matches " + prefix + ".");
        const run = matches[0];
        const record = require("./sap-debug-history").load(run.file);
        if (!Number.isInteger(step) || step < 1 || step > record.timeline.length)
          throw new Error("SAP debug session " + record.session_id + " has " + record.timeline.length + " steps, not step " + step + ".");
        await openVisualDebug(false, { object_name: record.meta.name, object_type: record.meta.type,
          storedDebugRecord: record, replayStep: step, autoRun: false });
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }),
    // The runs a chat answer may cite: their run_ids, for the links the chat draws.
    vscode.commands.registerCommand("vertex.knownTranspilerRuns", () => transpilerHistory.known()
      .map(run_id => ({ run_id, number: transpilerHistory.number(run_id) }))),
    vscode.commands.registerCommand("vertex.resetTranspilerRunNumbers", () => transpilerHistory.resetNumbers()),
    // A local program run with the transpiler: the same panel, which shows the selection screen and the output until a
    // breakpoint is set, and the debugger then.
    vscode.commands.registerCommand("vertex.runTranspiler", async () => {
      if (require("./local-analysis").isLocalAbap(vscode.window.activeTextEditor?.document)) return openVisualDebug(true);
      try {
        await runSapTranspiler(sapCode.editorContext());
      }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }),
    vscode.commands.registerCommand("vertex.runSapWebGui", async () => {
      try {
        const source = sapCode.editorContext();
        const kind = String(source?.object_type || "").toUpperCase();
        if (!source?.object_name || !["PROG", "CLAS", "FUNC"].includes(kind))
          throw new Error("Open a SAP program, class or function module first.");
        await pinTo(source.system_name, async () => {
          const chosen = active();
          if (chosen.error) throw new Error(chosen.error);
          const url = require("./debugger").webGuiUrl(chosen.system, source.object_name, kind === "PROG" ? "" : kind);
          await vscode.env.openExternal(vscode.Uri.parse(url));
        });
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }),
    vscode.commands.registerCommand("vertex.debugInto", () => stepFromSource("into")),
    vscode.commands.registerCommand("vertex.debugOver", () => stepFromSource("over")),
    vscode.commands.registerCommand("vertex.debugOut", () => stepFromSource("out")),
    vscode.commands.registerCommand("vertex.debugContinue", () => stepFromSource("continue"))
  );
  require("./sidebar").register(vscode, context, active,
    require("./chat").create(vscode, chatTools, tools, context.secrets, debugContextForChat, () => require("./value-origin-view").originContext()), systems,
    () => withShownDiff(context, toolsContextState.current()));
  require("./log-report").register(vscode, context, { openObject: object => chatTools.execute("open_sap_object", object) });
  serveTools(context, tools);
  // External clients cannot trigger a VS Code MCP provider. Start on activation
  // so a registered Codex/Claude connection also works after a window reload.
  if (port !== 0) {
    tools.start().catch(function (error) {
      vscode.window.showErrorMessage("VERTEX: " + error.message);
    });
  }

  // One system asked with its own user and password, the way every read is made: the answer says which part of the
  // setting is wrong. It starts with "OK - " when ADT answers.
  async function testSystem(entry) {
    const chosen = auth.systemOf(entry);
    if (chosen.error) { return chosen.error; }
    const system = chosen.system;
    try {
      const res = await request(system, "/sap/bc/adt/discovery");
      return res.status === 200 ? "OK - ADT answers for " + system.user + (system.client ? " in client " + system.client : "")
        : res.status === 401 ? "HTTP 401 - " + reasonAndHint(auth.lastRefusal(system))
          + (system.authType === "basic" ? "; the stored password is dropped, the next test asks again" : "")
        : describeFailure(res.status, res.body);
    } catch (error) { return failureText(system, error); }
  }

  context.subscriptions.push(
    // The server icon in the VERTEX panel's title: the SAP Systems table.
    vscode.commands.registerCommand("vertex.openSystemSettings", () => require("./system-table").open(vscode, { test: testSystem,
      hasPassword: async entry => { const chosen = auth.systemOf(entry); return !chosen.error && auth.hasPassword(chosen.system); },
      login: async entry => { const chosen = auth.systemOf(entry); if (chosen.error) throw new Error(chosen.error); return auth.login(chosen.system); } })),
    vscode.commands.registerCommand("vertex.ai.chooseLogFolder", () => require("./model-config").chooseLogFolder(vscode)),
    vscode.commands.registerCommand("vertex.open", function () {
      showTools({ type: "TABL" });
    }),
    vscode.commands.registerCommand("vertex.metrics", function () {
      if (require("./local-analysis").isLocalAbap(vscode.window.activeTextEditor?.document)) {
        return vscode.commands.executeCommand("vertex.tools.metrics");
      }
      showTools({ type: "CLAS", action: "metrics" });
    }),
    vscode.commands.registerCommand("vertex.versions", function () {
      showTools({ type: "TR" });
    }),
    vscode.commands.registerCommand("vertex.importSystems", async function () {
      try { await require("./system-setup").importSystems(vscode, context); }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }),
    vscode.commands.registerCommand("vertex.removeSystems", async function () {
      try { await require("./system-setup").removeSystems(vscode); }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }),
    // Each configured system asked with its own user and password, the way every read is made: the answer says
    // which part of the setting is wrong.
    vscode.commands.registerCommand("vertex.testSystems", async function () {
      const all = systems();
      if (!all.length) { vscode.window.showWarningMessage("VERTEX: vertex.systems is empty. VERTEX: Import SAP Systems fills it from SAP Logon."); return; }
      const results = [];
      for (const entry of all) { results.push(entry.name + ": " + await testSystem(entry)); }
      const failed = results.filter(r => !/: OK - /.test(r)).length;
      vscode.window[failed ? "showWarningMessage" : "showInformationMessage"]("VERTEX: " + results.join("  |  "), { modal: failed > 0 });
    }),
    vscode.commands.registerCommand("vertex.switchSystem", async function (requested) {
      const all = systems();
      if (all.length === 0) {
        vscode.window.showWarningMessage(
          "VERTEX: there is nothing to switch between. Put your systems in vertex.systems.");
        return;
      }
      const current = active();
      const picked = requested ? { label: requested } : await vscode.window.showQuickPick(
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
      await auth.forget(chosen.system);
      vscode.window.showInformationMessage(
        "VERTEX: the stored credentials for " + chosen.system.name + " were removed.");
    }),
    vscode.commands.registerCommand("vertex.configureApiKey", async function () {
      const api = require("./openai-compatible");
      const provider = await vscode.window.showQuickPick([
        { label: "Anthropic", id: "anthropic" },
        ...Object.entries(api.PROVIDERS).map(([id, value]) => ({ label: value.label, id }))
      ], { title: "Which AI provider?" });
      if (!provider) { return; }
      const profile = await vscode.window.showInputBox({
        title: "Key name for " + provider.label,
        value: "DEFAULT", ignoreFocusOut: true,
        validateInput: value => String(value || "").trim() ? undefined : "Enter a key name."
      });
      if (profile === undefined) { return; }
      const value = await vscode.window.showInputBox({
        title: "API key for " + provider.label,
        prompt: "The key is stored in VS Code SecretStorage, never in settings.json.",
        password: true,
        ignoreFocusOut: true,
        validateInput: text => String(text || "").trim() ? undefined : "Enter an API key."
      });
      if (value === undefined) { return; }
      await require("./key-profiles").save(context.secrets,
        provider.id === "anthropic" ? "anthropic-api" : provider.id, profile, value);
      vscode.window.showInformationMessage(provider.label + " API key '" + profile.trim() + "' saved securely.");
    }),
    vscode.commands.registerCommand("vertex.selectProvider", async function () {
      const values = require("./model-config").PROVIDERS.map(provider => [provider.label, provider.setting]);
      const current = vscode.workspace.getConfiguration("vertex.ai").get("provider", "codex-subscription");
      const picked = await vscode.window.showQuickPick(values.map(item => ({
        label: item[0], picked: item[1] === current, id: item[1]
      })), { title: "Select VERTEX AI provider" });
      if (!picked) { return; }
      const settings = vscode.workspace.getConfiguration("vertex.ai");
      if (picked.id !== current) {
        await settings.update("provider", picked.id, vscode.ConfigurationTarget.Global);
        await settings.update("model", "", vscode.ConfigurationTarget.Global);
      }
      vscode.window.showInformationMessage("VERTEX: using " + picked.label + ".");
    })
  );
  return { sapCode };
}

async function deactivate() {
  if (tools) { tools.stop(); tools = null; }
  if (stopDebugger) { await stopDebugger(); }
  if (auth) { await auth.disposeAll(); }
  if (output) { output.dispose(); output = null; }
}

exports.activate = activate;
exports.deactivate = deactivate;
