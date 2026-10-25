"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Claude native CLI is found without its VS Code extension", () => {
  for (const location of ["C:\\cli\\claude.exe", "C:\\user\\.local\\bin\\claude.exe"]) {
    const context = { exports: {}, process: { platform: "win32", env: { PATH: "C:\\cli" } },
      require: name => name === "path" ? path.win32 : name === "os" ? { homedir: () => "C:\\user" }
        : name === "fs" ? { constants: { X_OK: 1 }, accessSync() {}, statSync(file) {
          if (file !== location) { throw new Error("missing"); }
          return { isFile: () => true };
        } } : require(name) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assistant.js"), "utf8"), context);
    assert.equal(context.exports.locate("claude", ""), location);
  }
});

test("Claude model loading reports a missing executable before a chat request", async () => {
  const context = { exports: {}, process: { platform: "win32", env: {} },
    require: name => name === "path" ? path.win32 : name === "os" ? { homedir: () => "C:\\empty" }
      : name === "fs" ? { statSync() { throw new Error("missing"); } } : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assistant.js"), "utf8"), context);
  await assert.rejects(context.exports.models({ assistant: "claude" }), /No native Claude CLI was found/);
});

test("Claude asks which installation to use when extension and CLI are present", async () => {
  const extension = "/extensions/claude";
  const bundled = path.join(extension, "resources/native-binary/claude");
  const cli = "/users/test/.local/bin/claude";
  const values = { claudeSource: "ask" };
  let prompts = 0;
  const context = { exports: {}, process: { platform: "darwin", env: { PATH: "" } },
    require: name => name === "os" ? { homedir: () => "/users/test" }
      : name === "fs" ? { constants: { X_OK: 1 }, existsSync: file => file === bundled,
        accessSync() {}, statSync(file) { if (file !== cli) { throw new Error("missing"); }
          return { isFile: () => true }; } } : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assistant.js"), "utf8"), context);
  const vscode = { ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: () => ({
    get: key => values[key], update: async (key, value) => { values[key] = value; }
  }) }, window: { showQuickPick: async options => { prompts++; return options[1]; } } };
  assert.equal(await context.exports.resolveClaude(vscode, extension), cli);
  assert.equal(await context.exports.resolveClaude(vscode, extension), cli);
  assert.equal(prompts, 1);
  assert.equal(values.claudeSource, "cli");
  values.claudeSource = "extension";
  assert.equal(await context.exports.resolveClaude(vscode, extension), bundled);
});

test("Codex CLI resolves native and npm installations without a VS Code extension", () => {
  for (const location of ["C:\\cli\\codex.exe",
    "C:\\cli\\node_modules\\@openai\\codex\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe",
    "C:\\cli\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe",
    "C:\\cli\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe",
    "C:\\cli\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"]) {
    const context = { exports: {}, process: { platform: "win32", arch: "x64", env: { PATH: "C:\\cli" } },
      require: name => name === "path" ? path.win32 : name === "os" ? { homedir: () => "C:\\user" }
        : name === "fs" ? { constants: { X_OK: 1 }, accessSync() {}, statSync(file) {
          if (file !== location) { throw new Error("missing"); }
          return { isFile: () => true };
        } } : require(name) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assistant.js"), "utf8"), context);
    assert.equal(context.exports.locate("codex", ""), location);
  }
});

test("Codex can choose the ChatGPT.app CLI over its VS Code extension", async () => {
  const root = "/extensions/codex";
  const bundled = path.join(root, "bin/platform/codex");
  const cli = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
  const values = { codexSource: "ask" };
  let prompts = 0;
  const context = { exports: {}, process: { platform: "darwin", arch: "arm64", env: { PATH: "" } },
    require: name => name === "os" ? { homedir: () => "/users/test" }
      : name === "fs" ? { constants: { X_OK: 1 }, existsSync: file => file === bundled,
        readdirSync: () => ["platform"], readFileSync: () => '{"target":"aarch64-apple-darwin"}',
        accessSync() {}, statSync(file) { if (file !== cli) { throw new Error("missing"); }
          return { isFile: () => true }; } } : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assistant.js"), "utf8"), context);
  const vscode = { ConfigurationTarget: { Global: 1 }, workspace: { getConfiguration: () => ({
    get: key => values[key], update: async (key, value) => { values[key] = value; }
  }) }, window: { showQuickPick: async options => { prompts++; return options[1]; } } };
  assert.equal(await context.exports.resolveAssistant(vscode, "codex", root), cli);
  assert.equal(await context.exports.resolveAssistant(vscode, "codex", root), cli);
  assert.equal(prompts, 1);
  assert.equal(values.codexSource, "cli");
  values.codexSource = "extension";
  assert.equal(await context.exports.resolveAssistant(vscode, "codex", root), bundled);
});
