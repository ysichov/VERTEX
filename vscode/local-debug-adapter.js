"use strict";

const fs = require("fs");
const path = require("path");
const { hits: watchHits, conditionOf } = require("./local-watchpoint");

/* scope: the sources of this run ({ files } or { root }), read when the object is opened and again at each run. */
/* more.entry: the method or function module screen at the panel's line; more.variants: where named sets of its values
   are kept (VS Code's workspace state), under the method's or module's name. */
/* The SELECTs of a record as Variables shows them: the statement, and the rows it brought or why it failed. */
const sqlRows = list => (list || []).map((entry, index) => ({ name: "SELECT " + (index + 1),
  value: String(entry.select || "") + (entry.error ? "  -  failed: " + entry.error : "  -  " + entry.rows + " rows") }));

function create(vscode, document, launch, publish, scope, more = {}) {
  const name = path.basename(document.uri.fsPath).replace(/\.(?:prog|clas|intf)\.abap$/i, "").toUpperCase();
  let latest = null, listening = false, ended = 0, error = "", pendingStep = null;
  let trace = [], traceIndex = 0, live = null, traceEnded = false, traceMs = 0, storedOutput = "";
  let watchpoints = [], nextWatchpoint = 1;
  const watchHit = (record, index = traceIndex) => watchHits(record, trace.slice(0, index), watchpoints);
  function atTrace(index) {
    traceIndex = index;
    // The variables of the routine the program stands in: those its own stops changed. The transpiler's record keeps
    // every routine's names together; a method's locals are no variables of the report that called it.
    const record = trace[index], values = {};
    const same = item => item && record && item.owner === record.owner && item.routine === record.routine;
    // SY is the program's, whichever routine set it.
    const sy = {};
    for (let i = 0; i <= index; i++) { if (same(trace[i])) Object.assign(values, trace[i].changed || {}); Object.assign(sy, trace[i]?.sy || {}); }
    latest = record ? { frame: record.routine || "START-OF-SELECTION", owner: record.owner || name,
      source: record.file, line: record.line,
      variables: Object.entries(values).map(([name, value]) => ({ name, value })),
      sy: Object.entries(sy).map(([name, value]) => ({ name: "SY-" + name, value })), sql: sqlRows(record.sql) } : null;
    publish(picture());
  }
  // A breakpoint's file in this run: the file itself, or - for an SAP program - the copy of the SAP tab it is set in.
  // more.uriOf is the way back, where a point set from the panel goes.
  const pathOf = uri => more.pathOf ? more.pathOf(uri) : uri?.scheme === "file" ? uri.fsPath : null;
  const uriOf = file => more.uriOf ? more.uriOf(file) : vscode.Uri.file(file);
  const isAbap = uri => /\.abap$/i.test(pathOf(uri) || "");
  // Only the points in this object's sources: one in another object's file neither shows here nor turns a plain run
  // into a debug run.
  let sources = scope ? scope() : null, everyPoint = false;
  const key = file => path.resolve(file).toLowerCase();
  const ours = uri => {
    if (!sources || everyPoint) return true;
    const file = key(pathOf(uri));
    return sources.root ? file.startsWith(key(sources.root) + path.sep) : sources.files.some(f => key(f) === file);
  };
  const points = () => (vscode.debug.breakpoints || []).filter(bp => isAbap(bp.location?.uri) && ours(bp.location.uri)).map(bp => ({
    id: bp.id, objectType: "PROG", name: path.basename(pathOf(bp.location.uri)).split(".")[0].toUpperCase(),
    url: pathOf(bp.location.uri), line: bp.location.range.start.line + 1,
    condition: bp.condition || "", mode: "stop", active: bp.enabled !== false
  }));
  const picture = () => {
    const source = /\.abap$/i.test(latest?.source || "") ? latest.source : document.uri.fsPath,
      line = latest?.line || 0;
    const breakpoints = points();
    const hit = breakpoints.find(bp => bp.active && bp.url.toLowerCase() === source.toLowerCase() && bp.line === line);
    return { system: "Transpiler", listening, ended, ending: null, error, breakpoints, watchpoints: watchpoints.map(w => ({ ...w })),
      traceLength: trace.length,
      stopped: latest?.frame && line ? { at: name + ":" + line, breakpoint: hit || null,
        watchpoints: watchHit(trace[traceIndex]),
        frames: [{ n: 0, current: true, label: "EVENT " + latest.frame,
          program: latest.owner || name, include: latest.owner || name, unitType: "EVENT", unit: latest.frame,
          url: source, line }] } : null };
  };
  function update(state) {
    latest = state?.frame ? state : null; error = state?.error || "";
    if (latest && pendingStep && (state.stopEvent || pendingStep.sawContinued)) {
      const done = pendingStep; pendingStep = null; done.resolve({});
    } else if (state?.continued && pendingStep) pendingStep.sawContinued = true;
    publish(picture());
  }
  function finish() {
    if (!listening && !latest) return;
    latest = null; listening = false; ended++;
    if (pendingStep) { const done = pendingStep; pendingStep = null; done.resolve({ ended: true }); }
    publish(picture());
  }
  const shown = variable => {
    const value = variable.value;
    const composite = value !== null && typeof value === "object";
    return { id: variable.id || variable.name, name: variable.name,
      meta: Array.isArray(value) ? "table" : composite ? "structure" : "simple",
      type: variable.type || "", technical: "",
      value: Array.isArray(value) ? value.length + " rows" : composite ? Object.keys(value).length + " fields" : String(value ?? "") };
  };
  const nested = id => {
    // The variable first, then its components: the first part is taken once, not once per variable compared.
    const parts = String(id).split("-"), head = String(parts.shift()).toUpperCase();
    let value = (latest?.variables || []).find(item => String(item.name).toUpperCase() === head)?.value;
    for (const part of parts) value = value?.[part.toLowerCase()] ?? value?.[part];
    return value && typeof value === "object" ? Object.entries(value).map(([name, value]) =>
      shown({ id: id + "-" + name, name, value })) : [];
  };
  // SY as it stands, and the SELECTs the statement before this one ran, beside the routine's variables.
  const localGroups = () => [{ id: "vertex-local-variables", name: "Locals", children: (latest?.variables || []).map(shown) }]
    .concat(latest?.sy?.length ? [{ id: "vertex-local-sy", name: "SY", children: latest.sy.map(shown) }] : [])
    .concat(latest?.sql?.length ? [{ id: "vertex-local-sql", name: "SQL", children: latest.sql.map(shown) }] : []);
  const variantsOf = key => ({ ...((more.variants && more.variants.get("vertex.variants." + key)) || {}) });
  async function command(action, args = {}) {
    switch (action) {
      case "picture": return picture();
      case "run": {
        // One run at a time: a second one would end the first, which another view is waiting on.
        if (listening) throw new Error("A run is already going: wait for it, or end it with Exit program.");
        live?.stop(); live = null;
        if (scope) sources = scope();
        latest = null; error = ""; listening = true; trace = []; publish(picture());
        let result, ended, durationMs = 0;
        try {
          result = await launch(args.selection || {});
          live = result?.live || null;
          trace = result?.records || [];
          ended = !live;
          const first = trace[0], breakpoints = points();
          if (live && first && !breakpoints.some(bp => bp.active && bp.url.toLowerCase() === first.file.toLowerCase() && bp.line === first.line)) {
            // The time the program ran, not the time it was transpiled or stood at a breakpoint.
            const started = Date.now();
            const next = await live.next("continue", breakpoints, watchpoints);
            durationMs = Date.now() - started;
            trace.push(...next.records); ended = next.ended;
          }
        } finally { listening = false; }
        atTrace(Math.max(0, trace.length - 1)); traceEnded = ended; traceMs = durationMs;
        return { url: document.uri.fsPath, trace, ended, durationMs, output: live?.output || result?.output || "" };
      }
      case "trace": return { trace };
      // The run as it stands, for a page opened again on it.
      case "restore": return { url: document.uri.fsPath, trace, ended: traceEnded || !live, durationMs: traceMs,
        output: live?.output || storedOutput, at: more.trace ? traceIndex : null };
      case "step": {
        if (args.live) {
          if (!live) return { records: [], ended: true, picture: picture(), groups: localGroups() };
          const started = Date.now();
          const next = await live.next(args.kind, points(), watchpoints);
          const durationMs = Date.now() - started;
          trace.push(...next.records); traceEnded = next.ended; traceMs += durationMs;
          atTrace(trace.length - 1);
          return { records: next.records, ended: next.ended, durationMs, output: live.output, picture: picture(), groups: localGroups() };
        }
        if (trace.length) {
          let next = Math.min(trace.length - 1, traceIndex + 1);
          if (args.kind === "continue") {
            const breakpoints = points();
            const hit = trace.findIndex((record, index) => index > traceIndex && (breakpoints.some(bp =>
              bp.active && bp.url.toLowerCase() === record.file.toLowerCase() && bp.line === record.line) || watchHit(record, index).length));
            next = hit >= 0 ? hit : trace.length - 1;
          }
          atTrace(next);
          return { picture: picture(), groups: localGroups(), ended: next === trace.length - 1 };
        }
        const key = { into: "stepInto", over: "stepOver", out: "stepOut", continue: "continue" }[args.kind];
        if (!key) throw new Error("Unknown debug step.");
        if (!args.wait) { await vscode.commands.executeCommand("workbench.action.debug." + key); return {}; }
        const result = new Promise(resolve => {
          const timer = setTimeout(() => { pendingStep = null; resolve({ timeout: true }); }, 15000);
          pendingStep = { resolve: value => { clearTimeout(timer); resolve(value); }, sawContinued: false };
        });
        try { await vscode.commands.executeCommand("workbench.action.debug." + key); }
        catch (error) { if (pendingStep) { const done = pendingStep; pendingStep = null; done.resolve({ error: error.message }); } }
        const stopped = await result;
        return { ...stopped, picture: picture(), groups: localGroups() };
      }
      case "localSnapshot": return { groups: localGroups() };
      case "source": return { url: args.url, source: fs.readFileSync(args.url || document.uri.fsPath, "utf8") };
      case "scopes": return { groups: [{ id: "vertex-local-variables", name: "Locals" }], sy: null };
      case "children": return { id: args.id, children: args.id === "vertex-local-variables" ?
        (latest?.variables || []).map(shown) : nested(args.id) };
      case "vars": {
        // SY as one structure of the fields the run has set so far.
        const sy = latest?.sy?.length ? [{ name: "SY", value: Object.fromEntries(latest.sy.map(field => [field.name.slice(3), field.value])) }] : [];
        return { variables: (latest?.variables || []).concat(sy).filter(v =>
          !args.names || args.names.some(n => n.toUpperCase() === v.name.toUpperCase())).map(shown) };
      }
      case "set": {
        const uri = uriOf(args.url || document.uri.fsPath);
        const bp = new vscode.SourceBreakpoint(new vscode.Location(uri,
          new vscode.Position(Math.max(0, args.line - 1), 0)), true, args.condition || undefined);
        vscode.debug.addBreakpoints([bp]); return { id: bp.id };
      }
      case "watchpointAdd": {
        const variable = String(args.name || "").trim().toUpperCase();
        if (!/^[A-Z_][A-Z0-9_]*(?:-[A-Z_][A-Z0-9_]*)*$/.test(variable)) throw new Error("Choose an ABAP variable or structure component.");
        const condition = String(args.condition || "").trim();
        conditionOf(variable, condition);
        const existing = watchpoints.find(w => w.name === variable && w.condition === condition);
        if (existing) return existing;
        const added = { id: "LOCAL-WP" + nextWatchpoint++, name: variable, condition };
        watchpoints.push(added); publish(picture()); return added;
      }
      case "watchpointRemove": watchpoints = watchpoints.filter(w => w.id !== String(args.id)); publish(picture()); return {};
      case "clear": vscode.debug.removeBreakpoints((vscode.debug.breakpoints || []).filter(bp =>
        args.id ? bp.id === args.id : isAbap(bp.location?.uri) && ours(bp.location.uri))); return {};
      case "activate": return {};
      case "stop": case "detach": case "terminate":
        live?.stop(); live = null;
        await vscode.debug.stopDebugging(); finish(); return {};
      case "frame": return {};
      // The selection screen as the document stands now.
      case "selection": { const run = require("./local-run");
        return { scenarios: run.scenariosFor(document), parameters: run.parametersFor(document), screen: run.screenFor(document),
          entry: more.entry ? more.entry() : null }; }
      // Named sets of values for a method or function module, kept in VS Code.
      case "variants": return { variants: variantsOf(args.key) };
      case "saveVariant": {
        if (!more.variants) throw new Error("Variants cannot be kept here.");
        const name = String(args.name || "").trim(); if (!name) throw new Error("A variant needs a name.");
        const all = variantsOf(args.key); all[name] = args.values || {};
        await more.variants.update("vertex.variants." + args.key, all); return { variants: all };
      }
      case "deleteVariant": {
        const all = variantsOf(args.key); delete all[String(args.name || "")];
        await more.variants.update("vertex.variants." + args.key, all); return { variants: all };
      }
      // All BP: every ABAP breakpoint in VS Code counts, not only this object's.
      case "allBreakpoints": everyPoint = args.on === true; publish(picture()); return {};
      case "copy": await vscode.env.clipboard.writeText(String(args.text || "")); return {};
      case "checkdumps": return { dumped: [] };
      case "opendump": return {};
    }
    throw new Error("Local Visual Debug does not support " + action + " yet.");
  }
  // A new Visual Debug window starts clean: the paused transpiler process of this one ends with it.
  // A kept run: its record, its output, and the step it opens at.
  if (more.trace) { trace = more.trace.records || []; traceEnded = true; storedOutput = more.trace.output || "";
    if (trace.length) atTrace(Math.min(trace.length - 1, Math.max(0, more.trace.at ?? trace.length - 1))); }
  const dispose = () => { live?.stop(); live = null; trace = []; latest = null; };
  return { picture, update, finish, command, dispose, hasTrace: () => trace.length > 0 };
}

module.exports = { create };
