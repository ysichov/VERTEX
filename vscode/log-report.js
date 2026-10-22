"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const sumUsage = (into, usage) => {
  into.input += Number(usage.input_tokens || 0);
  into.output += Number(usage.output_tokens || 0);
  into.cacheRead += Number(usage.cache_read_input_tokens || 0);
  into.cacheWrite += Number(usage.cache_creation_input_tokens || 0);
};

function prettyJson(value) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try { return JSON.stringify(JSON.parse(value), null, 2); }
  catch (_) { return value; }
}

function prettyRequest(text) {
  return String(text || "").split("\n").map(line => {
    const value = line.trim();
    return value.startsWith("{") || value.startsWith("[") ? prettyJson(value) : line;
  }).join("\n");
}

function recordingReference(content) {
  let data;
  try { data = typeof content === "string" ? JSON.parse(content) : content; } catch (_) { return null; }
  if (!data || typeof data !== "object") return null;
  const kind = data.kind || (data.run_id ? "transpiler" : data.session_id ? "sap" : "");
  const id = data.id || data.run_id || data.session_id;
  if (kind !== "transpiler" && kind !== "sap") return null;
  if (!kind || typeof id !== "string" || !/^[\w-]{1,160}$/.test(id)) return null;
  return { kind, id, step: 1, available: data.recorded_steps !== 0 };
}

function parseSession(text, file) {
  const name = path.basename(file, ".jsonl");
  const provider = name.replace(/_\d{8}_\d{6}(?:_\d+)?$/, "");
  const session = { id: name, provider, start: null, end: null, usage: emptyUsage(), prompts: [] };
  const seen = new Set();
  const toolCalls = new Map();
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const time = Date.parse(record.timestamp || "");
    if (Number.isFinite(time)) {
      session.start = session.start === null ? time : Math.min(session.start, time);
      session.end = session.end === null ? time : Math.max(session.end, time);
    }
    const content = record.message?.content;
    if (record.type === "vertex_request") {
      if (current && record.request) {
        current.details.push({ type: "VERTEX instructions", text: String(record.request.instructions || "") });
        current.details.push({ type: "Model request and context", text: prettyRequest(record.request.prompt) });
        current.details.push({ type: "Available tools", text: prettyJson(record.request.tools || []) });
        current.details.push({ type: "Answer schema", text: prettyJson(record.request.schema || null) });
        for (const snapshot of record.vertex_snapshots || []) current.details.push({ type: "snapshot", snapshot });
        if (record.vertex_objects?.length) current.details.push({ type: "Referenced objects", objects: record.vertex_objects });
      }
      continue;
    }
    if (record.type === "user") {
      const prompt = typeof content === "string" ? content : Array.isArray(content) && !content.some(block => block?.type === "tool_result")
        ? content.filter(block => block?.type === "text").map(block => block.text || "").join("\n") : "";
      if (prompt.trim()) {
        current = { time: Number.isFinite(time) ? time : session.end, end: Number.isFinite(time) ? time : session.end,
          text: prompt.trim(), model: "", usage: emptyUsage(), details: [], objects: record.vertex_objects || [] };
        session.prompts.push(current);
      } else if (current && Array.isArray(content)) {
        for (const block of content) if (block?.type === "tool_result") {
          const call = toolCalls.get(block.tool_use_id);
          const reference = !block.is_error && recordingReference(block.vertex_recording || block.content);
          const detail = { type: "tool result", tool_id: block.tool_use_id || "", text: prettyJson(block.content || "") };
          if (block.vertex_objects?.length) detail.objects = block.vertex_objects;
          if (reference) (call || detail).recording = reference;
          current.details.push(detail);
        }
      }
      continue;
    }
    if (record.type !== "assistant" || !record.message) continue;
    const message = record.message;
    if (message.id && seen.has(message.id)) continue;
    if (message.id) seen.add(message.id);
    if (message.usage) {
      sumUsage(session.usage, message.usage);
      if (current) sumUsage(current.usage, message.usage);
    }
    if (current) {
      if (message.model) current.model = String(message.model);
      if (Number.isFinite(time)) current.end = Math.max(current.end || time, time);
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === "text" && block.text) current.details.push({ type: "answer", text: String(block.text), objects: record.vertex_objects || [] });
        if (block?.type === "tool_use") {
          const detail = { type: "tool", name: String(block.name || "tool"), tool_id: block.id || message.id || "",
            text: String(block.name || "tool") + "\n" + JSON.stringify(block.input || {}, null, 2) };
          if (block.vertex_objects?.length) detail.objects = block.vertex_objects;
          if (detail.tool_id) toolCalls.set(detail.tool_id, detail);
          current.details.push(detail);
        }
      }
    }
  }
  // debug_run knows its ID before the first stop is saved. Once a later tool
  // response confirms that recording, the initial call can link to it too.
  const recordings = new Map();
  for (const prompt of session.prompts) for (const detail of prompt.details) {
    if (detail.recording?.available) recordings.set(detail.recording.kind + ":" + detail.recording.id, detail.recording);
  }
  for (const prompt of session.prompts) for (const detail of prompt.details) {
    if (!detail.recording) continue;
    const reference = recordings.get(detail.recording.kind + ":" + detail.recording.id);
    if (reference) detail.recording = reference;
    else delete detail.recording;
  }
  return session.start !== null ? session : null;
}

function readSessions(root) {
  if (!root) return { configured: false, folder: "", sessions: [] };
  const folder = path.join(root, "claude_compatible");
  if (!fs.existsSync(folder)) return { configured: true, folder, sessions: [] };
  const sessions = fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map(entry => {
      const file = path.join(folder, entry.name);
      return parseSession(fs.readFileSync(file, "utf8"), entry.name);
    }).filter(Boolean).sort((a, b) => b.start - a.start);
  return { configured: true, folder, sessions };
}

async function clearConversations(vscode, ids) {
  if (!Array.isArray(ids)) return 0;
  const root = vscode.workspace.getConfiguration("vertex.ai").get("logPath", "");
  const report = readSessions(root), selected = new Set(ids.filter(id => typeof id === "string"));
  const sessions = report.sessions.filter(session => selected.has(session.id));
  if (!sessions.length) return 0;
  const confirm = await vscode.window.showWarningMessage("Clear " + sessions.length + " selected conversation log(s)? Execution recordings are kept.",
    { modal: true }, "Clear selected conversations");
  if (confirm !== "Clear selected conversations") return 0;
  for (const session of sessions) {
    const file = path.join(report.folder, session.id + ".jsonl");
    fs.unlinkSync(file);
    // Prevent a pending model response from recreating a deleted conversation.
    require("./session-log").discardFiles([file]);
  }
  return sessions.length;
}

let panel;
function open(vscode, options = {}) {
  if (panel) { panel.reveal(vscode.ViewColumn.Beside, false); return panel; }
  panel = vscode.window.createWebviewPanel("vertex.logReport", "VERTEX: Session Logs", vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  const nonce = crypto.randomBytes(16).toString("hex");
  panel.webview.html = fs.readFileSync(path.join(__dirname, "resources", "log-report.html"), "utf8").replaceAll("{{NONCE}}", nonce);
  const refresh = () => {
    try {
      const root = vscode.workspace.getConfiguration("vertex.ai").get("logPath", "");
      return panel?.webview.postMessage({ action: "data", report: readSessions(root) });
    } catch (error) { return panel?.webview.postMessage({ action: "error", error: error.message }); }
  };
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.action === "ready" || message?.action === "refresh") await refresh();
    if (message?.action === "settings") await vscode.commands.executeCommand("workbench.action.openSettings", "vertex.ai.log");
    if (message?.action === "clearConversations") {
      try { await clearConversations(vscode, message.ids); await refresh(); }
      catch (error) { panel?.webview.postMessage({ action: "error", error: error.message }); }
    }
    if (message?.action === "openSnapshot") {
      try { require("./log-snapshot").open(vscode, message.snapshot); }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }
    if (message?.action === "openObject") {
      try {
        const object = require("./session-log").objectReference(message.object);
        if (object.path) {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(object.path));
          await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
        } else if (object.object_name && options.openObject) await options.openObject(object);
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }
    if (message?.action === "openRecording") {
      const reference = message.recording;
      if (!reference || typeof reference.id !== "string" || !/^[\w-]{1,160}$/.test(reference.id)) return;
      // Fixed commands open recorded history; a link must never start another run.
      if (reference.kind === "transpiler") await vscode.commands.executeCommand("vertex.openTranspilerRun", { run_id: reference.id, step: 1 });
      if (reference.kind === "sap") await vscode.commands.executeCommand("vertex.openDebugSession", { session_id: reference.id, step: 1 });
    }
    if (message?.action === "chooseFolder") {
      await require("./model-config").chooseLogFolder(vscode);
      await refresh();
    }
  });
  panel.onDidDispose(() => { panel = undefined; });
  return panel;
}

function register(vscode, context, options) {
  context.subscriptions.push(vscode.commands.registerCommand("vertex.showLogs", () => open(vscode, options)));
}

module.exports = { parseSession, readSessions, register, open, prettyJson, prettyRequest, recordingReference, clearConversations };
