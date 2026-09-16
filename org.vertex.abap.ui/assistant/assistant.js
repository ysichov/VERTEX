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
  codex: { label: "Codex", extension: "openai.chatgpt" }
};

// Claude Code reports no list of models, but it takes aliases that always mean
// the newest of their family - so this list does not go stale. The weakest
// comes first, so it is what a window picks unless told otherwise. Empty is
// the model Claude Code's own settings choose.
const CLAUDE_MODELS = [
  { id: "haiku", label: "haiku" },
  { id: "sonnet", label: "sonnet" },
  { id: "opus", label: "opus" },
  { id: "fable", label: "fable" },
  { id: "", label: "Claude Code default" }
];

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
  if (!extensionPath) {
    throw new Error(assistant.label + " is not installed in this VS Code (extension "
                    + assistant.extension + "). VERTEX runs the copy that comes with it.");
  }
  const file = id === "claude" ? claudeBinary(extensionPath) : codexBinary(extensionPath);
  if (!fs.existsSync(file)) {
    throw new Error("The " + assistant.label + " extension is at " + extensionPath
                    + ", but it has no executable at " + file
                    + ". Its layout may have changed in this version.");
  }
  return file;
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

/** What the model list offers: Claude Code's aliases, or Codex's own catalog. */
async function models(options) {
  const id = options.assistant;
  describe(id);
  if (id === "claude") {
    return CLAUDE_MODELS;
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
  // offered explicitly, marked as theirs, in its place in the list.
  const configured = configuredCodexModel(options.codexHome);
  if (!configured) {
    return listed.concat([{ id: "", label: "Codex default" }]);
  }
  const mark = { id: configured, label: configured + " (config.toml)" };
  return listed.some(function (m) { return m.id === configured; })
    ? listed.map(function (m) { return m.id === configured ? mark : m; })
    : listed.concat([mark]);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-window-"));
  try {
    const command = options.assistant === "claude"
      ? claudeCommand(options, dir)
      : codexCommand(options, dir);
    const env = Object.assign({}, process.env);
    // The token reaches the child through its environment only: the files in
    // the folder name the variable, never the value.
    env[TOKEN_VAR] = options.token;
    if (options.assistant === "claude" && !options.personalInstructions) {
      // No personal CLAUDE.md or auto-memory: they would travel with every SAP
      // request, be repeated in answers and steer a tool they were not written
      // for. --setting-sources does not exclude CLAUDE.md, --safe-mode drops
      // the MCP server too, and --bare refuses the subscription login.
      env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
      env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
    }
    const timeout = options.timeout || TIMEOUT;
    const result = await collect(options.spawn, file, command.args,
                                 { cwd: dir, env: env, input: command.input, timeout: timeout });
    if (result.timedOut) {
      throw new Error(assistant.label + " did not answer within " + Math.round(timeout / 1000)
                      + " seconds and was stopped.");
    }
    return options.assistant === "claude"
      ? readClaude(result)
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
  fs.writeFileSync(config, JSON.stringify({ mcpServers: servers }));

  const args = [
    "-p", "--output-format", "json",
    "--json-schema", JSON.stringify(options.schema),
    "--system-prompt", options.instructions,
    // No built-in tool at all, and no MCP server but this one.
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", config,
    "--allowedTools", options.tools.map(function (t) { return "mcp__" + SERVER + "__" + t; }).join(","),
    "--no-session-persistence"
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  return { args: args, input: options.prompt };
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
    "--disable", "plugins", "--disable", "apps",
    "-c", "mcp_servers." + SERVER + ".url=" + options.url,
    "-c", "mcp_servers." + SERVER + ".bearer_token_env_var=" + TOKEN_VAR
  ];
  if (options.model) {
    args.push("-m", options.model);
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
  return { plan: answer.structured_output, model: model, usage: totalUsage(answer) };
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

function collect(spawn, file, args, options) {
  return new Promise(function (resolve) {
    let child;
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
    child.stdout.on("data", function (d) { stdout += d; });
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
exports.models = models;
exports.ask = ask;
exports.configuredCodexModel = configuredCodexModel;
exports.codexError = codexError;
