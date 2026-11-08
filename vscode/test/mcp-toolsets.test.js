"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

/* A Streamable HTTP MCP server in miniature: three tools, answers as JSON, the first call as an event stream. */
function fakeServer() {
  const calls = [];
  const tools = ["abap_objects_generator_list", "abap_business_service_list", "abap_object_read_file"]
    .map(name => ({ name, description: name, inputSchema: { type: "object", properties: {} } }));
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer t0k") { res.writeHead(401); res.end(); return; }
      const message = JSON.parse(body);
      if (message.id === undefined) { res.writeHead(202); res.end(); return; }
      const result = message.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, instructions: "fake" }
        : message.method === "tools/list" ? { tools }
        : (calls.push(message.params), { content: [{ type: "text", text: "ran " + message.params.name }] });
      const answer = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      if (message.method === "initialize") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Mcp-Session-Id": "s1" });
        res.end("event: message\ndata: " + answer + "\n\n");
      } else {
        assert.equal(req.headers["mcp-session-id"], "s1");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(answer);
      }
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, calls, port: server.address().port })));
}

test("a toolset is offered by enable_toolset and its tools join only when enabled", async () => {
  const fake = await fakeServer();
  try {
    const settings = {
      "vertex.chat.mcpServer": "VERTEX",
      "vertex.chat.mcpServers": [{ name: "SAP ADT", url: "http://127.0.0.1:${adtMcpPort}/mcp", headers: { Authorization: "Bearer ${adtMcpToken}" } }],
      "vertex.chat.toolsets": [{ name: "SAP RAP", server: "SAP ADT", description: "RAP generators", tools: ["abap_objects_generator_*", "abap_business_service_*"], note: "Name the destination." }],
      "adt.mcpServer.port": fake.port, "adt.mcpServer.token": "t0k"
    };
    const vscode = { workspace: { getConfiguration: section => ({ get: (key, fallback) => settings[section + "." + key] ?? fallback }) } };
    const mcp = require("../mcp-external").create({ vscode, active: () => ({ error: "not used" }), password: async () => "", storage: null });
    const own = { schemas: [{ name: "read_sap_object" }], instructions: "own", execute: async name => "own:" + name };
    const tools = mcp.wrap(own);

    assert.deepEqual(tools.schemas.map(t => t.name), ["read_sap_object", "enable_toolset"]);
    assert.match(tools.mcpNote(), /enable_toolset.*SAP RAP - RAP generators Name the destination\./);
    assert.equal(fake.calls.length, 0, "nothing reaches the server before the toolset is enabled");

    const answer = await tools.execute("enable_toolset", { toolset: "SAP RAP" });
    assert.deepEqual(answer.tools, ["abap_objects_generator_list", "abap_business_service_list"]);
    assert.deepEqual(tools.schemas.map(t => t.name), ["read_sap_object", "enable_toolset", "abap_objects_generator_list", "abap_business_service_list"]);
    assert.equal(tools.external("abap_business_service_list"), true);
    assert.equal(tools.external("abap_object_read_file"), false, "a tool outside the set stays out");

    assert.equal(await tools.execute("abap_business_service_list", { destination: "D1" }), "ran abap_business_service_list");
    assert.deepEqual(fake.calls, [{ name: "abap_business_service_list", arguments: { destination: "D1" } }]);
    assert.equal(await tools.execute("read_sap_object", {}), "own:read_sap_object");
    await assert.rejects(tools.execute("enable_toolset", { toolset: "Nope" }), /No toolset Nope\. Toolsets: SAP RAP\./);

    settings["adt.mcpServer.token"] = "wrong";
    settings["vertex.chat.toolsets"][0].name = "SAP RAP 2";
    await assert.rejects(tools.execute("enable_toolset", { toolset: "SAP RAP 2" }), /refused the token \(HTTP 401\)/);
    mcp.stop();
  } finally { fake.server.close(); }
});
