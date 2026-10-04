"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { literalAt } = require("../value-origin");

const lineOf = "WRITE: / 'Returned result:', ls_result-amount, ls_result-currency.";
const at = (text, word) => text.indexOf(word) + 1;

test("a word in a text literal has no value history", () => {
  assert.equal(literalAt(lineOf, at(lineOf, "Returned")), "literal");
  assert.equal(literalAt(lineOf, at(lineOf, "result:")), "literal");
});

test("a variable on the same line is not in a literal", () => {
  assert.equal(literalAt(lineOf, at(lineOf, "ls_result-amount")), null);
  assert.equal(literalAt(lineOf, at(lineOf, "ls_result-currency")), null);
  assert.equal(literalAt(lineOf, at(lineOf, "WRITE")), null);
});

test("quotes inside quotes, back-quoted text and string templates", () => {
  const doubled = "x = 'it''s lv_name here'. y = lv_name.";
  assert.equal(literalAt(doubled, at(doubled, "lv_name here")), "literal");
  assert.equal(literalAt(doubled, doubled.lastIndexOf("lv_name") + 1), null);
  const back = "x = `text lv_a` && lv_b.";
  assert.equal(literalAt(back, at(back, "lv_a")), "literal");
  assert.equal(literalAt(back, at(back, "lv_b")), null);
  const template = "x = |amount { ls_x-amount } of { lv_unit }|.";
  assert.equal(literalAt(template, at(template, "amount {")), "literal");
  assert.equal(literalAt(template, at(template, "ls_x-amount")), null, "an expression in a template is code");
  assert.equal(literalAt(template, at(template, "lv_unit")), null);
  assert.equal(literalAt(template, at(template, "of {")), "literal");
});

test("a comment has no value history either", () => {
  assert.equal(literalAt("* lv_value is not set here", 4), "comment");
  const trailing = "lv_a = lv_b. \" lv_b comes from the caller";
  assert.equal(literalAt(trailing, at(trailing, "lv_a")), null);
  assert.equal(literalAt(trailing, trailing.lastIndexOf("lv_b") + 1), "comment");
});

test("only the line under the cursor decides", () => {
  const two = "x = 'open\nlv_a = lv_b.";
  assert.equal(literalAt(two, two.indexOf("lv_a") + 1), null);
});
