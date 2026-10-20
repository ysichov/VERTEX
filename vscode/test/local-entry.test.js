"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const entry = require("../local-entry");

test("source-map positions advance through every segment on a generated line", () => {
  const trace = require("../local-trace");
  const map = { mappings: "AAAA,AEOA;AAEA" };
  assert.deepEqual(trace.mappedPlaces(map), [[0, 1], [2, 10]]);
  assert.deepEqual(trace.mappedLines(map), [1, 0]);
});

const CLASS = `CLASS zcl_calc DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_item, matnr TYPE c LENGTH 18, qty TYPE i, END OF ty_item,
           ty_items TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY.
    METHODS constructor IMPORTING iv_rate TYPE i DEFAULT 3.
    METHODS total IMPORTING it_items TYPE ty_items is_head TYPE ty_item iv_flag TYPE abap_bool OPTIONAL
                  EXPORTING ev_count TYPE i CHANGING cv_note TYPE string RETURNING VALUE(rv_sum) TYPE i.
  PRIVATE SECTION.
    METHODS hidden.
    DATA mv_rate TYPE i.
ENDCLASS.
CLASS zcl_calc IMPLEMENTATION.
  METHOD constructor.
    mv_rate = iv_rate.
  ENDMETHOD.
  METHOD total.
    rv_sum = lines( it_items ) * mv_rate.
  ENDMETHOD.
  METHOD hidden.
    CLEAR mv_rate.
  ENDMETHOD.
ENDCLASS.
`;
const GROUP = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_FUGR" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <AREAT>test</AREAT>
   <INCLUDES><SOBJ_NAME>LZFGTOP</SOBJ_NAME><SOBJ_NAME>SAPLZFG</SOBJ_NAME></INCLUDES>
   <FUNCTIONS>
    <item>
     <FUNCNAME>Z_ADD</FUNCNAME>
     <SHORT_TEXT>add</SHORT_TEXT>
     <IMPORT><RSIMP><PARAMETER>IV_A</PARAMETER><TYP>I</TYP></RSIMP><RSIMP><PARAMETER>IV_B</PARAMETER><DEFAULT>2</DEFAULT><OPTIONAL>X</OPTIONAL><TYP>I</TYP></RSIMP></IMPORT>
     <EXPORT><RSEXP><PARAMETER>EV_SUM</PARAMETER><TYP>I</TYP></RSEXP></EXPORT>
    </item>
   </FUNCTIONS>
  </asx:values>
 </asx:abap>
</abapGit>`;

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-entry-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return { dir, paths: Object.keys(files).map(name => path.join(dir, name)) };
}
const lineOf = (text, pattern) => text.split("\n").findIndex(line => pattern.test(line)) + 1;

test("the method under the cursor is the target; a line outside every method is none", () => {
  const file = path.join(os.tmpdir(), "zcl_calc.clas.abap");
  assert.deepEqual(entry.targetAt(file, CLASS, lineOf(CLASS, /rv_sum = lines/)), { kind: "method", object: "ZCL_CALC", name: "TOTAL" });
  assert.equal(entry.targetAt(file, CLASS, lineOf(CLASS, /PUBLIC SECTION/)), null);
  assert.equal(entry.targetAt(path.join(os.tmpdir(), "z.prog.abap"), "REPORT z.", 1), null, "a program is run as a program");
});

test("a method's screen has its types: a table's row, a structure's fields, the constructor with its DEFAULT", () => {
  const { paths } = folder({ "zcl_calc.clas.abap": CLASS });
  const target = entry.targetAt(paths[0], CLASS, lineOf(CLASS, /rv_sum = lines/));
  const screen = entry.screenOf(entry.parametersOf(target, paths), paths);
  const by = name => screen.parameters.find(p => p.name === name);
  assert.equal(by("IT_ITEMS").shape.kind, "table");
  assert.deepEqual(by("IT_ITEMS").shape.row.fields.map(f => f.name), ["MATNR", "QTY"]);
  assert.equal(by("IS_HEAD").shape.kind, "structure");
  assert.equal(by("IV_FLAG").optional, true);
  assert.deepEqual(screen.creation.map(p => [p.name, p.default]), [["IV_RATE", "3"]]);
});

test("a private method runs too: the transpiler does not check visibility", () => {
  const { paths } = folder({ "zcl_calc.clas.abap": CLASS });
  const target = entry.targetAt(paths[0], CLASS, lineOf(CLASS, /CLEAR mv_rate/));
  assert.deepEqual(target, { kind: "method", object: "ZCL_CALC", name: "HIDDEN" });
  const source = entry.driverSource(entry.screenOf(entry.parametersOf(target, paths), paths), {});
  assert.ok(source.includes("zvx_object->hidden( )."), source);
});
test("the call program sets the values, passes an optional parameter only when given, and writes the simple results", () => {
  const { paths } = folder({ "zcl_calc.clas.abap": CLASS });
  const target = entry.targetAt(paths[0], CLASS, lineOf(CLASS, /rv_sum = lines/));
  const screen = entry.screenOf(entry.parametersOf(target, paths), paths);
  const source = entry.driverSource(screen, { parameters: { IT_ITEMS: [{ MATNR: "A", QTY: "2" }], IS_HEAD: { MATNR: "It's" }, CV_NOTE: "n" }, creation: { IV_RATE: "10" } });
  assert.match(source, /FIELD-SYMBOLS <zvx1> LIKE LINE OF IT_ITEMS\./);
  assert.match(source, /<zvx1>-qty = '2'\./);
  assert.match(source, /IS_HEAD-matnr = 'It''s'\./, "a quote in a value is doubled");
  assert.match(source, /zvx_object = NEW zcl_calc\( iv_rate = c_IV_RATE \)\./);
  assert.doesNotMatch(source, /iv_flag =/, "IV_FLAG was not given");
  assert.match(source, /RECEIVING rv_sum = RV_SUM/);
  assert.match(source, /WRITE \/ \|VERTEX:S\\tRV_SUM\\t\{ RV_SUM \}\|\./, "a result in VERTEX's form, for the window to draw");
});

test("a function module is called with CALL FUNCTION, its DEFAULT set where nothing was given", () => {
  const { paths } = folder({ "zfg.fugr.xml": GROUP, "zfg.fugr.lzfgtop.abap": "FUNCTION-POOL zfg.\n",
    "zfg.fugr.saplzfg.abap": "INCLUDE lzfgtop.\n", "zfg.fugr.z_add.abap": "FUNCTION z_add.\n  ev_sum = iv_a + iv_b.\nENDFUNCTION.\n" });
  const module = paths.find(p => /z_add/.test(p));
  const target = entry.targetAt(module, fs.readFileSync(module, "utf8"), 2);
  assert.deepEqual(target, { kind: "function", group: "ZFG", name: "Z_ADD" });
  const source = entry.driverSource(entry.screenOf(entry.parametersOf(target, paths), paths), { parameters: { IV_A: "40" } });
  assert.match(source, /IV_B = 2\./);
  assert.match(source, /CALL FUNCTION 'Z_ADD' EXPORTING iv_a = IV_A iv_b = IV_B IMPORTING ev_sum = EV_SUM\./);
});

test("an interface's method of a class takes its signature from the interface and is called through it", () => {
  const face = "INTERFACE zif_pricing PUBLIC.\n  TYPES: BEGIN OF ty_ctx, weight TYPE i, rate TYPE i, END OF ty_ctx.\n"
    + "  METHODS calculate_base IMPORTING is_ctx TYPE ty_ctx RETURNING VALUE(rv_amount) TYPE i.\nENDINTERFACE.\n";
  const road = "CLASS zcl_price_road DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES zif_pricing.\nENDCLASS.\n"
    + "CLASS zcl_price_road IMPLEMENTATION.\n  METHOD zif_pricing~calculate_base.\n    rv_amount = is_ctx-weight * is_ctx-rate.\n  ENDMETHOD.\nENDCLASS.\n";
  const { paths } = folder({ "zif_pricing.intf.abap": face, "zcl_price_road.clas.abap": road });
  const target = entry.targetAt(paths[1], road, 7);
  assert.deepEqual(target, { kind: "method", object: "ZCL_PRICE_ROAD", name: "ZIF_PRICING~CALCULATE_BASE" });
  const screen = entry.screenOf(entry.parametersOf(target, paths), paths);
  assert.deepEqual(screen.parameters.map(p => [p.name, p.shape.kind]), [["IS_CTX", "structure"], ["RV_AMOUNT", "simple"]]);
  assert.ok(entry.driverSource(screen, { parameters: { IS_CTX: { WEIGHT: "1200" } } }).includes("zvx_object->zif_pricing~calculate_base( EXPORTING is_ctx = IS_CTX RECEIVING rv_amount = RV_AMOUNT )."));
});

test("a reference is declared as REF TO: as a result it is kept for Variables, not written; it is never entered", () => {
  const face = "INTERFACE zif_mod PUBLIC.\n  METHODS apply.\nENDINTERFACE.\n";
  const facade = "CLASS zcl_facade DEFINITION PUBLIC CREATE PUBLIC.\n  PRIVATE SECTION.\n"
    + "    METHODS modifier_for IMPORTING iv_name TYPE string RETURNING VALUE(ro_modifier) TYPE REF TO zif_mod.\nENDCLASS.\n"
    + "CLASS zcl_facade IMPLEMENTATION.\n  METHOD modifier_for.\n    CLEAR ro_modifier.\n  ENDMETHOD.\nENDCLASS.\n";
  const { paths } = folder({ "zif_mod.intf.abap": face, "zcl_facade.clas.abap": facade });
  const target = entry.targetAt(paths[1], facade, 7);
  const screen = entry.screenOf(entry.parametersOf(target, paths), paths);
  const result = screen.parameters.find(p => p.name === "RO_MODIFIER");
  assert.equal(result.declare, "REF TO zif_mod");
  assert.equal(result.shape.kind, "reference");
  const source = entry.driverSource(screen, { parameters: { IV_NAME: "X" } });
  assert.ok(source.includes("DATA RO_MODIFIER TYPE REF TO zif_mod."));
  assert.ok(!source.includes("'RO_MODIFIER ='"), "a reference is not written");
});

test("a required class reference is created by default and exposes its class variables", () => {
  const log = "CLASS zcl_calc_log DEFINITION PUBLIC ABSTRACT CREATE PRIVATE.\n  PUBLIC SECTION.\n    METHODS constructor IMPORTING iv_value TYPE i.\n  PRIVATE SECTION.\n    DATA mt_log TYPE string.\nENDCLASS.\nCLASS zcl_calc_log IMPLEMENTATION.\n  METHOD constructor. ENDMETHOD.\nENDCLASS.\n";
  const owner = "CLASS zcl_owner DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS run IMPORTING io_log TYPE REF TO zcl_calc_log.\nENDCLASS.\nCLASS zcl_owner IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.\n";
  const { paths } = folder({ "zcl_calc_log.clas.abap": log, "zcl_owner.clas.abap": owner });
  const target = entry.targetAt(paths[1], owner, 6), screen = entry.screenOf(entry.parametersOf(target, paths), paths);
  const shape = screen.parameters[0].shape;
  assert.equal(shape.className, "ZCL_CALC_LOG");
  assert.equal(shape.createDefault, true);
  assert.deepEqual(shape.constructorArgs, ["IV_VALUE"]);
  assert.deepEqual(shape.attributes.map(a => a.name), ["MT_LOG"]);
  assert.match(entry.driverSource(screen, {}), /IO_LOG = NEW zcl_calc_log\( iv_value = VALUE #\( \) \)\./);
  assert.match(entry.driverSource(screen, { parameters: { IO_LOG: { create: true } } }), /IO_LOG = NEW zcl_calc_log\( iv_value = VALUE #\( \) \)\./);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-reference-copy-"));
  try {
    fs.mkdirSync(path.join(projectRoot, "src"));
    fs.writeFileSync(path.join(projectRoot, "vertex-includes.json"), "{}");
    const copy = path.join(projectRoot, "src", "zcl_calc_log.clas.abap");
    fs.writeFileSync(copy, log);
    entry.relaxReferenceClasses({ root: projectRoot }, screen);
    assert.match(fs.readFileSync(copy, "utf8"), /DEFINITION PUBLIC CREATE PUBLIC/);
  } finally { if (projectRoot.startsWith(os.tmpdir() + path.sep)) fs.rmSync(projectRoot, { recursive: true, force: true }); }
});

test("the call program is not recorded: the run shows only the code it calls", () => {
  const { dir } = folder({ "zvertex_run.prog.abap": "REPORT zvertex_run.\n" });
  fs.writeFileSync(path.join(dir, "zvertex_run.prog.mjs"), "// generated\n");
  fs.writeFileSync(path.join(dir, "zvertex_run.prog.mjs.map"), JSON.stringify({ version: 3, sources: ["zvertex_run.prog.abap"], mappings: "" }));
  assert.equal(require("../local-trace").instrumentProject(dir, false, ["zvertex_run.prog.abap"]), 0);
  assert.equal(fs.readFileSync(path.join(dir, "zvertex_run.prog.mjs"), "utf8"), "// generated\n");
});

test("a generated file of several sources records each one's lines with its own routine - a function group's module", () => {
  const { dir } = folder({ "zfg.fugr.lzfgtop.abap": "FUNCTION-POOL zfg.\n", "zfg.fugr.z_add.abap": "FUNCTION z_add.\n*\"     REFERENCE(IV_A) TYPE  I\n  ev_sum = iv_a.\nENDFUNCTION.\n" });
  // Generated line 1 from source 0 line 1; line 2 from source 1 line 1; line 3 from source 1 line 3.
  fs.writeFileSync(path.join(dir, "zfg.fugr.mjs"), "abap.pool();\nabap.start();\nabap.add();\n");
  fs.writeFileSync(path.join(dir, "zfg.fugr.mjs.map"), JSON.stringify({ version: 3,
    sources: ["zfg.fugr.lzfgtop.abap", "zfg.fugr.z_add.abap"], mappings: "AAAA;ACAA;AAEA" }));
  assert.equal(require("../local-trace").instrumentProject(dir, false), 1);
  const code = fs.readFileSync(path.join(dir, "zfg.fugr.mjs"), "utf8");
  assert.doesNotMatch(code, /lzfgtop\.abap",1/, "FUNCTION-POOL is no step");
  // The record stands on the statement's own line, so the generated lines keep their numbers.
  assert.match(code, /z_add\.abap",3,\{"iv_a":[^\n]*\},"ZFG","Z_ADD"\); abap\.add\(\);/);
});
