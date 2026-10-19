"use strict";
/* The build of an SAP object's transpiler run - the sources and the dictionary it read - kept between runs. As SAP runs a
   program's load and not its text, a run takes the kept build as it is, without asking SAP whether anything changed;
   Recompile reads it again. One folder per system and object holds the build and the project written from it. */
const fs = require("fs");
const path = require("path");
const os = require("os");

const up = value => String(value || "").toUpperCase();
// Bump when the generated SAP source or DDIC representation changes. Reloading
// the extension alone must not reuse a build made by older generator code.
const FORMAT_VERSION = 4;

function cacheFolder(systemKey, object) {
  const safe = value => String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(os.tmpdir(), "vertex-sap-abap", safe(systemKey), safe(up(object.object_type)) + "-" + safe(up(object.object_name)));
}
function readKept(folder) {
  try {
    if (fs.existsSync(path.join(folder, "vertex-recompile-required"))) return null;
    const read = JSON.parse(fs.readFileSync(path.join(folder, "vertex-read.json"), "utf8"));
    if (read.format_version !== FORMAT_VERSION) return null;
    const pools = new Set();
    for (const source of read.sources || []) for (const match of String(source.text || "").matchAll(/^\s*TYPE-POOLS\s*:?[ \t]*([A-Z0-9_, \t]+)\./gmi))
      for (const name of match[1].split(",").map(value => value.trim().toUpperCase()).filter(Boolean)) pools.add(name);
    if ([...pools].some(name => !(read.sources || []).some(source => source.type === "TYPE" && source.name === name))) return null;
    return read;
  } catch (_) { return null; }
}
function keep(folder, read) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "vertex-read.json"), JSON.stringify({ ...read, format_version: FORMAT_VERSION }));
  fs.rmSync(path.join(folder, "vertex-recompile-required"), { force: true });
}

function requireRecompile(projectRoot) {
  const root = path.resolve(projectRoot);
  const folder = path.dirname(root);
  if (path.basename(root) !== "project" || !fs.existsSync(path.join(folder, "vertex-read.json"))) return false;
  fs.writeFileSync(path.join(folder, "vertex-recompile-required"), "");
  return true;
}

module.exports = { cacheFolder, readKept, keep, requireRecompile };
