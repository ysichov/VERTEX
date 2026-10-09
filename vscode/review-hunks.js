"use strict";

// AVE's cutting of a diff into review blocks, shared by the saved review and the review built from ADT.

const up = value => String(value == null ? "" : value);

// ZCL_VX_REVIEW_PREPARE=>UPDATE_STMT_OPEN: a line of code leaves its statement open unless it ends in a full stop;
// blank lines and comments do not change it, and a trailing comment does not count.
function stmtOpen(line, open) {
  let text = up(line), trim = text.trim();
  if (!trim || trim[0] === "*" || trim[0] === "\"") { return open; }
  const quote = text.indexOf("\"");
  if (quote >= 0) { text = text.slice(0, quote); }
  trim = text.trim();
  if (!trim) { return open; }
  return trim[trim.length - 1] !== ".";
}
const BRIDGE_MAX = 100;

// ZCL_VX_REVIEW_HUNKS=>HUNK_RANGES: where each block begins and ends in the diff (1-based, as the ABAP index), and
// the line of the new version it opens on.
function hunkRanges(diff) {
  const result = [];
  let pos = 1, line = 0, open = false;
  const total = diff.length, at = i => diff[i - 1];
  while (pos <= total) {
    const start = at(pos);
    if (start.op !== "-" && start.op !== "+") {
      if (start.op === "=") { line++; open = stmtOpen(start.text, open); }
      pos++;
      continue;
    }
    const hunk = [];
    let bridge = 0, scan = pos;
    const startLine = line + 1;
    while (scan <= total) {
      const row = at(scan);
      if (row.op === "-" || row.op === "+") {
        hunk.push(row);
        if (row.op === "+") { open = stmtOpen(row.text, open); }
        scan++;
      } else if (row.op === "=" && open && bridge < BRIDGE_MAX) {
        bridge++;
        hunk.push(row);
        open = stmtOpen(row.text, open);
        scan++;
      } else if (row.op === "=" && up(row.text).trim() === "") {
        let peek = scan + 1, extra = 0, more = false;
        while (peek <= total) {
          const p = at(peek);
          if (p.op === "-" || p.op === "+") { more = true; break; }
          if (p.op === "=" && up(p.text).trim() === "" && extra < 1) { extra++; peek++; continue; }
          break;
        }
        if (!more) { break; }
        hunk.push(row);
        scan++;
      } else {
        break;
      }
    }
    result.push({ op_from: pos, op_to: scan - 1, start_line: startLine });
    hunk.forEach(r => { if (r.op === "=" || r.op === "+") { line++; } });
    pos = scan;
  }
  return result;
}

module.exports = { hunkRanges, stmtOpen };
