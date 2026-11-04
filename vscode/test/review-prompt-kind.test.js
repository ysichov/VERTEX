"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = require("./tools-page").toolsPage("versions.html");
const source = page.slice(page.indexOf("var REVIEW_PROMPT ="), page.indexOf("function copyText("));
const ops = [{ op: "=", text: "CLASS zcl_ship DEFINITION." }, { op: "-", text: "amount = old_price." },
  { op: "+", text: "amount = new_price * 2." }, { op: "=", text: "ENDCLASS." }];

function context() {
  const state = { objectName: () => "ER6K9A1QXV", review_part: { display_name: "ZCL_SHIP=>RUN" },
    review_ops: ops, review_blocks: [{ op_from: 2, op_to: 3, hunk_no: 1, start_line: 17 }] };
  vm.runInNewContext(source, state);
  return state;
}

test("technical documentation prompt keeps diff evidence and ends with TR Details", () => {
  const state = context();
  for (const full of [false, true]) {
    const prompt = state.reviewPrompt(full, null, "technical");
    assert.match(prompt, /^Review the provided ABAP change diff and generate concise technical documentation in English/);
    assert.match(prompt, /Changed Technical Objects/);
    assert.match(prompt, /Do not list a referenced dependency as a changed technical object/);
    assert.match(prompt, /\+ amount = new_price \* 2\./);
    assert.match(prompt, /- amount = old_price\./);
    assert.match(prompt, /TR Details: ER6K9A1QXV$/);
    assert.doesNotMatch(prompt, /Review this ABAP change: what it does and any real problem/);
  }
});

test("a created object goes to the prompt whole and named NEW, a changed one named MODIFIED", () => {
  const state = context();
  assert.match(state.reviewPrompt(false, null, "technical"), /MODIFIED object ZCL_SHIP=>RUN/);
  assert.match(state.reviewPrompt(false, null, "technical"), /keep created objects apart from modified ones/);
  state.review_ops = [{ op: "+", text: "FUNCTION z_new." }, { op: "+", text: "ENDFUNCTION." }];
  for (const full of [false, true]) {
    const prompt = state.reviewPrompt(full, null, "technical");
    assert.match(prompt, /NEW object ZCL_SHIP=>RUN, created in this transport - its whole source:\n\n\+ FUNCTION z_new\.\n\+ ENDFUNCTION\.\n\nTR Details: ER6K9A1QXV$/);
    assert.doesNotMatch(prompt, /MODIFIED object/);
  }
  // The review's own mark decides too: its new source, without lines a version before it held.
  const marked = context();
  marked.review_part = { display_name: "ZHRR_EMP_ALERTS", is_created: true };
  const prompt = marked.reviewPrompt(false, null, "technical");
  assert.match(prompt, /NEW object ZHRR_EMP_ALERTS, created in this transport - its whole source:\n\n\+ CLASS zcl_ship DEFINITION\.\n\+ amount = new_price \* 2\.\n\+ ENDCLASS\./);
  assert.doesNotMatch(prompt, /old_price/);
});

test("a class's parts are named under their class", () => {
  const state = context();
  state.review_part = { objtype: "METH", display_name: "RUN", class_name: "ZCL_NEW", is_created: true };
  assert.match(state.reviewPrompt(false, null, "technical"), /NEW object ZCL_NEW=>RUN, created in this transport/);
  assert.match(state.reviewPrompt(false, null, "technical"), /for a created one go through every method/);
  state.review_part = { objtype: "CPUB", display_name: "ZCL_NEW=======CU", class_name: "ZCL_NEW" };
  assert.match(state.reviewPrompt(false, null, "technical"), /ZCL_NEW, public section/);
  state.review_part = { objtype: "REPS", display_name: "ZPROG" };
  assert.match(state.reviewPrompt(false, null, "technical"), /MODIFIED object ZPROG -/);
});

test("code review remains the default prompt", () => {
  const state = context();
  const prompt = state.reviewPrompt(false);
  assert.match(prompt, /^Review this ABAP change:/);
  assert.doesNotMatch(prompt, /TR Details:/);
});

test("a user prompt overrides the built-in text for its own kind", () => {
  const state = context();
  state.promptOverrides.review = "My review instruction";
  assert.match(state.reviewPrompt(false), /^My review instruction/);
  assert.match(state.reviewPrompt(false, null, "technical"), /^Review the provided ABAP change diff/);
});

test("copy preparation reloads the user file before building the prompt", async () => {
  const state = context();
  let text = "First instruction";
  state.sdePromptFile = kind => {
    state.sdePromptFileReady(JSON.stringify({ kind, exists: true, text, path: "user prompt" }));
    return true;
  };
  await state.loadPrompt("review");
  assert.match(state.reviewPrompt(false), /^First instruction/);
  text = "Edited outside VERTEX";
  await state.loadPrompt("review");
  assert.match(state.reviewPrompt(false), /^Edited outside VERTEX/);
});

test("multi-object technical prompt uses one instruction and one transport footer", () => {
  const state = context();
  vm.runInNewContext(page.slice(page.indexOf("var personView = null;"), page.indexOf("function askPersonReview()")), state);
  state.personView = { title: "Review: ER6K9A1QXV", selector: "A:", filter: "all", parts: [
    { object: { display_name: "ZCL_SHIP=>RUN" }, body: { ops, blocks: [{ op_from: 2, op_to: 3, hunk_no: 1, start_line: 17 }] } },
    { object: { display_name: "ZCL_PRICE=>CALCULATE" }, body: { ops, blocks: [{ op_from: 2, op_to: 3, hunk_no: 1, start_line: 21 }] } }
  ] };
  state.promptKind = "technical";
  const prompt = state.personPrompt(false);
  assert.equal(prompt.match(/Review the provided ABAP change diff/g).length, 1);
  assert.match(prompt, /ZCL_SHIP=>RUN/);
  assert.match(prompt, /ZCL_PRICE=>CALCULATE/);
  assert.equal(prompt.match(/TR Details: ER6K9A1QXV/g).length, 1);
  // A developer's view follows the same choice.
  state.personView.selector = "D:AUTHOR";
  assert.match(state.personPrompt(false), /^Review the provided ABAP change diff/);
  state.promptKind = "review";
  assert.match(state.personPrompt(false), /^Review this ABAP change:/);
});
