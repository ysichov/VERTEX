"use strict";
// Run a saved vertex-read.json through the local transpiler, without SAP or VS Code.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collect, writeProject, copyPath } = require("../sap-transpile");
const { normalizeTableFields } = require("../sap-ddic");
const { moduleSignature } = require("../sap-fugr");
const { projectFor, transpile, launch } = require("../local-run");

async function main() {
  const saved = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  if (process.env.VERTEX_OFFLINE_DDIC_JSON) saved.dictionary.push(...JSON.parse(fs.readFileSync(process.env.VERTEX_OFFLINE_DDIC_JSON, "utf8")));
  const rootName = path.basename(path.dirname(process.argv[2])).replace(/^FUNC-/, "");
  if (rootName === "FIMA_DAYS_BETWEEN_TWO_DATES" && process.env.VERTEX_OFFLINE_EXTRA_FM
      && !saved.sources.some(source => source.include === "FIMA_INTEREST_METHOD_CONVERT")) {
    const constants = saved.sources.find(source => source.include === "FIMA_CONSTANTS");
    const text = fs.readFileSync(process.env.VERTEX_OFFLINE_EXTRA_FM, "utf8");
    saved.sources.push({ name: "FF05", type: "FUGR", include: "SAPLFF05", kind: "main", text: "INCLUDE LFF05TOP." },
      { name: "FF05", type: "FUGR", include: "LFF05TOP", kind: "include", text: "FUNCTION-POOL FF05.\nINCLUDE FIMA_CONSTANTS." },
      { name: "FF05", type: "FUGR", include: "FIMA_CONSTANTS", kind: "include", text: constants.text },
      { name: "FF05", type: "FUGR", include: "FIMA_INTEREST_METHOD_CONVERT", kind: "module", text });
  }
  for (const source of saved.sources) if (source.type === "FUGR" && source.kind === "module")
    source.signature = moduleSignature(source.text);
  const folder = fs.mkdtempSync(path.join(process.env.VERTEX_OFFLINE_KEEP ? __dirname : os.tmpdir(), "vertex-offline-sap-"));
  try {
    for (const item of saved.dictionary) if (item.kind === "TABL") normalizeTableFields(item);
    // The captured fixture predates DD42S support; this key was read from ALC.
    const styleTable = saved.dictionary.find(item => item.name === "LVC_T_STYL" && item.kind === "TTYP");
    if (styleTable && !styleTable.keys?.length) styleTable.keys = [{ TYPENAME: "LVC_T_STYL", KEYFDPOS: "0001",
      SECKEYNAME: "", KEYFIELD: "FIELDNAME" }];
    // The captured fixture predates LIKE table-field discovery. TCURR-GDATU
    // was confirmed against ALC and is enough to expose later runtime faults.
    if (!saved.dictionary.some(item => item.name === "TCURR")) saved.dictionary.push({ kind: "TABL", name: "TCURR", tabclass: "TRANSP",
      fields: [{ TABNAME: "TCURR", FIELDNAME: "GDATU", POSITION: "0005", DATATYPE: "CHAR", LENG: "000008",
        DECIMALS: "000000", KEYFLAG: "X", ROLLNAME: "", COMPTYPE: "", PRECFIELD: "", REFTYPE: "", NOTNULL: "X" }] });
    if (!saved.dictionary.some(item => item.name === "SKONDGRP" && item.kind === "DTEL")) {
      const row = saved.dictionary.find(item => item.name === "SKONDGRP" && item.kind === "DOMA").row;
      saved.dictionary.push({ kind: "DTEL", name: "SKONDGRP", row: { ROLLNAME: "SKONDGRP", DOMNAME: "SKONDGRP",
        DATATYPE: row.DATATYPE, LENG: row.LENG, DECIMALS: row.DECIMALS, REFKIND: "D", REFTYPE: "" } });
    }
    const moduleGroup = new Map(saved.sources.filter(source => source.type === "FUGR" && source.kind === "module")
      .map(source => [source.include, source.name]));
    const sources = await collect(async ({ object_name, object_type, include }) => {
      const source = saved.sources.find(item => item.name === object_name && item.type === object_type
        && item.include === (include || "main"));
      if (!source) throw new Error(object_type + " " + object_name + " is absent from the saved snapshot.");
      return { object_name, object_type, source: source.text,
        includes: saved.sources.filter(item => item.name === object_name && item.type === object_type
          && item.include !== "main").map(item => item.include) };
    }, { name: rootName, type: "FUNC" }, { groups: {
      of: async module => moduleGroup.get(module),
      read: async group => ({ sources: saved.sources.filter(source => source.type === "FUGR" && source.name === group)
        .map(source => ({ name: source.include, kind: source.kind, text: source.text, signature: source.signature })) })
    } });
    sources.push(...saved.sources.filter(source => source.type === "TYPE"));
    const file = writeProject("ALC", sources, saved.dictionary, path.join(folder, "project"));
    process.stdout.write("Selected: " + sources.map(source => source.include).join(", ") + "\n");
    const project = projectFor({ uri: { scheme: "file", fsPath: file } });
    let log = "";
    await transpile(project, { append: chunk => { log += chunk; } })
      .catch(error => { throw new Error(error.message + "\n" + log.slice(0, 15000)); });
    process.stdout.write("Offline transpilation passed: " + sources.length + " sources, " + saved.dictionary.length + " DDIC objects.\n");
    if (process.argv.includes("--run")) {
      const module = sources.find(source => source.kind === "module" && source.include === rootName);
      const sourceFile = copyPath(path.join(folder, "project"), module);
      const document = { uri: { scheme: "file", fsPath: sourceFile }, getText: () => fs.readFileSync(sourceFile, "utf8") };
      const vscode = { workspace: { getWorkspaceFolder: () => undefined },
        window: { createOutputChannel: () => ({ append: chunk => { log += chunk; },
          appendLine: chunk => { log += chunk + "\n"; }, hide() {}, show() {} }) } };
      const parameters = rootName === "FIMA_DAYS_BETWEEN_TWO_DATES"
        ? { I_DATUM_VON: "20260115", I_DATUM_BIS: "20271002" }
        : rootName === "FIMA_DAYS_BETWEEN_TWO_DATES_2" ? { I_DATUM_VON: "20260202", I_DATUM_BIS: "20260303" }
        : rootName === "FIMA_END_OF_MONTH_DETERMINE" ? { I_DATE: "20160210" }
          : { I_DATE_FROM: "20260115", I_DATE_TO: "20271002" };
      const result = await launch(vscode, false, { document, entryLine: module.signature.firstLine,
        selection: { $entry: { parameters } }, trace: !process.env.VERTEX_OFFLINE_LIVE,
        live: !!process.env.VERTEX_OFFLINE_LIVE })
        .catch(error => { throw new Error(error.message + "\n" + log.slice(-15000)); });
      if (result.live) {
        const next = await result.live.next("continue");
        result.records.push(...next.records);
        result.ended = next.ended;
        result.output = result.live.output;
      }
      process.stdout.write("Offline run ended: " + result.ended + "; output: " + String(result.output || "").slice(0, 1200) + "\n");
      if (process.env.VERTEX_OFFLINE_TRACE) process.stdout.write("Trace: " + JSON.stringify(result.records?.map(record => ({
        owner: record.owner, line: record.line, changed: record.changed })).slice(0, 100)).slice(0, 7000) + "\n");
    }
  } finally {
    if (process.env.VERTEX_OFFLINE_KEEP) process.stdout.write("Offline project: " + folder + "\n");
    else fs.rmSync(folder, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
