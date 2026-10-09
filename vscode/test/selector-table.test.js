"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { request, whereClause } = require("../selector-table");

// An ADT session that answers the dictionary reads for SFLIGHT and records every SELECT it was given.
function session(rows) {
  const asked = [];
  const api = {
    language: () => "EN",
    query: async (sql, max) => {
      asked.push({ sql, max });
      if (/FROM t002/.test(sql)) { return { values: [{ SPRAS: "E" }] }; }
      if (/FROM dd02l/.test(sql)) { return { values: /'SFLIGHT'/.test(sql) ? [{ TABCLASS: "TRANSP" }] : [] }; }
      if (/FROM dd03l/.test(sql)) {
        return { values: [
          { FIELDNAME: "MANDT", POSITION: "0001", KEYFLAG: "X", DATATYPE: "CLNT", LENG: "000003", DECIMALS: "000000", ETEXT: "Client", FTEXT: "" },
          { FIELDNAME: ".INCLUDE", POSITION: "0003", KEYFLAG: "", DATATYPE: "", LENG: "000000", DECIMALS: "000000", ETEXT: "", FTEXT: "" },
          { FIELDNAME: "CARRID", ROLLNAME: "S_CARR_ID", POSITION: "0002", KEYFLAG: "X", DATATYPE: "CHAR", LENG: "000003", DECIMALS: "000000", ETEXT: "Airline Code", FTEXT: "" },
          { FIELDNAME: "FLDATE", ROLLNAME: "", POSITION: "0004", KEYFLAG: "X", DATATYPE: "DATS", LENG: "000008", DECIMALS: "000000", ETEXT: "Flight date", FTEXT: "" },
          { FIELDNAME: "PRICE", ROLLNAME: "S_PRICE", POSITION: "0005", KEYFLAG: "", DATATYPE: "CURR", LENG: "000015", DECIMALS: "000002", ETEXT: "Airfare", FTEXT: "" }] };
      }
      if (/FROM dd04t/.test(sql)) { return { values: [{ ROLLNAME: "S_CARR_ID", DDTEXT: "Airline Code" }, { ROLLNAME: "S_PRICE", DDTEXT: "Airfare" }] }; }
      if (/FROM dd03t/.test(sql)) { return { values: [{ FIELDNAME: "FLDATE", DDTEXT: "Flight date" }] }; }
      return { values: rows };
    }
  };
  return { api, asked };
}

test("the table answer has the ABAP resource's shape: no client field, typed values, dates formatted", async () => {
  const { api, asked } = session([{ MANDT: "100", CARRID: "AA", FLDATE: "20241024", PRICE: "443.29" }, { MANDT: "100", CARRID: "AA", FLDATE: "00000000", PRICE: "" }]);
  const answer = await request(api, "/sap/bc/adt/vertex/table/sflight?rows=5");
  assert.deepStrictEqual(answer.fields.map(f => f.name), ["carrid", "fldate", "price"]);
  assert.deepStrictEqual(answer.fields[2], { name: "price", position: 5, key: false, datatype: "CURR", length: 15, decimals: 2, text: "Airfare" });
  assert.deepStrictEqual(answer.rows[0], { mandt: "100", carrid: "AA", fldate: "2024-10-24", price: 443.29 });
  assert.deepStrictEqual(answer.rows[1].fldate, "");
  assert.strictEqual(answer.count, 2);
  assert.strictEqual(answer.table, "sflight");
  assert.deepStrictEqual(asked.at(-1), { sql: "SELECT * FROM SFLIGHT ORDER BY PRIMARY KEY", max: 5 });
  // ADT's data preview cuts the statement at the first full stop after FROM, even inside a literal.
  assert.ok(asked.every(({ sql }) => !sql.includes(".")), asked.map(({ sql }) => sql).join("\n"));
});

test("filters keep select-option semantics and quote what the reader typed", async () => {
  const { api, asked } = session([]);
  await request(api, "/sap/bc/adt/vertex/table/SFLIGHT?rows=100&f1=carrid&s1=I&o1=EQ&l1=AA&f2=carrid&s2=I&o2=CP&l2=L*&f3=carrid&s3=E&o3=EQ&l3=O'K"
    + "&f4=fldate&s4=I&o4=BT&l4=20240101&h4=20241231");
  assert.strictEqual(asked.at(-1).sql, "SELECT * FROM SFLIGHT WHERE ( CARRID = 'AA' OR CARRID LIKE 'L%' ) AND NOT ( CARRID = 'O''K' )"
    + " AND ( FLDATE BETWEEN '20240101' AND '20241231' ) ORDER BY PRIMARY KEY");
});

test("what the ABAP resource refused is refused here, a missing table included", async () => {
  const { api } = session([]);
  await assert.rejects(request(api, "/sap/bc/adt/vertex/table/NOSUCH"), /was not found/);
  await assert.rejects(request(api, "/sap/bc/adt/vertex/table/SFLIGHT?f1=seatsmax&l1=1"), /has no field SEATSMAX/);
  await assert.rejects(request(api, "/sap/bc/adt/vertex/table/SFLIGHT?f1=carrid&o1=BT&l1=A"), /needs an upper bound/);
  await assert.rejects(request(api, "/sap/bc/adt/vertex/table/SFLIGHT'%20OR"), /not a table name/);
});

test("no filter, no WHERE", () => {
  assert.strictEqual(whereClause([]), "");
});

test("a list of names goes in as many statements as keep each under the data preview's line", async () => {
  const { inLists } = require("../selector-table");
  const asked = [];
  const api = { query: async sql => { asked.push(sql); return { values: [{ SQL: sql }] }; } };
  const names = Array.from({ length: 60 }, (_, i) => "ZTABLE_NUMBER_" + i);
  const values = await inLists(api, "SELECT tabname FROM dd02l WHERE tabname", names, 10);
  assert.ok(asked.length > 1);
  assert.ok(asked.every(sql => sql.length < 240), asked.map(sql => sql.length).join(", "));
  assert.deepStrictEqual(asked.flatMap(sql => sql.match(/'[^']*'/g)).map(name => name.slice(1, -1)), names);
  assert.strictEqual(values.length, asked.length);
});


test("pick=X reads and answers only the columns asked for, in their order, the rows in key order", async () => {
  const { api, asked } = session([{ PRICE: "1.5", CARRID: "AA" }]);
  const answer = await request(api, "/sap/bc/adt/vertex/table/SFLIGHT?rows=5&pick=X&sf1=price&sf2=carrid");
  assert.deepStrictEqual(answer.fields.map(f => f.name), ["price", "carrid"]);
  assert.strictEqual(asked.at(-1).sql, "SELECT price, carrid FROM SFLIGHT ORDER BY mandt, carrid, fldate");
  await assert.rejects(request(api, "/sap/bc/adt/vertex/table/SFLIGHT?pick=X&sf1=nosuch"), /has no field NOSUCH/);
});
