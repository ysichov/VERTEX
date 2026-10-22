"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// Record observed stops of an assistant-started SAP run, without driving SAP
// or requiring the Visual Debug webview to be open.
function create({ folder, enabled = () => true }) {
  let record = null, active = false, savedSteps = 0;
  function begin(program, system) {
    reset();
    if (!enabled()) return;
    record = { format: 1, session_id: randomUUID(), meta: { name: program, type: "PROG", system,
      created: new Date().toISOString(), recording: "assistant stops" },
      timeline: [], sources: {}, flow: { nodes: {}, edges: {}, order: [] } };
    active = true;
  }
  function capture(frames, state, sources) {
    if (!active || !record || !frames.length) return;
    const top = frames[0];
    const owner = top.include || top.program || record.meta.name;
    record.timeline.push({ upto: 0, cur: { owner, name: top.unit || owner },
      at: { url: top.url, line: top.line, ord: 0, name: top.label },
      stack: frames.map(frame => ({ ...frame })),
      varsDelta: true, vars: [{ name: "Recorded values", children: Object.entries(state.changed || {})
        .map(([name, value]) => ({ name, value })) }] });
    for (const [url, text] of sources) record.sources[url] = text;
    const root = folder();
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, record.session_id + ".vertex-debug.json");
    const temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(record) + "\n", "utf8");
    fs.renameSync(temporary, file);
    savedSteps = record.timeline.length;
  }
  function reference() {
    return record ? { kind: "sap", id: record.session_id, step: 1, recorded_steps: savedSteps } : null;
  }
  function reset() { record = null; active = false; savedSteps = 0; }
  return { begin, capture, reference, reset, finish: () => { active = false; },
    discard: id => { if (record?.session_id === id) reset(); } };
}

module.exports = { create };
