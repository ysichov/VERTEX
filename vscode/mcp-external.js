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
  const error = new Error("MCP server " + entry.name + " could not be started: " + entry.command + " was not found."
    + (entry.command === "npx" ? " Install Node.js (https://nodejs.org), which brings npx, and restart VS Code."
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
      ? "could not be started: " + entry.command + " was not found. Install Node.js (https://nodejs.org), which brings npx, and reload VS Code."
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
      return { instructions: init && init.instructions || "", tools };
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
      return { instructions: init && init.instructions || "", tools };
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

function create({ vscode, active, password, storage }) {
  clearEnvFiles(storage);
  let running = null;   // { key, name, client, instructions, tools }
  let starting = null;
  const config = () => vscode.workspace.getConfiguration("vertex.chat");
  // A setting that is not a list names no servers; picking one then fails loudly in prepare().
  const servers = () => { const list = config().get("mcpServers"); return (Array.isArray(list) ? list : []).filter(s => s && s.name && (s.command || s.url) && s.name !== VERTEX); };
  const selected = () => String(config().get("mcpServer", VERTEX) || VERTEX);

  function stop() { if (running) running.client.stop(); running = null; }

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
    const access = ACCESS[config().get("arc1Access", "read-only")] || ACCESS["read-only"];
    const abapAdtPackage = ABAP_ADT_ACCESS[config().get("abapAdtAccess", "read-only")] || ABAP_ADT_ACCESS["read-only"];
    const vsp = VSP_ACCESS[config().get("vspAccess", "read-only")] || VSP_ACCESS["read-only"];
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
      const env = { ...process.env };
      for (const [k, v] of Object.entries(entry.env || {})) env[k] = fill(v, values);
      let envFile = null;
      if (entry.envFile) {
        const lines = {};
        for (const [k, v] of Object.entries(entry.envFile)) lines[k] = fill(v, values);
        envFile = writeEnvFile(storage, name, lines);
        values.envFile = envFile;
      }
      const removeEnvFile = () => { if (envFile) { try { fs.unlinkSync(envFile); } catch (_) { } envFile = null; } };
      const resolved = { ...entry, command: fill(entry.command, values), args: (entry.args || []).map(a => fill(a, values)),
        ...(/\$\{vspPath\}/.test(entry.command) ? { pathSetting: "vertex.chat.vspPath" } : {}) };
      if (!commandExists(resolved.command, env)) { removeEnvFile(); throw missingCommand(resolved); }
      let cwd;
      if (storage) { cwd = path.join(storage, "mcp-run"); fs.mkdirSync(cwd, { recursive: true }); }
      const client = startClient(resolved, env, 120000, removeEnvFile, cwd);
      try { return { client, ...(await client.open()) }; } catch (error) { client.stop(); throw error; }
    } };
  }

  /* The chosen server for the active system, started when needed; null for VERTEX's own tools. */
  async function prepare() {
    const name = selected();
    if (name === VERTEX) { stop(); return null; }
    const entry = servers().find(s => s.name === name);
    if (!entry) throw new Error("vertex.chat.mcpServer names " + name + ", which is not in vertex.chat.mcpServers. Pick a server in the VERTEX panel.");
    const { key, start } = plan(entry);
    if (running && running.key === key && running.client.alive()) return running;
    if (starting && starting.key === key) return starting.promise;
    stop();
    const promise = (async () => { running = { key, name, note: entry.note || "", ...(await start()) }; return running; })();
    starting = { key, promise };
    try { return await promise; } finally { if (starting && starting.key === key) starting = null; }
  }

  /* Toolsets: a few tools of another MCP server, offered to the model by one small enable_toolset tool and added
     only when it asks for them - so a question that needs none does not carry those servers' schemas. An
     enabled toolset stays for the rest of the session. */
  const toolsets = () => { const list = config().get("toolsets"); return (Array.isArray(list) ? list : []).filter(t => t && t.name && t.server && Array.isArray(t.tools)); };
  const toolsetRuns = new Map();   // server name -> { key, client, instructions, tools }
  const enabled = new Map();       // toolset name -> { server, run, tools }
  const pattern = glob => new RegExp("^" + String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  const offered = () => toolsets().filter(t => t.server !== selected());
  async function enableToolset(name) {
    const set = offered().find(t => t.name === name);
    if (!set) throw new Error("No toolset " + name + ". Toolsets: " + (offered().map(t => t.name).join(", ") || "none") + ".");
    const entry = servers().find(s => s.name === set.server);
    if (!entry) throw new Error("Toolset " + name + " names MCP server " + set.server + ", which is not in vertex.chat.mcpServers.");
    const { key, start } = plan(entry);
    let run = toolsetRuns.get(set.server);
    if (!run || run.key !== key || !run.client.alive()) {
      if (run) run.client.stop();
      run = { key, ...(await start()) };
      toolsetRuns.set(set.server, run);
    }
    const wanted = set.tools.map(pattern);
    const tools = run.tools.filter(t => wanted.some(w => w.test(t.name)));
    if (!tools.length) throw new Error("MCP server " + set.server + " offers none of the tools of toolset " + name + " (" + set.tools.join(", ") + ").");
    enabled.set(name, { server: set.server, run, tools });
    return { enabled: name, server: set.server, tools: tools.map(t => t.name),
      note: "These tools are offered from the next step on (in Claude Code and Codex, from the next question)" + (set.note ? ". " + set.note : ".") + (entry.note ? " " + entry.note : "") };
  }
  const enabledTools = () => [...enabled.values()].filter(e => e.server !== selected() && e.run.client.alive()).flatMap(e => e.tools.map(tool => ({ tool, run: e.run })));
  function stopToolsets() { for (const run of toolsetRuns.values()) run.client.stop(); toolsetRuns.clear(); enabled.clear(); }

  /* VERTEX's own tool set wrapped: with an external server chosen, its tools replace VERTEX's SAP repository
     tools; the debugger (debug_*) and the ABAP transpiler stay VERTEX's. */
  function wrap(own) {
    const kept = tool => /^debug_/.test(tool.name) || /abap_transpiler/.test(tool.name);
    const current = () => running && running.name === selected() && running.client.alive() ? running : null;
    const asSchema = t => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || { type: "object", properties: {} },
      ...(t.annotations ? { annotations: t.annotations } : {}) });
    const wrapped = Object.create(own);
    const toolsetSchema = () => {
      const sets = offered();
      return sets.length ? [{ name: "enable_toolset", annotations: { readOnlyHint: true, destructiveHint: false },
        description: "Add extra SAP tools from another MCP server when the task needs them; they are offered from the next step on (in Claude Code and Codex from the next question) and stay for the session. "
          + "Enable one only for what the other tools cannot do. Toolsets: " + sets.map(t => t.name + " (" + t.server + "): " + (t.description || t.tools.join(", "))).join("; ") + ".",
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
        + " (chosen in the VERTEX panel); VERTEX's own SAP read/write tools are not offered. The debugger and transpiler tools remain VERTEX's."
        + (ext.note ? "\n\n" + ext.note : "")
        + (ext.instructions ? "\n\n" + ext.name + " says:\n" + ext.instructions : "") : own.instructions;
    } });
    // Defined, not assigned: VERTEX's own set may hold these as read-only properties, which assignment would refuse.
    const define = (key, value) => Object.defineProperty(wrapped, key, { value, enumerable: true });
    define("prepare", prepare);
    const fromToolset = name => enabledTools().find(e => e.tool.name === name);
    define("external", name => { const ext = current(); return !!(ext && ext.tools.some(t => t.name === name)) || !!fromToolset(name); });
    define("mcpNote", () => { const ext = current(); return (ext ? "SAP tools come from the MCP server " + ext.name
      + "; the VERTEX tool names mentioned elsewhere (read_sap_object, read_sap_method, ...) are not available - use " + ext.name + "'s tools instead.\n" : "")
      + (offered().length ? "More SAP tools can be added with enable_toolset when the task needs them: " + offered().map(t => t.name + " - " + (t.description || t.tools.join(", ")) + (t.note ? " " + t.note : "")).join("; ") + ".\n" : ""); });
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

  /* The write settings server NAME depends on, each with its current value. */
  function writeOptions(name) {
    const entry = servers().find(s => s.name === name);
    if (!entry) return [];
    const text = JSON.stringify(entry);
    return WRITE_OPTIONS.filter(o => o.uses.test(text)).map(o => ({ setting: o.setting, label: o.label, choices: o.choices,
      value: String(config().get(o.setting, "read-only")) }));
  }
  async function setWriteOption(setting, value) {
    const option = WRITE_OPTIONS.find(o => o.setting === setting);
    if (!option || !option.choices.some(c => c.value === value)) throw new Error("VERTEX: " + value + " is not a choice of vertex.chat." + setting + ".");
    await config().update(setting, value, vscode.ConfigurationTarget.Global);
  }

  return { VERTEX, servers, selected, prepare, wrap, stop: () => { stop(); stopToolsets(); }, toolsets, writeOptions, setWriteOption,
    select: name => config().update("mcpServer", name, vscode.ConfigurationTarget.Global) };
}

module.exports = { create, startClient, startHttpClient, VERTEX, ACCESS, ABAP_ADT_ACCESS, fill };
