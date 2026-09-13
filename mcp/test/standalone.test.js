"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { configuration, createReader } = require("../sap");

const serverPath = path.join(__dirname, "../server.js");
function run(env, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], { env: { ...process.env,
      VERTEX_SAP_URL: "", VERTEX_SAP_USER: "", VERTEX_SAP_PASSWORD: "", ...env },
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("MCP child timed out")); }, 8000);
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(messages.map(m => typeof m === "string" ? m : JSON.stringify(m)).join("\n") + "\n");
  });
}
const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, params });

test("real stdio process reads SAP summary and exact padded diff key without VS Code", async () => {
  const requests = [];
  const sap = http.createServer((req, res) => {
    requests.push({ url: new URL(req.url, "http://localhost"), auth: req.headers.authorization, method: req.method });
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("part=")) {
      res.end(JSON.stringify({ table: true, saved: true, part: "ZCL_TEST                      METHOD",
        part_type: "METH", versno_old: "00001", versno_new: "00002", added: 1, deleted: 0,
        blocks: [], ops: [{ op: "+", text: "WRITE 'standalone'." }] }));
    } else {
      res.end(JSON.stringify({ table: true, saved: true, request: "ALCK900593", objects: [] }));
    }
  });
  sap.listen(0, "127.0.0.1");
  await once(sap, "listening");
  const env = { VERTEX_SAP_URL: "http://127.0.0.1:" + sap.address().port,
    VERTEX_SAP_USER: "TEST", VERTEX_SAP_PASSWORD: "not-a-real-secret", VERTEX_SAP_CLIENT: "100" };
  try {
    const name = "ZCL_TEST".padEnd(30) + "METHOD";
    const result = await run(env, [rpc(0, "initialize", { protocolVersion: "2025-03-26" }),
      { jsonrpc: "2.0", method: "notifications/initialized" }, rpc(1, "tools/list"),
      rpc(2, "tools/call", { name: "sap_transport_changes", arguments: { request: "alck900593" } }),
      rpc(3, "tools/call", { name: "sap_transport_diff", arguments: {
        request: "ALCK900593", object: name, object_type: "METH" } }),
      "not json", null, rpc(4, "does-not-exist")]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const replies = result.stdout.trim().split("\n").map(JSON.parse);
    assert.equal(replies.length, 7);
    assert.equal(replies[0].id, 0);
    assert.equal(replies[0].result.protocolVersion, "2025-03-26");
    assert.equal(replies[1].result.tools.length, 2);
    assert.match(replies[2].result.content[0].text, /Transport ALCK900593/);
    assert.match(replies[3].result.content[0].text, /WRITE 'standalone'/);
    assert.equal(replies[4].error.code, -32700);
    assert.equal(replies[5].error.code, -32600);
    assert.equal(replies[6].error.code, -32601);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.method, "GET");
      assert.equal(request.url.searchParams.get("sap-client"), "100");
      assert.equal(request.auth, "Basic " + Buffer.from("TEST:not-a-real-secret").toString("base64"));
      assert.equal(request.url.pathname, "/sap/bc/adt/zsde/review/ALCK900593");
    }
    assert.equal(requests[1].url.searchParams.get("part"), name);
    assert.equal(requests[1].url.searchParams.get("ptype"), "METH");
    assert.ok(!result.stdout.includes(env.VERTEX_SAP_PASSWORD));
  } finally { await new Promise(resolve => sap.close(resolve)); }
});

test("invalid configuration fails on stderr without exposing password", async () => {
  const result = await run({ VERTEX_SAP_PASSWORD: "hidden" }, []);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Missing environment variable VERTEX_SAP_URL/);
  assert.ok(!result.stderr.includes("hidden"));
  const env = { VERTEX_SAP_URL: "https://sap.example.com", VERTEX_SAP_USER: "TEST", VERTEX_SAP_PASSWORD: "hidden" };
  assert.equal(configuration(env).allowInsecureCertificate, false);
  assert.throws(() => configuration({ ...env, VERTEX_SAP_URL: "https://user:secret@sap.example.com" }), /without credentials/);
  assert.throws(() => configuration({ ...env, VERTEX_SAP_TIMEOUT_MS: "0" }), /integer/);
});

test("SAP errors, redirects and deadlines are explicit; redirects never forward credentials", async () => {
  let status = 401;
  let calls = 0;
  const sap = http.createServer((req, res) => {
    calls++;
    if (status === 0) { return; }
    res.writeHead(status, { Location: "/redirect" });
    res.end("Sensitive backend body");
  });
  sap.listen(0, "127.0.0.1");
  await once(sap, "listening");
  const env = { VERTEX_SAP_URL: "http://127.0.0.1:" + sap.address().port,
    VERTEX_SAP_USER: "TEST", VERTEX_SAP_PASSWORD: "hidden", VERTEX_SAP_TIMEOUT_MS: "100" };
  const read = createReader(configuration(env));
  try {
    const result = await run(env, [rpc(1, "tools/call", {
      name: "sap_transport_changes", arguments: { request: "ALCK900593" } })]);
    const reply = JSON.parse(result.stdout);
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /HTTP 401/);
    assert.ok(!result.stdout.includes("Sensitive"));
    status = 302;
    await assert.rejects(read(null, "/sap/bc/adt/zsde/review/TEST"), /Redirects are not followed/);
    assert.equal(calls, 2);
    status = 0;
    await assert.rejects(read(null, "/sap/bc/adt/zsde/review/TEST"), /timed out/);
  } finally { sap.closeAllConnections(); await new Promise(resolve => sap.close(resolve)); }
});
