"use strict";

// A review built from ADT, when none is saved: what a transport request changed, part by part, in the shape of the
// payload AVE stores (OBJ_STATS, HUNKS, DIFF_DATA), so the same reading code shows it. Nothing here writes: a review
// built this way is for looking at the change; approving it is the saved review's business.
//
// For each part the request touched, the pair of versions is chosen by AVE's rule (see pairOf). A class part (a section, a method) is cut out of the versions of
// its class. The diff is the line diff of the Versions window; blocks are cut by AVE's own walk.

const versions = require("./versions-front");
const aveDiff = require("./ave-diff");

// ZCL_VX_REVIEW_STATS=>FROM_DIFF: in each run of changes a deleted line pairs with the first unpaired inserted one it
// has common characters with - a modified line; the rest are inserted or deleted; a run of blank lines counts for nothing.
const blank = list => list.every(line => String(line).replace(/\s/g, "") === "");
function countChanges(ops) {
  let ins = 0, del = 0, mod = 0, dels = [], adds = [];
  const flush = () => {
    if (!dels.length && !adds.length) { return; }
    if (!blank(dels.concat(adds))) {
      const used = adds.map(() => false);
      dels.forEach(d => {
        const at = adds.findIndex((a, i) => !used[i] && aveDiff.hasCommonChars(d, a));
        if (at >= 0) { used[at] = true; mod++; } else { del++; }
      });
      ins += used.filter(u => !u).length;
    }
    dels = []; adds = [];
  };
  ops.forEach(o => { if (o.op === "-") { dels.push(o.text); } else if (o.op === "+") { adds.push(o.text); } else { flush(); } });
  flush();
  return { ins, del, mod };
}
// ZCL_VX_REVIEW_STATS=>CLASSIFY_HUNK: a block is changed when any of its deleted lines pairs with an inserted one,
// otherwise added or deleted by whichever side is larger.
function classify(adds, dels) {
  if (!dels.length) { return "added"; }
  if (!adds.length) { return "deleted"; }
  if (dels.some(d => adds.some(a => aveDiff.hasCommonChars(d, a)))) { return "changed"; }
  return adds.length >= dels.length ? "added" : "deleted";
}
const { inLists } = require("./selector-table");
const { hunkRanges } = require("./review-hunks");

const sqlText = value => "'" + String(value).replace(/'/g, "''") + "'";
const CLASS_PART_TYPES = ["METH", "CPUB", "CPRO", "CPRI", "CINC"];

// The parts a request names, each with the object it is read through (type, name) - a class's parts from the class.
async function partsOfRequest(api, keys) {
  const parts = [], seen = new Set();
  const add = async (type, name, filter) => {
    for (const p of await versions.partsOf(api, type, name)) {
      if (filter && !filter(p)) { continue; }
      const key = p.part_type + "|" + p.name;
      if (seen.has(key)) { continue; }
      seen.add(key);
      parts.push({ type, object: name, part: p.name, ptype: p.part_type, unit: p.unit, className: type === "CLAS" ? name : "" });
    }
  };
  for (const k of keys) {
    const object = String(k.OBJECT), name = String(k.OBJ_NAME).trim();
    if (k.PGMID === "R3TR" && ["CLAS", "INTF", "FUGR", "PROG", "DDLS", "TABL", "DOMA", "DTEL"].includes(object)) { await add(object, name); continue; }
    if (object === "REPS") { await add("PROG", name); continue; }
    if (object === "FUNC") { await add("FUNC", name); continue; }
    if (object === "METH") {
      const owner = String(k.OBJ_NAME).slice(0, 30).trim(), method = String(k.OBJ_NAME).slice(30).trim();
      await add("CLAS", owner, p => p.part_type === "METH" && p.unit === method);
      continue;
    }
    if (CLASS_PART_TYPES.includes(object)) {
      const owner = String(k.OBJ_NAME).slice(0, 30).replace(/=+$/, "").trim();
      await add("CLAS", owner, p => p.part_type === object);
    }
  }
  return parts;
}

// The pair of versions the request's change is, read from the part's feed, by AVE's rule (ZCL_VX_VERSION_LIST=>LOAD
// with a request scope). NEW: the newest numbered version of the request; if a version of another request sits above
// it, that one stays NEW - the active state then holds the other request's work too; otherwise the active state when
// it belongs to the request; with no version of the request at all, the active state. OLD: the first version below NEW
// that is not the request's; none, and the oldest version unless that is NEW or the request's own (then the request
// created the part). Whose the active state is comes from ADT's feed, not from VRSD: VRSD keeps naming the request
// that last released it while later, unreleased work of another request already sits in it.
// Not carried: AVE skips the request's own transports of copies when looking for OLD, by resolving each to its parent.
function pairOf(feed, numbers) {
  const ordered = feed.filter(e => e.id !== "00000").sort((a, b) => Number(b.id) - Number(a.id));
  const active = feed.find(e => e.id === "00000") || null;
  const at = ordered.findIndex(e => numbers.has(e.transport));
  const own = at >= 0 ? ordered[at] : null;
  const foreignAbove = at > 0;
  let fresh;
  if (own && foreignAbove) { fresh = own; }
  else if (active && numbers.has(active.transport)) { fresh = active; }
  else { fresh = own || active; }
  if (!fresh) { return null; }
  const below = fresh === active ? ordered : ordered.slice(ordered.indexOf(fresh) + 1);
  let old = below.find(e => e.transport && !numbers.has(e.transport)) || null;
  if (!old && fresh.id !== "00001" && ordered.length) {
    const oldest = ordered[ordered.length - 1];
    old = oldest === fresh || numbers.has(oldest.transport) ? null : oldest;
  }
  return { fresh, old };
}

const cache = new WeakMap();

// The review of a request, built; kept for a few minutes per session, since the page asks for the summary and then
// for each part.
// PROGRESS, when given, is told what the build is doing, a line at a time.
async function build(api, request, progress) {
  if (!cache.has(api)) { cache.set(api, new Map()); }
  const kept = cache.get(api).get(request);
  if (kept && Date.now() - kept.at < 5 * 60 * 1000) { return kept.payload; }
  const promise = buildNow(api, request, progress || (() => {}));
  cache.get(api).set(request, { at: Date.now(), payload: promise });
  promise.catch(() => cache.get(api).delete(request));
  return promise;
}

async function buildNow(api, request, progress) {
  progress("reading what " + request + " holds ...");
  const head = (await api.query("SELECT trkorr FROM e070 WHERE trkorr = " + sqlText(request), 1)).values[0];
  if (!head) { throw new Error("Transport request " + request + " does not exist."); }
  const tasks = (await api.query("SELECT trkorr FROM e070 WHERE strkorr = " + sqlText(request), 1000)).values.map(r => r.TRKORR);
  const numbers = new Set([request, ...tasks]);
  const keys = await inLists(api, "SELECT pgmid, object, obj_name FROM e071 WHERE trkorr", [...numbers], 10000);
  const payload = { TRKORR: request, OBJ_STATS: [], HUNKS: [], DIFF_DATA: [], HUNK_ACTIONS: [], USER_STATES: [], THREADS: [], HISTORY: [] };

  const parts = await partsOfRequest(api, keys);
  for (const [at, p] of parts.entries()) {
    progress((at + 1) + " of " + parts.length + ": " + (p.ptype === "METH" ? p.object + " " + p.unit : p.part) + " - reading its versions ...");
    const where = await versions.partOf(api, p.type, p.object, p.part, p.ptype);
    if (!where) { continue; }
    const feed = await api.revisions(where.url, where.include || undefined);
    const pair = pairOf(feed, numbers);
    if (!pair) { continue; }
    const textOf = async entry => {
      if (!entry) { return []; }
      const text = await versions.sourceAt(api, entry.uri);
      return (where.cut ? where.cut(text) : versions.lines(text)) || [];
    };
    const oldLines = await textOf(pair.old), newLines = await textOf(pair.fresh);
    const ops = versions.diff(oldLines, newLines, false);
    if (!ops.some(o => o.op !== "=")) { continue; }

    const ranges = hunkRanges(ops);
    const versnoNew = pair.fresh.id === "00000" ? "99998" : pair.fresh.id, versnoOld = pair.old ? pair.old.id : "00000";
    const display = p.ptype === "METH" ? p.unit : p.part;
    const { ins, del, mod } = countChanges(ops);
    let hIns = 0, hMod = 0, hDel = 0;
    ranges.forEach((r, i) => {
      const block = ops.slice(r.op_from - 1, r.op_to);
      const adds = block.filter(o => o.op === "+").map(o => o.text), dels = block.filter(o => o.op === "-").map(o => o.text);
      const plus = adds.length, minus = dels.length;
      const kind = classify(adds, dels);
      if (kind === "changed") { hMod++; } else if (kind === "added") { hIns++; } else { hDel++; }
      payload.HUNKS.push({ HUNK_KEY: p.ptype + "~" + p.part + "~" + (i + 1), OBJTYPE: p.ptype, OBJ_NAME: p.part, CLASS_NAME: p.className,
        DISPLAY_NAME: display, HUNK_NO: i + 1, START_LINE: r.start_line, CHANGE_COUNT: plus + minus, CHANGE_KIND: kind,
        AUTHOR: pair.fresh.author, AUTHOR_NAME: "", VERSNO_NEW: versnoNew, VERSNO_OLD: versnoOld });
    });
    payload.DIFF_DATA.push({ KEY: { OBJTYPE: p.ptype, OBJNAME: p.part, VERSNO_O: versnoOld, VERSNO_N: versnoNew }, RETROFIT: false,
      DIFF: ops.map(o => ({ OP: o.op, TEXT: o.text })) });
    payload.OBJ_STATS.push({ OBJTYPE: p.ptype, CLASS_NAME: p.className, OBJ_NAME: p.part, VERSNO_NEW: versnoNew, VERSNO_OLD: versnoOld,
      AUTHOR: pair.fresh.author, AUTHOR_NAME: "", INS_COUNT: ins, DEL_COUNT: del, MOD_COUNT: mod, HUNK_COUNT: ranges.length,
      HUNK_INS: hIns, HUNK_MOD: hMod, HUNK_DEL: hDel, DISPLAY_NAME: display, IS_CREATED: !pair.old });
  }

  // Names to the authors, as the saved review carries them.
  progress("reading the authors' names ...");
  const authors = [...new Set(payload.OBJ_STATS.map(s => s.AUTHOR).filter(Boolean))];
  if (authors.length) {
    const names = new Map((await inLists(api, "SELECT u~bname, a~name_text FROM usr21 AS u INNER JOIN adrp AS a"
      + " ON a~persnumber = u~persnumber WHERE u~bname", authors, 1000)).map(r => [r.BNAME, r.NAME_TEXT]));
    payload.OBJ_STATS.forEach(s => { s.AUTHOR_NAME = names.get(s.AUTHOR) || ""; });
    payload.HUNKS.forEach(h => { h.AUTHOR_NAME = names.get(h.AUTHOR) || ""; });
  }
  return payload;
}

module.exports = { build, pairOf, countChanges };
