"use strict";

// Host-owned checks: never evaluate project source or load a project's ESLint plugins.
const path = require("node:path");
const { Linter } = require("eslint");
const globals = require("globals");
const linter = new Linter();
const LIMIT = 2 * 1024 * 1024;

function javascript(text, browser, sourceType = "module") {
  const messages = linter.verify(text, [{ languageOptions: { ecmaVersion: "latest", sourceType,
    globals: browser ? globals.browser : { ...globals.node, ...globals.browser } },
    rules: { "no-undef": "error" } }]);
  return { messages: messages.map(m => ({ rule: m.ruleId || "syntax", message: m.message, line: m.line, column: m.column })),
    ast: linter.getSourceCode()?.ast };
}

function scripts(html) {
  const results = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = attrs.match(/\btype\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    if (type && !/^(?:module|(?:text|application)\/(?:java|ecma)script)$/i.test(type)) continue;
    results.push({ text: match[2], sourceType: type === "module" ? "module" : "script" });
  }
  return results;
}

function inspect(file, text) {
  if (Buffer.byteLength(text) > LIMIT) return { messages: [], skipped: "File exceeds 2 MB." };
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") {
    try { JSON.parse(text.replace(/^\uFEFF/, "")); return { messages: [] }; }
    catch (error) { return { messages: [{ rule: "json", message: error.message }] }; }
  }
  const html = /\.html?$/i.test(ext), js = /\.(?:js|cjs|mjs)$/.test(ext);
  if (!html && !js) return { messages: [], skipped: "No built-in checker for " + (ext || "this file type") + ". Configure a project command." };
  const outer = js ? javascript(text, false, ext === ".cjs" ? "commonjs" : "module") : { messages: [] };
  const embedded = html ? scripts(text) : [];
  let dynamic = false;
  if (js && outer.ast) {
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (node.type === "TemplateLiteral") {
        // Inspect static HTML templates without executing the enclosing function.
        // Interpolations are opaque; the report explicitly discloses that limitation.
        const template = node.quasis.map(q => q.value.cooked ?? q.value.raw).join("__vertexInterpolation__");
        const found = scripts(template);
        if (found.length) {
          embedded.push(...found.map(script => ({ ...script, dynamic: script.text.includes("__vertexInterpolation__") })));
          if (found.some(script => script.text.includes("__vertexInterpolation__"))) dynamic = true;
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (["parent", "loc", "range", "tokens", "comments"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
      }
    };
    visit(outer.ast);
  }
  embedded.forEach((script, index) => {
    const messages = javascript(script.text, true, script.sourceType).messages;
    // Interpolation placeholders can produce synthetic syntax errors, not project bugs.
    outer.messages.push(...messages.filter(m => !script.dynamic || m.rule !== "syntax" && !m.message.includes("'__vertexInterpolation__'")).map(m => ({ ...m, script: index + 1 })));
  });
  return { messages: outer.messages, ...(dynamic ? { limitation: "Static webview scripts checked; interpolated/generated code requires a runtime test." } : {}) };
}

function freshErrors(before, after) {
  const counts = new Map();
  const key = m => JSON.stringify([m.script || 0, m.rule, m.message]);
  before.forEach(m => counts.set(key(m), (counts.get(key(m)) || 0) + 1));
  return after.filter(m => { const k = key(m), count = counts.get(k) || 0; if (count) { counts.set(k, count - 1); return false; } return true; });
}

async function run({ changes, commands = [], execute, isActive = () => true }) {
  const checks = [];
  if (!Array.isArray(commands)) commands = [{ command: "Project checks", glob: null }];
  for (const change of changes) {
    await new Promise(resolve => setImmediate(resolve));
    if (!isActive()) throw new Error("Verification cancelled.");
    const file = change.file;
    if (change.status === "deleted") continue;
    if (change.binary) { checks.push({ file, state: "unverified", message: "Binary file." }); continue; }
    let after, before;
    try { after = inspect(file, change.after || ""); before = inspect(file, change.before || ""); }
    catch (error) { checks.push({ file, state: "unverified", message: "Checker could not complete: " + error.message }); continue; }
    const errors = freshErrors(before.messages, after.messages);
    checks.push({ file, state: errors.length ? "failed" : after.skipped || after.limitation ? "unverified" : "passed", errors,
      unsupported: Boolean(after.skipped), existingErrors: after.messages.length - errors.length, message: after.skipped || after.limitation || "Syntax and undefined-name checks; no new errors." });
  }
  for (const command of commands) {
    if (!isActive()) throw new Error("Verification cancelled.");
    try {
      if (!command || typeof command.command !== "string" || !command.command.trim() || typeof command.glob !== "string") throw new Error("Each check needs glob and command strings.");
      const matches = require("./folder-tools").glob(command.glob);
      if (!changes.some(change => matches.test(change.file.replace(/\\/g, "/")))) continue;
      if (typeof execute !== "function") throw new Error("Command runner unavailable.");
      const result = await execute(command.command);
      checks.push({ command: command.command, state: result.code === 0 ? "passed" : "failed", code: result.code,
        message: [result.stdout, result.stderr, result.error].filter(Boolean).join("\n").slice(-6000) });
      if (result.code === 0) for (const check of checks) {
        if (check.unsupported && matches.test(check.file.replace(/\\/g, "/"))) {
          check.state = "passed"; check.message = "Covered by project command: " + command.command;
        }
      }
    } catch (error) { checks.push({ command: command?.command || "Project check", state: "unverified", message: error.message }); }
  }
  return { state: checks.some(c => c.state === "failed") ? "failed" : checks.some(c => c.state === "unverified") ? "unverified" : "passed", checks };
}

function report(result) {
  return "VERTEX automatic checks: " + result.state.toUpperCase() + "\n" + result.checks.map(c =>
    "- " + (c.file || c.command) + ": " + c.state + (c.code !== undefined ? " (exit " + c.code + ")" : "")
    + (c.existingErrors ? "; " + c.existingErrors + " existing diagnostics" : "")
    + (c.message ? " — " + c.message : "")
    + (c.errors || []).map(e => "\n  " + (e.script ? "script " + e.script + ":" : "") + (e.line || "?") + ":" + (e.column || "?") + " " + e.rule + " " + e.message).join("")).join("\n");
}

module.exports = { inspect, run, report };
