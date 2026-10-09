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
      const diff = list(pick.DIFF).map(l => ({ op: up(l.OP), text: up(l.TEXT) }));
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
// the table is read. Files first when files are what is written, the table first otherwise.
async function loadStored(api, trkorr, remote, io, table) {
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
  return io && io.mode === "file" ? (await fromFile()) || (await fromTable()) : (await fromTable()) || (await fromFile());
}

const storage = (io, stored) => io ? { mode: io.mode, wanted: io.wanted, can_store: io.canStore, from: stored ? stored.from : "",
  file: stored && stored.file ? stored.file : "" } : null;

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
  const stored = await loadStored(api, trkorr, remote, io, table);
  // A payload that does not parse is no review, as /ui2/cl_json's failure is in ZCL_VX_REVIEW_STORE.
  let payload = null;
  if (stored) { try { payload = parsePayload(stored.text); } catch (error) { payload = null; } }
  // Nothing saved: the review is built from ADT, to look at - live, and not written anywhere.
  const live = !payload && !remote;
  if (live) { payload = await require("./review-live").build(api, trkorr, progress); }
  if (part) { return Object.assign(partBody(payload, trkorr, part, ptype, table), { live, storage: storage(io, stored) }); }

  const objects = [], reviewers = [], history = [];
  if (payload) {
    reportObjects(payload.OBJ_STATS).forEach(s => {
      let approved = 0, declined = 0;
      list(payload.HUNKS).filter(h => up(h.OBJTYPE) === up(s.OBJTYPE) && up(h.OBJ_NAME) === up(s.OBJ_NAME)).forEach(h => {
        list(payload.HUNK_ACTIONS).filter(a => up(a.HUNK_KEY) === up(h.HUNK_KEY)).forEach(a => {
          if (up(a.ACTION) === "A") { approved++; } else if (up(a.ACTION) === "D") { declined++; }
        });
      });
      objects.push({ objtype: up(s.OBJTYPE), obj_name: up(s.OBJ_NAME), class_name: up(s.CLASS_NAME),
        group: up(s.CLASS_NAME) ? "" : catLabel(up(s.OBJTYPE)), display_name: up(s.DISPLAY_NAME), author: up(s.AUTHOR),
        author_name: up(s.AUTHOR_NAME), is_created: s.IS_CREATED === true || s.IS_CREATED === "X", hunks: Number(s.HUNK_COUNT),
        inserted: Number(s.INS_COUNT), deleted: Number(s.DEL_COUNT), modified: Number(s.MOD_COUNT), approved, declined,
        open: Number(s.HUNK_COUNT) - approved - declined });
    });
    list(payload.USER_STATES).forEach(u => reviewers.push({ reviewer: up(u.REVIEWER), reviewer_name: up(u.REVIEWER_NAME),
      saved_at: up(u.SAVED_AT), approved: list(u.APPROVED).length, declined: list(u.DECLINED).length, notes: list(u.NOTES).length }));
    list(payload.HISTORY).forEach(h => history.push({ saved_at: up(h.SAVED_AT), saved_by: up(h.SAVED_BY), saved_by_name: up(h.SAVED_BY_NAME),
      approved: Number(h.APPROVED_COUNT), declined: Number(h.DECLINED_COUNT), notes: Number(h.NOTE_COUNT) }));
  }
  return { request: trkorr.toLowerCase(), remote: remote.toLowerCase(), table, saved: Boolean(payload), live,
    saved_at: payload ? up(payload.LAST_SAVED_AT) : "", saved_by: payload ? up(payload.LAST_SAVED_BY) : "", objects, reviewers, history,
    storage: storage(io, stored) };
}

// A write to a review: a reviewer's action on one block - A approve, D decline, C comment, U take a verdict back - or
// S, saving the review built from ADT when none is stored. The body is the page's command: hunk_key, action, note and
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
  if (!["A", "D", "C", "U", "S"].includes(action)) {
    throw new Error('"' + action + '" is not a reviewer action. A approves, D declines, C comments, U takes a verdict back, S saves.');
  }
  if (action !== "S" && !key) { throw new Error("A reviewer action has to name the block it is about."); }
  if ((action === "D" || action === "C") && !note) { throw new Error("A decline and a comment are the words that go with them."); }

  const table = await hasTable(api);
  const stored = await loadStored(api, trkorr, remote, io, table);
  const user = String(api.user()).toUpperCase();
  const nameRow = (await api.query("SELECT a~name_text FROM usr21 AS u INNER JOIN adrp AS a ON a~persnumber = u~persnumber"
    + " WHERE u~bname = " + sqlText(user), 1)).values[0];
  const who = { user, name: nameRow ? up(nameRow.NAME_TEXT) : user };

  let existing, current;
  if (action === "S") {
    if (stored) { throw new Error("A review of " + trkorr + " is already saved (" + stored.from + "). Read it again."); }
    if (remote) { throw new Error("A review against another system is built by AVE; only the plain review is built from ADT."); }
    existing = {};
    current = state.applySaved(await require("./review-live").build(api, trkorr), who.user);
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

  // The table when it is to be written - and when it cannot be, the write fails rather than landing elsewhere.
  if (!io || io.mode !== "file") {
    if (!table) { throw new Error("This system has no ZAVE_REVIEW table with REMOTE and PAYLOAD; the review cannot be saved there."); }
    await api.storeReview(trkorr, remote, expect, text);
  }
  if (io && io.mode !== "table") { await io.write(trkorr, remote, text); }

  const part = up(params.get("part")), ptype = up(params.get("ptype"));
  const again = "/sap/bc/adt/vertex/review/" + encodeURIComponent(trkorr) + "?remote=" + encodeURIComponent(remote)
    + (part ? "&part=" + encodeURIComponent(part) + "&ptype=" + encodeURIComponent(ptype) : "");
  return request(api, again, undefined, io);
}

module.exports = { request, write, hunkRanges, reportObjects, parsePayload, stmtOpen };
