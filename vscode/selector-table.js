"use strict";

// SelecTor's table service on the front end: the answer of /sap/bc/adt/vertex/table/<TAB> (ZCL_VX_ADT_RES_TABLE),
// built here and read through ADT's freestyle data preview instead of a VERTEX resource on SAP. Same request, same
// JSON: { table, count, fields: [{ name, position, key, datatype, length, decimals, text }], rows }.
// Unlike the ABAP resource, a SELECT that SAP refuses is an error here, not an empty table.

const MAX_FILTERS = 20;
const OPTIONS = ["EQ", "NE", "GT", "GE", "LT", "LE", "CP", "NP", "BT", "NB"];
const NUMBERS = ["INT1", "INT2", "INT4", "INT8", "DEC", "CURR", "QUAN", "FLTP", "D16D", "D34D", "D16N", "D34N"];
const NAME = /^[A-Z0-9_/]{1,30}$/;

const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
const pattern = value => String(value).replace(/\*/g, "%").replace(/\+/g, "_");

function term(filter) {
  const field = filter.field, low = quote(filter.low);
  switch (filter.option) {
    case "EQ": return field + " = " + low;
    case "NE": return field + " <> " + low;
    case "GT": return field + " > " + low;
    case "GE": return field + " >= " + low;
    case "LT": return field + " < " + low;
    case "LE": return field + " <= " + low;
    case "CP": return field + " LIKE " + quote(pattern(filter.low));
    case "NP": return field + " NOT LIKE " + quote(pattern(filter.low));
    case "BT": return field + " BETWEEN " + low + " AND " + quote(filter.high);
    default: return field + " NOT BETWEEN " + low + " AND " + quote(filter.high);
  }
}

// Select-option semantics, as the ABAP resource has them: lines of one field are ORed, excluding lines become
// AND NOT, different fields are ANDed.
function whereClause(filters) {
  const groups = [];
  for (const field of [...new Set(filters.map(filter => filter.field))].sort()) {
    const mine = filters.filter(filter => filter.field === field);
    const include = mine.filter(filter => filter.sign === "I").map(term), exclude = mine.filter(filter => filter.sign === "E").map(term);
    const parts = [];
    if (include.length) { parts.push("( " + include.join(" OR ") + " )"); }
    if (exclude.length) { parts.push("NOT ( " + exclude.join(" OR ") + " )"); }
    groups.push(parts.join(" AND "));
  }
  return groups.join(" AND ");
}

function readFilters(params, fields, table) {
  const filters = [];
  for (let i = 1; i <= MAX_FILTERS; i++) {
    const field = String(params.get("f" + i) || "").toUpperCase();
    if (!field) { break; }
    const sign = String(params.get("s" + i) || "I").toUpperCase(), option = String(params.get("o" + i) || "EQ").toUpperCase();
    const low = params.get("l" + i) || "", high = params.get("h" + i) || "";
    const ddic = fields.find(f => f.FIELDNAME === field);
    if (!ddic) { throw new Error("Table " + table + " has no field " + field + "."); }
    if (ddic.DATATYPE === "STRG" || ddic.DATATYPE === "RSTR") { throw new Error("Field " + field + " is a LOB and cannot be selected on."); }
    if (sign !== "I" && sign !== "E") { throw new Error("Sign " + sign + " for " + field + " must be I or E."); }
    if (!OPTIONS.includes(option)) { throw new Error("Option " + option + " for " + field + " is not one of " + OPTIONS.join(" ") + "."); }
    if ((option === "BT" || option === "NB") && !high) { throw new Error("Option " + option + " for " + field + " needs an upper bound in h" + i + "."); }
    filters.push({ field, sign, option, low, high });
  }
  return filters;
}

// The value as /ui2/cl_json wrote it for the ABAP resource: numbers as numbers, dates and times formatted.
function value(raw, datatype) {
  const text = raw == null ? "" : String(raw);
  if (NUMBERS.includes(datatype)) { return text.trim() === "" ? 0 : Number(text); }
  if (datatype === "DATS") { return /^0*$/.test(text) ? "" : text.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"); }
  if (datatype === "TIMS") { return text.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3"); }
  return text;
}

// ADT's data preview cuts a statement of 255 characters or more into lines of source, and has cut through a literal
// doing it. A list of names therefore goes in as many statements as keep each one shorter: head IN ( 'A', 'B' ).
const LINE = 240;
async function inLists(api, head, names, rows) {
  const values = [];
  let chunk = [];
  const flush = async () => {
    if (chunk.length) { values.push(...(await api.query(head + " IN ( " + chunk.join(", ") + " )", rows)).values); }
    chunk = [];
  };
  for (const name of names.map(quote)) {
    if (chunk.length && (head + " IN ( " + chunk.concat(name).join(", ") + " )").length >= LINE) { await flush(); }
    chunk.push(name);
  }
  await flush();
  return values;
}

const languages = new WeakMap();
// DD04T and DD03T are keyed by the one-letter SAP language; the ADT session names its language in ISO.
async function language(api) {
  if (!languages.has(api)) {
    // The host may name it in ISO (EN) or as SAP's one letter (E), and may answer later (Eclipse asks its project).
    languages.set(api, Promise.resolve(api.language()).then(async named => {
      const code = String(named || "").trim().toUpperCase();
      if (code.length === 1) { return code; }
      const row = (await api.query("SELECT spras FROM t002 WHERE laiso = " + quote(code), 1)).values[0];
      if (!row) { throw new Error("T002 has no SAP language for the session language " + named + "."); }
      return row.SPRAS;
    }).catch(error => { languages.delete(api); throw error; }));
  }
  return languages.get(api);
}

// A table's fields as DD03L lists them, in their order, each with its text in the session's language.
async function fieldsOf(api, table) {
  const spras = quote(await language(api));
  // Plain single-table reads only: ADT's data preview rewrites the statement before it runs it, and a join of
  // DD03L with its text tables came back as a syntax error. .INCLUDE and .APPEND rows name structures, not fields -
  // their fields are listed in their own right - and are dropped here rather than with a literal holding a full stop,
  // which the data preview also takes apart.
  const catalog = (await api.query("SELECT * FROM dd03l WHERE tabname = " + quote(table) + " AND as4local = 'A'", 10000))
    .values.filter(f => !f.FIELDNAME.startsWith(".")).sort((a, b) => Number(a.POSITION) - Number(b.POSITION));
  const elements = new Map(), own = new Map();
  const rollnames = [...new Set(catalog.map(f => f.ROLLNAME).filter(Boolean))];
  for (const row of await inLists(api, "SELECT rollname, ddtext FROM dd04t WHERE ddlanguage = " + spras
    + " AND as4local = 'A' AND rollname", rollnames, 10000)) { elements.set(row.ROLLNAME, row.DDTEXT); }
  for (const row of (await api.query("SELECT fieldname, ddtext FROM dd03t WHERE tabname = " + quote(table)
    + " AND ddlanguage = " + spras + " AND as4local = 'A'", 10000)).values) { own.set(row.FIELDNAME, row.DDTEXT); }
  for (const f of catalog) { f.TEXT = elements.get(f.ROLLNAME) || own.get(f.FIELDNAME) || ""; }
  return catalog;
}

async function request(api, resource) {
  const url = new URL(resource, "https://sap.invalid");
  const match = /^\/sap\/bc\/adt\/vertex\/table\/([^/]+)$/.exec(url.pathname);
  if (!match) { return null; }
  const table = decodeURIComponent(match[1]).toUpperCase();
  if (!NAME.test(table)) { throw new Error(table + " is not a table name."); }
  const rows = Number(url.searchParams.get("rows") || 100);
  if (!Number.isInteger(rows) || rows < 0) { throw new Error("rows must be a whole number."); }

  // The ABAP resource reads transparent and cluster tables only, not views.
  const kind = await api.query("SELECT tabclass FROM dd02l WHERE tabname = " + quote(table) + " AND as4local = 'A'", 1);
  if (!kind.values.length || !["TRANSP", "CLUSTER"].includes(kind.values[0].TABCLASS)) { throw new Error("table " + table + " was not found."); }

  const catalog = await fieldsOf(api, table);

  const where = whereClause(readFilters(url.searchParams, catalog, table));
  // pick=X with sf1..: only these columns are read and answered, in their order - Run Select's SELECT list, until
  // the reader asks for the hidden fields. The rows still come in key order.
  let shown = catalog;
  if (url.searchParams.get("pick") === "X") {
    const wanted = [];
    for (let i = 1; i <= 200 && url.searchParams.get("sf" + i); i++) { wanted.push(String(url.searchParams.get("sf" + i)).toUpperCase()); }
    shown = wanted.map(name => {
      const field = catalog.find(f => f.FIELDNAME === name);
      if (!field) { throw new Error("Table " + table + " has no field " + name + "."); }
      return field;
    });
  }
  const keys = catalog.filter(f => f.KEYFLAG === "X").map(f => f.FIELDNAME.toLowerCase());
  const list = shown === catalog ? "*" : shown.map(f => f.FIELDNAME.toLowerCase()).join(", ");
  // ORDER BY PRIMARY KEY wants every column; a shorter list is ordered by the key fields named.
  const order = shown === catalog || !keys.length ? " ORDER BY PRIMARY KEY" : " ORDER BY " + keys.join(", ");
  const data = await api.query("SELECT " + list + " FROM " + table + (where ? " WHERE " + where : "") + order, rows);

  // The client field holds the session's client in every row: noise in the grid, useless as a criterion.
  const fields = shown.filter(f => f.DATATYPE !== "CLNT").map(f => ({
    name: f.FIELDNAME.toLowerCase(), position: Number(f.POSITION), key: f.KEYFLAG === "X", datatype: f.DATATYPE,
    length: Number(f.LENG), decimals: Number(f.DECIMALS), text: f.TEXT }));
  const types = new Map(catalog.map(f => [f.FIELDNAME, f.DATATYPE]));
  const lines = data.values.map(row => Object.fromEntries(Object.keys(row).map(column =>
    [column.toLowerCase(), value(row[column], types.get(column))])));
  return { table: table.toLowerCase(), count: lines.length, fields, rows: lines };
}

module.exports = { request, whereClause, value, quote, inLists, fieldsOf, language, NUMBERS, OPTIONS, NAME };
