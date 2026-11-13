"use strict";
/* Chat MCP servers: the SAP tools of the VERTEX chat come from VERTEX itself or
   from an MCP server listed in vertex.chat.mcpServers (ARC-1, mcp-abap-adt, ...).
   The chosen server is started here over stdio with the active SAP system's
   url, user, client and password put into its environment. Nothing falls back:
   a server that does not start, or a system without a password, is an error
   the chat reports. */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VERTEX = "VERTEX";
/* VERTEX's own tools plus a catalog of every configured server: each one's description and toolsets, which
   the model enables one at a time. The last choice in the VERTEX panel. */
const ORCHESTRATOR = "VERTEX Orchestrator";
const ACCESS = {
  "read-only": { allowWrites: "false", allowTransportWrites: "false", allowedPackages: "$TMP", allowDataPreview: "false", allowFreeSql: "false", allowGitWrites: "false" },
  "write-tmp": { allowWrites: "true", allowTransportWrites: "false", allowedPackages: "$TMP", allowDataPreview: "false", allowFreeSql: "false", allowGitWrites: "false" },
  // Full access is everything ARC-1 offers on SAP: table preview, free SQL and Git writes included.
  "write": { allowWrites: "true", allowTransportWrites: "true", allowedPackages: "*", allowDataPreview: "true", allowFreeSql: "true", allowGitWrites: "true" }
};
/* mcp-abap-adt fixes its tool set per package since 19.0: core-ro serves the read-only tools, core adds the write ones. */
const ABAP_ADT_ACCESS = { "read-only": "@mcp-abap-adt/core-ro@23.1.0", "write": "@mcp-abap-adt/core@23.1.0" };

/* The write settings a server entry depends on, found by the placeholders it uses; shown when the server is first chosen. */
const WRITE_OPTIONS = [
  { setting: "arc1Access", uses: /\$\{arc1/, label: "What ARC-1 may change in SAP", choices: [
    { value: "read-only", label: "Read only: no writes, no transports" },
    { value: "write-tmp", label: "Write and activate in $TMP only" },
    { value: "write", label: "Full: write in any package, transports, table preview, free SQL, Git writes" }] },
  { setting: "abapAdtAccess", uses: /\$\{abapAdtPackage\}/, label: "What mcp-abap-adt may change in SAP", choices: [
    { value: "read-only", label: "Read only: its write tools are not offered" },
    { value: "write", label: "Write: create, change and activate objects" }] },
  { setting: "vspAccess", uses: /\$\{vsp/, label: "What vibing-steampunk may change in SAP", choices: [
    { value: "read-only", label: "Read only: every write is refused (--read-only)" },
    { value: "write", label: "Full: create, change, delete, activate, transports" }] }
];
/* vibing-steampunk takes its safety switches from the environment as well as from flags. */
const VSP_ACCESS = { "read-only": { readOnly: "true", transports: "false" }, "write": { readOnly: "false", transports: "true" } };

/* Whether COMMAND is on the PATH, asked before it is started: a shell's "not found" comes in the system's language. */
function commandExists(command, env) {
  if (/[\\/]/.test(command)) return require("fs").existsSync(command);
  const found = spawnSync(process.platform === "win32" ? "where" : "which", [command], { env, windowsHide: true });
  return found.status === 0;
}
function missingCommand(entry) {
  const error = new Error("MCP server " + entry.name + " could not be started: " + entry.command + " was not found in the executable search path."
    + (entry.command === "npx" ? " VERTEX also checks NVM and Homebrew installations on macOS. If Node.js is installed, check that its bin folder contains node and npx and is on PATH. Otherwise install Node.js (https://nodejs.org), which brings npm and npx, and restart VS Code."
      : entry.download ? " Download it from " + entry.download + ", then put its folder on PATH or set " + (entry.pathSetting || "this entry's command in vertex.chat.mcpServers") + " to the file's full path." : ""));
  error.nodeMissing = entry.command === "npx";
  return error;
}

/* One stdio MCP server: newline-delimited JSON-RPC. */
function startClient(entry, env, timeoutMs, cleanup, cwd) {
  const win = process.platform === "win32";
  // npx and other .cmd launchers need a shell on Windows; arguments come from settings, not from SAP.
  const quote = part => /^[\w@.\/:=,+-]+$/.test(part) ? part : '"' + String(part).replace(/"/g, '\\"') + '"';
  // An empty folder of VERTEX's own: a server that reads ./.env or ./.vsp.json finds none of the user's there.
  const where = cwd ? { cwd } : {};
  const child = win
    ? spawn([entry.command, ...(entry.args || [])].map(quote).join(" "), { env, shell: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...where })
    : spawn(entry.command, entry.args || [], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...where });
  const pending = new Map();
  let nextId = 1, buffer = "", stderr = "", exited = null;
  const failAll = error => { for (const p of pending.values()) p.reject(error); pending.clear(); };
  const exitError = () => {
    const tail = stderr.trim().split(/\r?\n/).slice(-8).join("\n");
    const missing = /not recognized|ENOENT|command not found/i.test(tail + " " + (exited && exited.message || ""));
    return new Error("MCP server " + entry.name + " " + (missing
      ? "could not be started: " + entry.command + " or one of its required executables was not found. Check the Node.js/npm/npx installation and the MCP process PATH."
      : "stopped" + (exited && exited.code !== undefined ? " (exit code " + exited.code + ")" : "") + (tail ? ":\n" + tail : ".")));
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (_) { continue; }
      if (message.id === undefined || !pending.has(message.id)) continue;
      const p = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) p.reject(new Error("MCP server " + entry.name + ": " + (message.error.message || JSON.stringify(message.error))));
      else p.resolve(message.result);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8000); });
  child.on("error", error => { exited = { message: error.message }; failAll(exitError()); });
  child.on("exit", code => { exited = exited || { code }; failAll(exitError()); if (cleanup) cleanup(); });
  const send = message => child.stdin.write(JSON.stringify(message) + "\n");
  const request = (method, params, ms) => {
    if (exited) return Promise.reject(exitError());
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP server " + entry.name + " did not answer " + method + " within " + Math.round((ms || timeoutMs) / 1000) + " s.")); }, ms || timeoutMs);
      pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      send({ jsonrpc: "2.0", id, method, params: params || {} });
    });
  };
  return {
    async open() {
      // The first start may download the package through npx: allow it time.
      const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {},
        clientInfo: { name: "vertex", version: "1" } }, Math.max(timeoutMs, 180000));
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const tools = [];
      let cursor;
      do {
        const page = await request("tools/list", cursor ? { cursor } : {});
        tools.push(...(page.tools || []));
        cursor = page.nextCursor;
      } while (cursor);
      return { instructions: init && init.instructions || "", tools, version: String(init && init.serverInfo && init.serverInfo.version || "") };
    },
    call: (name, args) => request("tools/call", { name, arguments: args || {} }),
    alive: () => !exited,
    stop() { exited = exited || { code: "stopped" }; failAll(new Error("MCP server " + entry.name + " was stopped.")); try { child.kill(); } catch (_) { } if (cleanup) cleanup(); }
  };
}

/* One MCP server over Streamable HTTP that something else already runs (SAP's ADT MCP Server): each request is a
   POST, answered as JSON or as an event stream whose last data line is the answer; the session id it hands out
   goes with every later request. entry.notRunning explains what to switch on when nothing listens. */
function startHttpClient(entry, timeoutMs) {
  let session = null, stopped = false, nextId = 1;
  const post = async (message, ms) => {
    if (stopped) throw new Error("MCP server " + entry.name + " was stopped.");
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(entry.headers || {}) };
    if (session) headers["Mcp-Session-Id"] = session;
    let response;
    try {
      response = await fetch(entry.url, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(ms || timeoutMs) });
    } catch (error) {
      if (error.name === "TimeoutError") throw new Error("MCP server " + entry.name + " did not answer " + message.method + " within " + Math.round((ms || timeoutMs) / 1000) + " s.");
      throw new Error("MCP server " + entry.name + " does not answer at " + entry.url + "." + (entry.notRunning ? " " + entry.notRunning : "") + "\nDetails: " + (error.cause && error.cause.code || error.message));
    }
    if (response.headers.get("mcp-session-id")) session = response.headers.get("mcp-session-id");
    const text = await response.text();
    if (response.status === 401 || response.status === 403) throw new Error("MCP server " + entry.name + " refused the token (HTTP " + response.status + ")." + (entry.notRunning ? " " + entry.notRunning : ""));
    if (!response.ok) throw new Error("MCP server " + entry.name + " answered HTTP " + response.status + (text ? ": " + text.slice(0, 300) : "."));
    if (message.id === undefined) return null;
    const body = /event-stream/.test(response.headers.get("content-type") || "")
      ? text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).filter(Boolean).pop()
      : text;
    const answer = body ? JSON.parse(body) : null;
    if (!answer) throw new Error("MCP server " + entry.name + " sent no answer to " + message.method + ".");
    if (answer.error) throw new Error("MCP server " + entry.name + ": " + (answer.error.message || JSON.stringify(answer.error)));
    return answer.result;
  };
  const request = (method, params, ms) => post({ jsonrpc: "2.0", id: nextId++, method, params: params || {} }, ms);
  return {
    async open() {
      const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vertex", version: "1" } });
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      const tools = [];
      let cursor;
      do {
        const page = await request("tools/list", cursor ? { cursor } : {});
        tools.push(...(page.tools || []));
        cursor = page.nextCursor;
      } while (cursor);
      return { instructions: init && init.instructions || "", tools, version: String(init && init.serverInfo && init.serverInfo.version || "") };
    },
    call: (name, args) => request("tools/call", { name, arguments: args || {} }),
    alive: () => !stopped,
    stop() { stopped = true; }
  };
}

/* A .env line value: single quotes keep it literal, double quotes when it holds a single quote. */
function envValue(key, value) {
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new Error(key + " has a line break and cannot be written to a .env file.");
  if (!text.includes("'")) return "'" + text + "'";
  if (!text.includes('"')) return '"' + text + '"';
  throw new Error(key + " holds both quote characters and cannot be written to a .env file.");
}

/* A server that reads its connection only from a file (envFile) gets one in VERTEX's own storage, for as long as
   it runs: written readable by the user only, deleted when the server stops, and leftovers of a crash removed
   at the next start. */
function envFolder(storage) { return path.join(storage, "mcp-env"); }
function clearEnvFiles(storage) {
  if (!storage) return;
  let names = [];
  try { names = fs.readdirSync(envFolder(storage)); } catch (_) { return; }
  for (const name of names) if (/\.env$/.test(name)) { try { fs.unlinkSync(path.join(envFolder(storage), name)); } catch (_) { } }
}
function writeEnvFile(storage, serverName, lines) {
  if (!storage) throw new Error("MCP server " + serverName + " needs a .env file, and VERTEX has no storage folder to write it in.");
  fs.mkdirSync(envFolder(storage), { recursive: true });
  const file = path.join(envFolder(storage), serverName.replace(/[^\w-]/g, "_") + "-" + crypto.randomBytes(6).toString("hex") + ".env");
  fs.writeFileSync(file, Object.entries(lines).map(([k, v]) => k + "=" + envValue(k, v)).join("\n") + "\n", { mode: 0o600 });
  return file;
}

function fill(value, values) {
  return String(value).replace(/\$\{(\w+)\}/g, (all, key) => Object.hasOwn(values, key) ? values[key] : all);
}

/* An npm package spec in a server's command line: name@version, scoped names included. */
function npmSpec(arg) {
  const m = /^(@[^@/\s]+\/[^@\s]+|[^@\s/][^@\s]*)@(\d[^\s]*)$/.exec(String(arg));
  return m ? { name: m[1], version: m[2] } : null;
}

async function latestOnNpm(name) {
  const response = await fetch("https://registry.npmjs.org/" + name.replace("/", "%2F") + "/latest", { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("npm answered HTTP " + response.status + " for " + name + ".");
  const body = await response.json();
  if (!body || typeof body.version !== "string") throw new Error("npm sent no version for " + name + ".");
  return body.version;
}

/* catalog keeps, per server, the version and tool list read the last time it started: { get(), update(value) }.
   fetchLatest(name) answers the newest version npm has of a package. */
function create({ vscode, active, password, storage, catalog = null, access = null, fetchLatest = latestOnNpm }) {
  clearEnvFiles(storage);
  const runs = new Map();       // server name -> { key, name, note, client, instructions, tools, version }
  const starting = new Map();   // server name -> { key, promise } while it starts
  const config = () => vscode.workspace.getConfiguration("vertex.chat");

  /* What a server may change in SAP is answered once per server AND per system and client, not once for good: the
     same server against a sandbox and against a production system are two different permissions. The answers live
     in a map, server|system|client -> value; the vertex.chat.*Access setting stays as the default for a triple
     nobody has answered yet, which is also what Settings shows. */
  const accessStore = access || { get: () => ({}), update: async () => {} };
  const accessKey = serverName => {
    let chosen;
    try { chosen = active(); } catch (_) { return null; }
    if (!chosen || chosen.error || !chosen.system) return null;
    return serverName + "|" + (chosen.system.name || "") + "|" + (chosen.system.client || "");
  };
  const storedAccess = (serverName, setting) => {
    const key = accessKey(serverName);
    const saved = key && (accessStore.get() || {})[key];
    return saved && typeof saved[setting] === "string" ? saved[setting] : null;
  };
  const accessValue = (serverName, setting) => storedAccess(serverName, setting) || String(config().get(setting, "read-only"));
  /** True when this system and client have already answered every write question this server asks. */
  const accessRemembered = serverName => {
    const asked = writeOptions(serverName);
    return asked.length > 0 && asked.every(option => storedAccess(serverName, option.setting));
  };
  // A setting that is not a list names no servers; picking one then fails loudly in prepare().
  const servers = () => { const list = config().get("mcpServers"); return (Array.isArray(list) ? list : []).filter(s => s && s.name && (s.command || s.url) && s.name !== VERTEX && s.name !== ORCHESTRATOR); };
  const selected = () => String(config().get("mcpServer", VERTEX) || VERTEX);
  // What the VERTEX panel offers, in its order: VERTEX first, the orchestrator last.
  const choices = () => [VERTEX, ...servers().map(s => s.name), ORCHESTRATOR];

  /* Versions the user updated to (vertex.chat.mcpVersions, package -> version) replace the ones a server's
     command line names. */
  const versions = () => { const v = config().get("mcpVersions"); return v && typeof v === "object" ? v : {}; };
  const pinned = arg => { const spec = npmSpec(arg); const own = spec && versions()[spec.name]; return own ? spec.name + "@" + own : arg; };
  // The npm packages a server runs, with the version it runs now.
  function packagesOf(entry) {
    if (entry.url) return [];
    const abapAdtPackage = ABAP_ADT_ACCESS[config().get("abapAdtAccess", "read-only")] || ABAP_ADT_ACCESS["read-only"];
    return (entry.args || []).map(a => npmSpec(pinned(fill(a, { abapAdtPackage })))).filter(Boolean);
  }
  /* Whether npx will download server NAME's package on its next start: true when a package it runs is not in npx's
     cache at that version. npx keeps each install in <npm cache>/_npx/<hash>/node_modules; that layout is npm's,
     not documented, so a cache it no longer matches reads as not installed - the install scene, nothing worse.
     A server reached by URL or run from its own executable never installs here. */
  function needsInstall(name) {
    const entry = servers().find(s => s.name === name);
    if (!entry || entry.command !== "npx") return false;
    const cache = process.env.npm_config_cache
      || (process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm-cache") : path.join(require("os").homedir(), ".npm"));
    let dirs = [];
    try { dirs = fs.readdirSync(path.join(cache, "_npx")); } catch (_) { return true; }
    const have = spec => dirs.some(dir => {
      try { return JSON.parse(fs.readFileSync(path.join(cache, "_npx", dir, "node_modules", ...spec.name.split("/"), "package.json"), "utf8")).version === spec.version; }
      catch (_) { return false; }
    });
    return packagesOf(entry).some(spec => !have(spec));
  }
  const stored = () => { const value = catalog && catalog.get(); return value && typeof value === "object" ? value : {}; };
  async function remember(name, opened) {
    if (!catalog) return;
    const tools = (opened.tools || []).map(t => ({ name: t.name, description: String(t.description || "").split(/\n\s*\n/)[0].slice(0, 400),
      readOnly: !!(t.annotations && t.annotations.readOnlyHint) }));
    await catalog.update({ ...stored(), [name]: { version: opened.version || "", tools, savedAt: new Date().toISOString() } });
  }

  // Stops every server VERTEX started: when the extension ends.
  function stop() { for (const run of runs.values()) run.client.stop(); runs.clear(); enabled.clear(); }

  /* How to reach ENTRY: the key that says whether a running copy still fits, and how to start one. A server
     reached by URL (SAP's ADT MCP Server) runs on its own and logs on with its own systems, so VERTEX hands over
     no system or password; ${adtMcpPort} and ${adtMcpToken} come from the settings SAP's ABAP Development Tools
     keep. A server VERTEX starts gets the active system and its kept password. */
  function plan(entry) {
    const name = entry.name;
    if (entry.url) {
      const adt = vscode.workspace.getConfiguration("adt");
      const values = { adtMcpPort: String(adt.get("mcpServer.port", 2236)), adtMcpToken: String(adt.get("mcpServer.token", "") || "") };
      const resolved = { ...entry, url: fill(entry.url, values),
        headers: Object.fromEntries(Object.entries(entry.headers || {}).map(([k, v]) => [k, fill(v, values)])) };
      return { key: JSON.stringify([resolved]), async start() {
        const client = startHttpClient(resolved, 120000);
        return { client, ...(await client.open()) };
      } };
    }
    const chosen = active();
    if (chosen.error) throw new Error(chosen.error);
    const system = chosen.system;
    if (system.authType !== "basic") throw new Error("MCP server " + name + " needs a user and password, and " + system.name + " logs on with SNC. Use VERTEX's own tools for this system.");
    const access = ACCESS[accessValue(name, "arc1Access")] || ACCESS["read-only"];
    const abapAdtPackage = ABAP_ADT_ACCESS[accessValue(name, "abapAdtAccess")] || ABAP_ADT_ACCESS["read-only"];
    const vsp = VSP_ACCESS[accessValue(name, "vspAccess")] || VSP_ACCESS["read-only"];
    const vspPath = String(config().get("vspPath", "vsp") || "vsp");
    return { key: JSON.stringify([entry, system.name, system.url, system.client, system.user, access, abapAdtPackage, vsp, vspPath]), async start() {
      const pw = await password(system);
      if (!pw) throw new Error("No password was entered for " + system.name + ", so MCP server " + name + " was not started.");
      const values = { sapUrl: system.url, sapUser: system.user, sapPassword: pw, sapClient: system.client || "",
        sapInsecure: system.allowInsecureCertificate ? "true" : "false",
        tlsRejectUnauthorized: system.allowInsecureCertificate ? "0" : "1",
        arc1AllowWrites: access.allowWrites, arc1AllowTransportWrites: access.allowTransportWrites,
        arc1AllowedPackages: access.allowedPackages, arc1AllowDataPreview: access.allowDataPreview, arc1AllowFreeSql: access.allowFreeSql, arc1AllowGitWrites: access.allowGitWrites, abapAdtPackage,
        vspReadOnly: vsp.readOnly, vspTransports: vsp.transports, vspPath };
      let env = { ...process.env };
      for (const [k, v] of Object.entries(entry.env || {})) env[k] = fill(v, values);
      env = require("./assistant").nodeEnv(env);
      let envFile = null;
      if (entry.envFile) {
        const lines = {};
        for (const [k, v] of Object.entries(entry.envFile)) lines[k] = fill(v, values);
        envFile = writeEnvFile(storage, name, lines);
        values.envFile = envFile;
      }
      const removeEnvFile = () => { if (envFile) { try { fs.unlinkSync(envFile); } catch (_) { } envFile = null; } };
      const resolved = { ...entry, command: fill(entry.command, values), args: (entry.args || []).map(a => pinned(fill(a, values))),
        ...(/\$\{vspPath\}/.test(entry.command) ? { pathSetting: "vertex.chat.vspPath" } : {}) };
      if (!commandExists(resolved.command, env)) { removeEnvFile(); throw missingCommand(resolved); }
      let cwd;
      if (storage) { cwd = path.join(storage, "mcp-run"); fs.mkdirSync(cwd, { recursive: true }); }
      const client = startClient(resolved, env, 120000, removeEnvFile, cwd);
      try { return { client, ...(await client.open()) }; } catch (error) { client.stop(); throw error; }
    } };
  }

  /* Server NAME running for the active system: the copy already running when it still fits (same entry, system,
     user, access), started otherwise. A started server stays up for the VS Code session, whether it was chosen in
     the panel or a toolset of it was enabled, so switching back to it does not start it again. */
  async function ensure(name) {
    const entry = servers().find(s => s.name === name);
    if (!entry) throw new Error("MCP server " + name + " is not in vertex.chat.mcpServers. Pick a server in the VERTEX panel.");
    const { key, start } = plan(entry);
    const run = runs.get(name);
    if (run && run.key === key && run.client.alive()) return run;
    const pending = starting.get(name);
    if (pending && pending.key === key) return pending.promise;
    if (run) { run.client.stop(); runs.delete(name); dropEnabled(name); }
    const promise = (async () => {
      const started = { key, name, note: entry.note || "", ...(await start()) };
      runs.set(name, started);
      await remember(name, started);
      return started;
    })();
    starting.set(name, { key, promise });
    try { return await promise; } finally { if (starting.get(name) && starting.get(name).key === key) starting.delete(name); }
  }

  /* The chosen server for the active system, started when needed; null for VERTEX's own tools. */
  /** Whether this server is up right now - a scene for a start that is not happening would be a lie. */
  function isRunning(name) {
    const run = runs.get(name);
    return !!(run && run.client && run.client.alive());
  }

  async function prepare() {
    const name = selected();
    if (name === VERTEX || name === ORCHESTRATOR) return null;
    return ensure(name);
  }

  /* Toolsets: a few tools of another MCP server, offered to the model by one small enable_toolset tool and added
     only when it asks for them - so a question that needs none does not carry those servers' schemas. An
     enabled toolset stays for the rest of the session. */
  const toolsets = () => { const list = config().get("toolsets"); return (Array.isArray(list) ? list : []).filter(t => t && t.name && t.server && Array.isArray(t.tools)); };
  const enabled = new Map();       // toolset name -> { server, run, tools }
  const dropEnabled = name => { for (const [set, e] of enabled) if (e.server === name) enabled.delete(set); };
  const pattern = glob => new RegExp("^" + String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  // The orchestrator offers every toolset; a single server's mode only those marked always, of other servers.
  const offered = () => selected() === ORCHESTRATOR ? toolsets() : toolsets().filter(t => t.always === true && t.server !== selected());
  async function enableToolset(name) {
    const set = offered().find(t => t.name === name);
    if (!set) throw new Error("No toolset " + name + ". Toolsets: " + (offered().map(t => t.name).join(", ") || "none") + ".");
    const entry = servers().find(s => s.name === set.server);
    if (!entry) throw new Error("Toolset " + name + " names MCP server " + set.server + ", which is not in vertex.chat.mcpServers.");
    const run = await ensure(set.server);
    const wanted = set.tools.map(pattern);
    const tools = run.tools.filter(t => wanted.some(w => w.test(t.name)));
    if (!tools.length) throw new Error("MCP server " + set.server + " offers none of the tools of toolset " + name + " (" + set.tools.join(", ") + ").");
    enabled.set(name, { server: set.server, run, tools });
    return { enabled: name, server: set.server, tools: tools.map(t => t.name),
      note: "API and Copilot executors receive these tools on the next step of this same request; Claude Code and Codex receive them from the next question" + (set.note ? ". " + set.note : ".") + (entry.note ? " " + entry.note : "") };
  }
  const enabledTools = () => [...enabled.values()].filter(e => e.server !== selected() && e.run.client.alive()).flatMap(e => e.tools.map(tool => ({ tool, run: e.run })));

  /* VERTEX's own tool set wrapped: with an external server chosen, its tools replace VERTEX's SAP repository
     tools; the debugger (debug_*) and the ABAP transpiler stay VERTEX's. */
  function wrap(own) {
    // Kept beside any server: the debugger, the transpiler, and publishing a service binding, which no MCP server here does.
    const kept = tool => /^debug_/.test(tool.name) || /abap_transpiler/.test(tool.name) || tool.name === "publish_sap_service_binding";
    const current = () => { const run = runs.get(selected()); return run && run.client.alive() ? run : null; };
    const asSchema = t => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || { type: "object", properties: {} },
      ...(t.annotations ? { annotations: t.annotations } : {}) });
    const wrapped = Object.create(own);
    const toolsetSchema = () => {
      const sets = offered();
      return sets.length ? [{ name: "enable_toolset", annotations: { readOnlyHint: true, destructiveHint: false },
        description: "Add extra SAP tools from another MCP server when the task needs them; API and Copilot executors can use them on the next step in this same request; Claude Code and Codex get them from the next question. They stay for the session. Call this tool yourself when needed, do not ask the user to invoke it. "
          + "Enable one only for what the other tools cannot do. Toolsets: " + sets.map(t => t.name + " (" + t.server + ")"
            + (selected() === ORCHESTRATOR ? "" : ": " + (t.description || t.tools.join(", ")))).join("; ") + "."
            + (selected() === ORCHESTRATOR ? " What each one does is in the MCP server catalog of the instructions." : ""),
        inputSchema: { type: "object", additionalProperties: false, required: ["toolset"],
          properties: { toolset: { type: "string", enum: sets.map(t => t.name) } } } }] : [];
    };
    Object.defineProperty(wrapped, "schemas", { get() {
      const ext = current();
      const base = ext ? own.schemas.filter(kept).concat(ext.tools.map(asSchema)) : own.schemas;
      const names = new Set(base.map(t => t.name));
      const extra = enabledTools().map(e => e.tool).filter(t => !names.has(t.name) && names.add(t.name)).map(asSchema);
      return base.concat(toolsetSchema(), extra);
    } });
    Object.defineProperty(wrapped, "instructions", { get() {
      const ext = current();
      return ext ? (own.instructions || "") + "\n\nSAP repository tools for this chat come from the MCP server " + ext.name
        + " (chosen in the VERTEX panel); VERTEX's own SAP read/write tools are not offered. The debugger and transpiler tools remain VERTEX's, and so does publish_sap_service_binding, which works on the system and client active in VERTEX."
        + (ext.note ? "\n\n" + ext.note : "")
        + (ext.instructions ? "\n\n" + ext.name + " says:\n" + ext.instructions : "") : own.instructions;
    } });
    // Defined, not assigned: VERTEX's own set may hold these as read-only properties, which assignment would refuse.
    const define = (key, value) => Object.defineProperty(wrapped, key, { value, enumerable: true });
    define("prepare", prepare);
    define("orchestrator", () => selected() === ORCHESTRATOR);
    const fromToolset = name => enabledTools().find(e => e.tool.name === name);
    define("external", name => { const ext = current(); return !!(ext && ext.tools.some(t => t.name === name)) || !!fromToolset(name); });
    define("mcpNote", () => { const ext = current(); return (ext ? "SAP tools come from the MCP server " + ext.name
      + "; the VERTEX tool names mentioned elsewhere (read_sap_object, read_sap_method, ...) are not available - use " + ext.name + "'s tools instead.\n" : "")
      + (selected() === ORCHESTRATOR ? catalogText()
        : offered().length ? "More SAP tools can be added with enable_toolset when the task needs them: " + offered().map(t => t.name + " - " + (t.description || t.tools.join(", ")) + (t.note ? " " + t.note : "")).join("; ") + ".\n" : ""); });
    define("execute", async (name, args) => {
      if (name === "enable_toolset") return enableToolset(String(args && args.toolset || ""));
      const ext = current();
      const mine = !!(ext && ext.tools.some(t => t.name === name));
      const extra = !mine && fromToolset(name);
      if (!mine && !extra) return own.execute(name, args);
      const result = await (mine ? ext : extra.run).client.call(name, args);
      const text = (result && result.content || []).map(c => c.type === "text" ? c.text : JSON.stringify(c)).join("\n");
      if (result && result.isError) throw new Error(text || name + " failed.");
      return text;
    });
    return wrapped;
  }

  /* Newer npm versions of the servers' packages, checked once after the window loads: server -> [{ name,
     installed, latest }] or { error }. Nothing is installed here; update() does it when the user asks. */
  let updates = {};
  const listeners = new Set();
  // Called when what checkUpdates() or update() found changes: the VERTEX panel redraws its Update button.
  const onUpdates = fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; };
  const told = () => { for (const fn of listeners) fn(); };
  async function checkUpdates() {
    const next = {};
    for (const entry of servers()) {
      const packages = packagesOf(entry);
      if (!packages.length) continue;
      try {
        next[entry.name] = [];
        for (const spec of packages) {
          const latest = await fetchLatest(spec.name);
          if (latest !== spec.version) next[entry.name].push({ name: spec.name, installed: spec.version, latest });
        }
      } catch (error) { next[entry.name] = { error: "Could not check for a newer version: " + error.message }; }
    }
    updates = next;
    told();
    return updates;
  }
  /* The user's Update: the newer versions go into vertex.chat.mcpVersions, the server starts on them, and the
     tool list it gives is kept with its version. A server that does not start is the error of this call. */
  async function update(name) {
    const found = updates[name];
    if (!servers().some(s => s.name === name) || !Array.isArray(found) || !found.length) throw new Error("No update is waiting for MCP server " + name + ".");
    await config().update("mcpVersions", { ...versions(), ...Object.fromEntries(found.map(u => [u.name, u.latest])) }, vscode.ConfigurationTarget.Global);
    await refresh(name);
    delete updates[name];
    told();
  }
  /* Starts server NAME once to read and keep its tool list; the chosen server is restarted instead. */
  async function refresh(name) {
    const old = runs.get(name);
    if (old) { old.client.stop(); runs.delete(name); dropEnabled(name); }
    await ensure(name);
  }
  /* Every server with what is kept of it: the info window's rows and the orchestrator's catalog. */
  function overview() {
    const kept = stored();
    return servers().map(entry => {
      const own = kept[entry.name];
      const sets = toolsets().filter(t => t.server === entry.name).map(t => ({ name: t.name, description: t.description || "", always: t.always === true,
        tools: own ? own.tools.filter(tool => t.tools.map(pattern).some(w => w.test(tool.name))).map(tool => tool.name) : [] }));
      const inSet = new Set(sets.flatMap(t => t.tools));
      return { name: entry.name, description: entry.description || "", version: own ? own.version : "", savedAt: own ? own.savedAt : "",
        packages: packagesOf(entry), update: updates[entry.name] || null, toolsets: sets,
        tools: own ? own.tools.map(tool => ({ ...tool, toolsets: sets.filter(t => t.tools.includes(tool.name)).map(t => t.name) })) : null,
        outside: own ? own.tools.filter(tool => !inSet.has(tool.name)).length : 0 };
    });
  }
  // The orchestrator's catalog for the model: what each server is for and the toolsets it can enable.
  /* A measured run showed the catalog alone pulling a model away from its own tools: asked for an object's last
     transport, it read "ADT: versions" and "ADT: transports" here, decided only those could answer, and - with a
     toolset arriving only from the next question in Claude Code and Codex - answered that it had no tools, without
     trying run_sap_select. So the catalog says first what the own tools reach, and forbids that dead end. */
  function catalogText() {
    return "Your own VERTEX SAP tools come first and answer most questions: search_sap_objects and read_sap_object / read_sap_method "
      + "find and read code; run_sap_select reads any table - transports and their objects (E070, E071), object versions (VRSD), "
      + "the object directory (TADIR), the dictionary (DD02L, DD03L) and application data. Use them before anything below.\n"
      + "Enable a toolset only for what your own tools cannot do. API providers and Copilot receive enabled tools on the next step in the same request. In Claude Code and Codex an enabled toolset arrives with the next "
      + "question: then still answer now with your own tools when they can, and say that the toolset is ready for the next question. "
      + "Never answer that you have no tools for a task you have not tried with your own tools.\n"
      + "The user switches the chat to one server in the VERTEX panel; you cannot.\n"
      + "MCP servers whose toolsets enable_toolset adds:\n" + overview().map(server =>
      "- " + server.name + (server.version ? " " + server.version : "") + ": " + (server.description || "no description configured.")
      + (server.toolsets.length ? "\n  Toolsets: " + server.toolsets.map(t => t.name + " - " + (t.description || "no description")
        + (server.tools ? " (" + t.tools.length + (t.tools.length === 1 ? " tool)" : " tools)") : "")).join("; ") + "." : "\n  No toolsets are configured for it in vertex.chat.toolsets.")
      + (server.tools ? (server.outside ? "\n  " + server.outside + " of its tools are in no toolset." : "") : "\n  Its tool list has not been read yet: it has not started in VERTEX.")).join("\n") + "\n";
  }

  /* The Settings search that shows what server NAME is configured by: SAP's adt.mcpServer settings for a server
     reached by URL from SAP's extension, the write settings a server's entry uses, the server list otherwise. */
  function settingsQuery(name) {
    if (name === VERTEX) return "vertex.chat";
    const entry = servers().find(s => s.name === name);
    if (!entry) return "vertex.chat.mcpServers";
    if (entry.url && /\$\{adtMcp/.test(JSON.stringify(entry))) return "adt.mcpServer";
    if (/\$\{vsp/.test(JSON.stringify(entry))) return "vertex.chat.vsp";
    const option = WRITE_OPTIONS.find(o => o.uses.test(JSON.stringify(entry)));
    return option ? "vertex.chat." + option.setting : "vertex.chat.mcpServers";
  }

  /* The write settings server NAME depends on, each with its current value. */
  function writeOptions(name) {
    const entry = servers().find(s => s.name === name);
    if (!entry) return [];
    const text = JSON.stringify(entry);
    return WRITE_OPTIONS.filter(o => o.uses.test(text)).map(o => ({ setting: o.setting, label: o.label, choices: o.choices,
      value: accessValue(name, o.setting) }));
  }
  async function setWriteOption(setting, value) {
    const option = WRITE_OPTIONS.find(o => o.setting === setting);
    if (!option || !option.choices.some(c => c.value === value)) throw new Error("VERTEX: " + value + " is not a choice of vertex.chat." + setting + ".");
    // Answered for this system and client; the setting keeps the answer as the default for systems not yet answered.
    const key = accessKey(selected());
    if (key) {
      const all = { ...(accessStore.get() || {}) };
      all[key] = { ...(all[key] || {}), [setting]: value };
      await accessStore.update(all);
    }
    await config().update(setting, value, vscode.ConfigurationTarget.Global);
  }

  return { VERTEX, ORCHESTRATOR, choices, needsInstall, checkUpdates, onUpdates, update, refresh, overview, servers, selected, prepare, wrap, stop, toolsets, settingsQuery, writeOptions, setWriteOption, accessRemembered, isRunning,
    select: name => config().update("mcpServer", name, vscode.ConfigurationTarget.Global) };
}

module.exports = { create, startClient, startHttpClient, VERTEX, ORCHESTRATOR, ACCESS, ABAP_ADT_ACCESS, fill, npmSpec };
