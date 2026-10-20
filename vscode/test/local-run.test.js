"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { projectFor, scenariosFor, transpile, stageRuntime, initializeSelectorDatabase, entryFor, debugConfiguration,
  flowClasses, prepareFlow, selectorSql, startSelectorBridge, launch, setSelectorQuery, repairSelectLoops } = require("../local-run");

test("scalar SELECT loop reads the selected DDIC field", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-select-fix-"));
  try {
    const file = path.join(root, "class.mjs");
    fs.writeFileSync(file, 'let lv_factor = new abap.types.Packed({length: 9, decimals: 8});\n' +
      'await abap.statements.select(unique1, {select: "SELECT \\"action_value\\" FROM " + abap.buildDbTableName("zlog_rule")});\n' +
      'for (const unique2 of unique1.array()) { lv_factor.set(unique2); }\n');
    assert.equal(repairSelectLoops(root), 1);
    assert.match(fs.readFileSync(file, "utf8"), /lv_factor\.set\(unique2\.get\(\)\.action_value\)/);
    assert.equal(repairSelectLoops(root), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("SELECT into a smaller structure maps columns by name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-select-structure-"));
  try {
    const file = path.join(root, "class.mjs");
    fs.writeFileSync(file, 'let ls_tariff = new abap.types.Structure({price_per_unit: new abap.types.Packed()});\n' +
      'await abap.statements.select(unique1, {select: "SELECT \\"price_per_unit\\", \\"currency\\" FROM " + abap.buildDbTableName("zlog_base_tariff")});\n' +
      'for (const unique2 of unique1.array()) { ls_tariff.set(unique2); }\n');
    assert.equal(repairSelectLoops(root), 1);
    assert.match(fs.readFileSync(file, "utf8"), /moveCorresponding\(unique2, ls_tariff\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("SAP SelecTor SQL keeps ABAP ordering and removes the row limit for data preview", () => {
  assert.equal(selectorSql({ select: "SELECT value FROM zexample WHERE id = 'A' UP TO 1 ROWS" }),
    "SELECT value FROM zexample WHERE id = 'A'");
  assert.equal(selectorSql({ select: 'SELECT "modifier_class"AS name FROM "zlog_pipeline"' }),
    "SELECT modifier_class AS name FROM zlog_pipeline");
  assert.equal(selectorSql({ select: 'SELECT "price_per_unit" FROM "zlog_base_tariff" ORDER BY "valid_from" DESCENDING' }),
    "SELECT price_per_unit FROM zlog_base_tariff ORDER BY valid_from DESCENDING");
  assert.throws(() => selectorSql({ select: "DELETE FROM zexample" }), /Unsupported/);
});

test("local transpiler records Fibonacci steps without a debug session", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-trace-") );
  try {
    const source = path.join(root, "zfib.prog.abap");
    fs.writeFileSync(source, "REPORT zfib.\nDATA a TYPE i.\nDATA b TYPE i.\n" +
      "a = 0.\nb = 1.\nDO 10 TIMES.\na = a + b.\nb = b + 1.\nENDDO.\n");
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    const vscode = { workspace: { getWorkspaceFolder: () => ({ uri: { fsPath: root } }) },
      window: { createOutputChannel: () => ({ append() {}, appendLine() {}, hide() {}, show() {} }) } };
    const result = await launch(vscode, false, { document, selection: {}, trace: true });
    assert.ok(result.records.length >= 20);
    assert.ok(result.records.some(record => record.changed.a > 0));
    assert.equal(result.records.at(-1).file, source);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a local intervention changes execution and records the observed value", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-inject-"));
  try {
    const source = path.join(root, "ztry.prog.abap");
    fs.writeFileSync(source, "REPORT ztry.\nDATA lv_count TYPE i.\nlv_count = 1.\nlv_count = lv_count + 1.\nWRITE lv_count.\n");
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    const vscode = { workspace: { getWorkspaceFolder: () => ({ uri: { fsPath: root } }) },
      window: { createOutputChannel: () => ({ append() {}, appendLine() {}, hide() {}, show() {} }) } };
    const baseline = await launch(vscode, false, { document, selection: {}, trace: true });
    const changed = await launch(vscode, false, { document, selection: {}, trace: true, interventions: [
      { id: 1, object_name: "ZTRY", line: 4, name: "LV_COUNT", value: 9, occurrence: 1 }
    ] });
    assert.match(baseline.output, /2/);
    assert.match(changed.output, /10/);
    assert.deepEqual(changed.records.find(record => record.interventions?.length).interventions[0],
      { id: 1, name: "LV_COUNT", object_name: "ZTRY", line: 4, occurrence: 1, before: 1, requested: 9, after: 9 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("transpiled SELECT fetches SAP rows through SelecTor", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-select-"));
  let queried = "";
  try {
    const source = path.join(root, "zread.prog.abap");
    fs.writeFileSync(source, "REPORT zread.\nDATA value TYPE i.\n" +
      "SELECT SINGLE step_no FROM zlog_pipeline INTO value WHERE step_no = 7.\nWRITE value.\n");
    fs.writeFileSync(path.join(root, "zlog_pipeline.tabl.xml"),
      '<?xml version="1.0"?><abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values>' +
      '<DD02V><TABNAME>ZLOG_PIPELINE</TABNAME><TABCLASS>TRANSP</TABCLASS></DD02V>' +
      '<DD03P_TABLE><DD03P><FIELDNAME>STEP_NO</FIELDNAME><KEYFLAG>X</KEYFLAG><ROLLNAME>INT4</ROLLNAME>' +
      '<COMPTYPE>E</COMPTYPE></DD03P></DD03P_TABLE></asx:values></asx:abap></abapGit>');
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    const vscode = { workspace: { getWorkspaceFolder: () => ({ uri: { fsPath: root } }) },
      window: { createOutputChannel: () => ({ append() {}, appendLine() {}, hide() {}, show() {} }) } };
    setSelectorQuery(async sql => { queried = sql; return { values: [{ STEP_NO: 7 }] }; });
    const result = await launch(vscode, false, { document, selection: {}, trace: true });
    assert.match(queried, /SELECT STEP_NO FROM ZLOG_PIPELINE/i);
    assert.match(result.output, /7/);
  } finally { setSelectorQuery(undefined); fs.rmSync(root, { recursive: true, force: true }); }
});

test("local stepping skips transpiler runtime but keeps generated ABAP programs", () => {
  const config = debugConfiguration({ root: "C:/work", entry: "C:/tmp/output/index.mjs" },
    "C:/tmp/output/vertex-local-entry.mjs");
  assert.equal(config.smartStep, true);
  assert.equal(config.internalConsoleOptions, "neverOpen");
  assert.ok(config.skipFiles.includes("**/node_modules/**"));
  assert.ok(config.skipFiles.includes("**/_init.mjs"));
  assert.ok(!config.skipFiles.some(pattern => pattern.includes("project")));
});

test("local report launch uses the generated program and retains its ABAP map", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-local-run-"));
  try {
    const source = path.join(root, "src", "zcalc.prog.abap");
    const cli = path.join(root, "node_modules", "@abaplint", "transpiler-cli", "abap_transpile");
    const generated = path.join(root, "output", "project", "zcalc.prog.mjs");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(source, "REPORT zcalc.\nWRITE 5.\n");
    fs.writeFileSync(cli, "");
    fs.writeFileSync(generated, "//# sourceMappingURL=zcalc.prog.mjs.map\n");
    fs.writeFileSync(path.join(root, "abap_transpile.json"), JSON.stringify({ output_folder: "output", write_source_map: true }));
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    const entry = entryFor(projectFor(document), document);
    const wrapper = fs.readFileSync(entry, "utf8");
    assert.match(wrapper, /\.\/project\/zcalc\.prog\.mjs/);
    assert.match(wrapper, /abap\.console\.get\(\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("automatic configuration and selected radio value execute without project npm files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-auto-run-"));
  let project;
  try {
    const source = path.join(root, "src", "zcalc.prog.abap");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "REPORT zcalc.\nPARAMETERS p_a RADIOBUTTON GROUP sc DEFAULT 'X'.\n" +
      "PARAMETERS p_b RADIOBUTTON GROUP sc.\nSTART-OF-SELECTION.\nWRITE: / p_a, p_b.\n");
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    project = projectFor(document, root);
    assert.equal(project.automatic, true);
    assert.equal(fs.existsSync(path.join(root, "abap_transpile.json")), false);
    assert.equal(scenariosFor(document)[0].choices.length, 2);
    await transpile(project, { append() {} });
    stageRuntime(project);
    initializeSelectorDatabase(project);
    const entry = entryFor(project, document, { SC: "P_B" });
    assert.match(execFileSync(process.execPath, [entry], { cwd: root, encoding: "utf8" }), / X/);
    const generated = path.join(path.dirname(project.entry), "project", "zcalc.prog.mjs");
    const map = JSON.parse(fs.readFileSync(generated + ".map", "utf8"));
    assert.equal(path.resolve(path.dirname(generated), map.sources[0]), source);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (project?.automatic) fs.rmSync(path.dirname(project.configFile), { recursive: true, force: true });
  }
});

test("automatic configuration ignores unrelated ABAP files in the same src folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-filter-run-"));
  let project;
  try {
    const source = path.join(root, "src", "zcalc.prog.abap");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "REPORT zcalc.\nWRITE zcl_calc=>get_value( ).\n");
    fs.writeFileSync(path.join(root, "src", "zcl_calc.clas.abap"),
      "CLASS zcl_calc DEFINITION PUBLIC. PUBLIC SECTION. CLASS-METHODS get_value RETURNING VALUE(result) TYPE i. ENDCLASS.\n" +
      "CLASS zcl_calc IMPLEMENTATION. METHOD get_value. result = 8. ENDMETHOD. ENDCLASS.\n");
    fs.writeFileSync(path.join(root, "src", "zbroken.prog.abap"), "REPORT zbroken.\nDATA value TYPE missing_type.\n");
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    project = projectFor(document, path.join(root, "src"));
    assert.deepEqual(project.includedClasses, ["ZCL_CALC"]);
    assert.deepEqual(await flowClasses(source, path.join(root, "src")), ["ZCL_CALC"]);
    await prepareFlow(project, document, { appendLine() {} });
    const config = JSON.parse(fs.readFileSync(project.configFile, "utf8"));
    assert.ok(config.input_filter.some(filter => filter.includes("zcalc")));
    assert.ok(config.input_filter.some(filter => filter.includes("zcl_calc")));
    const output = [];
    await transpile(project, { append: text => output.push(text) });
    assert.match(output.join(""), /files added from source/);
    stageRuntime(project);
    initializeSelectorDatabase(project);
    const entry = entryFor(project, document);
    assert.match(execFileSync(process.execPath, [entry], { cwd: root, encoding: "utf8" }), /8/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (project?.automatic) fs.rmSync(path.dirname(project.configFile), { recursive: true, force: true });
  }
});

test("local DDIC table and core data element transpile without SAP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-local-ddic-"));
  let project;
  try {
    const source = path.join(root, "src", "zcalc.prog.abap");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "REPORT zcalc.\nDATA value TYPE zlog_pipeline-step_no.\nWRITE value.\n");
    fs.writeFileSync(path.join(root, "src", "zlog_pipeline.tabl.xml"),
      '<?xml version="1.0"?><abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values>' +
      '<DD02V><TABNAME>ZLOG_PIPELINE</TABNAME><TABCLASS>TRANSP</TABCLASS></DD02V>' +
      '<DD03P_TABLE><DD03P><FIELDNAME>STEP_NO</FIELDNAME><KEYFLAG>X</KEYFLAG><ROLLNAME>INT4</ROLLNAME>' +
      '<COMPTYPE>E</COMPTYPE></DD03P></DD03P_TABLE></asx:values></asx:abap></abapGit>');
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    project = projectFor(document, root);
    const config = JSON.parse(fs.readFileSync(project.configFile, "utf8"));
    assert.ok(config.input_filter.some(filter => filter.includes("zlog_pipeline")));
    assert.ok(config.input_folder.some(folder => folder.includes("open-abap-core")));
    await transpile(project, { append() {} });
    stageRuntime(project);
    initializeSelectorDatabase(project);
    const entry = entryFor(project, document);
    assert.match(execFileSync(process.execPath, [entry], { cwd: root, encoding: "utf8" }), /0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (project?.automatic) fs.rmSync(path.dirname(project.configFile), { recursive: true, force: true });
  }
});

test("bundled transpiler and runtime serve a project without npm dependencies", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-bundled-run-"));
  try {
    const source = path.join(root, "src", "zcalc.prog.abap");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "REPORT zcalc.\n");
    fs.writeFileSync(path.join(root, "abap_transpile.json"), JSON.stringify({ output_folder: "output", write_source_map: true }));
    const project = projectFor({ uri: { scheme: "file", fsPath: source } });
    assert.equal(project.cli, path.join(__dirname, "..", "node_modules", "@abaplint", "transpiler-cli", "abap_transpile"));
    stageRuntime(project);
    for (const name of ["@abaplint/runtime",
      "temporal-polyfill", "temporal-spec", "temporal-utils"]) {
      assert.equal(fs.existsSync(path.join(root, "output", "node_modules", ...name.split("/"), "package.json")), true);
    }
    const runtimeIndex = fs.readFileSync(path.join(root, "output", "node_modules", "@abaplint", "runtime", "build", "src", "index.js"), "utf8");
    assert.doesNotMatch(runtimeIndex, /sourceMappingURL=index\.js\.map/);
    const syFile = path.join(root, "output", "node_modules", "@abaplint", "runtime", "build", "src", "builtin", "sy.js");
    assert.match(fs.readFileSync(syFile, "utf8"), /vline: new types_1\.Character\(1\)\.set\("\|"\)/);
    stageRuntime(project);
    assert.equal((fs.readFileSync(syFile, "utf8").match(/vline: new types_1\.Character/g) || []).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local report can WRITE the standard SY-VLINE separator", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-vline-"));
  try {
    const source = path.join(root, "zvline.prog.abap");
    fs.writeFileSync(source, "REPORT zvline.\nWRITE: / sy-vline, 'ok', sy-vline.\n");
    const document = { uri: { scheme: "file", fsPath: source }, getText: () => fs.readFileSync(source, "utf8") };
    const vscode = { workspace: { getWorkspaceFolder: () => ({ uri: { fsPath: root } }) },
      window: { createOutputChannel: () => ({ append() {}, appendLine() {}, hide() {}, show() {} }) } };
    const result = await launch(vscode, false, { document, selection: {}, trace: true });
    assert.match(result.output, /\|ok\|/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("one compiled report runs two selection variants in parallel copies", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-parallel-"));
  try {
    const base = path.join(root, "base"), source = path.join(base, "zchoice.prog.abap");
    fs.mkdirSync(base);
    fs.writeFileSync(source, "REPORT zchoice.\nPARAMETERS p_a RADIOBUTTON GROUP sc DEFAULT 'X'.\n" +
      "PARAMETERS p_b RADIOBUTTON GROUP sc.\nWRITE: / p_a, p_b.\n");
    fs.writeFileSync(path.join(base, "abap_transpile.json"), JSON.stringify({ input_folder: ".", output_folder: "output", write_source_map: true }));
    fs.writeFileSync(path.join(base, "vertex-fingerprint.json"), JSON.stringify({ fingerprint: "same-source" }));
    const vscode = { workspace: { getWorkspaceFolder: () => ({ uri: { fsPath: base } }) },
      window: { createOutputChannel: () => ({ append() {}, appendLine() {}, hide() {}, show() {} }) } };
    const doc = file => ({ uri: { scheme: "file", fsPath: file }, getText: () => fs.readFileSync(file, "utf8") });
    await launch(vscode, false, { document: doc(source), selection: { SC: "P_A" }, trace: true });
    assert.equal(fs.existsSync(path.join(base, "output-pristine")), true);
    const run = async (name, choice) => {
      const clone = path.join(root, name);
      fs.cpSync(base, clone, { recursive: true });
      return launch(vscode, false, { document: doc(path.join(clone, "zchoice.prog.abap")),
        selection: { SC: choice }, trace: true });
    };
    const [a, b] = await Promise.all([run("a", "P_A"), run("b", "P_B")]);
    assert.notEqual(a.output, b.output);
    assert.match(a.output, /X/);
    assert.match(b.output, /X/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
