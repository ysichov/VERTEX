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
      "vertex.chat.toolsets": [{ name: "SAP RAP", server: "SAP ADT", description: "RAP generators", tools: ["abap_objects_generator_*", "abap_business_service_*"], note: "Name the destination.", always: true }],
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

test("the orchestrator is the last choice, offers every toolset and describes each server", async () => {
  const fake = await fakeServer();
  try {
    let kept = {};
    const settings = {
      "vertex.chat.mcpServer": "VERTEX",
      "vertex.chat.mcpServers": [{ name: "SAP ADT", description: "SAP's own server, strong at RAP.", url: "http://127.0.0.1:${adtMcpPort}/mcp", headers: { Authorization: "Bearer ${adtMcpToken}" } },
        { name: "Other", command: "nothing-here" }],
      "vertex.chat.toolsets": [{ name: "SAP RAP", server: "SAP ADT", description: "RAP generators", tools: ["abap_objects_generator_*"] },
        { name: "Services", server: "SAP ADT", description: "Service bindings", tools: ["abap_business_service_*"] }],
      "adt.mcpServer.port": fake.port, "adt.mcpServer.token": "t0k"
    };
    const vscode = { workspace: { getConfiguration: section => ({ get: (key, fallback) => settings[section + "." + key] ?? fallback }) } };
    const mcp = require("../mcp-external").create({ vscode, active: () => ({ error: "not used" }), password: async () => "", storage: null,
      catalog: { get: () => kept, update: async value => { kept = value; } } });
    assert.deepEqual(mcp.choices(), ["VERTEX", "SAP ADT", "Other", "VERTEX Orchestrator"]);
    const tools = mcp.wrap({ schemas: [{ name: "read_sap_object" }], instructions: "own", execute: async () => "" });
    assert.deepEqual(tools.schemas.map(t => t.name), ["read_sap_object"], "a single server's mode offers only toolsets marked always");

    settings["vertex.chat.mcpServer"] = "VERTEX Orchestrator";
    assert.equal(await mcp.prepare(), null, "the orchestrator keeps VERTEX's own tools");
    assert.deepEqual(tools.schemas.map(t => t.name), ["read_sap_object", "enable_toolset"]);
    let note = tools.mcpNote();
    assert.match(note, /- SAP ADT: SAP's own server, strong at RAP\.\n  Toolsets: SAP RAP - RAP generators; Services - Service bindings\.\n  Its tool list has not been read yet/);
    assert.match(note, /- Other: no description configured\.\n  No toolsets are configured/);

    await tools.execute("enable_toolset", { toolset: "SAP RAP" });
    assert.deepEqual(kept["SAP ADT"].tools.map(t => t.name), ["abap_objects_generator_list", "abap_business_service_list", "abap_object_read_file"], "a start keeps the tool list");
    note = tools.mcpNote();
    assert.match(note, /SAP RAP - RAP generators \(1 tool\); Services - Service bindings \(1 tool\)\.\n  1 of its tools are in no toolset\./);
    const row = mcp.overview().find(s => s.name === "SAP ADT");
    assert.deepEqual(row.tools.find(t => t.name === "abap_object_read_file").toolsets, []);
    mcp.stop();
  } finally { fake.server.close(); }
});

test("Update is offered for a newer npm version and installs nothing until asked", async () => {
  const settings = {
    "vertex.chat.mcpServer": "VERTEX", "vertex.chat.abapAdtAccess": "read-only",
    "vertex.chat.mcpServers": [{ name: "ARC-1", command: "npx", args: ["-y", "arc-1@1.10.1"] },
      { name: "mcp-abap-adt", command: "npx", args: ["-y", "${abapAdtPackage}", "--system-type=onprem"] },
      { name: "Down", command: "npx", args: ["-y", "down@1.0.0"] }]
  };
  const vscode = { ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: section => ({ get: (key, fallback) => settings[section + "." + key] ?? fallback,
    update: async (key, value) => { settings[section + "." + key] = value; } }) } };
  const latest = { "arc-1": "1.11.0", "@mcp-abap-adt/core-ro": "23.1.0" };
  const mcp = require("../mcp-external").create({ vscode, active: () => ({ error: "not used" }), password: async () => "", storage: null,
    fetchLatest: async name => { if (!latest[name]) throw new Error("offline"); return latest[name]; } });
  let told = 0; mcp.onUpdates(() => told++);
  const found = await mcp.checkUpdates();
  assert.deepEqual(found["ARC-1"], [{ name: "arc-1", installed: "1.10.1", latest: "1.11.0" }]);
  assert.deepEqual(found["mcp-abap-adt"], []);
  assert.match(found.Down.error, /Could not check for a newer version: offline/);
  assert.equal(told, 1);
  assert.equal(settings["vertex.chat.mcpVersions"], undefined, "checking installs nothing");
  await assert.rejects(mcp.update("ARC-1"), /no system|not used/i, "the update starts the server and fails loudly when it cannot");
  assert.deepEqual(settings["vertex.chat.mcpVersions"], { "arc-1": "1.11.0" });
  assert.deepEqual(mcp.overview().find(s => s.name === "ARC-1").packages, [{ name: "arc-1", version: "1.11.0" }]);
  await assert.rejects(mcp.update("mcp-abap-adt"), /No update is waiting/);
});

test("npm package specs are read from a server's command line", () => {
  const { npmSpec } = require("../mcp-external");
  assert.deepEqual(npmSpec("arc-1@1.10.1"), { name: "arc-1", version: "1.10.1" });
  assert.deepEqual(npmSpec("@mcp-abap-adt/core-ro@23.1.0"), { name: "@mcp-abap-adt/core-ro", version: "23.1.0" });
  assert.equal(npmSpec("-y"), null);
  assert.equal(npmSpec("--env-path=x"), null);
});

test("a server needs installing only while npx has not got its package at that version", () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "vx-npx-"));
  const settings = { "vertex.chat.mcpServers": [{ name: "ARC-1", command: "npx", args: ["-y", "arc-1@1.10.1"] }, { name: "SAP ADT", url: "http://localhost:1/mcp" }] };
  const vscode = { workspace: { getConfiguration: section => ({ get: (key, fallback) => settings[section + "." + key] ?? fallback }) } };
  const before = process.env.npm_config_cache;
  process.env.npm_config_cache = cache;
  try {
    const mcp = require("../mcp-external").create({ vscode, active: () => ({}), password: async () => "", storage: null });
    assert.equal(mcp.needsInstall("ARC-1"), true, "no npx cache at all");
    const dir = path.join(cache, "_npx", "abc", "node_modules", "arc-1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "arc-1", version: "1.9.0" }));
    assert.equal(mcp.needsInstall("ARC-1"), true, "another version is cached");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "arc-1", version: "1.10.1" }));
    assert.equal(mcp.needsInstall("ARC-1"), false);
    assert.equal(mcp.needsInstall("SAP ADT"), false, "a server reached by URL never installs");
  } finally {
    if (before === undefined) delete process.env.npm_config_cache; else process.env.npm_config_cache = before;
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test("the start scene writes the server's name on the hull, escaped", () => {
  const visual = require("../task-visual");
  assert.match(visual.html("start", false, "ARC-1"), />ARC-1<\/text>/);
  assert.match(visual.html("start", false, "a<b"), />a&lt;b<\/text>/);
  assert.match(visual.html("install"), /class="ig-fly ig-1"/);
});

test("started servers stay up together: switching away and back, or enabling a toolset, starts nothing again", async () => {
  const fake = await fakeServer();
  try {
    const settings = {
      "vertex.chat.mcpServer": "SAP ADT",
      "vertex.chat.mcpServers": [{ name: "SAP ADT", url: "http://127.0.0.1:${adtMcpPort}/mcp", headers: { Authorization: "Bearer ${adtMcpToken}" } }],
      "vertex.chat.toolsets": [{ name: "SAP RAP", server: "SAP ADT", description: "RAP generators", tools: ["abap_objects_generator_*"] }],
      "adt.mcpServer.port": fake.port, "adt.mcpServer.token": "t0k"
    };
    const vscode = { workspace: { getConfiguration: section => ({ get: (key, fallback) => settings[section + "." + key] ?? fallback }) } };
    const mcp = require("../mcp-external").create({ vscode, active: () => ({ error: "not used" }), password: async () => "", storage: null });
    const first = await mcp.prepare();
    settings["vertex.chat.mcpServer"] = "VERTEX";
    assert.equal(await mcp.prepare(), null);
    settings["vertex.chat.mcpServer"] = "VERTEX Orchestrator";
    const tools = mcp.wrap({ schemas: [], instructions: "", execute: async () => "" });
    const answer = await tools.execute("enable_toolset", { toolset: "SAP RAP" });
    assert.deepEqual(answer.tools, ["abap_objects_generator_list"]);
    settings["vertex.chat.mcpServer"] = "SAP ADT";
    assert.equal(await mcp.prepare(), first, "the same running copy serves the chosen server and the toolset");
    mcp.stop();
  } finally { fake.server.close(); }
});
