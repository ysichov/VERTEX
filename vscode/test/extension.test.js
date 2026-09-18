"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Codex and Claude setup work without the Copilot MCP API", async () => {
  const commands = new Map();
  const copied = [];
  let client = "Codex";
  let starts = 0;
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); dispose() {} },
    workspace: { getConfiguration: () => ({ get: () => 37777 }),
      registerFileSystemProvider: () => ({ dispose() {} }),
      registerTextDocumentContentProvider: () => ({ dispose() {} }) },
    extensions: { getExtension: () => ({ packageJSON: { version: "0.4.1" } }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return {}; } },
    env: { clipboard: { writeText: async text => copied.push(text) } },
    window: { registerWebviewViewProvider: () => ({ dispose() {} }),
      showQuickPick: async () => client, showInformationMessage() {},
      showErrorMessage: message => assert.fail(message) }
  };
  const server = { token: "test-token", start: async () => {
    starts++;
    return { url: "http://127.0.0.1:37777/mcp" };
  }, stop() {} };
  const context = vm.createContext({ exports: {}, __dirname: path.join(__dirname, ".."),
    console: { log() {} }, require: name => name === "vscode" ? vscode
      : name === "./mcp" ? { create: deps => {
        assert.equal(deps.port, 37777);
        const open = deps.pages["/chat"].tools.find(t => t.name === "open_sap_object");
        assert.equal(open.annotations.readOnlyHint, true);
        assert.equal(open.annotations.destructiveHint, false);
        return server;
      } }
      : name.startsWith("./") ? require(path.join(__dirname, "..", name))
      : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8"), context);
  context.exports.activate({ subscriptions: [], workspaceState: { get: (key, fallback) => fallback, async update() {} } });
  assert.equal(starts, 1);
  await commands.get("vertex.mcpAddress")();
  assert.equal(copied[0], '[mcp_servers.vertex]\nurl = "http://127.0.0.1:37777/mcp"\nhttp_headers = { Authorization = "Bearer test-token" }\n');
  client = "Claude Code";
  await commands.get("vertex.mcpAddress")();
  assert.match(copied[1], /^claude mcp add --transport http vertex --scope user /);
  assert.match(copied[1], /--header "Authorization: Bearer test-token"$/);
  client = undefined;
  await commands.get("vertex.mcpAddress")();
  assert.equal(copied.length, 2);
  context.exports.deactivate();
});

test("Versions finds requests by user on a resource of their own", () => {
  const context = vm.createContext({ exports: {}, __dirname: path.join(__dirname, ".."), console,
    require: name => name === "vscode" || name === "./mcp" ? {}
      : name.startsWith("./") ? require(path.join(__dirname, "..", name)) : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8"), context);
  const build = vm.runInContext("SERVICES.versions.requests", context);
  assert.equal(build(["", ""]), "/sap/bc/adt/vertex/requests");
  assert.equal(build(["sychov", ""]), "/sap/bc/adt/vertex/requests?user=SYCHOV");
  assert.equal(build(["", "true"]), "/sap/bc/adt/vertex/requests?released=true");
  assert.equal(build(["sychov", "true"]), "/sap/bc/adt/vertex/requests?user=SYCHOV&released=true");
  assert.match(vm.runInContext("SHIM", context), /window\.sdeRequests = send\('requests'\);/);
  // Every window asks the same resource what the system has.
  assert.match(vm.runInContext("SHIM", context), /window\.sdeAbout = send\('about'\);/);
  assert.equal(vm.runInContext("ABOUT", context), "/sap/bc/adt/vertex/about");
});
