"use strict";

// What a reviewer does to a saved review, done the way AVE does it, so that AVE and every VERTEX window read the same
// review afterwards: ZCL_VX_REVIEW_STATE=>APPLY_SAVED_PAYLOAD, APPLY_REVIEWER_ACTION and BUILD_SAVE_PAYLOAD, carried
// over line for line. The payload is the one ZAVE_REVIEW holds - the keys as /ui2/cl_json wrote them, in upper case.
//
// /ui2/cl_json writes a TIMESTAMPL as a number of 21 digits, more than a double holds. A payload read for writing keeps
// every such number as its text with a mark in front, and the mark is taken off when the payload is written again, so
// a stamp goes back exactly as it came and AVE reads a number where it wrote one.

// Printable, because JSON allows no control character inside a string; nothing in a review starts with it.
const MARK = "#vx-number#";

function parseForWrite(text) {
  const safe = String(text).replace(/("(?:[^"\\]|\\.)*")|(-?\d+\.\d+|-?\d{16,})/g,
    (all, string, number) => string || '"' + MARK + number + '"');
  return JSON.parse(safe);
}

function stringify(payload) {
  return JSON.stringify(payload).replace(/"#vx-number#(-?[\d.]+)"/g, "$1");
}

// A stamp as text, with or without the mark.
const plain = value => String(value == null ? "" : value).replace(MARK, "");

// GET TIME STAMP FIELD into a TIMESTAMPL: UTC, YYYYMMDDhhmmss and seven decimals, marked as a number.
function stamp(now) {
  const d = now || new Date(), pad = (n, w = 2) => String(n).padStart(w, "0");
  return MARK + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours())
    + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "." + pad(d.getUTCMilliseconds(), 3) + "0000";
}

const list = value => Array.isArray(value) ? value : [];
const up = value => String(value == null ? "" : value);
const later = (a, b) => Number(plain(a)) > Number(plain(b));

// APPLY_SAVED_PAYLOAD, with IV_IGNORE_GENERATED off: a write from VERTEX adds one verdict and takes nothing away.
function applySaved(payload, user) {
  const state = {
    objStats: list(payload.OBJ_STATS), hunks: list(payload.HUNKS).slice(), diffData: list(payload.DIFF_DATA),
    timings: list(payload.TIMINGS), actions: list(payload.HUNK_ACTIONS).slice(), threads: [],
    approved: new Set(), declined: new Set(), notes: new Map()
  };
  const hunk = key => state.hunks.find(h => up(h.HUNK_KEY) === key);
  list(payload.THREADS).forEach(saved => {
    const thread = { HUNK_KEY: saved.HUNK_KEY, OBJTYPE: saved.OBJTYPE, OBJ_NAME: saved.OBJ_NAME, CLASS_NAME: saved.CLASS_NAME,
      DISPLAY_NAME: saved.DISPLAY_NAME, HUNK_NO: saved.HUNK_NO, START_LINE: saved.START_LINE, CHANGE_COUNT: saved.CHANGE_COUNT,
      CHANGE_KIND: saved.CHANGE_KIND, VERSNO_NEW: saved.VERSNO_NEW, VERSNO_OLD: saved.VERSNO_OLD,
      VERSNO_NEW_TEXT: saved.VERSNO_NEW_TEXT, VERSNO_OLD_TEXT: saved.VERSNO_OLD_TEXT, HTML: saved.HTML,
      MESSAGES: list(saved.MESSAGES).slice() };
    const current = hunk(up(saved.HUNK_KEY));
    if (current) {
      ["OBJTYPE", "OBJ_NAME", "CLASS_NAME", "DISPLAY_NAME", "HUNK_NO", "START_LINE", "CHANGE_COUNT", "CHANGE_KIND",
        "VERSNO_NEW", "VERSNO_OLD", "VERSNO_NEW_TEXT", "VERSNO_OLD_TEXT", "HTML"].forEach(f => { thread[f] = current[f]; });
    } else if (!up(saved.HUNK_KEY).startsWith("AI_SUMMARY~")) {
      state.hunks.push({ HUNK_KEY: saved.HUNK_KEY, OBJTYPE: saved.OBJTYPE, OBJ_NAME: saved.OBJ_NAME, CLASS_NAME: saved.CLASS_NAME,
        DISPLAY_NAME: saved.DISPLAY_NAME, HUNK_NO: saved.HUNK_NO, START_LINE: saved.START_LINE, CHANGE_COUNT: saved.CHANGE_COUNT,
        CHANGE_KIND: saved.CHANGE_KIND, AUTHOR: saved.AUTHOR, AUTHOR_NAME: saved.AUTHOR_NAME, VERSNO_NEW: saved.VERSNO_NEW,
        VERSNO_OLD: saved.VERSNO_OLD, VERSNO_NEW_TEXT: saved.VERSNO_NEW_TEXT, VERSNO_OLD_TEXT: saved.VERSNO_OLD_TEXT, HTML: saved.HTML });
    }
    state.threads.push(thread);
  });
  const hasAction = (key, reviewer, action) => state.actions.some(a => up(a.HUNK_KEY) === key && up(a.REVIEWER) === reviewer && up(a.ACTION) === action);
  const known = key => !state.hunks.length || Boolean(hunk(key));
  list(payload.USER_STATES).forEach(u => {
    [["APPROVED", "A"], ["DECLINED", "D"]].forEach(([field, action]) => list(u[field]).forEach(k => {
      const key = up(k.HUNK_KEY);
      if (known(key) && !hasAction(key, up(u.REVIEWER), action)) {
        state.actions.push({ HUNK_KEY: key, REVIEWER: u.REVIEWER, REVIEWER_NAME: u.REVIEWER_NAME, ACTION: action, CHANGED_AT: u.SAVED_AT });
      }
    }));
  });
  const mine = list(payload.USER_STATES).find(u => up(u.REVIEWER) === user);
  if (mine) {
    [["APPROVED", "A", state.approved], ["DECLINED", "D", state.declined]].forEach(([field, action, set]) => list(mine[field]).forEach(k => {
      const key = up(k.HUNK_KEY);
      set.add(key);
      if (!hasAction(key, up(mine.REVIEWER), action)) {
        state.actions.push({ HUNK_KEY: key, REVIEWER: mine.REVIEWER, REVIEWER_NAME: mine.REVIEWER_NAME, ACTION: action, CHANGED_AT: mine.SAVED_AT });
      }
    }));
    list(mine.NOTES).forEach(n => { if (!state.notes.has(up(n.HUNK_KEY))) { state.notes.set(up(n.HUNK_KEY), up(n.NOTE)); } });
  }
  // SANITIZE_REVIEW_STATE
  if (state.hunks.length) {
    [...state.approved].forEach(k => { if (!hunk(k)) { state.approved.delete(k); } });
    [...state.declined].forEach(k => { if (!hunk(k) || state.approved.has(k)) { state.declined.delete(k); } });
    state.actions = state.actions.filter(a => hunk(up(a.HUNK_KEY)));
  }
  return state;
}

// APPLY_REVIEWER_ACTION: 'A' approve, 'D' decline, 'C' comment, 'U' take a verdict back.
function applyAction(state, key, action, hunk, note, who, now) {
  const setAction = code => {
    state.actions = state.actions.filter(a => !(up(a.HUNK_KEY) === key && up(a.REVIEWER) === who.user));
    state.actions.push({ HUNK_KEY: key, REVIEWER: who.user, REVIEWER_NAME: who.name, ACTION: code, CHANGED_AT: stamp(now) });
  };
  if (action === "U") {
    state.approved.delete(key); state.declined.delete(key); state.notes.delete(key);
    state.actions = state.actions.filter(a => !(up(a.HUNK_KEY) === key && up(a.REVIEWER) === who.user));
    return;
  }
  if (action === "A") {
    state.approved.add(key); state.declined.delete(key); setAction("A");
    return;
  }
  const decline = action === "D";
  state.notes.set(key, note);
  if (decline) { state.declined.add(key); state.approved.delete(key); setAction("D"); }
  let thread = state.threads.find(t => up(t.HUNK_KEY) === key);
  if (!thread) {
    if (!hunk) { return; }
    thread = { HUNK_KEY: key, OBJTYPE: hunk.OBJTYPE, OBJ_NAME: hunk.OBJ_NAME, CLASS_NAME: hunk.CLASS_NAME, DISPLAY_NAME: hunk.DISPLAY_NAME,
      HUNK_NO: hunk.HUNK_NO, START_LINE: hunk.START_LINE, CHANGE_COUNT: hunk.CHANGE_COUNT, CHANGE_KIND: hunk.CHANGE_KIND,
      VERSNO_NEW: hunk.VERSNO_NEW, VERSNO_OLD: hunk.VERSNO_OLD, VERSNO_NEW_TEXT: hunk.VERSNO_NEW_TEXT, VERSNO_OLD_TEXT: hunk.VERSNO_OLD_TEXT,
      HTML: hunk.HTML, MESSAGES: [] };
    state.threads.push(thread);
  }
  // Saying the same thing twice in a row is a double click, not a second comment.
  const last = thread.MESSAGES[thread.MESSAGES.length - 1];
  if (last && up(last.AUTHOR) === who.user && Boolean(last.IS_DECLINE === true || last.IS_DECLINE === "X") === decline && up(last.TEXT) === note) { return; }
  thread.MESSAGES.push({ AUTHOR: who.user, AUTHOR_NAME: who.name, CREATED_AT: stamp(now), IS_DECLINE: decline, TEXT: note });
}

// BUILD_SAVE_PAYLOAD
function buildSave(existing, trkorr, state, who, now) {
  const savedAt = stamp(now);
  const result = Object.assign({}, existing);
  result.SCHEMA_VERSION = 2;
  result.TRKORR = trkorr;
  result.LAST_SAVED_AT = savedAt;
  result.LAST_SAVED_BY = who.user;
  result.OBJ_STATS = state.objStats;
  result.HUNKS = state.hunks.map(h => Object.assign({}, h, { HTML: "" }));
  result.DIFF_DATA = state.diffData;
  result.HUNK_ACTIONS = state.actions;
  result.TIMINGS = list(existing.TIMINGS);
  const mine = { REVIEWER: who.user, REVIEWER_NAME: who.name, SAVED_AT: savedAt,
    APPROVED: [...state.approved].map(k => ({ HUNK_KEY: k })), DECLINED: [...state.declined].map(k => ({ HUNK_KEY: k })),
    NOTES: [...state.notes].map(([k, n]) => ({ HUNK_KEY: k, NOTE: n })) };
  result.USER_STATES = list(existing.USER_STATES).filter(u => up(u.REVIEWER) !== who.user).concat([mine]);
  const threads = list(existing.THREADS).map(t => Object.assign({}, t, { MESSAGES: list(t.MESSAGES).slice() }));
  state.threads.forEach(cur => {
    const h = state.hunks.find(x => up(x.HUNK_KEY) === up(cur.HUNK_KEY));
    const save = { HUNK_KEY: cur.HUNK_KEY, OBJTYPE: cur.OBJTYPE, OBJ_NAME: cur.OBJ_NAME, CLASS_NAME: cur.CLASS_NAME, DISPLAY_NAME: cur.DISPLAY_NAME,
      HUNK_NO: cur.HUNK_NO, START_LINE: cur.START_LINE, CHANGE_COUNT: cur.CHANGE_COUNT, CHANGE_KIND: cur.CHANGE_KIND,
      VERSNO_NEW: h ? h.VERSNO_NEW : cur.VERSNO_NEW, VERSNO_OLD: h ? h.VERSNO_OLD : cur.VERSNO_OLD,
      VERSNO_NEW_TEXT: h ? h.VERSNO_NEW_TEXT : cur.VERSNO_NEW_TEXT, VERSNO_OLD_TEXT: h ? h.VERSNO_OLD_TEXT : cur.VERSNO_OLD_TEXT,
      AUTHOR: h ? h.AUTHOR : "", AUTHOR_NAME: h ? h.AUTHOR_NAME : "", MESSAGES: cur.MESSAGES };
    const saved = threads.find(t => up(t.HUNK_KEY) === up(cur.HUNK_KEY));
    if (!saved) { threads.push(save); return; }
    ["OBJTYPE", "OBJ_NAME", "CLASS_NAME", "DISPLAY_NAME", "HUNK_NO", "START_LINE", "CHANGE_COUNT", "CHANGE_KIND", "AUTHOR", "AUTHOR_NAME"]
      .forEach(f => { saved[f] = save[f]; });
    saved.HTML = "";
    cur.MESSAGES.forEach(m => {
      if (!saved.MESSAGES.some(s => up(s.AUTHOR) === up(m.AUTHOR) && plain(s.CREATED_AT) === plain(m.CREATED_AT) && up(s.TEXT) === up(m.TEXT))) {
        saved.MESSAGES.push(m);
      }
    });
  });
  threads.forEach(t => { t.HTML = ""; });
  result.THREADS = threads;
  result.HISTORY = list(existing.HISTORY).concat([{ SAVED_AT: savedAt, SAVED_BY: who.user, SAVED_BY_NAME: who.name,
    APPROVED_COUNT: state.approved.size, DECLINED_COUNT: state.declined.size, NOTE_COUNT: state.notes.size }]);
  return result;
}

module.exports = { MARK, parseForWrite, stringify, plain, stamp, applySaved, applyAction, buildSave, later };
