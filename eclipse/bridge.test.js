"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { run } = require("../org.vertex.abap.ui/assistant/bridge");

test("Selector prepares SAP layouts, exposes authenticated tools and validates the returned plan", async () => {
  const paths = [];
  const layout = { table: "SFLIGHT", fields: [{ alias: "T0", tabname: "SFLIGHT", fieldname: "CARRID", datatype: "CHAR", aggs: ["COUNT"] }], candidates: [], tables: [] };
  let endpoint;
  const result = await run({ call: "ask", service: "selector", assistant: "codex", executable: process.execPath,
    text: "SFLIGHT", state: {} }, async (_, resource) => { paths.push(resource); return JSON.stringify(layout); }, {
    ask: async options => {
      endpoint = options.url;
      assert.match(options.prompt, /Fields of SFLIGHT/);
      assert.deepEqual(options.tools, ["sap_table_layout"]);
      const unauth = await fetch(endpoint, { method: "POST", body: "{}" });
      assert.equal(unauth.status, 401);
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + options.token },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      assert.deepEqual((await response.json()).result.tools.map(t => t.name), ["sap_table_layout"]);
      return { model: "test", plan: { table: "SFLIGHT", reply: "Ready", filters: [], join: [], fields: ["T0~CARRID"], pivot: { rows: [], cols: [], vals: [] } } };
    }
  });
  assert.equal(result.plan.fields[0], "t0~carrid");
  assert.ok(paths.every(p => p === "/sap/bc/adt/vertex/join/SFLIGHT"));
  await assert.rejects(fetch(endpoint));
});

test("invalid plans fail and the private MCP server is closed", async () => {
  let endpoint;
  await assert.rejects(run({ call: "ask", service: "selector", assistant: "codex", executable: process.execPath, text: "", state: {} },
    async () => JSON.stringify({ table: "SFLIGHT", fields: [] }), { ask: async o => {
      endpoint = o.url;
      return { plan: { table: "SFLIGHT", fields: ["t0~invented"] } };
    } }), /no such key/);
  await assert.rejects(fetch(endpoint));
});

test("Versions sends selected instructions and previous discussion", async () => {
  const result = await run({ call: "ask", service: "versions", assistant: "claude", executable: process.execPath,
    text: "Explain", state: { review_instructions: "Check security", conversation: [{ role: "assistant", content: "Previous issue" }] } },
    async () => { throw new Error("No read expected"); }, { ask: async o => {
      assert.match(o.prompt, /Check security/);
      assert.match(o.prompt, /Previous issue/);
      return { plan: { name: "", reply: "Explanation" } };
    } });
  assert.equal(result.plan.reply, "Explanation");
});

test("the packaged bridge exchanges a model-list result over the private pipe", async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "../org.vertex.abap.ui/assistant/bridge.js")], { windowsHide: true });
  let output = "";
  child.stdout.on("data", chunk => {
    output += chunk;
    if (output.includes("\n")) child.stdin.end();
  });
  const exit = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  const timer = setTimeout(() => child.kill(), 10000);
  child.stdin.write(Buffer.from(JSON.stringify({ call: "models", assistant: "claude", service: "selector", executable: process.execPath })).toString("base64") + "\n");
  try {
    assert.equal(await exit, 0);
    const result = JSON.parse(Buffer.from(output.trim().split("\t")[1], "base64").toString());
    assert.equal(result.call, "models");
    assert.ok(result.models.some(m => m.id === "sonnet"));
  } finally { clearTimeout(timer); child.kill(); }
});

test("Chat reads over the host, opens through ADT and passes the active editor", async () => {
  const paths = [], opened = [];
  const xml = '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">'
    + '<adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/z_calc" adtcore:type="PROG/P" adtcore:name="Z_CALC" adtcore:packageName="$TMP" adtcore:description="Calc &amp; test"/>'
    + '</adtcore:objectReferences>';
  const result = await run({ call: "ask", service: "chat", assistant: "codex", executable: process.execPath,
    text: "show Z_CALC", state: { editor: { name: "ZCL_X", type: "CLAS/OC" }, conversation: [],
      vertex_view: { type: "DEVC", name: "Z_APP", view: "uml", object_count: 50 } } },
    async (_, resource) => { paths.push(resource); return resource.endsWith("/source/main") ? "REPORT z_calc." : xml; },
    { ask: async o => {
      assert.match(o.prompt, /ZCL_X/);
      assert.match(o.prompt, /function-specific metadata/);
      assert.match(o.prompt, /\"view\":\"uml\"/);
      assert.deepEqual(o.tools, ["search_sap_objects", "read_sap_object", "open_sap_object"]);
      const call = async (name, args) => {
        const response = await fetch(o.url, { method: "POST", headers: { Authorization: "Bearer " + o.token },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
        return (await response.json()).result;
      };
      const read = JSON.parse((await call("read_sap_object", { object_type: "PROG", object_name: "z_calc" })).content[0].text);
      assert.equal(read.source, "REPORT z_calc.");
      assert.equal(read.description, "Calc & test");
      await call("open_sap_object", { object_type: "PROG", object_name: "Z_CALC" });
      const missing = await call("read_sap_object", { object_type: "CLAS", object_name: "ZCL_NONE" });
      assert.equal(missing.isError, true);
      return { model: "test", plan: { answer: "Z_CALC is open." } };
    } },
    async target => { opened.push(target); return "OK"; });
  assert.equal(result.plan.answer, "Z_CALC is open.");
  assert.deepEqual(opened, [{ uri: "/sap/bc/adt/programs/programs/z_calc", name: "Z_CALC", type: "PROG/P" }]);
  assert.ok(paths.includes("/sap/bc/adt/programs/programs/z_calc/source/main"));
  assert.ok(paths.every(p => /^\/sap\/bc\/adt\/(repository\/informationsystem\/search\?operation=quickSearch&query=[A-Za-z0-9_%*+]+&maxResults=[0-9]+&objectType=(PROG%2FP|CLAS%2FOC|FUGR%2FFF)|programs\/programs\/[^/?#]+\/source\/main)$/.test(p)), paths.join("\n"));
});

test("Eclipse chat opens a bare object name without starting an assistant", async () => {
  const xml = '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">'
    + '<adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/z_calc" adtcore:type="PROG/P" adtcore:name="Z_CALC" adtcore:packageName="$TMP"/>'
    + '</adtcore:objectReferences>';
  const opened = [];
  const result = await run({ call: "ask", service: "chat", assistant: "claude", executable: "does-not-exist", project: "QAS",
    text: "Z_CALC", state: {} }, async () => xml,
    { ask: async () => { throw new Error("no model expected"); } },
    async target => { opened.push(target); return "OK"; });
  assert.equal(result.direct, true);
  assert.match(result.plan.answer, /Opened PROG \*\*Z_CALC\*\*.*QAS/);
  assert.equal(opened[0].name, "Z_CALC");
});
