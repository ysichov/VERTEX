"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(path.join(__dirname, "../pages/visual-debug.html"), "latin1").replace(/\r\n/g, "\n");
const section = (start, end) => page.slice(page.indexOf(start), page.indexOf(end));

test("local playback shows the recorded values for its last frame", () => {
  const seen = [];
  const context = vm.createContext({ INITIAL: { local: true }, replayAt: null,
    stops: () => 2, drawPos() {}, showStop: i => { seen.push(i); return Promise.resolve(); },
    failed() {}, window: {} });
  vm.runInContext(section("function replay(i){", '$("fprev").onclick='), context);
  vm.runInContext("replay(1)", context);
  assert.equal(context.replayAt, 1);
  assert.deepEqual(seen, [1]);
});

test("local snapshot records every variable group at a stop", async () => {
  const timeline = [{}];
  const values = { g: "g", l: "l", p: "p" };
  const context = vm.createContext({ INITIAL: { local: true }, flow: { timeline }, localVarCache: {},
    groupKind: name => name.toLowerCase(),
    debug: action => Promise.resolve(action === "localSnapshot" ?
      { groups: [{ id: "g", name: "Globals" }, { id: "l", name: "Locals" }, { id: "p", name: "Params" }]
        .map(group => ({ ...group, children: [{ name: group.id, type: "I", value: values[group.id], meta: "simple" }] })) } : {}) });
  vm.runInContext(section("function snapshot(captured,pre){", "/* The values the player shows"), context);
  await vm.runInContext("snapshot()", context);
  assert.deepEqual(Array.from(timeline[0].vars, group => group.name), ["Globals", "Locals", "Params"]);
  assert.deepEqual(Array.from(timeline[0].vars, group => group.children[0].value), ["g", "l", "p"]);
  timeline.push({});
  values.l = "changed";
  await vm.runInContext("snapshot()", context);
  assert.deepEqual(Array.from(timeline[1].vars, group => group.name), ["Locals"]);
  assert.equal(timeline[1].vars[0].children[0].value, "changed");
  timeline.push({});
  await vm.runInContext("snapshot()", context);
  assert.deepEqual(Array.from(timeline[2].vars), []);
});

test("local playback reconstructs unchanged values from earlier stops", () => {
  const timeline = [
    { vars: [{ name: "Locals", children: [{ name: "a", value: "5" }, { name: "b", value: "3" }] }] },
    { vars: [{ name: "Locals", children: [{ name: "a", value: "8" }] }] },
    { vars: [] }
  ];
  const body = section('  if(INITIAL.local){\n    var values={};', '}else while(k>=0') + '}';
  const context = vm.createContext({ INITIAL: { local: true }, tl: timeline, t: {}, i: 2, k: 2, from: null });
  vm.runInContext(body, context);
  const variables = context.from.vars[0].children;
  assert.deepEqual(Array.from(variables, variable => [variable.name, variable.value]),
    [["a", "8"], ["b", "3"]]);
});

test("a local debug stop exits history when execution advances", () => {
  const calls = [];
  const context = vm.createContext({ INITIAL: { local: true }, series: null, replayAt: 1,
    picture: { ended: 0, stopped: { at: "ZTEST:12" } },
    drawPos: () => calls.push("position"), apply: next => calls.push(next.stopped.at), failed() {} });
  vm.runInContext(section("function sdeDebugEvent(raw){", "/* ---------- the window's parts list"), context);
  vm.runInContext('sdeDebugEvent(JSON.stringify({ended:0,stopped:{at:"ZTEST:20"}}))', context);
  assert.equal(context.replayAt, null);
  assert.deepEqual(calls, ["position", "ZTEST:20"]);
});
