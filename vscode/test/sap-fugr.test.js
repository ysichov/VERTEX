"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fugr = require("../sap-fugr");
const { collect, writeProject, copyPath } = require("../sap-transpile");
const { launch, entryScreen } = require("../local-run");

// A function group as ADT shows it: a main program, a TOP include naming a FORM include, the generated UXX, and
// modules with their signatures in their FUNCTION statements.
const ADD = "FUNCTION z_add\n  IMPORTING\n    VALUE(iv_a) TYPE i\n    VALUE(iv_b) TYPE i DEFAULT 2\n  EXPORTING\n" +
  "    VALUE(ev_sum) TYPE i\n  EXCEPTIONS\n    negative.\n\n\n\n  PERFORM add USING iv_a iv_b CHANGING ev_sum.\n" +
  "  IF ev_sum < 0.\n    RAISE negative.\n  ENDIF.\nENDFUNCTION.\n";
const ADT = {
  "/sap/bc/adt/functions/groups/zfg/source/main": "  INCLUDE lzfgtop.                     \" Global Declarations\n  INCLUDE lzfguxx.                     \" Function Modules\n  INCLUDE lzfgf01.\n",
  "/sap/bc/adt/functions/groups/zfg/includes/lzfgtop/source/main": "FUNCTION-POOL zfg.\nDATA gv_calls TYPE i.\n",
  "/sap/bc/adt/functions/groups/zfg/includes/lzfgf01/source/main": "FORM add USING a TYPE i b TYPE i CHANGING sum TYPE i.\n" +
    "  gv_calls = gv_calls + 1.\n  sum = a + b.\nENDFORM.\n",
  "/sap/bc/adt/functions/groups/zfg/fmodules/z_add/source/main": ADD,
  "/sap/bc/adt/functions/groups/zfg/fmodules/z_twice/source/main": "FUNCTION z_twice\n  IMPORTING\n    VALUE(iv_n) TYPE i\n" +
    "  EXPORTING\n    VALUE(ev_n) TYPE i.\n  ev_n = iv_n * 2.\n  DATA lv_late TYPE i.\n  lv_late = ev_n.\nENDFUNCTION.\n"
};
const sourceAt = async url => { if (!(url in ADT)) throw new Error(url + " was not found."); return ADT[url]; };
const query = async sql => /FROM tfdir WHERE funcname = '(\w+)'/.test(sql)
  ? { values: ["Z_ADD", "Z_TWICE"].includes(/'(\w+)'/.exec(sql)[1]) ? [{ PNAME: "SAPLZFG" }] : [] }
  : { values: [{ FUNCNAME: "Z_TWICE" }, { FUNCNAME: "Z_ADD" }] };
const groups = { of: module => fugr.groupOf(query, module), read: group => fugr.readFunctionGroup({ sourceAt, query }, group) };
const program = text => async ({ object_name, object_type }) => {
  if (object_name === "ZCALLER" && object_type === "PROG") return { object_name, object_type, source: text, includes: [] };
  throw new Error(object_type + " " + object_name + " was not found.");
};
const silent = () => { let log = ""; return { log: () => log, vscode: { workspace: { getWorkspaceFolder: () => undefined },
  window: { createOutputChannel: () => ({ append: t => { log += t; }, appendLine: t => { log += t + "\n"; }, hide() {}, show() {} }) } } }; };

test("a module's signature in its FUNCTION statement, and its body on the same lines", () => {
  const signature = fugr.moduleSignature(ADD);
  assert.equal(signature.name, "Z_ADD");
  assert.deepEqual([signature.firstLine, signature.lastLine], [1, 8]);
  assert.deepEqual(signature.parts.IMPORTING, [{ reference: false, name: "IV_A", type: "I" },
    { reference: false, name: "IV_B", type: "I", default: "2", optional: true }]);
  assert.deepEqual(signature.parts.EXCEPTIONS, [{ name: "NEGATIVE" }]);
  const body = fugr.moduleBody(ADD, signature);
  assert.equal(body.split("\n").length, ADD.split("\n").length);
  assert.equal(body.split("\n")[0], "FUNCTION z_add.");
  assert.equal(body.split("\n")[11], "  PERFORM add USING iv_a iv_b CHANGING ev_sum.");
});

test("qualified LIKE fields and ADT pragmas do not become function parameters", () => {
  const text = "FUNCTION fima_days_between_two_dates\n IMPORTING\n VALUE(i_flag) LIKE vtbbewe-jintraday DEFAULT SPACE\n" +
    " VALUE(i_date) LIKE vtbbewe-dbervon DEFAULT '00010101'\n EXPORTING\n" +
    " VALUE(e_tage) TYPE ANY ##ADT_PARAMETER_UNTYPED\n VALUE(e_seconds) TYPE tfmasekunden.\nENDFUNCTION.";
  const parts = fugr.moduleSignature(text).parts;
  assert.deepEqual(parts.IMPORTING.map(p => [p.name, p.like, p.default]),
    [["I_FLAG", "VTBBEWE-JINTRADAY", "SPACE"], ["I_DATE", "VTBBEWE-DBERVON", "'00010101'"]]);
  assert.deepEqual(parts.EXPORTING.map(p => p.name), ["E_TAGE", "E_SECONDS"]);
});

test("a reached standard module in another function group joins the run", async () => {
  const first = "FUNCTION fima_days_between_two_dates.\n CALL FUNCTION 'FIMA_INTEREST_METHOD_CONVERT'.\nENDFUNCTION.";
  const second = "FUNCTION fima_interest_method_convert.\nENDFUNCTION.";
  const groupSources = (group, module, text) => ({ sources: [
    { name: "SAPL" + group, kind: "main", text: "INCLUDE L" + group + "TOP." },
    { name: "L" + group + "TOP", kind: "include", text: "FUNCTION-POOL " + group + "." },
    { name: module, kind: "module", text, signature: fugr.moduleSignature(text) }
  ] });
  const bridge = { of: async module => module === "FIMA_INTEREST_METHOD_CONVERT" ? "FF05" : "FF04",
    read: async group => group === "FF05"
      ? groupSources("FF05", "FIMA_INTEREST_METHOD_CONVERT", second)
      : groupSources("FF04", "FIMA_DAYS_BETWEEN_TWO_DATES", first) };
  const sources = await collect(async () => { throw new Error("unexpected source read"); },
    { name: "FIMA_DAYS_BETWEEN_TWO_DATES", type: "FUNC" }, { groups: bridge, customer: () => false });
  assert.ok(sources.some(source => source.name === "FF05" && source.include === "FIMA_INTEREST_METHOD_CONVERT"));
});

test("the group is read whole: main program, includes but the generated UXX, every module", async () => {
  const read = await groups.read("ZFG");
  assert.deepEqual(read.sources.map(s => s.kind + " " + s.name),
    ["main SAPLZFG", "include LZFGTOP", "include LZFGF01", "module Z_ADD", "module Z_TWICE"]);
  const xml = fugr.groupXml("ZFG", read.sources);
  assert.match(xml, /<SOBJ_NAME>SAPLZFG<\/SOBJ_NAME>/);
  assert.match(xml, /<RSIMP><PARAMETER>IV_B<\/PARAMETER><DEFAULT>2<\/DEFAULT><OPTIONAL>X<\/OPTIONAL><TYP>I<\/TYP><\/RSIMP>/);
  assert.match(xml, /<RSEXC><EXCEPTION>NEGATIVE<\/EXCEPTION><\/RSEXC>/);
  await assert.rejects(fugr.groupOf(query, "Z_NONE"), /Z_NONE was not found/);
});

test("a program calling a module brings its group, and steps into the module and the group's FORM", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-fugr-"));
  try {
    const sources = await collect(program("REPORT zcaller.\nDATA lv TYPE i.\nCALL FUNCTION 'Z_ADD' EXPORTING iv_a = 40 IMPORTING ev_sum = lv.\nWRITE / lv.\n"),
      { name: "ZCALLER", type: "PROG" }, { groups });
    assert.ok(sources.some(s => s.type === "FUGR" && s.include === "Z_TWICE"), "the whole group");
    const file = writeProject("TEST", sources, [], folder);
    const document = { uri: { scheme: "file", fsPath: file }, getText: () => fs.readFileSync(file, "utf8") };
    const out = silent();
    const result = await launch(out.vscode, false, { document, selection: {}, trace: true })
      .catch(error => { throw new Error(error.message + "\n" + out.log()); });
    assert.match(result.output, /42/);
    assert.ok(result.records.some(r => path.basename(r.file) === "zfg.fugr.z_add.abap" && r.line === 12), "the module's line, as its tab has it");
    assert.ok(result.records.some(r => path.basename(r.file) === "zfg.fugr.lzfgf01.abap" && r.line === 3), "the FORM in the group's include");
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("an unused group FORM is not compiled with unresolved calls", async () => {
  const extra = "\nFORM unused.\n  PERFORM missing_form.\nENDFORM.\n";
  const isolated = { of: groups.of, read: async group => {
    const data = await groups.read(group);
    return { ...data, sources: data.sources.map(source => source.name === "LZFGF01"
      ? { ...source, text: source.text + extra } : source) };
  } };
  const sources = await collect(async () => { throw Error("no program"); },
    { name: "Z_ADD", type: "FUNC" }, { groups: isolated });
  const include = sources.find(source => source.include === "LZFGF01");
  assert.match(include.text, /FORM unused\./i);
  assert.doesNotMatch(include.text, /PERFORM missing_form/i);
  assert.match(include.text, /ASSERT 1 = 2/);
  assert.match(include.text, /FORM add[\s\S]*sum = a \+ b/i);
});

test("a module runs by itself from its copy, its parameters asked", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-fm-"));
  try {
    const sources = await collect(async () => { throw new Error("no program"); }, { name: "Z_TWICE", type: "FUNC" }, { groups });
    assert.deepEqual(sources.filter(s => s.kind === "module").map(s => s.include), ["Z_TWICE"],
      "an unrelated module of the group is not compiled for a direct FM run");
    writeProject("TEST", sources, [], folder);
    const module = sources.find(s => s.include === "Z_TWICE");
    const file = copyPath(folder, module);
    const document = { uri: { scheme: "file", fsPath: file }, getText: () => fs.readFileSync(file, "utf8"), isDirty: false };
    assert.deepEqual(entryScreen(document, 6).parameters.map(p => p.name), ["IV_N", "EV_N"]);
    const out = silent();
    const result = await launch(out.vscode, false, { document, entryLine: 6, trace: true, selection: { $entry: { parameters: { IV_N: "21" } } } })
      .catch(error => { throw new Error(error.message + "\n" + out.log()); });
    assert.match(result.output, /VERTEX:S	EV_N	42/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a function group's non-L include provides its constants to modules", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-fugr-nonl-"));
  try {
    const body = "FUNCTION z_constant IMPORTING VALUE(iv_blank) TYPE c DEFAULT SPACE EXPORTING VALUE(ev_n) TYPE i.\n  ev_n = con_answer.\nENDFUNCTION.\n";
    const sources = [
      { type: "FUGR", name: "ZFG", kind: "main", include: "SAPLZFG", text: "INCLUDE lzfgtop.\n" },
      { type: "FUGR", name: "ZFG", kind: "include", include: "LZFGTOP", text: "FUNCTION-POOL zfg.\nINCLUDE ZCONSTANTS.\n" },
      { type: "FUGR", name: "ZFG", kind: "include", include: "ZCONSTANTS", text: "CONSTANTS con_answer TYPE i VALUE 42.\nCONSTANTS con_space TYPE c VALUE space.\n" },
      { type: "FUGR", name: "ZFG", kind: "module", include: "Z_CONSTANT", text: body,
        signature: fugr.moduleSignature(body) }
    ];
    const file = writeProject("TEST", sources, [], folder);
    assert.match(fs.readFileSync(path.join(folder, "src", "zfg.fugr.xml"), "utf8"), /<SOBJ_NAME>LZFGVERTEX001<\/SOBJ_NAME>/);
    assert.ok(fs.existsSync(path.join(folder, "src", "zfg.fugr.lzfgvertex001.abap")));
    const module = copyPath(folder, sources[3]);
    const document = { uri: { scheme: "file", fsPath: module }, getText: () => fs.readFileSync(module, "utf8") };
    const out = silent();
    await launch(out.vscode, false, { document, entryLine: 2, selection: {}, trace: true })
      .catch(error => { throw new Error(error.message + "\n" + out.log()); });
    assert.ok(fs.existsSync(path.join(folder, "output", "index.mjs")));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("legacy ABAP >< is normalized without changing a quoted literal", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-legacy-ne-"));
  try {
    const sources = [
      { type: "FUGR", name: "ZFG", kind: "main", include: "SAPLZFG", text: "INCLUDE LZFGTOP.\nINCLUDE LZFGF01.\n" },
      { type: "FUGR", name: "ZFG", kind: "include", include: "LZFGTOP", text: "FUNCTION-POOL ZFG.\n" },
      { type: "FUGR", name: "ZFG", kind: "include", include: "LZFGF01", text: "FORM check.\n  IF a >< b.\n    WRITE ' >< '.\n  ENDIF.\nENDFORM.\n" }
    ];
    writeProject("TEST", sources, [], folder);
    const text = fs.readFileSync(copyPath(folder, sources[2]), "utf8");
    assert.match(text, /IF a <> b/);
    assert.match(text, /WRITE ' >< '/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("module STATICS become private group data with persistent VALUE initialization", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-statics-"));
  try {
    const body = "FUNCTION z_count EXPORTING VALUE(ev_count) TYPE i.\n" +
      "  STATICS: count TYPE i VALUE 1, total TYPE i.\n" +
      "  count = count + 1.\n  total = total + count.\n  ev_count = total.\nENDFUNCTION.";
    const sources = [
      { type: "FUGR", name: "ZFG", kind: "main", include: "SAPLZFG", text: "INCLUDE LZFGTOP." },
      { type: "FUGR", name: "ZFG", kind: "include", include: "LZFGTOP", text: "FUNCTION-POOL ZFG." },
      { type: "FUGR", name: "ZFG", kind: "module", include: "Z_COUNT", text: body, signature: fugr.moduleSignature(body) }
    ];
    writeProject("TEST", sources, [], folder);
    const top = fs.readFileSync(copyPath(folder, sources[1]), "utf8");
    const module = fs.readFileSync(copyPath(folder, sources[2]), "utf8");
    const aliases = [...top.matchAll(/ZVX_S[A-F0-9]{20}/g)].map(match => match[0]);
    assert.equal(new Set(aliases).size, 2);
    assert.match(top, /DATA: ZVX_S[A-F0-9]{20} TYPE i VALUE 1, ZVX_S[A-F0-9]{20} TYPE i\./i);
    for (const alias of aliases) assert.match(module, new RegExp(alias));
    assert.doesNotMatch(module, /STATICS|\bcount\b|\btotal\b/i);
    assert.equal(module.split("\n").length, body.split("\n").length);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("generated modules accept upper-case ABAP parameter bindings", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-params-"));
  try {
    const file = path.join(folder, "zfg.fugr.mjs");
    fs.writeFileSync(file, "async function z_read(INPUT) { let e_days = INPUT.importing?.e_days; let i_date = INPUT.exporting?.i_date; }\n");
    fugr.applyModuleDefaults(folder, [{ module: "Z_READ", params: [] }]);
    const code = fs.readFileSync(file, "utf8");
    assert.match(code, /INPUT\.importing\?\.e_days \?\? INPUT\.importing\?\.E_DAYS/);
    assert.match(code, /INPUT\.exporting\?\.i_date \?\? INPUT\.exporting\?\.I_DATE/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("module defaults are patched in the defining group, not a caller's group", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-default-owner-"));
  try {
    fs.writeFileSync(path.join(folder, "a.fugr.mjs"), "if (abap.FunctionModules['Z_READ'] === undefined) throw Error();\n");
    const owner = path.join(folder, "b.fugr.mjs");
    fs.writeFileSync(owner, "async function z_read(INPUT) {\n  let i_flag = INPUT.exporting?.i_flag;\n  if (i_flag === undefined) {\n    i_flag = new abap.types.Character(1);\n  }\n}\nabap.FunctionModules['Z_READ'] = z_read;\n");
    fugr.applyModuleDefaults(folder, [{ module: "Z_READ", params: [{ name: "I_FLAG", default: "SPACE" }] }]);
    assert.match(fs.readFileSync(owner, "utf8"), /i_flag\.set\(" "\)/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a field declared as both importing and exporting has one generated binding", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-shared-param-"));
  try {
    const file = path.join(folder, "zfg.fugr.mjs");
    fs.writeFileSync(file, "async function z_read(INPUT) {\n  let date = INPUT.exporting?.date;\n  let date = INPUT.importing?.date;\n  if (date === undefined) {\n    date = (() => { throw Error('void'); })();\n  }\n}\nabap.FunctionModules['Z_READ'] = z_read;\n");
    fugr.applyModuleDefaults(folder, [{ module: "Z_READ", params: [] }]);
    const code = fs.readFileSync(file, "utf8");
    assert.equal((code.match(/let date =/g) || []).length, 1);
    assert.doesNotMatch(code, /throw Error\('void'\)/);
    assert.match(code, /date\.set\(\(INPUT\.exporting\?\.date \?\? INPUT\.exporting\?\.DATE\)\)/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
