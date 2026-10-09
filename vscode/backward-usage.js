"use strict";
/* Backward Usage Analysis: where a routine's values go in the code that calls it - a where-used that follows the
   value. From the routine around the selected line it goes up: SAP's where-used names the calls, and in each caller the
   value is followed on from the call - what it is assigned to, tested in, passed to, written with - and, where it
   leaves the caller through a parameter of the caller's own, up again. A value passed in is followed to where the
   caller took it from the same way. Standard SAP code is a wall; the host decides which objects are customer ones.

   What is followed:
   - a variable chosen: that variable - a parameter or attribute itself, a local through the parameters and attributes
     it reaches in its routine;
   - no variable: every parameter of the routine and every attribute it uses;
   - neither: the calls of the routine, SAP's where-used as it is.

   The host gives the reading:
   - callers(routine) -> { places: [{ source, line }], skipped: [names] }: where-used of a routine;
   - uses(attribute) -> { places: [{ source, line }], skipped: [names] }: where-used of an attribute;
   - breakpointAt(sourceId, line) -> boolean;
   - ask(points) -> 'stop' | 'next' | 'ignore', when the walk reaches breakpoints.
   A source is { id, text, objectName, objectType, aceStatements } as the abaplint parser gives it; lines count from 1. */
const { classifyStatement } = require("./abap-control");
const { buildIndex, callsIn, assignment, variablePaths, declaredIn, formParameters } = require("./value-origin-model");

const U = value => String(value || "").toUpperCase();
const base = name => U(name).split("-")[0];
const OUT = new Set(["EXPORTING", "CHANGING", "RETURNING"]);
const CONDITION = new Set(["IF", "ELSEIF", "CHECK", "WHILE", "CASE", "WHEN", "ASSERT"]);
const DATABASE = new Set(["INSERT", "UPDATE", "MODIFY", "DELETE"]);
const OUTPUT = new Set(["WRITE", "MESSAGE"]);
const DEFINITION = new Set(["METHODS", "CLASS-METHODS", "METHOD", "FORM", "ALIASES", "INTERFACES", "DATA", "CLASS-DATA"]);
// A declaration names a routine or an attribute without using it; DATA( x ) = ... is an assignment, not one.
const declaration = tokens => DEFINITION.has(U(tokens[0]?.value)) && tokens[1]?.value !== "(";
const flat = text => String(text || "").replace(/\s+/g, " ").trim();

function indexer() {
  const indexes = new Map();
  return source => {
    if (!indexes.has(source.id)) indexes.set(source.id, buildIndex([source]));
    return indexes.get(source.id);
  };
}

// The routine a line stands in, and its statement there: the body statement whose lines hold it. A line no statement
// of a body holds - METHOD, ENDMETHOD, a comment - answers null.
function placeOf(index, source, line) {
  let global = null;
  for (const procedure of index.procedures) {
    if (procedure.source.id !== source.id) continue;
    const statement = procedure.body.find(item => item.line <= line && (item.tokens[item.tokens.length - 1]?.line || item.line) >= line);
    if (!statement) continue;
    if (procedure.name !== "GLOBAL") return { procedure, statement };
    global = { procedure, statement };
  }
  return global;
}

const routineLabel = procedure => procedure.name === "GLOBAL"
  ? (procedure.source.objectName || procedure.source.id)
  : (procedure.owner ? procedure.owner + "->" : "") + procedure.name;

// The parameters of a routine with the modes of a method: a FORM's USING takes, its CHANGING and TABLES give back.
function signatureOf(index, procedure) {
  if (procedure.declaration) return formParameters(procedure.declaration).map(parameter => ({ name: U(parameter.name),
    mode: parameter.mode === "USING" ? "IMPORTING" : "CHANGING", form: parameter.mode }));
  return (index.signature(procedure) || []).map(parameter => ({ name: U(parameter.name), mode: parameter.mode, preferred: parameter.preferred }));
}

// The attributes a source declares - DATA and CLASS-DATA outside every routine - each with the place of its name.
function attributesOf(index, source) {
  const global = index.procedures.find(procedure => procedure.name === "GLOBAL" && procedure.source.id === source.id);
  if (!global || !["CLAS"].includes(U(source.objectType)) && !global.body.some(statement => U(statement.tokens[0]?.value) === "CLASS")) return [];
  const found = [];
  for (const statement of global.body) {
    const ts = statement.tokens, first = U(ts[0]?.value);
    if (!["DATA", "CLASS-DATA"].includes(first)) continue;
    const at = ts[1]?.value === ":" ? 2 : 1;
    if (ts[at]) found.push({ name: U(ts[at].value), source, line: ts[at].line, column: columnOf(source.text, ts[at].offset) });
  }
  return found;
}

const columnOf = (text, offset) => offset - (String(text).lastIndexOf("\n", offset - 1) + 1);

// Where SAP's where-used is asked for a routine: the name in its METHOD or FORM statement.
function routineAddress(procedure) {
  if (!procedure.source.aceStatements) throw new Error(procedure.source.id + " was not parsed: Backward Usage Analysis reads parsed statements only.");
  const statement = procedure.source.aceStatements.find(item => item.line === procedure.line
    && ["METHOD", "FORM"].includes(U(item.tokens[0]?.value)));
  const name = statement && statement.tokens[1];
  return { source: procedure.source, owner: procedure.owner, name: procedure.name, line: procedure.line,
    column: name ? columnOf(procedure.source.text, name.offset) : 0, kind: statement ? U(statement.tokens[0].value) : "METHOD" };
}

// The actual parameters a call passes, by formal name, each with the caller's mode word: what the caller EXPORTS the
// routine IMPORTS. A call with one unnamed argument passes it to the preferred or the only importing parameter.
function bindings(tokens, signature) {
  const result = new Map(), modes = new Set(["IMPORTING", "EXPORTING", "CHANGING", "RECEIVING", "TABLES"]);
  let mode = "EXPORTING", named = false;
  for (let i = 0; i < tokens.length; i++) {
    if (modes.has(U(tokens[i].value))) { mode = U(tokens[i].value); continue; }
    if (tokens[i].kind !== "word" || tokens[i + 1]?.value !== "=") continue;
    let end = i + 2, depth = 0;
    for (; end < tokens.length; end++) {
      if (depth === 0 && (modes.has(U(tokens[end].value)) || (end > i + 2 && tokens[end].kind === "word" && tokens[end + 1]?.value === "="))) break;
      if (tokens[end].value === "(") depth++; if (tokens[end].value === ")") depth--;
    }
    result.set(U(tokens[i].value), { mode, actual: tokens.slice(i + 2, end) }); named = true; i = end - 1;
  }
  if (!named && tokens.length) {
    const formal = signature.find(parameter => parameter.preferred) || signature.filter(parameter => parameter.mode === "IMPORTING")[0];
    if (formal) result.set(formal.name, { mode: "EXPORTING", actual: tokens });
  }
  return result;
}

// PERFORM name USING a b CHANGING c: the actuals by position, against the FORM's own USING / CHANGING / TABLES.
function performBindings(tokens, signature) {
  const groups = { USING: [], CHANGING: [], TABLES: [] };
  let mode = "";
  for (const token of tokens.slice(2)) {
    if (groups[U(token.value)]) { mode = U(token.value); continue; }
    if (mode && token.kind === "word") groups[mode].push([token]);
  }
  const result = new Map();
  for (const group of Object.keys(groups)) {
    const formals = signature.filter(parameter => parameter.form === group);
    formals.forEach((formal, at) => { if (groups[group][at]) result.set(formal.name, { mode: group === "USING" ? "EXPORTING" : "CHANGING", actual: groups[group][at] }); });
  }
  return result;
}

const onlyName = tokens => {
  const paths = variablePaths(tokens.filter(token => token.value !== "@"));
  return paths.length === 1 && paths[0].from === 0 && paths[0].to === tokens.filter(token => token.value !== "@").length ? paths[0].name : null;
};

/* The value followed on in a routine from a statement: every later statement that reads a name of it, classified,
   and the names it reaches by assignment. Answers { uses: [node], reached: Set }. */
function follow(procedure, names, after) {
  const reached = new Set([...names].map(base)), uses = [];
  const reads = tokens => variablePaths(tokens).some(path => reached.has(base(path.name)));
  for (const statement of procedure.body) {
    if (statement.offset <= after) continue;
    const ts = statement.tokens, first = U(ts[0]?.value), a = statement.assignment || assignment(ts);
    if (a) {
      if (!reads(a.expression)) continue;
      reached.add(base(a.name));
      uses.push(use(statement, "assigned to " + U(a.name)));
      continue;
    }
    if (!reads(ts)) continue;
    const calls = callsIn(ts).filter(call => reads(call.args));
    if (CONDITION.has(first)) uses.push(use(statement, "condition"));
    else if (DATABASE.has(first)) uses.push(use(statement, "database"));
    else if (OUTPUT.has(first)) uses.push(use(statement, "output"));
    else if (calls.length) uses.push(use(statement, "passed to " + calls.map(call => (call.receiver ? call.receiver + call.arrow : call.owner ? call.owner + "=>" : "") + call.method).join(", ")));
    else uses.push(use(statement, "used"));
  }
  return { uses, reached };
}
const use = (statement, how) => ({ kind: "use", how, text: flat(statement.text), line: statement.line, children: [] });

async function analyze(start, io) {
  const index = indexer(), started = index(start.source);
  // On the METHOD, FORM or FUNCTION line the name is the routine itself, not a value: the routine, with no variable.
  const named = started.procedures.find(procedure => procedure.name !== "GLOBAL" && procedure.source.id === start.source.id && procedure.line === start.line);
  if (named) start = { ...start, variable: "" };
  const at = named ? { procedure: named, statement: named.body[0] || { offset: 0, line: named.line } } : placeOf(started, start.source, start.line);
  if (!at || at.procedure.name === "GLOBAL")
    throw new Error("Line " + start.line + " is in no method, form or function: Backward Usage Analysis starts in a routine.");
  const routine = at.procedure, signature = signatureOf(started, routine);
  const attributes = attributesOf(started, start.source);
  const variable = base(start.variable);
  const root = { kind: "routine", text: routineLabel(routine), source: start.source.id, line: routine.line, children: [] };
  const stoppedAt = [], skipped = new Set();
  // The same rows and calls Forward draws from, so the window is the same - turned inside out: the routine at the cursor
  // is the root, and an edge goes from a routine to the one that calls it, so its nearest edges are its callers.
  const flow = { rows: new Map(), edges: new Map() };
  const scopeOf = procedure => U(procedure.owner || procedure.source.objectName) + "→" + procedure.name;
  const row = (procedure, statement, included) => {
    const key = procedure.source.id + ":" + statement.line;
    const old = flow.rows.get(key);
    if (old) { old.included = old.included || included; return; }
    const name = U(procedure.source.objectName), type = U(procedure.source.objectType) || "CLAS";
    flow.rows.set(key, { name, type, line: statement.line, aceLine: statement.line, source: procedure.source.id,
      location: scopeOf(procedure).replace("→", "->"), control: classifyStatement(statement, callsIn), text: flat(statement.text),
      scope: scopeOf(procedure), included, outside: false, method: procedure.name, object_name: name, object_type: type });
  };
  const site = (caller, statement, callee, parameters) => {
    row(caller, statement, true);
    const key = scopeOf(callee) + ">" + scopeOf(caller);
    if (!flow.edges.has(key)) flow.edges.set(key, { callee: scopeOf(callee), caller: scopeOf(caller), parameters: [] });
    flow.edges.get(key).parameters.push(...parameters.map(text => ({ text, source: caller.source.id, line: statement.line })));
  };
  // An edge stands on the called routine's first statement drawn, and leads to the caller: the builder nests the caller
  // under it, as Forward nests a called routine under its call.
  const sites = () => [...flow.edges.values()].flatMap(edge => {
    const anchor = [...flow.rows.values()].filter(item => item.scope === edge.callee).sort((left, right) => left.line - right.line)[0];
    return anchor ? [{ name: anchor.name, type: anchor.type, line: anchor.line, method: anchor.method, object_name: anchor.object_name,
      object_type: anchor.object_type, callees: [edge.caller], parameters: edge.parameters }] : [];
  });

  // What is followed from the starting routine: { kind: 'parameter' | 'attribute', name, mode }.
  let targets;
  const parameter = name => signature.find(item => item.name === name);
  const attribute = name => attributes.find(item => item.name === name);
  if (variable) {
    if (parameter(variable)) targets = [{ kind: "parameter", ...parameter(variable) }];
    else if (attribute(variable)) targets = [{ kind: "attribute", ...attribute(variable) }];
    else {
      const { reached } = follow(routine, [variable], at.statement.offset - 1);
      targets = [...signature.filter(item => OUT.has(item.mode) && reached.has(item.name)).map(item => ({ kind: "parameter", ...item })),
        ...attributes.filter(item => reached.has(item.name)).map(item => ({ kind: "attribute", ...item }))];
      if (!targets.length) root.children.push({ kind: "boundary", text: variable + " does not leave " + routineLabel(routine) + ": no parameter or attribute takes it.", children: [] });
    }
  } else {
    const read = new Set(routine.body.flatMap(statement => variablePaths(statement.tokens).map(path => base(path.name))));
    targets = [...signature.map(item => ({ kind: "parameter", ...item })),
      ...attributes.filter(item => read.has(item.name)).map(item => ({ kind: "attribute", ...item }))];
  }

  const followedNames = new Set(targets.map(target => target.name));
  for (const statement of routine.body) row(routine, statement, variablePaths(statement.tokens).some(path => followedNames.has(base(path.name))));
  // The walk goes up a level at a time; a level is one wave, and the breakpoints a wave reaches are asked about together.
  let wave = [], asking = true;
  const followed = new Set();
  const enqueue = (procedure, target, node) => {
    const key = procedure.id + ":" + target.kind + ":" + target.name;
    if (followed.has(key)) { node.children.push({ kind: "boundary", text: "↻ " + target.name + " of " + routineLabel(procedure) + " is followed above.", children: [] }); return; }
    followed.add(key);
    wave.push({ procedure, target, node });
  };
  if (variable || targets.length) {
    for (const target of targets) {
      const node = { kind: "target", text: (target.kind === "attribute" ? "attribute " : (target.mode || "").toLowerCase() + " ") + target.name, children: [] };
      root.children.push(node);
      enqueue(routine, target, node);
    }
  } else {
    // Nothing goes in or out: the calls themselves, where-used as SAP gives it.
    const found = await io.callers(routineAddress(routine));
    for (const name of found.skipped || []) skipped.add(name);
    for (const place of found.places) {
      const there = placeOf(index(place.source), place.source, place.line);
      if (there && !declaration(there.statement.tokens)) { root.children.push(callPlace(place)); site(there.procedure, there.statement, routine, []); }
    }
  }

  function callPlace(place) {
    const text = (place.source.text.split(/\r?\n/)[place.line - 1] || "").trim();
    return { kind: "caller", text: (place.source.objectName || place.source.id) + ": " + flat(text), source: place.source.id, line: place.line, children: [] };
  }

  // One step up: the places of a routine's calls, each with what happens there to the value followed.
  async function step({ procedure, target, node }) {
    const next = [], points = [];
    if (target.kind === "attribute") {
      const found = await io.uses(target);
      for (const name of found.skipped || []) skipped.add(name);
      for (const place of found.places) {
        const there = placeOf(index(place.source), place.source, place.line);
        if (!there || declaration(there.statement.tokens)) continue;
        const child = { ...callPlace(place), text: routineLabel(there.procedure) + ": " + flat(there.statement.text) };
        node.children.push(child);
        row(there.procedure, there.statement, true);
        if (io.breakpointAt(place.source.id, there.statement.line)) points.push({ location: routineLabel(there.procedure), line: there.statement.line, source: place.source.id });
      }
      return { next, points };
    }
    const found = await io.callers(routineAddress(procedure));
    for (const name of found.skipped || []) skipped.add(name);
    for (const place of found.places) {
      const callerIndex = index(place.source), there = placeOf(callerIndex, place.source, place.line);
      if (!there) continue;
      const statement = there.statement, ts = statement.tokens, first = U(ts[0]?.value);
      if (declaration(ts)) continue;
      const caller = there.procedure, child = { kind: "caller", text: routineLabel(caller) + ": " + flat(statement.text), source: place.source.id, line: statement.line, children: [] };
      node.children.push(child);
      const lines = [statement.line];
      const signature = signatureOf(index(procedure.source), procedure);
      let bound;
      if (first === "PERFORM" && U(ts[1]?.value) === procedure.name) bound = performBindings(ts, signature);
      else {
        const call = callsIn(ts).find(item => item.method === procedure.name || item.method.endsWith("~" + procedure.name));
        if (call) bound = bindings(call.args, signature);
      }
      if (!bound) { child.children.push({ kind: "boundary", text: "A reference, not a call VERTEX can read.", children: [] }); continue; }
      const callerSignature = signatureOf(callerIndex, caller);
      const passed = [...bound.entries()].filter(([formal]) => formal === target.name)
        .map(([formal, binding]) => flat(place.source.text.slice(binding.actual[0].offset, binding.actual[binding.actual.length - 1].endOffset)) + " → " + formal);
      site(caller, statement, procedure, passed);
      if (target.mode === "IMPORTING") {
        // A value passed in: where the caller took it from.
        const binding = bound.get(target.name);
        if (!binding) { child.children.push({ kind: "boundary", text: target.name + " is not passed here.", children: [] }); continue; }
        const name = onlyName(binding.actual), own = name && callerSignature.find(item => item.name === base(name));
        child.children.push({ kind: "use", how: "passes", text: flat(place.source.text.slice(binding.actual[0].offset, binding.actual[binding.actual.length - 1].endOffset)), line: statement.line, children: [] });
        if (own) next.push({ procedure: caller, target: { kind: "parameter", ...own }, node: child });
      } else {
        // A value given back: the caller's variable that receives it, followed on in the caller.
        let receiver = null;
        if (target.mode === "RETURNING") {
          const receiving = [...bound.entries()].find(([, binding]) => binding.mode === "RECEIVING");
          const a = statement.assignment || assignment(ts);
          receiver = receiving ? onlyName(receiving[1].actual) : a ? a.name : null;
          if (!receiver) child.children.push(use(statement, "result used in place"));
        } else {
          const binding = bound.get(target.name);
          receiver = binding && ["IMPORTING", "CHANGING", "TABLES"].includes(binding.mode) ? onlyName(binding.actual) : null;
          if (!receiver) { child.children.push({ kind: "boundary", text: target.name + " is not received here.", children: [] }); continue; }
        }
        if (!receiver) continue;
        child.children.push({ kind: "use", how: "received in", text: U(receiver), line: statement.line, children: [] });
        const { uses, reached } = follow(caller, [receiver], statement.offset);
        child.children.push(...uses);
        for (const item of uses) { const used = caller.body.find(statement => statement.line === item.line); if (used) row(caller, used, true); }
        lines.push(...uses.map(item => item.line));
        for (const own of callerSignature.filter(item => OUT.has(item.mode) && reached.has(item.name))) {
          const up = { kind: "target", text: "leaves " + routineLabel(caller) + " as " + own.mode.toLowerCase() + " " + own.name, children: [] };
          child.children.push(up);
          next.push({ procedure: caller, target: { kind: "parameter", ...own }, node: up });
        }
      }
      for (const line of lines) if (io.breakpointAt(place.source.id, line)) points.push({ location: routineLabel(caller), line, source: place.source.id });
    }
    return { next, points };
  }

  while (wave.length) {
    const current = wave; wave = [];
    const points = [], ahead = [];
    for (const item of current) {
      const { next, points: reachedPoints } = await step(item);
      points.push(...reachedPoints); ahead.push(...next);
    }
    if (asking && points.length) {
      const answer = await io.ask(points);
      if (answer === "stop") { stoppedAt.push(...points); break; }
      if (answer === "ignore") asking = false;
      else if (answer !== "next") throw new Error("Unknown answer at a breakpoint: " + answer);
    }
    for (const item of ahead) enqueue(item.procedure, item.target, item.node);
  }
  return { root, stoppedAt, skipped: [...skipped], routine: routineLabel(routine), variable,
    flow: { rows: [...flow.rows.values()], sites: sites() }, start: { source: start.source.id, line: start.line, program: U(start.source.objectName) } };
}

/* What the Value origin page draws, for a Backward result: its flow, turned inside out, and nothing of a slice - the
   Formula and Expression of a value are Forward's. Where the walk stopped and what it did not follow are the warnings. */
function page(result) {
  return { nodes: [], edges: [], root: null, declarations: [], fullFlow: [], flow: [], boundedFlow: [], executionFlow: [], calls: [],
    callSites: [], scenarios: [], selectedVariable: result.variable, selectedSource: result.start.source, selectedLine: result.start.line,
    selectedProgram: result.start.program, analysisEngine: "ADT where-used + abaplint",
    originTitle: (result.variable || result.routine) + " — Backward usage",
    codeFlow: { rows: result.flow.rows, sites: result.flow.sites },
    flowScope: { rows: result.flow.rows, sites: result.flow.sites, start: null },
    warnings: [...(result.stoppedAt.length ? ["⛔ Stopped at breakpoint: " + result.stoppedAt.map(point => point.location + ", line " + point.line).join("; ") + ". Nothing above it is followed."] : []),
      ...(result.skipped.length ? ["Standard SAP code is not followed: " + result.skipped.join(", ") + "."] : [])] };
}

module.exports = { analyze, page, bindings, performBindings, follow, placeOf, routineAddress };
