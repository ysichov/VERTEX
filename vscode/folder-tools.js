"use strict";

// Provider-independent local tools. Mutations are serialized and confined to the selected
// folder; a Git copy is reviewed after the turn, other folders before each write.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const approval = require("./folder-approval");
const commandOutput = require("./command-output");
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TEXT = 16000;
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", "target"]);
const str = description => ({ type: "string", description });

function compactVerifiedVsix(result, project) {
  if (result.purpose !== "build" || result.code !== 0 || typeof result.verified_vsix_line !== "string") return result;
  const match = /^Verified VSIX:\s*(.+\.vsix)\s*$/i.exec(result.verified_vsix_line);
  if (!match) return result;
  const file = path.resolve(match[1]), expected = path.resolve(project, "vscode", path.basename(file));
  if ((process.platform === "win32" ? file.toLowerCase() !== expected.toLowerCase() : file !== expected)
    || !/^vertex-abap-\d+\.\d+\.\d+\.vsix$/i.test(path.basename(file))) return result;
  let size;
  try { const stat = fs.statSync(file); if (stat.isFile()) size = stat.size; } catch (_) { return result; }
  if (!size) return result;
  const { stdout, stderr, highlights, output_note, ...brief } = result;
  return { ...brief, verified_vsix: { file }, output_note: (brief.output_file ? "Full build output remains in output_file and VERTEX Build." : "Full build output remains in VERTEX Build.") + " This summary is valid only with exit code 0." };
}
const integer = description => ({ type: "integer", description });
const schema = (name, description, properties, required) => ({ name, description,
  annotations: { readOnlyHint: ["Read", "Glob", "Grep"].includes(name),
    destructiveHint: !["Read", "Glob", "Grep"].includes(name), openWorldHint: name === "Bash" },
  inputSchema: { type: "object", properties, required, additionalProperties: false } });
const schemas = [
  schema("Read", "Read a UTF-8 project file or a recorded command output_file with line numbers. Read existing files before changing them. Use offset/limit for paging; command logs are read-only.",
    { file_path: str("Path relative to the working folder."), offset: integer("First line, starting at 1."), limit: integer("Maximum lines, default 200, at most 500.") }, ["file_path"]),
  schema("Glob", "List project files. Supports *, ** and ? in a relative glob; a pattern ending in / lists directories instead (*/ the top-level folders, **/ all folders). Skips symlinks, .git and generated dependency/build directories. Results are bounded.",
    { pattern: str("For example **/*.js, **/AGENTS.md, or */ for folders."), path: str("Optional subdirectory, default working folder.") }, ["pattern"]),
  schema("Grep", "Search project files for literal text (not a regular expression). Returns file, line and text. Results are bounded; narrow path/glob when truncated.",
    { pattern: str("Literal text to find."), path: str("Optional file or subdirectory."), glob: str("Optional file glob, e.g. **/*.js."), ignore_case: { type: "boolean" } }, ["pattern"]),
  schema("Edit", "Replace exact text in a previously read file. An ambiguous match needs replace_all or a more specific old_string. Changes are reviewed by the user.",
    { file_path: str("File path."), old_string: str("Exact existing text."), new_string: str("Replacement text."), replace_all: { type: "boolean" } }, ["file_path", "old_string", "new_string"]),
  schema("Write", "Create a UTF-8 file or replace a previously read file. Changes are reviewed by the user.",
    { file_path: str("File path."), content: str("Complete file contents.") }, ["file_path", "content"]),
  schema("Bash", "Run a command with an explicit purpose and execution target. purpose=command defaults to working_copy; purpose=build or artifact defaults to project (the real project folder). Use target=directory with an absolute directory only when the user names another folder; use target=working_copy when the user explicitly requests a build in the copy. Never use shell commands to edit source files; generated build outputs and requested artifact copies are allowed. A project build does not include unapplied changes from the copy. On Windows this runs in PowerShell 5.1: one command per call, no && or ||. Elsewhere use POSIX sh. A working_copy command may use shellWithoutAsking; commands outside the copy use the existing command approval. The result reports the actual cwd and target. Respect requests to skip optional tests; keep packaging integrity checks.",
    { command: str("Command to run."), purpose: { type: "string", enum: ["command", "build", "artifact"], description: "command for diagnostics or other work; build for building, packaging or build prerequisites; artifact for copying a completed package." },
      target: { type: "string", enum: ["working_copy", "project", "directory"], description: "Optional execution target. Defaults to project for build/artifact, working_copy otherwise." },
      directory: str("Absolute existing directory; required only with target=directory, as requested by the user. Do not use cd to conceal a different target."),
      description: str("Purpose of the command. Short output is returned in full. Large output is saved to output_file; use Read with offset/limit for details. A preview or diagnostic highlight alone does not prove success."), timeout: integer("Timeout in milliseconds, default 120000 for diagnostics and 900000 (15 minutes) for builds; at most 900000.") }, ["command", "purpose"])

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
  const outputDirectory = commandOutput.directory(vscode);
  let root = fs.realpathSync(options.cwd);
  const project = fs.realpathSync(options.projectFolder || options.cwd);
  let reviewAfter = !!options.reviewAfter;
  let pendingChanges = options.pendingChanges;
  const changedFiles = new Map((options.overlayFiles || []).map(file => [path.normalize(file).toLowerCase(), path.normalize(file)]));
  const relativeToProject = given => {
    const absolute = path.isAbsolute(given) ? path.resolve(given) : path.resolve(project, given);
    let relative = path.relative(project, absolute);
    if (root !== project && (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)))
      relative = path.relative(root, absolute);
    return relative;
  };
  function commandLocation(args) {
    const purpose = args.purpose || "command";
    if (!["command", "build", "artifact"].includes(purpose)) throw new Error("Unknown command purpose.");
    const target = args.target || (purpose === "command" ? "working_copy" : "project");
    if (!["working_copy", "project", "directory"].includes(target)) throw new Error("Unknown command target.");
    if (target !== "directory" && args.directory) throw new Error("directory is only valid with target=directory.");
    if (target === "directory" && (typeof args.directory !== "string" || args.directory.includes("\0") || !path.isAbsolute(args.directory))) throw new Error("target=directory requires an absolute existing directory requested by the user.");
    const cwd = target === "directory" ? fs.realpathSync(args.directory) : target === "project" ? project : root;
    if (!fs.statSync(cwd).isDirectory()) throw new Error("Command target is not a directory.");
    return { purpose, target, cwd };
  }
  const approve = approval.set(vscode);
  const seen = new Map();
  const written = new Map();
  const inPlaceSed = command => /(?:^|[\s;&|])sed(?:\.exe)?\s+(?:[^\r\n;&|]*?\s)?(?:-i\b|--in-place\b)/i.test(String(command||""));
  const switchToReview = async () => {
    if (reviewAfter || !options.prepareEdit) return;
    const prepared = await options.prepareEdit();
    const next = fs.realpathSync(prepared.cwd);
    for (const [file, text] of seen) {
      const relative = path.relative(root, file);
      if (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
        seen.set(path.join(next, relative), text);
    }
    root = next;
    reviewAfter = true;
    pendingChanges = prepared.pendingChanges;
  };
  const controller = new AbortController();
  let approvalsClosed = false;
  let serial = Promise.resolve();
  let outstanding = 0;
  const completed = [];
  const active = () => {
    if (controller.signal.aborted || options.isActive && !options.isActive()) throw new Error("This local-tool request is no longer active.");
  };
  const within = (file, base = root) => {
    const rel = path.relative(base, file);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Path is outside the working folder.");
    if (rel.split(path.sep).some(part => part.toLowerCase() === ".git" || part.includes(":"))) throw new Error("Repository metadata and alternate streams are unavailable.");
  };
  const displayPath=file=>{
    const relative=path.relative(project,file);
    return relative!==".."&&!relative.startsWith(".."+path.sep)&&!path.isAbsolute(relative)
      ? relative:path.relative(root,file);
  };
  function resolve(given = ".", reading = false) {
    if (typeof given !== "string" || given.includes("\0")) throw new Error("Invalid project path.");
    const relative = relativeToProject(given);
    const base = reading && !changedFiles.has(path.normalize(relative).toLowerCase()) ? project : root;
    const file = path.resolve(base, relative);
    within(file, base);
    // Check every ancestor, including dangling links. New files must not escape through a symlink.
    let current = base;
    for (const part of path.relative(base, file).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (stat.isSymbolicLink()) throw new Error("Symbolic links are unavailable to local tools.");
      within(fs.realpathSync(current), base);
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
    const files = [], dirs = [], pending = [start];
    let visited = 0;
    while (pending.length && visited < 10000) {
      active();
      const file = pending.pop(); visited++;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (file !== start) dirs.push(file);
        for (const item of fs.readdirSync(file, { withFileTypes: true })) {
          if (!SKIP.has(item.name.toLowerCase()) && !item.isSymbolicLink()) pending.push(path.join(file, item.name));
        }
      } else if (stat.isFile()) files.push(file);
    }
    return { files: files.sort(), dirs: dirs.sort(), truncated: pending.length > 0 };
  }
  async function permission(name, input) {
    if (approvalsClosed) throw new Error("The model request ended before this approval; the command was not started.");
    const result = await approve.call(null, approval.TOOL, { tool_name: name, input });
    active();
    if (approvalsClosed) throw new Error("The model request ended before this approval; the command was not started.");
    const decision = JSON.parse(result.content[0].text);
    if (decision.behavior !== "allow") throw new Error(decision.message || "The user declined this action.");
  }
  async function execute(name, args) {
    active();
    if ((name === "Write" || name === "Edit") && commandOutput.owns(args.file_path)) throw new Error("Command output logs are read-only.");
    if (name === "Read") {
      if (commandOutput.owns(args.file_path)) return commandOutput.readPage(args.file_path, args.offset, args.limit);
      const file = resolve(args.file_path, true), text = read(file);
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
      const start = resolve(args.path || ".", true);
      // A Glob pattern ending in / asks for directories: */ the top-level folders, **/ all of them.
      const folders = name === "Glob" && typeof args.pattern === "string" && /[\\/]$/.test(args.pattern);
      const listed = listing(start), matches = [];
      if(root!==project){
        for(const relative of changedFiles.values()){
          const virtual=path.join(project,relative), actual=path.join(root,relative);
          if(fs.existsSync(actual) && !listed.files.includes(virtual) &&
             (virtual===start || virtual.startsWith(start+path.sep)))listed.files.push(virtual);
        }
      }
      const filter = glob(name === "Glob" ? (folders ? args.pattern.replace(/[\\/]+$/, "") : args.pattern) : args.glob || "**");
      let truncated = listed.truncated, scanned = 0, size = 0;
      const base = fs.statSync(start).isDirectory() ? start : path.dirname(start);
      if (name === "Grep" && (typeof args.pattern !== "string" || !args.pattern)) throw new Error("Grep needs nonempty literal text.");
      for (const file of folders ? listed.dirs : listed.files) {
        const relative = path.relative(base, file).replace(/\\/g, "/");
        if (!filter.test(relative)) continue;
        if (name === "Glob") matches.push(displayPath(file).replace(/\\/g, "/") + (folders ? "/" : ""));
        else {
          let text;
          try { text = read(resolve(file,true)); } catch (_) { continue; }
          scanned += Buffer.byteLength(text);
          if (scanned > 32 * 1024 * 1024) { truncated = true; break; }
          const needle = args.ignore_case ? args.pattern.toLowerCase() : args.pattern;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (!(args.ignore_case ? lines[i].toLowerCase() : lines[i]).includes(needle)) continue;
            const match = { file: displayPath(file), line: i + 1, text: lines[i].slice(0, 300) };
            matches.push(match); size += Buffer.byteLength(JSON.stringify(match));
            if (matches.length >= 100 || size >= 12000) { truncated = true; break; }
          }
        }
        if (matches.length >= 100 || size >= 12000) { truncated = true; break; }
      }
      return { matches, truncated };
    }
    if (name === "Edit" || name === "Write") {
      await switchToReview();
      const file = resolve(args.file_path);
      const before = fs.existsSync(file) ? read(file) : null;
      if (!seen.has(file)) seen.set(file, seen.get(path.join(project, relativeToProject(args.file_path))));
      if (before !== null && seen.get(file) !== before) throw new Error("Read the current file before changing it; it is unread or has changed.");
      if (name === "Write" && typeof args.content !== "string" || name === "Edit" && (typeof args.old_string !== "string" || typeof args.new_string !== "string")) throw new Error("File contents must be strings.");
      const input = { ...args, file_path: file };
      const change = approval.change(name, input, read);
      if (change.error) throw new Error(change.error);
      if (Buffer.byteLength(change.after) > MAX_FILE) throw new Error("File exceeds the 2 MB limit.");
      if (!reviewAfter) await permission(name, input);
      active(); resolve(args.file_path);
      const current = fs.existsSync(file) ? read(file) : null;
      if (current !== before) throw new Error("File changed while waiting for review; read it again.");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, change.after);
      const relative=path.normalize(relativeToProject(args.file_path));
      changedFiles.set(relative.toLowerCase(),relative);
      if (!written.has(file)) written.set(file, before);
      seen.set(file, change.after);
      return { file_path: file, changed: true, review: reviewAfter ? "pending after this turn" : "approved" };
    }
    if (name === "Bash") {
      if (typeof args.command !== "string" || !args.command.trim()) throw new Error("A command is required.");
      const location = commandLocation(args);
      const unapplied = location.cwd !== root && pendingChanges ? (await pendingChanges()).map(change => change.file) : [];
      if (location.purpose === "build" && location.cwd === project && unapplied.length)
        throw new Error("The project build would omit unapplied working-copy edits. Finish this turn so VERTEX can show Review, then build the project after Apply. Pending files: " + unapplied.join(", "));
      const details = { ...args, ...location, ...(unapplied.length ? { unapplied_changes: unapplied, warning: "This command runs outside the working copy and does not include its unapplied changes." } : {}) };
      if (location.cwd !== root || !reviewAfter || !options.shellWithoutAsking) await permission(name, details);
      active();
      const projectDiff = reviewAfter && root !== project ? require("./project-command-diff") : null;
      let projectBefore, projectSnapshotError;
      if (projectDiff) {
        try { projectBefore = await projectDiff.snapshot(project); }
        catch (error) { projectSnapshotError = error.message; }
      }
      const win = process.platform === "win32";
      const commandResult = await new Promise(resolveCommand => {
        let failure;
        const capture = commandOutput.collect({ directory: outputDirectory });
        const output = vscode.window?.createOutputChannel ? require("./build-runner").output(vscode) : null;
        output?.show(true);
        output?.appendLine("> " + args.command + "    (" + location.cwd + ")");
        const child = spawn(win ? "powershell.exe" : "/bin/sh",
        win ? ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $OutputEncoding = [Console]::OutputEncoding; " + args.command] : ["-lc", args.command],
        { cwd: location.cwd, env: require("./assistant").nodeEnv(), windowsHide: true, timeout: Math.min(900000, Math.max(1000, Number(args.timeout) || (location.purpose === "build" ? 900000 : 120000))),
          signal: controller.signal });
        child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", text => { capture.write("stdout", text); output?.append(text); });
        child.stderr?.on("data", text => { capture.write("stderr", text); output?.append(text); });
        child.on("error", error => { failure = error; });
        child.on("close", (code, signal) => {
          output?.appendLine("[exit " + code + (signal ? ", " + signal : "") + "]");
          const captured = capture.finish();
          resolveCommand({ ...location, ...(unapplied.length ? { unapplied_changes: unapplied, warning: details.warning } : {}),
            code: code === null ? -1 : code, ...(failure?.code ? { error_code: failure.code } : {}), ...captured,
            ...(output ? { output_channel: "VERTEX Build" } : {}),
            ...(signal ? { signal } : {}), ...(failure ? { error: failure.message.slice(0, 2000) } : {}),
            ...(win && /InvalidEndOfLine/.test(captured.stderr) ? { hint: "Windows PowerShell 5.1 does not support && or ||. The project folder is already cwd; retry the single command directly, e.g. git log -1 --oneline. Git did not run. Do not substitute a changelog for Git output." } : {}) });
        });
      });
      if (projectBefore) {
        try {
          const changed = projectDiff.show(vscode, project, projectBefore, await projectDiff.snapshot(project));
          if (changed.length) { commandResult.project_changed_files = changed; commandResult.project_diff = "Shown in Bash changes in project; these changes are already in the real project and need no Apply."; }
        } catch (error) { projectSnapshotError = error.message; }
      }
      if (projectSnapshotError) commandResult.project_diff_error = "Could not verify changes in the real project: " + projectSnapshotError;
      if(reviewAfter && pendingChanges && location.cwd===root){
        for(const change of await pendingChanges()){
          const relative=path.normalize(change.file);
          changedFiles.set(relative.toLowerCase(),relative);
        }
      }
      return compactVerifiedVsix(commandResult, project);
    }
    throw new Error("Unknown local tool: " + name);
  }
  return {
    schemas,
    changes() { return [...written].map(([file, before]) => ({ file: path.relative(root, file).replace(/\\/g, "/"), before: before || "", after: read(file), status: before === null ? "added" : "changed" })); },
    dispose() { controller.abort(); approve.dispose(); },
    closeApprovals() { approvalsClosed = true; return approve.cancelPending(); },
    settled() { return serial; },
    pending() { return outstanding; },
    completed() { return completed.slice(); },
    call(name, args = {}) {
      outstanding++;
      const run = serial.then(async () => {
        active();
        if(name==="Bash"&&inPlaceSed(args.command)&&!reviewAfter&&!options.prepareEdit)
          throw new Error("In-place shell edits need a review copy. Use Edit or Write for this folder.");
        if((name==="Edit"||name==="Write"||name==="Bash"&&inPlaceSed(args.command))&&options.prepareEdit)await switchToReview();
        if(name==="Bash"&&inPlaceSed(args.command)&&reviewAfter){
          const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
          let command=args.command;
          for(const [from,to] of [[project,root],[project.replace(/\\/g,"/"),root.replace(/\\/g,"/")]])
            command=command.replace(new RegExp(escape(from),process.platform==="win32"?"gi":"g"),to);
          args={...args,command,target:"working_copy",directory:undefined};
        }
        const id = "local_" + crypto.randomBytes(8).toString("hex");
        const input = { ...args, ...(name === "Bash" ? commandLocation(args) : {}) };
        for (const key of ["file_path", "path"]) if (input[key] && !(name === "Read" && commandOutput.owns(input[key]))) input[key] = resolve(input[key], name === "Read" || name === "Glob" || name === "Grep");
        if (options.onStep) options.onStep({ kind: "use", id, name, input, provider: "local" });
        try {
          const result = await execute(name, args);
          if (name === "Bash") { completed.push({ command: args.command, result }); if (completed.length > 8) completed.shift(); }
          if (options.onStep) options.onStep({ kind: "result", id, name, content: name === "Read" ? result.text : JSON.stringify(result), is_error: name === "Bash" && result.code !== 0, provider: "local" });
          return result;
        } catch (error) {
          if (options.onStep) options.onStep({ kind: "result", id, name, content: error.message, is_error: true, provider: "local" });
          throw error;
        }
      });
      const finished = run.finally(() => { outstanding--; });
      serial = finished.catch(() => {});
      return finished;
    }
  };
}


// Reuse the selected source tree: inherited root rules come before nearer directory rules.
// Oversized/unreadable rules are explicit, never silently presented as fully read.
function projectRules(cwd, boundary = cwd) {
  const root = path.resolve(boundary), current = path.resolve(cwd), relative = path.relative(root, current);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Rule directory is outside the source tree.");
  const directories = [root];
  for (const part of relative.split(path.sep).filter(Boolean)) directories.push(path.join(directories.at(-1), part));
  const rules = [];
  for (const directory of directories) for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(directory, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { rules.push({ path: file, complete: false, error: "Not a regular rule file; inspect before editing." }); continue; }
      if (stat.size > 65536) { rules.push({ path: file, complete: false, bytes: stat.size, error: "Read the complete file in pages before editing; it was not embedded." }); continue; }
      rules.push({ path: file, complete: true, text: fs.readFileSync(file, "utf8") });
    } catch (error) { if (error.code !== "ENOENT") rules.push({ path: file, complete: false, error: error.message }); }
  }
  return rules;
}

// Report the extension host, which also executes VERTEX local tools (including remote VS Code hosts).
function environment(cwd) {
  const os = require("node:os");
  const win = process.platform === "win32";
  return "Execution environment (actual extension host):\n" + JSON.stringify({
    platform: process.platform, os: os.type(), release: os.release(), architecture: process.arch,
    localToolShell: win ? "Windows PowerShell 5.1 (powershell.exe), not Bash or PowerShell 7" : "/bin/sh (not necessarily Bash or the user's interactive shell)",
    workingDirectory: cwd || null, cwdAlreadySelected: Boolean(cwd),
    extensionNodeVersion: process.version,
    dependencyStatus: "External git, node, python, Java and build tools are not verified. Check the required executable and version before relying on it. The extension's Node runtime does not imply node is on PATH.",
    shellRules: win ? "Use native Windows paths and one command per call. No &&, || or /c/... paths. Invoke git directly from cwd." : "Use POSIX sh syntax and quote paths; do not assume Bash features.",
    nativeProviderShell: "CLI providers may use their own shell; verify it before applying shell-specific syntax."
  }) + "\n\n";
}

module.exports = { schemas, create, environment, projectRules, glob, compactVerifiedVsix };
