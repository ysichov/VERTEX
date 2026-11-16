"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const logs = new Set();
const roots = new Set();
const INLINE_BYTES = 8000;
function directory(vscode) {
  const configured = vscode?.workspace?.getConfiguration?.("vertex.ai")?.get("logPath", "");
  const base = require("./session-log").resolveRoot(configured || "") || path.join(os.homedir(), ".vertex", "ai-logs");
  const root = path.resolve(base, "command-output"); roots.add(root); return root;
}

// Keep short output inline; spill the buffered prefix and every subsequent chunk once it grows.
// The model gets a bounded preview, while the command itself has no output-size limit.
function collect(options = {}) {
  const root = path.resolve(options.directory || directory()); roots.add(root);
  let chunks = [], bytes = 0, stdout = "", stderr = "", file = null, logError = null, verifiedVsixLine = "";
  const highlights = [];
  const pending = { stdout: "", stderr: "" };
  const note = line => {
    if (/^Verified VSIX:\s*\S+/i.test(line.trim())) verifiedVsixLine = line.trim();
    if (/\b(error|failed|failure|exception|fatal|warning|verified|success|passed)\b/i.test(line)) {
      highlights.push(line.slice(0, 400));
      if (highlights.length > 8) highlights.shift();
    }
  };
  function write(stream, text) {
    text = String(text); bytes += Buffer.byteLength(text);
    if (stream === "stdout") stdout = (stdout + text).slice(-8000);
    else stderr = (stderr + text).slice(-8000);
    const lines = text.split(/\r?\n/);
    if (lines.length === 1) pending[stream] = (pending[stream] + text).slice(0, 400);
    else {
      note(pending[stream] + lines[0]);
      for (let i = 1; i < lines.length - 1; i++) note(lines[i]);
      pending[stream] = lines.at(-1).slice(0, 400);
    }
    if (logError) return;
    try {
      if (!file && bytes <= INLINE_BYTES) { chunks.push(text); return; }
      if (!file) {
        const folder = path.join(root, require("node:crypto").randomUUID());
        fs.mkdirSync(folder, { recursive: true });
        file = path.join(folder, "output.log");
        fs.writeFileSync(file, chunks.join(""), { encoding: "utf8", mode: 0o600 });
        logs.add(file); chunks = [];
      }
      fs.appendFileSync(file, text, "utf8");
    } catch (error) { logError = error.message; chunks = []; }
  }
  return { write, finish() {
    note(pending.stdout); note(pending.stderr);
    return { output_bytes: bytes, output_truncated: bytes > INLINE_BYTES,
      ...(verifiedVsixLine ? { verified_vsix_line: verifiedVsixLine } : {}),
      ...(file ? { output_file: file } : {}), ...(logError ? { log_error: logError } : {}),
      ...(bytes > INLINE_BYTES ? { highlights, output_note: "Preview only. Read output_file with Read (offset/limit) for full details; highlights are text matches, not a success verdict." } : {}),
      stdout: bytes > INLINE_BYTES ? stdout.slice(-2000) : stdout,
      stderr: bytes > INLINE_BYTES ? stderr.slice(-2000) : stderr };
  } };
}

function owns(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) return false;
  file = path.resolve(file);
  if (logs.has(file)) return true;
  return path.basename(file) === "output.log" && /^[a-f0-9-]{36}$/.test(path.basename(path.dirname(file))) && roots.has(path.dirname(path.dirname(file)));
}
async function readPage(file, offset = 1, limit = 200) {
  file = path.resolve(file);
  if (!owns(file) || fs.lstatSync(file).isSymbolicLink() || fs.lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error("Unknown command output log.");
  offset = Math.max(1, Number(offset) || 1); limit = Math.min(500, Math.max(1, Number(limit) || 200));
  const input = fs.createReadStream(file, { encoding: "utf8" });
  let line = "", number = 1, size = 0, more = false, shortened = false;
  const selected = [];
  const add = () => {
    if (number < offset) return;
    if (selected.length >= limit || size + Buffer.byteLength(JSON.stringify(line)) + 32 > 16000) { more = true; return; }
    selected.push(number + ": " + line); size += Buffer.byteLength(JSON.stringify(line)) + 32;
  };
  try {
    outer: for await (const chunk of input) {
      const parts = chunk.split("\n");
      for (let i = 0; i < parts.length; i++) {
        const text = line + parts[i]; if (text.length > 4000) shortened = true;
        line = text.slice(0, 4000);
        if (i < parts.length - 1) { add(); if (more) break outer; number++; line = ""; }
      }
    }
    if (!more && line) add();
  } finally { input.destroy(); }
  return { file_path: file, text: selected.join("\n"), ...(more ? { next_offset: offset + selected.length } : { total_lines: number }),
    ...(shortened ? { lines_truncated: true } : {}) };
}
module.exports = { collect, owns, readPage, INLINE_BYTES, directory };
