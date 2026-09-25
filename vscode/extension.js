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

/** Passwords are filed per system: two systems are two users often enough. */
function secretKey(system) {
  return "vertex.password." + system.name;
}

function providerSecretKey(provider) {
  return "vertex.provider." + String(provider).toLowerCase() + ".apiKey";
}

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
const WRITES = { act: 4, prepare: 2 };

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
  "  window.sdePrepare = send('prepare');",
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
    return { error: "No system configured. Put one in vertex.systems: a name, a url and a user." };
  }
  const pinned = pinnedSystem.getStore();
  const wanted = pinned || (vscode.workspace.getConfiguration("vertex").get("active") || "").trim();
  if (!wanted) {
    return { system: all[0] };
  }
  const found = all.filter(function (s) { return s.name === wanted; });
  if (found.length === 0) {
    return {
      error: (pinned ? "This window reads from " + wanted + ", which is no longer"
                     : "vertex.active names " + wanted + ", which is not")
           + " in vertex.systems. There is " + all.map(function (s) { return s.name; }).join(", ") + "."
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

  // ADT's quick search answers in XML only; the VERTEX resources in JSON.
  if (!body && requestPath.startsWith("/sap/bc/adt/repository/informationsystem/search?")) {
    extra = { headers: { Accept: "application/xml" } };
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

async function assistantModels(context, args) {
  const id = String(args[0] || "");
  try {
    // What Config models in the VERTEX panel leaves switched on; versions are
    // added there too, so the page offers no field of its own for them.
    return { assistant: id, models: require("./model-config").apply(vscode, id, id === "anthropic-api"
      ? await anthropic.models(await context.secrets.get(providerSecretKey("anthropic")))
      : await assistant.models({ assistant: id, extensionPath: assistantExtension(id) })) };
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
      const picked = await vscode.window.showQuickPick(["Codex", "Claude Code",
        "Codex - debugger", "Claude Code - debugger"], {
        title: "Connect VERTEX to which assistant?"
      });
      if (!picked) { return; }
      // The debugger is its own server entry, so the review registration and
      // what it offers stay as they are.
      const debug = / - debugger$/.test(picked);
      const client = picked.replace(/ - debugger$/, "");
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
      const name = debug ? "vertex-debug" : "vertex";
      const url = debug ? running.url.replace(/\/mcp$/, "/debug") : running.url;
      const line = client === "Codex"
        ? '[mcp_servers.' + name + ']\nurl = "' + url
          + '"\nhttp_headers = { Authorization = "Bearer ' + server.token + '" }\n'
        : 'claude mcp add --transport http ' + name + ' --scope user ' + url
                 + ' --header "Authorization: Bearer ' + server.token + '"';
      await vscode.env.clipboard.writeText(line);
      vscode.window.showInformationMessage(
        (client === "Codex"
          ? "Copied Codex configuration. Paste into ~/.codex/config.toml, replacing any existing [mcp_servers." + name + "] section, then restart the Codex extension and start a new conversation. "
          : "Copied the Claude Code terminal command. If " + name + " is already registered, run claude mcp remove " + name + " --scope user first. ")
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
  if (!view || view.view !== "diff" || !view.part || !view.version || (state.selected_fragment && state.selected_fragment.text)) {
    return state;
  }
  const route = SERVICES.versions.load([view.name, view.type, view.part, view.part_type,
                                        view.compared_with || "", view.version, "I"]);
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
  const lines = [];
  ops.forEach((o, i) => {
    if (near[i]) { lines.push((o.op === "=" ? " " : o.op) + " " + o.text); }
    else if (lines[lines.length - 1] !== "...") { lines.push("..."); }
  });
  if (!lines.length) { return state; }
  return { ...state, selected_fragment: { view,
    text: "Diff of " + view.part.trim() + " from " + (view.compared_with || "nothing") + " to " + view.version
          + " ('-' removed, '+' added):\n" + lines.join("\n") } };
}

function systemKey(system) {
  return JSON.stringify([system.name, system.url, system.client || "", system.user]);
}

/* The debugger an assistant drives through /debug: one per window, on the
   active system, with the password VS Code keeps. The listener runs on a
   stateless session; each stopped program gets a stateful one of its own. */
function debuggerFor(context) {
  const crypto = require("crypto");
  let id = context.globalState.get("vertex.debug.ideId");
  if (!id) {
    id = crypto.randomBytes(16).toString("hex").toUpperCase();
    context.globalState.update("vertex.debug.ideId", id);
  }
  const dbg = require("./debugger").create({
    ideId: id,
    terminalId: id,
    openUrl: url => vscode.env.openExternal(vscode.Uri.parse(url)),
    // Which system is active now: a window's own, a chat's named one, or vertex.active.
    current: () => { const chosen = active(); return chosen.error ? "" : systemKey(chosen.system); },
    connect: async function () {
      const chosen = active();
      if (chosen.error) { throw new Error(chosen.error); }
      const system = chosen.system;
      const pw = await password(context, system);
      if (!pw) { throw new Error("The SAP password for " + system.name + " was not supplied."); }
      const { ADTClient } = require("abap-adt-api");
      const make = function () {
        const client = new ADTClient(system.url, system.user, pw, system.client || "", "EN", { timeout: 300000 });
        client.httpClient.httpclient = require("./sap-http").create(system);
        return client;
      };
      const listener = make();
      return {
        key: systemKey(system), system, user: String(system.user).toUpperCase(), listener,
        open: async function () {
          const client = make();
          client.stateful = "stateful";
          await client.login();
          return client;
        }
      };
    }
  });
  // A closed window must not leave breakpoints and a listener behind on SAP.
  context.subscriptions.push({ dispose: () => { dbg.stop().catch(() => {}); } });
  return dbg;
}

/* The source tools with the debugger's added: the schemas and the method the
   chat is told, and a call that sends debug_* to the debugger. The Anthropic
   API path calls execute directly, so it gets the answer as text. */
function withDebugger(sapCode, debugTools) {
  // Getters, read when asked - as the source tools' own text is: it names the
  // systems configured at the time. Object.assign would read them now.
  return Object.create(sapCode, {
    schemas: { get: () => sapCode.schemas.concat(debugTools.tools) },
    instructions: { get: () => sapCode.instructions + "\n\n" + debugTools.instructions },
    execute: { value: async function (name, args) {
      if (!/^debug_/.test(name)) { return sapCode.execute(name, args); }
      const answer = await debugTools.call({}, name, args || {});
      if (answer.isError) { throw new Error(answer.content[0].text); }
      return answer.content[0].text;
    } }
  });
}

function activate(context) {
  const sapCode = require("./code-workbench").register(vscode, context, { active, password, pin: pinTo,
    pinned: () => pinnedSystem.getStore() || "", systems });
  // The panel's chat debugs too: its assistant gets the debugger tools beside
  // the source tools, on the same /chat address, with nothing to register.
  // Visual Debug in the Tools window draws this same debugger.
  const dbg = debuggerFor(context);
  const debugTools = mcp.debugSet(dbg);
  const chatTools = withDebugger(sapCode, debugTools);
  let latestToolsContext = null;
  const port = vscode.workspace.getConfiguration("vertex").get("mcp.port", 37777);
  const chatSet = {
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
          const result = await sapCode.execute(toolName, toolArgs);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        })(deps, name, args);
    }
  };
  tools = mcp.create({ fetch: fetch, context: context, port: port,
    pin: pinTo, pinned: () => pinnedSystem.getStore() || "",
    pages: Object.assign(windowTools(), { "/chat": chatSet, "/debug": debugTools }) });
  const showTools = initial => require("./tools-window").open(vscode, context,
    { pages: PAGES, fetch, asset, active, pin: pinTo, models: args => assistantModels(context, args),
      source: args => sapCode.execute("read_sap_object", args),
      openEditor: args => sapCode.execute("open_sap_object", args),
      runUnitTests: args => sapCode.runUnitTests(args),
      setContext: value => { latestToolsContext = value; },
      debugger: dbg,
      chat: () => require("./chat").create(vscode, chatTools, tools, context.secrets) }, initial);
  context.subscriptions.push(vscode.commands.registerCommand("vertex.tools", showTools));
  require("./sidebar").register(vscode, context, active,
    require("./chat").create(vscode, chatTools, tools, context.secrets), systems,
    () => withShownDiff(context, latestToolsContext));
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
      showTools({ type: "TABL" });
    }),
    vscode.commands.registerCommand("vertex.metrics", function () {
      showTools({ type: "CLAS", action: "metrics" });
    }),
    vscode.commands.registerCommand("vertex.versions", function () {
      showTools({ type: "TR" });
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
      await context.secrets.delete(secretKey(chosen.system));
      vscode.window.showInformationMessage(
        "VERTEX: the stored password for " + chosen.system.name + " was removed.");
    }),
    vscode.commands.registerCommand("vertex.configureApiKey", async function () {
      const provider = await vscode.window.showQuickPick([
        { label: "Anthropic", id: "anthropic" },
        { label: "OpenAI", id: "openai" }
      ], { title: "Which AI provider?" });
      if (!provider) { return; }
      const value = await vscode.window.showInputBox({
        title: "API key for " + provider.label,
        prompt: "The key is stored in VS Code SecretStorage, never in settings.json.",
        password: true,
        ignoreFocusOut: true,
        validateInput: text => String(text || "").trim() ? undefined : "Enter an API key."
      });
      if (value === undefined) { return; }
      await context.secrets.store(providerSecretKey(provider.id), value.trim());
      vscode.window.showInformationMessage(provider.label + " API key saved securely.");
    }),
    vscode.commands.registerCommand("vertex.selectProvider", async function () {
      const values = [
        ["Claude subscription (Claude Code)", "claude-subscription"],
        ["ChatGPT subscription (Codex)", "codex-subscription"],
        ["Copilot", "copilot"],
        ["Anthropic API (key)", "anthropic-api"],
        ["OpenAI API", "openai-api"]
      ];
      const current = vscode.workspace.getConfiguration("vertex.ai").get("provider", "codex-subscription");
      const picked = await vscode.window.showQuickPick(values.map(item => ({
        label: item[0], picked: item[1] === current, id: item[1]
      })), { title: "Select VERTEX AI provider" });
      if (!picked) { return; }
      await vscode.workspace.getConfiguration("vertex.ai").update(
        "provider", picked.id, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage("VERTEX: using " + picked.label + ".");
    })
  );
  return { sapCode };
}

function deactivate() {
  if (tools) { tools.stop(); tools = null; }
}

exports.activate = activate;
exports.deactivate = deactivate;
