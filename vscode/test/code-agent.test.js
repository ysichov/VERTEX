"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const chat = require("../chat"), assistant = require("../assistant"), compatible = require("../openai-compatible");
const anthropic = require("../anthropic"), copilot = require("../copilot"), reviewer = require("../worktree-review");
const local = require("../folder-tools"), mcp = require("../mcp");

for (const { id, fails } of ["claude", "codex", "codemie", "copilot", "anthropic-api", ...Object.keys(compatible.PROVIDERS)].map(id => ({ id, fails: false })).concat([{ id: "codex", fails: true }])) {
  test(id + (fails ? " after provider failure" : "") + " searches and edits with Git review and request cleanup", async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-agent-provider-"));
    const git = (...args) => execFileSync("git", args, { cwd: root, windowsHide: true });
    git("init", "-q"); git("config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(root, "a.txt"), "old\n");
    git("add", "a.txt"); git("-c", "user.name=test", "-c", "user.email=test@test", "commit", "-qm", "base");
    const settings = { systems: [], provider: id === "claude" ? "claude-subscription" : id === "codex" ? "codex-subscription" : id, model: "test-model" };
    const folder = { uri: { scheme: "file", fsPath: root } };
    const vscode = { workspace: { workspaceFolders: [folder], getWorkspaceFolder: () => folder,
      getConfiguration: () => ({ get: (key, fallback) => key in settings ? settings[key] : fallback }) },
      window: { tabGroups: { all: [] } }, extensions: { getExtension: () => undefined }, Uri: { file: fsPath => ({ fsPath }) } };
    let served, closed = 0, review, savedCall;
    const server = { token: "t", start: async () => ({ url: "http://127.0.0.1:1/mcp" }),
      registerTools: set => { served = set; return { route: "/chat/request", dispose: () => { closed++; } }; } };
    t.mock.method(assistant, "executableFor", async () => "test-cli");
    t.mock.method(reviewer, "open", (_vscode, copy, changes, callback, options) => {
      review = { copy, changes, callback, options }; return { dispose() {}, panel: {} };
    });
    const run = async options => {
      const access = JSON.parse(options.prompt.split("Current local project access (authoritative for this request):\n")[1].split("\n")[0]);
      assert.equal(access.folder, root);
      assert.equal(access.working_directory, options.workDir);
      assert.deepEqual(access.tools, local.schemas.map(tool => tool.name));
      assert.match(options.prompt, /Open editor tabs describe the UI, not filesystem access/);
      if (id === "claude") {
        assert.equal(options.localTools, false);
        assert.equal(options.approveUrl, "http://127.0.0.1:1/approve");
        assert.equal(options.reviewAfter, true);
        assert.deepEqual(options.tools, []);
        assert.equal(served, undefined);
        assert.doesNotMatch(options.instructions, /Grep searches literal text|These are VERTEX tools/);
        // Simulate Claude's native edit in the copy; the same review must receive it.
        const file = path.join(options.workDir, "a.txt");
        assert.equal(fs.readFileSync(file, "utf8"), "old\n");
        fs.writeFileSync(file, id + "\n");
        assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "old\n");
        return { plan: { answer: "Ready for review", build_command: "npm test" }, model: "test-model" };
      }
      assert.equal(options.localTools, true);
      assert.equal(options.maxRounds, 50);
      const names = options.tools.map(tool => typeof tool === "string" ? tool : tool.name);
      assert.deepEqual(names, local.schemas.map(tool => tool.name));
      const call = options.callTool || (async (name, args) => {
        const reply = await mcp.dispatch({}, { method: "tools/call", params: { name, arguments: args } }, served);
        if (reply.isError) throw new Error(reply.content[0].text);
        return JSON.parse(reply.content[0].text);
      });
      savedCall = call;
      assert.equal((await call("Grep", { pattern: "old" })).matches[0].file, "a.txt");
      await call("Read", { file_path: "a.txt" });
      await call("Edit", { file_path: "a.txt", old_string: "old", new_string: id });
      assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "old\n");
      if (fails) throw new Error("provider disconnected");
      return { plan: { answer: "Ready for review", build_command: "npm test" }, model: "test-model" };
    };
    t.mock.method(assistant, "ask", run);
    t.mock.method(compatible, "ask", run);
    t.mock.method(anthropic, "ask", run);
    t.mock.method(copilot, "ask", async (_vscode, options) => run(options));
    const ask = chat.create(vscode, { schemas: [], editorContext: () => null }, server, { get: async () => "secret" });
    try {
      if (fails) await assert.rejects(ask("Update the local project file"), /provider disconnected/);
      else assert.equal((await ask("Update the local project file")).answer, "Ready for review");
      assert.equal(review.changes.length, 1);
      assert.equal(review.options.build.command, fails ? "" : "npm test");
      if (savedCall) await assert.rejects(savedCall("Write", { file_path: "late.txt", content: "late" }), /no longer active/);
      await review.copy.apply(review.changes[0]);
      assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), id + "\n");
      assert.equal(closed, ["codex", "codemie"].includes(id) ? 1 : 0);
    } finally { await ask.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}
