"use strict";

// Protect structured debugger data without mutating the live SAP values. Code, diffs and other text are not touched:
// a review must see the code exactly as written.
const SENSITIVE = /(?:^|[_./~>\-])(?:API_?KEY|API_?TOKEN|PASSWORD|PASSWD|PWD|ACCESS_?TOKEN|REFRESH_?TOKEN|AUTH_?TOKEN|ID_?TOKEN|TOKEN|JWT|BEARER|CREDENTIALS?|AUTH|AUTH_?HEADER|AUTH_?KEY|ACCESS_?KEY|CLIENT_?KEY|SUBSCRIPTION_?KEY|CLIENT_?SECRET|SECRET|SECRET_?KEY|PRIVATE_?KEY|AUTHORIZATION|COOKIE|SET_COOKIE)$/i;
const VALUE_FIELDS = /^(?:value|val|content|children|data)$/i;
const MARKER = /^\[REDACTED secret-\d+ type=\w+ length=\d+ initial=(?:true|false)\]$/;
let extraFields = [];
const normalize = value => String(value || "").replace(/\s+/g, "_");
const sensitiveName = value => SENSITIVE.test(normalize(value)) || extraFields.some(pattern => pattern.test(normalize(value)));
function configure(names = []) {
  extraFields = (Array.isArray(names) ? names : []).filter(name => typeof name === "string" && name.trim()).map(name =>
    new RegExp("^" + normalize(name.trim()).split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i"));
}

// Same labelled-JSON-block convention as session-log.sanitizeText, retaining
// source for analysis here rather than dropping it as the conversation log does.
function blocks(text, onText, onJson) {
  let output = "", cursor = 0, match;
  const start = /(^|\n)[ \t]*[\[{]/g;
  while ((match = start.exec(text))) {
    const at = match.index + match[0].length - 1;
    let depth = 0, quoted = false, escaped = false, end = at;
    for (; end < text.length; end++) {
      const c = text[end];
      if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) { end++; break; }
    }
    let parsed;
    try { parsed = JSON.parse(text.slice(at, end)); } catch (_) { continue; }
    output += onText(text.slice(cursor, at)) + onJson(parsed, text.slice(at, end));
    cursor = end; start.lastIndex = end;
  }
  return output + onText(text.slice(cursor));
}

function create() {
  const secrets = new Map();
  let serial = 0;
  const raw = value => typeof value === "string" ? value : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  function marker(value) {
    const text = raw(value);
    if (MARKER.test(text)) return text;
    if (!secrets.has(text)) secrets.set(text, { id: ++serial, replace: typeof value === "string" && text.length >= 4 });
    else if (typeof value === "string" && text.length >= 4) secrets.get(text).replace = true;
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return "[REDACTED secret-" + secrets.get(text).id + " type=" + type + " length=" + text.length + " initial=" + (value == null || value === false || value === 0 || text.trim().length === 0) + "]";
  }
  function secretParts(value) {
    if (!value || typeof value !== "object") {
      marker(value);
      if (typeof value === "string" && !MARKER.test(value)) {
        const trimmed = value.trim();
        if (trimmed.length >= 4 && trimmed !== value) marker(trimmed);
        const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
        if (quoted && quoted[2].length >= 4) marker(quoted[2]);
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach(secretParts); return; }
    for (const [key, item] of Object.entries(value)) if (!/^(?:name|type|technical|meta_type|id)$/i.test(key)) secretParts(item);
  }
  function discover(value, seen = new WeakSet(), depth = 0) {
    if (depth > 40) return;
    if (typeof value === "string") {
      if (MARKER.test(value)) return;
      blocks(value, () => "", parsed => { discover(parsed, seen, depth + 1); return ""; });
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const media = /^(?:image|audio)$/.test(value.type || "") || /^(?:image|audio)\//.test(value.mimeType || "");
    const named = sensitiveName(value.name || value.NAME || value.variable_name || value.field_name || value.full);
    for (const [key, item] of Object.entries(value)) {
      if (media && key === "data") continue;
      if (sensitiveName(key) || named && VALUE_FIELDS.test(key)) secretParts(item);
      discover(item, seen, depth + 1);
    }
  }
  function plain(text) { return text; }
  function walk(value, seen = new WeakMap(), depth = 0) {
    if (typeof value === "string") {
      if (MARKER.test(value)) return value;
      if (depth > 40) return plain(value);
      return blocks(value, plain, (parsed, original) => {
        const safe = walk(parsed, seen, depth + 1);
        return JSON.stringify(safe) === JSON.stringify(parsed) ? original : JSON.stringify(safe, null, 2);
      });
    }
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    const result = Array.isArray(value) ? [] : {};
    seen.set(value, result);
    const media = /^(?:image|audio)$/.test(value.type || "") || /^(?:image|audio)\//.test(value.mimeType || "");
    const named = sensitiveName(value.name || value.NAME || value.variable_name || value.field_name || value.full);
    for (const [key, item] of Object.entries(value)) {
      const hidden = sensitiveName(key) || named && VALUE_FIELDS.test(key);
      Object.defineProperty(result, key, { value: media && key === "data" ? item : hidden ? (key.toLowerCase() === "children" ? [] : marker(item)) : walk(item, seen, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  function protect(value) { discover(value); return walk(value); }
  return { protect, text: value => protect(String(value || "")) };
}

module.exports = { create, protect: value => create().protect(value), sensitiveName, configure };
