"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const history = require("../sap-debug-history");

test("saved SAP debug recordings have stable session IDs, including legacy files", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-debug-history-"));
  const record = { format: 1, meta: { name: "ZTEST", type: "PROG", created: "2026-10-20T00:00:00.000Z" },
    timeline: [{}, {}], sources: {} };
  const file = path.join(folder, "saved.vertex-debug.json");
  history.save(file, record);
  const first = history.load(file).session_id;
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.equal(history.load(file).session_id, first);
  assert.equal(history.list(folder)[0].session_id, first);

  const legacyFile = path.join(folder, "legacy.vertex-debug.json");
  fs.writeFileSync(legacyFile, JSON.stringify({ ...record, session_id: undefined }));
  const migrated = history.load(legacyFile).session_id;
  assert.ok(migrated);
  assert.equal(history.load(legacyFile).session_id, migrated);
  fs.rmSync(folder, { recursive: true, force: true });
});
