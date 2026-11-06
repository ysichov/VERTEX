"use strict";

// Provider-independent local tools. Mutations are serialized and confined to the selected
// folder; a Git copy is reviewed after the turn, other folders before each write.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const approval = require("./folder-approval");
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TEXT = 16000;
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", "target"]);
const str = description => ({ type: "string", description });
const integer = description => ({ type: "integer", description });
const schema = (name, description, properties, required) => ({ name, description,
  annotations: { readOnlyHint: ["Read", "Glob", "Grep"].includes(name),
    destructiveHint: !["Read", "Glob", "Grep"].includes(name), openWorldHint: name === "Bash" },
  inputSchema: { type: "object", properties, required, additionalProperties: false } });
const schemas = [
  schema("Read", "Read a UTF-8 project file with line numbers. Read existing files before changing them. Use offset/limit for paging.",
    { file_path: str("Path relative to the working folder."), offset: integer("First line, starting at 1."), limit: integer("Maximum lines, default 200, at most 500.") }, ["file_path"]),
  schema("Glob", "List project files. Supports *, ** and ? in a relative glob; skips symlinks, .git and generated dependency/build directories. Results are bounded.",
    { pattern: str("For example **/*.js or **/AGENTS.md."), path: str("Optional subdirectory, default working folder.") }, ["pattern"]),
  schema("Grep", "Search project files for literal text (not a regular expression). Returns file, line and text. Results are bounded; narrow path/glob when truncated.",
    { pattern: str("Literal text to find."), path: str("Optional file or subdirectory."), glob: str("Optional file glob, e.g. **/*.js."), ignore_case: { type: "boolean" } }, ["pattern"]),
  schema("Edit", "Replace exact text in a previously read file. An ambiguous match needs replace_all or a more specific old_string. Changes are reviewed by the user.",
    { file_path: str("File path."), old_string: str("Exact existing text."), new_string: str("Replacement text."), replace_all: { type: "boolean" } }, ["file_path", "old_string", "new_string"]),
  schema("Write", "Create a UTF-8 file or replace a previously read file. Changes are reviewed by the user.",
    { file_path: str("File path."), content: str("Complete file contents.") }, ["file_path", "content"]),
  schema("Bash", "Run a project command in the working folder (PowerShell on Windows, sh elsewhere). VERTEX requests approval unless shellWithoutAsking is enabled for a Git copy. Do not use this to edit files. Propose post-review builds in build_command instead.",
    { command: str("Command to run."), description: str("Purpose of the command."), timeout: integer("Timeout in milliseconds, at most 120000.") }, ["command"])
];

function glob(pattern) {
  if (typeof pattern !== "string" || !pattern || pattern.length > 500) throw new Error("A nonempty glob of at most 500 characters is required.");
  let source = "";
  const text = pattern.replace(/\\/g, "/");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "*" && text[i + 1] === "*") {
      i++;
      if (text[i + 1] === "/") { i++; source += "(?:.*/)?"; } else source += ".*";
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + source + "$", process.platform === "win32" ? "i" : "");
}

function create(vscode, options) {
  const root = fs.realpathSync(options.cwd);
  const approve = approval.set(vscode);
  const seen = new Map();
  const controller = new AbortController();
  let serial = Promise.resolve();
  const active = () => {
    if (controller.signal.aborted || options.isActive && !options.isActive()) throw new Error("This local-tool request is no longer active.");
  };
  const within = file => {
    const rel = path.relative(root, file);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Path is outside the working folder.");
    if (rel.split(path.sep).some(part => part.toLowerCase() === ".git" || part.includes(":"))) throw new Error("Repository metadata and alternate streams are unavailable.");
  };
  function resolve(given = ".") {
    if (typeof given !== "string" || given.includes("\0")) throw new Error("Invalid project path.");
    const file = path.resolve(root, given);
    within(file);
    // Check every ancestor, including dangling links. New files must not escape through a symlink.
    let current = root;
    for (const part of path.relative(root, file).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are unavailable to local tools.");
      within(fs.realpathSync(current));
    }
    return file;
  }
  function read(file) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE) throw new Error("Only text files up to 2 MB are supported.");
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) throw new Error("Binary files are not supported.");
    return bytes.toString("utf8");
  }
  function listing(start) {
    const files = [], pending = [start];
    let visited = 0;
    while (pending.length && visited < 10000) {
      active();
      const file = pending.pop(); visited++;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        for (const item of fs.readdirSync(file, { withFileTypes: true })) {
          if (!SKIP.has(item.name.toLowerCase()) && !item.isSymbolicLink()) pending.push(path.join(file, item.name));
        }
      } else if (stat.isFile()) files.push(file);
    }
    return { files: files.sort(), truncated: pending.length > 0 };
  }
  async function permission(name, input) {
    const result = await approve.call(null, approval.TOOL, { tool_name: name, input });
    active();
    const decision = JSON.parse(result.content[0].text);
    if (decision.behavior !== "allow") throw new Error(decision.message || "The user declined this action.");
  }
  async function execute(name, args) {
    active();
    if (name === "Read") {
      const file = resolve(args.file_path), text = read(file);
      seen.set(file, text);
      const lines = text.split(/\r?\n/), offset = Math.max(1, Number(args.offset) || 1);
      const limit = Math.min(500, Math.max(1, Number(args.limit) || 200));
      const selected = []; let size = 0;
      for (let i = offset - 1; i < Math.min(lines.length, offset - 1 + limit); i++) {
        const line = lines[i].slice(0, 4000);
        if (size + Buffer.byteLength(JSON.stringify(line)) + 16 > MAX_TEXT) break;
        selected.push((i + 1) + ": " + line); size += Buffer.byteLength(JSON.stringify(line)) + 16;
      }
      return { file_path: file, text: selected.join("\n"), total_lines: lines.length,
        next_offset: offset + selected.length <= lines.length ? offset + selected.length : null,
        truncated: selected.length < Math.min(limit, lines.length - offset + 1) || lines.some(line => line.length > 4000) };
    }
    if (name === "Glob" || name === "Grep") {
      const start = resolve(args.path || ".");
      const listed = listing(start), matches = [], filter = glob(name === "Glob" ? args.pattern : args.glob || "**");
      let truncated = listed.truncated, scanned = 0, size = 0;
      const base = fs.statSync(start).isDirectory() ? start : path.dirname(start);
      if (name === "Grep" && (typeof args.pattern !== "string" || !args.pattern)) throw new Error("Grep needs nonempty literal text.");
      for (const file of listed.files) {
        const relative = path.relative(base, file).replace(/\\/g, "/");
        if (!filter.test(relative)) continue;
        if (name === "Glob") matches.push(path.relative(root, file).replace(/\\/g, "/"));
        else {
          let text;
          try { text = read(file); } catch (_) { continue; }
          scanned += Buffer.byteLength(text);
          if (scanned > 32 * 1024 * 1024) { truncated = true; break; }
          const needle = args.ignore_case ? args.pattern.toLowerCase() : args.pattern;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (!(args.ignore_case ? lines[i].toLowerCase() : lines[i]).includes(needle)) continue;
            const match = { file: path.relative(root, file), line: i + 1, text: lines[i].slice(0, 300) };
            matches.push(match); size += Buffer.byteLength(JSON.stringify(match));
            if (matches.length >= 100 || size >= 12000) { truncated = true; break; }
          }
        }
        if (matches.length >= 100 || size >= 12000) { truncated = true; break; }
      }
      return { matches, truncated };
    }
    if (name === "Edit" || name === "Write") {
      const file = resolve(args.file_path);
      const before = fs.existsSync(file) ? read(file) : null;
      if (before !== null && seen.get(file) !== before) throw new Error("Read the current file before changing it; it is unread or has changed.");
      if (name === "Write" && typeof args.content !== "string" || name === "Edit" && (typeof args.old_string !== "string" || typeof args.new_string !== "string")) throw new Error("File contents must be strings.");
      const input = { ...args, file_path: file };
      const change = approval.change(name, input, read);
      if (change.error) throw new Error(change.error);
      if (Buffer.byteLength(change.after) > MAX_FILE) throw new Error("File exceeds the 2 MB limit.");
      if (!options.reviewAfter) await permission(name, input);
      active(); resolve(args.file_path);
      const current = fs.existsSync(file) ? read(file) : null;
      if (current !== before) throw new Error("File changed while waiting for review; read it again.");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, change.after);
      seen.set(file, change.after);
      return { file_path: file, changed: true, review: options.reviewAfter ? "pending after this turn" : "approved" };
    }
    if (name === "Bash") {
      if (typeof args.command !== "string" || !args.command.trim()) throw new Error("A command is required.");
      if (!options.reviewAfter || !options.shellWithoutAsking) await permission(name, args);
      active();
      const win = process.platform === "win32";
      return new Promise(resolveCommand => execFile(win ? "powershell.exe" : "/bin/sh",
        win ? ["-NoProfile", "-NonInteractive", "-Command", args.command] : ["-lc", args.command],
        { cwd: root, windowsHide: true, timeout: Math.min(120000, Math.max(1000, Number(args.timeout) || 120000)),
          maxBuffer: 128 * 1024, signal: controller.signal },
        (error, stdout, stderr) => resolveCommand({ code: error ? error.code || -1 : 0,
          stdout: String(stdout).slice(-8000), stderr: String(stderr).slice(-4000),
          ...(error ? { error: error.message.slice(0, 2000) } : {}) })));
    }
    throw new Error("Unknown local tool: " + name);
  }
  return {
    schemas,
    dispose() { controller.abort(); approve.dispose(); },
    call(name, args = {}) {
      const run = serial.then(async () => {
        active();
        const id = "local_" + crypto.randomBytes(8).toString("hex");
        const input = { ...args };
        for (const key of ["file_path", "path"]) if (input[key]) input[key] = resolve(input[key]);
        if (options.onStep) options.onStep({ kind: "use", id, name, input, provider: "local" });
        try {
          const result = await execute(name, args);
          if (options.onStep) options.onStep({ kind: "result", id, name, content: name === "Read" ? result.text : JSON.stringify(result), is_error: name === "Bash" && result.code !== 0, provider: "local" });
          return result;
        } catch (error) {
          if (options.onStep) options.onStep({ kind: "result", id, name, content: error.message, is_error: true, provider: "local" });
          throw error;
        }
      });
      serial = run.catch(() => {});
      return run;
    }
  };
}

module.exports = { schemas, create };
