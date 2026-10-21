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

function parseSession(text, file) {
  const name = path.basename(file, ".jsonl");
  const provider = name.replace(/_\d{8}_\d{6}(?:_\d+)?$/, "");
  const session = { id: name, provider, start: null, end: null, usage: emptyUsage(), prompts: [] };
  const seen = new Set();
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
      }
      continue;
    }
    if (record.type === "user") {
      const prompt = typeof content === "string" ? content : Array.isArray(content) && !content.some(block => block?.type === "tool_result")
        ? content.filter(block => block?.type === "text").map(block => block.text || "").join("\n") : "";
      if (prompt.trim()) {
        current = { time: Number.isFinite(time) ? time : session.end, end: Number.isFinite(time) ? time : session.end,
          text: prompt.trim(), model: "", usage: emptyUsage(), details: [] };
        session.prompts.push(current);
      } else if (current && Array.isArray(content)) {
        for (const block of content) if (block?.type === "tool_result")
          current.details.push({ type: "tool result", text: prettyJson(block.content || "") });
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
        if (block?.type === "text" && block.text) current.details.push({ type: "answer", text: String(block.text) });
        if (block?.type === "tool_use") current.details.push({ type: "tool", text: String(block.name || "tool") + "\n" + JSON.stringify(block.input || {}, null, 2) });
      }
    }
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

let panel;
function open(vscode) {
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
    if (message?.action === "settings") await vscode.commands.executeCommand("workbench.action.openSettings", "vertex.ai.log.request");
    if (message?.action === "chooseFolder") {
      await require("./model-config").chooseLogFolder(vscode);
      await refresh();
    }
  });
  panel.onDidDispose(() => { panel = undefined; });
  return panel;
}

function register(vscode, context) {
  context.subscriptions.push(vscode.commands.registerCommand("vertex.showLogs", () => open(vscode)));
}

module.exports = { parseSession, readSessions, register, open, prettyJson, prettyRequest };
