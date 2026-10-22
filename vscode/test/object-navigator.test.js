"use strict";
const test = require("node:test"), assert = require("node:assert");
const navigator = require("../object-navigator");

test("a package lists its subpackages, then its objects under ADT's categories and types", () => {
  const tree = navigator.packageTree({
    nodes: [
      { OBJECT_TYPE: "DEVC/K", OBJECT_NAME: "Z_RIG_SUB", DESCRIPTION: "Sub" },
      { OBJECT_TYPE: "CLAS/OC", OBJECT_NAME: "ZCL_CALC_FACADE", DESCRIPTION: "Facade" },
      { OBJECT_TYPE: "PROG/P", OBJECT_NAME: "ZVERTEX_DEBUG_LAB" },
      { OBJECT_TYPE: "TABL/DT", OBJECT_NAME: "ZRIG_T" }],
    categories: [{ CATEGORY: "dictionary", CATEGORY_LABEL: "Dictionary Objects" }, { CATEGORY: "source_library", CATEGORY_LABEL: "Class Library" }],
    objectTypes: [{ OBJECT_TYPE: "TABL/DT", CATEGORY_TAG: "dictionary", OBJECT_TYPE_LABEL: "Database Tables" },
      { OBJECT_TYPE: "CLAS/OC", CATEGORY_TAG: "source_library", OBJECT_TYPE_LABEL: "Classes" }]
  });
  assert.deepEqual(tree.map(n => n.label), ["Packages", "Dictionary Objects", "Class Library", "Programs"]);
  assert.deepEqual(tree[0].children[0].expand, { name: "Z_RIG_SUB", type: "DEVC" });
  assert.equal(tree[1].children[0].children[0].open, undefined);
  const klass = tree[2].children[0].children[0];
  assert.deepEqual([klass.open, klass.expand], [{ name: "ZCL_CALC_FACADE", type: "CLAS" }, { name: "ZCL_CALC_FACADE", type: "CLAS" }]);
  assert.deepEqual(tree[3].children[0].open, { name: "ZVERTEX_DEBUG_LAB", type: "PROG" });
});

test("a class groups its components and opens each at its line in the main source", () => {
  const link = (rel, href) => ({ rel: "http://www.sap.com/adt/relations/source/" + rel, href });
  const tree = navigator.classTree({ components: [
    { "adtcore:name": "RUN", "adtcore:type": "CLAS/OM", visibility: "public",
      links: [link("definitionIdentifier", "./source/main#start=5,12"), link("implementationIdentifier", "./source/main#start=20,9")] },
    { "adtcore:name": "MV_X", "adtcore:type": "CLAS/OA", visibility: "private", links: [link("definitionIdentifier", "./source/main#start=8,4")] },
    { "adtcore:name": "LCL_HELP", "adtcore:type": "CLAS/OCL", links: [link("definitionIdentifier", "./includes/implementations#start=1,1")] }
  ] }, "ZCL_A", "CLAS");
  assert.deepEqual(tree.map(g => g.label), ["Attributes", "Methods", "CLAS/OCL"]);
  assert.deepEqual(tree[1].children[0].open, { name: "ZCL_A", type: "CLAS", line: 20 });
  assert.deepEqual(tree[0].children[0].open, { name: "ZCL_A", type: "CLAS", line: 8 });
  assert.equal(tree[2].children[0].open, undefined);
});

test("Object Navigator is first in the picker of a class and a package in VS Code", () => {
  require("../tools-window");
  const model = require("../resources/object-tools");
  assert.equal(model.objects.find(o => o[0] === "CLAS")[2][0], "navigator");
  assert.equal(model.objects.find(o => o[0] === "DEVC")[2][0], "navigator");
  assert.equal(model.normalize({ type: "CLAS", name: "ZCL_A" }).action, "navigator");
  assert.equal(model.normalize({ type: "CLAS", name: "ZCL_A", action: "uml" }).action, "uml");
});

test("a transport request lists its objects once each, by type; a method opens in its class", () => {
  const tree = navigator.requestTree([
    { OBJECT: "TABL", OBJ_NAME: "ZRIG_T" }, { OBJECT: "CLAS", OBJ_NAME: "ZCL_A" }, { OBJECT: "CLAS", OBJ_NAME: "ZCL_A" },
    { OBJECT: "METH", OBJ_NAME: "ZCL_B".padEnd(30) + "RUN" }]);
  assert.deepEqual(tree.map(n => n.label), ["CLAS", "METH", "TABL"]);
  assert.equal(tree[0].children.length, 1);
  assert.deepEqual(tree[0].children[0].expand, { name: "ZCL_A", type: "CLAS" });
  assert.deepEqual(navigator.requestTree([{ OBJECT: "FUGR", OBJ_NAME: "ZVX_CALC" }])[0].children[0].expand, { name: "ZVX_CALC", type: "FUGR" });
  const group = navigator.packageTree({ nodes: [{ OBJECT_TYPE: "FUGR/FF", OBJECT_NAME: "Z_CALC" }],
    categories: [{ CATEGORY: "f", CATEGORY_LABEL: "Function Modules" }], objectTypes: [{ OBJECT_TYPE: "FUGR/FF", CATEGORY_TAG: "f", OBJECT_TYPE_LABEL: "Function Modules" }] });
  assert.deepEqual(group[0].children[0].children[0].open, { name: "Z_CALC", type: "FUNC" });
  assert.deepEqual(tree[1].children[0].open, { name: "ZCL_B", type: "CLAS", method: "RUN" });
  assert.equal(tree[2].children[0].open, undefined);
});

test("Object Navigator is first for a transport request too, and its default", () => {
  require("../tools-window");
  const model = require("../resources/object-tools");
  assert.equal(model.objects.find(o => o[0] === "TR")[2][0], "navigator");
  assert.equal(model.normalize({ type: "TR", name: "A4HK900001" }).action, "navigator");
});

test("a package names its types as SE80 does and leaves out ADT's folder entries", () => {
  const tree = navigator.packageTree({
    nodes: [{ OBJECT_TYPE: "CLAS/OC", OBJECT_NAME: "ZCL_A" }, { OBJECT_TYPE: "DEVC/OC", OBJECT_NAME: "CLAS/OC" }],
    categories: [{ CATEGORY: "s", CATEGORY_LABEL: "Source Code Library" }],
    objectTypes: [{ OBJECT_TYPE: "CLAS/OC", CATEGORY_TAG: "s", OBJECT_TYPE_LABEL: "" }] });
  assert.deepEqual(tree.map(n => n.label), ["Source Code Library"]);
  assert.equal(tree[0].children[0].label, "Classes");
});

test("a function group's modules and includes go by SE80's names", () => {
  const tree = navigator.packageTree({ nodes: [{ OBJECT_TYPE: "FUGR/FF", OBJECT_NAME: "Z_A" }, { OBJECT_TYPE: "FUGR/I", OBJECT_NAME: "LZTOP" }] });
  assert.deepEqual(tree.map(n => n.label), ["Function Modules", "Includes"]);
  assert.deepEqual(tree[1].children[0].open, { name: "LZTOP", type: "INCL" });
});

test("a program's form opens the program at it; its include opens itself", () => {
  const tree = navigator.packageTree({ nodes: [{ OBJECT_TYPE: "PROG/I", OBJECT_NAME: "ZINC" }, { OBJECT_TYPE: "PROG/PU", OBJECT_NAME: "DO_IT" }] }, { name: "ZPROG", type: "PROG" });
  assert.deepEqual(tree.find(n => n.label === "Includes").children[0].open, { name: "ZINC", type: "INCL",
    declaredIn: { name: "ZPROG", type: "PROG", include: "ZINC" } });
  assert.deepEqual(tree.find(n => n.label === "Subroutines").children[0].open, { name: "ZPROG", type: "PROG", method: "DO_IT" });
});

test("a class shows its superclass and its friends, and not itself again", () => {
  const tree = navigator.classTree({ components: [
    { "adtcore:name": "ZCL_FRIEND", "adtcore:type": "CLAS/OF", links: [] },
    { "adtcore:name": "ZCL_A", "adtcore:type": "CLAS/OCX", links: [] }] }, "ZCL_A", "CLAS", "ZCL_BASE");
  assert.deepEqual(tree.map(g => g.label), ["Inherited from", "Friends of"]);
  assert.deepEqual(tree[0].children[0].open, { name: "ZCL_BASE", type: "CLAS" });
});

test("a program's local classes unfold to their own methods and attributes; empty types are left out", () => {
  const data = { nodes: [{ OBJECT_TYPE: "PROG/PL", OBJECT_NAME: "LCL_A", NODE_ID: "000042" },
    { OBJECT_TYPE: "PROG/PLM", OBJECT_NAME: "RUN" }, { OBJECT_TYPE: "PROG/PLA", OBJECT_NAME: "MV_X" },
    { OBJECT_TYPE: "PROG/T", OBJECT_NAME: "" }] };
  const tree = navigator.packageTree(data, { name: "ZPROG", type: "PROG" });
  assert.deepEqual(tree.map(n => n.label), ["Local Classes"]);
  assert.deepEqual(tree[0].children[0].expand, { name: "ZPROG", type: "PROG", node: "LCL_A" });
});

test("a program's Parts are its events, subroutines and local methods from the node structure", () => {
  assert.deepEqual(navigator.programUnits({ nodes: [
    { OBJECT_TYPE: "PROG/PE", OBJECT_NAME: "START-OF-SELECTION" }, { OBJECT_TYPE: "PROG/PU", OBJECT_NAME: "RUN" },
    { OBJECT_TYPE: "PROG/PLM", OBJECT_NAME: "POPUP" }, { OBJECT_TYPE: "PROG/I", OBJECT_NAME: "ZINC" }] }).units,
    [{ unit_name: "START-OF-SELECTION", unit_type: "EVENT" }, { unit_name: "RUN", unit_type: "FORM" }, { unit_name: "POPUP", unit_type: "METHOD" }]);
});

test("a function module opens on Object Navigator too; an include, which SAP gives no tree, does not have it", () => {
  require("../tools-window");
  const model = require("../resources/object-tools");
  assert.ok(!model.objects.find(o => o[0] === "INCL")[2].includes("navigator"));
  assert.equal(model.objects.find(o => o[0] === "FUNC")[2][0], "navigator");
  assert.equal(model.normalize({ type: "FUNC", name: "Z_F" }).action, "navigator");
});

test("Diff lists a class's sections and methods from ADT's object structure, an interface's methods as ZIF~M", () => {
  const layout = require("../versions-front").componentLayout({ components: [
    { "adtcore:name": "RUN", "adtcore:type": "CLAS/OM", visibility: "public" },
    { "adtcore:name": "MV_X", "adtcore:type": "CLAS/OA", visibility: "private" },
    { "adtcore:name": "ZIF_A", "adtcore:type": "CLAS/OO", visibility: "public", components: [{ "adtcore:name": "GO", "adtcore:type": "INTF/IO" }] },
    { "adtcore:name": "ZCL_X", "adtcore:type": "CLAS/OCX", visibility: "protected" }] });
  assert.deepEqual(Object.keys(layout.sections).sort(), ["private", "public"]);
  assert.deepEqual(layout.methods, [{ name: "RUN", section: "public" }, { name: "ZIF_A~GO", section: "" }]);
});

test("a program's local class names its parts and opens a method without a line in its own class", () => {
  const tree = navigator.classTree({ components: [{ "adtcore:name": "RUN", "adtcore:type": "PROG/PLM", links: [] }] }, "ZPROG", "PROG", "", "LCL_A");
  assert.equal(tree[0].label, "Methods");
  assert.deepEqual(tree[0].children[0].open, { name: "ZPROG", type: "PROG", method: "RUN", localClass: "LCL_A" });
});

test("a local class opens at its DEFINITION, its attributes and types at their declaration there", () => {
  const tree = navigator.packageTree({ nodes: [{ OBJECT_TYPE: "PROG/PL", OBJECT_NAME: "LCL_A" }] }, { name: "ZPROG", type: "PROG" });
  assert.deepEqual(tree[0].children[0].open, { name: "ZPROG", type: "PROG", localClass: "LCL_A" });
  const parts = navigator.classTree({ components: [{ "adtcore:name": "MV_X", "adtcore:type": "PROG/PLA", links: [] },
    { "adtcore:name": "TY_KEY", "adtcore:type": "PROG/PLY", links: [] }] }, "ZPROG", "PROG", "", "LCL_A");
  assert.deepEqual(parts.map(g => g.label), ["Types", "Attributes"]);
  assert.deepEqual(parts[1].children[0].open, { name: "ZPROG", type: "PROG", member: "MV_X", localClass: "LCL_A" });
});

test("a local program's tree comes from the parse of the program and its includes, each entry at its file and line", () => {
  const { parseSource } = require("../value-origin-linter");
  const part = (name, text) => ({ name, statements: parseSource({ id: name, name, objectName: name, objectType: "PROG", text }).source.aceStatements });
  const tree = navigator.localTree([
    part("ZP", "REPORT zp.\nINCLUDE zp_c01.\nSTART-OF-SELECTION.\n  PERFORM f.\nFORM f.\nENDFORM."),
    part("ZP_C01", "CLASS lcl DEFINITION.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\nCLASS lcl IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.")]);
  assert.deepEqual(tree.map(g => g.label), ["Includes", "Events", "Local Classes", "Subroutines"]);
  assert.deepEqual(tree[0].children[0].open, { name: "ZP_C01", type: "PROG" });
  assert.deepEqual(tree[1].children[0].open, { name: "ZP", type: "PROG", line: 3 });
  assert.deepEqual(tree[2].children[0].children[0].children[0].open, { name: "ZP_C01", type: "PROG", line: 6 });
  assert.deepEqual(tree[3].children[0].open, { name: "ZP", type: "PROG", line: 5 });
});
