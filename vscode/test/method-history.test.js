"use strict";
const test = require("node:test");
const assert = require("node:assert");
const versions = require("../versions-front");

const PART = "ZCL_X".padEnd(30, " ") + "RUN";
const where = { url: "/sap/bc/adt/oo/classes/zcl_x", include: "main", cut: text => text.split("\n").slice(1, 2) };

test("a method's history is its own VRSD versions, their text from VERTEX's ABAP, the active state ADT's, cut", async () => {
  const asked = [];
  const api = {
    ddicVersions: async () => true,
    query: async sql => { asked.push(sql); return { values: [
      { VERSNO: "00000", KORRNUM: "K3", AUTHOR: "DEV", DATUM: "20261030", ZEIT: "101010" },
      { VERSNO: "00082", KORRNUM: "TPX", AUTHOR: "DEV", DATUM: "20261028", ZEIT: "154831" },
      { VERSNO: "00080", KORRNUM: "TXC", AUTHOR: "OLD", DATUM: "20261001", ZEIT: "090000" }] }; },
    ddicVersion: async (type, name, versno) => [type + " " + name.trim() + " " + versno],
    currentSource: async () => "header\nactive line\nfooter",
    revisions: async () => { throw new Error("the class include's feed was read"); }
  };
  const history = await versions.historyOf(api, "METH", PART, where);
  assert.ok(history.method);
  assert.deepStrictEqual(history.feed.map(e => [e.id, e.transport]), [["00000", "K3"], ["00082", "TPX"], ["00080", "TXC"]]);
  assert.ok(asked[0].includes("objtype = 'METH'") && asked[0].includes("objname = '" + PART + "'"), asked[0]);
  assert.deepStrictEqual(await history.textOf(history.feed[1]), ["METH ZCL_X                         RUN 00082"]);
  assert.deepStrictEqual(await history.textOf(history.feed[0]), ["active line"]);
});

test("an older VERTEX ABAP that reads no method versions: the class include's feed, and the switch said", async () => {
  const api = {
    ddicVersions: async () => true,
    query: async () => ({ values: [{ VERSNO: "00082", KORRNUM: "TPX", AUTHOR: "DEV", DATUM: "20261028", ZEIT: "154831" }] }),
    ddicVersion: async () => { throw new Error("Request could not be understood by the server due to malformed syntax: METH is not a dictionary part this resource reads;"); },
    revisions: async () => [{ id: "00734", transport: "TPX" }]
  };
  const history = await versions.historyOf(api, "METH", PART, where);
  assert.ok(!history.method && !history.textOf);
  assert.deepStrictEqual(history.feed.map(e => e.id), ["00734"]);
  assert.strictEqual(history.notice, versions.OLD_BACKEND);
  assert.match(history.notice, /older than 0\.9\.46.*cut from its class's versions.*abapGit/);
});

test("without VERTEX's ABAP a method is cut from the class include's feed, as before", async () => {
  const api = { ddicVersions: async () => false, revisions: async () => [{ id: "00734", transport: "TPX" }] };
  const history = await versions.historyOf(api, "METH", PART, where);
  assert.ok(!history.method && !history.textOf);
  assert.deepStrictEqual(history.feed.map(e => e.id), ["00734"]);
});

test("spacing moved inside a line is no change; blanks inside a literal are", () => {
  const { spacingKey } = versions;
  assert.strictEqual(spacingKey('    DATA(lv_grade) = iv_grade.          "ER6K9A0TXC'), spacingKey('DATA(lv_grade) = iv_grade.  "ER6K9A0TXC'));
  assert.notStrictEqual(spacingKey("x = 'a  b'."), spacingKey("x = 'a b'."));
  assert.notStrictEqual(spacingKey("x = |a  { y }|."), spacingKey("x = |a { y }|."));
  assert.notStrictEqual(spacingKey("data x."), spacingKey("DATA x."));
});
