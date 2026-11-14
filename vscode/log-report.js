"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const sumUsage = (into, usage) => {
  if (usage.cost_usd == null && Number.isFinite(usage.estimated_cost_usd) && usage.estimated_cost_usd >= 0) {
    into.cost = (into.cost || 0) + usage.estimated_cost_usd;
    into.costEstimated = (into.costEstimated || 0) + 1;
  }
  if (Object.prototype.hasOwnProperty.call(usage, "cost_usd")) {
    if (usage.cost_usd !== null && Number.isFinite(usage.cost_usd)) into.cost = (into.cost || 0) + usage.cost_usd;
    else into.costMissing = (into.costMissing || 0) + 1;
  }
  into.input += Number(usage.input_tokens || 0);
  into.output += Number(usage.output_tokens || 0);
  into.cacheRead += Number(usage.cache_read_input_tokens || 0);
  into.cacheWrite += Number(usage.cache_creation_input_tokens || 0);
};

// Old logs cut the serialized string, sometimes halfway through a row. Keep only
// complete rows; never fill a missing value or pretend the response was complete.
function partialTable(text) {
  const marker = /\n\[(\d+) more characters not logged\]$/.exec(text);
  if (!marker) return null;
  let prefix = text.slice(0, marker.index);
  for (let layer = 0; layer < 4 && prefix.trimStart().startsWith('"'); layer++) {
    let decoded;
    for (let cut = 0; cut <= 12 && cut < prefix.length; cut++) {
      try { decoded = JSON.parse(prefix.slice(0, prefix.length - cut) + '"'); break; } catch (_) { /* incomplete escape */ }
    }
    if (typeof decoded !== "string") return null;
    prefix = decoded;
  }
  const start = /"rows"\s*:\s*\[/.exec(prefix);
  if (!start) return null;
  const from = start.index + start[0].length;
  let depth = 1, quoted = false, escaped = false, complete = from;
  for (let i = from; i < prefix.length; i++) {
    const c = prefix[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 1) complete = i + 1; if (depth === 0) break; }
  }
  try {
    const data = JSON.parse(prefix.slice(0, from) + prefix.slice(from, complete) + "]}");
    const columns = typeof data.columns === "string" ? JSON.parse(data.columns) : data.columns;
    if (!Array.isArray(columns) || !Array.isArray(data.rows)) return null;
    data.log_truncated = "Only " + data.rows.length + " complete rows survived; " + marker[1] + " characters were not logged.";
    return data;
  } catch (_) { return null; }
}

function prettyJson(value) {
  if (typeof value === "string") value = partialTable(value) || value;
  // Some providers wrap an already serialized tool result in another JSON string.
  // Decode valid JSON layers only: literal backslashes in ordinary text stay intact.
  for (let depth = 0; depth < 4 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch (_) { break; }
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
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
  // The file's name without folder or extension, read as text: Eclipse parses logs in its browser, without Node's path.
  const name = String(file).replace(/^.*[\\/]/, "").replace(/\.jsonl$/, "");
  const provider = name.replace(/_\d{8}_\d{6}(?:_[0-9a-f]+)?$/, "");
  const session = { id: name, provider, conversation: null, context: null, start: null, end: null, usage: emptyUsage(), prompts: [], models: [] };
  const seen = new Set();
  const toolCalls = new Map();
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const time = Date.parse(record.timestamp || "");
    if (!session.conversation && typeof record.vertex_conversation === "string") session.conversation = record.vertex_conversation;
    // Where the conversation was held. Only the two shapes the log writes are accepted; a log without it
    // stays uncontexted rather than being guessed from its file name or its content.
    if (!session.context) {
      const held = record.vertex_context;
      if (held && typeof held === "object" && typeof held.mode === "string") {
        if (held.mode === "folder" && typeof held.folder === "string" && held.folder) session.context = { mode: "folder", folder: held.folder };
        else if (held.mode === "sap" && typeof held.system === "string" && held.system) {
          session.context = { mode: "sap", system: held.system, ...(typeof held.client === "string" && held.client ? { client: held.client } : {}) };
        }
      }
    }
    if (typeof record.vertex_related_conversation === "string") session.relatedConversation = record.vertex_related_conversation;
    if (Number.isFinite(time)) {
      session.start = session.start === null ? time : Math.min(session.start, time);
      session.end = session.end === null ? time : Math.max(session.end, time);
    }
    for(const value of [record.message?.model,record.response?.model,...Object.keys(record.response?.modelUsage||{})]){
      for(const model of String(value||"").split(",").map(value=>value.trim()).filter(Boolean))if(!session.models.includes(model))session.models.push(model);
    }
    const content = record.message?.content;
    if (record.type === "vertex_provider_response") {
      if (current && record.scope === "request_error") current.failed = true;
      // A model call within the run is a step of the timeline: the events Claude Code sends for one message (its
      // text, then a tool call) share the message id and are one step. The run's total stays a detail of its own.
      if (current && record.scope === "model_response") {
        const id = record.response?.id || "";
        const last = current.timeline.filter(entry => entry.kind === "model").pop();
        if (last && id && last.id === id) last.usage = record.response?.usage || last.usage;
        else current.timeline.push({ kind: "model", id, ...(record.provider === "codex" ? { usageScope: "cli_turn" } : {}), usage: record.response?.usage || null, time: Number.isFinite(time) ? time : null });
      } else if (current) current.details.push({ type: record.scope === "request_error" ? "Request failed" + (record.response?.model_step ? " at model step " + record.response.model_step : "") : "Provider usage (" + record.scope + ")",
        ...(record.scope === "request_error" ? { failed: true } : {}),
        text: prettyJson({ provider: record.provider, response: record.response }) });
      continue;
    }
    if (record.type === "vertex_decision") {
      if (current && record.input) current.decision = record.input;
      continue;
    }
    // The report travels whole as well as prettified: the page reads Jev's answers as a table from it.
    if(record.type==="vertex_orchestration"){if(current)current.details.push({type:record.report?.kind==="plan"?"Orchestrator JSON plan":record.report?.kind==="execution_mode"?"Orchestrator mode":"Orchestrator stage",text:prettyJson(record.report)});continue;}
    if(record.type==="vertex_tool_selection"){if(current)current.details.push({type:"Orchestrator tool selection",text:prettyJson(record.report)});continue;}
    if(record.type==="vertex_topic_routing"){if(current){current.topic=record.report?.topic||null;current.details.push({type:"Topic routing (Jev)",routing:record.report&&typeof record.report==="object"?record.report:null,text:prettyJson(record.report)});}continue;}
    if (record.type === "vertex_context_optimization") {
      if(current) current.details.push({type:"Context optimization (Jev)",text:prettyJson(record.report)});
      continue;
    }
    if (record.type === "vertex_context_size" || record.type === "vertex_request") {
      const size = record.contextSize;
      if (current && !current.contextSize && Number.isSafeInteger(size?.characters) && size.characters >= 0
        && Number.isSafeInteger(size?.estimatedTokens) && size.estimatedTokens >= 0 && size.method === "characters/4") {
        current.contextSize = { characters: size.characters, estimatedTokens: size.estimatedTokens, method: size.method };
      }
      if (record.type === "vertex_context_size") continue;
    }
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
        current = { time: Number.isFinite(time) ? time : session.end, end: Number.isFinite(time) ? time : session.end, toolset: record.vertex_toolset || "",
          key: name + ":" + session.prompts.length, provider, branch: record.vertex_branch || "main", parent: record.vertex_parent || null,
          text: prompt.trim(), operation: String(record.vertex_operation || "Chat"), model: "", usage: emptyUsage(), details: [], objects: record.vertex_objects || [],
          screenshots: Array.isArray(record.vertex_screenshots) ? record.vertex_screenshots : [],
          // Model calls and tool calls in the order they happened.
          timeline: [] };
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
    // Claude's words and thinking between its steps: a line of the timeline, not an answer.
    if (record.vertex_step === "claude_note") {
      const note = Array.isArray(content) && content[0];
      if (current && note && note.text) current.timeline.push({ kind: "note", note: note.note === "thinking" ? "thinking" : "text", text: String(note.text) });
      continue;
    }
    if (record.type !== "assistant" || !record.message) continue;
    const message = record.message;
    if (provider === "anthropic-api" && message.usage) message.usage = require("./anthropic-pricing").priceUsage(message.model, message.usage);
    if (message.id && seen.has(message.id)) continue;
    if (message.id) seen.add(message.id);
    if (message.usage) {
      if (current && Object.prototype.hasOwnProperty.call(message.usage, "cost_usd")) {
        const last = current.timeline.filter(entry => entry.kind === "model").pop();
        if (last && (!message.usage.generation_id || last.id === message.usage.generation_id)) last.usage = message.usage;
      }
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
            text: String(block.name || "tool") + "\n" + JSON.stringify(block.input || {}, null, 2),
            // Claude Code's own steps and the review are drawn from their arguments, not as JSON.
            ...(record.vertex_step ? { step: record.vertex_step, input: block.input || {} } : {}) };
          if (block.vertex_objects?.length) detail.objects = block.vertex_objects;
          if (detail.tool_id) toolCalls.set(detail.tool_id, detail);
          current.details.push(detail);
          current.timeline.push({ kind: "tool", tool_id: detail.tool_id });
        }
      }
    }
  }
  // Claude Code streams its answer as plain text before the structured one, so the last "note" of a run is often
  // the answer itself: a note the answer contains is not shown twice.
  const flat = text => String(text || "").replace(/\s+/g, " ").trim();
  for (const prompt of session.prompts) {
    const answers = prompt.details.filter(d => d.type === "answer").map(d => flat(d.text));
    if (!answers.length) continue;
    prompt.timeline = prompt.timeline.filter(entry => {
      if (entry.kind !== "note" || entry.note !== "text") return true;
      const said = flat(entry.text).slice(0, 300);
      return !said || !answers.some(answer => answer.includes(said));
    });
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
  if (session.prompts.length && session.prompts.every(prompt => prompt.operation === "AI Review") && !session.relatedConversation) {
    session.relatedConversation = session.conversation;
    session.conversation = "review:legacy:" + name;
  }
  if (!session.conversation) session.conversation = "legacy:" + name;
  return session.start !== null ? session : null;
}

function readSessions(root) {
  root=require("./session-log").resolveRoot(root);
  if (!root) return { configured: false, folder: "", sessions: [] };
  const folder = path.join(root, "claude_compatible");
  if (!fs.existsSync(folder)) return { configured: true, folder, sessions: [] };
  const sessions = fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map(entry => {
      const file = path.join(folder, entry.name);
      return parseSession(fs.readFileSync(file, "utf8"), entry.name);
    }).filter(Boolean).sort((a, b) => b.start - a.start);
  // Topics tagged afterwards by Tag topics (Jev), kept beside the logs; a topic the log itself records wins.
  const tagged = new Map();
  for (const session of sessions) {
    if (!session.conversation) continue;
    if (!tagged.has(session.conversation)) tagged.set(session.conversation, require("./topic-backfill").readTags(folder, session.conversation));
    const tags = tagged.get(session.conversation);
    for (const prompt of session.prompts) if (!prompt.topic && tags[prompt.key]) prompt.topic = tags[prompt.key];
  }
  return { configured: true, folder, sessions };
}

/* The questions and answers of the conversation SESSION belongs to, in the order they were asked: every file that
   carries its conversation id (one per provider it used), or the file alone when it was written before ids existed.
   Commit and PR descriptions are separate operations, not turns of the chat. */
/** Where a conversation was held, as one comparable key; the page builds the same key for its filter. */
function placeKey(context) {
  if (!context) return "";
  return context.mode === "folder" ? "folder:" + context.folder
    : "sap:" + context.system + (context.client ? "/" + context.client : "");
}

/** place: show only the conversations held there. The chat's own list passes the place it is working in. */
function conversationList(report, place) {
  const groups = new Map();
  for (const session of report.sessions) {
    const prompts = session.prompts.filter(prompt => prompt.operation === "Chat" || prompt.operation === "Web search");
    if (!prompts.length) continue;
    const key = session.conversation || session.id;
    if (!groups.has(key)) groups.set(key, { prompts: [], providers: new Set(), context: null });
    const group = groups.get(key);
    // The place belongs to the conversation, not to one of its files: continuing an older one that has no
    // place gives the whole conversation the place it is continued in, with its earlier questions kept.
    if (!group.context && session.context) group.context = session.context;
    group.providers.add(session.provider);
    group.prompts.push(...prompts.map(prompt => ({ ...prompt, sessionId: session.id })));
  }
  return [...groups.values()].filter(group => !place || placeKey(group.context) === place).map(group => {
    group.prompts.sort((a, b) => (a.time || 0) - (b.time || 0) || a.key.localeCompare(b.key));
    const first = group.prompts[0], last = group.prompts[group.prompts.length - 1];
    const preview = text => String(text || "").replace(/\s+/g, " ").slice(0, 180);
    return { id: last.sessionId, title: preview(first.text), lastQuestion: preview(last.text),
      time: last.time, count: group.prompts.length, providers: [...group.providers].join(" · ") };
  }).sort((a, b) => (b.time || 0) - (a.time || 0));
}

function conversationTurns(report, sessionId, point) {
  const session = report.sessions.find(item => item.id === sessionId);
  if (!session) throw new Error("That session is no longer in the log folder.");
  const files = session.conversation ? report.sessions.filter(item => item.conversation === session.conversation) : [session];
  const all = files.flatMap(item => item.prompts.map(prompt => ({ ...prompt, provider: item.provider, logId: item.id })))
    .filter(prompt => prompt.operation === "Chat" || prompt.operation === "Web search")
    .sort((a, b) => (a.time || 0) - (b.time || 0) || a.key.localeCompare(b.key));
  const target = point ? all.find(prompt => prompt.key === point) : all[all.length - 1];
  if (point && !target) throw new Error("That continuation point is no longer in the log folder.");
  // Walk branch ancestry, cutting each ancestor at the recorded fork point.
  const visiting = new Set();
  function history(end) {
    if (!end) return [];
    if (visiting.has(end.key)) throw new Error("The conversation has a cyclic branch link.");
    visiting.add(end.key);
    const own = all.filter(p => p.branch === end.branch);
    const parent = own[0]?.parent;
    const ancestor = parent ? all.find(p => p.key === parent) : null;
    if (parent && !ancestor) throw new Error("The parent of this branch is missing from the log folder.");
    const result = [...history(ancestor), ...own.slice(0, own.indexOf(end) + 1)];
    visiting.delete(end.key);
    return result;
  }
  const prompts = history(target);
  const notLogged = text => !text || /^\[[^\]]*not logged[^\]]*\]$/i.test(text.trim());
  if (!prompts.length || prompts.every(prompt => notLogged(prompt.text))) {
    throw new Error("This conversation was logged without its questions; turn on vertex.ai.log.questions for conversations to come.");
  }
  const turns = prompts.map(prompt => {
    const answers = prompt.details.filter(detail => detail.type === "answer").map(detail => detail.text);
    const answer = !prompt.failed && answers.length ? answers[answers.length - 1] : "";
    const images = [], missing = [];
    for (const shot of prompt.screenshots || []) {
      try {
        const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[shot.media_type];
        if (!report.folder || !extension || !shot.file) throw new Error("Screenshot unavailable");
        const directory = fs.realpathSync(path.join(report.folder, prompt.logId));
        const file = fs.realpathSync(shot.file);
        // Logs are untrusted: only attachments actually stored beside this prompt's log may be restored.
        const root = fs.realpathSync(report.folder), relative = path.relative(root, directory);
        if (relative.startsWith("..") || path.isAbsolute(relative) || path.dirname(file) !== directory
          || !new RegExp("^screenshot-\\d+\\." + extension + "$", "i").test(path.basename(file))) throw new Error("Invalid screenshot path");
        const size = fs.statSync(file).size;
        if (!size || size > 20 * 1024 * 1024) throw new Error("Screenshot size is unsupported");
        images.push({ media_type: shot.media_type, data: fs.readFileSync(file).toString("base64"), file, ...(typeof shot.description === "string" ? { description: shot.description } : {}) });
      } catch (_) { missing.push(shot); }
    }
    return { ...(prompt.topic?{topic:prompt.topic}:{}), question: prompt.text, answer: notLogged(answer) ? "" : answer, provider: prompt.provider, model: prompt.model, time: prompt.time,
      ...(prompt.failed ? { failed: true } : {}), ...(images.length ? { images } : {}), ...(missing.length ? { missingScreenshots: missing.length } : {}) };
  });
  if (turns.every(turn => !turn.answer) && !prompts.some(prompt => prompt.failed)) {
    throw new Error("This conversation was logged without its answers; turn on vertex.ai.log.answers for conversations to come.");
  }
  const later = all.some(p => p.branch === target.branch && all.indexOf(p) > all.indexOf(target));
  const branch = later ? { id: crypto.randomBytes(8).toString("hex"), parent: target.key }
    : { id: target.branch, parent: target.parent };
  return { conversation: session.conversation, files: files.length, turns, branch };
}

async function clearConversations(vscode, ids) {
  if (!Array.isArray(ids)) return 0;
  const root = vscode.workspace.getConfiguration("vertex.ai").get("logPath", "");
  const report = readSessions(root), selected = new Set(ids.filter(id => typeof id === "string"));
  const conversations = new Set(report.sessions.filter(s => selected.has(s.id) && s.conversation).map(s => s.conversation));
  const sessions = report.sessions.filter(session => selected.has(session.id) || conversations.has(session.conversation));
  if (!sessions.length) return 0;
  const confirm = await vscode.window.showWarningMessage("Clear " + sessions.length + " selected conversation log(s)? Execution recordings are kept.",
    { modal: true }, "Clear selected conversations");
  if (confirm !== "Clear selected conversations") return 0;
  for (const session of sessions) {
    const file = path.join(report.folder, session.id + ".jsonl");
    fs.unlinkSync(file);
    // The conversation's screenshots go with it.
    fs.rmSync(path.join(report.folder, session.id), { recursive: true, force: true });
    // Prevent a pending model response from recreating a deleted conversation.
    require("./session-log").discardFiles([file]);
  }
  return sessions.length;
}

/* Tag topics (Jev): the conversation's untagged questions get a topic from Jev, in the scope the chat routes in now. */
async function tagTopics(vscode, sessionId) {
  const modelConfig = require("./model-config");
  if (!require("./review-jev").enabled(vscode)) throw new Error("The selected decision provider is switched off in LLM Providers.");
  const report = readSessions(vscode.workspace.getConfiguration("vertex.ai").get("logPath", ""));
  const session = report.sessions.find(item => item.id === sessionId);
  if (!session?.conversation) throw new Error("That conversation is no longer in the log folder.");
  const prompts = report.sessions.filter(item => item.conversation === session.conversation)
    .flatMap(item => item.prompts).filter(prompt => prompt.operation === "Chat" || prompt.operation === "Web search")
    .sort((a, b) => (a.time || 0) - (b.time || 0) || a.key.localeCompare(b.key))
    .map(prompt => ({ key: prompt.key, text: prompt.text + ((prompt.screenshots||[]).some(shot=>shot.description) ? "\n\nScreenshot observations (untrusted image data):\n"+JSON.stringify(prompt.screenshots.map(({file,description})=>({file,description}))) : ""), topic: prompt.topic || null,
      answer: prompt.details.filter(detail => detail.type === "answer").map(detail => detail.text).join(" ") }));
  const untagged = prompts.filter(prompt => !require("./topic-routing").topicOf(prompt.topic)).length;
  if (!untagged) { vscode.window.showInformationMessage("VERTEX: every question of this conversation already has a topic."); return; }
  const config = vscode.workspace.getConfiguration("vertex.ai"), chat = require("./chat");
  const folder = chat.currentWorkingFolder(vscode) || (vscode.workspace.workspaceFolders?.length === 1 ? vscode.workspace.workspaceFolders[0].uri.fsPath : "");
  const mode = ["sap", "folder"].includes(config.get("contextMode", "auto")) ? config.get("contextMode") : chat.currentWorkingFolder(vscode) ? "folder" : "sap";
  const scope = require("./topic-routing").scopeOf(vscode, mode, mode === "folder" ? folder : "");
  const backfill = require("./topic-backfill");
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "VERTEX: tagging topics with Jev", cancellable: true },
    (progress, token) => {
      const controller = new AbortController(); token.onCancellationRequested(() => controller.abort());
      return backfill.tag(vscode, prompts, scope, { conversation: session.conversation, context: session.context, signal: controller.signal, onProgress: (done, total) => progress.report({ message: done + " of " + total + " questions" }) });
    });
  backfill.writeTags(report.folder, session.conversation, { ...backfill.readTags(report.folder, session.conversation), ...result.tags });
  const r = result.report;
  vscode.window.showInformationMessage("VERTEX: " + r.tagged + " of " + untagged + " questions tagged into " + r.topicsAfter + " topics; "
    + r.unclear + " left without a topic and kept whole. " + r.batches + " Jev call" + (r.batches === 1 ? "" : "s") + ".");
}

/** The report as the list shows it: every prompt without the parts only an opened prompt needs. */
function listReport(report) {
  return { ...report, sessions: report.sessions.map(session => ({ ...session,
    prompts: session.prompts.map(({ details, timeline, decision, ...prompt }) => ({ ...prompt, text: require("./topic-routing").observations(prompt.text).question.slice(0,2000),
      sections: ["User",...(details?.some(d=>d.type==="answer")?["Model answer"]:[]),
        ...(details?.some(d=>d.type==="tool"||d.type==="tool result")||timeline?.some(t=>t.kind==="model")?["Steps"]:[]),
        ...(details||[]).filter(d=>!["answer","tool","tool result"].includes(d.type)).map(d=>d.snapshot?(d.snapshot.kind==="uml"?"Recorded UML":"Recorded metrics"):d.type==="Model request and context"?"Request and context":d.type)], lazy: true })) })) };
}

/* Where the chat is working now, in the shape the log records. Session Logs opens on that place, so one
   folder's conversations are separated from another folder's and from a SAP system's without choosing
   anything. Derived the way chat.js derives it for the log itself, so the two cannot drift apart. */
function currentPlace(vscode) {
  try {
    const mode = vscode.workspace.getConfiguration("vertex.ai").get("contextMode", "auto");
    const folders = vscode.workspace.workspaceFolders || [];
    const folder = mode === "sap" ? "" : require("./chat").workingFolder(vscode, "")
      || (mode === "folder" && folders.length === 1 ? folders[0].uri.fsPath : "");
    if (folder) return { mode: "folder", folder };
    const [, , system, client] = JSON.parse(require("./topic-routing").scopeOf(vscode, "sap", ""));
    return system ? { mode: "sap", system, ...(client ? { client } : {}) } : null;
  } catch (_) { return null; }
}

let panel;
function open(vscode, options = {}) {
  if (panel) { panel.reveal(vscode.ViewColumn.Beside, false); return panel; }
  panel = vscode.window.createWebviewPanel("vertex.logReport", "VERTEX: Session Logs", vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  const nonce = crypto.randomBytes(16).toString("hex");
  // The page is shared with Eclipse; only here can a conversation continue in the chat.
  panel.webview.html = fs.readFileSync(path.join(__dirname, "resources", "log-report.html"), "utf8").replaceAll("{{NONCE}}", nonce)
    .replace("</head>", () => "<style>" + require("./vertex-logo").fill(fs.readFileSync(path.join(__dirname, "resources", "vertex-controls.css"), "utf8")) + "</style></head>")
    .replace("</head>", () => '<script nonce="' + nonce + '">window.vertexCanContinue = true;window.vertexCanReadVersions = ' + Boolean(options.readVersion) + ';window.vertexCanTagTopics = ' + require("./review-jev").enabled(vscode) + ';</script></head>')
    // VERTEX's one button style, as Eclipse's Session Logs and the other views get it; after the page's own rules, so it wins.
    .replace("</head>", () => "<style>" + require("./vertex-logo").fill(fs.readFileSync(path.join(__dirname, "resources", "vertex-controls.css"), "utf8")) + "</style></head>");
  // The page gets the list only - each prompt without its details, steps and Jev input - and asks for one prompt's
  // full record when it is opened: the whole log folder can be tens of megabytes, too much to hold in a webview.
  let full = null, promptIndex = new Map();
  const refresh = () => {
    try {
      const root = vscode.workspace.getConfiguration("vertex.ai").get("logPath", "");
      full = readSessions(root);
      promptIndex = new Map(full.sessions.flatMap(session => session.prompts).map(prompt => [prompt.key,prompt]));
      return panel?.webview.postMessage({ action: "data", report: { ...listReport(full), current: currentPlace(vscode) } });
    } catch (error) { return panel?.webview.postMessage({ action: "error", error: error.message }); }
  };
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.action === "ready" || message?.action === "refresh") await refresh();
    if (message?.action === "promptDetail") {
      const key = String(message.key || "");
      const prompt = promptIndex.get(key);
      await panel?.webview.postMessage(prompt ? { action: "promptDetail", key, prompt: { text: prompt.text, details: prompt.details, timeline: prompt.timeline, decision: prompt.decision || null } }
        : { action: "promptDetail", key, error: "That prompt is no longer in the log folder; refresh Session Logs." });
    }
    if (message?.action === "settings") await vscode.commands.executeCommand("workbench.action.openSettings", "vertex.ai.log");
    if (message?.action === "clearConversations") {
      try { await clearConversations(vscode, message.ids); await refresh(); }
      catch (error) { panel?.webview.postMessage({ action: "error", error: error.message }); }
    }
    if (message?.action === "continueConversation") {
      try {
        const root = vscode.workspace.getConfiguration("vertex.ai").get("logPath", "");
        const found = conversationTurns(readSessions(root), String(message.id || ""));
        if(typeof message.topicId==="string"&&/^topic_\d{4,8}$/.test(message.topicId))found.topicId=message.topicId;
        await vscode.commands.executeCommand("vertex.continueConversation", found);
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }
    if (message?.action === "tagTopics") {
      try { await tagTopics(vscode, String(message.id || "")); await refresh(); }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); await refresh(); }
    }
    if (message?.action === "continueDecision") {
      try {
        const report=readSessions(vscode.workspace.getConfiguration("vertex.ai").get("logPath", ""));
        const step=report.sessions.flatMap(session=>session.prompts).find(prompt=>prompt.key===message.key);
        if(!step?.decision)throw new Error("This step has no saved Jev input. Enable question logging for future runs.");
        await vscode.commands.executeCommand("vertex.continueDecision",step.decision);
      } catch(error){vscode.window.showErrorMessage("VERTEX: "+error.message);}
    }
    if (message?.action === "openSnapshot") {
      try { require("./log-snapshot").open(vscode, message.snapshot); }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }
    if (message?.action === "openScreenshot") {
      // Only a screenshot saved in the configured log folder opens, in VS Code's own image viewer.
      try {
        const root = path.resolve(vscode.workspace.getConfiguration("vertex.ai").get("logPath", "") || "", "claude_compatible");
        const file = path.resolve(String(message.file || ""));
        if (!/\.(png|jpe?g|gif|webp)$/i.test(file) || path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file))) {
          throw new Error("That screenshot is not in the log folder.");
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside });
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
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
    if (message?.action === "openSelect") {
      try {
        const session = full.sessions.find(session => session.prompts.some(prompt => prompt.key === message.key));
        if (!session) throw new Error("That prompt is no longer in the log folder.");
        await vscode.commands.executeCommand("vertex.runSelect", { sql: message.sql, system: session.context?.mode === "sap" ? session.context.system : undefined });
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }
    if (message?.action === "openVersion") {
      try {
        const prompt = promptIndex.get(message.key);
        const session = full.sessions.find(session => session.prompts.includes(prompt));
        const detail = prompt?.details.find(detail => detail.type === "tool result" && detail.tool_id === message.toolId);
        const data = detail && JSON.parse(prettyJson(detail.text));
        const revisions = typeof data?.revisions === "string" ? JSON.parse(data.revisions) : data?.revisions;
        const version = revisions?.find(version => version.uri === message.uri);
        if (!version || !options.readVersion) throw new Error("That historical version is unavailable in this log.");
        await options.readVersion({ uri: version.uri, name: data.object?.name || "", version: version.id, toolset: prompt.toolset,
          system: session.context?.mode === "sap" ? session.context.system : "", client: session.context?.client });
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

module.exports = { listReport, tagTopics, parseSession, readSessions, register, open, prettyJson, prettyRequest, recordingReference, clearConversations, conversationTurns, conversationList, currentPlace, placeKey };
