"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// The change inside a line, as versions.html computes it: its functions taken from the page as they are.
const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/versions.html"), "utf8");
const { wordDiff, pairAll } = new Function(page.slice(page.indexOf("function tokens("), page.indexOf("function markWords("))
  + "; return { wordDiff, pairAll };")();

test("a changed line is paired with the alike line of its run, order kept, and its removed words found", () => {
  const ops = [
    { op: "-", text: "DATA: gt_e071  TYPE STANDARD TABLE OF e071 WITH EMPTY KEY," },
    { op: "-", text: "      gt_e071k TYPE STANDARD TABLE OF e071k WITH EMPTY KEY." },
    { op: "+", text: "\" Default key, not EMPTY KEY: TR_REQUEST_CHOICE types IT_E071/IT_E071K with" },
    { op: "+", text: "\" the default key and dumps (CALL_FUNCTION_CONFLICT_TAB_TYP) on any other." },
    { op: "+", text: "DATA: gt_e071  TYPE STANDARD TABLE OF e071," },
    { op: "+", text: "      gt_e071k TYPE STANDARD TABLE OF e071k." }];
  assert.deepStrictEqual(pairAll(ops), { 4: 0, 5: 1 });
  assert.deepStrictEqual(wordDiff(ops[1].text, ops[5].text).map(w => [w.op, w.text]),
    [["=", "      gt_e071k TYPE STANDARD TABLE OF e071k"], ["-", " WITH EMPTY KEY"], ["=", "."]]);
});

test("lines with little in common stay a removed and an added line", () => {
  assert.deepStrictEqual(pairAll([{ op: "-", text: "ls_e071-pgmid = 'LIMU'." }, { op: "+", text: "\" LANG, not LIMU: CTS refuses it" }]), {});
});
