"use strict";

const path = require("node:path");

function mark(file, before, after, provider, model) {
  const base = path.basename(file).toLowerCase();
  if (path.extname(base) !== ".js" || /(?:^|[.-])(?:min|generated|bundle)(?:[.-]|$)/.test(base) ||
      !provider || !model || before === after) return after;
  const oldLines = String(before || "").split("\n"), lines = after.split("\n");
  let first = 0;
  while (first < oldLines.length && first < lines.length && oldLines[first] === lines[first]) first++;
  let oldEnd = oldLines.length, end = lines.length;
  while (oldEnd > first && end > first && oldLines[oldEnd - 1] === lines[end - 1]) { oldEnd--; end--; }
  if (first === end) return after;
  if (first === 0 && lines[0].startsWith("#!")) return after;
  // A template literal can contain code-looking lines.
  // Leave ambiguous files untouched rather than writing comments into a string.
  const prior = lines.slice(0, first).join("\n");
  if ((prior.match(/(?<!\\)`/g) || []).length % 2) return after;
  // Comment lines bracket the changed lines, including compact code kept on one line.
  const indent = lines[first].match(/^\s*/)?.[0] || "";
  const label = String(provider).replace(/[\r\n*\/<>]/g, "") + " / " + String(model).replace(/[\r\n*\/<>]/g, "");
  const comment = text => indent + "/* VERTEX CHANGE " + text + ": " + label + " */";
  lines.splice(end, 0, comment("END"));
  lines.splice(first, 0, comment("BEGIN"));
  return lines.join("\n");
}

module.exports = { mark };
