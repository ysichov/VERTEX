"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { dictionaryNames, readDictionary, objectXml, coreNames } = require("../sap-ddic");
const { writeProject } = require("../sap-transpile");
const { launch } = require("../local-run");

const field = (table, name, position, rollname, comptype, datatype, leng, decimals = 0, extra = {}) => ({ TABNAME: table,
  FIELDNAME: name, POSITION: String(position).padStart(4, "0"), KEYFLAG: position === 1 ? "X" : "", ROLLNAME: rollname,
  COMPTYPE: comptype, PRECFIELD: "", DATATYPE: datatype, LENG: String(leng).padStart(6, "0"),
  DECIMALS: String(decimals).padStart(6, "0"), REFTYPE: "", NOTNULL: "", ...extra });
// A dictionary as SAP's DD tables hold it: a table with an include, a structure, a data element named as its domain.
const dictionary = {
  DD02L: [{ TABNAME: "ZSHIP", TABCLASS: "TRANSP" }, { TABNAME: "ZSHIP_INC", TABCLASS: "INTTAB" }],
  DD03L: [field("ZSHIP", "ID", 1, "ZCHAR7", "E", "CHAR", 7), field("ZSHIP", "WEIGHT", 2, "", "", "DEC", 17, 3),
    field("ZSHIP", ".INCLUDE", 3, "", "", "", 0, 0, { PRECFIELD: "ZSHIP_INC" }),
    field("ZSHIP_INC", "COUNTRY", 1, "ZLAND", "E", "CHAR", 3)],
  DD04L: [{ ROLLNAME: "ZCHAR7", DOMNAME: "ZCHAR7", DATATYPE: "CHAR", LENG: "000007", DECIMALS: "000000", REFKIND: "D", REFTYPE: "" },
    { ROLLNAME: "ZLAND", DOMNAME: "ZLAND_D", DATATYPE: "CHAR", LENG: "000003", DECIMALS: "000000", REFKIND: "D", REFTYPE: "" }],
  DD40L: [{ TYPENAME: "ZSHIP_TT", ROWTYPE: "ZSHIP", ROWKIND: "S", DATATYPE: "", LENG: "000000", DECIMALS: "000000", ACCESSMODE: "T", KEYDEF: "D" }],
  DD42S: [],
  DD01L: [{ DOMNAME: "ZCHAR7", DATATYPE: "CHAR", LENG: "000007", DECIMALS: "000000" },
    { DOMNAME: "ZLAND_D", DATATYPE: "CHAR", LENG: "000003", DECIMALS: "000000" }]
};
const queryOf = rows => {
  const asked = [];
  const query = async sql => {
    const found = /FROM (\w+) WHERE (\w+) IN \(([^)]*)\) AND as4local = 'A'/i.exec(sql);
    assert.ok(found, sql);
    const names = found[3].split(",").map(name => name.trim().replace(/'/g, ""));
    asked.push(found[1].toUpperCase() + ":" + names.join(","));
    return { values: (rows[found[1].toUpperCase()] || []).filter(row => names.includes(row[found[2].toUpperCase()])) };
  };
  return { query, asked };
};

test("names a source takes from the dictionary", () => {
  const names = dictionaryNames("DATA a TYPE zship.\nDATA t TYPE STANDARD TABLE OF zrow WITH EMPTY KEY.\nDATA r TYPE REF TO zcl_x.\n" +
    "DATA c TYPE char12.\nDATA f TYPE zs-field.\nSELECT * FROM ztab INNER JOIN zj ON a = b INTO TABLE @t.\n" +
    "DATA x TYPE zcl_y=>ty.\nDATA i TYPE i.\nDATA date LIKE tcurr-gdatu.\nTYPES ty TYPE RANGE OF zr.\nTYPES BEGIN OF s.\nINCLUDE STRUCTURE zinc.\nTYPES END OF s.\n");
  assert.deepEqual([...names].sort(), ["CHAR12", "TCURR", "ZCL_X", "ZINC", "ZJ", "ZR", "ZROW", "ZS", "ZSHIP", "ZTAB"]);
});

test("FROM and JOIN name a table only in Open SQL; TABLES only as its own statement", () => {
  const names = dictionaryNames("SUBTRACT 1 FROM b.\nDELETE itab FROM idx.\nTABLES t001.\nOPEN CURSOR @c FOR SELECT * FROM t005.\n"
    + "DATA(x) = 1. SELECT SINGLE f FROM zsel INTO @DATA(v).");
  assert.deepEqual([...names].sort(), ["T001", "T005", "ZSEL"]);
});

test("reads the closure: an include, a table type, data elements and domains of the same name", async () => {
  const { query, asked } = queryOf(dictionary);
  const objects = await readDictionary(query, new Set(["ZSHIP_TT", "TY_LOCAL"]), new Set(["MANDT"]));
  assert.deepEqual(objects.map(o => o.kind + " " + o.name).sort(),
    ["DOMA ZCHAR7", "DOMA ZLAND_D", "DTEL ZCHAR7", "DTEL ZLAND", "TABL ZSHIP", "TABL ZSHIP_INC", "TTYP ZSHIP_TT"]);
  assert.ok(asked.some(line => line.startsWith("DD01L:") && line.includes("ZCHAR7")), "the domain named as its data element is read");
});

test("a definition's missing dependency stops the run; a source's unknown name does not", async () => {
  const broken = { ...dictionary, DD04L: dictionary.DD04L.filter(row => row.ROLLNAME !== "ZLAND") };
  await assert.rejects(readDictionary(queryOf(broken).query, new Set(["ZSHIP"])), /The dictionary has no ZLAND \(used by ZSHIP_INC\)/);
  assert.deepEqual(await readDictionary(queryOf(dictionary).query, new Set(["TY_LOCAL"])), []);
});

test("SAP include and append components are not emitted twice in a structure", async () => {
  const rows = { DD02L: [{ TABNAME: "ZVTBKOND", TABCLASS: "INTTAB" },
    { TABNAME: "ZVTBKOND_GP_CMLCHN", TABCLASS: "INTTAB" },
    { TABNAME: "ZSCSTFACD", TABCLASS: "INTTAB" }, { TABNAME: "ZTFACD", TABCLASS: "INTTAB" }],
  DD03L: [field("ZVTBKOND", "BASE", 155, "", "", "CHAR", 1),
    field("ZVTBKOND", ".INCLU--AP", 156, "", "S", "", 0, 0, { PRECFIELD: "ZVTBKOND_GP_CMLCHN" }),
    field("ZVTBKOND", "GPDAYS", 157, "ZNUM2", "E", "NUMC", 2, 0, { ADMINFIELD: "1" }),
    field("ZVTBKOND_GP_CMLCHN", "GPDAYS", 1, "ZNUM2", "E", "NUMC", 2),
    field("ZVTBKOND_MNT", ".INCLU--AP", 157, "", "S", "", 0, 0, { PRECFIELD: "ZVTBKOND_GP_CMLCHN", ADMINFIELD: "1" }),
    field("ZVTBKOND_MNT", "GPDAYS", 158, "ZNUM2", "E", "NUMC", 2, 0, { ADMINFIELD: "2" }),
    field("ZSCSTFACD", ".INCLUDE", 1, "", "S", "", 0, 0, { PRECFIELD: "ZTFACD" }),
    field("ZSCSTFACD", "IDENT", 2, "ZIDENT", "E", "CHAR", 1, 0, { ADMINFIELD: "1" }),
    field("ZTFACD", "IDENT", 1, "ZIDENT", "E", "CHAR", 1)],
  DD04L: [{ ROLLNAME: "ZNUM2", DOMNAME: "ZNUM2", DATATYPE: "NUMC", LENG: "000002", DECIMALS: "000000", REFKIND: "D", REFTYPE: "" },
    { ROLLNAME: "ZIDENT", DOMNAME: "ZIDENT", DATATYPE: "CHAR", LENG: "000001", DECIMALS: "000000", REFKIND: "D", REFTYPE: "" }],
  DD01L: [{ DOMNAME: "ZNUM2", DATATYPE: "NUMC", LENG: "000002", DECIMALS: "000000" },
    { DOMNAME: "ZIDENT", DATATYPE: "CHAR", LENG: "000001", DECIMALS: "000000" }] };
  rows.DD02L.push({ TABNAME: "ZVTBKOND_MNT", TABCLASS: "INTTAB" });
  const objects = await readDictionary(queryOf(rows).query, new Set(["ZVTBKOND", "ZSCSTFACD", "ZVTBKOND_MNT"]));
  const parent = objects.find(object => object.name === "ZVTBKOND");
  assert.deepEqual(parent.fields.map(row => row.FIELDNAME), ["BASE", "GPDAYS"]);
  assert.doesNotMatch(objectXml(parent).xml, /<PRECFIELD>ZVTBKOND_GP_CMLCHN<\/PRECFIELD>/);
  const calendar = objects.find(object => object.name === "ZSCSTFACD");
  assert.deepEqual(calendar.fields.map(row => row.FIELDNAME), ["IDENT"]);
  assert.deepEqual(objects.find(object => object.name === "ZVTBKOND_MNT").fields.map(row => row.FIELDNAME), ["GPDAYS"]);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-append-"));
  try {
    const file = writeProject("TEST", [{ name: "ZAPPEND", type: "PROG", include: "main",
      text: "REPORT zappend.\nDATA ls TYPE zvtbkond.\nDATA lc TYPE zscstfacd.\nls-gpdays = '12'.\n" +
        "lc-ident = 'X'.\nWRITE: ls-gpdays, lc-ident.\n" }], objects, folder);
    const document = { uri: { scheme: "file", fsPath: file }, getText: () => fs.readFileSync(file, "utf8") };
    let log = "";
    const vscode = { workspace: { getWorkspaceFolder: () => undefined },
      window: { createOutputChannel: () => ({ append: t => { log += t; }, appendLine: t => { log += t + "\n"; }, hide() {}, show() {} }) } };
    const result = await launch(vscode, false, { document, selection: {}, trace: true })
      .catch(error => { throw new Error(error.message + "\n" + log); });
    assert.match(result.output, /12/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("abapGit XML of the objects", async () => {
  const objects = await readDictionary(queryOf(dictionary).query, new Set(["ZSHIP_TT"]));
  const table = objectXml(objects.find(o => o.name === "ZSHIP"));
  assert.equal(table.file, "zship.tabl.xml");
  assert.match(table.xml, /<DD02V><TABNAME>ZSHIP<\/TABNAME><TABCLASS>TRANSP<\/TABCLASS><\/DD02V>/);
  assert.match(table.xml, /<DD03P><FIELDNAME>.INCLUDE<\/FIELDNAME><PRECFIELD>ZSHIP_INC<\/PRECFIELD><\/DD03P>/);
  assert.match(table.xml, /<FIELDNAME>WEIGHT<\/FIELDNAME><DATATYPE>DEC<\/DATATYPE><LENG>000017<\/LENG><DECIMALS>000003<\/DECIMALS>/);
  assert.equal(objectXml(objects.find(o => o.kind === "DOMA" && o.name === "ZCHAR7")).file, "zchar7.doma.xml");
  assert.ok(coreNames().has("MANDT"));
});

test("SAP decimal float dictionary types use names understood by the transpiler", () => {
  const field = { FIELDNAME: "AMOUNT", DATATYPE: "D34N", LENG: "000034" };
  const xml = objectXml({ kind: "TABL", name: "ZFLOAT", tabclass: "INTTAB", fields: [field] }).xml;
  assert.match(xml, /<DATATYPE>DECFLOAT34<\/DATATYPE>/);
  assert.equal(field.DATATYPE, "D34N", "the SAP snapshot stays as read");
});

test("a saved type group supplies types to an offline program", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-typepool-"));
  try {
    const file = writeProject("TEST", [
      { name: "ZPOOLRUN", type: "PROG", include: "main", text: "REPORT zpoolrun.\nTYPE-POOLS ztp.\nDATA number TYPE ztp_n.\nnumber = '42'.\nWRITE number.\n" },
      { name: "ZTP", type: "TYPE", include: "main", text: "TYPE-POOL ztp.\nTYPES ztp_n TYPE n LENGTH 2.\n" }
    ], [], folder);
    const document = { uri: { scheme: "file", fsPath: file }, getText: () => fs.readFileSync(file, "utf8") };
    const vscode = { workspace: { getWorkspaceFolder: () => undefined },
      window: { createOutputChannel: () => ({ append() {}, appendLine() {}, hide() {}, show() {} }) } };
    const result = await launch(vscode, false, { document, selection: {}, trace: true });
    assert.match(result.output, /42/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a program typed by the dictionary transpiles and runs", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-ddic-"));
  try {
    const objects = await readDictionary(queryOf(dictionary).query, new Set(["ZSHIP_TT"]));
    const file = writeProject("TEST", [{ name: "ZDDIC", type: "PROG", include: "main", text: "REPORT zddic.\n" +
      "DATA lt TYPE zship_tt.\nDATA ls TYPE zship.\nls-id = 'ABCDEFGHIJ'.\nls-country = 'DEU'.\nls-weight = '1.5'.\n" +
      "APPEND ls TO lt.\nWRITE: / ls-id, ls-country, lines( lt ).\n" }], objects, folder);
    const document = { uri: { scheme: "file", fsPath: file }, getText: () => fs.readFileSync(file, "utf8") };
    let log = "";
    const vscode = { workspace: { getWorkspaceFolder: () => undefined },
      window: { createOutputChannel: () => ({ append: t => { log += t; }, appendLine: t => { log += t + "\n"; }, hide() {}, show() {} }) } };
    const result = await launch(vscode, false, { document, selection: {}, trace: true })
      .catch(error => { throw new Error(error.message + "\n" + log); });
    // ID is CHAR 7 by its data element and domain, so the value is cut as SAP cuts it.
    assert.match(result.output, /^ABCDEFG\s*DEU\s*1\b/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("a step records the SY fields and the SELECTs of the statement before it", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-sap-sql-"));
  const run = require("../local-run");
  const asked = [];
  run.setSelectorQuery(async sql => { asked.push(sql); return { values: [{ ID: "A1", WEIGHT: "2.000", COUNTRY: "DEU" }] }; });
  try {
    const objects = await readDictionary(queryOf(dictionary).query, new Set(["ZSHIP"]));
    const file = writeProject("TEST", [{ name: "ZSQL", type: "PROG", include: "main", text: "REPORT zsql.\n" +
      "DATA lt TYPE STANDARD TABLE OF zship WITH EMPTY KEY.\nDATA lv TYPE i.\nSELECT * FROM zship INTO TABLE @lt.\n" +
      "lv = lines( lt ).\nREAD TABLE lt TRANSPORTING NO FIELDS WITH KEY id = 'ZZ'.\nlv = 2.\nWRITE / lv.\n" }], objects, folder);
    const document = { uri: { scheme: "file", fsPath: file }, getText: () => fs.readFileSync(file, "utf8") };
    let log = "";
    const vscode = { workspace: { getWorkspaceFolder: () => undefined },
      window: { createOutputChannel: () => ({ append: t => { log += t; }, appendLine: t => { log += t + "\n"; }, hide() {}, show() {} }) } };
    const result = await launch(vscode, false, { document, selection: {}, trace: true })
      .catch(error => { throw new Error(error.message + "\n" + log); });
    assert.equal(asked.length, 1);
    const after = result.records.find(r => r.line === 5);
    assert.ok(after && after.sql && after.sql[0].rows === 1 && /zship/i.test(after.sql[0].select), "the SELECT shows at the next step");
    const read = result.records.find(r => r.line === 7);
    assert.equal(read && read.sy && read.sy.SUBRC, 4, "READ TABLE without a hit set SY-SUBRC 4");
  } finally { run.setSelectorQuery(undefined); fs.rmSync(folder, { recursive: true, force: true }); }
});

test("the types a source declares with TYPES are its own, not its components", () => {
  const { declaredTypes } = require("../sap-ddic");
  const names = declaredTypes("INTERFACE zif_t PUBLIC.\n  TYPES: BEGIN OF ty_step, step_no TYPE zlog_pipeline-step_no, matnr TYPE matnr, END OF ty_step,\n"
    + "    tt_steps TYPE STANDARD TABLE OF ty_step WITH EMPTY KEY.\n  TYPES ty_amount TYPE p LENGTH 15 DECIMALS 2.\n  DATA lv TYPE matnr.\nENDINTERFACE.");
  assert.deepEqual([...names], ["TY_STEP", "TT_STEPS", "TY_AMOUNT"]);
  const split = declaredTypes("TYPES: BEGIN OF ty_record.\n INCLUDE TYPE ty_base.\n TYPES: component TYPE zfield,\n END OF ty_record.\n TYPES ty_next TYPE c.");
  assert.deepEqual([...split], ["TY_RECORD", "TY_NEXT"]);
});

test("table type key components are read from DD42S", async () => {
  const rows = { ...dictionary, DD40L: [{ ...dictionary.DD40L[0], KEYDEF: "K" }],
    DD42S: [{ TYPENAME: "ZSHIP_TT", SECKEYNAME: "", KEYFDPOS: "0001", KEYFIELD: "ID" }] };
  const objects = await readDictionary(queryOf(rows).query, new Set(["ZSHIP_TT"]));
  const tableType = objects.find(object => object.name === "ZSHIP_TT");
  assert.deepEqual(tableType.keys.map(key => key.KEYFIELD), ["ID"]);
  assert.match(objectXml(tableType).xml, /<DD42V><DD42V><KEYFIELD>ID<\/KEYFIELD><\/DD42V><\/DD42V>/);
});

test("a domain named as one of open-abap-core's data elements is read from SAP: a data element is no domain", async () => {
  const core = coreNames();
  const coreElementOnly = [...core].find(name => !core.domains.has(name) && name === "BAPI_MSG");
  assert.ok(coreElementOnly, "BAPI_MSG is a data element of open-abap-core with no domain of that name");
  const { query, asked } = queryOf({ DD04L: [{ ROLLNAME: "ZREQUEST_ID", DOMNAME: "BAPI_MSG", DATATYPE: "CHAR", LENG: "000220", DECIMALS: "000000", REFKIND: "D", REFTYPE: "" }],
    DD01L: [{ DOMNAME: "BAPI_MSG", DATATYPE: "CHAR", LENG: "000220", DECIMALS: "000000" }] });
  const objects = await readDictionary(query, new Set(["ZREQUEST_ID"]), core);
  assert.ok(asked.some(a => a.startsWith("DD01L:") && a.includes("BAPI_MSG")), asked.join(" | "));
  assert.deepEqual(objects.map(o => o.kind + " " + o.name).sort(), ["DOMA BAPI_MSG", "DTEL ZREQUEST_ID"]);
});
