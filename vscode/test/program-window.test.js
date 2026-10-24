"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { html } = require("../program-window");

test("the program window carries the shared selection screen, its toolbar and no colour of its own", () => {
  const page = html({ name: "ZSEL", recompile: true, builtAt: "" });
  assert.match(page, /function drawScreen\(/, "the screen code shared with VERTEX Smart Debugger is put in");
  assert.doesNotMatch(page, /SELECTION-SCREEN-UI\*\//);
  for (const id of ["execute", "back", "flow", "recompile", "list", "statusbar"]) assert.match(page, new RegExp('id="' + id + '"'));
  const css = page.slice(page.indexOf("<style>"), page.indexOf("</style>"));
  assert.doesNotMatch(css.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ""), /#[0-9a-f]{3,6}\b|rgb\(/i, "every colour is a theme variable");
  for (const script of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script[1]);
});

test("an unopened build waits for Execute or Recompile", () => {
  const page = html({ name: "ZSEL", recompile: true, deferred: true });
  assert.match(page, /"deferred":true/);
  assert.match(page, /else if\(!INITIAL\.pending&&!INITIAL\.deferred\)execute\(\)/);
  assert.match(page, /\$\("recompile"\)\.onclick=function\(\).*ask\("recompile"\)/);
});

test("a class reference opens a variables dialog instead of a text input", () => {
  const page = html({ name: "ZCL_MOD_FUEL", recompile: true });
  assert.match(page, /function referenceEditor\(p\)/);
  assert.match(page, /if\(shape\.kind==="reference"\)return referenceEditor\(p\)/);
  assert.match(page, /button\.onclick=function\(\)\{dialog\.showModal\(\)/);
});
