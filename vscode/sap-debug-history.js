"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

function save(file, record) {
  if (!record || record.format !== 1 || !Array.isArray(record.timeline) || !record.timeline.length)
    throw new Error("There are no recorded SAP debug steps to save.");
  record.session_id = record.session_id || randomUUID();
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  return file;
}

function load(file) {
  let record;
  try { record = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error("Cannot read SAP debug recording: " + error.message); }
  if (!record || record.format !== 1 || !record.meta || !Array.isArray(record.timeline) || !record.timeline.length
    || !record.sources || typeof record.sources !== "object")
    throw new Error("This is not a VERTEX SAP debug recording.");
  if (!record.session_id) {
    record.session_id = randomUUID();
    const temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "w" });
    fs.renameSync(temporary, file);
  }
  return record;
}

function list(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".vertex-debug.json"))
    .map(entry => {
      const file = path.join(folder, entry.name);
      try {
        const record = load(file);
        return { file, session_id: record.session_id, name: String(record.meta.name || "Unknown"), type: String(record.meta.type || ""),
          created: String(record.meta.created || fs.statSync(file).mtime.toISOString()), steps: record.timeline.length };
      } catch (_) { return null; }
    }).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
}

function containedFile(folder, file) {
  const root = path.resolve(folder), target = path.resolve(file);
  if (path.dirname(target) !== root || !target.endsWith(".vertex-debug.json"))
    throw new Error("This SAP debug recording is outside the configured log folder.");
  return target;
}

function rename(folder, file, name) {
  const target = containedFile(folder, file), record = load(target);
  record.meta.name = String(name || "").trim();
  if (!record.meta.name) throw new Error("Enter a name for this recording.");
  const temporary = target + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "w" });
  fs.renameSync(temporary, target);
}

function remove(folder, file) {
  fs.unlinkSync(containedFile(folder, file));
}

module.exports = { save, load, list, rename, remove };
