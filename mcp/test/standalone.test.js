"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
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

// A saved review as ZAVE_REVIEW holds it, read through a stand-in for ADT's data preview.
function fakeAdt() {
  const name = "ZCL_TEST".padEnd(30) + "METHOD";
  const payload = { TRKORR: "DEVK900593", LAST_SAVED_AT: "20261009101112.1234567", LAST_SAVED_BY: "REV",
    OBJ_STATS: [{ OBJTYPE: "METH", CLASS_NAME: "ZCL_TEST", OBJ_NAME: name, DISPLAY_NAME: "METHOD", INS_COUNT: 1, HUNK_COUNT: 1 }],
    HUNKS: [{ HUNK_KEY: "METH~" + name + "~1", OBJTYPE: "METH", OBJ_NAME: name, HUNK_NO: 1, START_LINE: 1, CHANGE_COUNT: 1,
      CHANGE_KIND: "added", AUTHOR: "DEV", VERSNO_OLD: "00001", VERSNO_NEW: "00002" }],
    DIFF_DATA: [{ KEY: { OBJTYPE: "METH", OBJNAME: name, VERSNO_O: "00001", VERSNO_N: "00002" }, RETROFIT: false,
      DIFF: [{ OP: "+", TEXT: "WRITE 'standalone'." }] }] };
  const asked = [];
  return { name, asked, api: { query: async sql => {
    asked.push(sql);
    if (/FROM dd03l/.test(sql)) { return { values: [{ FIELDNAME: "REMOTE" }, { FIELDNAME: "PAYLOAD" }] }; }
    if (/FROM zave_review/.test(sql)) { return { values: [{ PAYLOAD: JSON.stringify(payload) }] }; }
    return { values: [] };
  } } };
}

test("the review of a request is read over ADT, without VERTEX's ABAP", async () => {
  const { name, asked, api } = fakeAdt();
  const read = createReader({ url: "https://sap.example.com" }, api);
  const summary = JSON.parse(await read(null, "/sap/bc/adt/vertex/review/DEVK900593"));
  assert.equal(summary.saved, true);
  assert.deepEqual(summary.objects.map(o => o.obj_name), [name]);
  const part = JSON.parse(await read(null, "/sap/bc/adt/vertex/review/DEVK900593?part=" + encodeURIComponent(name) + "&ptype=METH"));
  assert.deepEqual(part.ops, [{ op: "+", text: "WRITE 'standalone'." }]);
  assert.ok(asked.every(sql => /^SELECT /.test(sql)), "nothing but the data preview is asked");
  await assert.rejects(read(null, "/sap/bc/adt/vertex/versions/X"), /only supports the review of a request/);
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
