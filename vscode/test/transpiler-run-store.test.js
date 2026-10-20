"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const history = require("../transpiler-history");

test("a transpiler run kept in the run folder opens again from a new session", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-run-store-"));
  const root = path.join(work, "runs"), main = path.join(work, "zlab.prog.abap"), cls = path.join(work, "zcl_a.clas.abap");
  fs.writeFileSync(main, "REPORT zlab."); fs.writeFileSync(cls, "CLASS zcl_a DEFINITION.");
  const records = [{ file: main, line: 1, owner: "ZLAB", routine: "ZLAB", changed: { a: 1 } },
    { file: cls, line: 7, owner: "ZCL_A", routine: "RUN", changed: { b: 2 } }];
  const first = history.create(() => root);
  const run_id = first.save(records, { object_name: "ZLAB", object_type: "PROG" }, { output: "out", main });
  assert.equal(first.number(run_id), 1);
  assert.equal(first.get(run_id).session_id, run_id);
  assert.equal(first.number(first.save(records, { object_name: "ZLAB" })), 2);
  first.resetNumbers();
  assert.equal(first.number(run_id), null);
  fs.rmSync(main); fs.rmSync(cls);
  const later = history.create(() => root);
  assert.deepEqual(later.known(), [run_id]);
  assert.equal(later.number(run_id), null);
  assert.equal(later.resolve(run_id.slice(0, 8)), run_id);
  const run = later.get(run_id.slice(0, 8));
  assert.equal(run.output, "out");
  assert.equal(fs.readFileSync(run.main, "utf8"), "REPORT zlab.");
  assert.equal(fs.readFileSync(run.records[1].file, "utf8"), "CLASS zcl_a DEFINITION.");
  assert.equal(later.read({ run_id, from_step: 2, limit: 1 }).steps[0].routine, "RUN");
  // A folder handed to someone else opens on its own.
  const moved = path.join(work, "moved");
  fs.cpSync(run.folder, moved, { recursive: true });
  assert.equal(history.load(moved).records[0].file, path.join(moved, "sources", "0", "zlab.prog.abap"));
  assert.throws(() => history.create(() => "").get("abcdef12"), /runPath is not set/);
  assert.throws(() => later.get("ffffffff"), /unknown/);
});
