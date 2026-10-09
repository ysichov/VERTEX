"use strict";

// AVE's line diff and line pairing, taken unchanged from AVE/html_simulator/diff.js (lines 12-231), the JS port
// of AVE's ABAP that AVE keeps "as faithful to the ABAP as possible". A review built here counts and cuts its
// changes with these, so it reads like the one AVE builds.
  // ─── 1. Line-level LCS diff (matches METHOD compute_diff) ────────────────

  // Strip leading whitespace and ABAP comment asterisks, so a line and its
  // commented-out twin ("***" + original) normalize to the same text.
  function normForMatch(s) {
    return s.replace(/^[\s*]+/, '');
  }
  // ABAP full-line comment: first non-space char is '*'.
  function isCommentLine(s) {
    return /^\s*\*/.test(s);
  }
  // Match type between two lines:
  //   1 = exact (→ '='),  2 = comment-twin (→ modification '-'/'+'),  0 = none.
  // The comment-twin case lets a deleted line pair with its commented-out copy
  // even when they sit far apart (old code commented out + moved below an
  // inserted block). Requires one side to be a comment and identical content
  // after stripping leading whitespace/'*', so it never matches unrelated code.
  function matchType(a, b, exactEq) {
    if (exactEq(a, b)) return 1;
    if (!isCommentLine(a) && !isCommentLine(b)) return 0;
    const na = normForMatch(a);
    if (na.length >= 3 && na === normForMatch(b)) return 2;
    return 0;
  }

  function computeDiff(itOld, itNew, ignoreCase) {
    const exactEq = ignoreCase
      ? (a, b) => a.toUpperCase() === b.toUpperCase()
      : (a, b) => a === b;
    const nOld = itOld.length;
    const nNew = itNew.length;
    const cols = nNew + 1;
    const rows = nOld + 1;
    // flat DP table
    const dp = new Int32Array(rows * cols);

    for (let i = 1; i <= nOld; i++) {
      for (let j = 1; j <= nNew; j++) {
        if (matchType(itOld[i - 1], itNew[j - 1], exactEq)) {
          dp[i * cols + j] = dp[(i - 1) * cols + (j - 1)] + 1;
        } else {
          const vUp = dp[(i - 1) * cols + j];
          const vLeft = dp[i * cols + (j - 1)];
          dp[i * cols + j] = vUp >= vLeft ? vUp : vLeft;
        }
      }
    }

    // Backtrack — prefer '-' over '+' when equal so '-' precedes '+'
    const result = [];
    let i = nOld, j = nNew;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const mt = matchType(itOld[i - 1], itNew[j - 1], exactEq);
        if (mt === 1) {
          result.push({ op: '=', text: itNew[j - 1] });
          i--; j--;
        } else if (mt === 2) {
          // Commented-out twin → show as a modification so the char-diff
          // highlights the added '*'. Push '+' then '-' (reversed later → '-','+').
          result.push({ op: '+', text: itNew[j - 1] });
          result.push({ op: '-', text: itOld[i - 1] });
          i--; j--;
        } else {
          const cup = dp[(i - 1) * cols + j];
          const cleft = dp[i * cols + (j - 1)];
          if (cup >= cleft) {
            result.push({ op: '-', text: itOld[i - 1] });
            i--;
          } else {
            result.push({ op: '+', text: itNew[j - 1] });
            j--;
          }
        }
      } else if (i > 0) {
        result.push({ op: '-', text: itOld[i - 1] });
        i--;
      } else {
        result.push({ op: '+', text: itNew[j - 1] });
        j--;
      }
    }
    return result.reverse();
  }

  // ─── 2. Pairing heuristic (matches METHOD has_common_chars) ──────────────

  // Count edit runs in the middle parts of two strings (mirrors METHOD count_edit_runs).
  // Tokenizes by whitespace, greedy forward LCS on tokens, counts unmatched regions.
  function countEditRuns(a, b) {
    const ta = a.split(/\s+/).filter(t => t.length > 0);
    const tb = b.split(/\s+/).filter(t => t.length > 0);
    if (!ta.length && !tb.length) return 0;
    if (!ta.length || !tb.length) return 1;

    // Greedy forward scan for matching token pairs
    const pairs = [];
    let jStart = 0;
    for (let ia = 0; ia < ta.length; ia++) {
      for (let jb = jStart; jb < tb.length; jb++) {
        if (ta[ia] === tb[jb]) {
          pairs.push([ia, jb]);
          jStart = jb + 1;
          break;
        }
      }
    }
    if (!pairs.length) return 1;

    let runs = 0;
    const [fi, fj] = pairs[0];
    if (fi > 0 || fj > 0) runs++;                          // unmatched before first island
    for (let k = 0; k < pairs.length - 1; k++) {
      const [ai, aj] = pairs[k], [bi, bj] = pairs[k + 1];
      if (bi > ai + 1 || bj > aj + 1) runs++;              // gap between islands
    }
    const [li, lj] = pairs[pairs.length - 1];
    if (li < ta.length - 1 || lj < tb.length - 1) runs++; // unmatched after last island
    return runs;
  }

  function countCharEditRuns(a, b) {
    const nA = a.length;
    const nB = b.length;
    if (!nA && !nB) return 0;
    if (!nA || !nB) return 1;

    const cols = nB + 1;
    const rows = nA + 1;
    const dp = new Int32Array(rows * cols);
    for (let i = 1; i <= nA; i++) {
      for (let j = 1; j <= nB; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i * cols + j] = dp[(i - 1) * cols + (j - 1)] + 1;
        } else {
          const up = dp[(i - 1) * cols + j];
          const left = dp[i * cols + (j - 1)];
          dp[i * cols + j] = up >= left ? up : left;
        }
      }
    }

    const ops = [];
    let i = nA, j = nB;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.push('=');
        i--; j--;
      } else if (j > 0) {
        if (i === 0 || dp[i * cols + (j - 1)] > dp[(i - 1) * cols + j]) {
          ops.push('+');
          j--;
        } else {
          ops.push('-');
          i--;
        }
      } else {
        ops.push('-');
        i--;
      }
    }

    let runs = 0;
    let inEdit = false;
    for (let k = ops.length - 1; k >= 0; k--) {
      if (ops[k] === '=') inEdit = false;
      else if (!inEdit) {
        runs++;
        inEdit = true;
      }
    }
    return runs;
  }

  // Trivial structural delimiter lines (ENDIF., ELSE., ENDLOOP., …) must not
  // anchor pairing: they occur everywhere and would cross-link unrelated code.
  const TRIVIAL_ANCHORS = new Set([
    'ENDIF', 'ELSE', 'ENDLOOP', 'ENDTRY', 'ENDDO', 'ENDCASE', 'ENDWHILE',
    'ENDMETHOD', 'ENDFORM', 'ENDFUNCTION', 'ENDMODULE', 'ENDCLASS',
    'ENDSELECT', 'ENDAT', 'ENDPROVIDE', 'ENDINTERFACE', 'TRY', 'ENDENHANCEMENT',
  ]);
  function isTrivialAnchor(line) {
    return TRIVIAL_ANCHORS.has(line.toUpperCase().replace(/[.\s]+$/, ''));
  }

  function hasCommonChars(a, b) {
    const lA = a.replace(/^\s+|\s+$/g, '');
    const lB = b.replace(/^\s+|\s+$/g, '');
    if (!lA.length || !lB.length) return true;

    // Two structural delimiters must never pair — neither identical
    // (ENDIF./ENDIF.) nor different ones sharing only 'END' (ENDLOOP. vs ENDIF.).
    if (isTrivialAnchor(lA) && isTrivialAnchor(lB)) return false;
    if (lA === lB) return true;

    const shorter = lA.length < lB.length ? lA : lB;
    const longer = lA.length < lB.length ? lB : lA;
    if (longer.slice(1) === shorter) return true;
    if (longer.slice(1).replace(/^\s+/, '') === shorter) return true;
    // One line's content is contained in the other (e.g. commented-out line:
    // old="  email TYPE x," new="  "email TYPE x, "some comment")
    if (shorter.length >= 3 && longer.includes(shorter)) return true;

    let cp = 0;
    while (cp < lA.length && cp < lB.length && lA[cp] === lB[cp]) cp++;
    if (cp < 3) return false;

    // Strip common suffix to isolate the changed middle
    let cs = 0;
    const laRest = lA.length - cp, lbRest = lB.length - cp;
    while (cs < laRest && cs < lbRest && lA[lA.length - 1 - cs] === lB[lB.length - 1 - cs]) cs++;

    const midA = lA.slice(cp, lA.length - cs);
    const midB = lB.slice(cp, lB.length - cs);
    // More than 2 edit runs in the middle → lines differ in too many places to pair
    if (countEditRuns(midA, midB) > 2) return false;
    if (countCharEditRuns(midA, midB) > 2) return false;
    return true;
  }


module.exports = { computeDiff, hasCommonChars, isTrivialAnchor };
