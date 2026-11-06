"use strict";

// Running the assistant a person already has - Claude Code or Codex - for one
// request made in a VERTEX window, with no window of its own.
//
// VERTEX starts the copy that came with the assistant's VS Code extension: the
// version and the login the person already uses in the editor, updated along
// with it. It brings no agent and no model; it brings the tools and the rules.
//
// A run is shut in on purpose. It starts in an empty temporary folder, sees
// no MCP server but the endpoint of the window that asked and no built-in
// tool - no shell, no files - and answers in the shape that window's schema
// fixes. The person's other MCP servers are not loaded: some of them write to
// SAP or read table contents, and neither belongs in a request to open a view.

const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const TIMEOUT = 180000;
const SERVER = "vertex";
const TOKEN_VAR = "VERTEX_WINDOW_TOKEN";

const ASSISTANTS = {
  claude: { label: "Claude Code", extension: "anthropic.claude-code" },
  codex: { label: "Codex", extension: "openai.chatgpt" },
  // EPAM CodeMie: Claude Code run through the CodeMie CLI's codemie-claude, which signs in with the
  // profile codemie setup made and passes Claude Code's own options through.
  codemie: { label: "CodeMie CLI", extension: "" }
};
// CodeMie runs Claude Code, so it is asked and answers as Claude does.
const claudeLike = id => id === "claude" || id === "codemie";
// Claude Code's own tools allowed in a working folder.
const FOLDER_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];
const FOLDER_READ_TOOLS = ["Read", "Grep", "Glob"];
// The effort levels each command-line assistant takes (Claude Code's --effort, Codex's model_reasoning_effort);
// CodeMie runs Claude Code and passes --effort on.
const EFFORTS = { claude: ["low", "medium", "high", "xhigh", "max"], codex: ["minimal", "low", "medium", "high"] };
const APPROVE_SERVER = "vertex_approve";

// The models a Claude subscription offers, by full id - the same ids the
// Anthropic API lists; Claude Code reports no list of its own. The newest of
// each family is on unless Config models says otherwise, and the weakest comes
// first, so it is what a window picks unless told otherwise. When a new model
// comes out, add it here.
const CLAUDE_VERSIONS = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", on: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", on: true },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", on: true },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", on: true },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-fable-5", label: "Claude Fable 5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" }
].map(function (m) { return { id: m.id, label: m.label, on: !!m.on }; });

// Where each platform's Codex lives inside its extension: the folder whose
// codex-package.json names this target.
const TRIPLES = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin"
};

/* ---------- finding the assistant ---------- */

function describe(id) {
  const assistant = ASSISTANTS[id];
  if (!assistant) {
    throw new Error("VERTEX knows no assistant called " + id + ".");
  }
  return assistant;
}

/** The executable inside the assistant's extension, or an error saying why not. */
function locate(id, extensionPath) {
  const assistant = describe(id);
  if (id === "codemie") { return codemieBinary("codemie-claude"); }
  if (!extensionPath) {
    if (id === "claude" || id === "codex") {
      const name = process.platform === "win32" ? id + ".exe" : id;
      const folders = (process.env.PATH || process.env.Path || "").split(path.delimiter)
        .concat([path.join(os.homedir(), ".local", "bin")]);
      if (id === "codex" && process.platform === "win32" && process.env.APPDATA) {
        folders.push(path.join(process.env.APPDATA, "npm"));
      }
      if (id === "codex" && process.platform === "darwin") {
        folders.push(path.join("/Applications", "ChatGPT.app", "Contents", "Resources",
          "codex-cli", "CodexCLI.app", "Contents", "MacOS"));
      }
      for (const folder of folders) {
        if (!folder) { continue; }
        const root = folder.replace(/^"|"$/g, "");
        const candidates = [path.join(root, name)];
        if (id === "codex") {
          const triple = TRIPLES[process.platform + "-" + process.arch];
          const platformPackage = "codex-" + ({ win32: "win32", darwin: "darwin", linux: "linux" }[process.platform] || process.platform) + "-" + process.arch;
          for (const modules of [path.join(root, "node_modules"), path.join(root, "..", "lib", "node_modules")]) {
            for (const packageRoot of [path.join(modules, "@openai", "codex"),
              path.join(modules, "@openai", platformPackage),
              path.join(modules, "@openai", "codex", "node_modules", "@openai", platformPackage)]) {
              if (triple) {
                candidates.push(path.join(packageRoot, "vendor", triple, "codex", name),
                  path.join(packageRoot, "vendor", triple, "bin", name));
              }
            }
          }
        }
        for (const candidate of candidates) {
        try {
          if (fs.statSync(candidate).isFile()) {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
          }
        } catch (_) { /* Try the next native CLI location. */ }
        }
      }
    }
    throw new Error(assistant.label + " is not installed in this VS Code (extension "
                    + assistant.extension + "). " + (id === "claude"
                      ? "No native Claude CLI was found in PATH or ~/.local/bin either. Install Claude Code and restart VS Code."
                      : "No native Codex CLI was found in PATH or its npm installation either. Install Codex CLI and restart VS Code."));
  }
  const file = id === "claude" ? claudeBinary(extensionPath) : codexBinary(extensionPath);
  if (!fs.existsSync(file)) {
    throw new Error("The " + assistant.label + " extension is at " + extensionPath
                    + ", but it has no executable at " + file
                    + ". Its layout may have changed in this version.");
  }
  return file;
}

function sources(id, extensionPath) {
  let bundled = "", cli = "";
  try { if (extensionPath) { bundled = locate(id, extensionPath); } } catch (_) { /* Try CLI. */ }
  try { cli = locate(id, ""); } catch (_) { /* Try extension. */ }
  return { extension: bundled, cli };
}

/** Pick an assistant executable once when both installations are available. */
async function resolveAssistant(vscode, id, extensionPath) {
  const { extension: bundled, cli } = sources(id, extensionPath);
  if (!bundled && !cli) { return locate(id, extensionPath); }
  if (!bundled || !cli || bundled === cli) { return bundled || cli; }
  const settings = vscode.workspace.getConfiguration("vertex.ai");
  const sourceSetting = id + "Source";
  const label = describe(id).label;
  let source = settings.get(sourceSetting, "ask");
  if (source !== "extension" && source !== "cli") {
    const picked = await vscode.window.showQuickPick([
      { label: label + " VS Code extension", description: bundled, source: "extension" },
      { label: label + " CLI", description: cli, source: "cli" }
    ], { title: "Which " + label + " should VERTEX use?", placeHolder: "Choose an installation for the VERTEX assistant" });
    if (!picked) { throw new Error(label + " installation was not selected."); }
    source = picked.source;
    await settings.update(sourceSetting, source, vscode.ConfigurationTarget.Global);
  }
  return source === "extension" ? bundled : cli;
}

async function resolveClaude(vscode, extensionPath) {
  return resolveAssistant(vscode, "claude", extensionPath);
}

/* The CodeMie CLI is an npm package: its commands lie in npm's global bin - on PATH, or in nvm's
   folders when VS Code was started from the Dock without the shell's PATH. On Windows npm's .cmd
   shim cannot be spawned without a shell, so the package's own script is run with node. */
function codemieFolders() {
  const home = os.homedir();
  const folders = (process.env.PATH || process.env.Path || "").split(path.delimiter)
    .concat([path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"]);
  const nvm = path.join(process.env.NVM_DIR || path.join(home, ".nvm"), "versions", "node");
  try {
    fs.readdirSync(nvm).sort().reverse().forEach(version => folders.push(path.join(nvm, version, "bin")));
  } catch (_) { /* No nvm. */ }
  if (process.platform === "win32" && process.env.APPDATA) { folders.push(path.join(process.env.APPDATA, "npm")); }
  return folders.filter(Boolean).map(folder => folder.replace(/^"|"$/g, ""));
}

function codemieBinary(command) {
  for (const root of codemieFolders()) {
    const candidate = process.platform === "win32"
      ? path.join(root, "node_modules", "@codemieai", "code", "bin", command === "codemie" ? "codemie.js" : command + ".js")
      : path.join(root, command);
    try {
      if (fs.statSync(candidate).isFile()) {
        if (process.platform !== "win32") { fs.accessSync(candidate, fs.constants.X_OK); }
        return candidate;
      }
    } catch (_) { /* Try the next folder. */ }
  }
  throw new Error("The CodeMie CLI was not found in PATH, ~/.nvm or npm's global folder. Install it with "
                  + "npm install -g @codemieai/code, run codemie setup, and restart VS Code.");
}

// codemie models list prints a table: a header, a rule of ─, then a model per line, its id first.
function codemieModels(text) {
  const rows = String(text || "").replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/);
  const rule = rows.findIndex(line => /^─{10,}/.test(line.trim()));
  if (rule < 0) { return []; }
  const listed = [];
  // Columns are padded with two spaces or more: ID, NAME, TYPE, DESCRIPTION. A row of another type
  // than model (an embedding) is left out.
  for (const line of rows.slice(rule + 1)) {
    const cols = line.trim().split(/\s{2,}/);
    if (!cols[0]) { break; }
    if (cols[2] && cols[2] !== "model") { continue; }
    if (!listed.some(m => m.id === cols[0])) { listed.push({ id: cols[0], label: cols[1] || cols[0] }); }
  }
  return listed;
}

/* CodeMie's profiles, from its global configuration: their names and the one active in the CLI.
   VERTEX may use another than the active one (vertex.ai.codemieProfile); empty is the active one. */
function codemieProfiles(home) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home || os.homedir(), ".codemie", "codemie-cli.config.json"), "utf8"));
    return { names: Object.keys(config.profiles || {}).sort(), active: String(config.activeProfile || "") };
  } catch (_) { return { names: [], active: "" }; }
}
// A chosen profile that CodeMie no longer has falls back to the active one.
function profileFor(vscode, id, home) {
  if (id !== "codemie") { return ""; }
  const chosen = String(vscode.workspace.getConfiguration("vertex.ai").get("codemieProfile", "") || "").trim();
  return chosen && codemieProfiles(home).names.includes(chosen) ? chosen : "";
}

// What a provider's assistant runs: the installation chosen for Claude Code or Codex, CodeMie's
// command, nothing for a provider VERTEX asks itself.
async function executableFor(vscode, id, extensionPath) {
  if (id === "claude" || id === "codex") { return resolveAssistant(vscode, id, extensionPath); }
  if (id === "codemie") { return locate("codemie", ""); }
  return undefined;
}

function claudeBinary(root) {
  return path.join(root, "resources", "native-binary",
                   process.platform === "win32" ? "claude.exe" : "claude");
}

function codexBinary(root) {
  const bin = path.join(root, "bin");
  const target = TRIPLES[process.platform + "-" + process.arch] || "(unknown target)";
  let folders = [];
  try { folders = fs.readdirSync(bin); } catch (e) { folders = []; }
  for (const folder of folders) {
    try {
      const described = JSON.parse(
        fs.readFileSync(path.join(bin, folder, "codex-package.json"), "utf8"));
      if (described.target === target) {
        return path.join(bin, folder, process.platform === "win32" ? "codex.exe" : "codex");
      }
    } catch (e) {
      // Not a platform folder.
    }
  }
  return path.join(bin, "(no folder for " + target + ")");
}

/* ---------- models ---------- */

/** What the model list offers: Claude's known versions, or Codex's own catalog. */
async function models(options) {
  const id = options.assistant;
  describe(id);
  if (id === "claude") {
    if (!options.executable) { locate(id, options.extensionPath); }
    return CLAUDE_VERSIONS;
  }
  if (id === "codemie") {
    // The models of the CodeMie profile; its own default first, the one codemie setup chose.
    const file = options.executable || locate(id, "");
    const lister = path.join(path.dirname(file), process.platform === "win32" ? "codemie.js" : "codemie");
    // models list has no --profile: it takes the activeProfile of a .codemie configuration in the
    // folder it runs in, which may name a global profile.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-codemie-"));
    let result;
    try {
      if (options.profile) {
        fs.mkdirSync(path.join(dir, ".codemie"));
        fs.writeFileSync(path.join(dir, ".codemie", "codemie-cli.config.json"),
          JSON.stringify({ version: 2, activeProfile: options.profile, profiles: {} }));
      }
      result = await collect(options.spawn, lister, ["models", "list"],
                             { cwd: dir, timeout: 60000, input: "", env: codemieEnv(file) });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    if (result.timedOut || result.code !== 0) {
      throw new Error("CodeMie did not list its models: "
                      + (result.timedOut ? "no answer within a minute." : tail(result.stderr || result.stdout))
                      + (options.profile ? " Profile: " + options.profile + "." : "") + " Run codemie setup in a terminal.");
    }
    return [{ id: "", label: "CodeMie default" }].concat(codemieModels(result.stdout));
  }

  const file = options.executable || locate(id, options.extensionPath);
  const result = await collect(options.spawn, file, ["debug", "models"],
                               { timeout: 60000, input: "" });
  if (result.timedOut || result.code !== 0) {
    throw new Error("Codex did not list its models: "
                    + (result.timedOut ? "no answer within a minute." : tail(result.stderr)));
  }
  let catalog;
  try {
    catalog = JSON.parse(result.stdout).models || [];
  } catch (e) {
    throw new Error("Codex listed its models in a form VERTEX cannot read: "
                    + result.stdout.substring(0, 200));
  }

  // The catalog's own order puts the most capable first; reversed, the weakest
  // comes first and is what a window picks unless told otherwise.
  const listed = catalog
    .filter(function (m) { return m.visibility === "list"; })
    .sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); })
    .map(function (m) { return { id: m.slug, label: m.display_name || m.slug }; });

  // A run ignores the person's config.toml, so the model it names has to be
  // offered explicitly: under its catalog name when the catalog has it, by
  // its id at the end when it does not.
  const configured = configuredCodexModel(options.codexHome);
  if (!configured) {
    return listed.concat([{ id: "", label: "Codex default" }]);
  }
  return listed.some(function (m) { return m.id === configured; })
    ? listed
    : listed.concat([{ id: configured, label: configured }]);
}

/* A Claude model named by its full id - an older version the aliases no longer
   reach. Claude Code has no list to check it against, so one short request is
   run with it: the model that answers is the proof, and what is shown. */
async function probe(options) {
  describe(options.assistant);
  if (options.assistant !== "claude") {
    throw new Error("Only a Claude model is named by version; Codex lists its own.");
  }
  const id = String(options.model || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-\[\]]*$/.test(id)) {
    throw new Error("\"" + id + "\" is not a model id. Write it as Claude names it, for example claude-opus-5.");
  }
  const file = options.executable || locate("claude", options.extensionPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-probe-"));
  try {
    const env = Object.assign({}, process.env,
      { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
    const result = await collect(options.spawn, file,
      ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config",
       "--no-session-persistence", "--model", id],
      { cwd: dir, env: env, input: "Reply with the word OK.", timeout: 60000 });
    if (options.assistant === "claude" && options.onProviderResponse) {
      let response = resultEvent;
      if (!streaming) { try { response = JSON.parse(result.stdout); } catch (_) { /* No JSON result. */ } }
      if (response) options.onProviderResponse({ provider: "claude", scope: "cli_run", response });
    }
    if (result.timedOut) { throw new Error("Claude Code did not answer with " + id + " within a minute."); }
    let answer;
    try { answer = JSON.parse(result.stdout); } catch (e) { answer = null; }
    if (!answer || answer.is_error || answer.subtype !== "success") {
      throw new Error("Claude Code did not accept the model " + id + ": "
                      + (answer && answer.result || tail(result.stderr || result.stdout)));
    }
    const used = modelsUsed(answer.modelUsage);
    return { id: id, label: used && used !== id ? id + " (" + used + ")" : id };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* The top-level model of ~/.codex/config.toml: the lines before its first
   table. Nothing else of that file is read. */
function configuredCodexModel(codexHome) {
  const home = codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  let text = "";
  try { text = fs.readFileSync(path.join(home, "config.toml"), "utf8"); } catch (e) { return ""; }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) { break; }
    const found = /^\s*model\s*=\s*"([^"]+)"/.exec(line);
    if (found) { return found[1]; }
  }
  return "";
}

/* ---------- one run ---------- */

/**
 * Asks the assistant and returns { plan, model }, or throws with what went
 * wrong in words a person can act on.
 * options: assistant, model, extensionPath, url, token, instructions, prompt,
 * schema, tools (names on the endpoint), spawn and timeout for tests.
 */
async function ask(options) {
  const assistant = describe(options.assistant);
  const file = options.executable || locate(options.assistant, options.extensionPath);
  if ((options.images || []).length && !claudeLike(options.assistant)) {
    throw new Error("Screenshots are sent only to Claude Code and EPAM CodeMie; nothing was sent.");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-window-"));
  try {
    const command = claudeLike(options.assistant)
      ? claudeCommand(options, dir)
      : codexCommand(options, dir);
    // codemie-claude takes --profile itself and passes the rest to Claude Code.
    if (options.assistant === "codemie" && options.profile) { command.args.unshift("--profile", options.profile); }
    const env = options.assistant === "codemie" ? codemieEnv(file) : Object.assign({}, process.env);
    // The token reaches the child through its environment only: the files in
    // the folder name the variable, never the value.
    env[TOKEN_VAR] = options.token;
    // In a working folder the folder's own CLAUDE.md is wanted; Claude Code
    // cannot load it without the user-level one, so both load there.
    if (claudeLike(options.assistant) && options.workDir) {
      if (!options.personalInstructions) env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
    } else if (claudeLike(options.assistant) && !options.personalInstructions) {
      // No personal CLAUDE.md or auto-memory: they would travel with every SAP
      // request, be repeated in answers and steer a tool they were not written
      // for. --setting-sources does not exclude CLAUDE.md, --safe-mode drops
      // the MCP server too, and --bare refuses the subscription login.
      env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
      env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
    }
    const timeout = options.timeout || TIMEOUT;
    const streaming = claudeLike(options.assistant) && typeof options.onProgress === "function";
    let pending = "", resultEvent = null, generated = "", structured = "", thinking = "", lastAnswer = "", lastStatus = "";
    const toolBlocks = new Map(), steps = new Map(), thinkingBlocks = new Map(), pendingThinking = [];
    const flushThinking = () => { while (pendingThinking.length) { const note = pendingThinking.shift(); if (typeof options.onStep === "function") options.onStep(note); } };
    let thinkingCount = 0;
    const emitAnswer = answer => {
      if (answer && answer !== lastAnswer && !lastAnswer.startsWith(answer)) {
        lastAnswer = answer;
        options.onProgress({ answer });
      }
    };
    const toolStatus = block => {
      let args = block.input;
      try { if (block.json) args = JSON.parse(block.json); } catch (_) { /* Wait for the complete arguments. */ }
      const name = String(block.name || "").replace(/^mcp__vertex__/, "");
      const object = args && typeof args === "object"
        ? [args.object_type, args.object_name, args.method_name].filter(Boolean).join(" ") : "";
      const status = "Using " + (name || "a SAP tool") + (object ? ": " + object : "") + "…";
      if (status !== lastStatus) { lastStatus = status; options.onProgress({ status }); }
    };
    const onData = streaming ? function (chunk) {
      pending += chunk;
      let end;
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        let event;
        try { event = JSON.parse(line); } catch (_) { continue; }
        if (event.type === "result") { resultEvent = event; }
        if (event.type === "assistant" && event.message && options.onProviderResponse) {
          options.onProviderResponse({ provider: "claude", scope: "model_response", response: event.message });
        }
        if (event.type === "assistant" || event.type === "result") flushThinking();
        // Claude Code's own steps - Read, Edit, Bash and the rest - for the session log: the call, then its result.
        // The SAP tools are logged where VERTEX runs them, and the answer's StructuredOutput is the answer itself.
        if (typeof options.onStep === "function" && (event.type === "assistant" || event.type === "user")
          && event.message && Array.isArray(event.message.content)) {
          for (const [index, block] of event.message.content.entries()) {
            // What Claude says or thinks between its steps - the "Claude reasoning" the panel shows as it comes.
            // Thinking comes from the stream's deltas instead (the finished message holds it empty).
            if (event.type === "assistant" && block && block.type === "thinking") continue;
            if (event.type === "assistant" && block && block.type === "text") {
              const text = String(block.text || "").trim();
              if (text) options.onStep({ kind: "note", id: String(event.message.id || "") + ":" + index, note: "text", text });
              continue;
            }
            if (block && block.type === "tool_use" && !/^mcp__vertex|^StructuredOutput$/.test(String(block.name || ""))) {
              steps.set(block.id, block.name);
              options.onStep({ kind: "use", id: block.id, name: block.name, input: block.input || {} });
            } else if (block && block.type === "tool_result" && steps.has(block.tool_use_id)) {
              options.onStep({ kind: "result", id: block.tool_use_id, name: steps.get(block.tool_use_id),
                is_error: block.is_error === true, content: block.content });
            }
          }
        }
        if (event.type !== "stream_event") { continue; }
        const inner = event.event || {};
        if (inner.type === "message_start" && inner.message?.role === "assistant") {
          generated = ""; structured = "";
        } else if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
          generated += inner.delta.text || "";
          // Claude Code 2.1 streams human-readable text before its structured
          // JSON result. Older CLI builds may stream the JSON directly.
          const answer = /^\s*\{\s*"answer"\s*:/.test(generated)
            ? partialClaudeAnswer(generated) : generated;
          emitAnswer(answer);
        } else if (inner.type === "content_block_delta" && inner.delta?.type === "input_json_delta") {
          const block = toolBlocks.get(inner.index);
          if (block) {
            block.json += inner.delta.partial_json || "";
            toolStatus(block);
          } else {
            structured += inner.delta.partial_json || "";
            emitAnswer(partialClaudeAnswer(structured));
          }
        } else if (inner.type === "content_block_delta" && inner.delta?.type === "thinking_delta") {
          const fragment = inner.delta.thinking || "";
          if (fragment) { thinking += fragment; options.onProgress({ thinking }); }
          // Claude Code's finished message carries its thinking empty: the log keeps the streamed text.
          if (fragment) thinkingBlocks.set(inner.index, (thinkingBlocks.get(inner.index) || "") + fragment);
          const status = fragment ? "Claude is thinking…" : "Claude is working…";
          if (lastStatus !== status) { lastStatus = status; options.onProgress({ status }); }
        } else if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use"
          && inner.content_block.name === "StructuredOutput") {
          // Claude Code's final answer is this tool's input: it streams as the answer, not as a tool in use.
          structured = "";
        } else if (inner.type === "content_block_start" && inner.content_block?.type === "tool_use") {
          const block = { name: inner.content_block.name, input: inner.content_block.input, json: "" };
          toolBlocks.set(inner.index, block);
          toolStatus(block);
        } else if (inner.type === "content_block_stop" && toolBlocks.has(inner.index)) {
          toolStatus(toolBlocks.get(inner.index));
          toolBlocks.delete(inner.index);
        } else if (inner.type === "content_block_stop" && thinkingBlocks.has(inner.index)) {
          const text = thinkingBlocks.get(inner.index).trim();
          thinkingBlocks.delete(inner.index);
          // Held until the message's model step is logged, so the thinking sits under its own step.
          if (text) pendingThinking.push({ kind: "note", id: "thinking:" + (++thinkingCount), note: "thinking", text });
        }
      }
    } : null;
    const result = await collect(options.spawn, file, command.args,
                                 { cwd: options.workDir || dir, env: env, input: command.input, timeout: timeout, onData });
    if (streaming && pending.trim()) {
      try { const last = JSON.parse(pending.trim()); if (last.type === "result") resultEvent = last; }
      catch (_) { /* An interrupted NDJSON line is not a completed result. */ }
    }
    if (claudeLike(options.assistant) && options.onProviderResponse) {
      let response = resultEvent;
      if (!streaming) { try { response = JSON.parse(result.stdout); } catch (_) { /* No JSON result. */ } }
      if (response) options.onProviderResponse({ provider: "claude", scope: "cli_run", response });
    }
    if (result.timedOut) {
      throw new Error(assistant.label + " did not answer within " + Math.round(timeout / 1000)
                      + " seconds and was stopped.");
    }
    return claudeLike(options.assistant)
      ? readClaude(streaming ? { ...result, stdout: resultEvent ? JSON.stringify(resultEvent) : "" } : result)
      : readCodex(result, command.answerFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function claudeCommand(options, dir) {
  const config = path.join(dir, "mcp.json");
  const servers = {};
  servers[SERVER] = {
    type: "http",
    url: options.url,
    headers: { Authorization: "Bearer ${" + TOKEN_VAR + "}" }
  };
  const listed = options.tools.length ? servers : {};
  if (options.workDir) {
    // Every edit, write and command in a working folder waits for the user.
    if (!options.approveUrl) throw new Error("A working folder needs the VERTEX approval address; nothing was run.");
    listed[APPROVE_SERVER] = { type: "http", url: options.approveUrl,
      headers: { Authorization: "Bearer ${" + TOKEN_VAR + "}" } };
  }
  fs.writeFileSync(config, JSON.stringify({ mcpServers: listed }));
  // The instructions run to tens of thousands of characters. Windows caps a command line at 32 767, and cmd -
  // through which CodeMie starts Claude Code on Windows - at 8 191, so they go in a file in the run's folder.
  const system = path.join(dir, "system-prompt.md");
  fs.writeFileSync(system, String(options.instructions || ""));

  const args = [
    "-p", "--output-format", options.onProgress ? "stream-json" : "json",
    "--json-schema", JSON.stringify(options.schema),
    "--system-prompt-file", system,
    // No built-in tool. For a visible method explanation there are no MCP
    // tools either: supplying a server would make the CLI run an agent loop
    // even though the compact source fragment already answers the question.
    // In a working folder (a local file of an open workspace folder) Claude
    // works on its files with its own tools, shell included.
    "--tools", options.workDir ? FOLDER_TOOLS.join(",") : "",
    "--strict-mcp-config", "--mcp-config", config,
    "--no-session-persistence"
  ];
  if (options.onProgress) { args.push("--verbose", "--include-partial-messages"); }
  if (options.workDir) {
    args.push("--permission-prompt-tool", "mcp__" + APPROVE_SERVER + "__" + require("./folder-approval").TOOL);
  }
  // Reading runs freely; Edit, Write and Bash are left to the approval tool. In a git working copy (reviewAfter)
  // edits and writes run freely too - they are reviewed when the answer is done - and only Bash asks.
  // shellWithoutAsking (a setting, off by default) lets Bash run in the working copy without asking as well.
  const allowed = (options.workDir ? (options.reviewAfter
    ? FOLDER_TOOLS.filter(t => t !== "Bash" || options.shellWithoutAsking === true) : FOLDER_READ_TOOLS) : [])
    .concat(options.tools.map(function (t) { return "mcp__" + SERVER + "__" + t; }));
  if (allowed.length) {
    args.push("--allowedTools", allowed.join(","));
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  // The effort level chosen on the panel; left out when not set, so a Claude Code without --effort still runs.
  if (EFFORTS.claude.includes(options.effort)) {
    args.push("--effort", options.effort);
  }
  const images = options.images || [];
  if (!images.length) return { args: args, input: options.prompt };
  // Screenshots travel inside the message: Claude Code reads one stream-json user message from stdin.
  if (!options.onProgress) throw new Error("Screenshots need the streaming chat; nothing was sent.");
  args.push("--input-format", "stream-json");
  const content = [{ type: "text", text: options.prompt }].concat(images.map(function (image) {
    return { type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } };
  }));
  return { args: args, input: JSON.stringify({ type: "user", message: { role: "user", content: content } }) + "\n" };
}

function codexCommand(options, dir) {
  const schema = path.join(dir, "schema.json");
  const answerFile = path.join(dir, "answer.json");
  fs.writeFileSync(schema, JSON.stringify(options.schema));

  const args = [
    "exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral",
    "-s", "read-only", "-C", dir,
    "--output-schema", schema, "-o", answerFile,
    // No shell and nothing a plugin or an app would add.
    "--disable", "shell_tool", "--disable", "unified_exec",
    "--disable", "plugins", "--disable", "apps"
  ];
  if (options.tools.length) {
    args.push("-c", "mcp_servers." + SERVER + ".url=" + options.url,
      "-c", "mcp_servers." + SERVER + ".bearer_token_env_var=" + TOKEN_VAR);
  }
  if (options.model) {
    args.push("-m", options.model);
  }
  // Codex's own name for the effort level chosen on the panel.
  if (EFFORTS.codex.includes(options.effort)) {
    args.push("-c", "model_reasoning_effort=" + options.effort);
  }
  // The instructions travel with the request: exec has no separate channel
  // for them once the person's own configuration is left out.
  args.push("-");
  return { args: args, input: options.instructions + "\n\n" + options.prompt, answerFile: answerFile };
}

function readClaude(result) {
  let answer;
  try {
    answer = JSON.parse(result.stdout);
  } catch (e) {
    throw new Error("Claude Code ended (exit " + result.code + ") without a readable answer: "
                    + tail(result.stderr || result.stdout));
  }
  const model = modelsUsed(answer.modelUsage);
  if (answer.is_error || answer.subtype !== "success") {
    throw named(new Error("Claude Code: " + (answer.result || answer.subtype || "the run failed.")), model);
  }
  if (!answer.structured_output || typeof answer.structured_output !== "object") {
    throw named(new Error("Claude Code answered without a plan"
                          + (answer.result ? ": " + answer.result : ".")), model);
  }
  const read = { plan: answer.structured_output, model: model, usage: totalUsage(answer) };
  // What Claude Code reckons the run cost, from the models' prices; CodeMie bills its project by it.
  if (typeof answer.total_cost_usd === "number" && isFinite(answer.total_cost_usd)) { read.cost = answer.total_cost_usd; }
  return read;
}

// Claude's structured output arrives as JSON text deltas. Only expose the
// answer string; navigation and unfinished JSON stay inside the transport.
function partialClaudeAnswer(text) {
  const field = /"answer"\s*:\s*"/.exec(text);
  if (!field) { return ""; }
  const start = field.index + field[0].length;
  let end = start, escaped = false;
  for (; end < text.length; end++) {
    const char = text[end];
    if (!escaped && char === '"') { break; }
    if (!escaped && char === "\\") { escaped = true; }
    else { escaped = false; }
  }
  let raw = text.slice(start, end);
  if (escaped) { raw = raw.slice(0, -1); }
  try { return JSON.parse('"' + raw + '"'); } catch (_) { return ""; }
}

/* The whole run's tokens: modelUsage covers every model that took part, usage
   only the main one. */
function totalUsage(answer) {
  const models = Object.values(answer.modelUsage || {});
  if (!models.length) { return answer.usage || null; }
  return models.reduce(function (sum, m) {
    sum.input_tokens += m.inputTokens || 0;
    sum.output_tokens += m.outputTokens || 0;
    sum.cache_read_input_tokens += m.cacheReadInputTokens || 0;
    sum.cache_creation_input_tokens += m.cacheCreationInputTokens || 0;
    return sum;
  }, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
}

/* Every model Claude Code reports for the run, the one that wrote most first.
   The report is keyed by model and promises no order, so its first entry was
   never evidence of which model answered. */
function modelsUsed(usage) {
  return Object.keys(usage || {})
    .sort(function (a, b) { return ((usage[b] || {}).outputTokens || 0) - ((usage[a] || {}).outputTokens || 0); })
    .join(", ");
}

function readCodex(result, answerFile) {
  const shown = /^model:\s*(\S+)/m.exec(result.stderr || "");
  const model = shown ? shown[1] : "";
  if (result.code !== 0) {
    throw named(new Error("Codex: " + codexError(result.stderr)), model);
  }
  let text = "";
  try { text = fs.readFileSync(answerFile, "utf8"); } catch (e) { text = ""; }
  if (!text.trim()) {
    throw named(new Error("Codex ended without an answer. " + tail(result.stderr)), model);
  }
  try {
    return { plan: JSON.parse(text), model: model };
  } catch (e) {
    throw named(new Error("Codex answered with something that is not a plan: "
                          + text.substring(0, 300)), model);
  }
}

/* The last ERROR line Codex wrote, with the provider's own sentence taken out
   of the JSON it is often wrapped in. */
function codexError(stderr) {
  const errors = String(stderr || "").split(/\r?\n/)
    .filter(function (line) { return line.indexOf("ERROR:") === 0; });
  if (errors.length === 0) {
    return tail(stderr);
  }
  const last = errors[errors.length - 1].substring(6).trim();
  try {
    const parsed = JSON.parse(last);
    if (parsed && parsed.error && parsed.error.message) {
      return parsed.error.message;
    }
  } catch (e) {
    // Plain text, as the usage limit is.
  }
  return last;
}

/* ---------- processes ---------- */

// The CodeMie CLI's scripts start with #!/usr/bin/env node and run claude: their folder and
// Claude Code's go first on PATH, for a VS Code started without the shell's PATH.
function codemieEnv(file, base, platform = process.platform) {
  const env = Object.assign({}, base || process.env);
  const key = Object.keys(env).find(k => k.toUpperCase() === "PATH") || "PATH";
  // CodeMie calls its own commands by name. On Windows FILE is the package's bin\codemie.js; that folder holds
  // only .js files, and with .JS in PATHEXT a name found there opens as a document ("choose an app to open this
  // .js file", or a hidden wait in Eclipse). The folder to put first is npm's, four levels up
  // (<npm>\node_modules\@codemieai\code\bin), where codemie.cmd and its siblings are.
  const folder = platform === "win32" && /\.js$/i.test(file)
    ? path.win32.resolve(path.win32.dirname(file), "..", "..", "..", "..") : path.dirname(file);
  env[key] = [folder, path.join(os.homedir(), ".local", "bin"), env[key] || ""].join(platform === "win32" ? ";" : ":");
  return env;
}

function collect(spawn, file, args, options) {
  return new Promise(function (resolve) {
    let child;
    // A script (CodeMie on Windows) is run with node.
    if (/\.js$/i.test(file)) { args = [file].concat(args); file = "node"; }
    try {
      child = (spawn || childProcess.spawn)(file, args, {
        cwd: options.cwd, env: options.env, windowsHide: true
      });
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: e.message, timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(function () {
      timedOut = true;
      child.kill();
    }, options.timeout);
    const finish = function (code, error) {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      resolve({ code: code, stdout: stdout, stderr: error ? error.message : stderr, timedOut: timedOut });
    };
    child.stdout.on("data", function (d) {
      stdout += d;
      if (options.onData) { options.onData(String(d)); }
    });
    child.stderr.on("data", function (d) { stderr += d; });
    child.on("error", function (e) { finish(-1, e); });
    child.on("close", function (code) { finish(code); });
    child.stdin.on("error", function () { /* the child may exit before reading */ });
    child.stdin.end(options.input || "");
  });
}

function tail(text) {
  const s = String(text || "").trim();
  return s.length > 600 ? "..." + s.substring(s.length - 600) : s;
}

function named(error, model) {
  error.model = model;
  return error;
}

exports.ASSISTANTS = ASSISTANTS;
exports.TRIPLES = TRIPLES;
exports.TIMEOUT = TIMEOUT;
exports.locate = locate;
exports.sources = sources;
exports.resolveClaude = resolveClaude;
exports.resolveAssistant = resolveAssistant;
exports.executableFor = executableFor;
exports.codemieModels = codemieModels;
exports.codemieProfiles = codemieProfiles;
exports.profileFor = profileFor;
exports.models = models;
exports.probe = probe;
exports.CLAUDE_VERSIONS = CLAUDE_VERSIONS;
exports.ask = ask;
exports.configuredCodexModel = configuredCodexModel;
exports.codexError = codexError;

exports.codemieEnv = codemieEnv;

exports.EFFORTS = EFFORTS;
