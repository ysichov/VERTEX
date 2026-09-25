"use strict";

// The ABAP debugger for an assistant: breakpoints with conditions, a listener,
// and what the program looked like where it stopped. No VS Code API here - the
// host hands in how to reach SAP and how to open a browser, as with sap-code.js.
//
// What the probe of 2026-09-24 established, and this is built on:
// - A breakpoint stops nothing unless a listener waits for it (debuggerListen).
// - ADT breakpoints are the user's: they catch WebGUI, HTTP and RFC runs, never
//   a session opened through SAP Logon. That is SAP's design (see
//   docs "Breakpoints Characteristics"), so a run is started in WebGUI.
// - After a stop the program stays under the attached session: the next stop is
//   the answer to "continue", not a new listener hit. Leaving the session loses it.
// - "continue" on the last stop throws when the program ends. That is the end.
// - One listener per user: an open Eclipse or ABAP FS debugger takes the hits.
// - A condition is checked by SAP, which skips everything else - two stops cost
//   a dozen requests where stepping line by line cost hundreds.
//
// A breakpoint has a mode. "stop" hands the stop to the assistant, which reads,
// steps and continues. "log" records the state and lets the program run on - a
// watchpoint that costs no turn of the assistant. Variables are never changed
// and the program is never jumped around: this reads, it does not alter.

const ROWS_SHOWN = 5;          // rows of a table shown in a stop; debug_read gives more
const ROWS_READ = 200;         // most rows one debug_read returns
const WAIT_DEFAULT = 60;       // seconds debug_wait waits unless told otherwise
const WAIT_MOST = 280;         // a tool call must come back before the client gives up

const STEPS = { over: "stepOver", into: "stepInto", out: "stepReturn", continue: "stepContinue" };

/* The source URL a breakpoint is set on. A program and an include are read
   the way VERTEX opens them; a class line counts in its main source, as in the
   VERTEX class tab. */
function sourceUrl(objectType, name, group) {
  const lower = encodeURIComponent(String(name).toLowerCase());
  switch (String(objectType || "PROG").toUpperCase()) {
    case "PROG": return "/sap/bc/adt/programs/programs/" + lower + "/source/main";
    case "INCL": return "/sap/bc/adt/programs/includes/" + lower + "/source/main";
    case "CLAS": return "/sap/bc/adt/oo/classes/" + lower + "/source/main";
    // A function module's address names its group, which the name alone does not give.
    case "FUNC":
      if (!group) { throw new Error("A breakpoint in a function module needs its function group."); }
      return "/sap/bc/adt/functions/groups/" + encodeURIComponent(String(group).toLowerCase()) + "/fmodules/" + lower + "/source/main";
    default: throw new Error("A breakpoint goes into a PROG, an INCL, a CLAS or a FUNC; " + objectType + " is not supported yet.");
  }
}

/* The object a source URL belongs to, as sourceUrl builds it - or null for a
   source a breakpoint cannot be set in from here (a class's local include). */
function objectOf(url) {
  const text = String(url || "").split("#")[0].toLowerCase();
  let m;
  if ((m = /^\/sap\/bc\/adt\/programs\/programs\/([^/]+)\/source\/main$/.exec(text))) { return { objectType: "PROG", name: decodeURIComponent(m[1]).toUpperCase() }; }
  if ((m = /^\/sap\/bc\/adt\/programs\/includes\/([^/]+)\/source\/main$/.exec(text))) { return { objectType: "INCL", name: decodeURIComponent(m[1]).toUpperCase() }; }
  if ((m = /^\/sap\/bc\/adt\/oo\/classes\/([^/]+)\/source\/main$/.exec(text))) { return { objectType: "CLAS", name: decodeURIComponent(m[1]).toUpperCase() }; }
  if ((m = /^\/sap\/bc\/adt\/functions\/groups\/([^/]+)\/fmodules\/([^/]+)\/source\/main$/.exec(text))) {
    return { objectType: "FUNC", name: decodeURIComponent(m[2]).toUpperCase(), group: decodeURIComponent(m[1]).toUpperCase() };
  }
  return null;
}

/* A value as the assistant reads it: text for a field, an object for a
   structure, and for a table its size - its rows are read on purpose. */
function plain(v) {
  if (v.META_TYPE === "simple" || v.META_TYPE === "string") { return String(v.VALUE).trimEnd(); }
  if (v.META_TYPE === "table") { return "<table, " + (Number(v.TABLE_LINES) || 0) + " rows>"; }
  return "<" + v.META_TYPE + (v.ACTUAL_TYPE_NAME ? " " + v.ACTUAL_TYPE_NAME : "") + ">";
}

function create({ connect, current, openUrl, ideId, terminalId }) {
  let listening = false, stopListening = false;
  let session = null;          // { client, debuggee, busy }
  let stopped = null;          // the stop waiting for the assistant
  let finished = [];           // runs that ended since the last debug_wait
  let problems = [];           // what went wrong outside a tool call
  let logged = [], loggedRead = 0;
  let values = new Map();      // name -> shown value, to report what changed
  let waiters = [];
  const breakpoints = [];      // { id, objectType, name, url, line, condition, mode, adt }
  let numbered = 0, answers = { calls: 0, chars: 0 };
  let sap = null;              // { system, user, listener, open }
  let frames = [];             // the stack of the stop, for the Visual Debug window
  let temporaries = [];        // the window's run-to points: { id, url, line, adt }
  let ended = 0;               // runs that ended, counted for the window
  const watchers = new Set();  // the windows showing this debugger

  /* The stopped program's session takes one request at a time: the assistant
     and the window share it, and neither may interleave with a step. */
  let chain = Promise.resolve();
  function exclusive(work) {
    const done = chain.then(work, work);
    chain = done.catch(() => {});
    return done;
  }

  /* The system the debugger works on is the one active now - chosen with
     Switch System or named in the chat - not the one of the first call. A
     change while breakpoints or a stopped program still live on the old one
     is refused: they would be left behind there. */
  async function system() {
    const wanted = current ? current() : "";
    if (sap && wanted && sap.key !== wanted) {
      if (session || breakpoints.length || listening) {
        throw new Error("Debugging is still going on " + sap.system.name
          + ". Call debug_stop first - it removes the breakpoints there - then start again on the other system.");
      }
      sap = null;
    }
    if (!sap) { sap = await connect(); }
    return sap;
  }
  function wake() { const now = waiters; waiters = []; now.forEach(w => w()); changed(); }
  /* Tell every window that the picture moved. A window reads it with
     picture(); what the assistant has not collected stays for debug_wait. */
  function changed() { watchers.forEach(w => { try { w(); } catch (e) { /* a closed window */ } }); }
  function watch(fn) { watchers.add(fn); return () => watchers.delete(fn); }

  /* ---------- breakpoints ---------- */

  /* SAP keeps the whole set of this IDE's breakpoints: every change sends
     the full list. A condition is attached in a second round, as ABAP FS and
     Eclipse do - the line has to exist on the server before it can carry one. */
  async function sync(on) {
    const { listener, user } = on || await system();
    const all = breakpoints;
    const wanted = all.map(b => b.url + "#start=" + b.line);
    let answer = await listener.debuggerSetBreakpoints("user", terminalId, ideId, "vertex", wanted, user, "external");
    const placed = answer.filter(a => a.uri);
    for (const b of all) {
      b.adt = placed.find(a => a.uri.uri === b.url && a.uri.range.start.line === b.line) || null;
    }
    if (breakpoints.some(b => b.condition && b.adt)) {
      const withConditions = breakpoints.filter(b => b.adt).map(b => b.condition ? { ...b.adt, condition: b.condition } : b.adt);
      answer = await listener.debuggerSetBreakpoints("user", terminalId, ideId, "vertex", withConditions, user, "external");
      const again = answer.filter(a => a.uri);
      for (const b of breakpoints) {
        if (b.adt) { b.adt = again.find(a => a.uri.uri === b.url && a.uri.range.start.line === b.line) || null; }
      }
    }
    return answer.filter(a => !a.uri).map(a => a.errorMessage).filter(Boolean);
  }

  /* The breakpoints of the program stopped now. "external" breakpoints are
     for the runs to come; the one being debugged has its own set, scope
     "debugger", sent on its session: the user's breakpoints with their
     conditions, and the window's run-to points while they live. Returns the
     points SAP placed. */
  async function scoped(list) {
    const client = session.client, user = sap.user;
    const wanted = list.map(b => b.url + "#start=" + b.line);
    let answer = await client.debuggerSetBreakpoints("user", terminalId, ideId, "vertex", wanted, user, "debugger");
    let placed = answer.filter(a => a.uri);
    if (list.some(b => b.condition)) {
      const withConditions = list.map(b => {
        const p = placed.find(a => a.uri.uri === b.url && a.uri.range.start.line === b.line);
        return p && b.condition ? { ...p, condition: b.condition } : p;
      }).filter(Boolean);
      answer = await client.debuggerSetBreakpoints("user", terminalId, ideId, "vertex", withConditions, user, "debugger");
      placed = answer.filter(a => a.uri);
    }
    return placed;
  }
  /* A change to the user's breakpoints reaches the program stopped now too. */
  function rescope() {
    return exclusive(async () => { if (session) { await scoped(breakpoints); } }).catch(() => {});
  }

  async function setBreakpoint({ object_type, name, line, condition, mode, take_over, function_group }) {
    if (!name || !(Number(line) > 0)) { throw new Error("A breakpoint needs the object's name and a line number."); }
    if (mode && mode !== "stop" && mode !== "log") { throw new Error('mode is "stop" or "log".'); }
    const url = sourceUrl(object_type, name, function_group);
    await system();                  // the system is settled before the list changes
    const existing = breakpoints.find(b => b.url === url && b.line === Number(line));
    const entry = existing || { id: "bp" + (++numbered), objectType: String(object_type || "PROG").toUpperCase(),
      name: String(name).toUpperCase(), url, line: Number(line) };
    entry.condition = condition ? String(condition) : "";
    entry.mode = mode || "stop";
    if (!existing) { breakpoints.push(entry); }
    const errors = await sync();
    if (!entry.adt) {
      breakpoints.splice(breakpoints.indexOf(entry), 1);
      await sync();
      throw new Error("SAP did not accept the breakpoint at " + entry.name + " line " + entry.line
        + (errors.length ? ": " + errors.join("; ") : ". Is the line executable and the object active?"));
    }
    await rescope();
    changed();
    await listen(take_over === true);
    return entry;
  }

  /* The window sets a breakpoint by the source it shows. */
  async function setBreakpointAt({ url, line, condition, mode, take_over }) {
    const object = objectOf(url);
    if (!object) { throw new Error("A breakpoint cannot be set in this source from here: " + url); }
    return setBreakpoint({ object_type: object.objectType, name: object.name, function_group: object.group,
      line, condition, mode, take_over });
  }

  async function clearBreakpoints(id) {
    if (id) {
      const at = breakpoints.findIndex(b => b.id === id);
      if (at < 0) { throw new Error("There is no breakpoint " + id + "."); }
      breakpoints.splice(at, 1);
    } else {
      breakpoints.length = 0;
    }
    await sync();
    await rescope();
    changed();
  }

  /* ---------- the listener ---------- */

  /* Another debugger listening for the same user takes every hit. It is found
     before listening, and not taken over unless the assistant was told to by
     the user. */
  async function listen(takeOver) {
    if (listening) { return; }
    const { listener, user } = await system();
    try {
      await listener.debuggerListeners("user", terminalId, ideId, user);
    } catch (error) {
      const text = error && error.properties && error.properties.conflictText;
      if (!/conflict/i.test(String(error && error.type)) && !text) { throw error; }
      if (!takeOver) {
        throw new Error("Another debugger already listens for " + user + (text ? ": " + text : "")
          + ". It would take the stops. Ask the user to close it (Eclipse, ABAP FS) - or, only if the user agrees, set the breakpoint again with take_over.");
      }
      await listener.debuggerDeleteListener("user", terminalId, "", user).catch(() => {});
    }
    listening = true; stopListening = false;
    loop().catch(error => { problems.push("The listener stopped: " + (error && error.message || error)); listening = false; wake(); });
  }

  async function loop() {
    const { listener, user } = await system();
    while (!stopListening) {
      if (session) { await new Promise(resolve => waiters.push(resolve)); continue; }
      const hit = await listener.debuggerListen("user", terminalId, ideId, user);
      if (stopListening) { break; }
      if (!hit) { continue; }                      // the long poll ran out; ask again
      if (!hit.DEBUGGEE_ID) {
        problems.push("The listener was ended by SAP: " + (hit.conflictText || (hit.message && hit.message.text) || JSON.stringify(hit)));
        break;
      }
      await exclusive(() => attach(hit)).catch(error => { problems.push("Could not attach to the stopped program: " + (error && error.message || error)); session = null; });
      wake();
    }
    listening = false;
  }

  /* ---------- a stopped program ---------- */

  async function attach(hit) {
    const { open, user } = await system();
    const client = await open();                     // a stateful session of its own
    session = { client, debuggee: hit, program: hit.PRG_CURR };
    values = new Map();
    await client.debuggerAttach("user", hit.DEBUGGEE_ID, user, true);
    await arrive(null);
  }

  /* Where the program now stands. A "log" breakpoint is recorded and the
     program runs on; anything else waits for the assistant. */
  /* quick: a step of the window's Visual run, which reads no variables - the
     line and the stack only. What changed is then reported at the next
     ordinary stop, against the last values read. A log breakpoint met on the
     way is still recorded, and the run goes on step by step, not by continue. */
  async function arrive(step, quick) {
    for (;;) {
      const stack = await session.client.debuggerStackTrace();
      const top = stack.stack[0];
      const ids = (step && step.reachedBreakpoints || []).map(r => r.id);
      const bp = breakpoints.find(b => b.adt && ids.indexOf(b.adt.id) >= 0)
        || breakpoints.find(b => top && b.adt && b.line === top.line && top.uri && top.uri.uri === b.url);
      const unresolved = (step && step.reachedBreakpoints || []).find(r => r.unresolvableCondition);
      const logs = bp && bp.mode === "log" && !unresolved;
      const state = quick && !logs
        ? { changed: undefined, tables: undefined, source: "",
          stack: stack.stack.slice(0, 6).map(f => where(f) + (f.eventName ? " " + f.eventType + " " + f.eventName : "")) }
        : await snapshot(stack);
      frames = stack.stack.map((f, n) => ({ n, label: where(f) + (f.eventName ? " " + f.eventType + " " + f.eventName : ""),
        url: f.uri && f.uri.uri || "", line: f.line, position: f.stackUri || f.stackPosition, current: n === 0,
        program: f.programName || "", include: f.includeName || "", system: f.systemProgram === true,
        unit: String(f.eventName || ""), unitType: String(f.eventType || "") }));
      if (logs) {
        logged.push({ n: logged.length + 1, breakpoint: bp.id, at: where(top), changed: state.changed });
        if (!quick) {
          try { step = await session.client.debuggerStep(STEPS.continue); }
          catch (error) { return end(error); }
          continue;
        }
      }
      stopped = { breakpoint: bp && !logs ? bp.id : null, at: where(top), stack: state.stack, source: state.source,
        changed: state.changed, tables: state.tables,
        note: quick ? "Reached by the Visual Debug window stepping without reading variables; what changed shows at the next ordinary stop." : undefined,
        problem: unresolved ? "SAP could not evaluate the condition: " + unresolved.unresolvableCondition : undefined };
      wake();
      return;
    }
  }

  function where(frame) {
    return frame ? String(frame.includeName || frame.programName) + ":" + frame.line : "?";
  }

  async function end(error) {
    const run = { program: session.program, logged: logged.length - loggedRead,
      note: error && error.message && !/exception was raised/i.test(error.message) ? error.message : "" };
    finished.push(run); ended++;
    await session.client.logout().catch(() => {});
    session = null; stopped = null; frames = [];
    wake();
  }

  /* The state at a stop: the stack, a few source lines, and the variables
     that changed since the last stop of this run - all of them at the first. */
  async function snapshot(stack) {
    const client = session.client;
    const tree = await client.debuggerChildVariables(["@ROOT"]);
    const found = await client.debuggerChildVariables(tree.hierarchies.map(h => h.CHILD_ID));
    const changed = {}, tables = {};
    for (const v of found.variables) {
      const shown = plain(v);
      const key = v.META_TYPE === "table" ? shown + "|" + v.VALUE : shown;
      if (values.get(v.NAME) === key) { continue; }
      values.set(v.NAME, key);
      changed[v.NAME] = shown;
      if (v.META_TYPE === "table" && Number(v.TABLE_LINES) > 0) { tables[v.NAME] = v; }
    }
    // The first rows of a table that changed: its shape, not its contents.
    const shownTables = {};
    for (const [name, v] of Object.entries(tables)) {
      shownTables[name] = await rows(client, v, 1, ROWS_SHOWN);
    }
    const top = stack.stack[0];
    return {
      changed, tables: shownTables,
      stack: stack.stack.slice(0, 6).map(f => where(f) + (f.eventName ? " " + f.eventType + " " + f.eventName : "")),
      source: top ? await lines(client, top) : ""
    };
  }

  async function lines(client, frame) {
    try {
      const text = await client.getObjectSource(frame.uri.uri);
      const all = text.split(/\r?\n/), at = frame.line;
      return all.slice(Math.max(0, at - 3), at + 2)
        .map((l, i) => { const n = Math.max(1, at - 2) + i; return (n === at ? "> " : "  ") + n + " " + l; }).join("\n");
    } catch (e) { return ""; }
  }

  /* Rows FROM..TO of a table, as objects when the row is a structure. */
  async function rows(client, v, from, to) {
    const count = Number(v.TABLE_LINES) || 0;
    const last = Math.min(count, to);
    if (from > last) { return { rows: count, shown: [] }; }
    const base = v.ID.replace(/\[\]$/, "");
    const keys = [];
    for (let i = from; i <= last; i++) { keys.push(base + "[" + i + "]"); }
    const read = await client.debuggerVariables(keys);
    const structured = read.filter(r => r.META_TYPE === "structure").map(r => r.ID);
    const fields = new Map();
    if (structured.length) {
      const inside = await client.debuggerChildVariables(structured);
      const byId = new Map(inside.variables.map(c => [c.ID, c]));
      for (const h of inside.hierarchies) {
        const c = byId.get(h.CHILD_ID);
        if (!c) { continue; }
        if (!fields.has(h.PARENT_ID)) { fields.set(h.PARENT_ID, {}); }
        fields.get(h.PARENT_ID)[c.NAME] = plain(c);
      }
    }
    return { rows: count, from, shown: read.map(r => r.META_TYPE === "structure" ? fields.get(r.ID) || {} : plain(r)) };
  }

  /* ---------- what the assistant calls ---------- */

  async function wait(seconds) {
    const limit = Math.min(Math.max(Number(seconds) || WAIT_DEFAULT, 1), WAIT_MOST) * 1000;
    const until = Date.now() + limit;
    while (!stopped && !finished.length && !problems.length && Date.now() < until) {
      await new Promise(resolve => { waiters.push(resolve); setTimeout(resolve, Math.min(1000, until - Date.now())); });
    }
    const news = { logged: logged.slice(loggedRead) };
    loggedRead = logged.length;
    if (problems.length) { news.problems = problems; problems = []; }
    if (finished.length) { news.finished = finished; finished = []; }
    if (stopped) { news.stopped = stopped; }
    if (!news.stopped && !news.finished && !news.problems) {
      news.waiting = listening ? "Still listening - nothing reached a stop breakpoint yet." : "Not listening: set a breakpoint first.";
    }
    return news;
  }

  function mustBeStopped() {
    if (!session || !stopped) { throw new Error("The program is not stopped. Wait for a stop with debug_wait first."); }
  }

  /* A step, without collecting the news: the window steps too, and what
     happened stays for the assistant's debug_wait. */
  /* expect: the line the window predicted from ACE's statement map, for a
     step from a plain statement to a plain one in the same include. Then the
     stack is not asked for - SAP's answer to a step does not say where the
     program is - and the top frame moves to that line. A breakpoint SAP
     reports on the way makes it ask after all. */
  function advance(kind, quick, expect) {
    return exclusive(async () => {
      mustBeStopped();
      const type = STEPS[kind || "over"];
      if (!type) { throw new Error('step is "over", "into", "out" or "continue".'); }
      const before = stopped;
      stopped = null;
      let result;
      // How long SAP took for the step itself, and for the whole of it here.
      const started = Date.now();
      try { result = await session.client.debuggerStep(type); }
      catch (error) { await end(error); return { sap: Date.now() - started, total: Date.now() - started, ended: true }; }
      const sap = Date.now() - started;
      if (quick === true && expect && Number(expect.line) > 0 && frames.length
        && !(expect.leave && frames.length < 2)
        && !(result && result.reachedBreakpoints && result.reachedBreakpoints.length)) {
        // Into a FORM: a frame of its own, known only from the map - no stack
        // position to switch to until SAP is asked. Out of it: the frame goes.
        if (expect.enter) {
          const e = expect.enter;
          frames.unshift({ label: String(e.label || ""), url: String(e.url || ""), line: Number(expect.line),
            include: String(e.include || ""), program: String(e.program || ""), system: false, position: undefined });
        } else if (expect.leave) {
          frames.shift();
        }
        frames.forEach((f, n) => { f.n = n; });
        const top = frames[0];
        top.line = Number(expect.line);
        top.label = String(top.label).replace(/:\d+/, ":" + top.line);
        frames.forEach(f => { f.current = f === top; });
        stopped = { breakpoint: null, at: top.label.split(" ")[0], stack: frames.slice(0, 6).map(f => f.label),
          source: "", note: (before && before.note) || "", predicted: true };
        wake();
        return { sap, total: Date.now() - started, predicted: true };
      }
      await arrive(result, quick === true);
      return { sap, total: Date.now() - started };
    });
  }

  /* Run on to a line - or to the first of several that the program reaches -
     as F8 to breakpoints set there for the one run: a loop is passed in one
     go, a routine left at its next call. A breakpoint of the user's on the
     way stops it, as F8 would. The points are taken away before the stop is
     read, so none is ever mistaken for one of theirs. */
  function runTo(url, lines) {
    return exclusive(async () => {
      mustBeStopped();
      const at = String(url).split("#")[0];
      temporaries = [].concat(lines).map(Number).filter((n, i, all) => n > 0 && all.indexOf(n) === i)
        .map((n, i) => ({ id: "run-to-" + i, url: at, line: n }));
      // Into the stopped program's own set, beside the user's breakpoints.
      let set;
      try { set = await scoped(breakpoints.concat(temporaries)); } catch (error) { temporaries = []; throw error; }
      const placed = temporaries.filter(t => set.some(a => a.uri.uri === t.url && a.uri.range.start.line === t.line)).length;
      temporaries = [];
      if (!placed) { await scoped(breakpoints); return { placed: 0 }; }
      stopped = null;
      const started = Date.now();
      let result;
      try { result = await session.client.debuggerStep(STEPS.continue); }
      catch (error) {
        await end(error);
        return { placed, sap: Date.now() - started, total: Date.now() - started, ended: true };
      }
      const sap = Date.now() - started;
      // Gone before the stop is read, so it is never taken for the user's.
      await scoped(breakpoints);
      await arrive(result, true);
      return { placed, sap, total: Date.now() - started };
    });
  }

  /* After predicted steps, ask SAP where the program really stands: the
     stack as it is, with positions a click on a level can use. */
  function settle() {
    return exclusive(async () => {
      if (!session || !stopped || !stopped.predicted) { return false; }
      stopped = null;
      await arrive(null, true);
      return true;
    });
  }

  /* End the stopped program here, as the debugger's Exit does - the rest of
     it does not run. The breakpoints stay and the listener waits for the
     next run. */
  function terminate() {
    return exclusive(async () => {
      mustBeStopped();
      stopped = null;
      await session.client.debuggerStep("terminateDebuggee").catch(() => {});
      await end({ message: "Terminated from the Visual Debug window." });
    });
  }

  /* Variables by name, as the window lists them - for reading again only
     what a statement named. */
  function variables(names) {
    return exclusive(async () => {
      mustBeStopped();
      const list = (names || []).map(n => String(n).toUpperCase()).filter(Boolean);
      if (!list.length) { return []; }
      const found = await session.client.debuggerVariables(list);
      return found.filter(Boolean).map(shown);
    });
  }

  async function step(kind) {
    await advance(kind);
    return wait(1);
  }

  function read(name, from, to) { return exclusive(() => readNow(name, from, to)); }
  async function readNow(name, from, to) {
    mustBeStopped();
    const client = session.client;
    const [v] = await client.debuggerVariables([String(name).toUpperCase()]);
    if (!v) { throw new Error("The program has no variable " + name + " here."); }
    if (v.META_TYPE === "table") {
      const first = Math.max(1, Number(from) || 1);
      return { name: v.NAME, type: v.ACTUAL_TYPE_NAME || v.DECLARED_TYPE_NAME,
        ...(await rows(client, v, first, Math.min(Number(to) || first + 49, first + ROWS_READ - 1))) };
    }
    if (v.META_TYPE === "structure") {
      const inside = await client.debuggerChildVariables([v.ID]);
      const fields = {};
      inside.variables.forEach(c => { fields[c.NAME] = plain(c); });
      return { name: v.NAME, type: v.ACTUAL_TYPE_NAME || v.DECLARED_TYPE_NAME, fields };
    }
    return { name: v.NAME, type: v.ACTUAL_TYPE_NAME || v.DECLARED_TYPE_NAME || v.TECHNICAL_TYPE, value: plain(v) };
  }

  /* A program is started in SE38. A function module or a class has no run
     of its own: its test screen opens - SE37 or SE24 with the name filled in
     - and the user starts the test there (F8) with the data it asks for. */
  async function run(program, test) {
    const { system: target } = await system();
    const name = String(program).toUpperCase();
    if (!/^[A-Z0-9_/]+$/.test(name)) { throw new Error("Not an object name: " + program); }
    const kind = String(test || "").toUpperCase();
    const transaction = kind === "FUNC" ? "SE37 RS38L-NAME=" + name
      : kind === "CLAS" ? "SE24 SEOCLASS-CLSNAME=" + name
      : kind ? null : "*SE38 RS38M-PROGRAMM=" + name + ";DYNP_OKCODE=STRT";
    if (!transaction) { throw new Error("A test run is for a function module or a class, not " + test + "."); }
    if (!breakpoints.length) { throw new Error("Set a breakpoint before running: without one nothing will stop."); }
    // A system can name its own WebGUI address: SAP may redirect its HTTP
    // port to an HTTPS host name this machine does not resolve.
    const address = target.webgui || target.url;
    if (!/^https?:\/\/[^/\s]+/i.test(String(address))) {
      throw new Error("The WebGUI address of " + target.name + " is not an http(s) URL: " + address + ". Check webgui in vertex.systems.");
    }
    const base = String(address).replace(/\/$/, "");
    const url = base + "/sap/bc/gui/sap/its/webgui?~transaction=" + encodeURIComponent(transaction)
      + "&sap-client=" + encodeURIComponent(target.client || "") + "&sap-language=EN";
    await openUrl(url);
    return url;
  }

  /* Let the program go, stop listening and take every breakpoint away. */
  async function stop() {
    stopListening = true;
    await exclusive(async () => {
      if (!session) { return; }
      await session.client.debuggerStep(STEPS.continue).catch(() => {});
      await session.client.logout().catch(() => {});
      session = null; stopped = null; frames = [];
    });
    wake();
    if (sap) {
      const { listener, user } = sap;
      await listener.debuggerDeleteListener("user", terminalId, ideId, user).catch(() => {});
      breakpoints.length = 0;
      await sync(sap).catch(() => {});
    }
    listening = false;
    changed();
  }

  /* ---------- what the Visual Debug window reads ---------- */

  /* Everything the window draws, read without taking the assistant's news. */
  function picture() {
    return {
      system: sap ? sap.system.name : "", listening, ended,
      breakpoints: breakpoints.map(b => ({ id: b.id, objectType: b.objectType, name: b.name, url: b.url, line: b.line,
        condition: b.condition || "", mode: b.mode })),
      stopped: stopped ? { at: stopped.at, breakpoint: stopped.breakpoint, problem: stopped.problem || "", frames,
        predicted: stopped.predicted === true } : null
    };
  }

  /* A variable as the window lists it: enough to draw a row and to ask for
     what is inside. */
  function shown(v) {
    return { id: v.ID, name: v.NAME, meta: v.META_TYPE, type: v.ACTUAL_TYPE_NAME || v.DECLARED_TYPE_NAME || v.TECHNICAL_TYPE || "",
      technical: v.TECHNICAL_TYPE || "",
      value: plain(v), lines: v.META_TYPE === "table" ? Number(v.TABLE_LINES) || 0 : undefined,
      access: /^(public|protected|private)$/i.test(v.ACCESS_KIND || "") ? String(v.ACCESS_KIND).toLowerCase() : undefined };
  }

  /* The scopes SAP groups the variables in - by SAP's own names - and SY,
     which none of them holds. */
  function scopes(withSy) {
    return exclusive(async () => {
      mustBeStopped();
      const client = session.client;
      const root = await client.debuggerChildVariables(["@ROOT"]);
      const groups = root.hierarchies.filter(h => h.PARENT_ID === "@ROOT")
        .map(h => ({ id: h.CHILD_ID, name: h.CHILD_NAME || String(h.CHILD_ID).replace(/^@/, "") }));
      // SY only when the window shows it: one request less at every stop.
      const [sy] = withSy === false ? [] : await client.debuggerVariables(["SY"]);
      return { groups, sy: sy ? shown(sy) : null };
    });
  }

  /* What is inside a scope, a structure or an object. */
  function children(id) {
    return exclusive(async () => {
      mustBeStopped();
      // One parent asked for: every variable that comes back is its own.
      const found = await session.client.debuggerChildVariables([String(id)]);
      return found.variables.map(shown);
    });
  }

  /* Rows FROM..TO of a table, for its grid. */
  function tableRows(id, from, to) {
    return exclusive(async () => {
      mustBeStopped();
      const client = session.client;
      // A table's ID ends in [] - its body; the table itself is read by the rest.
      const [v] = await client.debuggerVariables([String(id).replace(/\[\]$/, "")]);
      if (!v || v.META_TYPE !== "table") { throw new Error(id + " is not a table here."); }
      const first = Math.max(1, Number(from) || 1);
      return { id: v.ID, name: v.NAME, type: v.ACTUAL_TYPE_NAME || v.DECLARED_TYPE_NAME,
        ...(await rows(client, v, first, Math.min(Number(to) || first + 99, first + ROWS_READ - 1))) };
    });
  }

  /* Make a level of the stack the one the variables are read on. */
  function frame(n) {
    return exclusive(async () => {
      mustBeStopped();
      const f = frames[Number(n)];
      if (!f) { throw new Error("There is no stack level " + n + "."); }
      if (stopped.predicted) { throw new Error("This stack was predicted, not read: its levels can be chosen at the next stop that asks SAP."); }
      await session.client.debuggerGoToStack(f.position);
      frames.forEach(x => { x.current = x === f; });
      changed();
    });
  }

  /* The active source at a URL - what the program runs, which is what the
     breakpoint lines count in. The stateless connection reads it. */
  async function source(url) {
    const { listener } = await system();
    return listener.getObjectSource(String(url).split("#")[0], { version: "active" });
  }

  /* Where each method of a global class starts in its main source, as ADT's
     class structure says: METHOD name -> line. What a stack frame of the
     class counts its lines in, SAP's own answer rather than a reading of the text. */
  const methodLines = new Map();
  async function classMethods(url) {
    const object = String(url).split("#")[0].replace(/\/source\/main$/, "");
    if (methodLines.has(object)) { return methodLines.get(object); }
    const { listener } = await system();
    const root = await listener.classComponents(object);
    const found = {};
    (function walk(node) {
      if (!node) { return; }
      if (/^CLAS\/OM|^INTF\/IO/.test(String(node["adtcore:type"] || ""))) {
        const links = node.links || [];
        const link = links.find(l => /implementation/i.test(String(l.rel || "")) && /#start=\d+/.test(String(l.href || "")))
          || links.find(l => /#start=\d+/.test(String(l.href || "")) && /\/source\/main#/.test(String(l.href || "")));
        const at = link && /#start=(\d+)/.exec(String(link.href));
        if (at) { found[String(node["adtcore:name"]).toUpperCase()] = Number(at[1]); }
      }
      (node.components || []).forEach(walk);
    })(root);
    methodLines.set(object, found);
    return found;
  }

  function status() {
    return {
      system: sap ? sap.system.name + " / " + sap.user : "not connected yet",
      listening,
      stopped: stopped ? stopped.at : null,
      breakpoints: breakpoints.map(b => ({ id: b.id, at: b.name + ":" + b.line, mode: b.mode, condition: b.condition || undefined })),
      logged: logged.length,
      answers: answers.calls + " answers, " + answers.chars + " characters (about " + Math.round(answers.chars / 4) + " tokens)"
    };
  }

  function counted(text) { answers.calls++; answers.chars += text.length; return text; }

  return { setBreakpoint, clearBreakpoints, wait, step, read, run, stop, status, counted,
    log: () => logged.slice(),
    setBreakpointAt, advance, runTo, settle, terminate, watch, picture, scopes, children, variables, tableRows, frame, source,
    classMethods };
}

module.exports = { create, sourceUrl, objectOf, plain };
