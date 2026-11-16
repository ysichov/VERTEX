"use strict";

// Search BSP application descriptions through the ADT data preview already used by VERTEX.
async function request(api, resource) {
  const url = new URL(resource, "https://vertex.invalid");
  if (url.pathname !== "/sap/bc/adt/vertex/bsp-search") return null;
  const query = (url.searchParams.get("query") || "").trim();
  if (!query || query.length > 80 || /[^\p{L}\p{N}_/ -]/u.test(query)) {
    throw new Error("Search BSP by a name or description of 1–80 letters, digits, spaces, _, / or -. ");
  }
  const limit = Number(url.searchParams.get("limit") || 30);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be 1..100.");
  const escaped = query.replace(/'/g, "''").replace(/[%_]/g, "#$&");
  const namePattern = "'%" + escaped.toUpperCase() + "%' ESCAPE '#'";
  const textPattern = "'%" + escaped + "%' ESCAPE '#'";
  const title = query.replace(/\b\p{L}/gu, letter => letter.toUpperCase());
  const titlePattern = "'%" + title.replace(/'/g, "''").replace(/[%_]/g, "#$&") + "%' ESCAPE '#'";
  const result = await api.query("SELECT applname, text FROM o2applt WHERE applname LIKE " + namePattern
    + " OR text LIKE " + textPattern + (titlePattern === textPattern ? "" : " OR text LIKE " + titlePattern), limit + 1);
  const seen = new Set();
  const apps = [];
  for (const row of result.values || []) {
    const name = String(row.APPLNAME || row.applname || "").trim();
    const description = String(row.TEXT || row.text || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    apps.push({ name, description });
  }
  return { apps: apps.slice(0, limit), truncated: apps.length > limit };
}

module.exports = { request };
