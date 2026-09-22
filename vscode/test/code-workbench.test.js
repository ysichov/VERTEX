"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function host() {
  const commands = new Map(), documents = [], writes = [], diffs = [], prompts = [], errors = [], panels = [], definitions = [], hovers = [];
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
      return { object_name: args.object_name, object_type: args.object_type === "FUNC" ? "FUNC" : klass ? "CLAS" : "PROG",
        object_url: klass ? "/sap/bc/adt/oo/classes/" + args.object_name.toLowerCase() : "/sap/bc/adt/programs/programs/ztest",
        include, source, revision: "original-revision" };
    }
    return { change_id: "id1", object_name: args.object_name, operation: "modify", object_type: "PROG",
      original_source: "original", source: args.source };
  }, discard() {}, async dispose() {}, async apply(id, payload) { writes.push({ id, ...payload }); return { activated: true, revision: require('../sap-code').revision(payload.source) }; } };
  const vscode = {
    ViewColumn: { Beside: -2 },
    Uri: { parse: value => ({ scheme: value.split(':')[0], toString: () => value }) },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    FileType: { File: 1 }, FileChangeType: { Changed: 1 },
    FileSystemError: { FileNotFound: () => Error('not found'), NoPermissions: text => Error(text) },
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
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
    languages: { setTextDocumentLanguage: async doc => doc,
      registerDefinitionProvider: (selector, provider) => { definitions.push({ selector, provider }); return { dispose() {} }; },
      registerHoverProvider: (selector, provider) => { hovers.push({ selector, provider }); return { dispose() {} }; } },
    window: {
      createWebviewPanel() {
        const panel = { webview: { html: '', onDidReceiveMessage(fn) { panel.receive = fn; }, async postMessage() {} } };
        panels.push(panel); return panel;
      },
      async showTextDocument(document, options) { const editor = { document, get selection() { return document.selection; }, set selection(value) { document.selection = value; } }; this.activeTextEditor = editor; diffs.push(["open", options]); return editor; },
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
  return { tools, commands, documents, writes, diffs, prompts, errors, api, panels, definitions, hovers,
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
  h.documents[0].selection = { active: { line: 1, character: 4 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 5);
  h.documents[0].selection = { active: { line: 5, character: 6 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 6);
  h.documents[0].selection = { active: { line: 8, character: 6 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 9);
  h.documents[0].selection = { active: { line: 9, character: 6 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents[0].selection.start.line, 13);
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
test("a local variable use goes to its declaration in the current method", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].selection = { active: { line: 9, character: 7 } };
  await h.commands.get("vertex.goToClassMethod")();
  assert.equal(h.documents.length, 1);
  assert.equal(h.documents[0].selection.start.line, 8);
  await h.commands.get("vertex.navigateBack")();
  assert.equal(h.documents[0].selection.start.line, 9);
});
test("local variable hover is preserved", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 9, character: 5 });
  assert.equal(hover.contents[0].value, "i");
});
test("local hover resolves chained multiline declarations and inline declarations", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = ['METHOD run.', ' DATA: lv_first TYPE i,', '       ls_options TYPE', '         ty_options,', '       lt_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.', ' IF ls_options-enabled = abap_true.', ' ENDIF.', ' DATA(lv_inline) = 1.', ' WRITE lv_inline.', 'ENDMETHOD.'].join('\n');
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], {line: 5, character: 8});
  assert.equal(hover.contents[0].value, 'ty_options');
  const inline = await h.hovers[0].provider.provideHover(h.documents[0], {line: 8, character: 10});
  assert.match(inline.contents[0].value, /inline declaration/);
});
test("signature parameter hover shows only its declaration despite nearby calls", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = 'CLASS ztest DEFINITION.\n METHODS run IMPORTING is_options TYPE ty_options.\nENDCLASS.\nCLASS ztest IMPLEMENTATION.\n METHOD run.\n append_diag( EXPORTING iv_text = |{ is_options-system }| ).\n IF is_options-ignore_generated = abap_true.\n ENDIF.\n ENDMETHOD.\nENDCLASS.';
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 6, character: 8 });
  assert.equal(hover.contents[0].value, "is_options TYPE ty_options");
});
test("parameter hover uses the current multiline signature, not a same-named parameter", async () => {
  const h = host();
  await h.tools.execute("open_sap_object", { object_name: "ZTEST", object_type: "CLAS" });
  h.documents[0].text = ["CLASS ztest DEFINITION.",
    " METHODS other IMPORTING is_options TYPE wrong_type.",
    " METHODS run", " IMPORTING", " VALUE(is_options) TYPE ty_options", " iv_text TYPE string", " RAISING cx_error.",
    "ENDCLASS.", "CLASS ztest IMPLEMENTATION.", " METHOD run.", " IF is_options-ignore_generated = abap_true.", " ENDIF.", " ENDMETHOD.", "ENDCLASS."].join("\n");
  const hover = await h.hovers[0].provider.provideHover(h.documents[0], { line: 10, character: 8 });
  assert.equal(hover.contents[0].value, "is_options TYPE ty_options");
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
