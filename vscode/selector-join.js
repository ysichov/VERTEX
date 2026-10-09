"use strict";

// SelecTor's join on the front end: the answer of /sap/bc/adt/vertex/join/<TAB> (ZCL_VX_ADT_RES_JOIN over
// ZCL_VX_TOOLS), built here and read through ADT's freestyle data preview. Same request - t1..tN, jT1 / onT1, pick and
// sf1.., f/s/o/l/h, rows - and the same JSON: table, sql, pivot, rows, candidates, tables, fields. The pivot is not
// here yet: a request with r/c/v parameters is not this module's.
//
// What the builder proposes is read from the dictionary as ZCL_VX_TOOLS reads it: the foreign keys out of a table
// (DD08L, field pairs from DD05S), the ones into it, its text table - around the base table only.
// Unlike the ABAP builder, a table the dictionary does not offer can still be taken, as ZCL_VX_TOOLS's own "add
// table" does: it joins on the key fields it shares with the base, or on the ON the caller gives.

const { quote, inLists, fieldsOf, language, value, whereClause, NUMBERS, OPTIONS, NAME } = require("./selector-table");

const MAX_TABLES = 10, MAX_FILTERS = 20, MAX_FIELDS = 200, MAX_OFFERED = 60;
const CHARLIKE = ["CHAR", "NUMC", "DATS", "TIMS", "CLNT", "CUKY", "UNIT", "LANG"];

function pivotOf(datatype) {
  if (NUMBERS.includes(datatype)) { return { aggs: ["SUM", "COUNT", "MIN", "MAX", "AVG"], agg: "SUM" }; }
  return { aggs: CHARLIKE.includes(datatype) ? ["COUNT", "MIN", "MAX"] : ["COUNT"], agg: "COUNT" };
}

// The tables the dictionary offers around one table, each with the field pairs its ON is made of
// (cand: the offered table's field, base: the field of the table it was found from).
// The key fields of tables, in key order, read in one go.
async function keysOf(api, tables) {
  const keys = new Map(tables.map(name => [name, []]));
  const rows = await inLists(api, "SELECT * FROM dd03l WHERE keyflag = 'X' AND as4local = 'A' AND tabname", tables, 10000);
  for (const row of rows.filter(row => !row.FIELDNAME.startsWith(".")).sort((a, b) => Number(a.POSITION) - Number(b.POSITION))) {
    keys.get(row.TABNAME).push(row.FIELDNAME);
  }
  return keys;
}

// DD05S names, for each foreign key field, the field of the foreign table at each position of the check table's key
// (PRIMPOS); the check table's field is its key field at that position - what DD_FORKEY_GET resolves.
function pairsOf(fields, owner, field, checkKeys, flip) {
  return fields.filter(pair => pair.TABNAME === owner && pair.FIELDNAME === field && pair.FORTABLE === owner)
    .map(pair => ({ forkey: pair.FORKEY, checkfield: checkKeys[Number(pair.PRIMPOS) - 1] }))
    .filter(pair => pair.checkfield && pair.checkfield !== "MANDT" && pair.forkey)
    .map(pair => flip ? { cand: pair.forkey, base: pair.checkfield } : { cand: pair.checkfield, base: pair.forkey });
}

// What the dictionary offers around a table, from DD08L alone. The field pairs of a key are read only for a table
// that is joined, and only when no ON was given: reading them for every offered table took a timeout on E070.
async function neighbours(api, table) {
  const out = (await api.query("SELECT * FROM dd08l WHERE tabname = " + quote(table) + " AND as4local = 'A'", 1000)).values
    .filter(fk => fk.CHECKTABLE && fk.CHECKTABLE !== table && fk.CHECKTABLE !== "*");
  const into = (await api.query("SELECT * FROM dd08l WHERE checktable = " + quote(table) + " AND as4local = 'A'", 100)).values
    .filter(fk => fk.TABNAME !== table);
  return [
    ...out.map(fk => ({ tabname: fk.CHECKTABLE, direction: "O", key: { owner: table, field: fk.FIELDNAME, check: fk.CHECKTABLE, flip: false } })),
    ...into.map(fk => ({ tabname: fk.TABNAME, direction: fk.FRKART === "TEXT" ? "T" : "I", key: { owner: fk.TABNAME, field: fk.FIELDNAME, check: table, flip: true } }))
  ];
}

async function pairsFor(api, key) {
  if (!key) { return []; }
  const fields = (await api.query("SELECT * FROM dd05s WHERE tabname = " + quote(key.owner) + " AND fieldname = " + quote(key.field) + " AND as4local = 'A'", 100)).values;
  const keys = await keysOf(api, [key.check]);
  return pairsOf(fields, key.owner, key.field, keys.get(key.check), key.flip);
}

async function request(api, resource) {
  const url = new URL(resource, "https://sap.invalid"), params = url.searchParams;
  const match = /^\/sap\/bc\/adt\/vertex\/join\/([^/]+)$/.exec(url.pathname);
  if (!match) { return null; }
  const base = decodeURIComponent(match[1]).toUpperCase();
  if (!NAME.test(base)) { throw new Error(base + " is not a table name."); }
  const rows = Number(params.get("rows") || 0);
  if (!Number.isInteger(rows) || rows < 0) { throw new Error("rows must be a whole number."); }

  const kind = await api.query("SELECT tabclass FROM dd02l WHERE tabname = " + quote(base) + " AND as4local = 'A'", 1);
  if (!kind.values.length || !["TRANSP", "CLUSTER", "POOL", "VIEW"].includes(kind.values[0].TABCLASS)) { throw new Error("table " + base + " was not found."); }

  // The tables taken, in the order taken: that order hands out the aliases, T1, T2...
  const taken = [];
  for (let i = 1; i <= MAX_TABLES && params.get("t" + i); i++) {
    const name = String(params.get("t" + i)).toUpperCase();
    if (!NAME.test(name)) { throw new Error(name + " is not a table name."); }
    taken.push(name);
  }

  // The canvas: what the dictionary offers around the base, and around each table as it is taken.
  const offered = [], seen = new Set([base]);
  const offer = (list, parent) => {
    for (const item of list) {
      if (seen.has(item.tabname) || offered.length >= MAX_OFFERED) { continue; }
      seen.add(item.tabname);
      offered.push(Object.assign(item, { parent }));
    }
  };
  // cand=0: the caller does not show the tables around the base - Run Select's window, opened on the answer - so
  // the dictionary is not asked for them.
  if (params.get("cand") !== "0") { offer(await neighbours(api, base), base); }
  const joined = [];
  for (const [index, name] of taken.entries()) {
    let candidate = offered.find(item => item.tabname === name && !item.alias);
    if (!candidate) {
      // Not offered: taken by hand, as the builder's "add table" takes it.
      candidate = { tabname: name, direction: "M", parent: base, key: null };
      if (name !== base && !seen.has(name)) { seen.add(name); offered.push(candidate); }
    }
    const alias = "T" + (index + 1);
    if (!candidate.alias) { candidate.alias = alias; }
    joined.push({ tabname: name, alias, parent: candidate.parent, key: candidate.key, direction: candidate.direction });
  }

  // Only real database tables are offered, with their descriptions.
  const names = [...new Set([base, ...offered.map(item => item.tabname)])];
  const real = new Set(), texts = new Map();
  const spras = quote(await language(api));
  for (const row of await inLists(api, "SELECT tabname, tabclass FROM dd02l WHERE as4local = 'A' AND tabname", names, 1000)) {
    if (["TRANSP", "POOL", "CLUSTER"].includes(row.TABCLASS)) { real.add(row.TABNAME); }
  }
  for (const row of await inLists(api, "SELECT tabname, ddtext FROM dd02t WHERE ddlanguage = " + spras + " AND as4local = 'A' AND tabname", names, 1000)) {
    texts.set(row.TABNAME, row.DDTEXT);
  }
  const candidates = offered.filter(item => real.has(item.tabname) || item.direction === "M").map(item => ({
    tabname: item.tabname, ddtext: texts.get(item.tabname) || "", direction: item.direction, alias: item.alias || "",
    selected: joined.some(j => j.tabname === item.tabname) }));

  // Fields of every table in the join; a joined table's ON from its pairs with the table it was found from.
  const catalogs = new Map();
  const catalog = async name => {
    if (!catalogs.has(name)) { catalogs.set(name, await fieldsOf(api, name)); }
    return catalogs.get(name);
  };
  const tables = [{ alias: "T0", tabname: base, ddtext: texts.get(base) || "", jtype: "LEFT OUTER", cond: "" }];
  for (const j of joined) {
    const parent = joined.find(other => other.tabname === j.parent && other !== j);
    const parentAlias = j.parent === base || !parent ? "t0" : parent.alias.toLowerCase();
    const askedOn = params.get("on" + j.alias);
    let pairs = askedOn ? [] : await pairsFor(api, j.key);
    if (!askedOn && !pairs.length) {
      // No foreign key: the key fields the two tables share by name.
      const anchor = await catalog(parentAlias === "t0" ? base : j.parent), mine = await catalog(j.tabname);
      pairs = mine.filter(f => f.KEYFLAG === "X" && f.DATATYPE !== "CLNT" && anchor.some(a => a.FIELDNAME === f.FIELDNAME))
        .map(f => ({ cand: f.FIELDNAME, base: f.FIELDNAME }));
    }
    let cond = pairs.map(pair => j.alias.toLowerCase() + "~" + pair.cand.toLowerCase() + " = " + parentAlias + "~" + pair.base.toLowerCase()).join(" AND ");
    let jtype = "LEFT OUTER";
    const askedType = String(params.get("j" + j.alias) || "").toUpperCase();
    if (askedType) {
      if (askedType !== "INNER" && askedType !== "LEFT OUTER") { throw new Error("Join type " + askedType + " for " + j.alias + " must be INNER or LEFT OUTER."); }
      jtype = askedType;
    }
    if (askedOn) { cond = askedOn.trim(); }
    tables.push({ alias: j.alias, tabname: j.tabname, ddtext: texts.get(j.tabname) || "", jtype, cond });
  }

  const multi = tables.length > 1;
  const fields = [];
  for (const t of tables) {
    for (const f of await catalog(t.tabname)) {
      const duplicate = fields.some(other => other.sel && other.fieldname === f.FIELDNAME);
      fields.push(Object.assign({ sel: t.alias === "T0" || (f.KEYFLAG === "X" && !duplicate), pos: 0, alias: t.alias,
        tabname: t.tabname, fieldname: f.FIELDNAME, key: f.KEYFLAG === "X", ddtext: f.TEXT, datatype: f.DATATYPE, domname: f.DOMNAME || "" }, pivotOf(f.DATATYPE)));
    }
  }
  const keyOf = f => (f.alias + "~" + f.fieldname).toLowerCase();
  if (params.get("pick") === "X") {
    const wanted = [];
    for (let i = 1; i <= MAX_FIELDS && params.get("sf" + i); i++) { wanted.push(String(params.get("sf" + i)).toLowerCase()); }
    fields.forEach(f => { f.sel = wanted.includes(keyOf(f)); f.pos = f.sel ? wanted.indexOf(keyOf(f)) + 1 : 0; });
  } else {
    let pos = 0;
    fields.forEach(f => { f.pos = f.sel ? ++pos : 0; });
  }

  // Selection lines on the join's column names: MATNR for the base table, T1_MATNR for a joined one.
  const filters = [];
  for (let i = 1; i <= MAX_FILTERS && params.get("f" + i); i++) {
    const label = String(params.get("f" + i)).toUpperCase();
    const split = /^(T\d+)_(.+)$/.exec(label), alias = split ? split[1] : "T0", fieldname = split ? split[2] : label;
    if (!fields.some(f => f.alias === alias && f.fieldname === fieldname)) {
      throw new Error(label + " is not a field of this join. Filter on the names the statement gives its columns - MATNR for the base table, T1_MATNR for a joined one.");
    }
    const sign = String(params.get("s" + i) || "I").toUpperCase(), option = String(params.get("o" + i) || "EQ").toUpperCase();
    const low = params.get("l" + i) || "", high = params.get("h" + i) || "";
    if (sign !== "I" && sign !== "E") { throw new Error("Sign " + sign + " for " + label + " must be I or E."); }
    if (!OPTIONS.includes(option)) { throw new Error("Option " + option + " for " + label + " is not one of " + OPTIONS.join(" ") + "."); }
    if ((option === "BT" || option === "NB") && !high) { throw new Error("Option " + option + " for " + label + " needs an upper bound in h" + i + "."); }
    filters.push({ field: multi ? alias.toLowerCase() + "~" + fieldname.toLowerCase() : fieldname.toLowerCase(), sign, option, low, high });
  }

  const selected = fields.filter(f => f.sel).sort((a, b) => a.pos - b.pos);
  const list = selected.map(f => multi ? keyOf(f) + " AS " + f.alias.toLowerCase() + "_" + f.fieldname.toLowerCase() : f.fieldname.toLowerCase()).join(", ");
  const from = tables.map((t, i) => i === 0 ? t.tabname.toLowerCase() + (multi ? " AS t0" : "")
    : t.jtype + " JOIN " + t.tabname.toLowerCase() + " AS " + t.alias.toLowerCase() + " ON " + t.cond).join(" ");
  const where = whereClause(filters);
  const cross = readPivot(params);
  if (cross) { return Object.assign(await pivot(api, cross, fields, multi, from, where, rows), { table: base.toLowerCase(), candidates, tables, fields }); }
  const sql = selected.length ? "SELECT " + list + " FROM " + from + (where ? " WHERE " + where : "") : "";

  let lines = null;
  if (rows > 0 && sql) {
    const types = new Map(fields.map(f => [multi ? (f.alias + "_" + f.fieldname) : f.fieldname, f.datatype]));
    lines = (await api.query(sql, rows)).values.map(row => Object.fromEntries(Object.keys(row).map(column =>
      [column.toLowerCase(), value(row[column], types.get(column))])));
  }
  return { table: base.toLowerCase(), sql, pivot: false, rows: lines, candidates, tables, fields };
}

// The pivot cross, as ZCL_VX_ADT_RES_JOIN reads it: r1.. row dimensions, c1.. columns, v1.. measures with a1.. their
// aggregates, each key alias~field; "*" as a measure is COUNT( * ).
function readPivot(params) {
  const cross = { rows: [], cols: [], vals: [] };
  for (let i = 1; i <= MAX_FILTERS; i++) {
    if (params.get("r" + i)) { cross.rows.push(String(params.get("r" + i)).toLowerCase()); }
    if (params.get("c" + i)) { cross.cols.push(String(params.get("c" + i)).toLowerCase()); }
    if (params.get("v" + i)) { cross.vals.push({ key: String(params.get("v" + i)).toLowerCase(), agg: String(params.get("a" + i) || "").toUpperCase() }); }
  }
  return cross.rows.length || cross.cols.length || cross.vals.length ? cross : null;
}

// The pivot as ZCL_VX_PIVOT and ZCL_VX_TOOLS=>EXECUTE_PIVOT make it: one statement grouped by the dimensions, its
// columns named ALIAS_FIELD and AGG_ALIAS_FIELD (CNT_ROWS when no measure is given), each line one cell; then the
// column dimensions' values are spread into columns, MEASURE_VALUE, here rather than in the database. Values come
// as SAP wrote them; the domain texts the ABAP pivot puts on them are not read yet.
const MAX_SPREAD = 50;
async function pivot(api, cross, fields, multi, from, where, rows) {
  const fieldOf = key => {
    const [alias, name] = key.split("~");
    const field = fields.find(f => f.alias.toLowerCase() === alias && f.fieldname.toLowerCase() === name);
    if (!field) { throw new Error(key + " is not a field of this join."); }
    return field;
  };
  const qualify = key => multi ? key : key.split("~")[1];
  const taken = new Set();
  const unique = name => {
    let candidate = name.slice(0, 30), n = 0;
    while (taken.has(candidate)) { candidate = name.slice(0, 28) + "_" + (++n); }
    taken.add(candidate);
    return candidate;
  };
  const comp = (key, prefix) => (prefix ? prefix + "_" : "") + key.replace("~", "_").toUpperCase();
  const columns = [];
  cross.rows.forEach(key => columns.push({ key, role: "R", field: fieldOf(key), comp: unique(comp(key)) }));
  cross.cols.forEach(key => columns.push({ key, role: "C", field: fieldOf(key), comp: unique(comp(key)) }));
  cross.vals.forEach(v => {
    if (v.key === "*") { columns.push({ key: "*", role: "M", agg: "COUNT", comp: unique("COUNT_ALL") }); return; }
    const field = fieldOf(v.key), allowed = pivotOf(field.datatype);
    const agg = allowed.aggs.includes(v.agg) ? v.agg : allowed.agg;
    columns.push({ key: v.key, role: "M", field, agg, comp: unique(comp(v.key, agg)) });
  });
  if (!cross.vals.length) { columns.push({ key: "*", role: "M", agg: "COUNT", comp: unique("CNT_ROWS") }); }

  const dims = columns.filter(c => c.role !== "M"), measures = columns.filter(c => c.role === "M");
  const list = columns.map(c => (c.role === "M" ? c.agg + "( " + (c.key === "*" ? "*" : qualify(c.key)) + " )" : qualify(c.key)) + " AS " + c.comp.toLowerCase());
  const sql = "SELECT " + list.join(", ") + " FROM " + from + (where ? " WHERE " + where : "")
    + (dims.length ? " GROUP BY " + dims.map(c => qualify(c.key)).join(", ") : "");
  if (!(rows > 0)) { return { sql, pivot: true, rows: null }; }

  const raw = (await api.query(sql, rows)).values;
  const rowDims = dims.filter(c => c.role === "R"), colDims = dims.filter(c => c.role === "C");
  const plain = (row, c) => String(row[c.comp] == null ? "" : row[c.comp]).trim();
  const text = (row, list) => list.map(c => plain(row, c) || "(empty)").join("/");
  raw.sort((a, b) => text(a, rowDims).localeCompare(text(b, rowDims)) || text(a, colDims).localeCompare(text(b, colDims)));

  // A value's text, as FIELD_LABEL gives it: the domain's fixed-value text, the field's own text for an X the domain
  // does not explain, the value itself otherwise. One DD07T read per domain.
  const spras = quote(await language(api)), domains = new Map();
  for (const name of [...new Set(dims.map(c => c.field.domname).filter(Boolean))]) {
    domains.set(name, new Map((await api.query("SELECT domvalue_l, ddtext FROM dd07t WHERE domname = " + quote(name)
      + " AND ddlanguage = " + spras + " AND as4local = 'A'", 1000)).values.map(row => [String(row.DOMVALUE_L).trim(), row.DDTEXT])));
  }
  const label = (c, raw) => {
    const known = c.field.domname && domains.get(c.field.domname) && domains.get(c.field.domname).get(raw);
    return known || (raw === "X" ? c.field.ddtext || c.field.fieldname : raw || "(empty)");
  };
  // A row dimension shows its texts when at least one of its values has one, as EXECUTE_PIVOT decides.
  const labelled = new Set(rowDims.filter(c => raw.some(row => label(c, plain(row, c)) !== (plain(row, c) || "(empty)"))));
  const header = c => c.key === "*" ? "Count" : (c.role === "M" ? c.agg + " " : "") + (c.field.ddtext || c.field.fieldname);
  // A count, sum or average is a number; the smallest or largest date is still a date.
  const cell = (c, v) => {
    if (c.role !== "M") { return labelled.has(c) ? label(c, String(v == null ? "" : v).trim()) : value(v, c.field.datatype); }
    if ((c.agg === "MIN" || c.agg === "MAX") && c.field && !NUMBERS.includes(c.field.datatype)) { return value(v, c.field.datatype); }
    return v == null || String(v).trim() === "" ? 0 : Number(v);
  };
  const headers = {};
  rowDims.forEach(c => { headers[c.comp.toLowerCase()] = header(c); });

  if (!colDims.length) {
    measures.forEach(c => { headers[c.comp.toLowerCase()] = header(c); });
    return { sql, pivot: true, headers, rows: raw.map(row => Object.fromEntries(columns.map(c => [c.comp.toLowerCase(), cell(c, row[c.comp])]))) };
  }
  const buckets = [...new Set(raw.map(row => text(row, colDims)))].sort().slice(0, MAX_SPREAD);
  const bucketLabel = new Map(raw.map(row => [text(row, colDims), colDims.map(c => label(c, plain(row, c))).join("/")]));
  const sanitize = bucket => (bucket.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/^_+$/, "") || "BLANK").slice(0, 12);
  const spread = [];
  rowDims.forEach(c => taken.add(c.comp));
  for (const bucket of buckets) {
    for (const m of measures) {
      const tail = sanitize(bucket);
      const name = unique(m.comp.slice(0, 29 - tail.length) + "_" + tail);
      spread.push({ bucket, measure: m, comp: name });
      headers[name.toLowerCase()] = measures.length === 1 ? bucketLabel.get(bucket) : bucketLabel.get(bucket) + " " + header(m);
    }
  }
  const wide = [];
  let previous = null;
  for (const row of raw) {
    const key = text(row, rowDims);
    if (!previous || previous.key !== key) {
      previous = { key, line: Object.fromEntries(rowDims.map(c => [c.comp.toLowerCase(), cell(c, row[c.comp])])) };
      spread.forEach(s => { previous.line[s.comp.toLowerCase()] = null; });
      wide.push(previous.line);
    }
    const bucket = text(row, colDims);
    spread.filter(s => s.bucket === bucket).forEach(s => { previous.line[s.comp.toLowerCase()] = cell(s.measure, row[s.measure.comp]); });
  }
  return { sql, pivot: true, headers, rows: wide };
}

module.exports = { request };
