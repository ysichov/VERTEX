"use strict";

const TEXT_FILE = /\.(?:properties|json|xml|html|js|ts|css|txt|md)$/i;
function clean(app, path = "") {
  if (typeof app !== "string" || !/^[A-Z0-9_/$]{1,40}$/i.test(app)) throw new Error("Use an exact BSP application name.");
  if (typeof path !== "string" || path.length > 240 || /[\\?#\x00-\x1f]/.test(path)
      || path.split("/").some(part => part === "." || part === "..")) throw new Error("Invalid BSP resource path.");
  return { app: app.toUpperCase(), path: path.replace(/^\/+|\/+$/g, "") };
}
function unxml(value) { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function entries(xml, app) {
  if (!/<atom:feed\b/.test(xml)) throw new Error("SAP did not return a BSP directory listing.");
  return [...xml.matchAll(/<atom:entry\b[\s\S]*?<\/atom:entry>/g)].map(match => {
    const block = match[0];
    const title = /<atom:title>([\s\S]*?)<\/atom:title>/.exec(block)?.[1] || "";
    const type = /<atom:category\s+term="(file|folder)"/.exec(block)?.[1] || "";
    const full = unxml(title);
    return { path: full.startsWith(app + "/") ? full.slice(app.length + 1) : full, type };
  }).filter(entry => entry.path && entry.type);
}
async function list(api, args) {
  const { app, path } = clean(args.app, args.path);
  const xml = await api.ui5Resource(app, path);
  return { app, path, entries: entries(xml, app) };
}
async function read(api, args) {
  const { app, path } = clean(args.app, args.path);
  if (!path || !TEXT_FILE.test(path)) throw new Error("Name a text resource such as i18n/i18n.properties or manifest.json.");
  const start = args.start === undefined ? 0 : args.start;
  const limit = args.limit === undefined ? 30000 : args.limit;
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1 || limit > 60000) throw new Error("start must be nonnegative and limit 1..60000.");
  const content = await api.ui5Resource(app, path);
  return { app, path, start, content: content.slice(start, start + limit), totalLength: content.length,
    nextStart: start + limit < content.length ? start + limit : null };
}
async function search(api, args) {
  const { app, path } = clean(args.app, args.path);
  const query = String(args.query || "");
  if (!query || query.length > 120) throw new Error("Search text must be 1..120 characters.");
  const maxFiles = args.maxFiles === undefined ? 100 : args.maxFiles;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 200) throw new Error("maxFiles must be 1..200.");
  const folders = [path], hits = [], skipped = [];
  let scanned = 0;
  while (folders.length && scanned < maxFiles && hits.length < 100) {
    const folder = folders.shift();
    const children = (await list(api, { app, path: folder })).entries;
    for (const entry of children) {
      if (entry.type === "folder") { folders.push(entry.path); continue; }
      if (!TEXT_FILE.test(entry.path) || /(?:^|\/)(?:Component.*preload|localService)\b/i.test(entry.path)) continue;
      if (scanned >= maxFiles) break;
      scanned++;
      const content = await api.ui5Resource(app, entry.path);
      if (content.length > 500000) { skipped.push(entry.path); continue; }
      content.split(/\r?\n/).forEach((line, index) => {
        if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && hits.length < 100)
          hits.push({ path: entry.path, line: index + 1, text: line.trim().slice(0, 240) });
      });
    }
  }
  return { app, query, filesScanned: scanned, hits, skipped, truncated: folders.length > 0 || scanned >= maxFiles || hits.length >= 100 };
}
async function request(api, resource) {
  const url = new URL(resource, "https://vertex.invalid");
  if (url.pathname !== "/sap/bc/adt/vertex/bsp-resource") return null;
  const args = { app: url.searchParams.get("app"), path: url.searchParams.get("path") || "",
    query: url.searchParams.get("query") || "" };
  if (url.searchParams.has("start")) args.start = Number(url.searchParams.get("start"));
  if (url.searchParams.has("limit")) args.limit = Number(url.searchParams.get("limit"));
  if (url.searchParams.has("maxFiles")) args.maxFiles = Number(url.searchParams.get("maxFiles"));
  switch (url.searchParams.get("action")) {
    case "list": return list(api, args);
    case "read": return read(api, args);
    case "search": return search(api, args);
    default: throw new Error("BSP action must be list, read or search.");
  }
}
module.exports = { list, read, search, request };
