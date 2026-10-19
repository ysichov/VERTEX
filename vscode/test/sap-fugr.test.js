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
