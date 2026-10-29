"use strict";
const { inLists } = require("./selector-table");

// Presence only: do not read payloads or build/check reviews when finding requests.
async function mark(api, requests, io) {
  const numbers = requests.map(row => row.request), table = new Set(), files = new Set(), errors = [];
  if (!numbers.length) return "";
  try {
    const fields = (await api.query("SELECT fieldname FROM dd03l WHERE tabname = 'ZAVE_REVIEW' AND as4local = 'A'", 100)).values;
    if (["REMOTE", "PAYLOAD"].every(name => fields.some(row => row.FIELDNAME === name))) {
      for (const row of await inLists(api, "SELECT trkorr FROM zave_review WHERE remote = ' ' AND trkorr", numbers, 10000)) table.add(row.TRKORR);
    }
  } catch (error) { errors.push("SAP review status: " + String(error.message || error)); }
  if (io && io.list) {
    try { for (const name of await io.list()) files.add(name); }
    catch (error) { errors.push("File review status: " + String(error.message || error)); }
  }
  for (const row of requests) {
    row.review_sources = [table.has(row.request) ? "table" : "", files.has(row.request) ? "file" : ""].filter(Boolean);
    row.review_saved = row.review_sources.length > 0;
  }
  return errors.join("; ");
}
module.exports = { mark };
