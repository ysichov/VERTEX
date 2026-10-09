"use strict";

// The line diff of two sources: Myers' O(ND) algorithm ("An O(ND) Difference Algorithm and Its Variations", 1986)
// in its linear-space form, which finds the middle snake of the shortest edit script and splits there. Written from
// the paper, not from Eclipse's comparer, which is under the EPL while VERTEX is MIT. It is what Eclipse's Text Compare computes too - a shortest edit script over whole lines - and nothing
// is done on top of it: no pairing, no moving, no knowledge of ABAP. Time is (N+M)·D for D changed lines, so a
// source of thousands of lines with a few changes takes a few milliseconds, and a full rewrite stays linear in space.
//
// Lines compare by `key(line)` - the line itself unless a caller asks otherwise - and are interned to numbers first,
// so the inner loop compares integers. The result is '=' kept, '-' from the old side, '+' from the new one, and in
// every run of changes the old lines come before the new ones: a run is one difference, as Eclipse shows it - the
// old lines against the new.
function diffLines(oldLines, newLines, key) {
  const ids = new Map();
  const intern = line => {
    const k = key ? key(line) : line;
    let id = ids.get(k);
    if (id === undefined) { id = ids.size; ids.set(k, id); }
    return id;
  };
  const a = Int32Array.from(oldLines, intern);
  const b = Int32Array.from(newLines, intern);
  const ops = [];

  const keep = (x, y, n) => { for (let i = 0; i < n; i++) { ops.push({ op: "=", text: newLines[y + i] }); } };
  const drop = (x, n) => { for (let i = 0; i < n; i++) { ops.push({ op: "-", text: oldLines[x + i] }); } };
  const add = (y, n) => { for (let i = 0; i < n; i++) { ops.push({ op: "+", text: newLines[y + i] }); } };

  // a[aLo, aHi) against b[bLo, bHi), its ops appended in order.
  function compare(aLo, aHi, bLo, bHi) {
    let head = 0;
    while (aLo + head < aHi && bLo + head < bHi && a[aLo + head] === b[bLo + head]) { head++; }
    keep(aLo, bLo, head);
    aLo += head; bLo += head;
    let tail = 0;
    while (aHi - tail > aLo && bHi - tail > bLo && a[aHi - tail - 1] === b[bHi - tail - 1]) { tail++; }
    aHi -= tail; bHi -= tail;

    if (aLo === aHi) { add(bLo, bHi - bLo); }
    else if (bLo === bHi) { drop(aLo, aHi - aLo); }
    else {
      const split = middle(aLo, aHi, bLo, bHi);
      if (split) {
        compare(aLo, split[0], bLo, split[1]);
        compare(split[0], aHi, split[1], bHi);
      } else {
        drop(aLo, aHi - aLo);
        add(bLo, bHi - bLo);
      }
    }
    keep(aHi, bHi, tail);
  }

  // The point where a forward and a backward search over the edit graph meet: a split that lies on a shortest
  // edit script. Null when the two ranges share no line at all.
  function middle(aLo, aHi, bLo, bHi) {
    const n = aHi - aLo, m = bHi - bLo;
    const maxD = Math.ceil((n + m) / 2);
    const offset = maxD + 1;
    const size = 2 * maxD + 3;
    const vf = new Int32Array(size).fill(-1);
    const vb = new Int32Array(size).fill(-1);
    vf[offset + 1] = 0;
    vb[offset + 1] = 0;
    const delta = n - m;
    const odd = (delta & 1) !== 0;
    for (let d = 0; d <= maxD; d++) {
      // Forward: x along a, y along b, from the top left.
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && vf[offset + k - 1] < vf[offset + k + 1]) ? vf[offset + k + 1] : vf[offset + k - 1] + 1;
        let y = x - k;
        if (x > n || y > m || y < 0) { continue; }
        while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++; }
        vf[offset + k] = x;
        if (odd) {
          const kb = delta - k;
          if (kb >= -(d - 1) && kb <= d - 1 && vb[offset + kb] !== -1 && x + vb[offset + kb] >= n) {
            return [aLo + x, bLo + y];
          }
        }
      }
      // Backward: the same walk from the bottom right, x and y counted back from the ends.
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && vb[offset + k - 1] < vb[offset + k + 1]) ? vb[offset + k + 1] : vb[offset + k - 1] + 1;
        let y = x - k;
        if (x > n || y > m || y < 0) { continue; }
        while (x < n && y < m && a[aHi - x - 1] === b[bHi - y - 1]) { x++; y++; }
        vb[offset + k] = x;
        if (!odd) {
          const kf = delta - k;
          if (kf >= -d && kf <= d && vf[offset + kf] !== -1 && vf[offset + kf] + x >= n) {
            return [aLo + n - x, bLo + m - y];
          }
        }
      }
    }
    return null;
  }

  compare(0, a.length, 0, b.length);

  // Old lines first within each run of changes.
  const result = [];
  let run = [];
  const flush = () => { run.forEach(x => { if (x.op === "-") { result.push(x); } }); run.forEach(x => { if (x.op === "+") { result.push(x); } }); run = []; };
  ops.forEach(op => { if (op.op === "=") { flush(); result.push(op); } else { run.push(op); } });
  flush();
  return result;
}

module.exports = { diffLines };
