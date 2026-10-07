"use strict";
/* Setting up vertex.systems without knowing ADT's HTTP address by heart.

   What a reader already has: SAP Logon knows each system's ID, host and instance number; an Eclipse workspace with
   ADT projects knows the client and the user of each system ID. What neither knows is the HTTP port of the ICM, so
   the instance's defaults (HTTPS 443NN, HTTP 80NN) and the usual others are asked, and only an address that answers is offered.
   A guess that does not answer is said as such, and the reader types the address. */
const fs = require("fs"), path = require("path"), http = require("http"), https = require("https");

/* SAP Logon's systems: <Service type="SAPGUI" ... systemid="E19" server="host:3200"/>. An entry through a message
   server has no server attribute and is reported, not guessed. The file is XML, read as attributes of one element. */
function attributes(tag) {
  const found = {}, pattern = /([A-Za-z_]+)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(tag))) { found[match[1]] = match[2]; }
  return found;
}
function landscape(files) {
  const systems = [], skipped = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch (_) { continue; }
    for (const tag of text.match(/<Service\b[^>]*>/g) || []) {
      const a = attributes(tag);
      if (a.type !== "SAPGUI" || !a.systemid) { continue; }
      const server = /^(.+):32(\d\d)$/.exec(a.server || "");
      if (!server) { skipped.push((a.name || a.systemid) + " (" + (a.server ? "server " + a.server : "message server") + ")"); continue; }
      systems.push({ id: a.systemid, title: a.name || a.systemid, host: server[1], instance: server[2] });
    }
  }
  return { systems, skipped };
}
function landscapeFiles() {
  const common = path.join(process.env.APPDATA || "", "SAP", "Common");
  return [path.join(common, "SAPUILandscape.xml"), path.join(common, "SAPUILandscapeGlobal.xml")];
}

/* ADT's logon defaults in an Eclipse workspace: <SID>.com.sap.adt...LogonDataComposite.CLIENT=100 and .USER=... */
function eclipseLogons(workspace) {
  const file = path.join(workspace, ".metadata", ".plugins", "org.eclipse.core.runtime", ".settings", "com.sap.adt.destinations.ui.prefs");
  const logons = {};
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (_) { return null; }
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9]{3})\.com\.sap\.adt\.destinations\.ui\.internal\.logon\.LogonDataComposite\.(CLIENT|USER)=(.*)$/.exec(line);
    if (match) { (logons[match[1]] = logons[match[1]] || {})[match[2].toLowerCase()] = match[3].trim(); }
  }
  return logons;
}

/* Whether ADT answers at an address: any HTTP status counts - 401 is the usual one without a password. A certificate
   that cannot be verified is tried again without the check, and said. */
function answers(url, insecure) {
  return new Promise(resolve => {
    let base;
    try { base = new URL(url); } catch (_) { resolve({ ok: false, why: "not a valid address" }); return; }
    const secure = base.protocol === "https:";
    const req = (secure ? https : http).request({ hostname: base.hostname, port: base.port, path: "/sap/bc/adt/discovery",
      method: "GET", timeout: 5000, ...(secure ? { rejectUnauthorized: !insecure } : {}) }, res => {
      res.resume();
      resolve({ ok: true, status: res.statusCode });
    });
    req.on("timeout", () => req.destroy(new Error("no answer in 5 s")));
    req.on("error", error => {
      const code = String(error.code || "");
      resolve({ ok: false, certificate: code.includes("CERT") || code.includes("SELF_SIGNED") || code.includes("UNABLE_TO_VERIFY"),
        why: error.message || code });
    });
    req.end();
  });
}
/* The addresses tried, in this order: the instance's defaults, then ports seen on systems that do not follow them -
   44300 / 8000 (an instance 00 reached on another host name), 50001 / 50000 (SAP's ABAP developer image), plain
   443 / 80 behind a web dispatcher, 8443 / 8080. All are asked at once; the first in this order that answers wins. */
function addresses(host, instance) {
  const ports = [["https", "443" + instance], ["http", "80" + instance], ["https", "44300"], ["http", "8000"],
    ["https", "50001"], ["http", "50000"], ["https", "443"], ["http", "80"], ["https", "8443"], ["http", "8080"]];
  return [...new Set(ports.map(([scheme, port]) => scheme + "://" + host + ":" + port))];
}
async function probe(host, instance) {
  const replies = await Promise.all(addresses(host, instance).map(async url => {
    let reply = await answers(url, false);
    if (reply.ok) { return { url, insecure: false, status: reply.status }; }
    if (reply.certificate) {
      reply = await answers(url, true);
      if (reply.ok) { return { url, insecure: true, status: reply.status }; }
    }
    return null;
  }));
  return replies.find(Boolean) || null;
}

/* The Import command. Nothing is written until the reader has picked and confirmed. */
async function importSystems(vscode, context) {
  const config = vscode.workspace.getConfiguration("vertex");
  const existing = (config.get("systems") || []).filter(s => s && s.name);
  const known = new Set(existing.map(s => String(s.name).toUpperCase()));
  const { systems: logon, skipped } = landscape(landscapeFiles());
  if (!logon.length) {
    throw new Error("No SAP Logon systems with a host and instance were found in " + landscapeFiles().join(" or ")
      + (skipped.length ? ". Skipped: " + skipped.join(", ") : "") + ".");
  }
  // Client and user from an Eclipse workspace, when the reader has one: the folder is asked once and remembered.
  let workspace = context.globalState.get("vertex.eclipseWorkspace") || "";
  const choice = await vscode.window.showQuickPick([
    ...(workspace ? [{ label: "Use " + workspace, value: "kept" }] : []),
    { label: "Choose an Eclipse workspace folder…", description: "client and user of each system, from ADT", value: "choose" },
    { label: "No Eclipse workspace", description: "client and user are asked", value: "none" }],
    { title: "VERTEX: client and user from Eclipse ADT?", ignoreFocusOut: true });
  if (!choice) { return; }
  if (choice.value === "choose") {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Use this workspace" });
    if (!picked || !picked.length) { return; }
    workspace = picked[0].fsPath;
  }
  if (choice.value === "none") { workspace = ""; }
  let logons = {};
  if (workspace) {
    logons = eclipseLogons(workspace);
    if (!logons) { throw new Error(workspace + " has no ADT logon settings (.metadata/.plugins/org.eclipse.core.runtime/.settings/com.sap.adt.destinations.ui.prefs)."); }
    await context.globalState.update("vertex.eclipseWorkspace", workspace);
  }

  const fresh = [], seen = new Set();
  for (const s of logon) {
    const key = s.id + "|" + s.host + "|" + s.instance;
    if (seen.has(key)) { continue; }
    seen.add(key);
    fresh.push(s);
  }
  const candidates = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
    title: "VERTEX: looking for ADT on " + fresh.length + " systems" }, () => Promise.all(fresh.map(async s =>
      ({ ...s, found: await probe(s.host, s.instance), logon: logons[s.id] || {} }))));
  const items = candidates.map(c => ({
    label: c.id + "  " + c.title,
    description: c.found ? c.found.url + (c.found.insecure ? " (certificate not verified)" : "") : "ADT did not answer on any usual port",
    detail: [c.logon.client ? "client " + c.logon.client : "client: asked", c.logon.user ? "user " + c.logon.user : "user: asked",
      known.has(c.id) ? "a system named " + c.id + " is already configured" : ""].filter(Boolean).join(" · "),
    picked: !!c.found && !known.has(c.id), candidate: c }));
  const chosen = await vscode.window.showQuickPick(items, { canPickMany: true, ignoreFocusOut: true,
    title: "VERTEX: systems to add to vertex.systems" + (skipped.length ? " (not offered: " + skipped.join(", ") + ")" : "") });
  if (!chosen || !chosen.length) { return; }

  const added = [];
  for (const { candidate: c } of chosen) {
    let name = c.id;
    for (let n = 2; known.has(name.toUpperCase()); n++) { name = c.id + "_" + n; }
    let url = c.found && c.found.url;
    if (!url) {
      url = await vscode.window.showInputBox({ title: c.id + ": ADT address", ignoreFocusOut: true,
        prompt: "ADT did not answer on " + c.host + " at any usual port. The HTTP(S) port is in SMICM > Goto > Services.",
        value: "https://" + c.host + ":443" + c.instance });
      if (!url) { continue; }
    }
    const client = c.logon.client || await vscode.window.showInputBox({ title: c.id + ": SAP client", prompt: "Empty for the system default", ignoreFocusOut: true });
    if (client === undefined) { continue; }
    const user = c.logon.user || await vscode.window.showInputBox({ title: c.id + ": SAP user", ignoreFocusOut: true });
    if (!user) { continue; }
    const system = { name, url, ...(client ? { client } : {}), user };
    if (c.found && c.found.insecure) { system.allowInsecureCertificate = true; }
    added.push(system);
    known.add(name.toUpperCase());
  }
  if (!added.length) { return; }
  await config.update("systems", [...existing, ...added], vscode.ConfigurationTarget.Global);
  const insecure = added.filter(s => s.allowInsecureCertificate).map(s => s.name);
  vscode.window.showInformationMessage("VERTEX: added " + added.map(s => s.name).join(", ") + " to vertex.systems."
    + (insecure.length ? " " + insecure.join(", ") + ": the server certificate could not be verified, so allowInsecureCertificate is on." : "")
    + " Test them with VERTEX: Test SAP Systems.");
}

module.exports = { importSystems, landscape, eclipseLogons, probe, answers };
