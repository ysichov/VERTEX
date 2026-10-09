"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { prepare, DEFAULT_ROWS } = require("../select-query");

const at = (text, line) => text.split("\n").slice(0, line - 1).join("\n").length + 3;
const run = (statement) => { const text = "REPORT z.\n" + statement + "\n"; return prepare(text, at(text, 2)); };

test("a known condition stays, a program value is left out, INTO and FOR ALL ENTRIES go, UP TO is the row count", () => {
  const result = run("SELECT a~matnr, b~maktx FROM mara AS a INNER JOIN makt AS b ON b~matnr = a~matnr FOR ALL ENTRIES IN @lt_k "
    + "WHERE a~matnr = @lv_m AND b~spras = 'E' INTO TABLE @DATA(lt_r) UP TO 10 ROWS.");
  assert.strictEqual(result.sql, "SELECT a~matnr, b~maktx FROM mara AS a INNER JOIN makt AS b ON b~matnr = a~matnr WHERE b~spras = 'E'");
  assert.strictEqual(result.rows, 10);
  assert.deepStrictEqual(result.dropped, ["a~matnr = @lv_m"]);
});

test("an OR with an unknown branch is left out whole and reported", () => {
  const result = run("SELECT * FROM mara WHERE mtart = 'FERT' AND ( matkl = 'A' OR matkl = @lv_k ) INTO TABLE @lt.");
  assert.strictEqual(result.sql, "SELECT * FROM mara WHERE mtart = 'FERT'");
  assert.deepStrictEqual(result.dropped, ["matkl = 'A' OR matkl = @lv_k"]);
  assert.strictEqual(result.rows, DEFAULT_ROWS);
});

test("old syntax: the list gets commas, SINGLE reads one row, a select-option is left out", () => {
  const result = run("SELECT SINGLE matnr mtart FROM mara INTO ls WHERE matnr IN s_matnr AND mtart = 'FERT'.");
  assert.strictEqual(result.sql, "SELECT matnr, mtart FROM mara WHERE mtart = 'FERT'");
  assert.strictEqual(result.rows, 1);
});

test("an unknown value under NOT is refused to run as written, and opens in SelecTor as an empty excluding line", () => {
  const joined = "SELECT * FROM mara AS a INNER JOIN makt AS b ON b~matnr = a~matnr WHERE NOT a~matnr = @lv_m INTO TABLE @lt.";
  assert.deepStrictEqual(run(joined).selector.filters, [{ field: "matnr", sign: "E", option: "EQ", low: "", high: "" }]);
  const result = run("SELECT * FROM mara INTO TABLE lt WHERE NOT matnr = lv_m.");
  assert.strictEqual(result.sql, undefined);
  assert.deepStrictEqual(result.selector.filters, [{ field: "matnr", sign: "E", option: "EQ", low: "", high: "" }]);
});

test("one table opens in SelecTor: known conditions filled, program values as empty lines", () => {
  const result = run("SELECT step_no, modifier_class AS name FROM zlog_pipeline WHERE scenario_id = @lv_s AND step_no BETWEEN '010' AND '030'"
    + " AND name LIKE 'ZCL_%' AND kind IN ('A','B') AND flag NOT IN ('X') ORDER BY step_no INTO TABLE @rt.");
  assert.deepStrictEqual(result.selector, { table: "ZLOG_PIPELINE", filters: [
    { field: "scenario_id", sign: "I", option: "EQ", low: "", high: "" },
    { field: "step_no", sign: "I", option: "BT", low: "010", high: "030" },
    { field: "name", sign: "I", option: "CP", low: "ZCL+*", high: "" },
    { field: "kind", sign: "I", option: "EQ", low: "A", high: "" },
    { field: "kind", sign: "I", option: "EQ", low: "B", high: "" },
    { field: "flag", sign: "E", option: "EQ", low: "X", high: "" }], columns: ["step_no", "modifier_class"] });
  assert.ok(result.sql, "it still runs as written");
});

test("what select-options cannot say stays out of SelecTor, with the reason", () => {
  const reason = statement => run(statement).notSelector;
  assert.match(reason("SELECT * FROM mara WHERE mtart = 'A' OR matkl = 'B' INTO TABLE @lt."), /different fields/);
  assert.match(reason("SELECT * FROM mara WHERE ersda >= '2020' AND ersda <= '2021' INTO TABLE @lt."), /two including conditions/);
  assert.match(reason("SELECT * FROM mara WHERE matkl = 'A' OR matkl = @lv INTO TABLE @lt."), /program value/);
  assert.match(reason("SELECT mtart, COUNT(*) FROM mara GROUP BY mtart HAVING COUNT(*) > 1 INTO TABLE @lt."), /HAVING/);
  assert.match(reason("SELECT DISTINCT mtart FROM mara INTO TABLE @lt."), /DISTINCT/);
  assert.match(reason("SELECT mtart, matkl, COUNT(*) FROM mara GROUP BY mtart INTO TABLE @lt."), /neither grouped nor aggregated/);
  assert.match(reason("SELECT * FROM mara WHERE lvorm IS INITIAL INTO TABLE @lt."), /cannot say/);
  assert.strictEqual(run("SELECT * FROM mara WHERE matkl = 'A' OR matkl = 'B' INTO TABLE @lt.").selector.filters.length, 2);
});

test("a dynamic table and a program value outside WHERE are refused", () => {
  assert.throws(() => run("SELECT * FROM (lv_tab) INTO TABLE lt."), /dynamic/);
  assert.throws(() => run("SELECT * FROM mara AS a INNER JOIN makt AS b ON b~matnr = a~matnr AND b~spras = @lv_l INTO TABLE @lt."), /program value/);
});

test("a statement that is not a SELECT is refused", () => {
  assert.throws(() => run("WRITE 'x'."), /not a SELECT/);
});

test("a SELECT loop runs like a SELECT", () => {
  const text = "REPORT z.\nSELECT matnr FROM mara INTO lv WHERE mtart = 'X'.\nENDSELECT.\n";
  assert.strictEqual(prepare(text, at(text, 2)).sql, "SELECT matnr FROM mara WHERE mtart = 'X'");
});

test("a join becomes SelecTor's: tables in order as t1, t2, their type and ON renamed, fields and filters on its column names", () => {
  const result = run("SELECT r~trkorr, x~as4text FROM e070 AS t INNER JOIN e070 AS r ON r~trkorr = t~strkorr"
    + " LEFT OUTER JOIN e07t AS x ON x~trkorr = r~trkorr AND x~langu = 'E'"
    + " WHERE t~as4user = @lv_uname AND r~trstatus IN ('D','L') APPENDING TABLE @lt.");
  assert.deepStrictEqual(result.selector, { table: "E070", join: ["E070", "E07T"],
    jtypes: { T1: "INNER", T2: "LEFT OUTER" },
    on: { T1: "t1~trkorr = t0~strkorr", T2: "t2~trkorr = t1~trkorr AND t2~langu = 'E'" },
    fields: ["t1~trkorr", "t2~as4text"],
    filters: [{ field: "as4user", sign: "I", option: "EQ", low: "", high: "" },
      { field: "t1_trstatus", sign: "I", option: "EQ", low: "D", high: "" },
      { field: "t1_trstatus", sign: "I", option: "EQ", low: "L", high: "" }] });
});

test("a join SelecTor cannot build stays out, with the reason", () => {
  const reason = statement => run(statement).notSelector;
  // A program value in ON can be neither run nor handed to SelecTor.
  assert.throws(() => run("SELECT * FROM e070 AS t INNER JOIN e07t AS x ON x~trkorr = t~trkorr AND x~langu = @sy-langu INTO TABLE @lt."), /program value/);
  assert.match(reason("SELECT * FROM e070 AS t RIGHT OUTER JOIN e07t AS x ON x~trkorr = t~trkorr INTO TABLE @lt."), /INNER or LEFT OUTER/);
  assert.match(reason("SELECT trkorr FROM e070 AS t INNER JOIN e07t AS x ON x~trkorr = t~trkorr INTO TABLE @lt."), /which table/);
});

test("ABAP's two spellings of a comparison give the same selection line: >= and GE, <> and NE", () => {
  const lines = statement => run(statement).selector.filters.map(f => f.option);
  assert.deepStrictEqual(lines("SELECT * FROM mara WHERE ersda >= '2020' AND matkl <> 'A' INTO TABLE @lt."), ["GE", "NE"]);
  assert.deepStrictEqual(lines("SELECT * FROM mara WHERE ersda GE '2020' AND matkl NE 'A' INTO TABLE @lt."), ["GE", "NE"]);
});

test("GROUP BY with aggregates becomes SelecTor's pivot: the grouped fields its rows, the aggregates its measures", () => {
  const result = run("SELECT trfunction, COUNT(*) AS cnt, MAX( as4date ) AS last FROM e070 WHERE as4user = @p_user GROUP BY trfunction INTO TABLE @DATA(lt).");
  assert.deepStrictEqual(result.selector, { table: "E070", join: [], jtypes: {}, on: {}, fields: [],
    filters: [{ field: "as4user", sign: "I", option: "EQ", low: "", high: "" }],
    pivot: { rows: ["t0~trfunction"], cols: [], vals: [{ key: "*", agg: "COUNT" }, { key: "t0~as4date", agg: "MAX" }] } });
});
