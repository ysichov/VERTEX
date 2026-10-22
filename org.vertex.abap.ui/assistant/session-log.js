"use strict";

// A Claude-Code-compatible session log, the format ABAP-AI-Code writes: one
// JSONL file per conversation under <root>/claude_compatible, readable by the
// same session reader. Off unless a folder is configured. Token usage is always
// written; everything else is opted into:
//   questions - the text of the user's requests
//   answers   - the text of the assistant's answers
//   tools     - SAP tool calls with their arguments and a summary of the result
//   request   - VERTEX instructions and model context, with source bodies omitted
// Source bodies are always replaced with object references, including legacy code:true settings.

const fs = require("fs");
const path = require("path");

const NOT_LOGGED = "[not logged]";

function stamp(date) {
  const p = n => String(n).padStart(2, "0");
  return date.getFullYear() + p(date.getMonth() + 1) + p(date.getDate()) + "_"
       + p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds());
}

function options(include) {
  const given = include || {};
  return { questions: given.questions === true, answers: given.answers === true,
    tools: given.tools === true,
    request: given.request === true };
}

/** Null when no folder is configured. `session` names the file and stays fixed for a conversation. */
function create(root, provider, session, include) {
  if (!root) { return null; }
  const on = options(include);
  const dir = path.join(root, "claude_compatible");
  const file = path.join(dir, String(provider || "assistant").replace(/[^\w.-]/g, "_") + "_"
    + String(session || stamp(new Date())).replace(/[^\w.-]/g, "_") + ".jsonl");
  let sequence = 0, discarded = false;
  const write = entry => {
    if (discarded) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(Object.assign({ timestamp: new Date().toISOString() }, entry)) + "\n", "utf8");
  };
  const id = kind => kind + "_" + Date.now() + "_" + (++sequence);
  return {
    file,
    discard() { discarded = true; },
    user(text) {
      const objects = [];
      const content = on.questions ? sanitizeText(String(text || ""), objects) : NOT_LOGGED;
      write({ type: "user", message: { role: "user", content }, vertex_objects: objects });
    },
    request({ instructions, prompt, tools, schema }) {
      if (!on.request) { return; }
      const objects = [], snapshots = [];
      const request = { instructions: sanitizeText(String(instructions || ""), objects, snapshots),
        prompt: sanitizeText(String(prompt || ""), objects, snapshots),
        tools: sanitize(tools || [], objects), schema: sanitize(schema || null, objects) };
      write({ type: "vertex_request", request, vertex_objects: objects, vertex_snapshots: snapshots });
    },
    assistant({ model, usage, text }) {
      const objects = [];
      const answer = on.answers ? sanitizeText(String(text || ""), objects) : NOT_LOGGED;
      write({ type: "assistant", vertex_objects: objects, message: { id: id("msg"), model: model || "", usage: {
        input_tokens: usage && usage.input_tokens || 0,
        output_tokens: usage && usage.output_tokens || 0,
        cache_creation_input_tokens: usage && usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage && usage.cache_read_input_tokens || 0
      }, content: [{ type: "text", text: answer }] } });
    },
    toolUse(name, args) {
      if (!on.tools) { return null; }
      const toolId = id("tool");
      const objects = [];
      const input = sanitize(args || {}, objects, name === "read_sap_method" ? { object_type: "CLAS" } : {});
      write({ type: "assistant", message: { id: toolId, content: [{ type: "tool_use", id: toolId, name,
        input, vertex_objects: objects }] } });
      return toolId;
    },
    toolResult(toolId, result) {
      if (!on.tools || !toolId) { return; }
      const objects = [];
      try { sanitize(JSON.parse(text(result)), objects); } catch (_) { /* a text result */ }
      write({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId,
        is_error: !!(result && result.isError), content: summarize(result), vertex_objects: objects,
        ...(result?.vertex_recording ? { vertex_recording: result.vertex_recording } : {}) }] } });
    }
  };
}

function redactArgs(args) {
  return sanitize(args || {}, []);
}

function objectReference(value, inherited = {}) {
  if (!value || typeof value !== "object") return inherited;
  const name = value.object_name || (value.type || value.kind ? value.name : "") || inherited.object_name;
  const type = value.object_type || ({ class: "CLAS", interface: "INTF" }[value.kind]) || value.type || inherited.object_type;
  const local = value.path || inherited.path;
  if (typeof local === "string" && /^(?:\/|[A-Za-z]:[\\/])/.test(local) && /\.abap$/i.test(local)) return { path: local };
  if (typeof name !== "string" || !/^[A-Z0-9_/$~]+$/i.test(name) || !["PROG", "INCL", "CLAS", "INTF", "FUNC", "DEVC"].includes(type)) return inherited;
  return { object_name: name, object_type: type,
    ...(value.system || value.system_name || inherited.system ? { system: value.system || value.system_name || inherited.system } : {}),
    ...(typeof value.include === "string" && /^[\w/$~.-]{1,80}$/.test(value.include) ? { include: value.include } : {}),
    ...(typeof value.method_name === "string" && /^[\w/$~.-]{1,80}$/.test(value.method_name) ? { method_name: value.method_name } : {}) };
}

function addReference(objects, reference) {
  if (!reference.object_name && !reference.path) return;
  if (!objects.some(item => JSON.stringify(item) === JSON.stringify(reference))) objects.push(reference);
}

function omitted(value) { return "[" + String(value || "").length + " characters, not logged; open the referenced object]"; }

function sanitize(value, objects, inherited = {}, parentKey = "", snapshots = []) {
  if (Array.isArray(value)) return value.map(item => sanitize(item, objects, inherited, parentKey, snapshots));
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeText(value, objects, snapshots) : value;
  const reference = objectReference(value, inherited);
  addReference(objects, reference);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const source = /^(?:source|sources|source_text|abap_source|code|old_source|new_source|old_text|new_text|replacement|patch|source_before|source_after)$/i.test(key)
      && !(key === "source" && "target" in value); // UML relationship endpoints are names, not code.
    const fragment = key === "text" && /fragment|selected_code/i.test(parentKey);
    if ((source || fragment) && (typeof item === "string" || Array.isArray(item) || key === "sources")) {
      if (typeof item === "string") {
        const header = /\b(REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION)\s+([A-Z0-9_/$~]+)/i.exec(item);
        if (header) addReference(objects, { object_name: header[2].toUpperCase(), object_type: ({ CLASS: "CLAS", INTERFACE: "INTF", FUNCTION: "FUNC" })[header[1].toUpperCase()] || "PROG" });
      }
      result[key] = omitted(typeof item === "object" ? JSON.stringify(item) : item);
    }
    else result[key] = sanitize(item, objects, reference, key, snapshots);
  }
  for (const kind of ["uml", "metrics"]) {
    if (!result[kind] || typeof result[kind] !== "object") continue;
    const snapshot = { kind, name: value.name || reference.object_name || "", data: result[kind] };
    if (!snapshots.some(item => JSON.stringify(item) === JSON.stringify(snapshot))) snapshots.push(snapshot);
  }
  return result;
}

function sanitizeText(text, objects = [], snapshots = []) {
  let result = String(text || "");
  // Context is composed of labelled JSON blocks. Parse complete blocks rather
  // than line regexes so nested and escaped source strings are removed too.
  let output = "", cursor = 0;
  const start = /(^|\n)[ \t]*[\[{]/g;
  let match;
  while ((match = start.exec(result))) {
    const at = match.index + match[0].length - 1;
    let depth = 0, quoted = false, escaped = false, end = at;
    for (; end < result.length; end++) {
      const c = result[end];
      if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) { end++; break; }
    }
    try {
      const safe = sanitize(JSON.parse(result.slice(at, end)), objects, {}, "", snapshots);
      output += result.slice(cursor, at) + JSON.stringify(safe, null, 2);
      cursor = end; start.lastIndex = end;
    } catch (_) { /* not a JSON context block */ }
  }
  result = output + result.slice(cursor);
  result = result.replace(/```([^\n]*)\n([\s\S]*?)```/g, (block, language) =>
    !language.trim() || /abap|source/i.test(language) ? omitted(block) : block);
  const program = /(^|\n)[ \t]*(?:REPORT|PROGRAM|CLASS|INTERFACE|FUNCTION|METHOD|FORM)\s+([A-Z0-9_/$~]+)[^\n]*\.[ \t]*(?:\n|$)/i.exec(result);
  if (program) {
    addReference(objects, { object_name: program[2].toUpperCase(), object_type: /\b(?:CLASS|METHOD)\b/i.test(program[0]) ? "CLAS" : /\bFUNCTION\b/i.test(program[0]) ? "FUNC" : "PROG" });
    result = result.slice(0, program.index) + "\n" + omitted(result.slice(program.index));
  }
  return result;
}

function text(result) {
  return result && Array.isArray(result.content)
    ? result.content.map(c => c && typeof c.text === "string" ? c.text : "").join("") : "";
}

function summarize(result) {
  const body = text(result);
  if (result && result.isError) { return sanitizeText(body).slice(0, 1000); }
  let data = null;
  try { data = JSON.parse(body); } catch (e) { /* not JSON */ }
  const keep = {};
  if (data && typeof data === "object") {
    for (const key of ["system", "object_name", "object_type", "include", "package", "revision", "opened", "truncated", "message",
      "run_id", "session_id", "mode", "run_number", "recorded_steps"]) {
      if (data[key] !== undefined && typeof data[key] !== "object") { keep[key] = typeof data[key] === "string" ? sanitizeText(data[key]) : data[key]; }
    }
    if (Array.isArray(data.objects)) { keep.objects = data.objects.length; }
  }
  return JSON.stringify(Object.assign(keep, { result_characters: body.length, content: "not logged" }));
}

/** Wraps a tool dispatcher so every call and its outcome is logged. */
function tools(log, call) {
  if (!log) { return call; }
  return async function (deps, name, args) {
    const toolId = log.toolUse(name, args);
    try {
      const result = await call(deps, name, args);
      log.toolResult(toolId, result);
      return result;
    } catch (error) {
      log.toolResult(toolId, { isError: true, content: [{ type: "text", text: String(error && error.message || error) }] });
      throw error;
    }
  };
}

/** Logs a direct assistant's SAP tool call while preserving its original result shape. */
async function assistantTool(log, name, args, call) {
  const toolId = log && log.toolUse(name, args);
  try {
    const result = await call(name, args);
    if (log) log.toolResult(toolId, { content: [{ type: "text", text: JSON.stringify(result) }] });
    return result;
  } catch (error) {
    if (log) log.toolResult(toolId, { isError: true, content: [{ type: "text", text: String(error && error.message || error) }] });
    throw error;
  }
}

const shared = new Map();
/** One log per folder, provider and choice for the life of the process: the VS Code chat is one conversation. */
function current(root, provider, include) {
  if (!root) { return null; }
  const key = [root, provider, JSON.stringify(options(include))].join("\n");
  if (!shared.has(key)) { shared.set(key, create(root, provider, undefined, include)); }
  return shared.get(key);
}

/** Starts the next VS Code conversation in new files. */
function reset() {
  shared.clear();
}

function discardFiles(files) {
  const selected = new Set(files.map(file => path.resolve(file)));
  for (const [key, log] of shared) if (selected.has(path.resolve(log.file))) {
    log.discard();
    shared.delete(key);
  }
}

/** The log choices from the VS Code settings section vertex.ai. */
function fromConfig(config) {
  return { questions: config.get("log.questions", false), answers: config.get("log.answers", false),
    tools: config.get("log.tools", false),
    request: config.get("log.request", false) };
}

module.exports = { create, current, reset, discardFiles, tools, assistantTool, redactArgs, summarize, stamp, fromConfig, sanitize, sanitizeText, objectReference };
