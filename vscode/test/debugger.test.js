"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { create, sourceUrl } = require("../debugger");

const URL_MAIN = "/sap/bc/adt/programs/programs/z_calc/source/main";

/* A fake SAP: the program stops at the lines in STOPS in turn, then ends.
   Each stop carries the variables the program has there. */
function fakeSap({ stops = [], conflict = false } = {}) {
  const calls = [], sent = [];
  let released = null, position = -1;
  const hit = { DEBUGGEE_ID: "D1", PRG_CURR: "Z_CALC", INCL_CURR: "Z_CALC", LINE_CURR: stops[0] && stops[0].line };
  let delivered = false;
  const listener = {
    async debuggerSetBreakpoints(mode, terminal, ide, clientId, bps) {
      sent.push(bps);
      return bps.map((b, i) => {
        const text = typeof b === "string" ? b : b.uri.uri + "#start=" + b.uri.range.start.line;
        const [uri, start] = text.split("#start=");
        if (Number(start) === 999) { return { kind: "line", clientId, errorMessage: "Line 999 is not executable", nonAbapFlavour: "" }; }
        return { kind: "line", clientId, id: "BP" + start, uri: { uri, range: { start: { line: Number(start) } } },
          ...(typeof b === "string" ? {} : { condition: b.condition }) };
      });
    },
    async debuggerListeners() {
      if (conflict) { const e = new Error("conflict"); e.type = "conflictDetected"; e.properties = { conflictText: "Eclipse of SYCHOV" }; throw e; }
    },
    async debuggerListen() {
      if (!delivered && stops.length) { delivered = true; return hit; }
      await new Promise(resolve => { released = resolve; });
      return undefined;
    },
    async debuggerDeleteListener() { calls.push("deleteListener"); if (released) { released(); } }
  };
  const vars = () => stops[position].vars;
  const session = {
    stateful: "stateful",
    async debuggerAttach() { calls.push("attach"); position = 0; return {}; },
    async debuggerStackTrace() {
      const s = stops[position];
      return { stack: [{ programName: "Z_CALC", includeName: "Z_CALC", line: s.line, eventType: "EVENT", eventName: "START-OF-SELECTION", uri: { uri: URL_MAIN } }] };
    },
    async debuggerChildVariables(parents) {
      calls.push("children");
      if (parents[0] === "@ROOT") { return { hierarchies: [{ PARENT_ID: "@ROOT", CHILD_ID: "@GLOBALS" }], variables: [] }; }
      if (parents[0] === "@GLOBALS") { return { hierarchies: [], variables: vars() }; }
      // Components of structured rows: LT_ORDERS[n] -> CUSTOMER
      return { hierarchies: parents.map(p => ({ PARENT_ID: p, CHILD_ID: p + "-CUSTOMER" })),
        variables: parents.map(p => ({ ID: p + "-CUSTOMER", NAME: "CUSTOMER", META_TYPE: "simple", VALUE: "CUST_" + p.slice(-2, -1) })) };
    },
    async debuggerVariables(names) {
      return names.map(n => n.endsWith("]") ? { ID: n, NAME: n, META_TYPE: "structure" }
        : vars().find(v => v.NAME === n));
    },
    async debuggerStep(kind) {
      calls.push(kind);
      position++;
      if (position >= stops.length) { throw new Error("An exception was raised"); }
      return { reachedBreakpoints: stops[position].reached ? [{ id: stops[position].reached }] : [] };
    },
    async getObjectSource() { return Array.from({ length: 60 }, (_, i) => "line " + (i + 1)).join("\n"); },
    async logout() { calls.push("logout"); }
  };
  const opened = [];
  const dbg = create({
    ideId: "IDE", terminalId: "TERM",
    openUrl: async url => opened.push(url),
    connect: async () => ({ system: { name: "QAS", url: "https://sap.example:44300", client: "100" }, user: "SYCHOV",
      listener, open: async () => session })
  });
  return { dbg, calls, sent, opened };
}

const simple = (name, value) => ({ ID: name, NAME: name, META_TYPE: "simple", VALUE: value });
const table = (name, rows) => ({ ID: name + "[]", NAME: name, META_TYPE: "table", TABLE_LINES: rows, VALUE: "[" + rows + "x3]" });

test("a breakpoint URL follows the object type", () => {
  assert.equal(sourceUrl("PROG", "Z_CALC"), URL_MAIN);
  assert.equal(sourceUrl("CLAS", "ZCL_X"), "/sap/bc/adt/oo/classes/zcl_x/source/main");
  assert.throws(() => sourceUrl("FUNC", "Z_FM"), /not supported/);
});

test("a condition is attached in a second round, on the line SAP placed", async () => {
  const { dbg, sent } = fakeSap();
  const bp = await dbg.setBreakpoint({ name: "z_calc", line: 45, condition: "lv_customer_total > 1000" });
  assert.equal(bp.id, "bp1");
  assert.deepEqual(sent[0], [URL_MAIN + "#start=45"]);
  assert.equal(sent[1][0].condition, "lv_customer_total > 1000");
  await dbg.stop();
});

test("a line SAP refuses is reported and not kept", async () => {
  const { dbg } = fakeSap();
  await assert.rejects(dbg.setBreakpoint({ name: "Z_CALC", line: 999 }), /Line 999 is not executable/);
  assert.equal(dbg.status().breakpoints.length, 0);
});

test("another debugger listening is not taken over silently", async () => {
  const { dbg } = fakeSap({ conflict: true });
  await assert.rejects(dbg.setBreakpoint({ name: "Z_CALC", line: 45 }), /Another debugger already listens for SYCHOV: Eclipse of SYCHOV/);
});

test("log breakpoints record and run on; a stop breakpoint waits; the end is reported", async () => {
  const { dbg, calls } = fakeSap({ stops: [
    { line: 45, vars: [simple("LV_TOTAL", "600.00"), table("LT_ORDERS", 2)] },
    { line: 45, reached: "BP45", vars: [simple("LV_TOTAL", "900.00"), table("LT_ORDERS", 2)] },
    { line: 50, reached: "BP50", vars: [simple("LV_TOTAL", "900.00"), simple("LV_DISCOUNT", "70.00"), table("LT_ORDERS", 2)] }
  ] });
  await dbg.setBreakpoint({ name: "Z_CALC", line: 45, mode: "log" });
  await dbg.setBreakpoint({ name: "Z_CALC", line: 50 });
  const first = await dbg.wait(5);
  // Two passes of line 45 were logged without a turn of the assistant.
  assert.equal(first.logged.length, 2);
  assert.equal(first.logged[0].changed.LV_TOTAL, "600.00");
  assert.equal(first.logged[1].changed.LV_TOTAL, "900.00");
  // Line 50 stops, with only what changed since the last stop.
  assert.equal(first.stopped.at, "Z_CALC:50");
  assert.equal(first.stopped.breakpoint, "bp2");
  assert.deepEqual(first.stopped.changed, { LV_DISCOUNT: "70.00" });
  assert.match(first.stopped.source, /> 50 line 50/);
  // Continuing past the last stop ends the run.
  const last = await dbg.step("continue");
  assert.equal(last.finished[0].program, "Z_CALC");
  assert.ok(calls.includes("logout"));
  await dbg.stop();
});

test("a table that changed shows its first rows; debug_read reads a range", async () => {
  const { dbg } = fakeSap({ stops: [{ line: 23, vars: [table("LT_ORDERS", 3)] }] });
  await dbg.setBreakpoint({ name: "Z_CALC", line: 23 });
  const stop = await dbg.wait(5);
  assert.equal(stop.stopped.tables.LT_ORDERS.rows, 3);
  assert.equal(stop.stopped.tables.LT_ORDERS.shown.length, 3);
  const read = await dbg.read("lt_orders", 2, 3);
  assert.equal(read.from, 2);
  assert.equal(read.shown.length, 2);
  await dbg.stop();
});

test("nothing is read or stepped without a stopped program", async () => {
  const { dbg } = fakeSap();
  await assert.rejects(dbg.read("LV_TOTAL"), /not stopped/);
  await assert.rejects(dbg.step("over"), /not stopped/);
});

test("a run opens WebGUI on the system, and needs a breakpoint first", async () => {
  const { dbg, opened } = fakeSap();
  await assert.rejects(dbg.run("Z_CALC"), /Set a breakpoint/);
  await dbg.setBreakpoint({ name: "Z_CALC", line: 45 });
  await dbg.run("z_calc");
  assert.match(opened[0], /^https:\/\/sap\.example:44300\/sap\/bc\/gui\/sap\/its\/webgui\?~transaction=/);
  assert.match(decodeURIComponent(opened[0]), /RS38M-PROGRAMM=Z_CALC;DYNP_OKCODE=STRT/);
  assert.match(opened[0], /sap-client=100/);
  await dbg.stop();
});

test("stop removes every breakpoint and the listener", async () => {
  const { dbg, sent, calls } = fakeSap();
  await dbg.setBreakpoint({ name: "Z_CALC", line: 45 });
  await dbg.stop();
  assert.deepEqual(sent.at(-1), []);
  assert.ok(calls.includes("deleteListener"));
  assert.equal(dbg.status().listening, false);
});

test("the /debug set answers initialize with its instructions and lists only debug tools", async () => {
  const mcp = require("../mcp");
  const { dbg } = fakeSap();
  const set = mcp.debugSet(dbg);
  const init = await mcp.dispatch({}, { method: "initialize", params: {} }, set);
  assert.match(init.instructions, /debug_stop/);
  const list = await mcp.dispatch({}, { method: "tools/list" }, set);
  assert.ok(list.tools.every(t => t.name.startsWith("debug_")));
  // The review set keeps its own list and no instructions.
  const review = await mcp.dispatch({}, { method: "initialize", params: {} });
  assert.equal(review.instructions, undefined);
  const status = await mcp.dispatch({}, { method: "tools/call", params: { name: "debug_status", arguments: {} } }, set);
  assert.match(status.content[0].text, /"listening": false/);
  assert.match(dbg.status().answers, /^1 answers/);
});

test("the debugger follows the active system, and refuses to switch while debugging", async () => {
  let active = "QAS";
  const connected = [];
  const { dbg: probe } = fakeSap();
  const listener = { async debuggerSetBreakpoints(m, t, i, c, bps) { return bps.map(b => ({ id: "X", uri: { uri: b.split("#")[0], range: { start: { line: Number(b.split("=")[1]) } } } })); },
    async debuggerListeners() {}, async debuggerListen() { return new Promise(() => {}); }, async debuggerDeleteListener() {} };
  const dbg = create({ ideId: "I", terminalId: "T", openUrl: async () => {}, current: () => active,
    connect: async () => { connected.push(active); return { key: active, system: { name: active, url: "https://" + active.toLowerCase() }, user: "U", listener, open: async () => ({}) }; } });
  assert.match(dbg.status().system, /not connected/);
  await dbg.setBreakpoint({ name: "Z_CALC", line: 45 });
  active = "E19";
  await assert.rejects(dbg.setBreakpoint({ name: "Z_CALC", line: 50 }), /still going on QAS\. Call debug_stop first/);
  await dbg.stop();
  await dbg.setBreakpoint({ name: "Z_CALC", line: 50 });
  assert.deepEqual(connected, ["QAS", "E19"]);
  assert.match(dbg.status().system, /^E19/);
  await dbg.stop();
  await probe.stop();
});

test("a system's webgui address is where WebGUI opens; a bad one is refused", async () => {
  const opened = [];
  const listener = { async debuggerSetBreakpoints(m, t, i, c, bps) { return bps.map(b => ({ id: "X", uri: { uri: b.split("#")[0], range: { start: { line: Number(b.split("=")[1]) } } } })); },
    async debuggerListeners() {}, async debuggerListen() { return new Promise(() => {}); }, async debuggerDeleteListener() {} };
  let webgui = "https://10.0.0.5:44300/";
  const dbg = create({ ideId: "I", terminalId: "T", openUrl: async url => opened.push(url),
    connect: async () => ({ key: "DEV", system: { name: "DEV", url: "http://10.0.0.5:8000", client: "100", webgui }, user: "U", listener, open: async () => ({}) }) });
  await dbg.setBreakpoint({ name: "Z_CALC", line: 45 });
  await dbg.run("Z_CALC");
  assert.match(opened[0], /^https:\/\/10\.0\.0\.5:44300\/sap\/bc\/gui\/sap\/its\/webgui\?/);
  await dbg.stop();
  webgui = "ftp://nowhere";
  const bad = create({ ideId: "I", terminalId: "T", openUrl: async url => opened.push(url),
    connect: async () => ({ key: "DEV", system: { name: "DEV", url: "http://10.0.0.5:8000", webgui }, user: "U", listener, open: async () => ({}) }) });
  await bad.setBreakpoint({ name: "Z_CALC", line: 45 });
  await assert.rejects(bad.run("Z_CALC"), /not an http\(s\) URL/);
  await bad.stop();
});
