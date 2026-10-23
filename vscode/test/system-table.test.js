"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { rows, open } = require("../system-table");

const fakeVscode = (systems, active = "") => {
  const updates = [];
  const config = { get: key => key === "systems" ? systems : key === "active" ? active : undefined,
    inspect: () => ({}), update: async (key, value) => { updates.push([key, value]); if (key === "systems") systems = value; } };
  let handler, posted = [], html = "";
  const vscode = {
    workspace: { getConfiguration: () => config, onDidChangeConfiguration: () => ({ dispose() {} }) },
    window: { createWebviewPanel: () => ({ webview: { set html(v) { html = v; }, get html() { return html; },
      onDidReceiveMessage: fn => { handler = fn; }, postMessage: m => posted.push(m) }, onDidDispose() {} }),
      showWarningMessage: async () => "Remove" },
    commands: { executeCommand: async () => {} },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }, ViewColumn: { Active: -1 }
  };
  return { vscode, updates, send: m => handler(m), posted, page: () => html };
};

test("SAP Systems rows: a switched-off system is shown off and is never the active one", () => {
  const { vscode } = fakeVscode([{ name: "A4H", url: "https://a", user: "U", disabled: true }, { name: "B", url: "https://b", user: "U", authType: "snc" }]);
  const shown = rows(vscode);
  assert.equal(shown[0].on, false); assert.equal(shown[0].active, false);
  assert.equal(shown[1].active, true); assert.equal(shown[1].snc, true);
});

test("SAP Systems: switching off, deleting and testing act on the row by index and name", async () => {
  const f = fakeVscode([{ name: "A4H", url: "https://a", user: "U" }, { name: "B", url: "https://b", user: "U" }]);
  const tested = [];
  open(f.vscode, { test: async entry => { tested.push(entry.name); return "OK - ADT answers for U"; }, login: async () => true });
  new vm.Script(f.page().split("<script nonce=")[1].replace(/^[^>]*>/, "").split("</script>")[0]);
  await f.send({ action: "on", index: 0, name: "A4H", on: false });
  assert.equal(f.updates.at(-1)[1][0].disabled, true);
  await f.send({ action: "test", index: 1, name: "B" });
  assert.deepEqual(tested, ["B"]);
  assert.equal(f.posted.filter(m => m.tested !== undefined).at(-1).ok, true);
  await f.send({ action: "delete", index: 0, name: "A4H" });
  assert.deepEqual(f.updates.at(-1)[1].map(s => s.name), ["B"]);
  await f.send({ action: "test", index: 0, name: "A4H" });
  assert.match(f.posted.find(m => m.error).error, /no longer at this place/);
});

test("SAP Systems: a row with a kept password offers Change password, one without offers Log in", async () => {
  const f = fakeVscode([{ name: "A4H", url: "https://a", user: "U" }, { name: "B", url: "https://b", user: "U" }]);
  open(f.vscode, { test: async () => "OK - ", login: async () => true, hasPassword: async entry => entry.name === "A4H" });
  await f.send({ action: "ready" });
  const drawn = f.posted.find(m => m.rows).rows;
  assert.deepEqual(drawn.map(r => r.password), [true, false]);
  assert.match(f.page(), /'Change password' : 'Log in'/);
});
