"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { request } = require("../selector-join");

// A dictionary of three tables: SFLIGHT points at SCARR through CARRID; E070 is offered by nothing.
const FIELDS = {
  SFLIGHT: [["MANDT", "X", "CLNT"], ["CARRID", "X", "CHAR"], ["CONNID", "X", "NUMC"], ["PRICE", "", "CURR"]],
  SCARR: [["MANDT", "X", "CLNT"], ["CARRID", "X", "CHAR"], ["CARRNAME", "", "CHAR"]],
  E070: [["TRKORR", "X", "CHAR"], ["STRKORR", "", "CHAR"], ["TRSTATUS", "", "CHAR", "TRSTATUS"], ["AS4DATE", "", "DATS"]]
};
function session(rows = []) {
  const asked = [];
  const api = {
    language: () => "EN",
    query: async (sql, max) => {
      asked.push({ sql, max });
      const table = (/'([A-Z0-9_]+)'/.exec(sql) || [])[1];
      if (/FROM t002/.test(sql)) { return { values: [{ SPRAS: "E" }] }; }
      if (/SELECT tabclass FROM dd02l/.test(sql)) { return { values: FIELDS[table] ? [{ TABCLASS: "TRANSP" }] : [] }; }
      if (/FROM dd02l/.test(sql)) { return { values: Object.keys(FIELDS).map(name => ({ TABNAME: name, TABCLASS: "TRANSP" })) }; }
      if (/FROM dd02t/.test(sql)) { return { values: [{ TABNAME: "SCARR", DDTEXT: "Airline" }] }; }
      if (/FROM dd08l WHERE tabname = 'SFLIGHT'/.test(sql)) { return { values: [{ TABNAME: "SFLIGHT", FIELDNAME: "CARRID", CHECKTABLE: "SCARR", FRKART: "" }] }; }
      // DD05S as it is: the foreign table's field at each position of the check table's key.
      if (/FROM dd05s WHERE tabname = 'SFLIGHT' AND fieldname = 'CARRID'/.test(sql)) {
        return { values: [{ TABNAME: "SFLIGHT", FIELDNAME: "CARRID", PRIMPOS: "0001", FORTABLE: "SFLIGHT", FORKEY: "MANDT" },
          { TABNAME: "SFLIGHT", FIELDNAME: "CARRID", PRIMPOS: "0002", FORTABLE: "SFLIGHT", FORKEY: "CARRID" }] };
      }
      if (/FROM dd03l WHERE keyflag = 'X'/.test(sql)) {
        return { values: Object.keys(FIELDS).filter(name => sql.includes("'" + name + "'")).flatMap(name =>
          FIELDS[name].filter(f => f[1] === "X").map(([field], i) => ({ TABNAME: name, FIELDNAME: field, POSITION: String(i + 1) }))) };
      }
      if (/FROM dd07t WHERE domname = 'TRSTATUS'/.test(sql)) { return { values: [{ DOMVALUE_L: "R", DDTEXT: "Released" }] }; }
      if (/FROM dd08l|FROM dd05s|FROM dd04t|FROM dd03t/.test(sql)) { return { values: [] }; }
      if (/FROM dd03l/.test(sql)) {
        return { values: FIELDS[table].map(([name, key, type, domain], i) => ({ FIELDNAME: name, POSITION: String(i + 1), KEYFLAG: key, DATATYPE: type, LENG: "3", DECIMALS: "0", ROLLNAME: "", DOMNAME: domain || "" })) };
      }
      return { values: rows };
    }
  };
  return { api, asked };
}

test("the base alone: the dictionary's neighbours offered, every field selected, no statement run without rows", async () => {
  const { api, asked } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/join/SFLIGHT");
  assert.deepStrictEqual(answer.candidates, [{ tabname: "SCARR", ddtext: "Airline", direction: "O", alias: "", selected: false }]);
  assert.deepStrictEqual(answer.tables, [{ alias: "T0", tabname: "SFLIGHT", ddtext: "", jtype: "LEFT OUTER", cond: "" }]);
  assert.strictEqual(answer.sql, "SELECT mandt, carrid, connid, price FROM sflight");
  assert.strictEqual(answer.rows, null);
  assert.ok(!asked.some(({ sql }) => /FROM sflight/i.test(sql) && !/dd0/i.test(sql)));
});

test("an ON given is used as it is, and no field pairs are read for it", async () => {
  const { api, asked } = session();
  await request(api, "/sap/bc/adt/vertex/join/SFLIGHT?t1=SCARR&onT1=" + encodeURIComponent("t1~carrid = t0~carrid"));
  assert.ok(!asked.some(({ sql }) => /dd05s/.test(sql)));
});

test("a taken table joins on its foreign key, keys selected once, filters on the join's column names", async () => {
  const { api } = session([{ T0_CARRID: "AA", T0_PRICE: "443.29", T1_CARRNAME: "American" }]);
  const answer = await request(api, "/sap/bc/adt/vertex/join/SFLIGHT?rows=5&t1=SCARR&f1=T1_CARRNAME&o1=CP&l1=AM*");
  assert.deepStrictEqual(answer.tables[1], { alias: "T1", tabname: "SCARR", ddtext: "Airline", jtype: "LEFT OUTER", cond: "t1~carrid = t0~carrid" });
  assert.strictEqual(answer.sql, "SELECT t0~mandt AS t0_mandt, t0~carrid AS t0_carrid, t0~connid AS t0_connid, t0~price AS t0_price"
    + " FROM sflight AS t0 LEFT OUTER JOIN scarr AS t1 ON t1~carrid = t0~carrid WHERE ( t1~carrname LIKE 'AM%' )");
  assert.deepStrictEqual(answer.rows, [{ t0_carrid: "AA", t0_price: 443.29, t1_carrname: "American" }]);
  assert.strictEqual(answer.candidates[0].selected, true);
});

test("a table nobody offers is taken by hand, with the caller's type and ON - a self-join included", async () => {
  const { api } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/join/E070?t1=E070&jT1=INNER&onT1=" + encodeURIComponent("t1~trkorr = t0~strkorr")
    + "&pick=X&sf1=t1~trkorr");
  assert.deepStrictEqual(answer.tables[1], { alias: "T1", tabname: "E070", ddtext: "", jtype: "INNER", cond: "t1~trkorr = t0~strkorr" });
  assert.strictEqual(answer.sql, "SELECT t1~trkorr AS t1_trkorr FROM e070 AS t0 INNER JOIN e070 AS t1 ON t1~trkorr = t0~strkorr");
});

test("what the resource refused is refused here; a pivot is not this module's", async () => {
  const { api } = session();
  await assert.rejects(request(api, "/sap/bc/adt/vertex/join/SFLIGHT?f1=T1_CARRNAME&l1=A"), /not a field of this join/);
  await assert.rejects(request(api, "/sap/bc/adt/vertex/join/SFLIGHT?t1=SCARR&jT1=RIGHT"), /INNER or LEFT OUTER/);
  await assert.rejects(request(api, "/sap/bc/adt/vertex/join/NOSUCH"), /was not found/);

});

test("cand=0 asks the dictionary for no tables around the base", async () => {
  const { api, asked } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/join/SFLIGHT?cand=0&t1=SCARR&onT1=" + encodeURIComponent("t1~carrid = t0~carrid"));
  assert.ok(!asked.some(({ sql }) => /dd08l/.test(sql)));
  assert.deepStrictEqual(answer.candidates.map(c => c.tabname), ["SCARR"]);
});

test("a pivot groups by its dimensions in SAP and spreads the column values here", async () => {
  const { api, asked } = session([
    { T0_CARRID: "AA", T0_CONNID: "0017", SUM_T0_PRICE: "10.5" }, { T0_CARRID: "AA", T0_CONNID: "0064", SUM_T0_PRICE: "2" },
    { T0_CARRID: "LH", T0_CONNID: "0017", SUM_T0_PRICE: "7" }]);
  const answer = await request(api, "/sap/bc/adt/vertex/join/SFLIGHT?rows=100&r1=t0~carrid&c1=t0~connid&v1=t0~price&a1=SUM");
  assert.strictEqual(answer.sql, "SELECT carrid AS t0_carrid, connid AS t0_connid, SUM( price ) AS sum_t0_price FROM sflight GROUP BY carrid, connid");
  assert.strictEqual(answer.pivot, true);
  assert.deepStrictEqual(answer.rows, [
    { t0_carrid: "AA", sum_t0_price_0017: 10.5, sum_t0_price_0064: 2 },
    { t0_carrid: "LH", sum_t0_price_0017: 7, sum_t0_price_0064: null }]);
  assert.strictEqual(asked.at(-1).max, 100);
});

test("COUNT( * ) is a measure, and with none the rows are counted; an aggregate a field cannot carry falls back", async () => {
  const { api } = session([]);
  assert.strictEqual((await request(api, "/sap/bc/adt/vertex/join/SFLIGHT?r1=t0~carrid&v1=*&a1=COUNT&v2=t0~carrid&a2=SUM")).sql,
    "SELECT carrid AS t0_carrid, COUNT( * ) AS count_all, COUNT( carrid ) AS count_t0_carrid FROM sflight GROUP BY carrid");
  assert.strictEqual((await request(api, "/sap/bc/adt/vertex/join/SFLIGHT?r1=t0~carrid")).sql,
    "SELECT carrid AS t0_carrid, COUNT( * ) AS cnt_rows FROM sflight GROUP BY carrid");
});

test("a pivot names its values by the domain and its columns by the fields; MAX of a date stays a date", async () => {
  const { api } = session([{ T0_TRSTATUS: "R", COUNT_ALL: "3200", MAX_T0_AS4DATE: "20260919" }, { T0_TRSTATUS: "D", COUNT_ALL: "658", MAX_T0_AS4DATE: "20261009" }]);
  const answer = await request(api, "/sap/bc/adt/vertex/join/E070?rows=100&r1=t0~trstatus&v1=*&a1=COUNT&v2=t0~as4date&a2=MAX");
  assert.deepStrictEqual(answer.rows, [
    { t0_trstatus: "D", count_all: 658, max_t0_as4date: "2026-10-09" },
    { t0_trstatus: "Released", count_all: 3200, max_t0_as4date: "2026-09-19" }]);
  assert.deepStrictEqual(answer.headers, { t0_trstatus: "TRSTATUS", count_all: "Count", max_t0_as4date: "MAX AS4DATE" });
});
