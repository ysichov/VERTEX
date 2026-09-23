"use strict";

// Private pipe to the Eclipse host. SAP credentials never enter this process.
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assistant = require("./assistant");
const mcp = require("./mcp");
const sessionLog = require("./session-log");
const directSearch = require("./direct-search");
const encode = value => Buffer.from(value, "utf8").toString("base64");
const decode = value => Buffer.from(value, "base64").toString("utf8");

function executable(id, explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) { throw new Error("Assistant executable not found: " + explicit); }
    return explicit;
  }
  const direct = path.join(os.homedir(), ".local", "bin", id === "claude" ? "claude.exe" : "codex.exe");
  if (process.platform === "win32" && fs.existsSync(direct)) { return direct; }
  const root = path.join(os.homedir(), ".vscode", "extensions");
  let folders = [];
  try { folders = fs.readdirSync(root).filter(n => n.startsWith(assistant.ASSISTANTS[id].extension + "-")); } catch {}
  folders.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const folder of folders) {
    try { return assistant.locate(id, path.join(root, folder)); } catch {}
  }
  // Native CLI installations on PATH, without shell execution.
  const name = id + (process.platform === "win32" ? ".exe" : "");
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) { return file; }
  }
  throw new Error("Configure the " + id + " executable in Eclipse Preferences > VERTEX Assistant. Log in using that CLI first.");
}

const BRAINS = { selector: "./selector", versions: "./versions", chat: "./chat" };

async function run(request, fetch, api = assistant, open = async () => { throw new Error("This host cannot open objects."); }) {
  if (!Object.hasOwn(BRAINS, request.service)) { throw new Error("Unknown assistant service: " + request.service); }
  const brain = require(BRAINS[request.service]);
  if (request.call === "ask" && request.service === "chat" && directSearch.isObjectName(request.text)) {
    // No model for a bare object name: search the system and open it.
    const deps = { fetch, open, context: {} };
    const tool = async (name, args) => {
      const result = await brain.callTool(deps, name, args);
      const text = result.content.map(c => c.text).join("");
      if (result.isError) { throw new Error(text); }
      return JSON.parse(text);
    };
    const answer = await directSearch.answer(request.text, { system: request.project,
      search: args => tool("search_sap_objects", args), open: args => tool("open_sap_object", args) });
    return { call: "ask", model: "", usage: null, direct: true, plan: { answer } };
  }
  const options ={ assistant: request.assistant, executable: executable(request.assistant, request.executable) };
  if (request.call === "models") {
    // Eclipse has no Config models: a Claude version is named in the page.
    const answer = { call: "models", assistant: request.assistant, models: await api.models(options),
                     specify: request.assistant === "claude" };
    // A version the page asked to be checked: the list stays either way.
    const version = String(request.model || "").trim();
    if (version) {
      try { answer.probed = await api.probe({ ...options, model: version }); }
      catch (e) { answer.probeError = e.message; }
    }
    return answer;
  }
  // Only the chat logs: one file per conversation, named by the page's session.
  const log = request.service === "chat" ? sessionLog.create(request.log, request.assistant, request.session, request.logInclude) : null;
  const deps = { fetch, open, context: {}, port: 0, pages: { "/assistant": { tools: brain.TOOLS, call: sessionLog.tools(log, brain.callTool) } } };
  if (log) { log.user(request.text); }
  const server = mcp.create(deps);
  try {
    const running = await server.start();
    const answer = await api.ask({ ...options, model: request.model, personalInstructions: request.personalInstructions === true,
      url: running.url.replace(/\/mcp$/, "/assistant"), token: server.token,
      instructions: brain.INSTRUCTIONS, schema: brain.PLAN_SCHEMA,
      tools: brain.TOOLS.map(t => t.name),
      prompt: brain.preparePrompt ? await brain.preparePrompt(deps, request.text, request.state)
        : brain.prompt(request.text, request.state) });
    const plan = await brain.checkPlan(deps, answer.plan);
    if (log) { log.assistant({ model: answer.model, usage: answer.usage, text: plan.answer }); }
    return { call: "ask", model: answer.model, usage: answer.usage || null, plan };
  } catch (error) {
    if (log) { log.assistant({ model: error.model || request.model, text: "Request failed: " + error.message }); }
    throw error;
  } finally { await server.stop(); }
}

async function main() {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let started = false;
  let sequence = 0;
  const pending = new Map();
  const send = (kind, value) => process.stdout.write(kind + "\t" + encode(value) + "\n");
  lines.on("line", line => {
    if (!started) {
      started = true;
      let request;
      try { request = JSON.parse(decode(line)); } catch { send("RESULT", JSON.stringify({ error: "Invalid assistant request." })); process.exitCode = 1; lines.close(); return; }
      const ask = (kind, payload) => new Promise((resolve, reject) => {
        const id = String(++sequence);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Eclipse SAP request timed out.")); }, 60000);
        pending.set(id, { resolve, timer });
        send(kind, id + "\n" + payload);
      });
      const fetch = (_, resource) => ask("READ", resource);
      const open = target => ask("OPEN", JSON.stringify(target));
      run(request, fetch, assistant, open).catch(error => ({ call: request.call, assistant: request.assistant, error: error.message, model: error.model || "" }))
        .then(result => { send("RESULT", JSON.stringify(result)); lines.close(); });
    } else {
      const split = line.indexOf("\t");
      const id = line.slice(0, split);
      const entry = pending.get(id);
      if (entry) { clearTimeout(entry.timer); pending.delete(id); entry.resolve(decode(line.slice(split + 1))); }
    }
  });
  // If Eclipse goes away, do not orphan the assistant CLI or its server.
  process.stdin.on("end", () => process.exit(0));
}
if (require.main === module) { main(); }
module.exports = { run, executable };
