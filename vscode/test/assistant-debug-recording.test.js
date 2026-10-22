"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const history = require("../sap-debug-history"), recording = require("../assistant-debug-recording");

test("assistant SAP stops persist as an offline replay with a stable session ID", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-assistant-sap-"));
  try {
    const recorder = recording.create({ folder: () => folder });
    const frames = [{ program: "Z_CALC", include: "Z_CALC", unit: "START-OF-SELECTION", url: "/sap/source", line: 10, label: "Z_CALC:10" }];
    recorder.capture(frames, { changed: { LV: "0" } }, new Map());
    assert.equal(history.list(folder).length, 0);
    recorder.begin("Z_CALC", "QAS");
    const id = recorder.reference().id;
    assert.equal(recorder.reference().recorded_steps, 0);
    recorder.capture(frames, { changed: { LV: "1" } }, new Map([["/sap/source", "REPORT z_calc."]]));
    recorder.capture([{ ...frames[0], line: 11 }], { changed: { LV: "2" } }, new Map());
    const rows = history.list(folder), saved = history.load(rows[0].file);
    assert.equal(rows.length, 1);
    assert.equal(saved.session_id, id);
    assert.equal(saved.timeline.length, 2);
    assert.equal(saved.timeline[1].vars[0].children[0].value, "2");
    assert.equal(saved.sources["/sap/source"], "REPORT z_calc.");
    recorder.finish();
    recorder.capture(frames, {}, new Map());
    assert.equal(recorder.reference().recorded_steps, 2);
    recorder.begin("Z_OTHER", "QAS");
    assert.notEqual(recorder.reference().id, id);
    recorder.reset();
    assert.equal(recorder.reference(), null);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
