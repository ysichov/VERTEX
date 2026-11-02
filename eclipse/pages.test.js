"use strict";
// The Eclipse pages that ask their view, as the plugin carries them, and the one-request bridge they share.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { page, CALLS } = require("./pages");

const PAGES = ["reach-path.html", "session-logs.html", "value-origin.html"];

test("the plugin carries each page with the bridge put in, as prepare.js writes it", () => {
  for (const name of PAGES) {
    const carried = page(name);
    assert.ok(fs.readFileSync(path.join(__dirname, name), "utf8").includes(CALLS), name + " marks where the bridge goes");
    assert.ok(!carried.includes(CALLS) && carried.includes("window.sdeReady = function"), name);
    assert.equal(fs.readFileSync(path.join(__dirname, "..", "org.vertex.abap.ui", "assistant", name), "utf8"), carried,
      "run node eclipse/prepare.js");
  }
});

test("the bridge asks Eclipse one thing at a time and settles each call with its own answer", async () => {
  const asked = [], answers = [];
  const window = {
    sdeTake: () => answers.shift(),
    sdeFirst: value => asked.push(["sdeFirst", value]), sdeSecond: value => asked.push(["sdeSecond", value])
  };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "eclipse-calls.js"), "utf8") + "\nwindow.call = call;", context);
  const first = window.call("sdeFirst", 1), second = window.call("sdeSecond", 2);
  assert.deepEqual(asked, [["sdeFirst", 1]], "the second waits for the first answer");
  answers.push("one"); window.sdeReady();
  assert.equal(await first, "one");
  assert.deepEqual(asked, [["sdeFirst", 1], ["sdeSecond", 2]]);
  answers.push("ERROR:refused"); window.sdeReady();
  await assert.rejects(second, /^Error: refused$/);
  const third = window.call("sdeFirst", 3);
  answers.push(null); window.sdeReady();
  await assert.rejects(third, /Eclipse gave no answer to sdeFirst/);
});
