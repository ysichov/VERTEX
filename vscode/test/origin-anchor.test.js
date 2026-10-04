"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { sourcesFromAce, locateTarget } = require("../value-origin-ace");
const { columnOf } = require("../value-origin-points");

const lines = ["START-OF-SELECTION.",
  "  DATA(ls_result) = NEW zcl_calc_facade( )->run( ).",
  "  WRITE: / 'Returned result:', ls_result-amount."];
const text = lines.join("\n");
const tok = (str, row, col) => ({ str, row, col });
const payload = { schema_version: 1, includes: [{ include: "ZREPORT", class: "", source: lines, statements: [
  { idx: 1, line: 1, tokens: [tok("START-OF-SELECTION", 1, 0)] },
  { idx: 2, line: 2, tokens: [tok("DATA(LS_RESULT)", 2, 2), tok("=", 2, 18), tok("NEW", 2, 20)] },
  { idx: 3, line: 3, tokens: [tok("WRITE", 3, 2), tok("LS_RESULT-AMOUNT", 3, lines[2].indexOf("ls_result-amount"))] }
] }] };
const sources = () => sourcesFromAce(payload, { object_name: "ZREPORT", object_type: "PROG" }, "doc");
const statementOffset = line => sources()[0].aceStatements.find(statement => statement.line === line).offset;

test("column 0 of an indented line anchors the analysis one statement too early", () => {
  const wrong = locateTarget(sources(), text, "ZREPORT", 3, "LS_RESULT-AMOUNT", 0);
  assert.equal(wrong.offset, statementOffset(2), "the previous statement, which is what Points used to get");
});

test("the variable's own column anchors it on the statement the line holds", () => {
  const column = columnOf(lines[2], "ls_result-amount");
  assert.equal(column, lines[2].indexOf("ls_result-amount"));
  const right = locateTarget(sources(), text, "ZREPORT", 3, "LS_RESULT-AMOUNT", column);
  assert.equal(right.offset, statementOffset(3));
});

test("a name that is not on the line anchors at its first character", () => {
  assert.equal(columnOf("    CALL METHOD lo->run( ).", "LS_X"), 4);
  assert.equal(columnOf("", "LS_X"), 0);
  const column = columnOf(lines[2], "ls_other");
  assert.equal(locateTarget(sources(), text, "ZREPORT", 3, "LS_OTHER", column).offset, statementOffset(3));
});

test("the analysis starts from the last use of the value, wherever the run stands", () => {
  const { lastUse } = require("../value-origin-points");
  const source = ["REPORT zrep.", "DATA(lv_scenario) = 'X'.", "DATA(ls_result) = NEW zcl( )->run( iv = lv_scenario ).",
    "WRITE: / 'Returned result:', ls_result-amount, ls_result-currency.", "FREE ls_other."].join("\n");
  assert.equal(lastUse(source, "ls_result-amount"), 4, "the structure's name, on its last line");
  assert.equal(lastUse(source, "LV_SCENARIO"), 3);
  assert.equal(lastUse(source, "returned"), 0, "a word in a text literal is no use");
  assert.equal(lastUse(source, "ls_res"), 0, "a part of another name is not the name");
  assert.equal(lastUse(source, "nothing_here"), 0);
  assert.equal(lastUse("* ls_result is described here\nWRITE ls_result. \" ls_result again", "ls_result"), 2, "comments are not uses");
});

test("the column falls back to the structure's own name, then to the first character", () => {
  assert.equal(columnOf("  WRITE ls_result-currency.", "ls_result-amount"), "  WRITE ".length);
  assert.equal(columnOf("    CALL METHOD lo->run( ).", "ls_x"), 4);
});
