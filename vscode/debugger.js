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
const DUMPS_EVERY = 10000;     // how often a waiting caller asks SAP for new dumps
const DUMPS_AFTER_END = 3;     // tries for the dump of a run that just died; only the first is awaited
const DUMPS_SETTLE = 1500;     // SAP formats the short dump after the program is gone

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
  // Where the reader is debugging from, so a stop is followed there and
  // nowhere else: the editor, or a VERTEX window that shows the source
  // itself. Whoever drives the debugger says so; the assistant changes
  // nothing, because it has no window of its own to navigate.
  let driver = "editor";
  // Said once per attach, by the window as well as to the assistant: a
  // breakpoint the session never took is one the reader can see and trust
  // for nothing.
  let unplaced = "";
  /* ST22 is the only place a run that died of a dump says so: the step throws
     the same way it throws when the program simply finished. Every dump that
     was already there when the run started is remembered, and anything of
     this user's that appears afterwards is new. Ids, not timestamps: the feed
     carries no time per entry, and the id is SAP's own. */
  let dumpsKnown = null;       // Set of dump ids present before the run
  let dumpsFound = [];         // new dumps not yet handed to the assistant
  let dumpsAsked = 0;          // when the feed was last read
  let ending = null;           // the last run that ended, for the window
  let dumpsTold = false;       // an unreadable dump feed is reported once
  let released = "";           // the program Detach let run on without us
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
  /* A stopped program holds the listener: LOOP does not listen while a
     session is attached, so every breakpoint set afterwards is dead until it
     is let go. A window closed on a stop used to leave exactly that, with
     nothing left on screen to say so. */
  async function release(why) {
    await exclusive(async () => {
      if (!session) { return; }
      await session.client.debuggerStep(STEPS.continue).catch(() => {});
      await session.client.logout().catch(() => {});
      session = null; stopped = null; frames = [];
    });
    // Out loud: letting a program go is not something to do quietly.
    problems.push(why);
    wake();
  }

  /* The windows showing this debugger. When the last of them goes while a
     program is stopped, that program is let go rather than left holding the
     listener - nobody is looking at it any more, and the breakpoints set
     afterwards would never be reached. An assistant debugging with no window
     open never had a watcher, so this cannot take a session from it. */
  function watch(fn) {
    watchers.add(fn);
    return () => {
      watchers.delete(fn);
      if (watchers.size || !session) { return; }
      const held = session.program || "a program";
      void release("The last Visual Debug window was closed while " + held
        + " was stopped, so it was let go: a stopped program holds the listener and no breakpoint would be reached."
        + " The breakpoints are still set.").catch(() => {});
    };
  }

  /* ---------- breakpoints ---------- */

  /* SAP keeps the whole set of this IDE's breakpoints: every change sends
     the full list. A condition is attached in a second round, as ABAP FS and
     Eclipse do - the line has to exist on the server before it can carry one. */
  async function sync(on) {
    const { listener, user } = on || await system();
    const all = breakpoints.filter(b => b.active !== false);
    for (const b of breakpoints) { if (b.active === false) { b.adt = null; } }
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
    // A deactivated breakpoint stays in the list and goes to no SAP scope.
    list = list.filter(b => b.active !== false);
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
    // What SAP placed, and - on the list it is given - what it did not: a
    // breakpoint missing from the session's own set stops nothing, and the
    // caller is the only one who can say so.
    placed.missing = list.filter(b => !placed.some(a => a.uri.uri === b.url && a.uri.range.start.line === b.line));
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
    entry.active = true;             // set again, a deactivated one is on again
    if (!existing) { breakpoints.push(entry); }
    const errors = await sync();
    if (!entry.adt) {
      breakpoints.splice(breakpoints.indexOf(entry), 1);
      await sync();
      // SAP says where it cannot put a point, not why that line is not what
      // the reader is looking at. The usual reason is that the editor shows
      // something the system has not activated, so the lines no longer agree -
      // the active line itself says that better than any guess.
      let active = "";
      try {
        const text = await source(url);
        const line = String(text || "").split(/\r?\n/)[entry.line - 1];
        active = line === undefined ? ". The active version has no line " + entry.line + "."
          : ". Line " + entry.line + " of the active version is: " + (line.trim() || "(blank)")
            + ". If the editor shows something else there, activate it first.";
      } catch (error) { active = ""; }
      throw new Error("SAP did not accept the breakpoint at " + entry.name + " line " + entry.line
        + (errors.length ? ": " + errors.join("; ") : "") + active);
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

  /* On or off without losing it: an inactive breakpoint keeps its line,
     condition and mode here and is not in SAP. No id: every one. */
  async function activateBreakpoints(id, active) {
    const list = id ? breakpoints.filter(b => b.id === id) : breakpoints;
    if (id && !list.length) { throw new Error("There is no breakpoint " + id + "."); }
    for (const b of list) { b.active = active !== false; }
    await sync();
    await rescope();
    changed();
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

  /* ---------- dumps ---------- */

  /* The feed of short dumps, read on the stateless probe session so that it
     never interleaves with the listener's long poll or a stopped program's
     stateful session. Failing to read it is reported as a problem of its own,
     never as "no dumps": a missing dump is exactly what this exists to catch. */
  async function feed() {
    const { probe, user } = await system();
    if (!probe || typeof probe.dumps !== "function") {
      throw new Error("This SAP connection has no dump feed (abap-adt-api without dumps()).");
    }
    const answer = await probe.dumps();
    return (answer && answer.dumps || []).filter(d => !d.author || String(d.author).toUpperCase() === user);
  }

  /* What is in ST22 before the run starts. Everything already there is this
     user's history, not what we are about to watch for. */
  async function markDumps() {
    try {
      const before = await feed();
      dumpsKnown = new Set(before.map(d => d.id));
    } catch (error) {
      dumpsKnown = null;
      // Said once, not on every listen: a caller waiting for a stop reads
      // problems as news and would be handed this instead of waiting, over
      // and over, for as long as the feed stays unreadable.
      if (!dumpsTold) {
        dumpsTold = true;
        problems.push("The dumps of " + (sap ? sap.system.name : "this system")
          + " could not be read, so a run that dies of one will not be reported: " + (error && error.message || error));
      }
    }
    dumpsAsked = Date.now();
  }

  /* New dumps of this user since markDumps. What it finds it also keeps, for
     the next debug_wait to hand over. */
  async function collectDumps() {
    dumpsAsked = Date.now();
    if (!dumpsKnown) { return []; }
    const now = await feed();
    const fresh = now.filter(d => !dumpsKnown.has(d.id));
    fresh.forEach(d => dumpsKnown.add(d.id));
    const shown = fresh.map(d => ({
      id: d.id,
      error: (d.categories || []).map(c => c.term).filter(Boolean).join(" ") || d.type || "",
      text: summaryOf(d.text).text,
      // SAP's whole dump page, kept for the reader who wants all of it. It
      // stays here rather than riding in every picture the window polls.
      page: String(d.text || ""),
      // SAP's own address for this dump. Nothing here follows it yet - it
      // needs an editor that registered the adt: scheme - but it is what
      // names the dump, so it travels rather than being thrown away.
      adt: summaryOf(d.text).adt,
      // The entry's own address on SAP, so the reader can open the full dump.
      at: (d.links || []).map(l => l.href).filter(Boolean)[0] || ""
    }));
    if (shown.length) { await locate(shown); dumpsFound = dumpsFound.concat(shown); }
    return shown;
  }

  /* ST22 keeps the dump as rows of SNAP, and its FLIST is a plain string of
     records: a two-letter tag, three digits of length, then that many
     characters. FC is the runtime error, AP the program, AI the include and
     AL the line - which is everything a reader needs to be taken there. The
     first value of a tag wins: later rows repeat tags for other frames. */
  /* The feed writes a dump's summary as HTML - a sentence, then SAP's own
     link into the runtime viewer. Shown as it arrives it reads as markup, so
     the sentence is taken out of it and the link is kept apart: it is an
     adt:// address, which only an editor that registered that scheme can
     follow, and VERTEX has not. */
  function summaryOf(html) {
    const raw = String(html || "");
    const link = /href="(adt:\/\/[^"]+)"/i.exec(raw);
    const plain = piece => String(piece)
      // An anchor's own words are the label of SAP's control, not part of
      // what the dump says: the whole element goes, not only its tags.
      .replace(/<a\s[^>]*>[\s\S]*?<\/a>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|tr|td|th|h\d)>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ").trim();
    const all = plain(raw);
    // A short summary is the sentence itself. A long one is the whole dump
    // page - contents, headings and all - and stripping its tags only turns
    // it into a run of navigation labels. The sentence in it sits under
    // "Short Text", so that is taken and nothing else; finding nothing shows
    // nothing, because the facts worth trusting come from SNAP, not from a
    // page whose shape SAP never promised.
    const short = /Short Text\s*(.+?)(?=\s*(?:What happened|Error analysis|How to correct|Trigger Location|Source Code Extract|Header Information|Contents)\b|$)/i.exec(all);
    const page = /\b(Header Information|Trigger Location|Source Code Extract)\b/i.test(all);
    const text = short ? short[1].trim().slice(0, 300) : (!page && all.length <= 200 ? all : "");
    return { text, adt: link ? link[1] : "" };
  }

  function flistTags(text) {
    const out = {};
    let i = 0;
    while (i + 5 <= text.length) {
      const tag = text.substring(i, i + 2), size = Number(text.substring(i + 2, i + 5));
      if (!/^[A-Z0-9]{2}$/.test(tag) || !Number.isInteger(size) || size < 0) { break; }
      if (out[tag] === undefined) { out[tag] = text.substring(i + 5, i + 5 + size).trim(); }
      i += 5 + size;
    }
    return out;
  }

  /* Where the newest dump of this user happened, read through VERTEX's own
     table resource - SNAP's FLIST is CHAR 200 with continuations, not a LOB,
     so it comes back as ordinary columns. This is the one part of the
     debugger that wants the ABAP backend; without it a dump is still
     reported, and says why it has no place to point at. */
  async function dumpWhere(day) {
    const { probe, user } = await system();
    const path = "/sap/bc/adt/vertex/table/SNAP?rows=60"
      + "&f1=DATUM&s1=I&o1=EQ&l1=" + encodeURIComponent(day)
      + "&f2=UNAME&s2=I&o2=EQ&l2=" + encodeURIComponent(user)
      + "&f3=SEQNO&s3=I&o3=EQ&l3=000";
    const answer = await probe.httpClient.request(path, { method: "GET", headers: { Accept: "application/json" } });
    const data = JSON.parse(answer.body);
    if (!Array.isArray(data.rows) || !data.rows.length) { return null; }
    const field = (row, key) => row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()] ?? "";
    // Newest first: the dump that has just been written is the one being asked about.
    const row = data.rows.slice().sort((a, b) => String(field(b, "UZEIT")).localeCompare(String(field(a, "UZEIT"))))[0];
    let flist = String(field(row, "FLIST"));
    for (let n = 2; n <= 8; n++) { flist += String(field(row, "FLIST0" + n)); }
    const tags = flistTags(flist);
    if (!tags.AI && !tags.AP) { return null; }
    const include = tags.AI || tags.AP;
    return { error: tags.FC || "", program: (tags.AP || "").replace(/=+CP$/, ""),
      include, line: Number(tags.AL) || 0, url: sourceUrl("INCL", include) };
  }

  /* What ST22 knows about the dumps just found, added to each of them. The
     dump itself is already reported; this only decides whether it can be
     clicked, so a backend that is not there costs the place, not the dump. */
  async function locate(found) {
    if (!found.length) { return; }
    const day = new Date();
    const stamp = String(day.getFullYear())
      + String(day.getMonth() + 1).padStart(2, "0") + String(day.getDate()).padStart(2, "0");
    try {
      const at = await dumpWhere(stamp);
      if (at) { found.forEach(one => { one.where = at; }); }
    } catch (error) {
      found.forEach(one => {
        one.whyNoPlace = "ST22's own table could not be read, so this dump has no line to open: "
          + (error && error.message || error);
      });
    }
  }

  /* A run has just died. The feed is asked once, now, because the answer
     belongs in the answer to the step that killed it - and a program that
     merely finished must not pay for the question. SAP writes the short dump
     after the program is gone ("short dump is being formatted"), so if the
     first ask comes up empty the rest are left to run on their own: what they
     find reaches the assistant through the next debug_wait, and the window
     through wake(). Never await those - a normal end would wait seconds for a
     dump that is not coming. */
  async function dumpOfDeadRun(run) {
    try {
      const found = await collectDumps();
      if (found.length) { return found; }
    } catch (error) {
      problems.push("The dumps could not be read after the run ended: " + (error && error.message || error));
      return [];
    }
    (async function later() {
      for (let n = 1; n < DUMPS_AFTER_END; n++) {
        await new Promise(resolve => setTimeout(resolve, DUMPS_SETTLE));
        if (stopListening) { return; }
        const found = await collectDumps();
        if (found.length) { tellDumped(run, found); wake(); return; }
      }
    })().catch(error => {
      problems.push("The dumps could not be read after the run ended: " + (error && error.message || error));
      wake();
    });
    return [];
  }

  /* A dump found when no run of ours ended - after Detach, or because the
     reader asked. It is shown the way an ending is: the window and the
     assistant have one shape to read, whoever let the program go. */
  function announce(found, program) {
    ending = { program: program || "",
      note: "The program did not finish - it dumped: " + found.map(d => d.error || d.text).join("; "),
      dumped: found };
    wake();
  }

  /* ST22, now, because somebody asked. Nothing here is on a timer: after
     Detach the program runs on without us and there is no stop and no step
     to hang a question on, so the question is the reader's to ask. */
  async function checkDumps() {
    if (!dumpsKnown) {
      throw new Error("ST22 was not read when the run started, so there is nothing to compare against."
        + " Set a breakpoint or start a run first.");
    }
    const found = await collectDumps();
    if (found.length) { announce(found, released || (ending && ending.program) || ""); }
    return { found, since: "the run started", program: released || "" };
  }

  /* What a run says once ST22 has named its ending. */
  function tellDumped(run, dumped) {
    run.dumped = dumped;
    run.note = "The program did not finish - it dumped: " + dumped.map(d => d.error || d.text).join("; ");
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
    // The long poll goes first and nothing is allowed in front of it. A
    // breakpoint stops nothing while no listener waits, so an HTTP round trip
    // taken before this one is a window in which a run is missed - which is
    // what reading ST22 for the baseline did when it was awaited here.
    loop().catch(error => { problems.push("The listener stopped: " + (error && error.message || error)); listening = false; wake(); });
    void markDumps();
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
    unplaced = "";
    values = new Map();
    await client.debuggerAttach("user", hit.DEBUGGEE_ID, user, true);
    // The breakpoints that caught this run are SAP's "external" set, which
    // is for runs to come. The program now attached has a set of its own,
    // scope "debugger", and until the user's points are in it a Continue
    // runs past them. ADT sends them right after attaching; so does this.
    // A point SAP would not place is named rather than silently lost - the
    // reader has a breakpoint on screen that nothing will stop at.
    try {
      const missed = (await scoped(breakpoints)).missing || [];
      if (missed.length) {
        unplaced = "SAP did not place " + missed.length + " breakpoint"
          + (missed.length > 1 ? "s" : "") + " in this program, so it will not stop at "
          + (missed.length > 1 ? "them" : "it") + ": " + missed.map(b => b.name + ":" + b.line).join(", ");
        problems.push(unplaced + ".");
      }
    } catch (error) {
      unplaced = "The breakpoints could not be sent to this program, so it may not stop at them: "
        + (error && error.message || error);
      problems.push(unplaced + ".");
    }
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
        problem: unresolved ? "SAP could not evaluate the condition: " + unresolved.unresolvableCondition : (unplaced || undefined) };
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
    finished.push(run); ended++; ending = run;
    await session.client.logout().catch(() => {});
    session = null; stopped = null; frames = [];
    wake();
    // The step threw because the program is gone. Whether it finished or died
    // is not in that error - a step into a class whose load fails throws just
    // like the last continue of a program that ran to its end. ST22 is where
    // the difference is written down.
    const dumped = await dumpOfDeadRun(run);
    if (dumped.length) { tellDumped(run, dumped); wake(); }
    return run;
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
    while (!stopped && !finished.length && !problems.length && !dumpsFound.length && Date.now() < until) {
      await new Promise(resolve => { waiters.push(resolve); setTimeout(resolve, Math.min(1000, until - Date.now())); });
      // A program that dies before it reaches a breakpoint never stops and
      // never steps, so nothing else here would ever hear of it. ST22 is
      // asked while a caller waits, and only while one waits.
      if (listening && !session && Date.now() - dumpsAsked >= DUMPS_EVERY) {
        try { await collectDumps(); }
        catch (error) { problems.push("The dumps could not be read: " + (error && error.message || error)); }
      }
    }
    const news = { logged: logged.slice(loggedRead) };
    loggedRead = logged.length;
    if (problems.length) { news.problems = problems; problems = []; }
    if (finished.length) { news.finished = finished; finished = []; }
    if (dumpsFound.length) { news.dumps = dumpsFound; dumpsFound = []; }
    if (stopped) { news.stopped = stopped; }
    if (!news.stopped && !news.finished && !news.problems && !news.dumps) {
      news.waiting = listening ? "Still listening - nothing reached a stop breakpoint yet." : "Not listening: set a breakpoint first.";
    }
    return news;
  }

  function mustBeStopped() {
    // Said to a window as much as to the assistant, so it names no tool: what
    // is true is that nothing is standing still to be asked about.
    if (!session || !stopped) { throw new Error("The program is not stopped - it has ended, or has not reached a breakpoint yet."); }
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
      catch (error) {
        // The step killed the run. END already asked ST22 why, so the answer
        // to this very call can say whether it finished or dumped.
        const run = await end(error);
        return { sap: Date.now() - started, total: Date.now() - started, ended: true,
          dumped: run.dumped, note: run.note || undefined };
      }
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
        const run = await end(error);
        return { placed, sap: Date.now() - started, total: Date.now() - started, ended: true,
          dumped: run.dumped, note: run.note || undefined };
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
    if (!breakpoints.some(b => b.active !== false)) { throw new Error("Set or activate a breakpoint before running: without one nothing will stop."); }
    // After Detach the breakpoints are kept here but not in SAP, and nothing
    // listens: both come back before the run starts.
    if (!listening) { await sync(); await listen(false); }
    // Everything in ST22 up to now is history; from here a dump belongs to
    // this run until something proves otherwise.
    await markDumps();
    const url = webgui(target, transaction);
    await openUrl(url);
    return url;
  }

  /* A WebGUI address for a transaction. A system can name its own: SAP may
     redirect its HTTP port to an HTTPS host name this machine does not
     resolve. */
  function webgui(target, transaction) {
    const address = target.webgui || target.url;
    if (!/^https?:\/\/[^/\s]+/i.test(String(address))) {
      throw new Error("The WebGUI address of " + target.name + " is not an http(s) URL: " + address + ". Check webgui in vertex.systems.");
    }
    return String(address).replace(/\/$/, "") + "/sap/bc/gui/sap/its/webgui?~transaction=" + encodeURIComponent(transaction)
      + "&sap-client=" + encodeURIComponent(target.client || "") + "&sap-language=EN";
  }

  /* SAP's own dump page, as it came from the feed, for the id asked for. */
  function dumpPage(id) {
    const all = finished.reduce((list, run) => list.concat(run.dumped || []), [])
      .concat(dumpsFound, ending ? (ending.dumped || []) : []);
    const one = all.find(d => d && d.id === id) || all[all.length - 1];
    return { id: one ? one.id : "", page: one ? one.page || "" : "" };
  }

  /* The dump itself, in SAP. The feed's own address is an ADT resource, not a
     page a browser can show, so the reader is taken to ST22 - where the dump
     of a moment ago is the first entry. */
  async function openDump() {
    const { system: target } = await system();
    const url = webgui(target, "ST22");
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

  /* Let the program go and stop listening, as stop does, but keep the
     breakpoints for the next run: SAP forgets them, this list does not. */
  async function detach() {
    const kept = breakpoints.map(b => ({ ...b, adt: null }));
    // What is being let go. Detach continues the program and stops listening,
    // so nothing of ours will ever hear how it ended.
    const letGo = session ? session.program : "";
    await stop();
    breakpoints.push(...kept);
    changed();
    if (!letGo || !dumpsKnown) { return; }
    released = letGo;
    // A program let go usually dies at once if it is going to. One look,
    // unawaited so Detach answers immediately; anything later is the
    // reader's to ask for.
    (async function () {
      await new Promise(resolve => setTimeout(resolve, DUMPS_SETTLE));
      const found = await collectDumps();
      if (found.length) { announce(found, letGo); }
    })().catch(error => {
      problems.push("The dumps could not be read after Detach: " + (error && error.message || error));
      wake();
    });
  }

  /* ---------- what the Visual Debug window reads ---------- */

  /* Everything the window draws, read without taking the assistant's news. */
  function picture() {
    return {
      system: sap ? sap.system.name : "", listening, ended,
      // What the last run ended of. The window counts endings and cannot tell
      // a dump from an ordinary finish; ST22 can, and the debugger has asked
      // it. The run is passed by reference, so a dump found by a later try
      // reaches the window on the next wake, without it asking again.
      ending: ending ? { program: ending.program, note: ending.note || "",
        dumped: (ending.dumped || []).map(d => ({ id: d.id, error: d.error, text: d.text,
        where: d.where || null, whyNoPlace: d.whyNoPlace || "",
        hasPage: !!d.page })) } : null,
      breakpoints: breakpoints.map(b => ({ id: b.id, objectType: b.objectType, name: b.name, url: b.url, line: b.line,
        condition: b.condition || "", mode: b.mode, active: b.active !== false })),
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
  // Kept between calls, but the source behind it can change while the extension lives (a class pulled again
  // moves its methods): a caller that starts a record or an analysis asks for it fresh.
  async function classMethods(url, options = {}) {
    const object = String(url).split("#")[0].replace(/\/source\/main$/, "");
    if (!options.fresh && methodLines.has(object)) { return methodLines.get(object); }
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
      breakpoints: breakpoints.map(b => ({ id: b.id, at: b.name + ":" + b.line, mode: b.mode, condition: b.condition || undefined,
        inactive: b.active === false || undefined })),
      logged: logged.length,
      dumps: dumpsKnown ? dumpsFound.length : "not watched - the feed could not be read",
      answers: answers.calls + " answers, " + answers.chars + " characters (about " + Math.round(answers.chars / 4) + " tokens)"
    };
  }

  function counted(text) { answers.calls++; answers.chars += text.length; return text; }

  function drivenBy(name) { if (name === "editor" || name === "window") { driver = name; } }
  function drivenFrom() { return driver; }
  return { drivenBy, drivenFrom,
    setBreakpoint, clearBreakpoints, activateBreakpoints, wait, step, read, run, openDump, dumpPage, checkDumps, stop, detach, status, counted,
    log: () => logged.slice(),
    setBreakpointAt, advance, runTo, settle, terminate, watch, picture, scopes, children, variables, tableRows, frame, source,
    classMethods };
}

module.exports = { create, sourceUrl, objectOf, plain };
