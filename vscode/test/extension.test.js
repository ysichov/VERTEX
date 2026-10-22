"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Codex and Claude setup work without the Copilot MCP API", async () => {
  const commands = new Map();
  const copied = [];
  const previews = [];
  let client = "Codex";
  let starts = 0;
  const vscode = {
    debug: { onDidChangeBreakpoints: () => ({ dispose() {} }), registerDebugAdapterTrackerFactory: () => ({ dispose() {} }), onDidTerminateDebugSession: () => ({ dispose() {} }) },
    ThemeColor: class { constructor(id) { this.id = id; } },
    EventEmitter: class { event = () => ({ dispose() {} }); dispose() {} },
    TestRunProfileKind: { Run: 1 }, languages: { createDiagnosticCollection: () => ({ dispose() {} }), registerFoldingRangeProvider: () => ({ dispose() {} }) }, tests: { createTestController: () => ({ dispose() {}, createRunProfile() {} }) },
    workspace: { getConfiguration: () => ({ get: key => key === "systems" ? [] : 37777 }),
      onDidCloseTextDocument: () => ({ dispose() {} }), onDidOpenTextDocument: () => ({ dispose() {} }), textDocuments: [],
      registerFileSystemProvider: () => ({ dispose() {} }),
      registerTextDocumentContentProvider: () => ({ dispose() {} }) },
    extensions: { getExtension: () => ({ packageJSON: { version: "0.4.1" } }), all: [], onDidChange: () => ({ dispose() {} }) },
    Uri: { file: file => file, joinPath: (...parts) => parts.join("/") },
    commands: { executeCommand: async (name, file) => {
      if (name === "setContext") return;
      if (name === "workbench.action.openWalkthrough") { assert.equal(file, "YuriiSychov.vertex-abap#vertex.start"); return; }
      assert.equal(name, "markdown.showPreview"); previews.push(file);
    },
      registerCommand: (name, callback) => { commands.set(name, callback); return {}; } },
    env: { clipboard: { writeText: async text => copied.push(text) } },
    window: { createTextEditorDecorationType: () => ({ dispose() {} }), registerWebviewViewProvider: () => ({ dispose() {} }),
      showQuickPick: async items => { assert.deepEqual(Array.from(items), ["Codex", "Claude Code"]); return client; }, createOutputChannel: () => ({ debug() {}, info() {}, warn() {}, error() {}, dispose() {} }), showInformationMessage: async () => undefined,
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
        assert.ok(deps.pages["/debug"], "the debugger has its own address");
        // The panel's chat gets the debugger tools beside the source tools.
        assert.ok(deps.pages["/chat"].tools.some(t => t.name === "debug_status"));
        return server;
      }, debugSet: () => ({ tools: [{ name: "debug_status", description: "", inputSchema: {} }], instructions: "debug" }) }
      : name.startsWith("./") ? require(path.join(__dirname, "..", name))
      : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8"), context);
  const subscriptions = [];
  context.exports.activate({ subscriptions,
    secrets: { async get() {}, async store() {}, async delete() {} }, workspaceState: { get: (key, fallback) => fallback, async update() {} },
    globalState: { get: () => undefined, async update() {} } });
  assert.equal(starts, 1);
  await commands.get("vertex.getStarted")();
  for (const step of ["systems", "test", "ai", "mcp"]) {
    await commands.get("vertex." + step + "Info")();
    assert.equal(previews.at(-1), path.join(__dirname, "..", "walkthrough", step + ".md"));
  }
  // The regular VERTEX editor can open the same Visual Debug session and
  // route F5-F8 to it; the commands themselves stay inactive until invoked.
  for (const name of ["vertex.openVisualDebug", "vertex.debugInto", "vertex.debugOver",
    "vertex.debugOut", "vertex.debugContinue"]) assert.ok(commands.has(name), name);
  await commands.get("vertex.mcpAddress")();
  assert.equal(copied[0], '[mcp_servers.vertex]\nurl = "http://127.0.0.1:37777/mcp"\nhttp_headers = { Authorization = "Bearer test-token" }\n\n[mcp_servers.vertex-debug]\nurl = "http://127.0.0.1:37777/debug"\nhttp_headers = { Authorization = "Bearer test-token" }\n');
  client = "Claude Code";
  await commands.get("vertex.mcpAddress")();
  assert.match(copied[1], /^claude mcp add --transport http vertex --scope user /);
  assert.match(copied[1], /--header "Authorization: Bearer test-token"$/);
  assert.match(copied[1], /\nclaude mcp add --transport http vertex-debug --scope user http:\/\/127\.0\.0\.1:37777\/debug /);
  client = undefined;
  await commands.get("vertex.mcpAddress")();
  assert.equal(copied.length, 2);
  await context.exports.deactivate();
  subscriptions.forEach(item => { if (item.dispose) item.dispose(); });
});

test("Versions finds requests by user on a resource of their own", () => {
  const context = vm.createContext({ exports: {}, __dirname: path.join(__dirname, ".."), console,
    require: name => name === "vscode" || name === "./mcp" ? {}
      : name.startsWith("./") ? require(path.join(__dirname, "..", name)) : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8"), context);
  const build = vm.runInContext("SERVICES.versions.requests", context);
  assert.equal(build(["", ""]), "/sap/bc/adt/vertex/requests");
  assert.equal(build(["developer", ""]), "/sap/bc/adt/vertex/requests?user=DEVELOPER");
  assert.equal(build(["", "true"]), "/sap/bc/adt/vertex/requests?released=true");
  assert.equal(build(["developer", "true"]), "/sap/bc/adt/vertex/requests?user=DEVELOPER&released=true");
  assert.match(vm.runInContext("SHIM", context), /window\.sdeRequests = send\('requests'\);/);
  // Every window asks the same resource what the system has.
  assert.match(vm.runInContext("SHIM", context), /window\.sdeAbout = send\('about'\);/);
  assert.equal(vm.runInContext("ABOUT", context), "/sap/bc/adt/vertex/about");
});

test("logger lazily routes LogOutputChannel levels and disposes the channel", async () => {
  const calls = [];
  let created = 0, disposed = 0;
  const channel = { dispose() { disposed++; } };
  for (const level of ["debug", "info", "warn", "error"]) channel[level] = message => calls.push([level, message]);
  const context = vm.createContext({ exports: {}, __dirname: path.join(__dirname, ".."), console,
    require: name => name === "vscode" ? { window: { createOutputChannel(name, options) {
      created++; assert.equal(name, "VERTEX"); assert.equal(options.log, true); return channel;
    } } } : name === "./mcp" ? {} : name.startsWith("./") ? require(path.join(__dirname, "..", name)) : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8"), context);
  assert.equal(created, 0);
  for (const level of ["debug", "info", "warn", "error"]) vm.runInContext('outputLogger.' + level + '("message")', context);
  assert.equal(created, 1);
  assert.deepEqual(calls, ["debug", "info", "warn", "error"].map(level => [level, "message"]));
  await context.exports.deactivate();
  assert.equal(disposed, 1);
});
