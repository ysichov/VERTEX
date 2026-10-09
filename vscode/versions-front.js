"use strict";

// Versions on the front end: the answer of /sap/bc/adt/vertex/versions/<name> (ZCL_VX_ADT_RES_VERSIONS), built from
// ADT's revision feed - what Eclipse's Revision History shows - and the sources of its revisions, with the diff
// computed here, as Eclipse's compare computes it. Programs, includes and classes; any other type is not this
// module's yet and gets null. A class's sections and methods, which ADT does not version apart, are cut out of the
// versions of the whole class with abaplint; its local includes have feeds of their own.
//
// Same request: part / ptype for one part, from / to for a diff, now=X for the current source, toc / dups / ic as
// AVE's switches. Same JSON: the parts list, the versions of a part, or the diff as ops with its counts.
// The active version keeps AVE's number 99998, so that it sorts first and the page reads it as active.
//
// What the feed does not carry: the task under a request (AVE read it from VRSD) - left empty.

const ACTIVE = "99998";
const NAME = /^[A-Z0-9_/$]{1,40}$/;
const { inLists } = require("./selector-table");

const objectUrl = (type, name) => (type === "INCL" ? "/sap/bc/adt/programs/includes/" : "/sap/bc/adt/programs/programs/")
  + encodeURIComponent(name.toLowerCase());

// The feed's time in the reader's own zone, as the dictionary's date and time look: YYYYMMDD and HHMMSS.
function stamp(iso) {
  const at = new Date(iso);
  if (isNaN(at)) { return { date: "", time: "" }; }
  const two = n => String(n).padStart(2, "0");
  return { date: at.getFullYear() + two(at.getMonth() + 1) + two(at.getDate()),
           time: two(at.getHours()) + two(at.getMinutes()) + two(at.getSeconds()) };
}

// A line as AVE compares it with "ignore case and indentation": trimmed and upper case.
const normal = (line, ignore) => ignore ? line.trim().toUpperCase() : line;

// The line diff: a shortest edit script over whole lines, with nothing on top - '=' kept, '-' from the old version,
// '+' from the new one, '-' before '+' in a run. With ignore set, lines compare trimmed and upper case, so a line
// differing only in its case or indentation is kept, as AVE's IC switch has it; a kept line carries the new text.
// A host with a comparer of its own passes it as api.diffLines - Eclipse hands the lines to its own Text Compare
// (RangeDifferencer); otherwise VERTEX's line-diff.js (Myers) computes it.
async function diff(oldLines, newLines, ignore, api) {
  if (api && api.diffLines) { return api.diffLines(oldLines, newLines, Boolean(ignore)); }
  return require("./line-diff").diffLines(oldLines, newLines, ignore ? line => normal(line, true) : undefined);
}

const lines = text => String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

// A class's main source cut into AVE's parts: the three sections of its definition and each implemented method, by
// line, as abaplint parses the statements. Rows are counted from 0.
function classLayout(text) {
  const lint = require("@abaplint/core");
  const file = new lint.Registry().addFile(new lint.MemoryFile("vertex.clas.abap", text)).parse().getFirstObject()?.getABAPFiles()[0];
  if (!file) { throw new Error("abaplint did not parse the class."); }
  const statements = file.getStatements().filter(s => !["Comment", "Empty"].includes(s.get().constructor.name));
  const layout = { sections: {}, methods: [] };
  const declared = {};
  let section = "", inDefinition = false, method = null;
  const row = s => s.getFirstToken().getRow() - 1, last = s => s.getLastToken().getRow() - 1;
  const methodName = s => (s.findFirstExpression(lint.Expressions.MethodName) || s.getChildren()[1]).concatTokens().toUpperCase();
  for (const s of statements) {
    const kind = s.get().constructor.name;
    if (kind === "ClassDefinition") { inDefinition = true; continue; }
    if (inDefinition && ["Public", "Protected", "Private"].includes(kind)) {
      if (section) { layout.sections[section].to = row(s) - 1; }
      section = kind.toLowerCase();
      layout.sections[section] = { from: row(s), to: row(s), declarations: 0 };
      continue;
    }
    if (inDefinition && kind === "EndClass") {
      if (section) { layout.sections[section].to = row(s) - 1; }
      inDefinition = false; section = "";
      continue;
    }
    if (inDefinition && section) {
      layout.sections[section].declarations++;
      if (kind === "MethodDef") { declared[methodName(s)] = section; }
      continue;
    }
    if (kind === "MethodImplementation") { method = { name: methodName(s), from: row(s) }; continue; }
    if (kind === "EndMethod" && method) { method.to = last(s); layout.methods.push(method); method = null; }
  }
  layout.methods.forEach(m => { m.section = declared[m.name] || ""; });
  return layout;
}

const LOCAL = { CCDEF: "definitions", CCIMP: "implementations", CCMAC: "macros", CCAU: "testclasses" };
const SECTIONS = { CPUB: "public", CPRO: "protected", CPRI: "private" };
const padded = (name, filler) => name + filler.repeat(Math.max(0, 30 - name.length));
const classUrl = name => "/sap/bc/adt/oo/classes/" + encodeURIComponent(name.toLowerCase());

// Sources of revisions, read once per session: a part's history reads every version of its class.
const read = new WeakMap();
function sourceAt(api, uri) {
  if (!read.has(api)) { read.set(api, new Map()); }
  const cache = read.get(api);
  if (!cache.has(uri)) { cache.set(uri, Promise.resolve(api.revisionSource(uri)).catch(error => { cache.delete(uri); throw error; })); }
  return cache.get(uri);
}

const enc = name => encodeURIComponent(name.toLowerCase());
const DDIC = { TABL: "TABD", DOMA: "DOMD", DTEL: "DTED" };
const sqlText = value => "'" + String(value).replace(/'/g, "''") + "'";

// A part of a request or a package, by its own type: a REPS is a program, an include or a function group's main
// program (TRDIR SUBC); a FUNC lives in its group; a class part in its class; a dictionary part in its object.
async function partInScope(api, part, ptype) {
  if (ptype === "REPS") {
    const row = (await api.query("SELECT subc FROM trdir WHERE name = " + sqlText(part), 1)).values[0];
    if (!row) { throw new Error("Program " + part + " does not exist."); }
    if (row.SUBC === "F") {
      const ns = /^(\/[^/]+\/)SAPL(.+)$/.exec(part);
      return partOf(api, "FUGR", ns ? ns[1] + ns[2] : part.replace(/^SAPL/, ""), part, "REPS");
    }
    return partOf(api, row.SUBC === "I" ? "INCL" : "PROG", part, part, "REPS");
  }
  if (ptype === "FUNC") { return partOf(api, "FUNC", part, part, "FUNC"); }
  if (["METH", "CPUB", "CPRO", "CPRI", "CINC"].includes(ptype)) {
    const owner = (ptype === "CINC" ? part.slice(0, 30).replace(/=+$/, "") : part.slice(0, 30).trim()) || part;
    return partOf(api, "CLAS", owner, part, ptype);
  }
  if (ptype === "DDLS") { return partOf(api, "DDLS", part, part, "DDLS"); }
  const ddic = Object.keys(DDIC).find(key => DDIC[key] === ptype);
  return ddic ? partOf(api, ddic, part, part, ptype) : null;
}

// What a request (with its tasks, E071) or a package (TADIR) holds, as AVE lists it: a class, an interface or a
// function group as one object to open; anything else as the part it versions as.
async function scopeParts(api, type, name) {
  let keys;
  if (type === "TR") {
    const head = (await api.query("SELECT trkorr FROM e070 WHERE trkorr = " + sqlText(name), 1)).values;
    if (!head.length) { throw new Error("Transport request " + name + " does not exist."); }
    const tasks = (await api.query("SELECT trkorr FROM e070 WHERE strkorr = " + sqlText(name), 1000)).values.map(r => r.TRKORR);
    keys = await inLists(api, "SELECT pgmid, object, obj_name FROM e071 WHERE trkorr", [name, ...tasks], 10000);
  } else {
    keys = (await api.query("SELECT pgmid, object, obj_name FROM tadir WHERE devclass = " + sqlText(name), 10000)).values;
    if (!keys.length) { throw new Error("Package " + name + " holds nothing or does not exist."); }
  }
  const seen = new Set(), parts = [];
  const add = (unit, partName, partType, owner) => {
    const key = partType + "|" + partName;
    if (seen.has(key)) { return; }
    seen.add(key);
    parts.push({ class: owner || "", unit, name: partName, part_type: partType, section: "" });
  };
  keys.sort((x, y) => (x.PGMID + x.OBJECT + x.OBJ_NAME).localeCompare(y.PGMID + y.OBJECT + y.OBJ_NAME)).forEach(k => {
    const object = String(k.OBJECT), objName = String(k.OBJ_NAME);
    if (k.PGMID === "R3TR" && ["CLAS", "INTF", "FUGR"].includes(object)) { add(objName, objName, object); return; }
    if (object === "PROG" || object === "REPS") { add(objName, objName, "REPS"); return; }
    if (object === "METH") {
      const owner = objName.slice(0, 30).trim(), method = objName.slice(30).trim();
      add(method, padded(owner, " ") + method, "METH", owner);
      return;
    }
    if (DDIC[object]) { add(objName, objName, DDIC[object]); return; }
    add(objName, objName, object);
  });
  return parts;
}
// A function group's main program and include prefix: SAPLZFG and LZFG, /NS/SAPLFG and /NS/LFG in a namespace.
function groupNames(group) {
  const ns = /^(\/[^/]+\/)(.+)$/.exec(group);
  return ns ? { main: ns[1] + "SAPL" + ns[2], prefix: ns[1] + "L" + ns[2] } : { main: "SAPL" + group, prefix: "L" + group };
}
// The group a function module belongs to, from TFDIR through the data preview.
async function groupOf(api, module) {
  const row = (await api.query("SELECT pname FROM tfdir WHERE funcname = '" + module.replace(/'/g, "''") + "'", 1)).values[0];
  if (!row) { throw new Error("Function module " + module + " does not exist."); }
  const pname = String(row.PNAME), ns = /^(\/[^/]+\/)SAPL(.+)$/.exec(pname);
  return ns ? ns[1] + ns[2] : pname.replace(/^SAPL/, "");
}

// Where a part's history is kept and how its text is cut from a version of that feed.
async function partOf(api, type, name, part, ptype) {
  if (type === "PROG" || type === "INCL") {
    if (part !== name || ptype !== "REPS") { return null; }
    return { url: objectUrl(type, name), include: "", cut: null };
  }
  if (type === "INTF") {
    return ptype === "REPS" && part.startsWith(name) ? { url: "/sap/bc/adt/oo/interfaces/" + enc(name), include: "", cut: null } : null;
  }
  if (type === "DDLS") {
    return ptype === "DDLS" && part === name ? { url: "/sap/bc/adt/ddic/ddl/sources/" + enc(name), include: "", cut: null } : null;
  }
  // Dictionary objects, as VRSD names their parts: TABD, DOMD, DTED. A TABL is a table or a structure (DD02L).
  if (DDIC[type]) {
    if (ptype !== DDIC[type] || part !== name) { return null; }
    if (type === "TABL") {
      const row = (await api.query("SELECT tabclass FROM dd02l WHERE tabname = '" + name.replace(/'/g, "''") + "' AND as4local = 'A'", 1)).values[0];
      if (!row) { throw new Error("Table " + name + " does not exist."); }
      return { url: (row.TABCLASS === "INTTAB" ? "/sap/bc/adt/ddic/structures/" : "/sap/bc/adt/ddic/tables/") + enc(name), include: "", cut: null };
    }
    return { url: (type === "DOMA" ? "/sap/bc/adt/ddic/domains/" : "/sap/bc/adt/ddic/dataelements/") + enc(name), include: "", cut: null };
  }
  // A part inside a transport request or a package: its own type says where it lives.
  if (type === "TR" || type === "DEVC") { return partInScope(api, part, ptype); }
  if (type === "FUNC" || type === "FUGR") {
    const group = type === "FUGR" ? name : await groupOf(api, name);
    const base = "/sap/bc/adt/functions/groups/" + enc(group);
    if (ptype === "FUNC") {
      if (type === "FUNC" && part !== name) { return null; }
      if (type === "FUGR" && await groupOf(api, part) !== group) { return null; }
      return { url: base + "/fmodules/" + enc(part), include: "", cut: null };
    }
    if (ptype === "REPS" && type === "FUGR") {
      const names = groupNames(group);
      if (part === names.main) { return { url: base, include: "", cut: null }; }
      if (part.startsWith(names.prefix)) { return { url: base + "/includes/" + enc(part), include: "", cut: null }; }
    }
    return null;
  }
  const url = classUrl(name);
  if (ptype === "CINC") {
    const suffix = part.startsWith(padded(name, "=")) ? part.slice(30) : "";
    return LOCAL[suffix] ? { url, include: LOCAL[suffix], cut: null } : null;
  }
  if (SECTIONS[ptype] && part === name) {
    const section = SECTIONS[ptype];
    return { url, include: "main", cut: text => {
      const at = classLayout(text).sections[section];
      return at ? lines(text).slice(at.from, at.to + 1) : null;
    } };
  }
  if (ptype === "METH" && part.startsWith(padded(name, " "))) {
    const method = part.slice(30).trim();
    return { url, include: "main", cut: text => {
      const at = classLayout(text).methods.find(m => m.name === method);
      return at ? lines(text).slice(at.from, at.to + 1) : null;
    } };
  }
  return null;
}

// A class has only the local includes it was given. ADT answers 404 for the others - or, for a test class include
// that was never created, "does not have any inactive version" (seen on E19).
const missing = error => /404|not found|does not exist|does not have any (in)?active version/i.test(String(error && error.message || error))
  || Boolean(error && error.response && error.response.status === 404);
const meaningful = text => lines(text).some(line => {
  const t = line.trim();
  return t !== "" && !t.startsWith("*") && !t.startsWith("\"");
});

async function classParts(api, name) {
  const url = classUrl(name);
  const layout = classLayout(await api.currentSource(url));
  const parts = [];
  Object.entries(SECTIONS).forEach(([ptype, section]) => {
    // A section holding nothing but its own header is not worth a click, as AVE has it.
    if (layout.sections[section] && layout.sections[section].declarations) {
      parts.push({ class: name, unit: "", name, part_type: ptype, section });
    }
  });
  layout.methods.forEach(m => parts.push({ class: name, unit: m.name, name: padded(name, " ") + m.name, part_type: "METH",
    section: m.name.includes("~") ? "" : m.section }));
  for (const [suffix, include] of Object.entries(LOCAL)) {
    let text;
    // A class has only the local includes it was given; ADT answers 404 for the others.
    try { text = await api.currentSource(url, include); } catch (error) { if (missing(error)) { continue; } throw error; }
    if (meaningful(text)) { parts.push({ class: name, unit: "", name: padded(name, "=") + suffix, part_type: "CINC", section: "" }); }
  }
  return parts;
}

// An object's parts, as AVE's object classes list them.
async function partsOf(api, type, name) {
  const one = (part, ptype) => [{ class: "", unit: name, name: part, part_type: ptype, section: "" }];
  if (type === "CLAS") { return classParts(api, name); }
  // An interface's one part is its section include, ZIF_X=====...IU.
  if (type === "INTF") { return one(padded(name, "=") + "IU", "REPS"); }
  if (type === "FUNC") { return one(name, "FUNC"); }
  if (type === "DDLS") { return one(name, "DDLS"); }
  if (DDIC[type]) { return one(name, DDIC[type]); }
  if (type === "FUGR") {
    // The main program, a FUNC per function module, the group's other includes - from TFDIR and TRDIR.
    const names = groupNames(name);
    const modules = (await api.query("SELECT funcname, include FROM tfdir WHERE pname = '" + names.main.replace(/'/g, "''") + "'", 1000)).values;
    const byInclude = new Map(modules.map(m => [names.prefix + "U" + m.INCLUDE, m.FUNCNAME]));
    // AVE's own filter: TRDIR rows under the prefix with SQLX set.
    const includes = (await api.query("SELECT name FROM trdir WHERE name LIKE '" + names.prefix.replace(/'/g, "''").replace(/[_%#]/g, "#$&")
      + "%' ESCAPE '#' AND sqlx = 'X'", 1000)).values.map(r => String(r.NAME)).sort();
    const parts = [{ class: "", unit: names.main, name: names.main, part_type: "REPS", section: "" }];
    includes.forEach(include => {
      const module = byInclude.get(include);
      parts.push(module ? { class: "", unit: module, name: module, part_type: "FUNC", section: "" }
        : { class: "", unit: include, name: include, part_type: "REPS", section: "" });
    });
    return parts;
  }
  return one(name, "REPS");
}

// The transport requests of one user, as ZCL_VX_ADT_RES_REQUESTS lists them: those they own and those where they
// only hold a task, open ones (modifiable, protected) or the released too; workbench, customizing, copies and
// relocations; newest first.
const KINDS = { K: "workbench", W: "customizing", T: "transport of copies", C: "relocation", O: "relocation", E: "relocation" };
const STATES = { D: "modifiable", L: "modifiable, protected", O: "release started", R: "released", N: "released, import protected" };
async function requestsOf(api, params) {
  const user = String(params.get("user") || api.user() || "").trim().toUpperCase();
  if (user.length > 12) { throw new Error(user + " is not a user name: an SAP user name has at most 12 characters."); }
  if (/[ *+%]/.test(user)) { throw new Error("Name one user, not a pattern: " + user + "."); }
  const released = params.get("released") || "";
  if (released && released !== "true" && released !== "false") { throw new Error("released is true or false, not " + released + "."); }
  const states = ["D", "L"].concat(released === "true" ? ["O", "R", "N"] : []).map(sqlText).join(", ");
  const kinds = Object.keys(KINDS).map(sqlText).join(", ");
  const own = (await api.query("SELECT trkorr FROM e070 WHERE as4user = " + sqlText(user) + " AND strkorr = ' '"
    + " AND trfunction IN ( " + kinds + " ) AND trstatus IN ( " + states + " )", 10000)).values;
  const viaTask = (await api.query("SELECT r~trkorr FROM e070 AS t INNER JOIN e070 AS r ON r~trkorr = t~strkorr"
    + " WHERE t~as4user = " + sqlText(user) + " AND r~trfunction IN ( " + kinds + " ) AND r~trstatus IN ( " + states + " )", 10000)).values;
  const numbers = [...new Set(own.concat(viaTask).map(r => r.TRKORR))];
  let heads = [], texts = new Map();
  if (numbers.length) {
    heads = await inLists(api, "SELECT trkorr, trfunction, trstatus, as4user, as4date, as4time FROM e070 WHERE trkorr", numbers, 10000);
    // The description in the session's language when there is one, any other otherwise.
    const spras = await require("./selector-table").language(api);
    for (const row of await inLists(api, "SELECT trkorr, langu, as4text FROM e07t WHERE trkorr", numbers, 10000)) {
      if (!texts.has(row.TRKORR) || row.LANGU === spras) { texts.set(row.TRKORR, row.AS4TEXT); }
    }
  }
  const owners = [...new Set(heads.map(h => h.AS4USER).filter(Boolean))];
  const names = new Map(owners.length ? (await inLists(api, "SELECT u~bname, a~name_text FROM usr21 AS u INNER JOIN adrp AS a"
    + " ON a~persnumber = u~persnumber WHERE u~bname", owners, 1000)).map(row => [row.BNAME, row.NAME_TEXT]) : []);
  const requests = heads.map(h => ({ request: h.TRKORR, text: texts.get(h.TRKORR) || "", owner: h.AS4USER,
    owner_name: names.get(h.AS4USER) || "", type: KINDS[h.TRFUNCTION] || h.TRFUNCTION, status: STATES[h.TRSTATUS] || h.TRSTATUS,
    date: String(h.AS4DATE), time: String(h.AS4TIME) }));
  requests.sort((x, y) => (y.date + y.time + y.request).localeCompare(x.date + x.time + x.request));
  return { user, released: released === "true", requests };
}

async function request(api, resource) {
  const url = new URL(resource, "https://sap.invalid"), params = url.searchParams;
  if (url.pathname === "/sap/bc/adt/vertex/requests") { return requestsOf(api, params); }
  const match = /^\/sap\/bc\/adt\/vertex\/versions\/([^/]+)$/.exec(url.pathname);
  if (!match) { return null; }
  const type = String(params.get("type") || "PROG").toUpperCase().split("/")[0];
  if (!["PROG", "INCL", "CLAS", "INTF", "FUNC", "FUGR", "DDLS", "TABL", "DOMA", "DTEL", "TR", "DEVC"].includes(type)) { return null; }
  const name = decodeURIComponent(match[1]).toUpperCase();
  if (!NAME.test(name)) { throw new Error(name + " is not an object name."); }
  const part = String(params.get("part") || "").toUpperCase(), ptype = String(params.get("ptype") || "").toUpperCase();
  const ignore = String(params.get("ic") || "").toUpperCase() === "X";
  const head = { object: name.toLowerCase(), type: type.toLowerCase() };

  // A program or an include is one part, itself; a class is its sections, its methods and its local includes.
  if (!part) {
    // A transport request and a package are scopes: the objects in them, each opened rather than read here.
    if (type === "TR" || type === "DEVC") { return Object.assign(head, { scope: true, parts: await scopeParts(api, type, name) }); }
    return Object.assign(head, { scope: false, parts: await partsOf(api, type, name) });
  }
  const where = await partOf(api, type, name, part, ptype);
  if (!where) { throw new Error(part + " of type " + ptype + " is not a part of " + name + ". Ask for the parts list first."); }
  const textOf = async uri => {
    const text = await sourceAt(api, uri);
    return where.cut ? where.cut(text) : lines(text);
  };
  if (String(params.get("now") || "").toUpperCase() === "X") {
    const now = await api.currentSource(where.url, where.include);
    const cut = where.cut ? where.cut(now) : lines(now);
    return { part, part_type: ptype, include: where.include || name, source: (cut || []).join("\n") };
  }

  const feed = await api.revisions(where.url, where.include || undefined);
  const numberOf = entry => entry.id === "00000" ? ACTIVE : entry.id;
  const from = params.get("from") || "", to = params.get("to") || "";
  const partHead = { part: part.toLowerCase(), part_type: ptype.toLowerCase() };

  if (to) {
    const sourceOf = async number => {
      const entry = feed.find(e => numberOf(e) === String(number).padStart(5, "0"));
      if (!entry) { throw new Error("Version " + number + " of " + part + " is not in its history."); }
      return (await textOf(entry.uri)) || [];
    };
    const ops = await diff(from ? await sourceOf(from) : [], await sourceOf(to), ignore, api);
    return Object.assign(head, partHead, { from, to,
      added: ops.filter(o => o.op === "+").length, deleted: ops.filter(o => o.op === "-").length,
      kept: ops.filter(o => o.op === "=").length, ops });
  }

  let rows = feed.map(entry => Object.assign({ version: numberOf(entry), author: entry.author, request: entry.transport,
    task: "", uri: entry.uri }, stamp(entry.time)));
  // TOC=X keeps the versions a transport of copies wrote; without it they go, as in AVE.
  if (String(params.get("toc") || "").toUpperCase() !== "X") {
    const requests = [...new Set(rows.map(r => r.request).filter(Boolean))];
    if (requests.length) {
      const copies = new Set((await inLists(api, "SELECT trkorr FROM e070 WHERE trfunction = 'T' AND trkorr", requests, 1000))
        .map(row => row.TRKORR));
      rows = rows.filter(r => !copies.has(r.request));
    }
  }
  rows.sort((x, y) => Number(y.version) - Number(x.version));
  // A part cut out of the class has a version where its text changed - VRSD keeps one only then - and none before
  // it existed. DUPS=X does the same for a whole source, keeping the earliest of a run of identical ones.
  const dups = String(params.get("dups") || "").toUpperCase() === "X";
  if (where.cut || dups) {
    const texts = await Promise.all(rows.map(r => textOf(r.uri).then(text => text && text.map(l => normal(l, ignore)).join("\n"))));
    rows = rows.filter((r, i) => texts[i] !== null && (i === rows.length - 1 || texts[i] !== texts[i + 1]));
  }
  // Names to the users, as the page shows them beside the user ID.
  const users = [...new Set(rows.map(r => r.author).filter(Boolean))];
  const names = new Map(users.length ? (await inLists(api, "SELECT u~bname, a~name_text FROM usr21 AS u INNER JOIN adrp AS a"
    + " ON a~persnumber = u~persnumber WHERE u~bname", users, 1000)).map(row => [row.BNAME, row.NAME_TEXT]) : []);
  return Object.assign(head, partHead, {
    versions: rows.map(({ uri, ...r }) => Object.assign(r, { author_name: names.get(r.author) || "" })) });
}

module.exports = { request, diff, classLayout, partsOf, partOf, sourceAt, lines, padded };
