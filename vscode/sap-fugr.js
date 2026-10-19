"use strict";
/* A function group read from SAP for a transpiler run, laid out as abapGit lays it out: the main program
   (<group>.fugr.sapl<group>.abap), each include it names (<group>.fugr.<include>.abap) - but the generated
   L<group>UXX, which lists the modules, and the modules' own U includes - and each module
   (<group>.fugr.<module>.abap), with <group>.fugr.xml carrying the modules' signatures, where abaplint reads them.
   ADT shows a module with its signature in its FUNCTION statement; the transpiler takes it from the XML, so that
   statement is written as FUNCTION <name>. and the lines it took stay as empty lines: a module's lines are those of
   its VERTEX tab. */
const { tokenize } = require("./value-origin-tokens");

const up = value => String(value || "").toUpperCase();
const SECTIONS = ["IMPORTING", "EXPORTING", "CHANGING", "TABLES", "EXCEPTIONS", "RAISING"];

const adtName = name => encodeURIComponent(String(name).toLowerCase());
const groupUrl = group => "/sap/bc/adt/functions/groups/" + adtName(group);
// SAPL before a group's name, after its namespace: /NS/GRP is /NS/SAPLGRP, its includes /NS/LGRP...
const mainProgram = group => /^\/[^/]+\//.test(group) ? group.replace(/^(\/[^/]+\/)/, "$1SAPL") : "SAPL" + group;
const groupOfProgram = program => up(program).replace(/^(\/[^/]+\/)?SAPL/, "$1");

/* The group a module belongs to, from TFDIR. */
async function groupOf(query, module) {
  const data = await query("SELECT pname FROM tfdir WHERE funcname = '" + up(module).replace(/'/g, "''") + "'", 1);
  const row = (data.values || [])[0];
  const program = row && (row.PNAME || row.pname);
  if (!program) throw new Error("Function module " + up(module) + " was not found in SAP.");
  return groupOfProgram(program);
}

/* The INCLUDE statements of a text: the names, upper case. */
function includesIn(text) {
  const tokens = tokenize(text), names = [];
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1];
    if (up(tokens[i].value) !== "INCLUDE" || !next || next.kind !== "word" || ["TYPE", "STRUCTURE"].includes(up(next.value))) continue;
    if (i > 0 && tokens[i - 1].value !== "." && tokens[i - 1].line === tokens[i].line) continue;
    names.push(up(next.value));
  }
  return names;
}

/* A module's FUNCTION statement read: its name, the lines it spans, and its parameters by section as abapGit's
   RSIMP/RSEXP/RSCHA/RSTBL/RSEXC rows. A module without its signature in that statement is refused. */
function moduleSignature(text) {
  const tokens = tokenize(text);
  const start = tokens.findIndex(token => up(token.value) === "FUNCTION");
  if (start < 0) throw new Error("No FUNCTION statement.");
  let end = start;
  while (tokens[end] && tokens[end].value !== ".") end++;
  if (!tokens[end]) throw new Error("FUNCTION statement without its period.");
  const name = up(tokens[start + 1] && tokens[start + 1].value);
  const parts = { IMPORTING: [], EXPORTING: [], CHANGING: [], TABLES: [], EXCEPTIONS: [], RAISING: [] };
  let section = null;
  for (let i = start + 2; i < end;) {
    const word = up(tokens[i].value);
    if (SECTIONS.includes(word)) { section = word; i++; continue; }
    if (!section) throw new Error(name + ": unexpected " + tokens[i].value + " in its FUNCTION statement.");
    if (section === "EXCEPTIONS" || section === "RAISING") { parts[section].push({ name: word }); i++; continue; }
    const param = { reference: true };
    if ((word === "VALUE" || word === "REFERENCE") && tokens[i + 1] && tokens[i + 1].value === "(") {
      param.reference = word === "REFERENCE"; param.name = up(tokens[i + 2].value); i += 4;
    } else { param.name = word; i++; }
    while (i < end && !SECTIONS.includes(up(tokens[i].value))) {
      const key = up(tokens[i].value);
      if (key === "TYPE" && up(tokens[i + 1]?.value) === "REF" && up(tokens[i + 2]?.value) === "TO") { param.type = up(tokens[i + 3].value); param.refClass = true; i += 4; }
      else if (key === "TYPE") { param.type = up(tokens[i + 1].value); i += 2; }
      else if (key === "LIKE") { param.like = up(tokens[i + 1].value); i += 2; }
      else if (key === "STRUCTURE") { param.structure = up(tokens[i + 1].value); i += 2; }
      else if (key === "DEFAULT") { param.default = tokens[i + 1].value; i += 2; }
      else if (key === "OPTIONAL") { param.optional = true; i++; }
      else break;
    }
    // A type can be named with its component or its owner: TYPE zstruct-field and TYPE zif_x=>ty_y each read as one name.
    while (tokens[i] && (tokens[i].value === "-" || tokens[i].value === "=>") && tokens[i + 1]?.kind === "word" && i < end) {
      const field = up(tokens[i + 1].value), joint = tokens[i].value;
      if (param.type) param.type += joint + field; else if (param.like) param.like += joint + field;
      i += 2;
    }
    // A parameter with a DEFAULT is optional, as SAP has it and abapGit writes it.
    if (param.default !== undefined) param.optional = true;
    parts[section].push(param);
  }
  return { name, firstLine: tokens[start].line, lastLine: tokens[end].line, parts };
}

/* The module's text for the transpiler: FUNCTION <name>. in place of its signature, the lines kept. */
function moduleBody(text, signature) {
  const lines = text.split(/\r?\n/);
  for (let line = signature.firstLine; line <= signature.lastLine; line++) {
    lines[line - 1] = line === signature.firstLine ? "FUNCTION " + signature.name.toLowerCase() + "." : "";
  }
  return lines.join("\n");
}

/* Every source of the group: its main program, its includes (read through ADT, recursively) and its modules. */
/* modules(group), when given, names the group's modules - a system reached through SAP's ADT extension lists them from its
   tree; otherwise TFDIR is asked through the data preview. */
async function readFunctionGroup({ sourceAt, query, modules: listModules }, group, progress = () => {}) {
  group = up(group);
  const base = groupUrl(group), main = mainProgram(group), sources = [], read = new Set();
  progress(group);
  const mainText = await sourceAt(base + "/source/main");
  sources.push({ kind: "main", name: main, text: mainText });
  const queue = includesIn(mainText);
  while (queue.length) {
    const include = queue.shift();
    // The generated list of the modules and the modules' own includes: the modules are read as modules.
    if (read.has(include) || /UXX$/.test(include) || /U\d\d$/.test(include)) continue;
    read.add(include);
    progress(include);
    let text;
    try { text = await sourceAt(base + "/includes/" + adtName(include) + "/source/main"); }
    catch (error) { throw new Error(group + " include " + include + ": " + error.message); }
    sources.push({ kind: "include", name: include, text });
    queue.push(...includesIn(text));
  }
  const modules = listModules ? (await listModules(group)).map(up).sort()
    : ((await query("SELECT funcname FROM tfdir WHERE pname = '" + main.replace(/'/g, "''") + "'", 1000)).values || [])
      .map(row => up(row.FUNCNAME || row.funcname)).filter(Boolean).sort();
  for (const module of modules) {
    progress(module);
    let text;
    try { text = await sourceAt(base + "/fmodules/" + adtName(module) + "/source/main"); }
    catch (error) { throw new Error(module + ": " + error.message); }
    const signature = moduleSignature(text);
    if (signature.name !== module) throw new Error(module + ": its source names " + signature.name + ".");
    sources.push({ kind: "module", name: module, text, signature });
  }
  return { group, sources };
}

const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (name, value) => value === undefined || value === null || value === "" ? "" : "<" + name + ">" + escape(value) + "</" + name + ">";

/* The parameters of a module of a local function group, from the <group>.fugr.xml beside its <group>.fugr.<module>.abap:
   abapGit keeps a module's interface there, not in its source. [] when the file is no module or no XML is beside it. */
function moduleParameters(file) {
  const path = require("path"), base = path.basename(file);
  const m = /^(.+?)\.fugr\.(.+)\.abap$/i.exec(base);
  if (!m) return [];
  const xmlFile = path.join(path.dirname(file), m[1] + ".fugr.xml");
  let text;
  try { text = require("fs").readFileSync(xmlFile, "utf8"); } catch (_) { return []; }
  const xml = require("abap-adt-api/build/utilities");
  const values = xml.xmlNode(xml.fullParse(text), "abapGit", "asx:abap", "asx:values") || {};
  const items = [].concat((values.FUNCTIONS || {}).item || []);
  const module = items.find(item => String(item.FUNCNAME || "").toUpperCase() === m[2].toUpperCase());
  if (!module) return [];
  const rows = (group, row) => [].concat((module[group] || {})[row] || []);
  const typeOf = row => String(row.TYP || row.DBFIELD || row.DBSTRUCT || "");
  return [...rows("IMPORT", "RSIMP").map(r => ({ name: r.PARAMETER, mode: "IMPORTING", type: typeOf(r) })),
    ...rows("EXPORT", "RSEXP").map(r => ({ name: r.PARAMETER, mode: "EXPORTING", type: typeOf(r) })),
    ...rows("CHANGING", "RSCHA").map(r => ({ name: r.PARAMETER, mode: "CHANGING", type: typeOf(r) })),
    ...rows("TABLES", "RSTBL").map(r => ({ name: r.PARAMETER, mode: "TABLES", type: typeOf(r) }))]
    .filter(p => p.name).map(p => ({ ...p, name: String(p.name).toUpperCase(), module: m[2].toUpperCase() }));
}

/* <group>.fugr.xml: the includes and every module's signature, as abapGit writes them. */
function groupXml(group, sources) {
  // A part is named by include in the run's sources, by name as readFunctionGroup returns it.
  const includes = sources.filter(source => source.kind !== "module").map(source => source.include || source.name);
  const rows = (row, param, tableKind) => "<" + row + ">" + tag("PARAMETER", param.name) +
    (tableKind ? tag("DBSTRUCT", param.structure) : tag("DBFIELD", param.like)) + tag("DEFAULT", param.default) +
    tag("OPTIONAL", param.optional ? "X" : "") + tag("REFERENCE", param.reference && !tableKind ? "X" : "") +
    tag("REF_CLASS", param.refClass ? "X" : "") + tag("TYP", param.type) + "</" + row + ">";
  const modules = sources.filter(source => source.kind === "module").map(({ signature: { name, parts } }) => "<item>" +
    tag("FUNCNAME", name) + tag("SHORT_TEXT", name) +
    (parts.IMPORTING.length ? "<IMPORT>" + parts.IMPORTING.map(p => rows("RSIMP", p)).join("") + "</IMPORT>" : "") +
    (parts.CHANGING.length ? "<CHANGING>" + parts.CHANGING.map(p => rows("RSCHA", p)).join("") + "</CHANGING>" : "") +
    (parts.EXPORTING.length ? "<EXPORT>" + parts.EXPORTING.map(p => rows("RSEXP", p)).join("") + "</EXPORT>" : "") +
    (parts.TABLES.length ? "<TABLES>" + parts.TABLES.map(p => rows("RSTBL", p, true)).join("") + "</TABLES>" : "") +
    (parts.EXCEPTIONS.length ? "<EXCEPTION>" + parts.EXCEPTIONS.map(p => "<RSEXC>" + tag("EXCEPTION", p.name) + "</RSEXC>").join("") + "</EXCEPTION>" : "") +
    "</item>").join("");
  return `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_FUGR" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>` +
    tag("AREAT", group) + "<INCLUDES>" + includes.map(name => tag("SOBJ_NAME", name)).join("") + "</INCLUDES>" +
    "<FUNCTIONS>" + modules + "</FUNCTIONS></asx:values></asx:abap></abapGit>\n";
}

/* The transpiler leaves a module's DEFAULT unset (its own "todo, set DEFAULT value"): an optional parameter not passed
   is initial. After transpiling, each such parameter is given its DEFAULT where the generated module creates it, on
   the same line, so the map's lines still hold. A DEFAULT that is no literal cannot be given and stops the run.
   defaults: [{ module, params: [{ name, default }] }], from writeProject. */
function applyModuleDefaults(outputRoot, defaults) {
  const fs = require("fs"), path = require("path");
  const files = [];
  const visit = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, item.name);
    if (item.isDirectory()) { if (item.name !== "node_modules") visit(at); }
    else if (/\.fugr\.mjs$/i.test(item.name)) files.push(at);
  } };
  visit(outputRoot);
  const value = (module, param) => {
    const text = String(param.default).trim();
    if (/^SPACE$/i.test(text)) return JSON.stringify(" ");
    if (/^-?\d+$/.test(text)) return text;
    const quoted = /^'((?:[^']|'')*)'$/.exec(text) || /^`((?:[^`]|``)*)`$/.exec(text);
    if (quoted) return JSON.stringify(quoted[1].replace(/''/g, "'").replace(/``/g, "`"));
    throw new Error(module + " parameter " + param.name + ": its DEFAULT " + text + " is no literal, and the transpiler cannot give it.");
  };
  for (const { module, params } of defaults) {
    if (!params.length) continue;
    const file = files.find(candidate => fs.readFileSync(candidate, "utf8").includes("abap.FunctionModules['" + module + "']"));
    if (!file) throw new Error("The transpiler wrote no code for function module " + module + ".");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const start = lines.findIndex(line => line.startsWith("async function " + module.toLowerCase().replace(/\//g, "$") + "(INPUT)"));
    if (start < 0) throw new Error("Function module " + module + " was not found in its generated code.");
    for (const param of params) {
      const name = param.name.toLowerCase();
      let at = -1;
      for (let i = start; i < lines.length && !/^}/.test(lines[i]); i++) {
        if (lines[i].trim() === "if (" + name + " === undefined) {") { at = i + 1; break; }
      }
      if (at < 0 || !new RegExp("^\\s*" + name + " = .*;$").test(lines[at]))
        throw new Error("Function module " + module + ": where parameter " + param.name + " is created was not found in its generated code.");
      lines[at] += " " + name + ".set(" + value(module, param) + ");";
    }
    fs.writeFileSync(file, lines.join("\n"));
  }
}

module.exports = { moduleParameters, applyModuleDefaults, groupOf, includesIn, moduleSignature, moduleBody, readFunctionGroup, groupXml, mainProgram };
