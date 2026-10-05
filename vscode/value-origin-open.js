"use strict";
/* Where a node of Value origin opens, in the editor's terms. Both hosts open the same places: the VS Code
   source tabs and, through the Eclipse plugin's copy of this file, the ADT editor. */

// An ACE include line, found in the document an editor shows: the same line if it reads the same, else the one
// line that does; a line that occurs twice stays where it was asked for.
const sourceLineIn = (from, line, to) => {
  const expected = String(from || '').split(/\r?\n/)[line - 1]?.trim();
  if (!expected) return line;
  const lines = String(to || '').split(/\r?\n/);
  if (lines[line - 1]?.trim() === expected) return line;
  const matches = [];
  for (let index = 0; index < lines.length; index++) if (lines[index].trim() === expected) matches.push(index + 1);
  return matches.length === 1 ? matches[0] : line;
};
// The zero-based line of a method's implementation (METHOD name) or of its declaration (METHODS ... name), -1 if none.
function methodLine(source, name, implementation) {
  const lines = source.split(/\r?\n/), exact = new RegExp("^\\s*METHOD\\s+" + name + "\\b", "i");
  if (implementation) { return lines.findIndex(line => exact.test(line)); }
  for (let start = 0; start < lines.length; start++) {
    if (!/^\s*(?:CLASS-)?METHODS\b/i.test(lines[start])) { continue; }
    let statement = lines[start];
    for (let end = start + 1; end < lines.length && !/\./.test(statement); end++) { statement += "\n" + lines[end]; }
    if (new RegExp("\\b" + name + "\\b", "i").test(statement)) { return start; }
  }
  return -1;
}
module.exports = { sourceLineIn, methodLine };
