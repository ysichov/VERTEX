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
    workspace: { getConfiguration: () => ({ get: () => 37777 }) },
    extensions: { getExtension: () => ({ packageJSON: { version: "0.4.1" } }) },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return {}; } },
    env: { clipboard: { writeText: async text => copied.push(text) } },
    window: { showQuickPick: async () => client, showInformationMessage() {},
      showErrorMessage: message => assert.fail(message) }
  };
  const server = { token: "test-token", start: async () => {
    starts++;
    return { url: "http://127.0.0.1:37777/mcp" };
  }, stop() {} };
  const context = vm.createContext({ exports: {}, __dirname: path.join(__dirname, ".."),
    console: { log() {} }, require: name => name === "vscode" ? vscode
      : name === "./mcp" ? { create: deps => { assert.equal(deps.port, 37777); return server; } }
      : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8"), context);
  context.exports.activate({ subscriptions: [] });
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
