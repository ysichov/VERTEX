"use strict";
const crypto = require("crypto");
const TYPES = ["basic", "snc"];
const QOPS = ["1", "2", "3", "8", "9"];

function canonicalOrigin(url) {
  const u = new URL(url);
  const port = u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
  return u.protocol.toLowerCase() + "//" + u.hostname.toLowerCase() + (port ? ":" + port : "");
}

/* The clients of one entry: its list (numbers or text), with the default client first when the list leaves it out. */
function clientsOf(e) {
  if (e.clients === undefined) return { list: [] };
  if (!Array.isArray(e.clients)) return { error: "clients must be a list of SAP clients, e.g. [\"600\", \"610\"]." };
  const list = [];
  for (const item of e.clients) {
    const client = typeof item === "number" ? String(item) : item;
    if (typeof client !== "string" || !/^\d{1,3}$/.test(client.trim())) return { error: "clients has " + JSON.stringify(item) + "; a client is one to three digits." };
    if (!list.includes(client.trim())) list.push(client.trim());
  }
  const first = String(e.client || "").trim();
  if (first && !list.includes(first)) list.unshift(first);
  return { list };
}

/** One vertex.systems entry → a validated system, or a sentence naming what is wrong. CHOSEN is the client picked in the
 * SAP Systems table; the entry's `client` is the default, used while none is picked or the picked one has left the list. */
function readSystem(entry, chosen) {
  const e = entry || {};
  const name = String(e.name || "").trim() || "(unnamed)";
  if (Object.prototype.hasOwnProperty.call(e, "password")) {
    return { error: "System " + name + " has a password in settings. Remove it: VERTEX keeps passwords in the OS credential store and asks for them." };
  }
  if (e.connection) return { error: "System " + name + " uses unsupported connection " + JSON.stringify(e.connection) + ". Import it again for direct RFC/SNC, or remove the old entry." };
  const authType = e.authType === undefined || e.authType === "" ? "basic" : e.authType;
  if (!TYPES.includes(authType)) return { error: "System " + name + " has authType " + JSON.stringify(e.authType) + "; this VERTEX knows " + TYPES.join(" and ") + "." };
  const gaps = [];
  if (!e.url) gaps.push("url");
  if (!e.user) gaps.push("user");
  if (gaps.length) return { error: "System " + name + " has no " + gaps.join(" and ") + "." };
  try { canonicalOrigin(e.url); } catch (_) { return { error: "The url of " + name + " is not a valid one: " + e.url }; }
  for (const field of ["url", "webgui"]) {
    if (!e[field]) continue;
    let parsed;
    try { parsed = new URL(e[field]); } catch (_) { continue; }
    if (parsed.username || parsed.password) return { error: "System " + name + " has a user or password in its " + field + ". Remove it: VERTEX keeps passwords in the OS credential store and asks for them." };
  }
  const clients = clientsOf(e);
  if (clients.error) return { error: "System " + name + ": " + clients.error };
  const client = clients.list.includes(String(chosen)) ? String(chosen) : e.client || clients.list[0] || "";
  const system = { name, url: e.url, client, user: e.user, authType,
    webgui: e.webgui, allowInsecureCertificate: e.allowInsecureCertificate === true };
  if (clients.list.length) system.clients = clients.list;
  if (authType === "snc") {
    const snc = e.snc || {}, rfc = e.rfc || {};
    if (!snc.partnerName) return { error: "System " + name + " is snc and has no snc.partnerName (the system's SNC name, e.g. p:CN=SID, O=ACME)." };
    if (snc.qop !== undefined && !QOPS.includes(String(snc.qop))) return { error: "System " + name + " has snc.qop " + snc.qop + "; use 1, 2, 3, 8 or 9." };
    system.snc = { partnerName: snc.partnerName, qop: snc.qop, library: snc.library, myName: snc.myName };
    // RFC reaches the system as SAP Logon does: at one application server (ashost, sysnr), or through its message
    // server, which picks a server of the logon group (mshost, sysid, group; msserv when the port is not sapms<SID>).
    if (rfc.mshost && !rfc.ashost) {
      if (!/^[A-Z0-9]{3}$/i.test(String(rfc.sysid || ""))) return { error: "System " + name + " has rfc.mshost and needs rfc.sysid, the three-character system ID, e.g. PRD." };
      if (rfc.msserv !== undefined && rfc.msserv !== "" && !/^[\w.-]+$/.test(String(rfc.msserv))) return { error: "System " + name + " has rfc.msserv " + JSON.stringify(rfc.msserv) + "; give the message server's port or service, e.g. 3600 or sapmsPRD." };
      system.rfc = { mshost: rfc.mshost, sysid: String(rfc.sysid).toUpperCase(), group: String(rfc.group || "PUBLIC"),
        ...(rfc.msserv ? { msserv: String(rfc.msserv) } : {}), saprouter: rfc.saprouter };
    } else {
      if (!rfc.ashost) return { error: "System " + name + " is snc and has no rfc.ashost (the application server host) or rfc.mshost (its message server)." };
      if (!/^\d\d$/.test(String(rfc.sysnr || ""))) return { error: "System " + name + " needs rfc.sysnr as two digits, e.g. 00." };
      system.rfc = { ashost: rfc.ashost, sysnr: String(rfc.sysnr), saprouter: rfc.saprouter };
    }
  }
  return { system };
}

function loginIdentity(system) {
  const parts = [canonicalOrigin(system.url), system.client || "", system.authType, String(system.user).toUpperCase()];
  return "vertex.auth.v1." + crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

function connectionKey(system) {
  return JSON.stringify([system.name, canonicalOrigin(system.url), system.client || "", String(system.user).toUpperCase(),
    system.authType, system.allowInsecureCertificate === true, system.snc || null, system.rfc || null]);
}

/** Read current broker keys and the URL-first keys retained by older saved editors.
 * Plain system names are also accepted (for search result labels).
 */
function keyInfo(key) {
  let parts = key;
  if (typeof parts === "string") {
    try { parts = JSON.parse(parts); } catch (_) { return { name: key }; }
  }
  if (!Array.isArray(parts)) return { name: "" };
  const current = parts[4] === "basic" || parts[4] === "snc";
  return { name: String(parts[current ? 0 : 3] || "") };
}

module.exports = { readSystem, canonicalOrigin, loginIdentity, connectionKey, keyInfo };
