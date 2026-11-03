"use strict";
const fs = require("fs");
const path = require("path");
const LOGOFF = "/sap/public/bc/icf/logoff";
const STRIP = ["authorization", "cookie", "x-csrf-token", "x-sap-adt-sessiontype"];
// design/auth-broker/GATES.md gate 3: option B (SPEC §8.5). Local marker for
// abap-adt-api; never sent to SAP because §8.2 strips x-csrf-token outbound.
const CSRF_MARKER = "rfc";

function findRfcLibrary(env = process.env, exists = fs.existsSync) {
  const dirs = [env.SAPNWRFC_HOME && path.join(env.SAPNWRFC_HOME, "lib"), env.SAPNWRFC_HOME,
    env.SystemRoot && path.join(env.SystemRoot, "System32"),
    env.ProgramFiles && path.join(env.ProgramFiles, "SAP", "FrontEnd", "SAPgui"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "SAP", "FrontEnd", "SAPgui"),
    ...(env.PATH || env.Path || "").split(path.delimiter)];
  for (const dir of dirs.filter(Boolean)) {
    const file = path.join(dir, "sapnwrfc.dll");
    if (exists(file)) return file;
  }
  return null;
}

function sdkSentence(error) {
  return "SNC needs the SAP NW RFC SDK: install it, put its lib directory on PATH (Windows) or "
    + "DYLD_LIBRARY_PATH (macOS), and restart VS Code. The load failed with: " + (error && error.message || error);
}
function loadClient() {
  if (process.platform === "win32") {
    const library = findRfcLibrary();
    if (!library) throw new Error("SNC needs sapnwrfc.dll. VERTEX searched SAPNWRFC_HOME, Windows System32, SAP GUI and PATH. Install the SAP NW RFC library and restart VS Code.");
    const dir = path.dirname(library);
    if (!(process.env.PATH || "").split(path.delimiter).some(part => part.toLowerCase() === dir.toLowerCase()))
      process.env.PATH = dir + path.delimiter + (process.env.PATH || "");
  }
  const connectionDir = path.dirname(require.resolve("@mcp-abap-adt/connection/package.json"));
  try { return require(require.resolve("@mcp-abap-adt/sap-rfc-lite", { paths: [connectionDir] })).Client; }
  catch (e) { throw new Error(sdkSentence(e)); }
}
function defaultConnector(system, provider, open, logger) {
  const { AdtOnPremConnector, RfcTransport } = require("@mcp-abap-adt/connection");
  const config = { url: system.url, client: system.client || undefined, authType: "snc",
    sncPartnerName: system.snc.partnerName, sncQop: system.snc.qop, sncLib: system.snc.library, sncMyName: system.snc.myName };
  return new AdtOnPremConnector(config, provider, new RfcTransport(open, logger), logger);
}

// The NW RFC SDK's logon parameters for SYSTEM: its application server, or its message server and logon group.
function rfcAddress(system, logon = {}) {
  const rfc = system.rfc;
  const address = rfc.mshost
    ? { mshost: rfc.mshost, sysid: rfc.sysid, group: rfc.group || "PUBLIC", ...(rfc.msserv ? { msserv: rfc.msserv } : {}), lang: "EN" }
    : { ashost: rfc.ashost, sysnr: rfc.sysnr, lang: "EN" };
  if (rfc.saprouter) address.saprouter = rfc.saprouter;
  if (system.client) address.client = system.client;
  return { ...address, ...logon };
}

// Where RFC goes, in words, for an error and the VERTEX output: never a user, password or ticket.
function describeAddress(system) {
  const rfc = system.rfc;
  return (rfc.mshost
    ? "message server " + rfc.mshost + (rfc.msserv ? ":" + rfc.msserv : "") + ", system " + rfc.sysid + ", group " + (rfc.group || "PUBLIC")
    : "application server " + rfc.ashost + ", instance " + rfc.sysnr) + (rfc.saprouter ? ", via SAProuter" : "");
}

// TRACE: () => { level, folder } - vertex.rfcTrace. Level 1-3 has the NW RFC SDK write dev_rfc*.log files there.
function createRfcWire(system, { providerFor, logger = null, connector = defaultConnector, trace = () => ({ level: 0 }) }) {
  let session = null;          // the live connector, or null
  let queue = Promise.resolve();
  let mode = "stateless";
  const run = work => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };

  function open(logon) {
    const Client = loadClient();
    const { level = 0, folder = "" } = trace() || {};
    const address = rfcAddress(system, logon);
    if (level > 0) {
      address.trace = String(level);
      if (folder) { fs.mkdirSync(folder, { recursive: true }); process.env.RFC_TRACE_DIR = folder; }
    }
    if (logger) logger.info("RFC " + system.name + ": connecting through " + describeAddress(system)
      + (system.client ? ", client " + system.client : "") + (level > 0 ? "; SDK trace level " + level + " in " + (folder || "the working folder") : ""));
    try { return new Client(address); } catch (e) { throw new Error(sdkSentence(e)); }
  }
  async function live() {
    if (session) return session;
    const provider = await providerFor(system);
    const c = connector(system, provider, open, logger);
    try { await c.connect(); }
    catch (e) {
      // The SDK says what failed, not where it was asked: the address goes in front.
      if (e && typeof e.message === "string" && !e.message.startsWith("RFC through ")) e.message = "RFC through " + describeAddress(system) + ": " + e.message;
      if (logger) logger.error(e && e.message || String(e));
      throw e;
    }
    session = c;
    return c;
  }
  async function end() {
    const c = session; session = null;
    if (c) await c.disconnect().catch(() => {});
  }
  function respond(r) {
    const headers = { ...(r.headers || {}) };
    if (CSRF_MARKER && headers["x-csrf-token"] === undefined) headers["x-csrf-token"] = CSRF_MARKER;
    return { body: typeof r.data === "string" ? r.data : r.data == null ? "" : String(r.data), status: r.status, statusText: r.statusText || "", headers };
  }

  return {
    request(options) {
      return run(async () => {
        const url = new URL(options.url, "http://rfc.invalid");
        if (url.pathname === LOGOFF) { await end(); return respond({ status: 200, statusText: "OK", headers: {}, data: "" }); }
        const headers = {};
        for (const [k, v] of Object.entries(options.headers || {})) {
          if (k.toLowerCase() === "x-sap-adt-sessiontype") { if (v === "stateful" || v === "stateless") mode = v; continue; }
          if (!STRIP.includes(k.toLowerCase())) headers[k] = v;
        }
        const c = await live();
        c.setSessionType(mode);
        try {
          const r = await c.makeAdtRequest({ url: url.pathname + url.search, method: options.method || "GET",
            params: options.qs, data: options.body, headers, timeout: options.timeout || 60000 });
          return respond(r);
        } catch (e) {
          // An HTTP-status failure carries the answer (RfcTransport.ts:700); a credential refusal
          // arrives as AuthRefusedError with the original failure under .cause (authErrors.ts:24).
          if (e && e.response) return respond(e.response);
          if (e && e.cause && e.cause.response) return respond(e.cause.response);
          throw e;
        }
      });
    },
    dispose() { return run(end); },
  };
}
module.exports = { createRfcWire, rfcAddress, describeAddress, sdkSentence, findRfcLibrary };
