"use strict";

// Protect structured debugger data without mutating the live SAP values.
const SENSITIVE = /(?:^|[_./~>\-])(?:API_?KEY|API_?TOKEN|PASSWORD|PASSWD|PWD|ACCESS_?TOKEN|REFRESH_?TOKEN|AUTH_?TOKEN|ID_?TOKEN|CLIENT_?SECRET|SECRET|SECRET_?KEY|PRIVATE_?KEY|AUTHORIZATION|COOKIE|SET_COOKIE)$/i;
const VALUE_FIELDS = /^(?:value|val|content|children|data)$/i;
const MARKER = /^\[REDACTED secret-\d+ type=\w+ length=\d+ initial=(?:true|false)\]$/;
const BEARER = /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+\/-]{6,}=*)/gi;
const PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g;
const ASSIGNMENT = /(\b([A-Z][A-Z0-9_.\/~>\-]*)(?:["'])?\s*[:=]\s*)(?:"((?:\\.|[^"\\\r\n])*)"|'((?:''|\\.|[^'\\\r\n])*)'|([^\s&;,"'<>()]{4,}))/gi;
const CREDENTIAL_HEADER = /\b(?:Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*([^\r\n]+)/gi;
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
  function assignments(text, replace) {
    ASSIGNMENT.lastIndex = 0;
    let match, output = "", cursor = 0;
    while ((match = ASSIGNMENT.exec(text))) {
      const [whole, prefix, name, doubleQuoted, singleQuoted, plain] = match;
      if (!sensitiveName(name)) { ASSIGNMENT.lastIndex = match.index + prefix.length; continue; }
      if (plain && (/^(?:Bearer|Basic)$/i.test(plain) || plain === "[REDACTED" || /^(?:[a-z]v|p|i|e|c|r)_\w+\.$/i.test(plain) || /^\s*\(/.test(text.slice(match.index + whole.length)))) continue;
      const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : "";
      const encoded = quote ? doubleQuoted ?? singleQuoted : plain;
      let value = encoded;
      if (quote === '"') { try { value = JSON.parse('"' + encoded + '"'); } catch (_) { /* keep the displayed value */ } }
      if (quote === "'") value = encoded.replace(/''/g, "'").replace(/\\'/g, "'");
      const hidden = marker(value);
      if (encoded !== value && encoded.length >= 4) marker(encoded);
      if (replace) { output += text.slice(cursor, match.index) + prefix + quote + hidden + quote; cursor = match.index + whole.length; }
    }
    return replace ? output + text.slice(cursor) : text;
  }
  function discover(value, seen = new WeakSet(), depth = 0) {
    if (depth > 40) return;
    if (typeof value === "string") {
      if (MARKER.test(value)) return;
      assignments(value, false);
      value.replace(CREDENTIAL_HEADER, (_, credential) => { marker(credential); return ""; });
      value.replace(BEARER, (_, token) => { marker(token); return ""; });
      value.replace(PRIVATE_KEY, key => { marker(key); return ""; });
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
  function replaceKnown(text) {
    const entries = [...secrets].filter(([, item]) => item.replace).sort((a, b) => b[0].length - a[0].length);
    return text.split(/(\[REDACTED secret-\d+ type=\w+ length=\d+ initial=(?:true|false)\])/).map(part => {
      if (MARKER.test(part)) return part;
      for (const [secret] of entries) part = part.split(secret).join(marker(secret));
      return part;
    }).join("");
  }
  function plain(text) {
    text = text.replace(CREDENTIAL_HEADER, (whole, credential) => whole.slice(0, whole.indexOf(credential)) + marker(credential));
    text = assignments(text, true);
    text = text.replace(BEARER, (whole, token) => whole.slice(0, whole.indexOf(token)) + marker(token));
    text = text.replace(PRIVATE_KEY, key => marker(key));
    return replaceKnown(text);
  }
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
