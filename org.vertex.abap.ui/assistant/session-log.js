"use strict";

// A Claude-Code-compatible session log, the format ABAP-AI-Code writes: one
// JSONL file per conversation under <root>/claude_compatible, readable by the
// same session reader. Off unless a folder is configured. Token usage is always
// written; everything else is opted into:
//   questions - the text of the user's requests
//   answers   - the text of the assistant's answers
//   tools     - SAP tool calls with their arguments and a summary of the result
//   code      - SAP source inside tool calls and results (only with tools)

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
    tools: given.tools === true, code: given.tools === true && given.code === true };
}

/** Null when no folder is configured. `session` names the file and stays fixed for a conversation. */
function create(root, provider, session, include) {
  if (!root) { return null; }
  const on = options(include);
  const dir = path.join(root, "claude_compatible");
  const file = path.join(dir, String(provider || "assistant").replace(/[^\w.-]/g, "_") + "_"
    + String(session || stamp(new Date())).replace(/[^\w.-]/g, "_") + ".jsonl");
  let sequence = 0;
  const write = entry => {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(Object.assign({ timestamp: new Date().toISOString() }, entry)) + "\n", "utf8");
  };
  const id = kind => kind + "_" + Date.now() + "_" + (++sequence);
  return {
    file,
    user(text) {
      write({ type: "user", message: { role: "user", content: on.questions ? String(text || "") : NOT_LOGGED } });
    },
    assistant({ model, usage, text }) {
      write({ type: "assistant", message: { id: id("msg"), model: model || "", usage: {
        input_tokens: usage && usage.input_tokens || 0,
        output_tokens: usage && usage.output_tokens || 0,
        cache_creation_input_tokens: usage && usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage && usage.cache_read_input_tokens || 0
      }, content: [{ type: "text", text: on.answers ? String(text || "") : NOT_LOGGED }] } });
    },
    toolUse(name, args) {
      if (!on.tools) { return null; }
      const toolId = id("tool");
      write({ type: "assistant", message: { id: toolId, content: [{ type: "tool_use", id: toolId, name,
        input: on.code ? (args || {}) : redactArgs(args) }] } });
      return toolId;
    },
    toolResult(toolId, result) {
      if (!on.tools || !toolId) { return; }
      write({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId,
        is_error: !!(result && result.isError), content: on.code ? text(result) : summarize(result) }] } });
    }
  };
}

function redactArgs(args) {
  const out = Object.assign({}, args || {});
  for (const key of Object.keys(out)) {
    if (typeof out[key] === "string" && (key === "source" || out[key].length > 2000)) {
      out[key] = "[" + out[key].length + " characters, not logged]";
    }
  }
  return out;
}

function text(result) {
  return result && Array.isArray(result.content)
    ? result.content.map(c => c && typeof c.text === "string" ? c.text : "").join("") : "";
}

function summarize(result) {
  const body = text(result);
  if (result && result.isError) { return body.slice(0, 1000); }
  let data = null;
  try { data = JSON.parse(body); } catch (e) { /* not JSON */ }
  const keep = {};
  if (data && typeof data === "object") {
    for (const key of ["system", "object_name", "object_type", "include", "package", "revision", "opened", "truncated", "message"]) {
      if (data[key] !== undefined && typeof data[key] !== "object") { keep[key] = data[key]; }
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

/** The log choices from the VS Code settings section vertex.ai. */
function fromConfig(config) {
  return { questions: config.get("log.questions", false), answers: config.get("log.answers", false),
    tools: config.get("log.tools", false), code: config.get("log.code", false) };
}

module.exports = { create, current, reset, tools, redactArgs, summarize, stamp, fromConfig };
