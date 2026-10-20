"use strict";

const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const schema = {
  name: "read_abap_transpiler_history",
  annotations: { readOnlyHint: true, destructiveHint: false },
  description: "Read the recorded steps and variable changes of a run_abap_transpiler result. Call repeatedly with from_step to page through the complete history. Values are the changes at each step; include_state reconstructs all variables visible in that routine at each step. This is local transpiler history, not a SAP runtime trace.",
  inputSchema: { type: "object", additionalProperties: false, required: ["run_id"], properties: {
    run_id: { type: "string" },
    from_step: { type: "integer", minimum: 1, description: "First 1-based step; defaults to 1." },
    limit: { type: "integer", minimum: 1, maximum: 20, description: "Steps per page; defaults to 5." },
    include_state: { type: "boolean", description: "Include all routine variables as they stood at each step, reconstructed from changes." }
  } }
};

const findSchema = {
  name: "find_abap_transpiler_stops",
  annotations: { readOnlyHint: true, destructiveHint: false },
  description: "Find virtual breakpoints by ABAP object and line, or watchpoints where a variable changes, in a completed transpiler run. Returns step numbers and variable values before/after; read history around those steps. No rerun or live SAP breakpoint is created.",
  inputSchema: { type: "object", additionalProperties: false, required: ["run_id"], properties: {
    run_id: { type: "string" }, object: { type: "string", description: "ABAP program/class name." },
    line: { type: "integer", minimum: 1 },
    variable: { type: "string", description: "ABAP variable or structure field, e.g. LS_RESULT-AMOUNT. Finds steps where its value changes." },
    from_step: { type: "integer", minimum: 1, description: "Search from this step; defaults to 1." },
    limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum matches; defaults to 20." }
  } }
};

const RUN_FILE = "vertex-run.json";
const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* A run kept on disk is one folder: vertex-run.json with the record, the output and the meta, and sources/ with a copy
   of every source the record steps through. Paths in the file are relative to the folder, so a folder copied elsewhere
   or handed to someone else opens the same. */
function store(root, run_id, records, meta, extra) {
  const safe = value => String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
  const now = new Date(), p = n => String(n).padStart(2, "0");
  const stamp = now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + "_" + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds());
  const folder = path.join(root, stamp + "_" + safe(meta.object_name) + "_" + run_id);
  fs.mkdirSync(path.join(folder, "sources"), { recursive: true });
  const copies = new Map();
  const copy = file => {
    const key = path.resolve(file).toLowerCase();
    if (!copies.has(key)) {
      // Each in a folder of its own, under its own name: the name is the program's or the class's.
      const name = copies.size + "/" + path.basename(file);
      fs.mkdirSync(path.join(folder, "sources", String(copies.size)));
      fs.copyFileSync(file, path.join(folder, "sources", name));
      copies.set(key, "sources/" + name);
    }
    return copies.get(key);
  };
  const main = copy(extra.main);
  const kept = records.map(record => record.file ? { ...record, file: copy(record.file) } : record);
  fs.writeFileSync(path.join(folder, RUN_FILE), JSON.stringify({ format: 1, session_id: run_id, run_id, created: now.toISOString(),
    meta, output: String(extra.output || ""), main, records: kept }));
  return folder;
}

function load(folder) {
  let run;
  try { run = JSON.parse(fs.readFileSync(path.join(folder, RUN_FILE), "utf8")); }
  catch (error) { throw new Error(folder + " holds no readable transpiler run (" + RUN_FILE + "): " + error.message); }
  if (run.format !== 1 || !run.run_id || !Array.isArray(run.records) || !run.main)
    throw new Error(path.join(folder, RUN_FILE) + " is not a VERTEX transpiler run.");
  const full = file => path.join(folder, file);
  return { session_id: run.session_id || run.run_id, run_id: run.run_id, meta: run.meta || {}, output: run.output || "", main: full(run.main), folder,
    records: run.records.map(record => record.file ? { ...record, file: full(record.file) } : record) };
}

/* root: the folder runs are kept in (vertex.transpiler.runPath), read at each call; empty keeps them in memory only. */
function create(root = () => "") {
  const runs = new Map();
  // The number of each run in the current chat conversation, from 1: what the user reads instead of a run_id.
  let numbers = new Map();
  function save(records, meta = {}, extra = null) {
    const run_id = randomUUID();
    const folder = root() && extra ? store(root(), run_id, records, meta, extra) : null;
    runs.set(run_id, { session_id: run_id, records, meta, folder, output: extra?.output || "", main: extra?.main || "" });
    while (runs.size > 20) runs.delete(runs.keys().next().value);
    numbers.set(run_id, numbers.size + 1);
    return run_id;
  }
  const kept = () => {
    const dir = root();
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && ID.test(entry.name))
      .map(entry => ({ run_id: ID.exec(entry.name)[0], folder: path.join(dir, entry.name) }));
  };
  // Every run that can be opened: those of this session and those kept in the folder.
  const known = () => [...new Set([...runs.keys(), ...kept().map(run => run.run_id)])];
  // A full run_id or a unique beginning of one, as the chat cites it.
  function resolve(id) {
    const wanted = String(id || "").toLowerCase();
    if (!wanted) return null;
    const matches = known().filter(run_id => run_id.startsWith(wanted));
    return matches.length === 1 ? matches[0] : null;
  }
  function get(id) {
    const run_id = resolve(id);
    if (run_id && runs.has(run_id)) return { run_id, ...runs.get(run_id) };
    const onDisk = run_id && kept().find(run => run.run_id === run_id);
    if (onDisk) return load(onDisk.folder);
    throw new Error("Transpiler run " + id + " is " + (run_id ? "not readable" : "unknown")
      + (root() ? " in this session or in " + root() : " in this session, and vertex.transpiler.runPath is not set") + ".");
  }
  function read(args = {}) {
    const run = get(args.run_id);
    const from = args.from_step === undefined ? 1 : args.from_step;
    const limit = args.limit === undefined ? 5 : args.limit;
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error("from_step must be positive and limit must be 1..20.");
    const states = new Map(), sy = {};
    const steps = [];
    for (let index = 0; index < Math.min(run.records.length, from - 1 + limit); index++) {
      const item = run.records[index], key = String(item.owner || "") + "|" + String(item.routine || "");
      if (!states.has(key)) states.set(key, {});
      Object.assign(states.get(key), item.changed || {});
      Object.assign(sy, item.sy || {});
      if (index < from - 1) continue;
      steps.push({ step: index + 1, object: item.owner, routine: item.routine, line: item.line,
        stack: item.stack, changed: item.changed || {}, sy_changed: item.sy || {}, sql: item.sql || [],
        ...(item.interventions?.length ? { interventions: item.interventions } : {}),
        ...(args.include_state ? { variables: { ...states.get(key) }, sy: { ...sy } } : {}) });
    }
    return { session_id: run.run_id, run_id: args.run_id, mode: "transpiler", total_steps: run.records.length,
      from_step: from, steps, next_step: from + steps.length <= run.records.length ? from + steps.length : null,
      ...run.meta };
  }
  function find(args = {}) {
    const run = get(args.run_id);
    const object = String(args.object || "").toUpperCase(), line = args.line;
    const variable = String(args.variable || "").toUpperCase();
    const from = args.from_step === undefined ? 1 : args.from_step;
    const limit = args.limit === undefined ? 20 : args.limit;
    if ((!variable && (!object || !Number.isInteger(line) || line < 1))
      || (line !== undefined && (!Number.isInteger(line) || line < 1))
      || !Number.isInteger(from) || from < 1
      || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Specify an object, positive line and valid step range.");
    const matches = [], records = run.records;
    let next_step = null;
    const states = new Map();
    const readVariable = state => {
      if (!variable) return undefined;
      const fields = variable.replace(/->/g, "-").split("-");
      let current = state;
      for (const field of fields) {
        if (!current || typeof current !== "object") return undefined;
        const key = Object.keys(current).find(key => key.toUpperCase() === field);
        if (!key) return undefined;
        current = current[key];
      }
      return current;
    };
    for (let i = 0; i < records.length; i++) {
      const item = records[i];
      const key = String(item.owner || "") + "|" + String(item.routine || "");
      if (!states.has(key)) states.set(key, {});
      const state = states.get(key), before = readVariable(state);
      Object.assign(state, item.changed || {});
      const after = readVariable(state);
      if (i < from - 1 || object && String(item.owner || "").toUpperCase() !== object
        || line !== undefined && item.line !== line
        || variable && (after === undefined || JSON.stringify(before) === JSON.stringify(after))) continue;
      if (matches.length >= limit) { next_step = i + 1; break; }
      matches.push({ step: i + 1, object: item.owner, routine: item.routine, line: item.line,
        ...(variable ? { variable, before: before ?? null, after } : { changed: item.changed || {} }) });
    }
    return { session_id: run.run_id, run_id: args.run_id, total_steps: records.length, matches, next_step };
  }
  const number = run_id => numbers.get(run_id) || null;
  // A new conversation numbers its runs from 1 again.
  const resetNumbers = () => { numbers = new Map(); };
  return { save, read, find, get, known, resolve, number, resetNumbers };
}

module.exports = { schema, findSchema, create, load };
