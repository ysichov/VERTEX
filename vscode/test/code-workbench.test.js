"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function host() {
  const commands = new Map(), documents = [], writes = [], diffs = [], prompts = [], errors = [], panels = [];
  let selectedSystem = "DEV", mutateDuringConfirmation = false, fileProvider;
  const api = { async execute(tool, args) {
    if (tool === "read_sap_object") { return { object_name: args.object_name, object_type: "PROG", object_url: "/sap/bc/adt/programs/programs/ztest", include: "main", source: "REPORT ztest.", revision: "original-revision" }; }
    return { change_id: "id1", object_name: args.object_name, operation: "modify", object_type: "PROG",
      original_source: "original", source: args.source };
  }, discard() {}, async dispose() {}, async apply(id, payload) { writes.push({ id, ...payload }); return { activated: true, revision: require('../sap-code').revision(payload.source) }; } };
  const vscode = {
    ViewColumn: { Beside: -2 },
    Uri: { parse: value => ({ scheme: value.split(':')[0], toString: () => value }) },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    FileType: { File: 1 }, FileChangeType: { Changed: 1 },
    FileSystemError: { FileNotFound: () => Error('not found'), NoPermissions: text => Error(text) },
    ConfigurationTarget: { Global: 1 },
    commands: {
      registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; },
      async executeCommand(...args) { diffs.push(args); }
    },
    workspace: {
      registerTextDocumentContentProvider: () => ({ dispose() {} }),
      registerFileSystemProvider: (scheme, provider) => { fileProvider = provider; return { dispose() {} }; },
      async openTextDocument(value) {
        const content = value.scheme === 'vertex-sap' ? (await fileProvider.readFile(value)).toString() : value.content || '';
        const doc = { uri: value.content === undefined ? value : vscode.Uri.parse("untitled:" + documents.length),
          text: content, saved: content, getText() { return this.text; }, version: 1, isClosed: false,
          get isDirty() { return this.text !== this.saved; },
          async save() { const text = this.text; await fileProvider.writeFile(this.uri, Buffer.from(text)); this.saved = text; return true; } };
        documents.push(doc); return doc;
      }
    },
    languages: { setTextDocumentLanguage: async doc => doc },
    window: {
      createWebviewPanel() {
        const panel = { webview: { html: '', onDidReceiveMessage(fn) { panel.receive = fn; }, async postMessage() {} } };
        panels.push(panel); return panel;
      },
      async showTextDocument(document, options) { this.activeTextEditor = { document }; diffs.push(["open", options]); },
      showInformationMessage() {}, showErrorMessage: text => errors.push(text),
      showQuickPick: async items => items[0], showInputBox: async () => "DEVK900001",
      async showWarningMessage(text, options, action) {
        prompts.push(text);
        if (mutateDuringConfirmation) { documents[1].version++; documents[1].text = "changed after confirmation"; }
        return action || "Apply";
      }
    }
  };
  const context = { subscriptions: [], workspaceState: { get: (key, fallback) => fallback, async update() {} } };
  const sandbox = { Buffer, module: { exports: {} }, __dirname: path.join(__dirname, ".."), require: id => {
    if (id === "./sap-code") { return { createRepository: () => api, revision: require('../sap-code').revision, TYPES: { PROG: "PROG/P" } }; }
    if (id === "abap-adt-api") {
      return { ADTClient: class { constructor() { this.httpClient = {}; } }, createSSLConfig: allowUnauthorized => ({
        httpsAgent: { allowUnauthorized }
      }) };
    }
    return id.startsWith(".") ? require(path.join(__dirname, "..", id)) : require(id);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../code-workbench.js"), "utf8"), sandbox);
  const tools = sandbox.module.exports.register(vscode, context, {
    active: () => ({ system: { name: selectedSystem, url: "https://sap.invalid", user: "USER", client: "100" } }),
    password: async () => "test-secret"
  });
  return { tools, commands, documents, writes, diffs, prompts, errors, api, panels,
    switchSystem: value => { selectedSystem = value; }, mutate: () => { mutateDuringConfirmation = true; } };
}
test("tool preparation opens diff, does not apply; UI applies edited text to the original system", async () => {
  const h = host();
  await h.tools.execute("modify_sap_object", { object_name: "ZTEST", source: "draft" });
  assert.equal(h.writes.length, 0);
  assert.equal(h.diffs[0][0], "vscode.diff");
  h.documents[1].text = "user edited draft";
  h.switchSystem("QAS");
  await h.commands.get("vertex.applyCodeDraft")();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].source, "user edited draft");
  assert.equal(h.writes[0].transport, "DEVK900001");
  assert.match(h.prompts[0], /DEV/);
  assert.doesNotMatch(h.prompts[0], /QAS|test-secret/);
  assert.equal(h.errors.length, 0);
});

test("SAP editor save activates original system and clears dirty state", async () => {
  const h = host();
  await h.tools.execute('open_sap_object', { object_name: 'ZTEST', object_type: 'PROG' });
  const doc = h.documents[0];
  assert.equal(doc.uri.scheme, 'vertex-sap');
  assert.equal(doc.isDirty, false);
  doc.text += "\nWRITE 'new'.";
  h.switchSystem('QAS');
  await h.commands.get('vertex.saveAndActivate')();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].source, doc.text);
  assert.match(h.prompts[0], /DEV/);
  assert.equal(doc.isDirty, false);
});
test("SAP save failure preserves unsaved editor contents", async () => {
  const h = host();
  await h.tools.execute('open_sap_object', { object_name: 'ZTEST', object_type: 'PROG' });
  const doc = h.documents[0];
  doc.text += "\ninvalid code";
  h.api.apply = async () => { throw Error('Syntax check failed'); };
  await assert.rejects(doc.save(), /Syntax check failed/);
  assert.equal(doc.isDirty, true);
  assert.match(doc.text, /invalid code/);
});
test("AI drafts use the same review and apply only from its save action", async () => {
  const h = host();
  await h.tools.execute('modify_sap_object', { object_name: 'ZTEST', source: 'replacement' });
  assert.match(h.panels[0].webview.html, /AI Code Change/);
  assert.equal(h.writes.length, 0);
  await h.panels[0].receive({ action: 'apply', approved: [0] });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].source, 'replacement');
  await h.panels[0].receive({ action: 'apply', approved: [0] });
  assert.equal(h.writes.length, 1);
});
test("ASK AI opens a prompt with the chosen block without saving", async () => {
  const h = host();
  await h.tools.execute('open_sap_object', { object_name: 'ZTEST', object_type: 'PROG' });
  h.documents[0].text = 'REPORT changed.';
  await h.tools.execute('review_sap_changes', {});
  await h.panels[0].receive({ action: 'ask', hunk: 0 });
  const action = h.diffs.find(d => d[0] === 'vertex.askReviewBlock');
  assert.match(action[1], /REPORT changed/);
  assert.equal(h.writes.length, 0);
});
for (const partial of [false, true]) {
  test((partial ? 'partial' : 'full') + " review updates editor saved state without another SAP write", async () => {
    const h = host();
    await h.tools.execute('open_sap_object', { object_name: 'ZTEST', object_type: 'PROG' });
    const doc = h.documents[0];
    doc.text = "REPORT changed.\nWRITE 'new'.";
    await h.tools.execute('review_sap_changes', {});
    if (partial) { doc.text += "\nWRITE 'later edit'."; }
    await h.panels[0].receive({ action: 'apply', approved: [0] });
    assert.equal(h.errors.length, 0);
    assert.equal(h.writes.length, 1);
    assert.equal(doc.isDirty, partial);
  });
}
test("declined review hunks stay dirty and are included in the next explicit save", async () => {
  const h = host(), execute = h.api.execute;
  h.api.execute = async (tool, args) => {
    const result = await execute(tool, args);
    return tool === 'read_sap_object' ? { ...result, source: 'one\nkeep\ntwo' } : result;
  };
  await h.tools.execute('open_sap_object', { object_name: 'ZTEST', object_type: 'PROG' });
  const doc = h.documents[0];
  doc.text = 'ONE\nkeep\nTWO';
  const review = await h.tools.execute('review_sap_changes', {});
  assert.equal(review.hunks, 2);
  await h.panels[0].receive({ action: 'apply', approved: [0] });
  assert.equal(h.writes[0].source, 'ONE\nkeep\ntwo');
  assert.equal(doc.isDirty, true);
  await doc.save();
  assert.equal(h.writes[1].source, 'ONE\nkeep\nTWO');
  assert.equal(doc.isDirty, false);
});
test("editing while the confirmation is open prevents applying unreviewed text", async () => {
  const h = host();
  await h.tools.execute("modify_sap_object", { object_name: "ZTEST", source: "draft" });
  h.mutate();
  await h.commands.get("vertex.applyCodeDraft")();
  assert.equal(h.writes.length, 0);
  assert.match(h.errors[0], /changed during confirmation/);
});

test("open from chat opens editable source beside, preserves edits and supplies follow-up context", async () => {
  const h = host();
  const result = await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "PROG" });
  assert.equal(result.opened, true);
  assert.equal(result.source, undefined);
  assert.equal(h.diffs[0][1].viewColumn, -2);
  h.documents[0].text = "REPORT ztest. WRITE 'edited'.";
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "PROG" });
  assert.equal(h.documents.length, 1);
  assert.equal(h.tools.editorContext().source, h.documents[0].text);
  assert.equal(h.tools.editorContext().base_revision, "original-revision");
  assert.equal(h.writes.length, 0);
});
