"use strict";

// A Claude-Code-compatible session log, the format ABAP-AI-Code writes: one
// JSONL file per conversation under <root>/claude_compatible, readable by the
// same session reader. Off unless a folder is configured. Token usage is always
// written; everything else is opted into:
//   questions - the text of the user's requests
//   answers   - the text of the assistant's answers
//   tools     - SAP tool calls with their arguments and a summary of the result
//   request   - VERTEX instructions and model context, with source bodies omitted
// Automatic source bodies are replaced with object references, including legacy code:true settings.
// Explicit Jev inputs are saved with question logging so each decision can be restored.

const fs = require("fs");
const path = require("path");

const NOT_LOGGED = "[not logged]";
let accountingRoot="";
function configureAccounting(context){accountingRoot=context?.globalStorageUri?.fsPath?path.join(context.globalStorageUri.fsPath,"ai-logs"):"";}
function resolveRoot(root){return root||accountingRoot;}

function stamp(date) {
  const p = n => String(n).padStart(2, "0");
  return date.getFullYear() + p(date.getMonth() + 1) + p(date.getDate()) + "_"
       + p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds());
}

function options(include) {
  const given = include || {};
  return { questions: given.questions === true, answers: given.answers === true,
    tools: given.tools === true,
    // What each tool returned, not only its size; source still becomes object references.
    toolResults: given.toolResults === true,
    request: given.request === true,
    // The text of Claude Code's changes to local project files (Edit, Write). Program source from SAP stays out.
    localCode: given.localCode === true };
}

/** Null when no folder is configured. `session` names the file and stays fixed for a conversation. */
function create(root, provider, session, include, operation = "Chat", scope = null) {
  root=resolveRoot(root);
  if (!root) { return null; }
  const on = options(include);
  const dir = path.join(root, "claude_compatible");
  const file = path.join(dir, String(provider || "assistant").replace(/[^\w.-]/g, "_") + "_"
    // A random tail: two conversations started within one second must not share a file.
    + String(session || stamp(new Date()) + "_" + require("crypto").randomBytes(3).toString("hex")).replace(/[^\w.-]/g, "_") + ".jsonl");
  let sequence = 0, discarded = false, screenshotCount = 0;
  // Where the conversation was held: the local folder, or the SAP system and client. Session Logs filters by it,
  // and nothing else in the log records it - a conversation without it cannot be placed afterwards.
  let context = null;
  // Every file of one VS Code conversation carries its id: a conversation that changes provider writes one file per
  // provider, and Session Logs puts them back together by it.
  const conversation = scope?.conversation || conversationId, branch = scope ? "main" : branchId, parent = scope ? null : branchParent;
  const protection = require("./context-protection").create();
  const write = entry => {
    if (discarded) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(Object.assign({ timestamp: new Date().toISOString(), vertex_operation: operation, vertex_conversation: conversation, vertex_branch: branch,
      ...(scope?.relatedConversation ? { vertex_related_conversation: scope.relatedConversation } : {}), ...(parent ? { vertex_parent: parent } : {}),
      ...(context ? { vertex_context: context } : {}) }, protection.protect(entry))) + "\n", "utf8");
  };
  const id = kind => kind + "_" + Date.now() + "_" + (++sequence);
  return {
    file,
    // Explicit Jev input is retained only when question logging is enabled.
    decision(input) {
      if (on.questions) write({ type: "vertex_decision", input: JSON.parse(JSON.stringify(input)) });
    },
    setOperation(value){operation=String(value||"Chat");},
    /** Folder mode: {mode:"folder",folder}. SAP mode: {mode:"sap",system,client}. Anything else is refused. */
    setContext(value){
      if (!value || typeof value !== "object") { context = null; return; }
      const text = key => typeof value[key] === "string" ? sanitizeText(value[key]).slice(0, 400) : "";
      if (value.mode === "folder" && text("folder")) { context = { mode: "folder", folder: text("folder") }; return; }
      if (value.mode === "sap" && text("system")) { context = { mode: "sap", system: text("system"), ...(text("client") ? { client: text("client") } : {}) }; return; }
      context = null;
    },
    discard() { discarded = true; },
    /* A question; screenshots pasted with it are part of it: with the questions option each is saved as a file in
       the conversation's folder beside the log (<log name>/screenshot-<n>.<ext>), without it only counted. */
    user(text, images) {
      const objects = [];
      const content = on.questions ? sanitizeText(protection.text(text), objects) : NOT_LOGGED;
      const pasted = Array.isArray(images) ? images.filter(image => image && typeof image.data === "string" && image.data) : [];
      let screenshots;
      if (pasted.length && on.questions) {
        const folder = file.replace(/\.jsonl$/, "");
        fs.mkdirSync(folder, { recursive: true });
        screenshots = pasted.map(image => {
          const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[image.media_type] || "png";
          const target = path.join(folder, "screenshot-" + (++screenshotCount) + "." + ext);
          fs.writeFileSync(target, Buffer.from(image.data, "base64"));
          return { file: target, media_type: image.media_type || "image/png", ...(typeof image.description === "string" ? { description: protection.text(image.description) } : {}) };
        });
      } else if (pasted.length) screenshots = pasted.map(image => ({ media_type: image.media_type || "image/png" }));
      write({ type: "user", message: { role: "user", content }, vertex_objects: objects, ...(screenshots ? { vertex_screenshots: screenshots } : {}) });
      return screenshots || [];
    },
    request({ instructions, prompt, tools, schema }) {
      // Measure the prepared request before source bodies are omitted from the log.
      const characters = String(instructions || "").length + String(prompt || "").length
        + JSON.stringify(tools || []).length + JSON.stringify(schema || null).length;
      const contextSize = { characters, estimatedTokens: Math.ceil(characters / 4), method: "characters/4", scope: "prepared_request" };
      if (!on.request) { write({ type: "vertex_context_size", contextSize }); return; }
      ({ instructions, prompt, tools, schema } = protection.protect({ instructions, prompt, tools, schema }));
      const objects = [], snapshots = [];
      const request = { instructions: sanitizeText(String(instructions || ""), objects, snapshots),
        prompt: sanitizeText(String(prompt || ""), objects, snapshots),
        tools: sanitize(tools || [], objects), schema: sanitize(schema || null, objects) };
      write({ type: "vertex_request", request, contextSize, vertex_objects: objects, vertex_snapshots: snapshots });
    },
    routing(report) { write({type:"vertex_topic_routing",report:on.questions?protection.protect(report):{status:report.status,basis:report.basis,topic:report.topic?{id:report.topic.id}:null,elapsedMs:report.elapsedMs,usage:report.usage}}); },
    optimization(report) { write({type:"vertex_context_optimization",report}); },
    providerResponse({ provider, scope, response }) {
      // Preserve provider counters verbatim, before normalization. These records
      // are diagnostic evidence, never assistant records (no double counting).
      const fields = ["id", "type", "model", "subtype", "is_error", "usage", "modelUsage",
        "finish_reason", "message_diagnostics", "gateway_tool_calls", "error", "code", "attempt", "model_step", "operation", "status", "total_cost_usd", "num_turns", "duration_ms", "duration_api_ms", "stop_reason"];
      const metadata = {};
      for (const key of fields) {
        if (response && Object.prototype.hasOwnProperty.call(response, key)) metadata[key] = response[key];
      }
      write({ type: "vertex_provider_response", provider, scope, response: metadata });
    },
    assistant({ model, usage, text, reasoning }) {
      ({ text, reasoning } = protection.protect({ text, reasoning }));
      // A model's own reasoning (reasoning_content), kept with the answers option as a thinking note.
      if (on.answers && reasoning) write({ type: "assistant", vertex_step: "claude_note", message: { id: id("note"),
        content: [{ type: "vertex_note", note: "thinking", text: sanitizeText(String(reasoning), []) }] } });
      const objects = [];
      const answer = on.answers ? sanitizeText(String(text || ""), objects) : NOT_LOGGED;
      write({ type: "assistant", vertex_objects: objects, message: { id: id("msg"), model: model || "", usage: {
        input_tokens: usage && usage.input_tokens || 0,
        output_tokens: usage && usage.output_tokens || 0,
        cache_creation_input_tokens: usage && usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage && usage.cache_read_input_tokens || 0,
        ...(usage && Object.prototype.hasOwnProperty.call(usage,"web_search_calls") ? {web_search_calls:usage.web_search_calls} : {}),
        ...(usage?.generation_id ? {generation_id:usage.generation_id} : {}),
        ...(usage?.estimated_cost_usd !== undefined ? { estimated_cost_usd: usage.estimated_cost_usd, input_usd_per_million: usage.input_usd_per_million } : {}),
        ...(usage && Object.prototype.hasOwnProperty.call(usage, "cost_usd") ? { cost_usd: usage.cost_usd } : {})
      }, content: [{ type: "text", text: answer }] } });
    },
    toolUse(name, args) {
      if (!on.tools) { return null; }
      args = protection.protect(args);
      const toolId = id("tool");
      const objects = [];
      const input = sanitize(args || {}, objects, name === "read_sap_method" ? { object_type: "CLAS" } : {});
      write({ type: "assistant", message: { id: toolId, content: [{ type: "tool_use", id: toolId, name,
        input, vertex_objects: objects }] } });
      return toolId;
    },
    /* A step of Claude Code's own (Read, Grep, Glob, Edit, Write, Bash, ...), with the tool option. What it read
       or wrote is not logged - only where and how much - as for SAP tools; a command and its output are. */
    step(step) {
      if (!step || !step.id) { return; }
      step = protection.protect(step);
      // What Claude says or thinks between its steps is model text, kept with the answers option.
      if (step.kind === "note") {
        if (!on.answers) { return; }
        write({ type: "assistant", vertex_step: "claude_note", message: { id: step.id, content: [{ type: "vertex_note",
          note: step.note === "thinking" ? "thinking" : "text", text: sanitizeText(String(step.text || ""), []) }] } });
        return;
      }
      if (!on.tools) { return; }
      const objects = [];
      if (step.kind === "use") {
        write({ type: "assistant", vertex_step: step.provider || "claude", message: { id: step.id, content: [{ type: "tool_use", id: step.id,
          name: String(step.name || ""), input: stepInput(step.name, step.input || {}, objects, on.localCode), vertex_objects: objects }] } });
      } else if (step.kind === "result") {
        write({ type: "user", vertex_step: step.provider || "claude", message: { role: "user", content: [{ type: "tool_result", tool_use_id: step.id,
          is_error: step.is_error === true, content: stepResult(step.name, step.content, step.is_error === true, objects), vertex_objects: objects }] } });
      }
    },
    /* The user's review of Claude Code's working copy: each file's decision, with a link to the file in the folder. */
    review(outcome) {
      if (!on.tools || !outcome) { return; }
      outcome = protection.protect(outcome);
      const objects = [], reviewId = id("review");
      const files = [];
      const add = (file, decision, extra) => {
        files.push({ file, decision, ...(extra || {}) });
        if (outcome.folder) addReference(objects, { path: path.join(outcome.folder, file), kind: "file" });
      };
      (outcome.applied || []).forEach(file => add(file, (outcome.merged || []).includes(file) ? "approved, merged with the folder's change" : "approved"));
      (outcome.reworked || []).forEach(r => add(r.file, "declined, sent back to rework", { reason: sanitizeText(String(r.reason || ""), []) }));
      (outcome.dropped || []).forEach(file => add(file, "declined, dropped"));
      (outcome.closed || []).forEach(file => add(file, "not decided"));
      (outcome.failed || []).forEach(f => add(f.file, "not applied", { error: String(f.error || "") }));
      write({ type: "assistant", vertex_step: "review", message: { id: reviewId, content: [{ type: "tool_use", id: reviewId,
        name: "Review", input: { folder: outcome.folder || "", files }, vertex_objects: objects }] } });
    },
    toolResult(toolId, result) {
      if (!on.tools || !toolId) { return; }
      result = protection.protect(result);
      const objects = [];
      try { sanitize(JSON.parse(text(result)), objects); } catch (_) { /* a text result */ }
      write({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId,
        is_error: !!(result && result.isError), content: on.toolResults ? resultContent(result, objects) : summarize(result), vertex_objects: objects,
        ...(result?.vertex_recording ? { vertex_recording: result.vertex_recording } : {}) }] } });
    }
  };
}

const STEP_TEXT = 4000;
const lineCount = text => text ? String(text).split(/\r?\n/).length : 0;
const clip = text => text.length > STEP_TEXT ? text.slice(0, STEP_TEXT) + "\n[" + (text.length - STEP_TEXT) + " more characters not logged]" : text;
function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => part && part.type === "text" ? String(part.text || "") : part && part.type === "image" ? "[image]" : "").join("\n");
  return content == null ? "" : JSON.stringify(content);
}
/* What a step was asked to do: a command in full, a path and a pattern; an edit's or a write's text counted, and
   with the localCode option logged as well. Every file named is a link to it. */
function stepInput(name, input, objects, localCode) {
  // A Windows path in one slash style: Claude may write C:/..., and the copy's prefix swapped for the folder's
  // left the rest as it was.
  const local = file => {
    if (typeof file !== "string" || !file) return file;
    const shown = /^[A-Za-z]:[\\/]/.test(file) ? file.replace(/\//g, "\\") : file;
    addReference(objects, { path: shown, kind: "file" });
    return shown;
  };
  if (name === "Edit") return { file_path: local(input.file_path), ...(input.replace_all ? { replace_all: true } : {}),
    old_lines: lineCount(input.old_string), new_lines: lineCount(input.new_string),
    old_characters: String(input.old_string || "").length, new_characters: String(input.new_string || "").length,
    ...(localCode ? { old_string: String(input.old_string || ""), new_string: String(input.new_string || "") } : {}) };
  if (name === "Write") return { file_path: local(input.file_path), lines: lineCount(input.content), characters: String(input.content || "").length,
    ...(localCode ? { content: String(input.content || "") } : {}) };
  if (name === "Read") return { file_path: local(input.file_path), ...(input.offset ? { offset: input.offset } : {}), ...(input.limit ? { limit: input.limit } : {}) };
  if (name === "Bash") return { command: String(input.command || ""), ...(input.description ? { description: String(input.description) } : {}) };
  return sanitize(input, objects);
}
/* What came back: a command's output, a search's matches, an error or a refusal in words; a file's text only counted. */
function stepResult(name, content, error, objects) {
  const text = resultText(content);
  if (name === "Read" && !error) return "[" + lineCount(text) + " lines read, not logged]";
  return clip(sanitizeText(text, objects));
}

function redactArgs(args) {
  return sanitize(args || {}, []);
}

function objectReference(value, inherited = {}) {
  if (!value || typeof value !== "object") return inherited;
  // A review block is a part of an object: review_object names it, review_type is the part's type as a request has it.
  if (typeof value.review_object === "string" && value.review_object) {
    const part = String(value.review_type || "").toUpperCase(), name = value.review_object.toUpperCase();
    const type = part === "FUNC" ? "FUNC" : ["METH", "CPUB", "CPRO", "CPRI", "CINC"].includes(part) ? "CLAS" : part === "REPS" ? "PROG" : "";
    const object = type === "CLAS" ? name.slice(0, 30).replace(/=+.*$/, "").trim() : name;
    if (type && /^[A-Z0-9_/$~]+$/.test(object)) return { object_name: object, object_type: type, part: { type: part, name } };
  }
  const name = value.object_name || (value.type || value.kind ? value.name : "") || inherited.object_name;
  const type = value.object_type || ({ class: "CLAS", interface: "INTF" }[value.kind]) || value.type || inherited.object_type;
  const local = value.path || inherited.path;
  if (typeof local === "string" && /^(?:\/|[A-Za-z]:[\\/])/.test(local) && /\.abap$/i.test(local)) return { path: local };
  // A local project file that Claude Code read or changed: any type, opened as a text document.
  if (value.kind === "file" && typeof local === "string" && /^(?:\/|[A-Za-z]:[\\/])/.test(local)) return { path: local, kind: "file" };
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
  if (!parentKey) value = require("./context-protection").protect(value);
  if (Array.isArray(value)) return value.map(item => sanitize(item, objects, inherited, parentKey, snapshots));
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeText(value, objects, snapshots) : value;
  const reference = objectReference(value, inherited);
  addReference(objects, reference);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const source = /^(?:source|sources|source_text|abap_source|code|old_source|new_source|old_text|new_text|replacement|patch|source_before|source_after)$/i.test(key)
      && !(key === "source" && "target" in value); // UML relationship endpoints are names, not code.
    // A text that is code: a selected fragment, or a review block - its diff with the lines of the object it names.
    const fragment = key === "text" && (/fragment|selected_code|review/i.test(parentKey) || "review_object" in value);
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
  let result = require("./context-protection").create().text(String(text || ""));
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
    // A FORM or METHOD names a routine inside an object, not an object: the line is still omitted, but no reference.
    if (!/^\s*(?:FORM|METHOD)\b/i.test(program[0])) addReference(objects, { object_name: program[2].toUpperCase(), object_type: /\bCLASS\b/i.test(program[0]) ? "CLAS" : /\bFUNCTION\b/i.test(program[0]) ? "FUNC" : "PROG" });
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

/* A tool's result as it went to the model, with the toolResults option: program source replaced by object
   references as in every other log entry, and cut at RESULT_TEXT characters with the count of what was left out. */
const RESULT_TEXT = 20000;
function resultContent(result, objects) {
  const body = text(result);
  let shown;
  try { shown = JSON.stringify(sanitize(JSON.parse(body), objects)); } catch (_) { shown = sanitizeText(body, objects); }
  return shown.length > RESULT_TEXT ? shown.slice(0, RESULT_TEXT) + "\n[" + (shown.length - RESULT_TEXT) + " more characters not logged]" : shown;
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
const newConversationId = () => stamp(new Date()) + "_" + require("crypto").randomBytes(4).toString("hex");
function independentScope() { return { conversation: newConversationId(), relatedConversation: conversationId }; }
let conversationId = newConversationId(), branchId = "main", branchParent = null;
/** One log per folder, provider and choice for the life of the process: the VS Code chat is one conversation. */
function current(root, provider, include) {
  root=resolveRoot(root);
  if (!root) { return null; }
  const key = [root, provider, JSON.stringify(options(include))].join("\n");
  if (!shared.has(key)) { shared.set(key, create(root, provider, undefined, include)); }
  return shared.get(key);
}

/** Starts the next VS Code conversation in new files: a new conversation id, or the one given when a conversation
    continues from its log. */
function reset(continued, branch) {
  shared.clear();
  branchId = branch?.id || "main";
  branchParent = branch?.parent || null;
  conversationId = typeof continued === "string" && /^[\w.:-]{1,320}$/.test(continued) ? continued : newConversationId();
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
    tools: config.get("log.tools", false), toolResults: config.get("log.toolResults", false),
    request: config.get("log.request", false),
    localCode: config.get("log.localCode", true) };
}

module.exports = { configureAccounting, resolveRoot, create, current, reset, discardFiles, tools, assistantTool, redactArgs, summarize, stamp, fromConfig, sanitize, sanitizeText, objectReference, independentScope };
