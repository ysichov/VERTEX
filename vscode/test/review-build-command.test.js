"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Build review builds and saves in one request, without a preliminary read/build", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/versions.html"), "utf8");
  const calls = [];
  const context = vm.createContext({
    objectName: () => "DEVK900001", review_blame: true, review_from: "file",
    reviewFlags: build => { assert.equal(build, false); return "generated=1"; },
    status() {}, note() {}, reviewStopControl() {},
    sdeReview() { assert.fail("A read before Save would build the review twice across API instances"); },
    sdeAct: (...args) => calls.push(args)
  });
  vm.runInContext(page.slice(page.indexOf("function buildReview("), page.indexOf("/* The build options")) + "\nbuildReview();", context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "DEVK900001");
  assert.deepEqual(JSON.parse(calls[0][4]), { action: "S", saved_at: "" });
  assert.deepEqual(calls[0].slice(5), ["1", "file", "generated=1"]);
  assert.equal(context.review_building, "devk900001");
  assert.equal(context.review_fresh, "devk900001");
});
