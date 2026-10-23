"use strict";
const path = require("path");
const { readSystem, loginIdentity, connectionKey } = require("./systems");
const { createStores } = require("./stores");
const { migrateOnce, retireLegacy } = require("./migrate");
const { createBroker } = require("./broker");
const { createHttpWire } = require("./http-wire");
const { refusalFor } = require("./hosts");

function createAuth({ vscode, context, logger }) {
  const currentSystems = () => (vscode.workspace.getConfiguration("vertex").get("systems") || [])
    .filter(s => !(s && s.disabled === true)).map(readSystem).filter(r => r.system).map(r => r.system);
  const secrets = context.secrets;
  const { serviceKeyStore, sessionStore, means } = createStores({ secrets, currentSystems });
  const broker = createBroker({ serviceKeyStore, sessionStore, logger });
  const migrated = migrateOnce({ secrets, globalState: context.globalState, currentSystems });
  const refusals = new Map();
  const wires = new Set();          // every live wire, for disposeAll
  const commandWires = new Map();   // connectionKey → Promise<wire>
  const asking = new Map();         // login identity → pending password()

  let closed = false, disposing;
  const shutdownError = () => new Error("VERTEX is shutting down; the request was not sent.");

  function password(system) {
    if (system.authType !== "basic") return Promise.resolve(undefined);
    const id = loginIdentity(system);
    if (!asking.has(id)) asking.set(id, askPassword(system).finally(() => asking.delete(id)));
    return asking.get(id);
  }
  async function askPassword(system) {
    await migrated;
    const id = loginIdentity(system);
    let pw = await means.password(id);
    if (pw) return pw;
    pw = await vscode.window.showInputBox({ prompt: "SAP password for " + system.user + " on " + system.name, password: true, ignoreFocusOut: true });
    if (pw) {
      await means.setPassword(id, pw);
      await retireLegacy({ secrets, currentSystems, hasLogin: async other => !!(await means.password(other)) }, system.name);
    }
    return pw;
  }
  /* The SAP Systems table's Log in: a new password asked even when one is kept, kept when one is entered. */
  async function login(system) {
    if (system.authType !== "basic") throw new Error(system.name + " logs on with SNC; there is no password to enter.");
    await migrated;
    const pw = await vscode.window.showInputBox({ prompt: "SAP password for " + system.user + " on " + system.name, password: true, ignoreFocusOut: true });
    if (!pw) return false;
    await means.setPassword(loginIdentity(system), pw);
    return true;
  }
  async function onRefusal(system, refusal, moment) {
    refusals.set(loginIdentity(system), refusal);
    if (system.authType === "basic" && moment === "rejected") await means.forget(loginIdentity(system)).catch(() => {});
  }
  function hostRefusal(system) {
    let connectionDir;
    try { connectionDir = path.dirname(require.resolve("@mcp-abap-adt/connection/package.json")); } catch (_) { connectionDir = undefined; }
    return refusalFor(system, { platform: process.platform, remoteName: vscode.env.remoteName,
      resolve: name => require.resolve(name, connectionDir ? { paths: [connectionDir] } : undefined) });
  }
  async function newWire(system) {
    if (closed) throw shutdownError();
    const refused = hostRefusal(system);
    if (refused) throw new Error(refused);
    const pw = system.authType === "basic" ? await password(system) : undefined;
    if (closed) throw shutdownError();
    if (system.authType === "basic" && !pw) throw new Error("No password was entered for " + system.name + ", so nothing was sent.");
    const providerFor = s => broker.providerFor(s);
    const wire = system.authType === "snc"
      ? require("./rfc-wire").createRfcWire(system, { providerFor, logger })
      : createHttpWire(system, { providerFor, onRefusal,
          ensureMeans: async s => s.authType !== "basic" || !!(await password(s)) });
    wires.add(wire);
    const request = wire.request.bind(wire);
    wire.request = (...args) => {
      if (closed) return Promise.reject(shutdownError());
      wires.add(wire);
      return request(...args);
    };
    const dispose = wire.dispose.bind(wire);
    wire.dispose = () => { wires.delete(wire); return Promise.resolve(dispose()); };
    if (closed) { await wire.dispose(); throw shutdownError(); }
    return wire;
  }
  async function makeClient(system, role) {
    if (closed) throw shutdownError();
    const wire = await newWire(system);
    if (closed) { await wire.dispose(); throw shutdownError(); }
    const { ADTClient } = require("abap-adt-api");
    const client = new ADTClient(system.url, system.user, "-", system.client || "", "EN",
      { timeout: role === "listener" || role === "probe" || role === "debuggee" ? 300000 : 60000 });
    client.httpClient.httpclient = wire;
    // Keep automatic ADT login in the same operation as the request it follows.
    if (wire.runOperation) {
      const request = client.httpClient.request.bind(client.httpClient);
      client.httpClient.request = (...args) => wire.runOperation(() => request(...args));
    }
    client.dispose = () => wire.dispose();
    return client;
  }
  function commandWire(system) {
    if (closed) return Promise.reject(shutdownError());
    const key = connectionKey(system);
    if (!commandWires.has(key)) {
      const pending = newWire(system);
      commandWires.set(key, pending);
      pending.catch(() => commandWires.delete(key));
    }
    return commandWires.get(key);
  }
  function explain(system, error) {
    const text = (error && error.message) || String(error);
    if (!system) return text;
    const r = refusals.get(loginIdentity(system));
    const is401 = (error && error.status === 401) || /\b401\b/.test(text);
    return is401 && r ? text + " — " + r.reason + (r.hint ? " " + r.hint : "") : text;
  }
  return {
    systemOf: readSystem, currentSystems, makeClient, commandWire, password, login, hostRefusal, explain,
    lastRefusal: system => refusals.get(loginIdentity(system)),
    async forget(system) { await migrated; await means.forget(loginIdentity(system)); },
    disposeAll() {
      closed = true;
      if (!disposing) disposing = (async () => {
        const pending = [...commandWires.values()];
        commandWires.clear();
        const settled = await Promise.allSettled(pending);
        const all = new Set([...wires, ...settled.filter(r => r.status === "fulfilled").map(r => r.value)]);
        await Promise.allSettled([...all].map(w => w.dispose()));
      })();
      return disposing;
    },
  };
}
module.exports = { createAuth };
