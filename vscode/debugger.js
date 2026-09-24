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
function sourceUrl(objectType, name) {
  const lower = encodeURIComponent(String(name).toLowerCase());
  switch (String(objectType || "PROG").toUpperCase()) {
    case "PROG": return "/sap/bc/adt/programs/programs/" + lower + "/source/main";
    case "INCL": return "/sap/bc/adt/programs/includes/" + lower + "/source/main";
    case "CLAS": return "/sap/bc/adt/oo/classes/" + lower + "/source/main";
    default: throw new Error("A breakpoint goes into a PROG, an INCL or a CLAS; " + objectType + " is not supported yet.");
  }
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
  function wake() { const now = waiters; waiters = []; now.forEach(w => w()); }

  /* ---------- breakpoints ---------- */

  /* SAP keeps the whole set of this IDE's breakpoints: every change sends
     the full list. A condition is attached in a second round, as ABAP FS and
     Eclipse do - the line has to exist on the server before it can carry one. */
  async function sync(on) {
    const { listener, user } = on || await system();
    const wanted = breakpoints.map(b => b.url + "#start=" + b.line);
    let answer = await listener.debuggerSetBreakpoints("user", terminalId, ideId, "vertex", wanted, user, "external");
    const placed = answer.filter(a => a.uri);
    for (const b of breakpoints) {
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

  async function setBreakpoint({ object_type, name, line, condition, mode, take_over }) {
    if (!name || !(Number(line) > 0)) { throw new Error("A breakpoint needs the object's name and a line number."); }
    if (mode && mode !== "stop" && mode !== "log") { throw new Error('mode is "stop" or "log".'); }
    const url = sourceUrl(object_type, name);
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
    await listen(take_over === true);
    return entry;
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
      await attach(hit).catch(error => { problems.push("Could not attach to the stopped program: " + (error && error.message || error)); session = null; });
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
  async function arrive(step) {
    for (;;) {
      const stack = await session.client.debuggerStackTrace();
      const top = stack.stack[0];
      const ids = (step && step.reachedBreakpoints || []).map(r => r.id);
      const bp = breakpoints.find(b => b.adt && ids.indexOf(b.adt.id) >= 0)
        || breakpoints.find(b => top && b.adt && b.line === top.line && top.uri && top.uri.uri === b.url);
      const unresolved = (step && step.reachedBreakpoints || []).find(r => r.unresolvableCondition);
      const state = await snapshot(stack);
      if (bp && bp.mode === "log" && !unresolved) {
        logged.push({ n: logged.length + 1, breakpoint: bp.id, at: where(top), changed: state.changed });
        try { step = await session.client.debuggerStep(STEPS.continue); }
        catch (error) { return end(error); }
        continue;
      }
      stopped = { breakpoint: bp ? bp.id : null, at: where(top), stack: state.stack, source: state.source,
        changed: state.changed, tables: state.tables,
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
    finished.push(run);
    await session.client.logout().catch(() => {});
    session = null; stopped = null;
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

  async function step(kind) {
    mustBeStopped();
    const type = STEPS[kind || "over"];
    if (!type) { throw new Error('step is "over", "into", "out" or "continue".'); }
    stopped = null;
    let result;
    try { result = await session.client.debuggerStep(type); }
    catch (error) { await end(error); return wait(1); }
    await arrive(result);
    return wait(1);
  }

  async function read(name, from, to) {
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

  async function run(program) {
    const { system: target } = await system();
    if (!breakpoints.length) { throw new Error("Set a breakpoint before running: without one nothing will stop."); }
    // A system can name its own WebGUI address: SAP may redirect its HTTP
    // port to an HTTPS host name this machine does not resolve.
    const address = target.webgui || target.url;
    if (!/^https?:\/\/[^/\s]+/i.test(String(address))) {
      throw new Error("The WebGUI address of " + target.name + " is not an http(s) URL: " + address + ". Check webgui in vertex.systems.");
    }
    const base = String(address).replace(/\/$/, "");
    const url = base + "/sap/bc/gui/sap/its/webgui?~transaction=" + encodeURIComponent("*SE38 RS38M-PROGRAMM=" + String(program).toUpperCase() + ";DYNP_OKCODE=STRT")
      + "&sap-client=" + encodeURIComponent(target.client || "") + "&sap-language=EN";
    await openUrl(url);
    return url;
  }

  /* Let the program go, stop listening and take every breakpoint away. */
  async function stop() {
    stopListening = true;
    if (session) {
      await session.client.debuggerStep(STEPS.continue).catch(() => {});
      await session.client.logout().catch(() => {});
      session = null; stopped = null;
    }
    wake();
    if (sap) {
      const { listener, user } = sap;
      await listener.debuggerDeleteListener("user", terminalId, ideId, user).catch(() => {});
      breakpoints.length = 0;
      await sync(sap).catch(() => {});
    }
    listening = false;
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
    log: () => logged.slice() };
}

module.exports = { create, sourceUrl, plain };
