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
// Who wrote which line - AVE's "Who is Blame" (ZCL_VX_POPUP_DIFF=>BUILD_BLAME_MAP). The versions from OLD to NEW are
// replayed in order: a line takes the author of the version that added it, a removed line the author of the version
// that removed it. A line is known by its text, as in AVE. When one author wrote every version of the range the replay
// is skipped (SINGLE_RANGE_AUTHOR): every changed line is theirs. A created part's first version is its author's.
// A line is credited to the version's OWNER, as AVE credits OBJ_OWNER, not to whoever released or copied the version.
const num = e => e.id === "00000" ? 99999 : Number(e.id);
const blameEntry = (e, text) => ({ TEXT: text, AUTHOR: e.owner || e.author, AUTHOR_NAME: "", DATUM: String(e.time || "").slice(0, 10),
  ZEIT: String(e.time || "").slice(11, 19), VERSNO_TEXT: e.id === "00000" ? "Active" : String(Number(e.id)),
  KORRNUM: e.transport || "", TASK: e.transport || "", TASK_TEXT: "" });
const drop = (map, text) => { for (let i = map.length - 1; i >= 0; i--) { if (map[i].TEXT === text) { map.splice(i, 1); } } };
// ZCL_VX_VERSION_LIST=>LOAD, OBJ_OWNER: a version is the work of the developer whose task it came from. A task's
// version (S, R) is its owner's. A request's version (K), or a transport of copies (T, read back to its K through its
// CORR/MERG entry), is the owner's of the K's S/R task that carries the object and is the nearest before the version,
// or the newest such task when none is before it (an R task carries a date past its own versions). A version no task
// answers for stays its author's. OBJECT is the name the part is read through; a task carries it when an E071 entry
// of the task starts with it (a class, its methods, its includes). Times are compared as the feed and E070 give them.
function ownerResolver(api, object) {
  const heads = new Map(), tasksOfK = new Map(), owners = new Map();
  const digits = value => String(value || "").replace(/\D/g, "");
  const head = async t => {
    if (!heads.has(t)) {
      heads.set(t, (await api.query("SELECT trkorr, trfunction, strkorr, as4user FROM e070 WHERE trkorr = " + sqlText(t), 1)).values[0] || null);
    }
    return heads.get(t);
  };
  const tasks = async k => {
    if (!tasksOfK.has(k)) {
      const rows = (await api.query("SELECT e070~trkorr, e070~as4user, e070~as4date, e070~as4time FROM e070"
        + " INNER JOIN e071 ON e071~trkorr = e070~trkorr WHERE e070~strkorr = " + sqlText(k)
        + " AND e070~trfunction IN ('S', 'R') AND e071~obj_name LIKE " + sqlText(object + "%"), 1000)).values;
      const seen = new Set();
      tasksOfK.set(k, rows.filter(r => !seen.has(r.TRKORR) && seen.add(r.TRKORR))
        .map(r => ({ user: r.AS4USER, at: digits(r.AS4DATE) + digits(r.AS4TIME) })).sort((a, b) => b.at.localeCompare(a.at)));
    }
    return tasksOfK.get(k);
  };
  return async entry => {
    const t = entry.transport;
    if (!t) { return entry.author; }
    const key = t + "|" + entry.time;
    if (!owners.has(key)) {
      let owner = entry.author;
      const h = await head(t);
      if (h && (h.TRFUNCTION === "S" || h.TRFUNCTION === "R") && h.AS4USER) { owner = h.AS4USER; }
      else if (h && (h.TRFUNCTION === "K" || h.TRFUNCTION === "T")) {
        let k = t;
        if (h.TRFUNCTION === "T") {
          const merg = (await api.query("SELECT obj_name FROM e071 WHERE trkorr = " + sqlText(t)
            + " AND pgmid = 'CORR' AND object = 'MERG'", 1)).values[0];
          k = merg ? String(merg.OBJ_NAME).slice(0, 10) : "";
        }
        if (k) {
          const list = await tasks(k), at = digits(entry.time).slice(0, 14);
          const pick = list.find(c => c.at <= at) || list[0];
          if (pick && pick.user) { owner = pick.user; }
        }
      }
      owners.set(key, owner);
    }
    return owners.get(key);
  };
}

async function blameOf(api, feed, pair, ops, textOf, ownerOf) {
  const lo = pair.old ? num(pair.old) : 0, hi = num(pair.fresh);
  const range = feed.filter(e => num(e) >= lo && num(e) <= hi).sort((a, b) => num(a) - num(b));
  const map = [], deleted = [];
  for (const e of range) { e.owner = await ownerOf(e); }
  if (new Set(range.slice(pair.old ? 1 : 0).map(e => e.owner)).size <= 1) {
    ops.forEach(o => { if (o.op === "+") { map.push(blameEntry(pair.fresh, o.text)); } else if (o.op === "-") { deleted.push(blameEntry(pair.fresh, o.text)); } });
    return { map, deleted };
  }
  let prev = await textOf(range[0]);
  if (!pair.old) { prev.forEach(text => map.push(blameEntry(range[0], text))); }
  for (const e of range.slice(1)) {
    const cur = await textOf(e);
    for (const d of await versions.diff(prev, cur, false, api)) {
      if (d.op === "+") { drop(map, d.text); map.push(blameEntry(e, d.text)); }
      else if (d.op === "-") { drop(deleted, d.text); deleted.push(blameEntry(e, d.text)); drop(map, d.text); }
    }
    prev = cur;
  }
  return { map, deleted };
}
const blamed = (map, text) => { const b = map.find(m => m.TEXT === text); return b && b.AUTHOR ? b.AUTHOR : ""; };

// ZCL_VX_REVIEW_STATS=>FROM_DIFF with a blame map: per author, inserted and modified lines (a modified line is its new
// text's), a line the map does not know booked on DEF. Deleted lines are not booked on anyone, as in AVE. Blocks are
// counted from the review's own blocks, so an author's blocks are the blocks the page lists under them.
function blameAuthors(ops, map, def, hunks) {
  const by = new Map();
  const at = author => {
    if (!by.has(author)) { by.set(author, { AUTHOR: author, AUTHOR_NAME: "", INS_COUNT: 0, DEL_COUNT: 0, MOD_COUNT: 0,
      HUNK_COUNT: 0, HUNK_INS: 0, HUNK_MOD: 0, HUNK_DEL: 0 }); }
    return by.get(author);
  };
  let dels = [], adds = [];
  const flush = () => {
    if ((dels.length || adds.length) && !blank(dels.concat(adds))) {
      const used = adds.map(() => false);
      dels.forEach(d => {
        const i = adds.findIndex((a, k) => !used[k] && aveDiff.hasCommonChars(d, a));
        if (i >= 0) { used[i] = true; at(blamed(map, adds[i]) || def).MOD_COUNT++; }
      });
      adds.forEach((a, k) => { if (!used[k]) { at(blamed(map, a) || def).INS_COUNT++; } });
    }
    dels = []; adds = [];
  };
  ops.forEach(o => { if (o.op === "-") { dels.push(o.text); } else if (o.op === "+") { adds.push(o.text); } else { flush(); } });
  flush();
  hunks.forEach(h => {
    const a = at(h.AUTHOR);
    a.HUNK_COUNT++;
    if (h.CHANGE_KIND === "added") { a.HUNK_INS++; } else if (h.CHANGE_KIND === "changed") { a.HUNK_MOD++; } else { a.HUNK_DEL++; }
  });
  return [...by.values()].filter(a => a.AUTHOR);
}
// ZCL_VX_ACR_HUNK_INFO: whoever wrote most of a block's inserted lines owns it; DEF when the map knows none of them.
function blockAuthor(adds, map, def) {
  const count = new Map();
  adds.forEach(text => { const a = blamed(map, text); if (a) { count.set(a, (count.get(a) || 0) + 1); } });
  let top = "", most = 0;
  count.forEach((n, a) => { if (n > most) { most = n; top = a; } });
  return top || def;
}

const { inLists } = require("./selector-table");
const { hunkRanges } = require("./review-hunks");

const sqlText = value => "'" + String(value).replace(/'/g, "''") + "'";
const CLASS_PART_TYPES = ["METH", "CPUB", "CPRO", "CPRI", "CINC"];

// The parts a request names, each with the object it is read through (type, name) - a class's parts from the class.
/* An object a request names may be gone from the system since: deleted, it has no parts to read. Whether it exists is
   asked of TADIR (a function module of TFDIR), not read from SAP's message. Neither stops the review: each is listed
   with its reason - deleted since, or SAP's own words - [{ object, name, reason }]. */
// PROG for a program, INCL for an include (TRDIR SUBC I), as versions-front's partInScope tells them apart.
async function programKind(api, name) {
  const row = (await api.query("SELECT subc FROM trdir WHERE name = " + sqlText(name), 1)).values[0];
  return row && row.SUBC === "I" ? "INCL" : "PROG";
}

async function exists(api, type, name) {
  if (type === "INCL") { type = "PROG"; }
  const sql = type === "FUNC" ? "SELECT funcname FROM tfdir WHERE funcname = " + sqlText(name)
    // A deleted object keeps its TADIR entry, marked for deletion (DELFLAG X), as AVE's overview reads it.
    : "SELECT obj_name FROM tadir WHERE pgmid = 'R3TR' AND object = " + sqlText(type) + " AND obj_name = " + sqlText(name)
      + " AND delflag <> 'X'";
  return (await api.query(sql, 1)).values.length > 0;
}

const methodOf = versions.methodOf;

async function partsOfRequest(api, keys, numbers, log) {
  const say = log || (() => {});
  const parts = [], seen = new Set(), missing = [];
  const add = async (type, name, filter) => {
    let found;
    try { found = await versions.partsOf(api, type, name); }
    catch (error) {
      const reason = await exists(api, type, name) ? String(error && error.message || error) : "deleted since";
      if (!missing.some(m => m.object === type && m.name === name)) { missing.push({ object: type, name, reason }); }
      say("SKIP " + type + " " + name + ": " + reason);
      return;
    }
    say(type + " " + name + ": " + found.length + " part(s) " + found.map(p => p.part_type + " " + (p.unit || p.name)).join(", "));
    const before = parts.length;
    for (const p of found) {
      if (filter && !filter(p)) { continue; }
      const key = p.part_type + "|" + p.name;
      if (seen.has(key)) { continue; }
      seen.add(key);
      parts.push({ type, object: name, part: p.name, ptype: p.part_type, unit: p.unit, className: type === "CLAS" ? name : "" });
    }
    return parts.length - before;
  };
  /* A class whose methods the request names one by one is not opened whole: the METH entries say what changed, and
     the class entry beside them would add every method of it (GET_PARTS_EXPANDED). */
  const listed = new Set(keys.filter(k => String(k.OBJECT) === "METH").map(k => methodOf(k.OBJ_NAME).owner.toUpperCase()));
  for (const k of keys) {
    const object = String(k.OBJECT), name = String(k.OBJ_NAME).trim();
    if (k.PGMID === "R3TR" && object === "CLAS" && listed.has(name.toUpperCase())) { continue; }
    /* A whole class is opened without its technical includes - local types, test classes, macros - as AVE expands it
       for review; a request that names such an include (LIMU CINC) still has it. */
    if (k.PGMID === "R3TR" && object === "CLAS") { await add(object, name, p => p.part_type !== "CINC"); continue; }
    // A program's source may be an include - a user exit's ZX..., a program's _F01 - which ADT keeps under its own address.
    if (object === "REPS" || (k.PGMID === "R3TR" && object === "PROG")) { await add(await programKind(api, name), name); continue; }
    if (k.PGMID === "R3TR" && ["CLAS", "INTF", "FUGR", "DDLS", "TABL", "DOMA", "DTEL"].includes(object)) { await add(object, name); continue; }
    if (object === "FUNC") { await add("FUNC", name); continue; }
    if (object === "METH") {
      const { owner, method } = methodOf(k.OBJ_NAME);
      if (!owner) { continue; }
      // The class alone: its methods are the ones the request and its tasks hold versions of (VRSD).
      let methods = method ? [method] : [];
      if (!method && numbers && numbers.size) {
        const rows = await inLists(api, "SELECT objname FROM vrsd WHERE objtype = 'METH' AND objname LIKE "
          + sqlText(owner.padEnd(30, " ") + "%") + " AND korrnum", [...numbers], 10000);
        methods = rows.map(r => String(r.OBJNAME).slice(30).trim()).filter(Boolean);
      }
      const wanted = new Set(methods.map(m => m.toUpperCase()));
      // E071 names the method in capitals; the class layout as it is written in the source.
      say("METH " + owner + " " + (method || "(class alone)") + ": wanted " + ([...wanted].join(", ") || "nothing"));
      if (wanted.size && !await add("CLAS", owner, p => p.part_type === "METH" && wanted.has(String(p.unit).toUpperCase()))) {
        say("SKIP METH " + owner + "->" + [...wanted].join(", ") + ": not among the methods ADT lists for the class (or already taken)");
      }
      continue;
    }
    if (CLASS_PART_TYPES.includes(object)) {
      const owner = String(k.OBJ_NAME).slice(0, 30).replace(/=+$/, "").trim();
      await add("CLAS", owner, p => p.part_type === object);
    }
  }
  return { parts, missing };
}

/* A dictionary object ADT keeps no versions of on this release (DTEL, DOMA, TABL: "Request version ... is not supported")
   cannot be built here; AVE builds it on the SAP side (SVRS_GET_VERSION_DTED_40 and the like). A rebuild takes such a part
   from the saved review as AVE left it - its blocks and diff, not its verdicts, which a rebuild drops - so it is not lost
   to "Not reviewed". BUILT is not changed: it may be the session's kept build. */
const DDIC_PART = { TABL: "TABD", DOMA: "DOMD", DTEL: "DTED" };
function carryUnread(built, saved) {
  const list = value => Array.isArray(value) ? value : [];
  const missing = list(built.MISSING);
  const unread = new Set(missing.filter(m => DDIC_PART[m.object]).map(m => DDIC_PART[m.object] + "|" + String(m.name).toUpperCase()));
  const key = (type, name) => String(type).toUpperCase() + "|" + String(name).trim().toUpperCase();
  const stats = list(saved.OBJ_STATS).filter(s => unread.has(key(s.OBJTYPE, s.OBJ_NAME)));
  const taken = new Set(stats.map(s => key(s.OBJTYPE, s.OBJ_NAME)));
  const payload = Object.assign({}, built, {
    OBJ_STATS: list(built.OBJ_STATS).concat(stats),
    HUNKS: list(built.HUNKS).concat(list(saved.HUNKS).filter(h => taken.has(key(h.OBJTYPE, h.OBJ_NAME)))),
    DIFF_DATA: list(built.DIFF_DATA).concat(list(saved.DIFF_DATA).filter(d => d.KEY && taken.has(key(d.KEY.OBJTYPE, d.KEY.OBJNAME))))
  });
  Object.defineProperty(payload, "MISSING", { value: missing.filter(m => !(DDIC_PART[m.object] && taken.has(DDIC_PART[m.object] + "|" + String(m.name).toUpperCase()))),
    enumerable: false });
  if (built.DIAG) {
    const diag = built.DIAG.concat([...taken].map(k => "CARRIED " + k.replace("|", " ") + ": from the saved review, as AVE built it"));
    Object.defineProperty(payload, "DIAG", { value: diag, enumerable: false });
  }
  return payload;
}

// The log of the last build of each request (AVE's Code Review diagnostics), kept for the session: a review built and
// then saved keeps no place for it in its payload.
const lastLogs = new Map();
const lastLog = request => lastLogs.get(String(request).toUpperCase()) || null;

// The pair of versions the request's change is, read from the part's feed, by AVE's rule (ZCL_VX_VERSION_LIST=>LOAD
// with a request scope). NEW: the newest numbered version of the request; if a version of another request sits above
// it, that one stays NEW - the active state then holds the other request's work too; otherwise the active state when
// it belongs to the request; with no version of the request at all, the active state. OLD: the first version below NEW
// that is not the request's; none, and the oldest version unless that is NEW or the request's own (then the request
// created the part). Whose the active state is comes from ADT's feed, not from VRSD: VRSD keeps naming the request
// that last released it while later, unreleased work of another request already sits in it.
// NUMBERS holds the request, its tasks and its own transports of copies (see requestParts).
// OPEN: the active state stands in for a missing version of the request only while the request is not released. A
// released request is history - every part it changed has a version of its own - and the active state of a part it has
// none of holds another request's work (AVE: IS_RELEASED_KORR); such a part has no pair.
function pairOf(feed, numbers, open) {
  const ordered = feed.filter(e => e.id !== "00000").sort((a, b) => Number(b.id) - Number(a.id));
  const active = feed.find(e => e.id === "00000") || null;
  const at = ordered.findIndex(e => numbers.has(e.transport));
  const own = at >= 0 ? ordered[at] : null;
  const foreignAbove = at > 0;
  let fresh;
  if (own && foreignAbove) { fresh = own; }
  else if (active && numbers.has(active.transport)) { fresh = active; }
  else { fresh = own || (open ? active : null); }
  if (!fresh) { return null; }
  const below = fresh === active ? ordered : ordered.slice(ordered.indexOf(fresh) + 1);
  let old = below.find(e => e.transport && !numbers.has(e.transport)) || null;
  if (!old && fresh.id !== "00001" && ordered.length) {
    const oldest = ordered[ordered.length - 1];
    old = oldest === fresh || numbers.has(oldest.transport) ? null : oldest;
  }
  return { fresh, old };
}

// A numbered version never changes, so its text is read once a session; the active state (00000) can change under the
// same address at any time, and is read anew - kept, it would hide the very edit a rebuild or a check is for.
const activeOrKept = (api, entry) => entry.id === "00000" ? Promise.resolve(api.revisionSource(entry.uri)) : versions.sourceAt(api, entry.uri);

// Code SAP wrote, not a developer - function group framework includes and the like, whose new version is authored by
// SAP* - is not a change to review (ZCL_VX_ACR_PREPARE=>IS_SAP_GENERATED_AUTHOR, AVE's "Ignore SAP generated").
const generated = pair => /^SAP/i.test(String(pair.fresh.author || ""));

// Objects SAP generates (ZCL_AVE_ACR_PREPARE=>IS_GENERATED_CLASS): the Gateway classes <name>_MPC, <name>_MPC_EXT and
// <name>_DPC, regenerated from the OData model - <name>_DPC_EXT is written by hand and stays - and the function group
// main program SAPL<area>, whose include list SAP rewrites under the name of whoever added a function module.
const generatedObject = p => [p.className, p.object, p.part].some(name => {
  const n = String(name || "").toUpperCase().split(/[= ]/)[0];
  return /_MPC$|_MPC_EXT$|_DPC$/.test(n) || /^SAPL/.test(n);
});

// A header line a generator rewrites on every run (ZCL_AVE_ACR_PREPARE=>IS_GENERATED_TS_LINE): the SEGW stamp, a
// function group's regeneration stamp, the table maintenance generator's date and version.
const stampLine = text => {
  const t = String(text || "").toUpperCase().replace(/\s+/g, " ");
  return (t.includes("HAS BEEN GENERATED ON") && t.includes("IN CLIENT")) || t.includes("REGENERATED AT")
    || t.includes("GENERATION DATE:") || t.includes("MAINTENANCE GENERATOR VERSION");
};

// In each run of changes a removed stamp line and an inserted one make an unchanged line with the new text
// (STRIP_GENERATED_TS_DIFF); a stamp line only added or only removed stays a change.
function stripStamps(ops) {
  const out = [];
  let run = [];
  const flush = () => {
    let removed = run.filter(o => o.op === "-" && stampLine(o.text)).length;
    let paired = Math.min(removed, run.filter(o => o.op === "+" && stampLine(o.text)).length);
    let drop = paired;
    run.forEach(o => {
      if (o.op === "-" && drop && stampLine(o.text)) { drop--; return; }
      if (o.op === "+" && paired && stampLine(o.text)) { paired--; out.push({ op: "=", text: o.text }); return; }
      out.push(o);
    });
    run = [];
  };
  ops.forEach(o => { if (o.op === "=") { flush(); out.push(o); } else { run.push(o); } });
  flush();
  return out;
}

// A created object of comment lines only (IS_COMMENTS_ONLY), and a class section that holds nothing but its own header
// on both sides (IS_EMPTY_SECTION) - a new class gets all three, used or not - are not changes to review.
const commentsOnly = lines => lines.every(l => { const t = String(l).trim(); return !t || t[0] === "*"; });
const emptySection = lines => lines.every(l => {
  const t = String(l).trim().toUpperCase().replace(/\s+/g, " ");
  return !t || t[0] === "*" || t[0] === '"' || /^(PUBLIC|PROTECTED|PRIVATE) SECTION\.$/.test(t);
});

// The rules together, as the build applies them while "Ignore SAP generated" is on.
const ignored = { object: generatedObject, pair: generated, ops: stripStamps,
  text: (p, pair, oldLines, newLines) => (!pair.old && commentsOnly(newLines))
    || (["CPUB", "CPRO", "CPRI"].includes(p.ptype) && emptySection(newLines) && emptySection(oldLines)) };

// A part without a pair is listed, never dropped without a word.
const noPair = open => open ? "no version of this part, and no active state"
  : "the request is released and holds no version of this part; the active state belongs to later work";

const cache = new WeakMap();

// The review of a request, built; kept for a few minutes per session, since the page asks for the summary and then
// for each part.
// PROGRESS, when given, is told what the build is doing, a line at a time. FRESH builds it again whatever is kept.
// BLAME adds who wrote each changed line (AVE's "Who is Blame"); off, every block is the NEW version's author's.
// KEEP_GENERATED keeps the code SAP generated (AVE's "Ignore SAP generated" off). ON_PART, when given, is handed the
// payload as it stands after each part is done - the review so far - while the rest is read.
async function build(api, request, progress, fresh, blame, keepGenerated, onPart) {
  const key = request + (blame ? "|blame" : "") + (keepGenerated ? "|generated" : "");
  if (!cache.has(api)) { cache.set(api, new Map()); }
  const kept = cache.get(api).get(key);
  if (!fresh && kept && Date.now() - kept.at < 5 * 60 * 1000) { return kept.payload; }
  const promise = buildNow(api, request, progress || (() => {}), Boolean(blame), Boolean(keepGenerated), onPart || (() => {}));
  cache.get(api).set(key, { at: Date.now(), payload: promise });
  promise.catch(() => cache.get(api).delete(key));
  return promise;
}

// The request with its tasks, and the parts they name.
async function requestParts(api, request, log) {
  const head = (await api.query("SELECT trkorr, trstatus FROM e070 WHERE trkorr = " + sqlText(request), 1)).values[0];
  if (!head) { throw new Error("Transport request " + request + " does not exist."); }
  const tasks = (await api.query("SELECT trkorr FROM e070 WHERE strkorr = " + sqlText(request), 1000)).values.map(r => r.TRKORR);
  // The request's own transports of copies are the request too (ZCL_VX_REQUEST=>RESOLVE_PARENT_K): a ToC names the
  // request it copies in its CORR/MERG entry. Without them the newest ToC of the request became the old side, and the
  // review showed only what changed since the last copy.
  const copies = (await api.query("SELECT trkorr, obj_name FROM e071 WHERE pgmid = 'CORR' AND object = 'MERG'"
    + " AND obj_name LIKE " + sqlText(request + "%"), 10000)).values
    .filter(r => String(r.OBJ_NAME || "").slice(0, 10) === request).map(r => r.TRKORR);
  const numbers = new Set([request, ...tasks, ...copies]);
  const keys = await inLists(api, "SELECT pgmid, object, obj_name FROM e071 WHERE trkorr", [...numbers], 10000);
  const open = head.TRSTATUS !== "R" && head.TRSTATUS !== "N";
  return Object.assign({ numbers, open }, await partsOfRequest(api, keys, numbers, log));
}

const labelOf = p => p.ptype === "METH" ? p.object + "->" + p.unit : p.part;
const versnos = pair => ({ fresh: pair.fresh.id === "00000" ? "99998" : pair.fresh.id, old: pair.old ? pair.old.id : "00000" });

async function buildNow(api, request, progress, withBlame, keepGenerated, onPart) {
  const skip = keepGenerated ? { object: () => false, pair: () => false, text: () => false, ops: ops => ops } : ignored;
  progress("reading what " + request + " holds ...");
  const payload = { TRKORR: request, OBJ_STATS: [], HUNKS: [], DIFF_DATA: [], HUNK_ACTIONS: [], USER_STATES: [], THREADS: [], HISTORY: [] };

  const diag = [], log = text => diag.push(text);
  lastLogs.set(String(request).toUpperCase(), diag);
  Object.defineProperty(payload, "DIAG", { value: diag, enumerable: false });
  const { numbers, open, parts, missing } = await requestParts(api, request, log);
  log("REQUEST " + request + ": " + [...numbers].join(", ") + (open ? ", open" : ", released") + "; " + parts.length + " part(s)");
  // One resolver per object read through, so its tasks and requests are asked once for all its parts.
  const resolvers = new Map();
  const ownerOf = object => { if (!resolvers.has(object)) { resolvers.set(object, ownerResolver(api, object)); } return resolvers.get(object); };
  // Kept beside the payload, not in it: a saved review is AVE's format, which has no place for them.
  Object.defineProperty(payload, "MISSING", { value: missing, enumerable: false });
  for (const [at, p] of parts.entries()) {
    progress((at + 1) + " of " + parts.length + ": " + (p.ptype === "METH" ? p.object + " " + p.unit : p.part) + " - reading its versions ...");
    /* One part that cannot be read - ADT keeps no versions of its type on this release ("Request version for DTEL is
       not supported"), a version that will not open - does not end the review: it is listed with SAP's own words, and
       the rest is reviewed. */
    const label = labelOf(p);
    log("PART " + p.ptype + " " + label);
    if (skip.object(p)) { log("SKIP " + label + ": generated class or function group main program"); continue; }
    let where, pair, ops, blame;
    try {
      // A data element, domain or table: VRSD's history and VERTEX's ABAP for the text, where ADT keeps none.
      where = await versions.partOf(api, p.type, p.object, p.part, p.ptype);
      if (!where) { log("SKIP " + label + ": no version history for this kind of part"); continue; }
      const history = await versions.historyOf(api, p.ptype, p.part, where);
      const dictionary = history.textOf ? history : null;
      if (dictionary) { log("  VRSD: ADT keeps no versions of " + p.ptype + " here; VERTEX's ABAP gives their text"); }
      /* A dictionary object VRSD holds no version of was never versioned: it exists only as its active state, and the
         request names it, so that state is the request's - a new object, as AVE reviews it (99998 against nothing). */
      const feed = dictionary && !history.feed.length ? [{ id: "00000", transport: request, author: "", uri: "ddic:00000", time: "" }]
        : history.feed;
      feed.forEach(e => log("  VER " + e.id + " " + (e.transport || "-") + " " + (e.author || "")));
      pair = pairOf(feed, numbers, open);
      if (!pair) { throw new Error(noPair(open)); }
      log("  PAIR new=" + pair.fresh.id + " (" + (pair.fresh.transport || "-") + ") old=" + (pair.old ? pair.old.id + " (" + (pair.old.transport || "-") + ")" : "none"));
      if (skip.pair(pair)) { log("SKIP " + label + ": SAP auto-generated code (author " + pair.fresh.author + ")"); continue; }
      const textOf = dictionary ? dictionary.textOf : async entry => {
        if (!entry) { return []; }
        const text = await activeOrKept(api, entry);
        return (where.cut ? where.cut(text) : versions.lines(text)) || [];
      };
      const oldLines = await textOf(pair.old), newLines = await textOf(pair.fresh);
      log("  TEXT old=" + oldLines.length + " line(s), new=" + newLines.length + " line(s)");
      if (skip.text(p, pair, oldLines, newLines)) { log("SKIP " + label + ": new object of comments only, or an empty class section"); continue; }
      ops = skip.ops(await versions.diff(oldLines, newLines, false, api));
      blame = { map: [], deleted: [] };
      if (withBlame && ops.some(o => o.op !== "=")) {
        progress((at + 1) + " of " + parts.length + ": " + labelOf(p) + " - who wrote which line ...");
        blame = await blameOf(api, feed, pair, ops, textOf, ownerOf(p.object));
      }
    } catch (error) {
      missing.push({ object: p.ptype === "METH" ? "METH" : p.type, name: p.ptype === "METH" ? p.object + "->" + p.unit : p.part,
        reason: String(error && error.message || error) });
      log("SKIP " + label + ": " + String(error && error.message || error));
      continue;
    }
    if (!ops.some(o => o.op !== "=")) { log("SKIP " + label + ": no difference between the two versions"); continue; }

    const ranges = hunkRanges(ops);
    if (!ranges.length) { log("SKIP " + label + ": only blank lines changed"); }
    else { log("  BLOCKS " + ranges.length); }
    const { fresh: versnoNew, old: versnoOld } = versnos(pair);
    const display = p.ptype === "METH" ? p.unit : p.part;
    const { ins, del, mod } = countChanges(ops);
    let hIns = 0, hMod = 0, hDel = 0;
    ranges.forEach((r, i) => {
      const block = ops.slice(r.op_from - 1, r.op_to);
      const adds = block.filter(o => o.op === "+").map(o => o.text), dels = block.filter(o => o.op === "-").map(o => o.text);
      const plus = adds.length, minus = dels.length;
      const kind = classify(adds, dels);
      const hunkAuthor = blockAuthor(adds, blame.map, pair.fresh.owner || pair.fresh.author);
      if (kind === "changed") { hMod++; } else if (kind === "added") { hIns++; } else { hDel++; }
      payload.HUNKS.push({ HUNK_KEY: p.ptype + "~" + p.part + "~" + (i + 1), OBJTYPE: p.ptype, OBJ_NAME: p.part, CLASS_NAME: p.className,
        DISPLAY_NAME: display, HUNK_NO: i + 1, START_LINE: r.start_line, CHANGE_COUNT: plus + minus, CHANGE_KIND: kind,
        AUTHOR: hunkAuthor, AUTHOR_NAME: "", VERSNO_NEW: versnoNew, VERSNO_OLD: versnoOld });
    });
    const partHunks = payload.HUNKS.filter(h => h.OBJTYPE === p.ptype && h.OBJ_NAME === p.part);
    payload.DIFF_DATA.push({ KEY: { OBJTYPE: p.ptype, OBJNAME: p.part, VERSNO_O: versnoOld, VERSNO_N: versnoNew, BLAME: withBlame },
      RETROFIT: false, DIFF: ops.map(o => ({ OP: o.op, TEXT: o.text })), BLAME_MAP: blame.map, BLAME_DELETED: blame.deleted });
    payload.OBJ_STATS.push({ OBJTYPE: p.ptype, CLASS_NAME: p.className, OBJ_NAME: p.part, VERSNO_NEW: versnoNew, VERSNO_OLD: versnoOld,
      AUTHOR: pair.fresh.author, AUTHOR_NAME: "", INS_COUNT: ins, DEL_COUNT: del, MOD_COUNT: mod, HUNK_COUNT: ranges.length,
      HUNK_INS: hIns, HUNK_MOD: hMod, HUNK_DEL: hDel, DISPLAY_NAME: display, IS_CREATED: !pair.old,
      BT_AUTHORS: withBlame ? blameAuthors(ops, blame.map, pair.fresh.owner || pair.fresh.author, partHunks) : [] });
    onPart(payload);
  }

  // Names to the authors, as the saved review carries them.
  progress("reading the authors' names ...");
  const blames = payload.DIFF_DATA.flatMap(d => d.BLAME_MAP.concat(d.BLAME_DELETED));
  const authors = [...new Set(payload.OBJ_STATS.map(s => s.AUTHOR).concat(payload.HUNKS.map(h => h.AUTHOR), blames.map(b => b.AUTHOR))
    .filter(Boolean))];
  if (authors.length) {
    const names = new Map((await inLists(api, "SELECT u~bname, a~name_text FROM usr21 AS u INNER JOIN adrp AS a"
      + " ON a~persnumber = u~persnumber WHERE u~bname", authors, 1000)).map(r => [r.BNAME, r.NAME_TEXT]));
    payload.OBJ_STATS.forEach(s => { s.AUTHOR_NAME = names.get(s.AUTHOR) || ""; });
    payload.HUNKS.forEach(h => { h.AUTHOR_NAME = names.get(h.AUTHOR) || ""; });
    payload.OBJ_STATS.forEach(s => s.BT_AUTHORS.forEach(a => { a.AUTHOR_NAME = names.get(a.AUTHOR) || ""; }));
    blames.forEach(b => { b.AUTHOR_NAME = names.get(b.AUTHOR) || ""; });
  }
  return payload;
}

/* Whether a saved review still is the request's change, without building it again: each part's pair of versions is
   chosen as a build would choose it and compared with the pair the review was cut from. Only sources that numbers
   cannot settle are read - a part whose new side is the active state (99998), whose text may move without a new
   version, and a part the request names that the review does not hold, which counts only when it differs. Answers
   { changed: [{ name, reason }], unchecked: [{ name, reason }] }; a part that cannot be read is unchecked, not fine. */
async function staleness(api, request, saved, progress, keepGenerated, cancelled) {
  const skip = keepGenerated ? { object: () => false, pair: () => false, text: () => false, ops: ops => ops } : ignored;
  const say = progress || (() => {});
  /* A released request is history: its versions no longer change, and its pair is taken from its own versions only, so
     later work of other requests cannot move it. Nothing to check - and checking cost a read of every part's feed. */
  const head = (await api.query("SELECT trstatus FROM e070 WHERE trkorr = " + sqlText(request), 1)).values[0];
  if (head && (head.TRSTATUS === "R" || head.TRSTATUS === "N")) { return { changed: [], unchecked: [] }; }
  say("checking whether " + request + " changed since its review was saved: reading what it holds ...");
  const { numbers, open, parts, missing } = await requestParts(api, request);
  const list = value => Array.isArray(value) ? value : [];
  const key = (type, name) => String(type) + "|" + String(name);
  const held = new Map(list(saved.OBJ_STATS).map(s => [key(s.OBJTYPE, s.OBJ_NAME), s]));
  const changed = [], unchecked = missing.map(m => ({ name: m.name, reason: m.reason }));
  for (const [at, p] of parts.entries()) {
    const name = labelOf(p), stats = held.get(key(p.ptype, p.part));
    // The window answers one request at a time: a check the page left must not hold up what it asks next.
    if (cancelled && cancelled()) { throw new Error("The check was cancelled."); }
    say("checking whether " + request + " changed since its review was saved: " + (at + 1) + " of " + parts.length + ", " + name + " ...");
    held.delete(key(p.ptype, p.part));
    if (skip.object(p)) { continue; }
    try {
      /* A dictionary object ADT keeps no versions of (DTEL, DOMA, TABL) is checked by VRSD, which the data preview
         reads: the pair is chosen from its version directory by the same rule, and compared with the review's. Its
         text cannot be read here, so an active state is judged by the day VRSD says it was last activated. */
      if (Object.values(DDIC_PART).includes(p.ptype)) {
        const rows = (await api.query("SELECT versno, korrnum, author, datum FROM vrsd WHERE objtype = " + sqlText(p.ptype)
          + " AND objname = " + sqlText(p.part), 1000)).values;
        // Never versioned: the object exists only as its active state, which the request created - AVE's 99998 : 0.
        const pair = rows.length ? pairOf(rows.map(r => ({ id: String(r.VERSNO), transport: String(r.KORRNUM || ""), author: String(r.AUTHOR || "") })),
          numbers, open) : { fresh: { id: "00000", transport: request }, old: null };
        // Not in the saved review: AVE found nothing to review in it, and nothing here can say otherwise.
        if (!stats) { continue; }
        if (!pair) { changed.push({ name, reason: noPair(open) }); continue; }
        const now = versnos(pair);
        if (Number(stats.VERSNO_NEW) !== Number(now.fresh) || Number(stats.VERSNO_OLD) !== Number(now.old)) {
          changed.push({ name, reason: "versions " + stats.VERSNO_OLD + " : " + stats.VERSNO_NEW + " in the review, " + now.old + " : " + now.fresh + " now" });
          continue;
        }
        const active = rows.find(r => String(r.VERSNO) === "00000");
        if (now.fresh === "99998" && active && String(active.DATUM).replace(/-/g, "") > String(saved.LAST_SAVED_AT || "").slice(0, 8)) {
          changed.push({ name, reason: "activated again after the review was saved" });
        }
        continue;
      }
      const where = await versions.partOf(api, p.type, p.object, p.part, p.ptype);
      if (!where) { continue; }
      const pair = pairOf(await api.revisions(where.url, where.include || undefined), numbers, open);
      if (!pair) { throw new Error(noPair(open)); }
      if (skip.pair(pair)) { continue; }
      const now = versnos(pair);
      const textOf = async entry => {
        if (!entry) { return []; }
        const text = await activeOrKept(api, entry);
        return (where.cut ? where.cut(text) : versions.lines(text)) || [];
      };
      if (!stats) {
        const oldLines = await textOf(pair.old), newLines = await textOf(pair.fresh);
        if (skip.text(p, pair, oldLines, newLines)) { continue; }
        const ops = skip.ops(await versions.diff(oldLines, newLines, false, api));
        if (ops.some(o => o.op !== "=")) { changed.push({ name, reason: "changed by the request, not in the review" }); }
        continue;
      }
      if (Number(stats.VERSNO_NEW) !== Number(now.fresh) || Number(stats.VERSNO_OLD) !== Number(now.old)) {
        changed.push({ name, reason: "versions " + stats.VERSNO_OLD + " : " + stats.VERSNO_NEW + " in the review, " + now.old + " : " + now.fresh + " now" });
        continue;
      }
      if (now.fresh !== "99998") { continue; }
      const diff = list(saved.DIFF_DATA).find(d => d.KEY && key(d.KEY.OBJTYPE, d.KEY.OBJNAME) === key(p.ptype, p.part)
        && Number(d.KEY.VERSNO_N) === 99998 && !(d.RETROFIT === true || d.RETROFIT === "X"));
      if (!diff || !list(diff.DIFF).length) { unchecked.push({ name, reason: "the review keeps no text of its active state" }); continue; }
      const then = list(diff.DIFF).filter(l => l.OP !== "-").map(l => String(l.TEXT));
      const current = await textOf(pair.fresh);
      if (then.length !== current.length || then.some((line, i) => line !== String(current[i]))) {
        changed.push({ name, reason: "its active state changed" });
      }
    } catch (error) {
      unchecked.push({ name, reason: String(error && error.message || error) });
    }
  }
  held.forEach(s => changed.push({ name: s.OBJTYPE === "METH" && s.CLASS_NAME ? s.CLASS_NAME + "->" + s.OBJ_NAME : String(s.OBJ_NAME),
    reason: "no longer changed by the request" }));
  return { changed, unchecked };
}

module.exports = { carryUnread, methodOf, lastLog, build, pairOf, generated, generatedObject, stampLine, stripStamps, commentsOnly, emptySection, countChanges, staleness };
