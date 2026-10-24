"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { typeComponents } = require("../value-origin-model");
const { parseSource } = require("../value-origin-linter");

// An interface's structure type, chained as SAP writes it; abaplint splits the chain into one statement per part.
const text = ["INTERFACE zif_calc_types PUBLIC.", "  TYPES: BEGIN OF ty_context,", "           amount TYPE p LENGTH 15 DECIMALS 2,",
  "           BEGIN OF inner, a TYPE i, END OF inner,", "         END OF ty_context.", "  TYPES ty_alias TYPE ty_context.", "ENDINTERFACE."].join("\n");
const parsed = () => parseSource({ id: "t", name: "ZIF_CALC_TYPES", objectName: "ZIF_CALC_TYPES", objectType: "INTF", include: "main", text }).source;
const fields = [{ name: "amount", type: "p LENGTH 15 DECIMALS 2" }, { name: "inner", type: "structure", components: [{ name: "a", type: "i" }] }];

test("a chained structure type opens to its fields from abaplint's statements", () => {
  assert.deepEqual(typeComponents([parsed()], "zif_calc_types=>ty_context"), fields);
});

test("an alias of a structure type opens to the fields of the type it names", () => {
  assert.deepEqual(typeComponents([parsed()], "zif_calc_types=>ty_alias"), fields);
});

test("the model's own statements give the same fields", () => {
  const own = parsed(); delete own.aceStatements;
  assert.deepEqual(typeComponents([own], "zif_calc_types=>ty_context"), fields);
});
