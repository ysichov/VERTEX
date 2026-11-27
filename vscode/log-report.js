"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sessionFileCache = new Map();
const modelCatalogs = new Map();
let modelCatalogRevision = 0;

// The panel already has the provider's ID-to-label catalog. Use exact matches only
// for older logs that did not record the selected label.
function setModelCatalog(provider, models) {
  if (typeof provider !== "string" || !Array.isArray(models)) return;
  const next = new Map(models.filter(item => typeof item?.id === "string" && item.id && typeof item.label === "string" && item.label.trim())
    .map(item => [item.id, item.label.trim()]));
  const previous = modelCatalogs.get(provider);
  if (previous && previous.size === next.size && [...next].every(([id, label]) => previous.get(id) === label)) return;
  modelCatalogs.set(provider, next);
  modelCatalogRevision++;
}

function dateKey(time) {
  const date = new Date(time), pad = value => String(value).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}
function dateRange(filter) {
  const valid = value => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value) ? value : "";
  return { from: valid(filter?.from), to: valid(filter?.to) };
}
function fileNameDate(name) {
  const match = /_(\d{4})(\d{2})(\d{2})_\d{6}(?:_[\w.-]+)?\.jsonl$/i.exec(name);
  return match ? match[1] + "-" + match[2] + "-" + match[3] : "";
}
function fileInDateRange(name, stat, filter, currentNames) {
  const { from, to } = dateRange(filter);
  if (!from && !to) return true;
  const today=dateKey(Date.now());
  if (currentNames?.has(name)&&(!from||today>=from)&&(!to||today<=to)) return true;
  const named = fileNameDate(name);
  if (named) return (!from || named >= from) && (!to || named <= to);
  const dates = [stat ? dateKey(stat.mtimeMs) : ""];
  return dates.some(date => date && (!from || date >= from) && (!to || date <= to));
}

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

// The model's own name. A proxy reports it with the route glued on - CodeMie answers
// "codemie-gpt-6-luna-2026-09-22" and "openai.gpt-5.6-sol" - while the Providers cell already names the
// provider. The session's provider prefix and a vendor route ("openai.", "us.anthropic.") are dropped;
// a slash name such as "inclusionai/ling-3.0-flash" is the model's real id and stays.
const MODEL_VENDORS = /^(?:[a-z]{2}\.)?(?:openai|anthropic|google|meta|mistral|amazon|cohere|deepseek|ai21|xai)\./i;
function bareModel(value, provider) {
  let model = String(value || "").trim();
  if (provider && model.toLowerCase().startsWith(String(provider).toLowerCase() + "-") && model.length > provider.length + 1) model = model.slice(provider.length + 1);
  return model.replace(MODEL_VENDORS, "") || model;
}

function parseSession(text, file, listOnly = false) {
  // The file's name without folder or extension, read as text: Eclipse parses logs in its browser, without Node's path.
  const name = String(file).replace(/^.*[\\/]/, "").replace(/\.jsonl$/, "");
  const provider = name.replace(/_\d{8}_\d{6}(?:_[0-9a-f]+)?$/, "");
  const session = { id: name, provider, conversation: null, context: null, start: null, end: null, usage: emptyUsage(), prompts: [], models: [], toolCalls: 0 };
  const seen = new Set();
  const toolCalls = new Map();
  const nativeCosts = new Map(), reportedCosts = new Set();
  let current, pendingDecision;
  for (const line of text.split(/\r?\n/)) {
    if(listOnly&&!/"type"\s*:\s*"user"/.test(line))continue;
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const time = Date.parse(record.timestamp || "");
    const priorPrompt=current, detailStart=current?.details.length||0, timelineStart=current?.timeline.length||0;
    try {
    if (!session.conversation && typeof record.vertex_conversation === "string") session.conversation = record.vertex_conversation;
    // Where the conversation was held. Only known modes are accepted; a log without it
    // stays uncontexted rather than being guessed from its file name or its content.
    if (!session.context) {
      const held = record.vertex_context;
      if (held && typeof held === "object" && typeof held.mode === "string") {
        if (held.mode === "zero") session.context = { mode: "zero" };
        else if (held.mode === "both" && typeof held.folder === "string" && held.folder && typeof held.system === "string" && held.system) session.context = { mode: "both", folder: held.folder, system: held.system, ...(typeof held.client === "string" && held.client ? { client: held.client } : {}) };
        else if (held.mode === "folder" && typeof held.folder === "string" && held.folder) session.context = { mode: "folder", folder: held.folder };
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
      for(const model of String(value||"").split(",").map(value=>bareModel(value,provider)).filter(Boolean))if(!session.models.includes(model))session.models.push(model);
    }
    const content = record.message?.content;
    if (record.type === "vertex_provider_response") {
      if (current && record.response?.model) current.model = bareModel(record.response.model, record.provider || provider);
      if(current && record.scope === "cli_run") {
        const estimates = require("./usage-report").cliEstimates(record.provider || provider, record.response);
        if(estimates.length) {
          if(!nativeCosts.has(current))nativeCosts.set(current,new Map());
          nativeCosts.get(current).set(record.response?.id || JSON.stringify(record.response), estimates.reduce((sum,item)=>sum+item.cost,0));
        }
      }
      if (current && record.scope === "request_error") current.failed = true;
      // The run is still open until its closing record; a live Flow keeps notes that precede a model reply pending.
      if (current && ["cli_run", "request_error", "request_stopped", "request_interrupted_by_user"].includes(record.scope)) current.open = false;
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
    if (record.type === "vertex_screenshot_descriptions") {
      if (current && Array.isArray(record.vertex_screenshots)) current.screenshots = record.vertex_screenshots;
      continue;
    }
    if (record.type === "vertex_decision") {
      if (record.input) { if (current) current.decision = record.input; else pendingDecision = record.input; }
      continue;
    }
    if (record.type === "vertex_user_interjection") {
      if (current) {
        current.events ||= [];
        current.events.push({ kind: "user_interjection", id: record.id || "", actor: "User",
          text: String(record.text || "[not logged]"), time: Number.isFinite(time) ? time : null, state: "queued" });
      }
      continue;
    }
    if (record.type === "vertex_user_interjection_applied") {
      const event = current?.events?.findLast(item => item.kind === "user_interjection" && item.id === record.id);
      if (event) event.state = "sent";
      continue;
    }
    // The report travels whole as well as prettified: the page reads Jev's answers as a table from it.
    if(record.type==="vertex_orchestration"){if(current)current.details.push({type:record.report?.kind==="plan"?"Orchestrator JSON plan":record.report?.kind==="execution_mode"?"Orchestrator mode":record.report?.kind==="stage_verification"?"Orchestrator stage verification with Jev":"Orchestrator stage",text:prettyJson(record.report)});continue;}
    if(record.type==="vertex_tool_selection"){if(current)current.details.push({type:"Orchestrator tool selection",text:prettyJson(record.report)});continue;}
    if(record.type==="vertex_task_recovery" || record.type==="vertex_task_verification" && record.report?.recovery){if(current)current.details.push({type:"Recovery: "+(record.report?.recovery||"state"),text:[record.report?.attempt?"Attempt "+record.report.attempt:"",record.report?.status?"Last verdict: "+record.report.status:"",record.report?.error||""].filter(Boolean).join("\n"),failed:record.report?.recovery==="error"});continue;}
    if(record.type==="vertex_task_verification"){if(current)current.details.push({type:record.report?.scope==="changes"?"Change verification with Jev":"Task verification with Jev",verification:record.report,text:prettyJson(record.report),failed:record.report?.status==="failed"});continue;}
    if(record.type==="vertex_topic_routing"){if(current){if(record.report?.topic)current.topic=record.report.topic;if(record.report?.status==="skill")current.matchedSkill=record.report.skill||true;current.details.push({type:record.report?.kind==="context_selection"?"Context selection":record.report?.kind==="skill_search"||record.report?.status==="skill"?"Skill search":"Topic routing (Jev)",routing:record.report&&typeof record.report==="object"?record.report:null,text:prettyJson(record.report)});}continue;}
    if (record.type === "vertex_context_optimization") {
      if(current) {
        current.contextOptimization = record.report;
        current.details.push({type:"Context optimization (Jev)",text:prettyJson(record.report)});
      }
      continue;
    }
    if (record.type === "vertex_context_size" || record.type === "vertex_request") {
      const size = record.contextSize;
      if (current && !current.contextSize && Number.isSafeInteger(size?.characters) && size.characters >= 0
        && Number.isSafeInteger(size?.estimatedTokens) && size.estimatedTokens >= 0 && size.method === "characters/4") {
        current.contextSize = { characters: size.characters, estimatedTokens: size.estimatedTokens, method: size.method,
          ...(Number.isSafeInteger(size.bytes) && size.bytes >= 0 ? { bytes: size.bytes } : {}) };
      }
      if (current && Array.isArray(size?.ruleFiles) && size.ruleFiles.length) {
        const files = size.ruleFiles.filter(file => typeof file?.path === "string" && Number.isSafeInteger(file.bytes) && file.bytes >= 0);
        if (files.length) current.details.push({ type: "Prepared project rule sizes",
          text: "JSON-encoded rule text in the prepared prompt (included in its total; not additional bytes):\n" +
            files.map(file => file.path + ": " + file.bytes + " B" + (file.complete ? "" : " (partial)")).join("\n") });
      }
      if (current && Array.isArray(size?.sourceFiles) && size.sourceFiles.length) {
        const files = size.sourceFiles.filter(file => typeof file?.path === "string" && typeof file.kind === "string" && Number.isSafeInteger(file.bytes) && file.bytes >= 0);
        if (files.length) current.details.push({ type: "Prepared editor source sizes",
          text: "JSON-encoded source text in the prepared prompt (included in its total; not additional bytes):\n" +
            files.map(file => file.kind + " · " + file.path + ": " + file.bytes + " B" + (file.complete ? "" : " (partial)")).join("\n") });
      }
      if (record.type === "vertex_context_size") continue;
    }
    if (record.type === "vertex_api_request") {
      if (current && record.request) {
        const readResults = Array.isArray(record.readResults) ? record.readResults : [];
        current.details.push({ type: String(record.provider || "API") + " HTTP request",
          text: prettyJson({ requestSize: record.requestSize, readResults, request: record.request }),
          requestSize: record.requestSize || null, apiProvider: String(record.provider || "API") });
        for (const snapshot of record.vertex_snapshots || []) current.details.push({ type: "snapshot", snapshot });
        if (record.vertex_objects?.length) current.details.push({ type: "Referenced objects", objects: record.vertex_objects });
      }
      continue;
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
        current = { time: Number.isFinite(time) ? time : session.end, end: Number.isFinite(time) ? time : session.end, toolset: record.vertex_toolset || "", ...(pendingDecision ? { decision: pendingDecision } : {}),
          key: name + ":" + session.prompts.length, provider, branch: record.vertex_branch || "main", parent: record.vertex_parent || null,
          turnId: typeof record.vertex_turn === "string" ? record.vertex_turn : null,
          relatedTurnId: typeof record.vertex_related_turn === "string" ? record.vertex_related_turn : null,
          text: prompt.trim(), operation: String(record.vertex_operation || "Chat"), model: bareModel(record.message?.model, provider), displayModel: typeof record.message?.model_label === "string" && record.message.model_label.trim() ? record.message.model_label.trim() : bareModel(record.message?.model, provider),
          selectedModelId: typeof record.message?.model === "string" ? record.message.model : "", hasModelLabel: typeof record.message?.model_label === "string" && !!record.message.model_label.trim(), usage: emptyUsage(), details: [], open: true, objects: record.vertex_objects || [],
          screenshots: Array.isArray(record.vertex_screenshots) ? record.vertex_screenshots : [],
          // Model calls and tool calls in the order they happened.
          timeline: [] };
        session.prompts.push(current);
      } else if (current && Array.isArray(content)) {
        for (const block of content) if (block?.type === "tool_result") {
          const call = toolCalls.get(block.tool_use_id);
          const reference = !block.is_error && recordingReference(block.vertex_recording || block.content);
          const detail = { type: "tool result", tool_id: block.tool_use_id || "", text: prettyJson(block.content || ""), ...(block.is_error ? { failed: true } : {}),
            ...(Number.isSafeInteger(block.vertex_result_bytes) && block.vertex_result_bytes >= 0 ? { resultBytes: block.vertex_result_bytes } : {}),
            ...(block.vertex_change_counts && !block.is_error ? { changeCounts: block.vertex_change_counts } : {}),
            ...(block.vertex_change_preview && !block.is_error ? { changePreview: block.vertex_change_preview } : {}) };
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
      if(current && Number.isFinite(message.usage.cost_usd))reportedCosts.add(current);
      if (current && Object.prototype.hasOwnProperty.call(message.usage, "cost_usd")) {
        const last = current.timeline.filter(entry => entry.kind === "model").pop();
        if (last && (!message.usage.generation_id || last.id === message.usage.generation_id)) last.usage = message.usage;
      }
      sumUsage(session.usage, message.usage);
      if (current) sumUsage(current.usage, message.usage);
    }
    if (current) {
      if (message.model) current.model = bareModel(message.model, provider);
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
          session.toolCalls++;
          current.timeline.push({ kind: "tool", tool_id: detail.tool_id });
        }
      }
    }
    } finally {
      if (current) {
        const events=current.events||(current.events=[]), same=current===priorPrompt;
        const fresh=current.details.slice(same?detailStart:0);
        const actor=record.type==='vertex_task_recovery' || record.type==='vertex_task_verification' && record.report?.recovery ? 'VERTEX orchestrator'
          : record.type==='vertex_orchestration' || record.type==='vertex_tool_selection' ? 'MCP orchestrator'
          : record.type==='vertex_topic_routing' && (record.report?.kind==='context_selection' || record.report?.status==='fallback' && record.report?.beforeMessages===0 && record.report?.topic && record.report?.reason==='No previous topics to compare; full history retained.') ? 'VERTEX'
          : /vertex_task_verification|vertex_topic_routing|vertex_context_optimization/.test(record.type) ? 'Jev' : 'LLM';
        for(const item of current.timeline.slice(same?timelineStart:0))if(item.kind==='model'||item.kind==='note')events.push({kind:item.kind,actor:'LLM',time:Number.isFinite(time)?time:null,model:item});
        if(record.type==='vertex_api_request' && fresh.length) events.push({kind:'request',actor:'LLM',time:Number.isFinite(time)?time:null,apiRequest:true,provider:record.provider,requestSize:record.requestSize,details:fresh.map((_,i)=>current.details.length-fresh.length+i)});
        else if((record.type==='vertex_request' || record.type==='vertex_context_size') && fresh.length) events.push({kind:'request',actor:'LLM',time:Number.isFinite(time)?time:null,contextSize:record.contextSize,details:fresh.map((_,i)=>current.details.length-fresh.length+i)});
        else fresh.forEach((detail,i)=>{
          const tool=detail.type==='tool'?detail:detail.type==='tool result'?toolCalls.get(detail.tool_id):null;
          const who=tool?(tool.name==='Verification'?'Checks':'Tools'):actor;
          events.push({kind:detail.type==='tool'?'tool':detail.type==='tool result'?'tool_result':'detail',actor:who,time:Number.isFinite(time)?time:null,detail:current.details.length-fresh.length+i,tool:tool?.name});
        });
      }
    }

  }
  // Apply run estimates as cost only: the assistant records already carry the run's tokens.
  for(const [prompt,costs] of nativeCosts) {
    if(reportedCosts.has(prompt))continue;
    const cost=[...costs.values()].reduce((sum,value)=>sum+value,0);
    session.usage.cost=(session.usage.cost||0)-(prompt.usage.cost||0)+cost;
    session.usage.costEstimated=(session.usage.costEstimated||0)-(prompt.usage.costEstimated||0)+costs.size;
    if(prompt.usage.costMissing)session.usage.costMissing=Math.max(0,(session.usage.costMissing||0)-prompt.usage.costMissing);
    prompt.usage.cost=cost;prompt.usage.costEstimated=costs.size;delete prompt.usage.costMissing;
  }
  for(const prompt of session.prompts)prompt.costKind=require("./usage-report").costKind(prompt.operation,provider,prompt.model);
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

function readSessions(root, filter = {}) {
  root=require("./session-log").resolveRoot(root);
  if (!root) return { configured: false, folder: "", sessions: [] };
  const folder = path.join(root, "claude_compatible");
  if (!fs.existsSync(folder)) return { configured: true, folder, sessions: [] };
  const cacheKey = path.resolve(folder), cached = sessionFileCache.get(cacheKey) || new Map(), liveFiles = new Set(), sessions = [], placeCounts=new Map();
  const currentNames=new Set(require("./session-log").currentFiles(root).map(file=>path.basename(file)));
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    liveFiles.add(entry.name);
    if(fileNameDate(entry.name)&&!fileInDateRange(entry.name,null,filter,currentNames))continue;
    const file = path.join(folder, entry.name);
    let stat;
    try { stat = fs.statSync(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!fileInDateRange(entry.name, stat, filter, currentNames)) continue;
    const signature = stat.size + ":" + stat.mtimeMs + ":" + stat.ctimeMs;
    let item = cached.get(entry.name);
    if (!item || item.signature !== signature) {
      item = { signature, header: require("./session-log").readHeader(file), session: null };
    }
    const context=item.header?.vertex_context||null,key=placeKey(context),conversation=item.header?.vertex_related_conversation||item.header?.vertex_conversation||entry.name;
    if(!placeCounts.has(key))placeCounts.set(key,{key,context,conversations:new Set()});
    placeCounts.get(key).conversations.add(conversation);
    const requestedPlace=typeof filter.placeKey==="string"?filter.placeKey:"";
    if(requestedPlace&&(requestedPlace==="none"?!!key:key!==requestedPlace)){cached.set(entry.name,item);continue;}
    if(filter.place){
      const place=filter.place;
      const matches=place.mode==="both"
        ? context&&(context.mode==="both"&&context.folder===place.folder&&context.system===place.system&&(context.client||"")===(place.client||"")
          ||context.mode==="folder"&&context.folder===place.folder
          ||context.mode==="sap"&&context.system===place.system&&(context.client||"")===(place.client||""))
        : key===placeKey(place);
      if(!matches){cached.set(entry.name,item);continue;}
    }
    const sessionField=filter.listOnly?"listSession":"session";
    // A full session has all fields required by the sidebar list. Reuse it when
    // Session Logs has already parsed this unchanged file.
    if (filter.listOnly && !item.listSession && item.session) item.listSession = item.session;
    if(!item[sessionField]){
      item[sessionField]=parseSession(fs.readFileSync(file,"utf8"),entry.name,!!filter.listOnly);
      cached.set(entry.name,item);
    }
    const selectedSession=item[sessionField];
    if (selectedSession) sessions.push({ ...selectedSession, current: currentNames.has(entry.name), prompts: selectedSession.prompts.map(prompt => ({ ...prompt })) });
  }
  for (const name of cached.keys()) if (!liveFiles.has(name)) cached.delete(name);
  sessionFileCache.set(cacheKey, cached);
  sessions.sort((a, b) => b.start - a.start);
  // Topics tagged afterwards by Tag topics (Jev), kept beside the logs; a topic the log itself records wins.
  const tagged = new Map();
  for (const session of filter.listOnly ? [] : sessions) {
    if (!session.conversation) continue;
    if (!tagged.has(session.conversation)) tagged.set(session.conversation, require("./topic-backfill").readTags(folder, session.conversation));
    const tags = tagged.get(session.conversation);
    for (const prompt of session.prompts) if (!prompt.topic && tags[prompt.key]) prompt.topic = tags[prompt.key];
  }
  if(!filter.listOnly) {
    restoreContextSelections(sessions);
    // Older optimization audits stored the applied result only in their parent turn.
    // Link only an unambiguous exact turn, never by time or across conversations.
    for (const session of sessions) for (const prompt of session.prompts) {
      if (prompt.operation !== "Context optimization with Jev" || prompt.contextOptimization || !prompt.relatedTurnId || !session.relatedConversation) continue;
      const audits = sessions.filter(item => item.relatedConversation === session.relatedConversation).flatMap(item => item.prompts)
        .filter(item => item.operation === prompt.operation && item.relatedTurnId === prompt.relatedTurnId);
      const parents = sessions.filter(item => item.conversation === session.relatedConversation).flatMap(item => item.prompts)
        .filter(item => item.operation === "Chat" && item.turnId === prompt.relatedTurnId && item.contextOptimization);
      if (audits.length === 1 && parents.length === 1) prompt.contextOptimization = parents[0].contextOptimization;
    }
  }
  const places=[...placeCounts.values()].map(({conversations,...place})=>({...place,count:conversations.size}));
  return { configured: true, folder, sessions, places };
}

// Older routing records kept the exact message indices but not block sizes. Rebuild a
// read-only view only when the saved turns reproduce the recorded history length.
function restoreContextSelections(sessions) {
  const routing = require("./topic-routing"), conversations = new Map();
  for (const session of sessions) for (const prompt of session.prompts) if (prompt.operation === "Chat") {
    const key = session.conversation || session.id;
    if (!conversations.has(key)) conversations.set(key, []);
    conversations.get(key).push(prompt);
  }
  for (const prompts of conversations.values()) {
    prompts.sort((a,b)=>(a.time||0)-(b.time||0)||a.key.localeCompare(b.key));
    for (const prompt of prompts) {
      const report = prompt.details.find(detail => detail.routing?.keptIndices)?.routing;
      if (!report || report.contextReduction || !Number.isInteger(report.beforeMessages)) continue;
      const earlier = prompts.filter(item => item.time < prompt.time && item.branch === prompt.branch);
      const history = earlier.flatMap(item => {
        const topic = item.topic && typeof item.topic === "object" ? item.topic : null;
        const answer = item.details.filter(detail => detail.type === "answer").at(-1)?.text;
        const sourcePromptNumber = prompts.indexOf(item) + 1;
        return [{ role: "user", content: item.text, topic, sourcePromptNumber }, ...(answer ? [{ role: "assistant", content: answer, topic, sourcePromptNumber }] : [])];
      });
      if (history.length !== report.beforeMessages || !history.every(message => message.content && message.content !== "[not logged]")) continue;
      const kept = new Set(report.keptIndices);
      if ([...kept].some(index => !Number.isInteger(index) || index < 0 || index >= history.length)) continue;
      const serialized = messages => routing.serialize(messages.map(({sourcePromptNumber,...message})=>message)).length;
      const before = serialized(history), after = serialized(history.filter((_,index)=>kept.has(index)));
      prompt.contextReduction = { beforeCharacters: before, afterCharacters: after, estimatedSavedTokens: Math.max(0,Math.round((before-after)/4)),
        method: "characters/4", reconstructed: true, blocks: history.map((message,index)=>({index,role:message.role,sourcePromptNumber:message.sourcePromptNumber,topicId:message.topic?.id||"",topic:message.topic?.label||"",
          included:kept.has(index),estimatedTokens:Math.ceil(serialized([message])/4),preview:String(message.content).replace(/\s+/g," ").slice(0,100)})) };
    }
  }
}

/* The questions and answers of the conversation SESSION belongs to, in the order they were asked: every file that
   carries its conversation id (one per provider it used), or the file alone when it was written before ids existed.
   Commit and PR descriptions are separate operations, not turns of the chat. */
/** Where a conversation was held, as one comparable key; the page builds the same key for its filter. */
function placeKey(context) {
  if (!context) return "";
  if (context.mode === "zero") return "zero";
  if (context.mode === "both") return "both:" + context.folder + "|" + context.system + (context.client ? "/" + context.client : "");
  return context.mode === "folder" ? "folder:" + context.folder
    : "sap:" + context.system + (context.client ? "/" + context.client : "");
}

/** place: show only the conversations held there. The chat's own list passes the place it is working in. */
function isSkillRequest(prompt) {
  return Boolean(prompt.matchedSkill) || /^\s*\/?vsix\s*$/i.test(prompt.text || "");
}

function conversationList(report, place) {
  const groups = new Map();
  for (const session of report.sessions) {
    const prompts = session.prompts.filter(prompt =>
      (prompt.operation === "Chat" || prompt.operation === "Web search") && !isSkillRequest(prompt));
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
  const matchesPlace = context => {
    if (!place) return true;
    if (typeof place === "string") return placeKey(context) === place;
    if (!place || !context) return false;
    if (place.mode !== "both") return placeKey(context) === placeKey(place);
    return context.mode === "both" && context.folder === place.folder && context.system === place.system && (context.client || "") === (place.client || "")
      || context.mode === "folder" && context.folder === place.folder
      || context.mode === "sap" && context.system === place.system && (context.client || "") === (place.client || "");
  };
  return [...groups.values()].filter(group => matchesPlace(group.context)).map(group => {
    group.prompts.sort((a, b) => (a.time || 0) - (b.time || 0) || a.key.localeCompare(b.key));
    const first = group.prompts[0], last = group.prompts[group.prompts.length - 1];
    const preview = text => String(text || "").replace(/\s+/g, " ").slice(0, 180);
    const models = [...new Set(group.prompts.map(prompt => String(prompt.model || "").trim()).filter(Boolean))];
    return { id: last.sessionId, title: preview(first.text), lastQuestion: preview(last.text),
      time: last.time, count: group.prompts.length, providers: [...group.providers].join(" · "),
      model: models.length > 1 ? "multi use" : (models[0] || "") };
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
  const prompts = history(target).filter(prompt => !isSkillRequest(prompt));
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
        const directory = fs.realpathSync(path.resolve(report.folder, prompt.logId));
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
    return { ...(prompt.topic?{topic:prompt.topic}:{}), question: prompt.text, answer: notLogged(answer) ? "" : answer, provider: prompt.provider, model: prompt.model, time: prompt.time, logId: prompt.logId, conversation:session.conversation, key: prompt.key,
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
  const mode = ["sap", "folder", "both"].includes(config.get("contextMode", "auto")) ? config.get("contextMode") : chat.currentWorkingFolder(vscode) ? "folder" : "sap";
  const scope = require("./topic-routing").scopeOf(vscode, mode, mode === "folder" || mode === "both" ? folder : "");
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
    prompts: session.prompts.map(({ details, timeline, events, decision, ...recorded }) => {
      const displayModel = !recorded.hasModelLabel && modelCatalogs.get(session.provider)?.get(recorded.selectedModelId) || recorded.displayModel;
      const prompt = { ...recorded, displayModel };
      return { ...prompt, flow: require("./log-flow").summary({ ...prompt, details, timeline, events, decision }), toolCalls: (details || []).filter(d => d.type === "tool").length, text: require("./topic-routing").observations(prompt.text).question.slice(0,2000),
      sections: ["User",...(details?.some(d=>d.type==="answer")?["Model answer"]:[]),
        ...(details?.some(d=>d.type==="tool"||d.type==="tool result")||timeline?.some(t=>t.kind==="model")?["Steps"]:[]),
        ...(details||[]).filter(d=>!["answer","tool","tool result"].includes(d.type)).map(d=>d.snapshot?(d.snapshot.kind==="uml"?"Recorded UML":"Recorded metrics"):d.type==="Model request and context"?"Request and context":d.type)], lazy: true };
    }) })) };
}

/* Where the chat is working now, in the shape the log records. Session Logs opens on that place, so one
   folder's conversations are separated from another folder's and from a SAP system's without choosing
   anything. Derived the way chat.js derives it for the log itself, so the two cannot drift apart. */
function currentPlace(vscode) {
  try {
    const mode = vscode.workspace.getConfiguration("vertex.ai").get("contextMode", "auto");
    if (mode === "zero") return { mode: "zero" };
    const folders = vscode.workspace.workspaceFolders || [];
    const folder = mode === "sap" ? "" : require("./chat").workingFolder(vscode, "")
      || ((mode === "folder" || mode === "both") && folders.length === 1 ? folders[0].uri.fsPath : "");
    if (mode === "both" && folder) {
      const [, , system, client] = JSON.parse(require("./topic-routing").scopeOf(vscode, "sap", ""));
      return system ? { mode: "both", folder, system, ...(client ? { client } : {}) } : { mode: "folder", folder };
    }
    if (folder) return { mode: "folder", folder };
    const [, , system, client] = JSON.parse(require("./topic-routing").scopeOf(vscode, "sap", ""));
    return system ? { mode: "sap", system, ...(client ? { client } : {}) } : null;
  } catch (_) { return null; }
}

let panel, redrawLivePanel;
function resetLiveConversation(conversationId) {
  if (panel) void panel.webview.postMessage({ action: "resetLiveConversation", conversationId });
}
function sessionContext(root,id){
  if(typeof id!=="string"||!/^[\w.-]{1,240}$/.test(id))return null;
  const resolved=require("./session-log").resolveRoot(root);if(!resolved)return null;
  const header=require("./session-log").readHeader(path.join(resolved,"claude_compatible",id+".jsonl"));
  return header?.vertex_context&&typeof header.vertex_context==="object"?header.vertex_context:null;
}
function open(vscode, options = {}, context) {
  const root=vscode.workspace.getConfiguration("vertex.ai").get("logPath","");
  if(options.openSessionId&&!options.openSessionContext){const place=sessionContext(root,options.openSessionId);options={...options,openSessionContext:place,openSessionPlace:options.openSessionPlace||placeKey(place)||"none"};}
  if (panel) {
    panel.reveal(options.fullScreen ? vscode.ViewColumn.One : vscode.ViewColumn.Beside, false);
    if (options.openSessionId && options.openSessionLive && redrawLivePanel) redrawLivePanel(options);
    else if(options.openSessionId)void panel.webview.postMessage({action:"openConversation",id:options.openSessionId,conversationId:options.openConversationId||"",promptKey:options.openPromptKey||"",mode:options.openSessionMode||"logs",live:options.openSessionLive===true,placeKey:options.openSessionPlace||"",place:options.openSessionContext||null,date:options.openSessionDate||""});
    return panel;
  }
  panel = vscode.window.createWebviewPanel("vertex.logReport", "VERTEX: Logs & Cost", options.fullScreen ? vscode.ViewColumn.One : vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  // The page is shared with Eclipse; only here can a conversation continue in the chat.
  // Each page gets a new nonce, so its HTML always differs: VS Code ignores an assignment of identical HTML,
  // and a redraw that reassigns the same string never reloads the page.
  const pageHtml = () => { const nonce = crypto.randomBytes(16).toString("hex"); return fs.readFileSync(path.join(__dirname, "resources", "log-report.html"), "utf8").replaceAll("{{NONCE}}", nonce)
    .replace("</head>", () => '<script nonce="' + nonce + '">' + fs.readFileSync(path.join(__dirname, "resources", "three.min.js"), "utf8").replace(/<\/script/gi, "<\\/script") + '</script><script nonce="' + nonce + '">' + fs.readFileSync(path.join(__dirname, "log-flow.js"), "utf8").replace(/<\/script/gi, "<\\/script") + '</script></head>')
    .replace("</head>", () => "<style>" + require("./vertex-logo").fill(fs.readFileSync(path.join(__dirname, "resources", "vertex-controls.css"), "utf8")) + "</style></head>")
    .replace("</head>", () => '<script nonce="' + nonce + '">' + require("./usage-report").browserEngine() + 'window.vertexCanContinue = true;window.vertexCanOpenBashOutput = true;window.vertexCanReadVersions = ' + Boolean(options.readVersion) + ';window.vertexCanTagTopics = ' + require("./review-jev").enabled(vscode) + ';</script></head>')
    // VERTEX's one button style, as Eclipse's Session Logs and the other views get it; after the page's own rules, so it wins.
    .replace("</head>", () => "<style>" + require("./vertex-logo").fill(fs.readFileSync(path.join(__dirname, "resources", "vertex-controls.css"), "utf8")) + "</style></head>"); };
  panel.webview.html = pageHtml();
  // The page gets the list only - each prompt without its details, steps and Jev input - and asks for one prompt's
  // full record when it is opened: the whole log folder can be tens of megabytes, too much to hold in a webview.
  const view = panel;
  let pendingOpenSessionId=options.openSessionId||"", pendingOpenConversationId=options.openConversationId||"", pendingOpenSessionMode=options.openSessionMode||"logs", pendingOpenSessionLive=options.openSessionLive===true, pendingOpenSessionDate=options.openSessionDate||"";
  const initialDate=/^\d{4}-\d\d-\d\d$/.test(pendingOpenSessionDate)?pendingOpenSessionDate:dateKey(Date.now());
  let activeRange={from:initialDate,to:initialDate,placeKey:options.openSessionPlace||placeKey(currentPlace(vscode))};
  let full = null, promptIndex = new Map(), lastState = null, refreshing = false, refreshPending = false, ready = false, disposed = false, generation = 0;
  redrawLivePanel = target => {
    generation++;
    ready = false;
    lastState = null;
    pendingOpenSessionId = target.openSessionId;
    pendingOpenConversationId = target.openConversationId || "";
    pendingOpenSessionMode = target.openSessionMode || "flow";
    pendingOpenSessionLive = true;
    pendingOpenSessionDate = target.openSessionDate || "";
    options = target;
    const date = /^\d{4}-\d\d-\d\d$/.test(pendingOpenSessionDate) ? pendingOpenSessionDate : dateKey(Date.now());
    activeRange = { from: date, to: date, placeKey: target.openSessionPlace || placeKey(currentPlace(vscode)) };
    view.webview.html = pageHtml();
  };
  // Check metadata only while visible. Do not reparse an unchanged log folder every second.
  const logState = async (root, filter) => {
    const resolved = require("./session-log").resolveRoot(root);
    const folder = resolved ? path.join(resolved, "claude_compatible") : "";
    const files = [];
    const currentNames=new Set(require("./session-log").currentFiles(root).map(file=>path.basename(file)));
    if (folder) {
      try {
        const entries = await fs.promises.readdir(folder, { withFileTypes: true });
        const results = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl")
          && (!fileNameDate(entry.name) || fileInDateRange(entry.name,null,filter,currentNames))).map(async entry => {
          try {
            const stat = await fs.promises.stat(path.join(folder, entry.name));
            return fileInDateRange(entry.name, stat, filter, currentNames) ? [entry.name, stat.size, stat.mtimeMs, stat.ctimeMs] : null;
          } catch (error) { if (error.code !== "ENOENT") throw error; return null; }
        }));
        files.push(...results.filter(Boolean));
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return JSON.stringify([folder, modelCatalogRevision, [...currentNames].sort(), files.sort((a,b) => a[0].localeCompare(b[0]))]);
  };
  const refresh = async (automatic = false) => {
    if (disposed || automatic && (!ready || !view.visible)) return;
    if (refreshing) { refreshPending = true; return; }
    refreshing = true;
    const refreshGeneration = generation;
    try {
      const root = vscode.workspace.getConfiguration("vertex.ai").get("logPath", "");
      const state = await logState(root, activeRange);
      if (disposed || refreshGeneration !== generation || automatic && (!view.visible || state === lastState)) return;
      full = readSessions(root, activeRange);
      promptIndex = new Map(full.sessions.flatMap(session => session.prompts).map(prompt => [prompt.key,prompt]));
      const delivered = await view.webview.postMessage({ action: "data", automatic,
        usageRows: require("./usage-report").readUsage(root, activeRange).rows, report: { ...listReport(full), current: currentPlace(vscode) } });
      if (disposed || refreshGeneration !== generation) return;
      if(pendingOpenSessionId){const id=pendingOpenSessionId,conversationId=pendingOpenConversationId,mode=pendingOpenSessionMode,live=pendingOpenSessionLive,placeKey=options.openSessionPlace||"",place=options.openSessionContext||null,date=pendingOpenSessionDate;pendingOpenSessionId="";await view.webview.postMessage({action:"openConversation",id,conversationId,promptKey:options.openPromptKey||"",mode,live,placeKey,place,date});}
      if (delivered !== false) lastState = state;
    } catch (error) {
      if (!disposed && !automatic) await view.webview.postMessage({ action: "error", error: error.message });
      // Transient writes/deletes are retried on the next tick; keep the last readable report.
    } finally {
      refreshing = false;
      if (refreshPending && !disposed) {
        refreshPending = false;
        Promise.resolve().then(() => refresh(true));
      }
    }
  };
  const timer = setInterval(() => refresh(true), 250);
  timer.unref?.();
  const visibility = view.onDidChangeViewState?.(() => { if (view.visible) return refresh(true); });
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.action === "ready" || message?.action === "refresh") { ready = true; await refresh(); }
    if (message?.action === "dateRange") {
      const next=dateRange({from:message.from,to:message.to});
      if(next.from&&next.to&&next.from>next.to)return;
      activeRange={...next,placeKey:activeRange.placeKey};lastState=null;await refresh();
    }
    if(message?.action==="placeFilter"){
      activeRange={...activeRange,placeKey:typeof message.key==="string"?message.key:""};lastState=null;await refresh();
    }
    if (message?.action === "promptDetail") {
      const key = String(message.key || "");
      const prompt = promptIndex.get(key);
      await panel?.webview.postMessage(prompt ? { action: "promptDetail", key, prompt: { text: prompt.text, details: prompt.details, timeline: prompt.timeline, events: prompt.events, decision: prompt.decision || null } }
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
        let decision=message.decision;
        if(!decision){
          const report=readSessions(vscode.workspace.getConfiguration("vertex.ai").get("logPath", ""));
          decision=report.sessions.flatMap(session=>session.prompts).find(prompt=>prompt.key===message.key)?.decision;
        }
        if(!decision)throw new Error("This step has no saved Jev input. Enable question logging for future runs.");
        await vscode.commands.executeCommand("vertex.continueDecision",decision);
      } catch(error){vscode.window.showErrorMessage("VERTEX: "+error.message);}
    }
    if (message?.action === "rerunDecision") {
      const id=String(message.id||"");
      const send=payload=>panel?.webview.postMessage({action:"decisionRerun",id,...payload});
      let audit;
      try {
        const decision=message.decision,provider=String(decision?.provider||""),model=String(decision?.model||"");
        if(!/^jev-run-[a-z0-9-]{1,100}$/i.test(id))throw new Error("Invalid Jev rerun request.");
        if(!["typesafe-api","gemini-api","opencode-api"].includes(provider)||!model)throw new Error("The saved input has no supported Jev provider and model.");
        require("./jev").validate(decision.state,decision.questions);
        const validModel=provider==="typesafe-api"?/^jev[-\w.]*$/.test(model)
          :provider==="gemini-api"?model.replace(/^models\//,"")==="gemini-decision-1"
          :require("./opencode-models").isDecision(model);
        if(!validModel)throw new Error("The saved model is not a Jev decision model.");
        const modelConfig=require("./model-config"),config=modelConfig.read(vscode,provider);
        if(!modelConfig.isOn(vscode,provider)||config.enabled&&!config.enabled.includes(model))throw new Error("Enable this provider and model in LLM Providers before rerunning the saved Jev request.");
        if(!context?.secrets)throw new Error("The active extension secret store is unavailable.");
        const {key}=await require("./key-profiles").getActiveKey(context.secrets,provider);
        if(!key)throw new Error("Add or select an API key for "+provider+" in LLM Providers.");
        audit=require("./ai-accounting").begin(vscode,provider,model,"Rerun saved Jev decision",require("./session-log").independentScope());
        audit.decision(decision);
        const result=await require("./jev").evaluate(provider,key,model,decision.state,decision.questions,audit.callbacks);
        audit.finish(result);
        await send({result:{text:require("./jev").formatAnswers(decision.questions,result.answers),usage:result.usage,model:result.model,elapsedMs:result.elapsedMs}});
      } catch(error) {
        audit?.fail(error);
        await send({error:String(error.message||error).slice(0,1200)});
      }
    }
    if (message?.action === "openSnapshot") {
      try { require("./log-snapshot").open(vscode, message.snapshot); }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }
    if (message?.action === "openScreenshot") {
      // Only a screenshot saved in the configured log folder opens, in VS Code's own image viewer.
      try {
        const root = fs.realpathSync(path.resolve(vscode.workspace.getConfiguration("vertex.ai").get("logPath", "") || "", "claude_compatible"));
        const file = fs.realpathSync(String(message.file || ""));
        if (!/\.(png|jpe?g|gif|webp)$/i.test(file) || path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file))) {
          throw new Error("That screenshot is not in the log folder.");
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside });
      } catch (error) { vscode.window.showErrorMessage("VERTEX: " + error.message); }
    }
    if (message?.action === "openBashOutput") {
      try {
        const prompt = promptIndex.get(String(message.key || ""));
        const toolId = String(message.toolId || "");
        const call = prompt?.details.find(detail => detail.type === "tool" && detail.name === "Bash" && detail.tool_id === toolId);
        const detail = call && prompt.details.find(item => item.type === "tool result" && item.tool_id === toolId);
        let data;
        try { data = detail && JSON.parse(prettyJson(detail.text)); } catch (_) { /* old or clipped log */ }
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("This Bash result is not available in the session log.");
        let document;
        if (typeof data.output_file === "string" && !data.log_error) {
          const configured = vscode.workspace.getConfiguration("vertex.ai").get("logPath", "");
          const base = require("./session-log").resolveRoot(configured);
          if (!base) throw new Error("No log folder is configured.");
          const root = fs.realpathSync(path.join(base, "command-output"));
          const file = path.resolve(data.output_file);
          const folder = path.dirname(file);
          if (path.basename(file) !== "output.log" || !/^[a-f0-9-]{36}$/i.test(path.basename(folder)) ||
              fs.lstatSync(folder).isSymbolicLink() || fs.lstatSync(file).isSymbolicLink() ||
              fs.realpathSync(file) !== path.join(root, path.basename(folder), "output.log")) throw new Error("That command output file is not in the configured log folder.");
          document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        } else {
          if (typeof data.stdout !== "string" && typeof data.stderr !== "string") throw new Error("No Bash output was saved in this session log.");
          const note = data.output_truncated || data.log_error ? "Recorded output is partial.\n\n" : "Recorded output may be sanitized or limited by logging settings.\n\n";
          document = await vscode.workspace.openTextDocument({ language: "plaintext", content: note + "stdout:\n" + (data.stdout || "") + "\n\nstderr:\n" + (data.stderr || "") });
        }
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
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
        await vscode.commands.executeCommand("vertex.runSelect", { sql: message.sql, system: ["sap","both"].includes(session.context?.mode) ? session.context.system : undefined });
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
          system: ["sap","both"].includes(session.context?.mode) ? session.context.system : "", client: session.context?.client });
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
  panel.onDidDispose(() => { disposed = true; clearInterval(timer); visibility?.dispose(); if (panel === view) { panel = undefined; redrawLivePanel = undefined; } });
  return panel;
}

function register(vscode, context, options) {
  context.subscriptions.push(vscode.commands.registerCommand("vertex.showLogs", target => open(vscode, target?.sessionId ? {...options,
    openSessionId:String(target.sessionId),fullScreen:target.fullScreen===true,openSessionMode:target.mode==="flow"?"flow":"logs",openSessionLive:target.live===true,
    openPromptKey:typeof target.promptKey==="string"?target.promptKey:"",openConversationId:typeof target.conversationId==="string"?target.conversationId:"",openSessionPlace:typeof target.placeKey==="string"?target.placeKey:"",
    openSessionDate:/^\d{4}-\d\d-\d\d$/.test(target.date||"")?target.date:""} : options, context)));
}

module.exports = { listReport, setModelCatalog, tagTopics, parseSession, readSessions, register, open, resetLiveConversation, prettyJson, prettyRequest, recordingReference, clearConversations, conversationTurns, conversationList, currentPlace, placeKey };
