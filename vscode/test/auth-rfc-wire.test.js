"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createRfcWire, findRfcLibrary } = require("../auth/rfc-wire");
const { readSystem } = require("../auth/systems");
const system = readSystem({ name: "S", url: "https://s", user: "u", authType: "snc", snc: { partnerName: "p:CN=S" }, rfc: { ashost: "s", sysnr: "00" } }).system;

// sapnwrfc.dll and its folders are Windows paths, joined by the platform's path.
test("RFC library discovery checks the installed SDK, Windows and SAP GUI", { skip: process.platform !== "win32" && "Windows only" }, () => {
  const env = { SAPNWRFC_HOME: "C:\\sdk", SystemRoot: "C:\\Windows", "ProgramFiles(x86)": "C:\\Program Files (x86)", PATH: "C:\\other" };
  assert.equal(findRfcLibrary(env, file => file === "C:\\Windows\\System32\\sapnwrfc.dll"), "C:\\Windows\\System32\\sapnwrfc.dll");
  assert.equal(findRfcLibrary(env, file => file === "C:\\sdk\\lib\\sapnwrfc.dll"), "C:\\sdk\\lib\\sapnwrfc.dll");
  assert.equal(findRfcLibrary(env, () => false), null);
});

function fakeFactory(log) {
  let n = 0;
  return () => {
    const id = ++n; let mode = "stateless"; let spent = false;
    const c = {
      id, async connect() { if (spent) throw new Error("spent"); log.push(["connect", id]); },
      setSessionType(m) { mode = m; },
      async makeAdtRequest(o) {
        log.push(["req", id, mode, o.method, o.url, Object.keys(o.headers || {}).map(h => h.toLowerCase()).sort().join(",")]);
        await new Promise(r => setTimeout(r, 5));
        if (o.url.includes("fail")) { const e = new Error("SAP said no"); e.response = { status: 400, statusText: "Bad", headers: {}, data: "<x/>" }; throw e; }
        return { status: 200, statusText: "OK", headers: {}, data: "body" + id };
      },
      async disconnect() { spent = true; log.push(["disconnect", id]); },
    };
    return c;
  };
}
const wireWith = log => createRfcWire(system, { providerFor: async () => ({}), logger: null, connector: fakeFactory(log) });

test("mapping: default GET, headers stripped, response mapped", async () => {
  const log = []; const w = wireWith(log);
  const r = await w.request({ url: "/sap/bc/adt/discovery", headers: { Authorization: "x", Cookie: "c", "x-csrf-token": "fetch", "X-sap-adt-sessiontype": "stateless", Accept: "a" } });
  assert.equal(r.status, 200); assert.equal(r.body, "body1");
  const req = log.find(l => l[0] === "req");
  assert.equal(req[3], "GET"); assert.equal(req[5], "accept");
});
test("mapping: qs becomes params, body becomes data, method passes", async () => {
  const seen = [];
  const w = createRfcWire(system, { providerFor: async () => ({}), logger: null, connector: () => ({
    async connect() {}, setSessionType() {}, async disconnect() {},
    async makeAdtRequest(o) { seen.push(o); return { status: 200, statusText: "OK", headers: {}, data: "" }; } }) });
  await w.request({ url: "/sap/bc/adt/x?a=1", method: "PUT", qs: { b: "2" }, body: "<x/>" });
  assert.equal(seen[0].method, "PUT"); assert.deepEqual(seen[0].params, { b: "2" }); assert.equal(seen[0].data, "<x/>");
  assert.equal(seen[0].url, "/sap/bc/adt/x?a=1");
});
test("a credential refusal without a response is thrown with its sentence, a cause with a response is the response", async () => {
  const mk = err => createRfcWire(system, { providerFor: async () => ({}), logger: null, connector: () => ({
    async connect() {}, setSessionType() {}, async disconnect() {}, async makeAdtRequest() { throw err; } }) });
  const refused = Object.assign(new Error("SNC logon refused: no credential"), { name: "AuthRefusedError" });
  await assert.rejects(mk(refused).request({ url: "/a" }), /SNC logon refused/);
  const wrapped = Object.assign(new Error("wrapped"), { cause: { response: { status: 403, statusText: "Forbidden", headers: {}, data: "no" } } });
  const r = await mk(wrapped).request({ url: "/a" });
  assert.equal(r.status, 403); assert.equal(r.body, "no");
});
test("session mode: stateful, keep, stateless", async () => {
  const log = []; const w = wireWith(log);
  await w.request({ url: "/a", headers: { "X-sap-adt-sessiontype": "stateful" } });
  await w.request({ url: "/b", headers: { "X-sap-adt-sessiontype": "" } });
  await w.request({ url: "/c", headers: { "X-sap-adt-sessiontype": "stateless" } });
  assert.deepEqual(log.filter(l => l[0] === "req").map(l => l[2]), ["stateful", "stateful", "stateless"]);
});
test("overlapping requests are serialized with their own modes", async () => {
  const log = []; const w = wireWith(log);
  await Promise.all([w.request({ url: "/a", headers: { "X-sap-adt-sessiontype": "stateful" } }),
    w.request({ url: "/b", headers: { "X-sap-adt-sessiontype": "stateless" } })]);
  assert.deepEqual(log.filter(l => l[0] === "req").map(l => [l[4], l[2]]), [["/a", "stateful"], ["/b", "stateless"]]);
});
test("logoff is answered locally, ends the session; next request opens a new one", async () => {
  const log = []; const w = wireWith(log);
  await w.request({ url: "/read" });
  const r = await w.request({ url: "/sap/public/bc/icf/logoff" });
  assert.equal(r.status, 200);
  await w.request({ url: "/read" });
  assert.deepEqual(log.filter(l => l[0] !== "req"), [["connect", 1], ["disconnect", 1], ["connect", 2]]);
  assert.equal(log.filter(l => l[0] === "req" && l[4].includes("logoff")).length, 0);
});
test("read, apply (logoff), read, apply on one wire", async () => {
  const log = []; const w = wireWith(log);
  for (const u of ["/read", "/apply", "/sap/public/bc/icf/logoff", "/read", "/apply", "/sap/public/bc/icf/logoff"]) await w.request({ url: u });
  assert.equal(log.filter(l => l[0] === "connect").length, 2);
});
test("a response-bearing failure becomes the response", async () => {
  const log = []; const w = wireWith(log);
  const r = await w.request({ url: "/fail" });
  assert.equal(r.status, 400); assert.equal(r.body, "<x/>");
});
test("a failed open leaves no session and the next request tries again", async () => {
  let fail = true; const log = [];
  const factory = fakeFactory(log);
  const w = createRfcWire(system, { providerFor: async () => ({}), logger: null,
    connector: (...a) => { const c = factory(...a); if (fail) { fail = false; c.connect = async () => { throw new Error("no SNC"); }; } return c; } });
  await assert.rejects(w.request({ url: "/a" }), /no SNC/);
  const r = await w.request({ url: "/a" }); assert.equal(r.status, 200);
});
test("dispose ends the session and the wire stays usable", async () => {
  const log = []; const w = wireWith(log);
  await w.request({ url: "/a" }); await w.dispose(); await w.request({ url: "/b" });
  assert.equal(log.filter(l => l[0] === "connect").length, 2);
});

test("option B: every returned response has the local marker, preserving an existing token", async () => {
  const w = wireWith([]);
  for (const url of ["/normal", "/fail", "/sap/public/bc/icf/logoff"]) {
    const r = await w.request({ url });
    assert.equal(r.headers["x-csrf-token"], "rfc");
  }
  const own = createRfcWire(system, { providerFor: async () => ({}), logger: null, connector: () => ({
    async connect() {}, setSessionType() {}, async disconnect() {},
    async makeAdtRequest() { return { status: 200, statusText: "OK", headers: { "x-csrf-token": "own-token" }, data: "" }; }
  }) });
  assert.equal((await own.request({ url: "/own" })).headers["x-csrf-token"], "own-token");
});
