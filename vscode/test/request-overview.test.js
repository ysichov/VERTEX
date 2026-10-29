"use strict";
const test = require("node:test");
const assert = require("node:assert");
const front = require("../versions-front");
const E071 = [
  { TRKORR: "K1", PGMID: "CORR", OBJECT: "RELE", OBJ_NAME: "T9 20261028 152511 DEVB" },
  { TRKORR: "T1", PGMID: "LIMU", OBJECT: "METH", OBJ_NAME: "ZCL_A                         GET_TFC" },
  { TRKORR: "T9", PGMID: "LIMU", OBJECT: "METH", OBJ_NAME: "ZCL_A                         GET_TFC" },
  { TRKORR: "T9", PGMID: "LIMU", OBJECT: "REPS", OBJ_NAME: "ZXPADU02" }];
const E070 = [{ TRKORR: "K1", TRFUNCTION: "K", AS4USER: "LEAD", AS4DATE: "20261027" },
  { TRKORR: "T1", TRFUNCTION: "S", AS4USER: "DEVA", AS4DATE: "20261027" },
  { TRKORR: "T9", TRFUNCTION: "S", AS4USER: "DEVB", AS4DATE: "20261028" }];
const api = { objectTypes: async () => [{ name: "CLAS/OM", description: "Method" }, { name: "PROG/I", description: "Include" }], query: async (sql) => {
  const ins = (sql.match(/IN \(([^)]*)\)/) || [, ""])[1].split(",").map(x => x.trim().replace(/'/g, ""));
  const eq = (sql.match(/= '([^']*)'/) || [, ""])[1];
  if (/FROM e071/.test(sql)) { return { values: E071.filter(r => ins.includes(r.TRKORR) || r.TRKORR === eq) }; }
  if (/strkorr/.test(sql)) { return { values: [{ TRKORR: "T1" }] }; }
  if (/FROM e070/.test(sql)) { return { values: E070.filter(r => ins.includes(r.TRKORR) || r.TRKORR === eq) }; }
  if (/ko100/.test(sql)) { return { values: [{ PGMID: "LIMU", OBJECT: "METH", TEXT: "Method (ABAP Objects)" }, { PGMID: "LIMU", OBJECT: "REPS", TEXT: "Report Source Code" }] }; }
  if (/usr21/.test(sql)) { return { values: [{ BNAME: "DEVA", NAME_TEXT: "Dev A" }] }; }
  return { values: [] };
} };
test("a request's overview - shown in Review before a review is built - names each object's class, kind, authors, tasks and dates, released tasks included", async () => {
  const overview = await front.requestOverview(api, "K1", ["T1"]);
  assert.deepStrictEqual(overview.map(o => [o.type, o.name, o.class, o.type_text, o.authors.join(","), o.trs + "/" + o.tasks, o.start, o.finish, o.days]),
    [["METH", "GET_TFC", "ZCL_A", "Method", "Dev A,DEVB", "1/2", "20261027", "20261028", 2],
     ["REPS", "ZXPADU02", "", "Include", "DEVB", "1/1", "20261028", "20261028", 1]]);
});
