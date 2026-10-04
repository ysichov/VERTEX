"use strict";

// The places a backward slice reaches, as the debugger needs them: the same
// statements the Value origin view draws and colours, not a second reading of
// ACE's flow rows. A place is a calculation, a SELECT, a call that returns or
// changes the value, or a parameter handed over - one point per statement.
const OPERATIONS = new Set(["calculation", "select", "call", "parameter"]);
const upper = value => String(value || "").toUpperCase();
// 'ZCL_CALC_FACADE->RUN' -> 'RUN'; a program's block has no '->'.
const methodOf = location => String(location || "").includes("->") ? upper(String(location).split("->").pop()) : "";

function pointsOf(graph, sources) {
  const byId = new Map(sources.map(source => [source.id, source]));
  // ACE's own facts for a statement: the name it changes and the names it is
  // made of - in a called routine these are its own (IV_SCENARIO where the
  // caller had LV_SCENARIO), which is why the analysis is asked, not the record read.
  const facts = new Map((graph.flow || []).map(row => [row.source + ":" + row.line, row]));
  const seen = new Set(), points = [];
  for (const node of graph.nodes || []) {
    if (!OPERATIONS.has(node.kind)) { continue; }
    const source = byId.get(node.source);
    const name = source && (source.aceOwner || source.objectName || source.name);
    if (!name) { continue; }
    const key = name + ":" + node.line;
    if (seen.has(key)) { continue; }
    seen.add(key);
    const row = facts.get(node.source + ":" + node.line);
    const names = row ? [upper(row.changed), ...(row.dependencies || []).map(upper)]
      .filter((one, at, all) => one && all.indexOf(one) === at) : [];
    const statement = (source.aceStatements || []).find(item => item.line === node.line);
    points.push({ name, type: (source.aceOwner ? source.aceOwnerType : source.objectType) || "CLAS",
      line: node.line, text: (statement && statement.text) || node.text || "", names,
      method: methodOf(node.location), object_name: source.objectName || "", object_type: source.objectType || "" });
  }
  return points;
}

// The flow between two breakpoints as the debugger's panel lists it: what Value origin shows as FLOW - the statement
// stream of ACE, bounded, each statement under the routine it belongs to - with `included` where the slice of a
// chosen value reaches it. It is there with no value chosen too; the slice only marks.
function pathRows(graph, sources) {
  const byId = new Map(sources.map(source => [source.id, source]));
  const rows = [];
  for (const row of graph.fullFlow || []) {
    const source = byId.get(row.source);
    const name = source && (source.aceOwner || source.objectName || source.name);
    if (!name) { continue; }
    const scope = String(row.scope || ""), at = scope.indexOf("→");
    const type = (source.aceOwner ? source.aceOwnerType : source.objectType) || "CLAS";
    const method = at >= 0 ? upper(scope.slice(at + 1)) : "";
    // The model files a statement outside every procedure under START-OF-SELECTION. In a class that is no event:
    // it is the class's own text between methods (sections, METHODS ...), which runs nothing.
    if (type === "CLAS" && method === "START-OF-SELECTION") { continue; }
    rows.push({ name, type,
      line: row.line, aceLine: row.line, source: row.source, location: scope.replace("→", "->"),
      text: String(row.text || "").trim(), scope, included: !!row.included,
      method,
      object_name: source.objectName || "", object_type: source.objectType || "" });
  }
  return rows;
}

// The calls of the flow's statements: where each is made (the statement's place, as a row's) and the routines it
// reaches, named as the rows' scopes are - OWNER→ROUTINE - so the flow can nest a call where it happens.
function siteRows(graph, sources) {
  const byId = new Map(sources.map(source => [source.id, source]));
  const rows = [];
  for (const site of graph.callSites || []) {
    const source = byId.get(site.source), name = source && (source.aceOwner || source.objectName || source.name);
    if (!name) { continue; }
    rows.push({ name, type: (source.aceOwner ? source.aceOwnerType : source.objectType) || "CLAS", line: site.line,
      method: methodOf(site.caller), object_name: source.objectName || "", object_type: source.objectType || "",
      callees: site.callees.map(callee => upper(callee.owner) + "→" + upper(callee.name)) });
  }
  return rows;
}

// The routine a line of the source is in, from what the analysis declares: the routine of the object's own source whose lines
// hold it (a program's line is the analysis's line), and for a global class the method whose start in the class source - as
// ADT's class structure gives it - and whose length in its own include hold it. Null where the line is in none: the program's
// events and the class's own text, whose variables are the program's or the class's.
function routineAt(declarations, { objectType, objectName, targetSource, line, starts }) {
  if (!Number.isInteger(line)) { return null; }
  if (upper(objectType) !== "CLAS") {
    return declarations.find(item => item.source === targetSource && item.name !== "GLOBAL" && line >= item.first && line <= item.last) || null;
  }
  return declarations.find(item => {
    if (item.name === "GLOBAL" || upper(item.owner) !== upper(objectName)) { return false; }
    const start = starts && starts[upper(item.name)];
    return Number.isInteger(start) && line >= start && line <= start + (item.last - item.first);
  }) || null;
}

// A structure type declared in another object (ZIF_T=>TY_CTX) is read from that object when the analysis's own sources did not
// bring it: `read(owner)` answers its source text or throws. What cannot be read is marked on the variable, and said once per
// owner in the returned warnings - a type without components is never left without a word.
async function completeStructures(variables, typeComponents, read) {
  const warnings = [], seen = new Map();
  const entries = [...variables.globals, ...variables.routines.flatMap(routine => [...routine.params, ...routine.locals])];
  for (const entry of entries) {
    const type = String(entry.type || ""), at = type.indexOf("=>");
    if (entry.components || at < 0 || /^(REF TO|STANDARD|SORTED|HASHED|TABLE)/i.test(type)) { continue; }
    const owner = upper(type.slice(0, at));
    if (!seen.has(owner)) {
      seen.set(owner, read(owner).then(text => ({ id: owner, name: owner, text, objectName: owner, objectType: "INTF" }),
        error => ({ error: (error && error.message) || String(error) })));
    }
    const source = await seen.get(owner);
    if (source.error) {
      entry.unresolved = "The structure " + type + " could not be read: " + source.error;
      if (!warnings.some(text => text.startsWith("Structures of " + owner + " "))) {
        warnings.push("Structures of " + owner + " could not be read (" + source.error + ").");
      }
      continue;
    }
    const components = typeComponents([source], type);
    if (components) { entry.components = components; }
    else { entry.unresolved = type + " is not a structure declared with TYPES BEGIN OF in " + owner + "."; }
  }
  return warnings;
}

// ACE counts the lines of a global class's method inside the method's own
// include - METHOD is line 1 - and the debugger counts them in the class's
// main source, where the method starts at the line ADT's class structure gives.
// A point of a class is moved from the first reading to the second; a program,
// and a local class inside one, count the same in both.
function classLines(points, startsOf) {
  return points.map(point => {
    if (point.object_type !== "CLAS" || !point.method || upper(point.object_name) !== upper(point.name)) { return point; }
    const starts = startsOf(point.name);
    const start = starts && starts[point.method];
    if (!Number.isInteger(start)) {
      throw new Error("Cannot place " + point.name + "=>" + point.method + " in the class source: ADT's class structure does not list it.");
    }
    return { ...point, line: start + point.line - 1 };
  });
}

// The same move for a list that is shown and not run: the flow's rows. The analysis counts in ACE's lines and needs no
// move; the move only lets a click open the line in the class's main source. A row ADT's structure cannot place keeps
// ACE's line and says `unplaced`, so the panel shows it and does not pretend to open it.
function placeRows(rows, startsOf) {
  return rows.map(row => {
    try { return classLines([row], startsOf)[0]; }
    catch (error) { return { ...row, unplaced: true }; }
  });
}

// Where on the stopped line the analysis starts. The statement it belongs to is
// the one the position falls inside: column 0 of an indented line is before it,
// which anchors the analysis one statement too early. The variable's own place
// in the line, as the cursor would give it; else the first character of the line.
function columnOf(lineText, variable) {
  const text = String(lineText || ""), whole = text.toUpperCase().indexOf(upper(variable));
  if (whole >= 0) { return whole; }
  const root = text.toUpperCase().indexOf(upper(variable).split("-")[0]);
  return root >= 0 ? root : Math.max(0, text.length - text.trimStart().length);
}

// The line a value is looked for from: the last place of the source that names it, as the cursor would stand on it
// in the editor. Where the run happens to be says nothing about it - before the statement that assigns the value,
// the value has no history yet. A name inside a literal or a comment is not a use. Lines from 1; 0 for none.
function lastUse(source, variable) {
  const { literalAt } = require("./value-origin-model");
  const root = upper(variable).split("-")[0], text = String(source || ""), code = text.toUpperCase();
  const word = ch => !!ch && /[A-Z0-9_/<>~]/i.test(ch);
  for (let from = code.length; from >= 0; ) {
    const at = from === 0 ? -1 : code.lastIndexOf(root, from - 1);
    if (at < 0) { return 0; }
    from = at;
    if (word(code[at - 1]) || word(code[at + root.length]) || literalAt(text, at)) { continue; }
    return text.slice(0, at).split("\n").length;
  }
  return 0;
}
module.exports = { pointsOf, pathRows, siteRows, placeRows, completeStructures, routineAt, classLines, columnOf, lastUse };
