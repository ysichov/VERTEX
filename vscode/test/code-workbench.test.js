"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function host() {
  const commands = new Map(), documents = [], writes = [], diffs = [], prompts = [], errors = [], panels = [], definitions = [], hovers = [], selectionListeners = [], symbols = [];
  let selectedSystem = "DEV", mutateDuringConfirmation = false, fileProvider;
  const api = { async execute(tool, args) {
    if (tool === "read_sap_object") {
      const klass = args.object_type === "CLAS", include = args.include || "main";
      const source = args.object_type === "FUNC" ? "FUNCTION z_foo.\nENDFUNCTION."
        : klass && args.object_name === "ZCL_OTHER" ? "CLASS zcl_other DEFINITION.\n  PUBLIC SECTION.\n    METHODS do_it IMPORTING iv_name TYPE string.\nENDCLASS.\nCLASS zcl_other IMPLEMENTATION.\n  METHOD do_it.\n  ENDMETHOD.\nENDCLASS."
        : !klass ? "REPORT ztest." : include === "definitions"
        ? "CLASS ztest DEFINITION.\n  PUBLIC SECTION.\n    METHODS run IMPORTING iv_text TYPE string.\nENDCLASS."
        : include === "main" ? "CLASS ztest DEFINITION.\n  PUBLIC SECTION.\n    METHODS run IMPORTING iv_text TYPE string.\nENDCLASS.\nCLASS ztest IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\n  METHOD caller.\n    DATA lv_count TYPE i.\n    lv_count = 1.\n    run( ).\n    zcl_other=>do_it( ).\n    CALL FUNCTION 'Z_FOO'.\n  ENDMETHOD.\nENDCLASS."
          : "CLASS ztest IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.";
      return { object_name: args.object_name, object_type: args.object_type === "FUNC" || args.object_type === "INTF" ? args.object_type : klass ? "CLAS" : "PROG",
        object_url: klass ? "/sap/bc/adt/oo/classes/" + args.object_name.toLowerCase() : "/sap/bc/adt/programs/programs/ztest",
        include, source, revision: "original-revision" };
    }
    return { change_id: "id1", object_name: args.object_name, operation: "modify", object_type: "PROG",
      original_source: "original", source: args.source };
  }, discard() {}, async dispose() {}, async apply(id, payload) { writes.push({ id, ...payload }); return { activated: true, revision: require('../sap-code').revision(payload.source) }; } };
  const vscode = {
    ViewColumn: { Active: -1, Beside: -2 },
    Uri: { parse: value => ({ scheme: value.split(':')[0], toString: () => value }) },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    FileType: { File: 1 }, FileChangeType: { Changed: 1 },
    FileSystemError: { FileNotFound: () => Error('not found'), NoPermissions: text => Error(text) },
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
    ConfigurationTarget: { Global: 1 },
    TextEditorSelectionChangeKind: { Mouse: 2 },
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
    languages: { setTextDocumentLanguage: async doc => doc,
      registerDefinitionProvider: (selector, provider) => { definitions.push({ selector, provider }); return { dispose() {} }; },
      registerHoverProvider: (selector, provider) => { hovers.push({ selector, provider }); return { dispose() {} }; },
      registerDocumentSymbolProvider: (selector, provider) => { symbols.push({ selector, provider }); return { dispose() {} }; } },
    window: {
      createWebviewPanel() {
        const panel = { webview: { html: '', onDidReceiveMessage(fn) { panel.receive = fn; }, async postMessage() {} } };
        panels.push(panel); return panel;
      },
      async showTextDocument(document, options) { const editor = { document, get selection() { return document.selection; }, set selection(value) { document.selection = value; } }; this.activeTextEditor = editor; diffs.push(["open", options]); return editor; },
      onDidChangeTextEditorSelection: fn => { selectionListeners.push(fn); return { dispose() {} }; },
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
  return { tools, commands, documents, writes, diffs, prompts, errors, api, panels, definitions, hovers, selectionListeners, symbols,
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
test("F12 moves between a class method declaration and its implementation", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS", include: "implementations" });
  const definition = h.definitions[0].provider;
  const toDefinition = await definition.provideDefinition(h.documents[0], { line: 1, character: 9 });
  assert.match(toDefinition.uri.toString(), /\.definitions\.abap$/);
  assert.equal(toDefinition.range.start.line, 2);
  const toImplementation = await definition.provideDefinition(h.documents[1], { line: 2, character: 12 });
  assert.match(toImplementation.uri.toString(), /\.implementations\.abap$/);
  assert.equal(toImplementation.range.start.line, 1);
});
test("editor method hover shows its signature", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 5, character: 9 });
  assert.equal(hover.contents[0].value, "IMPORTING\n  iv_text TYPE string");
});
test("VERTEX method navigation command opens the counterpart at the method name", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS", include: "implementations" });
  h.documents[0].selection = { active: { line: 1, character: 9 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 2);
  assert.match(h.documents[1].uri.toString(), /\.definitions\.abap$/);
});
test("structural navigation matches nested DO and LOOP blocks", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = ["METHOD run.", "  DO 2 TIMES.", "    LOOP AT it_tab INTO DATA(ls_row).", "    ENDLOOP.", "  ENDDO.", "ENDMETHOD."].join("\n");
  h.documents[0].selection = { active: { line: 1, character: 4 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 4);
  h.documents[0].selection = { active: { line: 3, character: 6 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 2);
});
test("structural navigation walks IF and CASE sibling branches without entering nested blocks", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = ["METHOD run.", "  IF outer = abap_true.", "    IF inner = abap_true.", "    ELSE.", "    ENDIF.", "  ELSEIF next = abap_true.", "  ELSE.", "  ENDIF.", "  CASE kind.", "    WHEN 'A'.", "      CASE nested.", "        WHEN 'X'.", "      ENDCASE.", "    WHEN OTHERS.", "  ENDCASE.", "ENDMETHOD."].join("\n");
  // Double-click: from the opening straight to the end, and back.
  const click = async (line, from, to) => {
    const selection = { isEmpty: false, start: { line, character: from }, end: { line, character: to }, active: { line, character: to } };
    h.documents[0].getText = function (part) { return part ? this.text.split("\n")[line].slice(from, to) : this.text; };
    const editor = { document: h.documents[0], selection };
    h.selectionListeners[0]({ kind: 2, selections: [selection], textEditor: editor });
    await new Promise(resolve => setTimeout(resolve, 20));
    return editor.selection.start.line;
  };
  assert.equal(await click(1, 2, 4), 7);
  assert.equal(await click(8, 2, 6), 14);
  assert.equal(await click(14, 2, 9), 8);
  // F12 (the command) walks the branches.
  h.documents[0].selection = { active: { line: 1, character: 4 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 5);
  // Ctrl+click: through the branches as well.
  const go = async (line, character) => (await h.definitions[0].provider.provideDefinition(h.documents[0], { line, character })).range.start.line;
  assert.equal(await go(1, 4), 5);
  assert.equal(await go(5, 6), 6);
  assert.equal(await go(8, 6), 9);
  assert.equal(await go(9, 6), 13);
});
test("class main source navigation is local and makes no second SAP read", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].selection = { active: { line: 5, character: 9 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 1);
  assert.equal(h.documents[0].selection.start.line, 2);
  assert.equal(h.diffs.filter(item => item[0] === "open").length, 1);
});
test("an unqualified local method call goes to its implementation", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].selection = { active: { line: 10, character: 5 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 1);
  assert.equal(h.documents[0].selection.start.line, 5);
});
test("a name's hover is what SAP says about it, asked at the cursor of the tab's source", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const asked = [];
  h.api.elementInfo = async (...args) => { asked.push(args); return { name: "LV_COUNT", type: "CLAS/OA",
    doc: "", components: [] }; };
  // SAP's navigation points at "    DATA lv_count TYPE i." - line 9, where the name starts.
  h.api.definition = async () => ({ url: "/sap/bc/adt/oo/classes/ztest/source/main#start=9,9", line: 9, column: 9 });
  // Line 10 of the source is "    lv_count = 1."; the name starts at column 4.
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 9, character: 7 });
  assert.deepEqual(asked[0].slice(2), [10, 4]);
  assert.equal(asked[0][0], "/sap/bc/adt/oo/classes/ztest/source/main");
  assert.equal(asked[0][1], h.documents[0].getText());
  // What it is, from the element info; how it is declared, from the line.
  assert.equal(hover.contents[0].value, "attribute: lv_count TYPE i");
  // The same hover again is answered from the cache.
  await h.hovers[0].provider.provideHover(h.documents[0], { line: 9, character: 7 });
  assert.equal(asked.length, 1);
});
test("go to follows SAP's definition inside the tab, and back", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const asked = [];
  h.api.elementInfo = async () => null;
  h.api.definition = async (...args) => { asked.push(args);
    return { url: "/sap/bc/adt/oo/classes/ztest/source/main#start=9,9", line: 9, column: 9 }; };
  h.documents[0].selection = { active: { line: 9, character: 7 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.deepEqual(asked[0].slice(2), [10, 4, 12]);
  assert.equal(h.documents[0].selection.start.line, 8);
  await h.commands.get("vertex.navigateBack")();
  assert.equal(h.documents[0].selection.start.line, 9);
});
test("a name declared in a type pool is described and opened from that pool's source", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const read = [];
  h.api.elementInfo = async () => ({ name: "LV_COUNT", type: "PROG/PY", doc: "", components: [] });
  h.api.definition = async () => ({ url: "/sap/bc/adt/ddic/typegroups/abap/source/main#start=3,7", line: 3, column: 7 });
  h.api.sourceAt = async url => { read.push(url); return "TYPE-POOL abap.\n\nTYPES: lv_count TYPE c LENGTH 1.\n"; };
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 9, character: 7 });
  assert.equal(hover.contents[0].value, "type: lv_count TYPE c LENGTH 1");
  h.documents[0].selection = { active: { line: 9, character: 7 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.deepEqual(read, ["/sap/bc/adt/ddic/typegroups/abap/source/main"]);
  const opened = h.documents.at(-1);
  assert.match(opened.uri.toString(), /^vertex-source:.*ABAP%20\(read-only\)\.abap$/);
  assert.deepEqual([opened.selection.start.line, opened.selection.start.character], [2, 7]);
  // Inside the read-only view SAP is asked about its own source URL.
  opened.text = "TYPE-POOL abap.\n\nTYPES: lv_count TYPE c LENGTH 1.\n";
  const asked = [];
  h.api.elementInfo = async (...args) => { asked.push(args[0]); return { name: "LV_COUNT", type: "PROG/PY", doc: "", components: [] }; };
  h.api.definition = async () => ({ url: "/sap/bc/adt/ddic/typegroups/abap/source/main", line: 3, column: 7 });
  const inner = await h.hovers[0].provider.provideHover(opened, { line: 2, character: 9 });
  assert.deepEqual(asked, ["/sap/bc/adt/ddic/typegroups/abap/source/main"]);
  assert.equal(inner.contents[0].value, "type: lv_count TYPE c LENGTH 1");
});
test("a name declared in an interface opens that interface as a VERTEX tab", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.api.elementInfo = async () => null;
  h.api.definition = async () => ({ url: "/sap/bc/adt/oo/interfaces/zif_types/source/main#start=2,8", line: 2, column: 8 });
  h.api.sourceAt = async () => "INTERFACE zif_types PUBLIC.\n  TYPES lv_count TYPE i.\nENDINTERFACE.\n";
  const execute = h.api.execute, reads = [];
  h.api.execute = async (tool, args) => { if (tool === "read_sap_object") { reads.push(args); } return execute(tool, args); };
  h.documents[0].selection = { active: { line: 9, character: 7 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(JSON.stringify(reads.at(-1)), JSON.stringify({ object_type: "INTF", object_name: "ZIF_TYPES" }));
  assert.match(h.documents.at(-1).uri.toString(), /^vertex-sap:.*\/INTF\/ZIF_TYPES\.abap$/);
  assert.equal(h.documents.at(-1).selection.start.line, 1);
});
test("on the declaration itself SAP's info answer is not an error: the line is the declaration", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = "TYPES:\n  BEGIN OF ty_diff_op,\n    op(1) TYPE c,\n  END OF ty_diff_op.\n";
  h.api.elementInfo = async () => null;
  h.api.definition = async () => { throw new Error("Definition location found; where-used list may be possible"); };
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 1, character: 14 });
  assert.equal(hover.contents[0].value, "BEGIN OF ty_diff_op");
});
test("NEW on a class opens its constructor", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = "METHOD caller.\n  go_popup = NEW zcl_other( i_name = 'X' ).\nENDMETHOD.\n";
  h.documents[0].saved = h.documents[0].text;
  h.api.elementInfo = async () => null;
  h.api.definition = async () => ({ url: "/sap/bc/adt/oo/classes/zcl_other/source/main" });
  const execute = h.api.execute;
  h.api.execute = async (tool, args) => {
    const data = await execute(tool, args);
    return args.object_name === "ZCL_OTHER" ? { ...data, source: data.source.replace("METHOD do_it.", "METHOD do_it.\n  ENDMETHOD.\n  METHOD constructor.") } : data;
  };
  h.documents[0].selection = { active: { line: 1, character: 20 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.match(h.documents.at(-1).uri.toString(), /\/CLAS\/ZCL_OTHER\.abap$/);
  assert.equal(h.documents.at(-1).selection.start.line, 7);
});
test("outline: a class is its sections and methods, each method at its implementation", async () => {
  const h = host();
  const source = ["CLASS zcl_popup DEFINITION PUBLIC.", "  PUBLIC SECTION.", "    METHODS: constructor IMPORTING iv TYPE i,",
    "      show.", "  PRIVATE SECTION.", "    CLASS-METHODS build.", "ENDCLASS.", "CLASS zcl_popup IMPLEMENTATION.",
    "  METHOD constructor.", "  ENDMETHOD.", "  METHOD show.", "  ENDMETHOD.", "  METHOD build.", "  ENDMETHOD.", "ENDCLASS."].join("\n");
  const tree = h.symbols[0].provider.provideDocumentSymbols({ getText: () => source });
  const flat = items => items.map(item => [item.name, item.selectionRange.start.line, flat(item.children)]);
  assert.equal(JSON.stringify(flat(tree)), JSON.stringify([["zcl_popup", 0, [
    ["PUBLIC SECTION", 1, [["constructor", 8, []], ["show", 10, []]]],
    ["PRIVATE SECTION", 4, [["build", 12, []]]]]]]));
  assert.equal(tree[0].range.end.line, 14);
});
test("outline: a program is its events, forms, modules and local classes", async () => {
  const h = host();
  const source = ["REPORT ztest.", "CLASS lcl DEFINITION DEFERRED.", "INITIALIZATION.", "  PERFORM init.", "START-OF-SELECTION.",
    "  WRITE 'x'.", "FORM init.", "ENDFORM.", "MODULE status_0100 OUTPUT.", "ENDMODULE.", "CLASS lcl DEFINITION.", "  PUBLIC SECTION.",
    "    METHODS run.", "ENDCLASS.", "CLASS lcl IMPLEMENTATION.", "  METHOD run.", "  ENDMETHOD.", "ENDCLASS."].join("\n");
  const tree = h.symbols[0].provider.provideDocumentSymbols({ getText: () => source });
  assert.equal(JSON.stringify(tree.map(item => [item.name, item.detail, item.range.start.line, item.range.end.line])), JSON.stringify([
    ["INITIALIZATION", "event", 2, 3], ["START-OF-SELECTION", "event", 4, 5], ["init", "form", 6, 7],
    ["status_0100", "module", 8, 9], ["lcl", "", 10, 17]]));
  assert.equal(tree[4].children[0].children[0].selectionRange.start.line, 15);
});
test("a data element's hover names its domain, type and length", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const read = [];
  h.api.elementInfo = async () => ({ name: "versno", type: "DTEL/DE", doc: "", components: [] });
  h.api.definition = async () => ({ url: "/sap/bc/adt/ddic/dataelements/versno" });
  h.api.dataElement = async name => { read.push(name); return { typeName: "versno", dataType: "NUMC", dataTypeLength: 5 }; };
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 9, character: 7 });
  assert.equal(hover.contents[0].value, "versno  (DTEL/DE)\ndomain: VERSNO  NUMC 5");
  await h.hovers[0].provider.provideHover(h.documents[0], { line: 9, character: 7 });
  assert.deepEqual(read, ["versno"]);
});
test("SAP failing to describe a name is said in the hover, not dropped", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.api.elementInfo = async () => { throw new Error("HTTP 500"); };
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 9, character: 7 });
  assert.match(hover.contents[0].value, /SAP could not describe this name - HTTP 500/);
});
test("a static class call opens its method implementation", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].selection = { active: { line: 11, character: 16 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 2);
  assert.match(h.documents[1].uri.toString(), /\/CLAS\/ZCL_OTHER\.abap$/);
  assert.equal(h.documents[1].selection.start.line, 5);
});
test("double-click on the method after => opens that method", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const line = h.documents[0].text.split("\n")[11], from = line.indexOf("do_it"), to = from + "do_it".length;
  h.documents[0].getText = function (selection) { return selection ? line.slice(selection.start.character, selection.end.character) : this.text; };
  const selection = { isEmpty: false, start: { line: 11, character: from }, end: { line: 11, character: to }, active: { line: 11, character: to } };
  h.selectionListeners[0]({ kind: 2, selections: [selection], textEditor: { document: h.documents[0], selection } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.documents.length, 2);
  assert.match(h.documents[1].uri.toString(), /\/CLAS\/ZCL_OTHER\.abap$/);
  assert.equal(h.documents[1].selection.start.line, 5);
});
test("an instance method call opens the class inferred from its local reference", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = ["METHOD caller.", "  DATA mo_split_2p_wrap TYPE REF TO zcl_other.", "  mo_split_2p_wrap->do_it( ).", "ENDMETHOD."].join("\n");
  h.documents[0].saved = h.documents[0].text;
  h.documents[0].selection = { active: { line: 2, character: 23 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 2);
  assert.match(h.documents[1].uri.toString(), /\/CLAS\/ZCL_OTHER\.abap$/);
  assert.equal(h.documents[1].selection.start.line, 5);
  assert.equal(h.diffs.at(-1)[0], "open");
  assert.equal(h.diffs.at(-1)[1].preview, true);
  assert.equal(h.diffs.at(-1)[1].viewColumn, -1);
});
test("a dirty source opens an external method beside the edited buffer", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = ["METHOD caller.", " DATA mo_split_2p_wrap TYPE REF TO zcl_other.", " mo_split_2p_wrap->do_it( ).", "ENDMETHOD."].join("\n");
  h.documents[0].saved = "original";
  h.documents[0].selection = { active: { line: 2, character: 23 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.diffs.at(-1)[0], "open");
  assert.equal(h.diffs.at(-1)[1].preview, false);
  assert.equal(h.diffs.at(-1)[1].viewColumn, -2);
});
test("static class method hover loads and caches its signature", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 11, character: 16 });
  assert.equal(hover.contents[0].value, "Declared in ZCL_OTHER\n\nIMPORTING\n  iv_name TYPE string");
});
test("a class name in TYPE REF TO opens that class", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = "DATA mo_other TYPE REF TO zcl_other.\n";
  h.documents[0].selection = { active: { line: 0, character: 27 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 2);
  assert.match(h.documents[1].uri.toString(), /\/CLAS\/ZCL_OTHER\.abap$/);
});
test("CALL FUNCTION opens the function module source", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].selection = { active: { line: 12, character: 20 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 2);
  assert.match(h.documents[1].uri.toString(), /\/FUNC\/Z_FOO\.abap$/);
});
test("a parameter SAP locates at its method is found in that METHODS statement", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = ["CLASS ztest DEFINITION.", " PUBLIC SECTION.",
    "  METHODS constructor", "   IMPORTING", "    !i_object_type TYPE string",
    "    !is_settings TYPE zif_ave_object=>ty_settings OPTIONAL .", "  METHODS show .",
    "ENDCLASS.", "CLASS ztest IMPLEMENTATION.", " METHOD constructor.",
    "  IF is_settings IS SUPPLIED.", "  ENDIF.", " ENDMETHOD.", "ENDCLASS."].join("\n");
  h.api.elementInfo = async () => ({ name: "IS_SETTINGS", type: "", doc: "", components: [] });
  // ADT answers a parameter with its method: line 3, the column of "constructor".
  h.api.definition = async () => ({ url: "/sap/bc/adt/oo/classes/ztest/source/main", line: 3, column: 10 });
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 10, character: 8 });
  assert.equal(hover.contents[0].value, "is_settings TYPE zif_ave_object=>ty_settings OPTIONAL");
  h.documents[0].selection = { active: { line: 10, character: 8 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 5);
  assert.equal(h.documents[0].selection.start.character, 5);
});
