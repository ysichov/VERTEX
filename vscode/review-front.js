"use strict";

// The saved code review on the front end: what GET /sap/bc/adt/vertex/review/<request> (ZCL_VX_ADT_RES_REVIEW)
// answers, read from the ZAVE_REVIEW table through ADT's data preview. The table is the one AVE and VERTEX's ABAP
// share; its PAYLOAD is the review as /ui2/cl_json wrote it. Reviews can also be kept in files (vertex.review.storage),
// one payload per file. Writing - approving, declining, commenting, saving a review built from ADT - is WRITE below:
// the change is made here, as AVE makes it (review-state.js), and the whole payload is stored, in the table through
// VERTEX's ZCL_VX_ADT_RES_STORE (the data preview only reads) or in the file.
//
// The summary keeps AVE's order and grouping (ZCL_VX_REVIEW_REPORT); a part's blocks are located in the stored diff
// by AVE's own walk (ZCL_VX_REVIEW_HUNKS=>HUNK_RANGES with ZCL_VX_REVIEW_PREPARE=>UPDATE_STMT_OPEN), because the
// block keys are numbered by that walk and a different one would put verdicts on the wrong blocks.

const NAME = /^[A-Z0-9_/$]{1,20}$/;
const sqlText = value => "'" + String(value).replace(/'/g, "''") + "'";

// /ui2/cl_json writes a TIMESTAMPL as a number of 21 digits, more than a double holds; the page writes the stamp back
// to say which state it built on, so stamps are kept as the text they were written as.
function parsePayload(text) {
  const safe = String(text).replace(/("(?:[^"\\]|\\.)*")|(-?\d+\.\d+|-?\d{16,})/g, (all, string, number) => string || '"' + number + '"');
  return JSON.parse(safe);
}

const up = value => String(value == null ? "" : value);
const list = value => Array.isArray(value) ? value : [];

// ZCL_VX_REVIEW_REPORT: class parts under their class, other objects in sections by kind, objects with no changed
// line left out.
const TYPE_ORDER = { CLSD: 1, CPUB: 2, CPRO: 3, CPRI: 4, CINC: 5, CDEF: 6, METH: 7 };
const CLASS_PARTS = ["CLSD", "CPUB", "CPRO", "CPRI", "CINC", "CDEF"];
const catOrder = type => ({ TABD: 2, DOMD: 3, DTED: 3, DDLS: 4 })[type] || 1;
const catLabel = type => ({ TABD: "Tables / Structures", DOMD: "Domains / Data Elements", DTED: "Domains / Data Elements", DDLS: "CDS Views" })[type] || "Programs";
function reportObjects(stats) {
  const keyed = list(stats).map((s, idx) => {
    let className = up(s.CLASS_NAME).trim();
    if (!className && CLASS_PARTS.includes(up(s.OBJTYPE))) {
      const name = up(s.OBJ_NAME), eq = name.indexOf("=");
      className = eq >= 0 ? name.slice(0, eq) : name;
    }
    return { s: Object.assign({}, s, { CLASS_NAME: className }), className, cat: className ? 0 : catOrder(up(s.OBJTYPE)),
      type: TYPE_ORDER[up(s.OBJTYPE)] || 0, name: up(s.OBJ_NAME), idx };
  });
  keyed.sort((a, b) => a.className.localeCompare(b.className) || a.cat - b.cat || a.type - b.type || a.name.localeCompare(b.name) || a.idx - b.idx);
  return keyed.map(k => k.s).filter(s => Number(s.INS_COUNT) || Number(s.DEL_COUNT) || Number(s.MOD_COUNT));
}

const { hunkRanges, stmtOpen } = require("./review-hunks");

// Whether the system has the table, and REMOTE in it - AVE's has_review_table / has_remote_field.
async function hasTable(api) {
  const rows = (await api.query("SELECT fieldname FROM dd03l WHERE tabname = 'ZAVE_REVIEW' AND as4local = 'A'", 100)).values;
  return rows.some(r => r.FIELDNAME === "REMOTE") && rows.some(r => r.FIELDNAME === "PAYLOAD");
}

function partBody(payload, request, part, ptype, table) {
  const saved = Boolean(payload);
  let blocks = [], ops = [], old = "", fresh = "", added = 0, deleted = 0, ddic = false;
  if (saved) {
    list(payload.HUNKS).filter(h => up(h.OBJTYPE) === ptype && up(h.OBJ_NAME) === part).forEach(h => {
      old = up(h.VERSNO_OLD); fresh = up(h.VERSNO_NEW);
      blocks.push({ hunk_key: up(h.HUNK_KEY), hunk_no: Number(h.HUNK_NO), start_line: Number(h.START_LINE),
        change_count: Number(h.CHANGE_COUNT), change_kind: up(h.CHANGE_KIND), author: up(h.AUTHOR), author_name: up(h.AUTHOR_NAME),
        op_from: 0, op_to: 0, action: "", reviewer: "", reviewer_name: "", changed_at: "", note: "", messages: [] });
    });
    blocks.sort((a, b) => a.hunk_no - b.hunk_no);
    blocks.forEach(b => {
      list(payload.HUNK_ACTIONS).filter(a => up(a.HUNK_KEY) === b.hunk_key).forEach(a => {
        b.action = up(a.ACTION); b.reviewer = up(a.REVIEWER); b.reviewer_name = up(a.REVIEWER_NAME); b.changed_at = up(a.CHANGED_AT);
      });
      list(payload.USER_STATES).forEach(u => list(u.NOTES).filter(n => up(n.HUNK_KEY) === b.hunk_key).forEach(n => { b.note = up(n.NOTE); }));
      list(payload.THREADS).filter(t => up(t.HUNK_KEY) === b.hunk_key).forEach(t => list(t.MESSAGES).forEach(m => b.messages.push({
        author: up(m.AUTHOR), author_name: up(m.AUTHOR_NAME), created_at: up(m.CREATED_AT), is_decline: m.IS_DECLINE === true || m.IS_DECLINE === "X",
        text: up(m.TEXT) })));
    });
    // The stored diff of the pair the blocks were cut from; a comparison against another system is another row.
    let pick = null;
    for (const d of list(payload.DIFF_DATA)) {
      const key = d.KEY || {};
      if (up(key.OBJTYPE) !== ptype || up(key.OBJNAME) !== part || d.RETROFIT === true || d.RETROFIT === "X") { continue; }
      if (!pick) { pick = d; }
      if (up(key.VERSNO_O) === old && up(key.VERSNO_N) === fresh) { pick = d; break; }
    }
    if (pick) {
      if (!blocks.length) { old = up(pick.KEY.VERSNO_O); fresh = up(pick.KEY.VERSNO_N); }
      // Who wrote each changed line, when the review keeps a blame map (AVE's "Who is Blame"): an added line is looked
      // up in BLAME_MAP, a deleted one in BLAME_DELETED, by its text, as AVE looks them up.
      const whoOf = (map, text) => {
        const b = list(map).find(m => up(m.TEXT) === text);
        return b ? { author: up(b.AUTHOR), author_name: up(b.AUTHOR_NAME), date: up(b.DATUM), version: up(b.VERSNO_TEXT),
          request: up(b.TASK) || up(b.KORRNUM) } : null;
      };
      const diff = list(pick.DIFF).map(l => {
        const op = up(l.OP), text = up(l.TEXT);
        const who = op === "+" ? whoOf(pick.BLAME_MAP, text) : op === "-" ? whoOf(pick.BLAME_DELETED, text) : null;
        return who ? { op, text, who } : { op, text };
      });
      ops = diff;
      added = diff.filter(l => l.op === "+").length;
      deleted = diff.filter(l => l.op === "-").length;
      // A dictionary object has no line diff, only AVE's own html, which VERTEX does not render.
      ddic = !diff.length && Boolean(pick.HTML);
      const ranges = hunkRanges(diff);
      blocks.forEach(b => {
        const range = ranges.find(r => r.start_line === b.start_line);
        if (range) { b.op_from = range.op_from; b.op_to = range.op_to; }
      });
    }
  }
  return { request: request.toLowerCase(), part: part.toLowerCase(), part_type: ptype.toLowerCase(), table, saved, ddic,
    saved_at: saved ? up(payload.LAST_SAVED_AT) : "", versno_old: !old || /^0+$/.test(old) ? "" : old, versno_new: fresh || "",
    added, deleted, blocks, ops };
}

// The stored review's text and where it came from. IO is the host's storage (code-workbench reviewIo); without it only
// the table is read. Both places are read: a review can be kept in both, and the two copies can differ. FROM names the
// copy to show (table, file); without it, files first when files are what is written, the table first otherwise.
// Answers { pick, copies: { table, file } }; a copy asked for by name that is not there is an error, not the other one.
async function loadStored(api, trkorr, remote, io, table, from) {
  const fromTable = async () => {
    if (!table) { return null; }
    const row = (await api.query("SELECT payload FROM zave_review WHERE trkorr = " + sqlText(trkorr)
      + " AND remote = " + sqlText(remote || " "), 1)).values[0];
    return row && row.PAYLOAD ? { text: row.PAYLOAD, from: "table" } : null;
  };
  const fromFile = async () => {
    if (!io) { return null; }
    const text = await io.read(trkorr, remote);
    return text ? { text, from: "file", file: io.where(trkorr, remote) } : null;
  };
  const copies = { table: await fromTable(), file: await fromFile() };
  if (from === "table" || from === "file") {
    if (!copies[from]) { throw new Error("No copy of the review of " + trkorr + " is kept in the " + from + "."); }
    return { pick: copies[from], copies };
  }
  return { pick: io && io.mode === "file" ? copies.file || copies.table : copies.table || copies.file, copies };
}

// Who saved a copy and when, for the page to name both when there are two.
function copyInfo(copy) {
  if (!copy) { return null; }
  let saved = {};
  try { saved = parsePayload(copy.text); } catch (error) { return { saved_at: "", saved_by: "", file: copy.file || "", unreadable: true }; }
  return { saved_at: up(saved.LAST_SAVED_AT), saved_by: up(saved.LAST_SAVED_BY), file: copy.file || "" };
}

const storage = (io, stored) => io ? { mode: io.mode, wanted: io.wanted, can_store: io.canStore, from: stored ? stored.from : "",
  file: stored && stored.file ? stored.file : "" } : null;

// The line of progress that carries a review built so far, as a summary.
const PARTIAL_MARK = "VERTEX-REVIEW-PARTIAL ";

/* The summary of a review - its objects, developers, reviewers and saves - from its payload; also what a review being
   built shows of the parts done so far. */
function summarize(payload) {
  const objects = [], reviewers = [], history = [], developers = [];
  if (payload) {
    reportObjects(payload.OBJ_STATS).forEach(s => {
      let approved = 0, declined = 0;
      list(payload.HUNKS).filter(h => up(h.OBJTYPE) === up(s.OBJTYPE) && up(h.OBJ_NAME) === up(s.OBJ_NAME)).forEach(h => {
        list(payload.HUNK_ACTIONS).filter(a => up(a.HUNK_KEY) === up(h.HUNK_KEY)).forEach(a => {
          if (up(a.ACTION) === "A") { approved++; } else if (up(a.ACTION) === "D") { declined++; }
        });
      });
      // Who wrote the object's blocks, and its blame breakdown's authors: a developer's own view lists it.
      const writers = [...new Set(list(payload.HUNKS).filter(h => up(h.OBJTYPE) === up(s.OBJTYPE) && up(h.OBJ_NAME) === up(s.OBJ_NAME))
        .map(h => up(h.AUTHOR) || up(s.AUTHOR)).concat(list(s.BT_AUTHORS).map(a => up(a.AUTHOR)), [up(s.AUTHOR)]))];
      objects.push({ authors: writers, objtype: up(s.OBJTYPE), obj_name: up(s.OBJ_NAME), class_name: up(s.CLASS_NAME),
        group: up(s.CLASS_NAME) ? "" : catLabel(up(s.OBJTYPE)), display_name: up(s.DISPLAY_NAME), author: up(s.AUTHOR),
        author_name: up(s.AUTHOR_NAME), is_created: s.IS_CREATED === true || s.IS_CREATED === "X", hunks: Number(s.HUNK_COUNT),
        inserted: Number(s.INS_COUNT), deleted: Number(s.DEL_COUNT), modified: Number(s.MOD_COUNT), approved, declined,
        open: Number(s.HUNK_COUNT) - approved - declined });
    });
    /* Developers, as AVE counts them: from each object's blame breakdown (BT_AUTHORS) when the review has one - an
       object written by two developers is under both, each with their own rows and blocks - and from the object's
       author when it has none. A developer's blocks are the blocks whose author they are. SAP* is not a developer:
       lines and blocks credited to it are SAP's own code and are left out of the table. */
    const devs = new Map();
    const sink = { inserted: 0, modified: 0, deleted: 0, hunks: 0, approved: 0, declined: 0 };
    const dev = (author, name) => {
      if (author === "SAP*") { return sink; }
      if (!devs.has(author)) { devs.set(author, { author, author_name: name, inserted: 0, modified: 0, deleted: 0, hunks: 0, approved: 0, declined: 0 }); }
      const d = devs.get(author);
      if (!d.author_name && name) { d.author_name = name; }
      return d;
    };
    reportObjects(payload.OBJ_STATS).forEach(s => {
      const hunks = list(payload.HUNKS).filter(h => up(h.OBJTYPE) === up(s.OBJTYPE) && up(h.OBJ_NAME) === up(s.OBJ_NAME));
      const verdict = h => (list(payload.HUNK_ACTIONS).find(a => up(a.HUNK_KEY) === up(h.HUNK_KEY)) || {}).ACTION;
      const authors = list(s.BT_AUTHORS);
      if (authors.length) {
        authors.forEach(a => { const d = dev(up(a.AUTHOR), up(a.AUTHOR_NAME));
          d.inserted += Number(a.INS_COUNT) || 0; d.modified += Number(a.MOD_COUNT) || 0; d.deleted += Number(a.DEL_COUNT) || 0; });
      } else {
        const d = dev(up(s.AUTHOR), up(s.AUTHOR_NAME));
        d.inserted += Number(s.INS_COUNT) || 0; d.modified += Number(s.MOD_COUNT) || 0; d.deleted += Number(s.DEL_COUNT) || 0;
      }
      hunks.forEach(h => {
        const d = dev(up(h.AUTHOR) || up(s.AUTHOR), up(h.AUTHOR_NAME));
        d.hunks++;
        const v = up(verdict(h));
        if (v === "A") { d.approved++; } else if (v === "D") { d.declined++; }
      });
    });
    devs.forEach(d => developers.push(d));
    /* Reviewers as AVE lists them: approved, declined and their total - a reviewer who only commented counts one - and
       only those with something to show. OBJECTS are the objects of the blocks they acted on, for their own view. */
    list(payload.USER_STATES).forEach(u => {
      const approved = list(u.APPROVED).length, declined = list(u.DECLINED).length, notes = list(u.NOTES).length;
      const total = approved + declined || (notes ? 1 : 0);
      if (!total) { return; }
      const keys = list(u.APPROVED).concat(list(u.DECLINED), list(u.NOTES)).map(k => up(k.HUNK_KEY)).filter(Boolean)
        .map(k => k.split("~").slice(0, 2).join("~"));
      reviewers.push({ reviewer: up(u.REVIEWER), reviewer_name: up(u.REVIEWER_NAME), approved, declined, total,
        objects: [...new Set(keys)] });
    });
    list(payload.HISTORY).forEach(h => history.push({ saved_at: up(h.SAVED_AT), saved_by: up(h.SAVED_BY), saved_by_name: up(h.SAVED_BY_NAME),
      approved: Number(h.APPROVED_COUNT), declined: Number(h.DECLINED_COUNT), notes: Number(h.NOTE_COUNT) }));
  }
  return { objects, reviewers, history, developers };
}

async function request(api, resource, progress, io) {
  const url = new URL(resource, "https://sap.invalid"), params = url.searchParams;
  const match = /^\/sap\/bc\/adt\/vertex\/review\/([^/]+)$/.exec(url.pathname);
  if (!match) { return null; }
  const trkorr = decodeURIComponent(match[1]).toUpperCase();
  if (!NAME.test(trkorr)) { throw new Error(trkorr + " is not a transport request."); }
  const remote = String(params.get("remote") || "").toUpperCase();
  const part = String(params.get("part") || "").toUpperCase(), ptype = String(params.get("ptype") || "").toUpperCase();
  if (part && !ptype) { throw new Error("Reading the blocks of " + part + " needs its type in ptype."); }

  const table = await hasTable(api);
  const loaded = await loadStored(api, trkorr, remote, io, table, String(params.get("from") || ""));
  const stored = loaded.pick;
  const copies = { table: copyInfo(loaded.copies.table), file: copyInfo(loaded.copies.file) };
  // A payload that does not parse is no review, as /ui2/cl_json's failure is in ZCL_VX_REVIEW_STORE.
  let payload = null;
  if (stored) { try { payload = parsePayload(stored.text); } catch (error) { payload = null; } }
  // Nothing saved: the review is built from ADT, to look at - live, and not written anywhere.
  // Opening a review only reads it; it is built from ADT when the page asks (build=1).
  const keep = params.get("generated") === "1";
  const live = !payload && !remote && params.get("build") === "1";
  /* Each part done is sent on with the progress, as a summary of the review so far: the page draws it while the rest is
     read. A line that starts with PARTIAL_MARK carries it; any other line is what the build is doing. */
  const partial = progress && !part ? payloadSoFar => progress(PARTIAL_MARK + JSON.stringify(Object.assign(
    { request: trkorr.toLowerCase(), live: true, partial: true, saved: true, table }, summarize(payloadSoFar)))) : undefined;
  if (live) { payload = await require("./review-live").build(api, trkorr, progress, params.get("fresh") === "1", params.get("blame") === "1", keep, partial); }
  /* A saved review is checked against the request as it is now; the page offers to build it again when it is not.
     A check that fails says so - it is not taken for "up to date". It reads every part's versions, so it runs only when
     asked: check=1 adds it to the summary, check=only answers with it alone - the page shows the saved review at once
     and asks for the check beside it. */
  const check = params.get("check");
  let stale = null;
  if (payload && !live && !remote && !part && check) {
    try { stale = await require("./review-live").staleness(api, trkorr, payload, progress, keep); }
    catch (error) { stale = { error: String(error && error.message || error) }; }
  }
  if (check === "only") { return { stale_check: true, request: trkorr.toLowerCase(), saved_at: payload ? up(payload.LAST_SAVED_AT) : "", stale }; }
  if (part) { return Object.assign(partBody(payload, trkorr, part, ptype, table), { live, storage: storage(io, stored), copies }); }

  const { objects, reviewers, history, developers } = summarize(payload);
  return { request: trkorr.toLowerCase(), remote: remote.toLowerCase(), table, saved: Boolean(payload), live,
    can_build: !payload && !remote,
    saved_at: payload ? up(payload.LAST_SAVED_AT) : "", saved_by: payload ? up(payload.LAST_SAVED_BY) : "", objects, reviewers, history,
    developers,
    // Objects the request names that the system no longer has, found while building it from ADT.
    missing: payload && Array.isArray(payload.MISSING) ? payload.MISSING : [],
    storage: storage(io, stored), copies, stale };
}

// A write to a review: a reviewer's action on one block - A approve, D decline, C comment, U take a verdict back - or
// S, saving the review built from ADT when none is stored, or R, replacing a saved review with one built from ADT
// again - its verdicts and comments go with the old blocks. The body is the page's command: hunk_key, action, note and
// saved_at, the stamp the page read. The answer is what a read would answer now: the part, or the summary.
async function write(api, resource, body, io) {
  const url = new URL(resource, "https://sap.invalid"), params = url.searchParams;
  const match = /^\/sap\/bc\/adt\/vertex\/review\/([^/]+)$/.exec(url.pathname);
  if (!match) { return null; }
  const trkorr = decodeURIComponent(match[1]).toUpperCase();
  if (!NAME.test(trkorr)) { throw new Error(trkorr + " is not a transport request."); }
  const remote = String(params.get("remote") || "").toUpperCase();
  const state = require("./review-state");
  let cmd;
  try { cmd = JSON.parse(String(body || "{}")); } catch (error) { throw new Error("The command for " + trkorr + " is not JSON."); }
  const action = up(cmd.action).toUpperCase(), key = up(cmd.hunk_key), note = up(cmd.note);
  if (!["A", "D", "C", "U", "S", "R"].includes(action)) {
    throw new Error('"' + action + '" is not a reviewer action. A approves, D declines, C comments, U takes a verdict back, S saves, R rebuilds.');
  }
  if (action !== "S" && action !== "R" && !key) { throw new Error("A reviewer action has to name the block it is about."); }
  if ((action === "D" || action === "C") && !note) { throw new Error("A decline and a comment are the words that go with them."); }

  const table = await hasTable(api);
  const from = String(params.get("from") || "");
  const stored = (await loadStored(api, trkorr, remote, io, table, from)).pick;
  // A host may know the user at once (VS Code) or ask its project for it (Eclipse).
  const user = String(await api.user()).toUpperCase();
  const nameRow = (await api.query("SELECT a~name_text FROM usr21 AS u INNER JOIN adrp AS a ON a~persnumber = u~persnumber"
    + " WHERE u~bname = " + sqlText(user), 1)).values[0];
  const who = { user, name: nameRow ? up(nameRow.NAME_TEXT) : user };

  let existing, current;
  if (action === "S") {
    if (stored) { throw new Error("A review of " + trkorr + " is already saved (" + stored.from + "). Read it again."); }
    if (remote) { throw new Error("A review against another system is built by AVE; only the plain review is built from ADT."); }
    existing = {};
    current = state.applySaved(await require("./review-live").build(api, trkorr, undefined, false, params.get("blame") === "1",
      params.get("generated") === "1"), who.user);
  } else if (action === "R") {
    if (!stored) { throw new Error("No review is saved for " + trkorr + "; there is nothing to rebuild."); }
    if (remote) { throw new Error("A review against another system is built by AVE; only the plain review is built from ADT."); }
    const old = state.parseForWrite(stored.text);
    if (cmd.saved_at && state.plain(cmd.saved_at) !== state.plain(old.LAST_SAVED_AT)) {
      throw new Error(up(old.LAST_SAVED_BY) + " saved this review while the page was open. Read it again, then rebuild.");
    }
    // Only the record of earlier saves is kept; the stamp the store compares against is the old one.
    existing = { HISTORY: old.HISTORY, LAST_SAVED_AT: old.LAST_SAVED_AT };
    current = state.applySaved(await require("./review-live").build(api, trkorr, undefined, true, params.get("blame") === "1",
      params.get("generated") === "1"), who.user);
  } else {
    if (!stored) { throw new Error("No review is saved for " + trkorr + ". Save the review built from ADT first."); }
    existing = state.parseForWrite(stored.text);
    // A review is written by more than one person, and a save writes the whole payload: a state that moved since the
    // page read it is refused, loudly - there is no merge here.
    if (cmd.saved_at && state.plain(cmd.saved_at) !== state.plain(existing.LAST_SAVED_AT)) {
      throw new Error(up(existing.LAST_SAVED_BY) + " saved this review while the page was open. Read it again, then write.");
    }
    current = state.applySaved(existing, who.user);
    const hunk = current.hunks.find(h => up(h.HUNK_KEY) === key);
    if (!hunk) { throw new Error(key + " is not a block of this review."); }
    state.applyAction(current, key, action, hunk, note, who);
  }
  const next = state.buildSave(existing, trkorr, current, who);
  const text = state.stringify(next);
  const expect = stored ? state.plain(existing.LAST_SAVED_AT) : "";

  /* A copy is written back where it was read from. A copy read from the table on a system VERTEX cannot write it on
     goes to a file - the page said so before the write. A new review (S) goes where the storage setting says. The
     table, when it is to be written and cannot be, fails the write rather than landing elsewhere. */
  const target = stored ? stored.from : "";
  const toTable = target ? target === "table" && (!io || io.canStore) : !io || io.mode !== "file";
  const toFile = Boolean(io) && (target ? target === "file" || !toTable || io.mode === "both" : io.mode !== "table");
  if (toTable) {
    if (!table) { throw new Error("This system has no ZAVE_REVIEW table with REMOTE and PAYLOAD; the review cannot be saved there."); }
    await api.storeReview(trkorr, remote, target === "table" || !target ? expect : "", text);
  }
  if (toFile) { await io.write(trkorr, remote, text); }

  const part = up(params.get("part")), ptype = up(params.get("ptype"));
  const again = "/sap/bc/adt/vertex/review/" + encodeURIComponent(trkorr) + "?remote=" + encodeURIComponent(remote)
    + (part ? "&part=" + encodeURIComponent(part) + "&ptype=" + encodeURIComponent(ptype) : "")
    + (params.get("blame") === "1" ? "&blame=1" : "") + (from ? "&from=" + encodeURIComponent(from) : "");
  return request(api, again, undefined, io);
}

module.exports = { PARTIAL_MARK, summarize, request, write, hunkRanges, reportObjects, parsePayload, stmtOpen };
