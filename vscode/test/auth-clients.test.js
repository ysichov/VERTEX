"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createAuth } = require("../auth/clients");
const { loginIdentity } = require("../auth/systems");
function fakeVscode(systems, { remoteName } = {}) {
  const prompts = [];
  return { prompts, env: { remoteName }, window: { showInputBox: async o => { prompts.push(o.prompt); return "typed"; } },
    workspace: { getConfiguration: () => ({ get: k => (k === "systems" ? systems : "") }) } };
}
function fakeContext(init) { const m = new Map(Object.entries(init || {})), g = new Map(); return { m,
  secrets: { get: async k => m.get(k), store: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } },
  globalState: { get: k => g.get(k), update: async (k, v) => { g.set(k, v); } } }; }
const sncEntry = { name: "S", url: "https://s", user: "u", authType: "snc", snc: { partnerName: "p:CN=S" }, rfc: { ashost: "s", sysnr: "00" } };

test("makeClient builds an ADTClient on the HTTP wire with no secret in it", async () => {
  const auth = createAuth({ vscode: fakeVscode([{ name: "D", url: "http://127.0.0.1:9", user: "u" }]), context: fakeContext(), logger: null });
  const system = auth.systemOf({ name: "D", url: "http://127.0.0.1:9", user: "u" }).system;
  const client = await auth.makeClient(system, "repository");
  assert.equal(typeof client.dispose, "function");
  assert.equal(client.httpClient.password, "-");
  await auth.disposeAll();
});
test("password asks once for basic, never for snc", async () => {
  const v = fakeVscode([{ name: "D", url: "http://h", user: "u" }, sncEntry]), ctx = fakeContext();
  const auth = createAuth({ vscode: v, context: ctx, logger: null });
  const d = auth.systemOf({ name: "D", url: "http://h", user: "u" }).system;
  assert.equal(await auth.password(d), "typed"); assert.equal(await auth.password(d), "typed");
  assert.equal(await auth.password(auth.systemOf(sncEntry).system), undefined);
  assert.equal(v.prompts.length, 1);
});
test("after migration a retained (ambiguous) legacy key is never used as a password", async () => {
  const a = { name: "D", url: "http://h", user: "u" }, b = { name: "D", url: "http://h", user: "u", client: "200" };
  const v = fakeVscode([a, b]), ctx = fakeContext({ "vertex.password.D": "old" });
  const auth = createAuth({ vscode: v, context: ctx, logger: null });
  assert.equal(await auth.password(auth.systemOf(a).system), "typed");
  assert.equal(v.prompts.length, 1);
});
test("snc on a remote host is refused before any client is built", async () => {
  const auth = createAuth({ vscode: fakeVscode([sncEntry], { remoteName: "wsl" }), context: fakeContext(), logger: null });
  await assert.rejects(auth.makeClient(auth.systemOf(sncEntry).system, "repository"), /remote host \(wsl\)/);
});
test("a basic refusal through any wire discards the stored password; the next need asks", async () => {
  const http = require("node:http");
  const s = await new Promise(r => { const srv = http.createServer((q, res) => { res.statusCode = 401; res.end(""); }); srv.listen(0, "127.0.0.1", () => r(srv)); });
  const entry = { name: "D", url: "http://127.0.0.1:" + s.address().port, user: "u" };
  const v = fakeVscode([entry]), ctx = fakeContext();
  const auth = createAuth({ vscode: v, context: ctx, logger: null });
  const sys = auth.systemOf(entry).system;
  const client = await auth.makeClient(sys, "repository");
  await client.httpClient.request("/sap/bc/adt/discovery", {}).catch(() => {});
  assert.equal(ctx.m.has(loginIdentity(sys) + ".means"), false);
  assert.ok(auth.lastRefusal(sys));
  await auth.password(sys); assert.equal(v.prompts.length, 2);
  await auth.disposeAll(); s.close();
});
test("a cached client recovers after a refusal: the next operation asks, the refused one is not replayed", async () => {
  const http = require("node:http");
  let accept = false;
  const s = await new Promise(r => { const srv = http.createServer((q, res) => {
    if (accept) { res.setHeader("x-csrf-token", "T"); res.end("ok"); } else { res.statusCode = 401; res.end(""); } });
    srv.listen(0, "127.0.0.1", () => r(srv)); });
  const entry = { name: "D", url: "http://127.0.0.1:" + s.address().port, user: "u" };
  const v = fakeVscode([entry]), ctx = fakeContext();
  const auth = createAuth({ vscode: v, context: ctx, logger: null });
  const sys = auth.systemOf(entry).system;
  const client = await auth.makeClient(sys, "repository");
  await assert.rejects(client.httpClient.request("/sap/bc/adt/discovery", {}));
  assert.equal(v.prompts.length, 1);
  accept = true;
  await client.httpClient.request("/sap/bc/adt/discovery", {});
  assert.equal(v.prompts.length, 2);
  await auth.disposeAll(); s.close();
});
test("concurrent first command requests share one wire and one prompt", async () => {
  const v = fakeVscode([{ name: "D", url: "http://127.0.0.1:9", user: "u" }]);
  const auth = createAuth({ vscode: v, context: fakeContext(), logger: null });
  const sys = auth.systemOf({ name: "D", url: "http://127.0.0.1:9", user: "u" }).system;
  const [a, b] = await Promise.all([auth.commandWire(sys), auth.commandWire(sys)]);
  assert.equal(a, b); assert.equal(v.prompts.length, 1);
  await auth.disposeAll();
});
test("explain adds the provider's reason and hint to a 401", async () => {
  const auth = createAuth({ vscode: fakeVscode([]), context: fakeContext(), logger: null });
  const sys = auth.systemOf({ name: "D", url: "http://h", user: "u" }).system;
  assert.equal(auth.explain(sys, new Error("Error 401:Unauthorized")), "Error 401:Unauthorized");
});
test("command wires are shared per system and disposed by disposeAll", async () => {
  const auth = createAuth({ vscode: fakeVscode([{ name: "D", url: "http://127.0.0.1:9", user: "u" }]), context: fakeContext(), logger: null });
  const sys = auth.systemOf({ name: "D", url: "http://127.0.0.1:9", user: "u" }).system;
  const w1 = await auth.commandWire(sys), w2 = await auth.commandWire(sys);
  assert.equal(w1, w2);
  let disposed = 0; const orig = w1.dispose; w1.dispose = () => { disposed++; return orig(); };
  await auth.disposeAll(); assert.equal(disposed, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test("forget waits for an in-flight legacy migration before removing the password", async () => {
  const entry = { name: "D", url: "http://h", user: "u" };
  const v = fakeVscode([entry]), ctx = fakeContext({ "vertex.password.D": "old" });
  const legacy = deferred(), get = ctx.secrets.get;
  ctx.secrets.get = k => k === "vertex.password.D" ? legacy.promise : get(k);
  const auth = createAuth({ vscode: v, context: ctx, logger: null });
  const sys = auth.systemOf(entry).system;
  const forgotten = auth.forget(sys);
  legacy.resolve("old");
  await forgotten;
  assert.equal(ctx.m.has(loginIdentity(sys) + ".means"), false);
  assert.equal(ctx.m.has("vertex.password.D"), false);
  const before = v.prompts.length;
  assert.equal(await auth.password(sys), "typed");
  assert.equal(v.prompts.length, before + 1);
  await auth.disposeAll();
});

test("disposeAll waits for a pending command prompt and rejects its creator on shutdown", async () => {
  const entry = { name: "D", url: "http://127.0.0.1:9", user: "u" };
  const v = fakeVscode([entry]), prompt = deferred(), entered = deferred();
  v.window.showInputBox = o => { v.prompts.push(o.prompt); entered.resolve(); return prompt.promise; };
  const auth = createAuth({ vscode: v, context: fakeContext(), logger: null });
  const pending = auth.commandWire(auth.systemOf(entry).system);
  const rejected = assert.rejects(pending, /shutting down/);
  await entered.promise;
  let disposed = false;
  const disposing = auth.disposeAll().then(() => { disposed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, false);
  prompt.resolve("typed");
  await rejected;
  await disposing;
  assert.equal(disposed, true);
  assert.equal(v.prompts.length, 1);
});

test("after disposeAll client and command wire creation reject without prompting", async () => {
  const entry = { name: "D", url: "http://127.0.0.1:9", user: "u" };
  const v = fakeVscode([entry]);
  const auth = createAuth({ vscode: v, context: fakeContext(), logger: null });
  const sys = auth.systemOf(entry).system;
  await auth.disposeAll();
  await assert.rejects(auth.makeClient(sys, "repository"), /shutting down/);
  await assert.rejects(auth.commandWire(sys), /shutting down/);
  assert.equal(v.prompts.length, 0);
});

test("a disposed client wire used again is tracked by disposeAll", async t => {
  const server = require("node:http").createServer((request, response) => { response.setHeader("x-csrf-token", "T"); response.end("ok"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const entry = { name: "D", url: "http://127.0.0.1:" + server.address().port, user: "u" };
  const auth = createAuth({ vscode: fakeVscode([entry]), context: fakeContext(), logger: null });
  const client = await auth.makeClient(auth.systemOf(entry).system, "repository");
  const wire = client.httpClient.httpclient;
  await client.httpClient.request("/sap/bc/adt/discovery", {});
  await client.dispose();
  let disposed = 0;
  const dispose = wire.dispose;
  wire.dispose = () => { disposed++; return dispose(); };
  await client.httpClient.request("/sap/bc/adt/discovery", {});
  await auth.disposeAll();
  assert.equal(disposed, 1);
});

for (const stored of [false, true]) test("CSRF refusal suppresses auto-login prompts (stored=" + stored + ")", async t => {
  let refuse = false, sends = 0;
  const server = require("node:http").createServer((q, res) => {
    sends++;
    if (refuse) { res.statusCode = 401; res.end("CSRF"); }
    else { res.setHeader("x-csrf-token", "T"); res.end("ok"); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const entry = { name: "D", url: "http://127.0.0.1:" + server.address().port, user: "u" };
  const v = fakeVscode([entry]), ctx = fakeContext();
  const auth = createAuth({ vscode: v, context: ctx, logger: null });
  t.after(() => auth.disposeAll());
  const sys = auth.systemOf(entry).system;
  const client = await auth.makeClient(sys, "repository");
  await client.httpClient.request("/sap/bc/adt/discovery", {});
  assert.equal(client.httpClient.loggedin, true);
  assert.equal(client.httpClient.isStateful, false);
  refuse = true;
  if (!stored) await auth.forget(sys);
  const prompts = v.prompts.length, before = sends;
  await assert.rejects(client.httpClient.request("/sap/bc/adt/discovery", {}));
  assert.equal(v.prompts.length, prompts + (stored ? 0 : 1));
  assert.equal(sends, before + 1);
  assert.equal(ctx.m.has(loginIdentity(sys) + ".means"), false);
  const after = v.prompts.length;
  await assert.rejects(client.httpClient.request("/sap/bc/adt/discovery", {}));
  assert.equal(v.prompts.length, after + 1);
  assert.equal(sends, before + 2);
});

test("a client picked for a system is what every read uses, and whoever shows it is told", async () => {
  const entry = { name: "ER6", url: "https://h", user: "u", client: "600", clients: ["610"] };
  const auth = createAuth({ vscode: fakeVscode([entry]), context: fakeContext(), logger: null });
  const told = [];
  const listening = auth.onClientChange((name, client) => told.push(name + "/" + client));
  assert.equal(auth.currentSystems()[0].client, "600");
  await auth.setClient("ER6", "610");
  assert.equal(auth.currentSystems()[0].client, "610");
  assert.equal(auth.systemOf(entry).system.client, "610");
  assert.deepEqual(told, ["ER6/610"]);
  listening.dispose();
  await auth.setClient("ER6", "600");
  assert.deepEqual(told, ["ER6/610"]);
});
