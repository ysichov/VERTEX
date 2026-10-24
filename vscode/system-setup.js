"use strict";
/* Setting up vertex.systems without knowing ADT's HTTP address by heart.

   What a reader already has: SAP Logon or an Eclipse ADT project knows each system's ID, host and instance number;
   the ADT workspace also knows the client and user. Neither reliably gives the HTTP port of the ICM, so
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
  const systems = [], skipped = [], texts = files.map(file => { try { return fs.readFileSync(file, "utf8"); } catch (_) { return ""; } });
  // A logon group's entry names no application server, only its message server (msid) - described by a <Messageserver>
  // element, in this file or the global one. Its host usually runs an ICM too, so that host is the one tried; the
  // instance comes from a message server port 36NN, when the port is written as a number.
  const messageServers = {};
  for (const text of texts) {
    for (const tag of text.match(/<Messageserver\b[^>]*>/g) || []) { const a = attributes(tag); if (a.uuid) { messageServers[a.uuid] = a; } }
  }
  for (const text of texts) {
    for (const tag of text.match(/<Service\b[^>]*>/g) || []) {
      const a = attributes(tag);
      if (a.type !== "SAPGUI" || !a.systemid) { continue; }
      const title = a.name || a.systemid;
      const sncDetails = a.sncname ? { partnerName: a.sncname, ...(a.sncop ? { qop: a.sncop } : {}) } : null;
      const snc = sncDetails && a.sncnosso !== "1";
      if (a.msid) {
        if (snc) { skipped.push(title + " (SNC logon group: no application server for RFC is specified)"); continue; }
        const ms = messageServers[a.msid], port = ms && /^36(\d\d)$/.exec(ms.port || "");
        if (!ms || !ms.host) { skipped.push(title + " (logon group, message server not described)"); continue; }
        systems.push({ id: a.systemid, title, host: ms.host, instance: port ? port[1] : "", group: a.server || "" });
        continue;
      }
      const server = /^(.+):32(\d\d)$/.exec(a.server || "");
      if (!server) { skipped.push(title + " (server " + (a.server || "not given") + ")"); continue; }
      systems.push({ id: a.systemid, title, host: server[1], instance: server[2],
        ...(sncDetails ? { snc: sncDetails } : {}), ...(snc ? { authType: "snc" } : {}) });
    }
  }
  return { systems, skipped };
}
function landscapeFiles() {
  if (process.platform !== "win32") { return []; }
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

/* ADT keeps each ABAP project's connection in the workspace, including on macOS where SAP Logon
   is usually absent. Read only the fields needed for an HTTP connection; never copy credentials. */
function eclipseProjects(workspace) {
  const root = path.join(workspace, ".metadata", ".plugins", "org.eclipse.core.resources.semantic", ".cache");
  let projects;
  try { projects = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return []; }
  const systems = [];
  for (const project of projects) {
    if (!project.isDirectory()) { continue; }
    let data;
    try { data = fs.readFileSync(path.join(root, project.name, ".destination.properties"), "utf8"); } catch (_) { continue; }
    const props = {};
    for (const line of data.split(/\r?\n/)) {
      const match = /^([^#!\s][^=]*)=(.*)$/.exec(line);
      if (match) { props[match[1].trim()] = match[2].trim(); }
    }
    const id = props.systemId, host = props.server, instance = props.systemNumber;
    if (!/^[A-Z0-9]{3}$/.test(id || "") || !host || !/^\d{2}$/.test(instance || "")) { continue; }
    systems.push({ id, title: props.systemConfiguration || project.name, host, instance,
      client: props.client || "", user: props.user || "" });
  }
  return systems;
}

/* Where Eclipse workspaces are, without asking: each Eclipse installation lists its recent workspaces in
   configuration/.settings/org.eclipse.ui.ide.prefs (RECENT_WORKSPACES, a Java properties value: "\:" for ":",
   "\\" for "\", entries split by "\n"). Installations are looked for in the usual Windows folders or macOS
   app bundles. Default workspace folders are added too. Only workspaces with ADT projects or logon settings are kept. */
function installations() {
  const home = process.env.USERPROFILE || process.env.HOME || "", found = [];
  const roots = process.platform === "darwin"
    ? ["/Applications", path.join(home, "Applications"), path.join(home, "eclipse")]
    : ["C:\\eclipse", "D:\\eclipse", "C:\\Program Files\\eclipse", path.join(home, "eclipse"),
      path.join(process.env.LOCALAPPDATA || "", "Programs")];
  const walk = (dir, depth) => {
    const prefs = path.join("configuration", ".settings", "org.eclipse.ui.ide.prefs");
    if (fs.existsSync(path.join(dir, prefs))) { found.push(dir); }
    if (process.platform === "darwin" && dir.endsWith(".app") && fs.existsSync(path.join(dir, "Contents", "Eclipse", prefs))) {
      found.push(path.join(dir, "Contents", "Eclipse"));
    }
    if (depth === 0) { return; }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) { if (entry.isDirectory() && !entry.name.startsWith(".")) { walk(path.join(dir, entry.name), depth - 1); } }
  };
  for (const root of roots) { if (fs.existsSync(root)) { walk(root, 3); } }
  return [...new Set(found)];
}
function recentWorkspaces(installation) {
  let text;
  try { text = fs.readFileSync(path.join(installation, "configuration", ".settings", "org.eclipse.ui.ide.prefs"), "utf8"); } catch (_) { return []; }
  const line = text.split(/\r?\n/).find(row => row.startsWith("RECENT_WORKSPACES="));
  if (!line) { return []; }
  const value = line.slice("RECENT_WORKSPACES=".length);
  const out = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      const next = value[++i];
      if (next === "n") { out.push(current); current = ""; } else { current += next; }
    } else { current += value[i]; }
  }
  out.push(current);
  return out.filter(Boolean);
}
function eclipseWorkspaces() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const all = [...installations().flatMap(recentWorkspaces), path.join(home, "eclipse-workspace"),
    ...(process.platform === "darwin" ? [path.join(home, "workspace"), path.join(home, "Documents", "workspace"),
      path.join(home, "Documents", "eclipse-workspace")] : [])];
  const seen = new Set(), result = [];
  for (const workspace of all) {
    const key = path.resolve(workspace).toLowerCase();
    if (seen.has(key)) { continue; }
    seen.add(key);
    const logons = eclipseLogons(workspace);
    const projects = eclipseProjects(workspace);
    if ((logons && Object.keys(logons).length) || projects.length) { result.push({ workspace, logons: logons || {}, projects }); }
  }
  return result;
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
  const ports = [...(instance ? [["https", "443" + instance], ["http", "80" + instance]] : []), ["https", "44300"], ["http", "8000"],
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
  // The first in order is the address; all that answered are kept for finding WebGUI.
  const answering = replies.filter(Boolean);
  return answering.length ? { ...answering[0], answering } : null;
}

/* Where the debugger can open WebGUI. It opens <webgui or url>/sap/bc/gui/sap/its/webgui; asked without a password,
   a 200 or a 401 there means WebGUI is served at that address. A redirect to another address is followed once - it
   is kept only when its host resolves from this computer. Otherwise the other addresses ADT answered on are tried,
   HTTPS first. The answer is the address to write as webgui, "" when the system's url serves it, or null when no
   address was found to serve it. */
function webguiReply(base, insecure) {
  return new Promise(resolve => {
    let target;
    try { target = new URL("/sap/bc/gui/sap/its/webgui", base); } catch (_) { resolve(null); return; }
    const secure = target.protocol === "https:";
    const req = (secure ? https : http).request({ hostname: target.hostname, port: target.port, path: target.pathname,
      method: "GET", timeout: 5000, ...(secure ? { rejectUnauthorized: !insecure } : {}) }, res => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location || "" });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(null));
    req.end();
  });
}
function resolves(hostname) {
  return new Promise(resolve => require("dns").lookup(hostname, error => resolve(!error)));
}
async function webguiAt(base, insecure) {
  const reply = await webguiReply(base, insecure);
  if (!reply) { return null; }
  if (reply.status === 200 || reply.status === 401) { return new URL(base).origin; }
  if (reply.status >= 300 && reply.status < 400 && reply.location) {
    let moved;
    try { moved = new URL(reply.location, base); } catch (_) { return null; }
    if (moved.origin === new URL(base).origin) { return null; }
    if (!(await resolves(moved.hostname))) { return null; }
    const again = await webguiReply(moved.origin, insecure);
    return again && (again.status === 200 || again.status === 401) ? moved.origin : null;
  }
  return null;
}
async function findWebgui(found, answering) {
  if (await webguiAt(found.url, found.insecure) === new URL(found.url).origin) { return ""; }
  const others = answering.filter(a => a.url !== found.url).sort((a, b) => (b.url.startsWith("https:") ? 1 : 0) - (a.url.startsWith("https:") ? 1 : 0));
  for (const candidate of [found, ...others]) {
    const at = await webguiAt(candidate.url, candidate.insecure);
    if (at && at !== new URL(found.url).origin) { return at; }
  }
  return null;
}


/* The Import command. Nothing is written until the reader has picked and confirmed. */
async function importSystems(vscode, context) {
  const config = vscode.workspace.getConfiguration("vertex");
  const existing = (config.get("systems") || []).filter(s => s && s.name);
  const known = new Set(existing.map(s => String(s.name).toUpperCase()));
  const { systems: sapLogon, skipped } = landscape(landscapeFiles());
  // Client and user from an Eclipse workspace: the ones Eclipse lists as recent are found and offered with the systems
  // they know; another folder can still be chosen.
  let workspace = context.globalState.get("vertex.eclipseWorkspace") || "";
  const found = eclipseWorkspaces();
  const said = f => [...new Set([...Object.keys(f.logons), ...f.projects.map(p => p.id)])].join(", ");
  const choice = await vscode.window.showQuickPick([
    ...found.map(f => ({ label: f.workspace, description: f.workspace === workspace ? "used last time" : "", detail: said(f), value: "found", workspace: f.workspace })),
    ...(workspace && !found.some(f => f.workspace === workspace) ? [{ label: "Use " + workspace, value: "kept" }] : []),
    { label: "Choose an Eclipse workspace folder…", description: "client and user of each system, from ADT", value: "choose" },
    { label: "No Eclipse workspace", description: "client and user are asked", value: "none" }],
    { title: "VERTEX: client and user from which Eclipse ADT workspace?", ignoreFocusOut: true });
  if (!choice) { return; }
  if (choice.value === "found") { workspace = choice.workspace; }
  if (choice.value === "choose") {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Use this workspace" });
    if (!picked || !picked.length) { return; }
    workspace = picked[0].fsPath;
  }
  if (choice.value === "none") { workspace = ""; }
  let logons = {}, projects = [];
  if (workspace) {
    logons = eclipseLogons(workspace) || {};
    projects = eclipseProjects(workspace);
    if (!Object.keys(logons).length && !projects.length) { throw new Error(workspace + " has no ADT projects or logon settings."); }
    await context.globalState.update("vertex.eclipseWorkspace", workspace);
  }

  const logon = [...sapLogon, ...projects.filter(p => !sapLogon.some(s =>
    s.id === p.id && s.host === p.host && s.instance === p.instance))];
  if (!logon.length) {
    throw new Error("No SAP systems found. Choose an Eclipse workspace with ABAP projects or configure SAP Logon."
      + (skipped.length ? " Skipped: " + skipped.join(", ") : ""));
  }

  // Only systems not yet in vertex.systems (switched off ones included) are offered - and probed.
  const fresh = [], seen = new Set();
  for (const s of logon) {
    const key = s.id + "|" + s.host + "|" + s.instance;
    if (seen.has(key) || known.has(String(s.id).toUpperCase())) { continue; }
    seen.add(key);
    fresh.push(s);
  }
  if (!fresh.length) {
    vscode.window.showInformationMessage("VERTEX: every system found in SAP Logon and Eclipse is already in vertex.systems.");
    return;
  }
  const candidates = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
    title: "VERTEX: looking for ADT on " + fresh.length + " systems" }, () => Promise.all(fresh.map(async s =>
      { const found = await probe(s.host, s.instance);
        return { ...s, found, webgui: found ? await findWebgui(found, found.answering) : null,
          logon: { client: s.client || logons[s.id]?.client || "", user: s.user || logons[s.id]?.user || "" } }; })));
  const items = candidates.map(c => ({
    label: c.id + "  " + c.title + (c.group !== undefined ? "  (logon group " + c.group + ", message server " + c.host + ")" : ""),
    description: (c.authType === "snc" ? "SNC · " : "") + (c.found ? c.found.url + (c.found.insecure ? " (certificate not verified)" : "") : "ADT did not answer on any usual port"),
    detail: [c.webgui ? "WebGUI at " + c.webgui : c.found && c.webgui === null ? "WebGUI not found" : "", c.logon.client ? "client " + c.logon.client : "client: asked", c.logon.user ? "user " + c.logon.user : "user: asked"].filter(Boolean).join(" · "),
    picked: !!c.found, candidate: c }));
  const chosen = await vscode.window.showQuickPick(items, { canPickMany: true, ignoreFocusOut: true,
    title: "VERTEX: systems to add to vertex.systems" + (skipped.length ? " (not offered: " + skipped.join(", ") + ")" : "") });
  if (!chosen || !chosen.length) { return; }

  const added = [], noWebgui = [];
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
    const client = c.logon.client || await vscode.window.showInputBox({ title: c.id + ": SAP client", prompt: "Enter the SAP client (leave empty for the system default)", ignoreFocusOut: true });
    if (client === undefined) { continue; }
    const user = c.logon.user || await vscode.window.showInputBox({ title: c.id + ": SAP user", prompt: "Enter the SAP user", ignoreFocusOut: true });
    if (!user) { continue; }
    const system = { name, url, ...(client ? { client } : {}), user };
    if (c.authType === "snc") { system.authType = "snc"; }
    if (c.snc) { system.snc = c.snc; }
    if (c.group === undefined) { system.rfc = { ashost: c.host, sysnr: c.instance }; }
    if (c.found && c.found.insecure) { system.allowInsecureCertificate = true; }
    // WebGUI found somewhere else than url: the debugger opens it there. Not found at all: said, left to the reader.
    if (url === (c.found && c.found.url) && c.webgui) { system.webgui = c.webgui; }
    if (url === (c.found && c.found.url) && c.webgui === null) { noWebgui.push(name); }
    added.push(system);
    known.add(name.toUpperCase());
  }
  if (!added.length) { return; }
  const systemsScope = config.inspect && config.inspect("systems");
  const systemsTarget = systemsScope && systemsScope.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : systemsScope && systemsScope.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update("systems", [...existing, ...added], systemsTarget);
  const selectedSystem = added.find(system => system.authType === "snc") || added[0];
  const activeScope = config.inspect && config.inspect("active");
  const activeTarget = activeScope && activeScope.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : activeScope && activeScope.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update("active", selectedSystem.name, activeTarget);
  const insecure = added.filter(s => s.allowInsecureCertificate).map(s => s.name);
  vscode.window.showInformationMessage("VERTEX: added " + added.map(s => s.name).join(", ") + " to vertex.systems and selected " + selectedSystem.name + "."
    + (insecure.length ? " " + insecure.join(", ") + ": the server certificate could not be verified, so allowInsecureCertificate is on." : "")
    + (noWebgui.length ? " " + noWebgui.join(", ") + ": no address serving WebGUI was found - for the debugger, set webgui by hand." : "")
    + " Test them with VERTEX: Test SAP Systems.");
}

async function removeSystems(vscode) {
  const config = vscode.workspace.getConfiguration("vertex");
  const existing = config.get("systems") || [];
  if (!existing.length) {
    vscode.window.showInformationMessage("VERTEX: no SAP systems are configured.");
    return;
  }
  const choices = existing.map((system, index) => ({
    label: system.name || "(unnamed system)",
    description: system.destination || system.url || "",
    index
  }));
  const selected = await vscode.window.showQuickPick(choices, {
    canPickMany: true,
    ignoreFocusOut: true,
    title: "VERTEX: remove systems from vertex.systems"
  });
  if (!selected || !selected.length) { return; }
  const removed = new Set(selected.map(item => item.index));
  const remaining = existing.filter((_, index) => !removed.has(index));
  const scope = config.inspect && config.inspect("systems");
  const target = scope && scope.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : scope && scope.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update("systems", remaining, target);

  const active = config.get("active");
  if (active && !remaining.some(system => system.name === active)) {
    const activeScope = config.inspect && config.inspect("active");
    const activeTarget = activeScope && activeScope.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
      : activeScope && activeScope.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update("active", remaining[0]?.name || "", activeTarget);
  }
  vscode.window.showInformationMessage("VERTEX: removed " + selected.map(item => item.label).join(", ") + " from vertex.systems.");
}

async function setSystemAuthType(vscode, name, useSNC) {
  const config = vscode.workspace.getConfiguration("vertex");
  const existing = config.get("systems") || [];
  const index = existing.findIndex(system => String(system && system.name || "").toLowerCase() === String(name || "").toLowerCase());
  if (index < 0) { throw new Error("SAP system " + name + " is no longer configured."); }
  const updated = existing.map(system => ({ ...system }));
  const candidate = { ...updated[index], authType: useSNC ? "snc" : "basic" };
  if (useSNC) {
    const validated = require("./auth/systems").readSystem(candidate);
    if (validated.error) { throw new Error(validated.error); }
  }
  updated[index] = candidate;
  const scope = config.inspect && config.inspect("systems");
  const target = scope && scope.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : scope && scope.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update("systems", updated, target);
}

module.exports = { importSystems, removeSystems, setSystemAuthType, findWebgui, webguiAt, landscape, eclipseLogons, eclipseProjects, eclipseWorkspaces, recentWorkspaces, probe, answers };
