"use strict";
/* The DDIC an SAP program's transpiler run needs, read from the system's dictionary tables over ADT's data preview and
   written as the abapGit XML the transpiler reads: structures and tables (DD02L, DD03L), data elements (DD04L), domains
   (DD01L) and table types (DD40L). The names start from what the sources name after TYPE, INCLUDE TYPE/STRUCTURE, TABLES
   and in a SELECT's FROM or JOIN, and follow what each definition uses until nothing new is named. A name the sources use
   that the dictionary does not have is left to the transpiler, which names what it cannot resolve; a name a definition
   uses that the dictionary does not have stops the run. */
const fs = require("fs");
const path = require("path");
const { tokenize } = require("./value-origin-tokens");

const up = value => String(value || "").toUpperCase();
const BUILT_IN = new Set(["I", "INT8", "F", "P", "C", "N", "D", "T", "X", "STRING", "XSTRING", "DECFLOAT16", "DECFLOAT34",
  "UTCLONG", "ABAP_BOOL", "ANY", "DATA", "SIMPLE", "CLIKE", "CSEQUENCE", "XSEQUENCE", "NUMERIC", "OBJECT", "TABLE", "INDEX",
  "STANDARD", "SORTED", "HASHED", "LINE", "RANGE", "REF", "TO", "OF", "VALUE", "LENGTH", "DECIMALS", "READ-ONLY", "BOXED"]);
const CHUNK = 40;

/* The names a source may take from the dictionary. */
function dictionaryNames(text) {
  const tokens = tokenize(text), names = new Set();
  const at = i => up(tokens[i] && tokens[i].value);
  const name = i => tokens[i] && tokens[i].kind === "word" && at(i + 1) !== "=>" && !BUILT_IN.has(at(i)) ? at(i) : "";
  const add = i => { const found = name(i); if (found) names.add(found); };
  // FROM and JOIN name a table only in Open SQL - a statement with SELECT in it, or OPEN CURSOR: SUBTRACT 1 FROM b and
  // DELETE itab FROM idx name none. TABLES names one only as its own statement.
  let first = "", sql = false;
  for (let i = 0; i < tokens.length; i++) {
    const current = at(i);
    if (tokens[i].kind === "symbol" && current === ".") { first = ""; sql = false; continue; }
    if (!first && tokens[i].kind === "word") { first = current; if (first === "OPEN") sql = true; }
    if (current === "SELECT") sql = true;
    if (current === "TYPE" || current === "STRUCTURE" && at(i - 1) === "INCLUDE") {
      let j = i + 1;
      if (at(j) === "REF" && at(j + 1) === "TO") j += 2;
      if (at(j) === "LINE" && at(j + 1) === "OF") j += 2;
      else if (at(j) === "RANGE" && at(j + 1) === "OF") j += 2;
      else {
        while (["STANDARD", "SORTED", "HASHED", "ANY", "INDEX"].includes(at(j))) j++;
        if (at(j) === "TABLE" && at(j + 1) === "OF") { j += 2; if (at(j) === "REF" && at(j + 1) === "TO") j += 2; }
      }
      add(j);
    }
    // LIKE can name a Dictionary structure as well as dbtab-field.
    if (current === "LIKE") add(i + 1);
    if (sql && (current === "FROM" || current === "JOIN") && tokens[i + 1]) add(i + 1);
    if (current === "TABLES" && first === "TABLES") {
      for (let j = i + 1; j < tokens.length && at(j) !== "."; j++)
        if (tokens[j].kind === "word" && (j === i + 1 || [":", ","].includes(at(j - 1)))) add(j);
    }
  }
  return names;
}

/* The types a source declares itself with TYPES - TYPES ty_x ..., TYPES: BEGIN OF ty_s, ..., END OF ty_s, ty_t TYPE ... -
   which are no dictionary names: asked for there they only cost a request, and through SAP's ADT extension a walk of every
   package. */
function declaredTypes(text) {
  const tokens = tokenize(text), names = new Set();
  const at = i => up(tokens[i] && tokens[i].value), sym = i => tokens[i] && tokens[i].kind === "symbol" ? tokens[i].value : "";
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (at(i) !== "TYPES" || (i > 0 && sym(i - 1) !== "." )) continue;
    let j = i + 1;
    if (sym(j) === ":") j++;
    // One element of the chain at a time: its name, then on to the next comma or the period.
    // Inside BEGIN OF ... END OF the names are components, not types: only the structure itself counts.
    while (j < tokens.length && sym(j) !== ".") {
      if (at(j) === "BEGIN" && at(j + 1) === "OF") { if (depth === 0 && tokens[j + 2] && tokens[j + 2].kind === "word") names.add(at(j + 2)); depth++; }
      else if (at(j) === "END" && at(j + 1) === "OF") depth = Math.max(0, depth - 1);
      else if (depth === 0 && tokens[j] && tokens[j].kind === "word") names.add(at(j));
      while (j < tokens.length && sym(j) !== "," && sym(j) !== ".") j++;
      if (sym(j) === ",") j++;
    }
    i = j;
  }
  return names;
}

/* The rows of a SELECT over a list of names, in chunks the data preview takes. */
async function selectIn(query, select, column, names) {
  const rows = [];
  for (let at = 0; at < names.length; at += CHUNK) {
    const list = names.slice(at, at + CHUNK).map(name => "'" + name.replace(/'/g, "''") + "'").join(", ");
    const data = await query(select + " WHERE " + column + " IN (" + list + ") AND as4local = 'A'", 100000);
    rows.push(...(data.values || []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [up(key), value]))));
  }
  return rows;
}

function normalizeTableFields(table) {
  // DD03L includes both an include marker and its already flattened fields.
  // Emit the flattened representation only, including when loading a saved SAP snapshot.
  table.fields.sort((a, b) => Number(a.POSITION) - Number(b.POSITION));
  const marker = row => [".INCLUDE", ".APPEND"].includes(up(row.FIELDNAME))
    || up(row.FIELDNAME).startsWith(".INCLU-");
  table.fields = table.fields.filter((row, index, fields) => {
    if (!marker(row)) return true;
    for (let next = index + 1; next < fields.length; next++) {
      if (marker(fields[next])) break;
      if (Number(fields[next].ADMINFIELD || 0) > Number(row.ADMINFIELD || 0)) return false;
    }
    return true;
  });
  return table;
}

/* The dictionary closure of the names, without those `known` (open-abap-core's, the classes read). A data element and
   its domain often share a name, so types (tables and structures, data elements, table types) and domains are asked for
   apart. */
async function readDictionary(query, start, known = new Set()) {
  const types = new Map(), domains = new Map(), asked = { type: new Set(), domain: new Set() };
  const required = []; // [name, kind, who needs it]
  const pending = { type: [...start].filter(name => !known.has(name)), domain: [] };
  const need = (name, by, kind = "type") => {
    name = up(name);
    // A domain is known only as a domain (known.domains): a data element of that name in open-abap-core is no domain.
    if (!name || (kind === "domain" && known.domains ? known.domains.has(name) : known.has(name)) || BUILT_IN.has(name)) return;
    required.push([name, kind, by]);
    if (!asked[kind].has(name)) pending[kind].push(name);
  };
  while (pending.type.length || pending.domain.length) {
    const names = [...new Set(pending.type)].filter(name => !asked.type.has(name));
    const domainNames = [...new Set(pending.domain)].filter(name => !asked.domain.has(name));
    pending.type = []; pending.domain = [];
    names.forEach(name => asked.type.add(name));
    domainNames.forEach(name => asked.domain.add(name));
    for (const row of await selectIn(query, "SELECT tabname, tabclass FROM dd02l", "tabname", names))
      types.set(up(row.TABNAME), { kind: "TABL", name: up(row.TABNAME), tabclass: row.TABCLASS, fields: [] });
    const tables = names.filter(name => types.has(name));
    for (const row of await selectIn(query, "SELECT tabname, fieldname, position, keyflag, rollname, comptype, precfield, " +
        "datatype, leng, decimals, reftype, notnull, adminfield FROM dd03l", "tabname", tables)) {
      const table = types.get(up(row.TABNAME));
      table.fields.push(row);
    }
    for (const tableName of tables) {
      const table = types.get(tableName);
      normalizeTableFields(table);
      for (const row of table.fields) {
        const field = up(row.FIELDNAME), comptype = up(row.COMPTYPE);
        if (field === ".INCLUDE" || field.startsWith(".INCLU-") || field === ".APPEND") need(row.PRECFIELD, table.name);
        else if (["E", "S", "L"].includes(comptype)) need(row.ROLLNAME, table.name);
        else if (comptype === "R" && ["E", "S", "L"].includes(up(row.REFTYPE))) need(row.ROLLNAME, table.name);
      }
    }
    const rest = names.filter(name => !types.has(name));
    for (const row of await selectIn(query, "SELECT rollname, domname, datatype, leng, decimals, refkind, reftype FROM dd04l", "rollname", rest)) {
      const element = { kind: "DTEL", name: up(row.ROLLNAME), row };
      types.set(element.name, element);
      if (up(row.REFKIND) === "D") need(row.DOMNAME, element.name, "domain");
      else if (up(row.REFKIND) === "R" && ["E", "S", "L"].includes(up(row.REFTYPE))) need(row.DOMNAME, element.name);
    }
    const left = rest.filter(name => !types.has(name));
    for (const row of await selectIn(query, "SELECT typename, rowtype, rowkind, datatype, leng, decimals, accessmode, keydef FROM dd40l", "typename", left)) {
      const type = { kind: "TTYP", name: up(row.TYPENAME), row };
      types.set(type.name, type);
      if (["E", "S", "L"].includes(up(row.ROWKIND))) need(row.ROWTYPE, type.name);
    }
    const tableTypes = left.filter(name => types.get(name)?.kind === "TTYP");
    for (const row of await selectIn(query, "SELECT typename, seckeyname, keyfdpos, keyfield FROM dd42s", "typename", tableTypes))
      (types.get(up(row.TYPENAME)).keys ||= []).push(row);
    for (const row of await selectIn(query, "SELECT domname, datatype, leng, decimals FROM dd01l", "domname", domainNames))
      domains.set(up(row.DOMNAME), { kind: "DOMA", name: up(row.DOMNAME), row });
  }
  const missing = required.filter(([name, kind]) => !(kind === "domain" ? domains : types).has(name));
  if (missing.length) throw new Error("The dictionary has no " + [...new Set(missing.map(([name, kind, by]) =>
    (kind === "domain" ? "domain " : "") + name + " (used by " + by + ")"))].join(", ") + ".");
  for (const table of types.values()) if (table.kind === "TABL") table.fields.sort((a, b) => Number(a.POSITION) - Number(b.POSITION));
  return [...types.values(), ...domains.values()];
}

const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (name, value) => value === undefined || value === null || String(value) === "" ? "" : "<" + name + ">" + escape(value) + "</" + name + ">";
const number = value => String(Number(value || 0)).padStart(6, "0");
// ABAP Dictionary names D16N/D34N as the numeric decimal float types. The
// bundled abaplint DDIC reader recognizes their ABAP names instead.
const transpilerDatatype = value => ({ D16N: "DECFLOAT16", D34N: "DECFLOAT34" })[up(value)] || value;
const wrap = (serializer, body) => `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>${body}</asx:values></asx:abap></abapGit>\n`;

/* One object as abapGit's XML, with its file name. */
function objectXml(object) {
  const base = object.name.toLowerCase().replace(/\//g, "#");
  if (object.kind === "TABL") {
    const fields = object.fields.map(field => {
      const name = up(field.FIELDNAME);
      return "<DD03P>" + tag("FIELDNAME", name === ".APPEND" ? ".INCLU--AP" : name) + tag("KEYFLAG", field.KEYFLAG) +
        tag("ROLLNAME", field.ROLLNAME) + tag("PRECFIELD", field.PRECFIELD) + tag("NOTNULL", field.NOTNULL) +
        tag("DATATYPE", transpilerDatatype(field.DATATYPE)) + (Number(field.LENG) ? tag("LENG", number(field.LENG)) : "") +
        (field.DECIMALS && Number(field.DECIMALS) ? tag("DECIMALS", number(field.DECIMALS)) : "") +
        tag("COMPTYPE", field.COMPTYPE) + tag("REFTYPE", field.REFTYPE) + "</DD03P>";
    }).join("");
    return { file: base + ".tabl.xml", xml: wrap("LCL_OBJECT_TABL", "<DD02V>" + tag("TABNAME", object.name) +
      tag("TABCLASS", object.tabclass) + "</DD02V><DD03P_TABLE>" + fields + "</DD03P_TABLE>") };
  }
  const row = object.row;
  if (object.kind === "DTEL") return { file: base + ".dtel.xml", xml: wrap("LCL_OBJECT_DTEL", "<DD04V>" + tag("ROLLNAME", object.name) +
    tag("DOMNAME", row.DOMNAME) + tag("DATATYPE", transpilerDatatype(row.DATATYPE)) + tag("LENG", number(row.LENG)) +
    (Number(row.DECIMALS) ? tag("DECIMALS", number(row.DECIMALS)) : "") + tag("REFKIND", row.REFKIND) + tag("REFTYPE", row.REFTYPE) + "</DD04V>") };
  if (object.kind === "DOMA") return { file: base + ".doma.xml", xml: wrap("LCL_OBJECT_DOMA", "<DD01V>" + tag("DOMNAME", object.name) +
    tag("DATATYPE", transpilerDatatype(row.DATATYPE)) + tag("LENG", number(row.LENG)) + (Number(row.DECIMALS) ? tag("DECIMALS", number(row.DECIMALS)) : "") + "</DD01V>") };
  const keys = (object.keys || []).sort((a, b) => Number(a.KEYFDPOS) - Number(b.KEYFDPOS))
    .map(key => "<DD42V>" + tag("SECKEYNAME", key.SECKEYNAME) + tag("KEYFIELD", key.KEYFIELD) + "</DD42V>").join("");
  return { file: base + ".ttyp.xml", xml: wrap("LCL_OBJECT_TTYP", "<DD40V>" + tag("TYPENAME", object.name) + tag("ROWTYPE", row.ROWTYPE) +
    tag("ROWKIND", row.ROWKIND) + tag("DATATYPE", row.DATATYPE) + (Number(row.LENG) ? tag("LENG", number(row.LENG)) : "") +
    (Number(row.DECIMALS) ? tag("DECIMALS", number(row.DECIMALS)) : "") + tag("ACCESSMODE", row.ACCESSMODE) + tag("KEYDEF", row.KEYDEF) +
    "</DD40V>" + (keys ? "<DD42V>" + keys + "</DD42V>" : "")) };
}

/* The DDIC names the run takes from open-abap-core, which goes with it whole: its tables and structures, data elements,
   domains and table types. */
function coreNames(core = path.join(__dirname, "vendor", "open-abap-core", "src")) {
  const names = new Set(), domains = new Set();
  names.domains = domains;
  const visit = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) visit(path.join(dir, item.name));
    else {
      const found = /^(.+)\.(tabl|dtel|doma|ttyp)\.xml$/i.exec(item.name);
      if (found) { const name = found[1].toUpperCase().replace(/#/g, "/"); names.add(name); if (found[2].toLowerCase() === "doma") domains.add(name); }
    }
  } };
  if (fs.existsSync(core)) visit(core);
  return names;
}

module.exports = { dictionaryNames, declaredTypes, readDictionary, normalizeTableFields, objectXml, coreNames };
