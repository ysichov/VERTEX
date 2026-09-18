"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mcp = require("../mcp");

test("MCP authenticates, lists tools, reads a transport and survives reload", async () => {
  const saved = new Map();
  const secrets = { get: async k => saved.get(k), store: async (k, v) => saved.set(k, v) };
  const paths = [];
  const deps = { context: { secrets }, fetch: async (_, path) => {
    paths.push(path);
    return JSON.stringify({ table: true, saved: true, request: "DEVK900578", objects: [] });
  } };
  const first = mcp.create(deps);
  const running = await first.start();
  const token = first.token;
  const rpc = async (body, auth = token, origin) => {
    const response = await fetch(running.url, { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: "Bearer " + auth,
      ...(origin ? { Origin: origin } : {})
    }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "wrong")).status, 401);
    assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, token, "https://example.com")).status, 403);
    assert.equal((await rpc(null)).status, 400);
    const init = await rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    assert.equal(init.body.id, 0);
    assert.equal(init.body.result.protocolVersion, "2025-03-26");
    const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(listed.body.result.tools.map(t => t.name), ["sap_transport_changes", "sap_transport_diff"]);
    const changes = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {
      name: "sap_transport_changes", arguments: { request: "devk900578" }
    } });
    assert.equal(changes.body.result.isError, undefined);
    assert.deepEqual(paths, ["/sap/bc/adt/vertex/review/DEVK900578"]);
    const competing = mcp.create({ ...deps, port: Number(new URL(running.url).port) });
    await assert.rejects(competing.start(), /already in use/);
  } finally { await first.stop(); }
  const next = mcp.create({ ...deps, port: Number(new URL(running.url).port) });
  try {
    assert.equal((await next.start()).url, running.url);
    assert.equal(next.token, token);
  } finally { await next.stop(); }
});
