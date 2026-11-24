"use strict";

// The log's lightweight graphical index and browser renderer. Full source and answer bodies
// stay behind the promptDetail bridge; the index carries short summaries of service results.
(function (root) {
  function modelName(prompt) {
    return prompt.displayModel || prompt.model || prompt.provider || "Model unknown";
  }
  function timeBreakdown(prompt) {
    const total = Number.isFinite(prompt.time) && Number.isFinite(prompt.end) ? Math.max(0, prompt.end - prompt.time) : 0;
    const open = new Map(), intervals = [];
    for (const event of prompt.events || []) {
      const detail = prompt.details?.[event.detail], id = detail?.tool_id;
      if (!id || !Number.isFinite(event.time)) continue;
      if (event.kind === "tool") open.set(id, event.time);
      else if (event.kind === "tool_result" && open.has(id)) {
        const from = Math.max(prompt.time, open.get(id)), to = Math.min(prompt.end, event.time);
        if (to > from) intervals.push([from, to]);
        open.delete(id);
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let toolMs = 0, edge = -Infinity;
    for (const [from, to] of intervals) { toolMs += Math.max(0, to - Math.max(from, edge)); edge = Math.max(edge, to); }
    toolMs = Math.min(total, toolMs);
    return { totalMs: total, toolMs, modelHostMs: total - toolMs, incompleteTools: open.size > 0 };
  }
  // A CLI run is an aggregate, not another model call. Show only fields the provider recorded.
  function providerUsage(detail) {
    if (!/^Provider usage \(cli_run\)$/.test(detail?.type || "")) return [];
    let data;
    try { data = JSON.parse(detail.text); } catch { return []; }
    const response = data?.response;
    if (!response || typeof response !== "object") return [];
    const lines = [], numeric = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
    const money = value => "$" + value.toLocaleString("en-US", { maximumFractionDigits: 8, useGrouping: false });
    if (numeric(response.total_cost_usd)) lines.push((data.provider === "codemie" ? "Estimated" : "Provider-reported") + " run cost · " + money(response.total_cost_usd));
    const tokens = (usage, fields) => fields.filter(([key]) => numeric(usage?.[key]))
      .map(([key, label]) => usage[key].toLocaleString() + " " + label).join(" · ");
    const total = tokens(response.usage, [["input_tokens", "input"], ["output_tokens", "output"], ["cache_read_input_tokens", "cache read"], ["cache_creation_input_tokens", "cache write"]]);
    if (total) lines.push("Run tokens · " + total);
    if (response.modelUsage && typeof response.modelUsage === "object" && !Array.isArray(response.modelUsage)) {
      for (const [model, usage] of Object.entries(response.modelUsage).slice(0, 50)) {
        const parts = tokens(usage, [["inputTokens", "input"], ["outputTokens", "output"], ["cacheReadInputTokens", "cache read"], ["cacheCreationInputTokens", "cache write"]]);
        const cost = numeric(usage?.costUSD) ? (data.provider === "codemie" ? "estimated " : "provider-reported ") + money(usage.costUSD) : "";
        if (parts || cost) lines.push(String(model).slice(0, 120) + " · " + [parts, cost].filter(Boolean).join(" · "));
      }
    }
    return lines;
  }

  function recognitionText(text) {
    const value = String(text || "");
    try { const parsed = JSON.parse(value); return typeof parsed?.answer === "string" ? parsed.answer : value; }
    catch { return value; }
  }

  function summary(prompt) {
    const details = prompt.details || [], timeline = prompt.timeline || [];
    const calls = details.filter(d => d.type === "tool");
    const checks = calls.filter(d => /^(?:Verification|Lint|Tests?)$/i.test(d.name || ""));
    const reviews = calls.filter(d => d.name === "Review");
    const jev = details.map((detail, index) => ({ ...detail, detailIndex: index })).filter(d => /Jev|Skill search|Orchestrator|Recovery:/i.test(d.type || ""));
    if (!jev.length && prompt.decision) jev.push({ type: "Jev decision", section: "Model answer" });
    const eventTime = index => (prompt.events || []).find(event => event.detail === index)?.time || prompt.time || 0;
    const resultOf = call => details.find(d => d.type === "tool result" && d.tool_id === call.tool_id);
    const stateOf = call => {
      const result = resultOf(call), text = result?.text || "";
      if (/automatic checks: FAILED/.test(text)) return "failed";
      if (/automatic checks: UNVERIFIED/.test(text)) return "unverified";
      if (/automatic checks: PASSED/.test(text)) return "passed";
      if (result?.failed) return "failed";
      return result ? "recorded" : "unknown";
    };
    const models = timeline.filter(t => t.kind === "model");
    const answerText = details.filter(d => d.type === "answer").map(d => d.text || "").join("\n");
    const choice = /^Answer:\s*(.+)$/m.exec(answerText)?.[1] || "";
    const confidence = /^Confidence:\s*(.+)$/m.exec(answerText)?.[1] || "";
    const probability = choice && answerText.split(/\r?\n/).find(line => line.startsWith(choice + ": "))?.slice(choice.length + 2) || "";
    let toolNumber = 0;
    const stepItems = timeline.filter(item => item.kind === "tool").map(item => {
      const call = calls.find(d => d.tool_id === item.tool_id);
      const input = call?.input || {};
      const detail = input.file_path || input.pattern || input.description || input.command || "Recorded call";
      return { kind: "tool", label: "Tool " + (++toolNumber) + " · " + (call?.name || "unknown"),
        detail: String(detail).replace(/\s+/g, " ").slice(0, 100), time: eventTime(details.indexOf(call)) };
    });
    let noteEventIndex = null, notePreview = "", modelRound = 0;
    const eventItems = (prompt.events || []).map((event, order) => {
      if (event.kind === "note") {
        if (noteEventIndex === null) noteEventIndex = order;
        const text = (prompt.operation === "Screenshot recognition" ? recognitionText(event.model?.text) : String(event.model?.text || "")).replace(/\s+/g, " ").trim();
        notePreview = String(event.model?.text || "").split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 110) || "";
        return { kind: "note", title: "Thinking", time: event.time || prompt.time || 0, order,
          preview: text.slice(0, 600), noteEventIndex, notePreview, state: "recorded" };
      }
      // Provider responses are model-processing steps. Hiding them makes tool calls
      // look as if they happened before the model was started.
      if (event.kind === "model") {
        noteEventIndex = null;
        const events = prompt.events || [], detailIndices = [], noteEventIndices = [];
        let end = order + 1;
        while (end < events.length && events[end].kind !== "model" && events[end].kind !== "request") end++;
        // CLI text can arrive before its response metadata. Consecutive notes immediately
        // before the next response belong to that response, not the preceding tool round.
        // In an open run the next response has not arrived yet, so the same notes stay out of this round.
        let trailingNotes = end;
        if (events[end]?.kind === "model" || (prompt.open === true && end >= events.length))
          while (trailingNotes > order + 1 && events[trailingNotes - 1].kind === "note") trailingNotes--;
        for (let index = order - 1; index >= 0 && events[index].kind === "note"; index--) noteEventIndices.unshift(index);
        for (let index = order + 1; index < end; index++) {
          const item = events[index], detail = details[item.detail];
          if (detail?.type === "answer" || detail?.type === "tool") detailIndices.push(item.detail);
          if (item.kind === "note" && index < trailingNotes) noteEventIndices.push(index);
        }
        const round = ++modelRound, linked = detailIndices.map(index => details[index]);
        const toolCalls = linked.filter(detail => detail.type === "tool");
        const compact = value => String(value || "").replace(/\s+/g, " ").trim();
        const text = linked.filter(detail => detail.type === "answer").map(detail => detail.text || "").join("\n")
          || noteEventIndices.map(index => events[index].model?.text || "").join("\n");
        const toolPreview = toolCalls.slice(0, 3).map(detail => {
          const input = detail.input || {}, name = detail.name || "Tool";
          return name + (input.description || input.file_path || input.pattern || input.command
            ? ": " + compact(input.description || input.file_path || input.pattern || input.command).slice(0, 70) : "");
        }).join(" · ");
        const outcome = toolCalls.length ? toolCalls.length + (toolCalls.length === 1 ? " tool call" : " tool calls")
          : text ? "Text response" : "Metadata only";
        const usage = event.model?.usage || {}, tokenInfo = [];
        for (const [key, label] of [["input_tokens", "in"], ["output_tokens", "out"]]) {
          if (Number.isFinite(usage[key])) tokenInfo.push(Number(usage[key]).toLocaleString() + " " + label);
        }
        return { kind: "model", title: "LLM processing · round " + round,
          time: event.time || prompt.time || 0, order, model: event.model, detailIndices, noteEventIndices, round, toolCount: toolCalls.length,
          preview: compact(toolPreview || (prompt.operation === "Screenshot recognition" ? recognitionText(text) : text)).slice(0, 360),
          label: [modelName(prompt), outcome, ...tokenInfo].join(" · "),
          state: "recorded" };
      }
      noteEventIndex = null;
      if (event.kind === "user_interjection") return { kind: "user_interjection", title: "User addition",
        time: event.time || prompt.time || 0, order, preview: event.text || "Question text not logged",
        label: event.state === "sent" ? "Added to the next model request" : "Queued · not yet sent to the model", state: "recorded" };
      noteEventIndex = null;
      const detail = details[event.detail];
      const input = detail?.input || {};
      const toolName = detail?.name || event.tool || "Tool";
      const toolExplanation = input.description ? "Purpose: " + input.description
        : toolName === "Bash" && input.command ? "Command: " + input.command
        : toolName === "Glob" && input.pattern ? "Pattern: " + input.pattern + (input.path ? " · in " + input.path : "")
        : toolName === "Grep" && input.pattern ? "Pattern: " + input.pattern + (input.path ? " · in " + input.path : "")
        : input.file_path || input.path || input.pattern || input.action || "";
      const title = event.kind === "request" ? "LLM request with system prompt and tools" : event.kind === "tool_result" ? (event.tool || "Tool") + " result"
        : event.kind === "tool" ? toolName
        : detail?.routing?.kind === "context_selection" ? "Context selection · Full history"
        : detail?.routing?.status === "skill" ? "Skill search"
        : detail?.type === "answer" ? "Response" : detail?.type || "Recorded step";
      const preview = event.kind === "request"
        ? String(prompt.text || "").replace(/\s+/g, " ").slice(0, 180)
        : detail?.type === "answer"
          ? (prompt.operation === "Screenshot recognition" ? recognitionText(detail.text) : String(detail.text || "")).replace(/\s+/g, " ").slice(0, 180)
          : detail?.type === "thinking"
            ? String(detail.text || "").split(/\r?\n/).map(line => line.replace(/^\s*(?:#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/, "").replace(/\*\*/g, "").trim()).filter(Boolean).join(" ").slice(0, 600)
            : "";
      let operationPreview = "", operationDiff = null;
      if (event.kind === "tool" && detail) {
        const result = detail.tool_id ? resultOf(detail) : null;
        let input = detail.input || {};
        if (!Object.keys(input).length && detail.text) {
          try { input = JSON.parse(String(detail.text).slice(String(detail.text).indexOf("\n") + 1)); } catch { input = {}; }
        }
        const compact = value => String(value || "").replace(/\s+/g, " ").trim();
        if (detail.name === "Edit" && result && !result.failed && typeof input.old_string === "string" && typeof input.new_string === "string") {
          const before = input.old_string.split(/\r?\n/), after = input.new_string.split(/\r?\n/);
          let start = 0;
          while (start < before.length && start < after.length && before[start] === after[start]) start++;
          let endBefore = before.length - 1, endAfter = after.length - 1;
          while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) { endBefore--; endAfter--; }
          const removed = before.slice(start, endBefore + 1), added = after.slice(start, endAfter + 1);
          const oldLines = removed.slice(0, 2), newLines = added.slice(0, 2);
          operationDiff = { removed: oldLines, added: newLines,
            changes: Array.from({ length: Math.max(oldLines.length, newLines.length) }, (_, index) => {
              const before = index < oldLines.length ? oldLines[index] : null;
              const after = index < newLines.length ? newLines[index] : null;
              if (before === null) return { prefix: "", removed: "", added: after, suffix: "" };
              if (after === null) return { prefix: "", removed: before, added: "", suffix: "" };
              let prefix = 0, suffix = 0;
              while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
              while (suffix < before.length - prefix && suffix < after.length - prefix
                && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
              const overlap = Math.max(before.slice(0, prefix).trim().length, suffix ? before.slice(before.length - suffix).trim().length : 0);
              if (overlap < 2) return [
                { prefix: "", removed: before, added: "", suffix: "" },
                { prefix: "", removed: "", added: after, suffix: "" }
              ];
              return { prefix: before.slice(0, prefix), removed: before.slice(prefix, before.length - suffix),
                added: after.slice(prefix, after.length - suffix), suffix: suffix ? before.slice(-suffix) : "" };
            }).flatMap(change => Array.isArray(change) ? change : [change]) };
        } else {
          let answer = result?.text || "";
          let data = answer;
          for (let depth = 0; depth < 4 && typeof data === "string"; depth++) {
            try { data = JSON.parse(data); } catch { break; }
          }
          if (data && typeof data === "object" && !Array.isArray(data)) {
            if (detail.name === "Bash") {
              const code = typeof data.code === "number" ? "Exit code: " + data.code : "";
              const output = data.code !== 0 && data.stderr ? data.stderr : data.stdout || data.stderr;
              answer = [code, data.output_truncated ? "Output truncated" : "", output].filter(Boolean).join(" · ");
              if (!answer) answer = result.text;
            } else answer = JSON.stringify(data);
          } else if (typeof data === "string") answer = data;
          answer = compact(answer);
          operationPreview = answer ? "Result: " + answer.slice(0, 240) : result ? "Result recorded (empty)" : "Result not recorded";
        }
      }
      const usagePreview = providerUsage(detail);
      return { kind: event.kind, title: String(title).replace(/\s+/g," ").slice(0,110), time: event.time || prompt.time || 0, order,
        ...(usagePreview.length ? { usagePreview: usagePreview.slice(0, 4) } : {}),
        ...(preview ? { preview } : {}), ...(operationPreview ? { operationPreview } : {}), ...(operationDiff ? { operationDiff } : {}), detailIndex: event.detail, detailIndices: event.kind === "request" ? event.details : undefined,
        skillName: detail?.routing?.skill || detail?.routing?.candidate, skillStatus: detail?.routing?.status,
        skillProbability: detail?.routing?.probability,
        ...(event.kind === "tool" && toolExplanation ? { explanation: String(toolExplanation).replace(/\s+/g," ").slice(0,160) } : {}),
        noteEventIndex, notePreview,
        fileName: String(detail?.input?.file_path || detail?.input?.path || "").split(/[\\/]/).pop(),
        toolId: detail?.tool_id || "", state: detail?.type === "tool" && checks.includes(detail) ? stateOf(detail) : detail?.failed ? "failed" : "recorded" };
    }).filter(Boolean);
    const routing = details.findLast(d => d.routing?.contextReduction)?.routing;
    const reduction = routing?.contextReduction || prompt.contextReduction;
    return {
      timing: timeBreakdown(prompt),
      screenshots: (prompt.screenshots || []).map((shot, index) => ({ title: "Screenshot " + (index + 1), preview: String(shot.description || "Image attachment").replace(/\s+/g, " ").slice(0, 110) })),
      contextReduction: reduction ? { skill: routing?.skill || null, estimatedSavedTokens: reduction.estimatedSavedTokens, estimatedTopicSavedTokens: reduction.estimatedTopicSavedTokens,
        estimatedDuplicateSavedTokens: reduction.estimatedDuplicateSavedTokens, beforeCharacters: reduction.beforeCharacters,
        topicAfterCharacters: reduction.topicAfterCharacters, afterCharacters: reduction.afterCharacters, skillCharacters: reduction.skillCharacters,
        currentPromptCharacters: reduction.currentPromptCharacters, method: reduction.method, reconstructed: Boolean(reduction.reconstructed),
        blocks: (reduction.blocks || []).map(block => ({ index: block.index, role: block.role, sourcePromptNumber: block.sourcePromptNumber,
          topicId: block.topicId, topic: String(block.topic || "").slice(0, 80),
          included: Boolean(block.included), reason:block.reason, preferredPromptNumber:block.preferredPromptNumber,
          estimatedTokens: block.estimatedTokens, preview: String(block.preview || "").slice(0, 100) })) } : null,
      jev: jev.map(d => ({ label: d.type, time: eventTime(d.detailIndex),
        detail: /^Recovery: started$/i.test(d.type) ? "Automatic retry started"
          : /^Recovery: finished$/i.test(d.type) ? "Automatic retry completed"
          : /^Recovery: awaiting user$/i.test(d.type) ? "Waiting for user continuation"
          : d.verification?.status ? String(d.verification.status).toUpperCase()
          : /Topic routing/i.test(d.type) ? "Topic selected by Jev" : "Recorded operation",
        ...(d.section ? { section: d.section } : {}),
        ...(d.verification?.status ? { state: d.verification.status } : {}) })),
      models: models.length, cliTurns: models.filter(t => t.usageScope === "cli_turn").length, stepItems, eventItems,
      answerPreview: prompt.operation === "Screenshot recognition" ? recognitionText(answerText).replace(/\s+/g, " ").slice(0, 130) : "",
      jevOutcome: /Jev/i.test(prompt.operation || "") && choice ? (probability ? "P " + probability + " · " : "")
        + (confidence ? "C " + confidence + " · " : "") + choice : "",
      tools: calls.filter(d => !checks.includes(d) && !reviews.includes(d)).length,
      checks: checks.map(d => ({ id: d.tool_id, label: d.name, state: stateOf(d) })),
      reviews: reviews.map(d => ({ id: d.tool_id, label: "Review", state: "recorded" })),
      answer: details.some(d => d.type === "answer"), failed: Boolean(prompt.failed)
    };
  }

  function stages(prompt) {
    const flow = prompt.flow || summary(prompt);
    const decisions = flow.jev.map(item => ({ kind: /Orchestrator|Recovery:/i.test(item.label) ? "vertex" : "jev", present: true, title: item.label, label: item.detail || "", section: item.section || item.label, state: item.state || "recorded", time: item.time || prompt.time || 0 }));
    const recordedSteps = (flow.stepItems || []).map((item, index) => ({ kind: item.kind, present: true,
      title: item.label, label: item.detail || "", section: "Steps (chronological)", state: "recorded", stepIndex: index, time: item.time || prompt.time || 0 }));
    return [
      { kind: "prompt", present: true, title: "Prompt", label: String(prompt.text || "(prompt text not logged)").replace(/\s+/g, " ").slice(0, 110), section: "User", state: "recorded", time: prompt.time || 0 },
      ...decisions,
      ...recordedSteps,
      { kind: "answer", present: flow.failed || flow.answer, title: "Answer", label: flow.failed ? "Request failed" : "Model answer", section: "Model answer", state: flow.failed ? "failed" : "recorded", time: prompt.end || prompt.time || 0 }
    ].filter(node => node.present);
  }

  function contextStages(prompt, requestNumber) {
    const reduction = prompt.flow?.contextReduction;
    if (!reduction) return [{ kind: "prompt", title: "Context unavailable", label: "This request has no recorded context selection. Older logs cannot show excluded blocks.", state: "unknown" }];
    if (reduction.skill) {
      const before = Number(reduction.beforeCharacters || 0), after = Number(reduction.afterCharacters || 0);
      const excluded = before ? Math.max(0, Math.min(100, Math.round(100 * (before - after) / before))) : 0;
      return [{ kind: "prompt", title: "Skill matched · " + reduction.skill,
        label: excluded + "% of previous conversation excluded", state: "recorded" }];
    }
    const question = String(prompt.text || ""), loggedQuestion = question && question !== "[not logged]";
    const currentCharacters = Number.isFinite(reduction.currentPromptCharacters) ? reduction.currentPromptCharacters : loggedQuestion ? question.length : 0;
    const current = { kind: "included", topicId: prompt.topic?.id || "", estimatedTokens: Math.ceil(currentCharacters / 4), title: (requestNumber ? "Prompt " + requestNumber + " · " : "") + "Included · current question",
      label: "≈ " + Math.ceil(currentCharacters / 4).toLocaleString() + " tokens · " + (loggedQuestion ? question.replace(/\s+/g," ").slice(0,100) : "Question text not logged"), state: "recorded" };
    const blocks = (reduction.blocks || []).filter(block => block.included).map(block => ({ kind: "included", topicId: block.topicId, estimatedTokens: block.estimatedTokens,
      title: (block.sourcePromptNumber ? "From prompt " + block.sourcePromptNumber + " · " : "") + "Included · " + block.role,
      label: (block.topic ? block.topic + " · " : "") + "≈ " + Number(block.estimatedTokens || 0).toLocaleString() + " tokens · " + block.preview,
      state: "recorded", preview: block.preview }));
    const beforeCharacters = Number(reduction.beforeCharacters || 0) + currentCharacters, afterCharacters = Number(reduction.afterCharacters || 0) + currentCharacters;
    const before = Math.ceil(beforeCharacters / 4), after = Math.ceil(afterCharacters / 4), includedPercent = beforeCharacters ? Math.min(100,Math.round(100 * afterCharacters / beforeCharacters)) : 100;
    const numbered=[current,...blocks].map((block,index)=>({...block,title:(index+1)+". "+block.title}));
    const included=numbered;
    const section=(role,items)=>({kind:"section",sectionRole:role,title:(role==="included"?"Included":"Excluded")+" · "+items.length+(items.length===1?" block":" blocks"),
      label:"≈ "+items.reduce((sum,item)=>sum+Number(item.estimatedTokens||0),0).toLocaleString()+" tokens",state:"recorded"});
    return [{ kind: "prompt", title: "Conversation context", label: (reduction.reconstructed ? "Reconstructed · " : "") + includedPercent + "% included · ≈ " + after.toLocaleString() + " / " + before.toLocaleString() + " tokens · ≈ " + Number(reduction.estimatedSavedTokens || 0).toLocaleString() + " saved", state: "recorded" },
      section("included",included),...included];
  }

  function contextStats(groups) {
    let before=0,after=0,covered=0,reconstructed=0,duplicateSaved=0,topicSaved=0,skillSaved=0,unattributedSaved=0;
    for(const group of groups){const prompt=group.prompt,reduction=prompt.flow?.contextReduction;if(!reduction)continue;
      const logged=prompt.text && prompt.text!=="[not logged]"?String(prompt.text).length:0;
      const current=Number.isFinite(reduction.currentPromptCharacters)?reduction.currentPromptCharacters:logged;
      const requestBefore=Math.ceil((Number(reduction.beforeCharacters||0)+current)/4),
        requestAfter=Math.ceil((Number(reduction.afterCharacters||0)+current)/4),requestSaved=Math.max(0,requestBefore-requestAfter);
      before+=requestBefore;after+=requestAfter;
      if(reduction.skill)skillSaved+=requestSaved;
      else if(Number.isFinite(reduction.topicAfterCharacters)){
        const requestTopicAfter=Math.ceil((reduction.topicAfterCharacters+current)/4);
        topicSaved+=Math.max(0,requestBefore-requestTopicAfter);
        duplicateSaved+=Math.max(0,requestTopicAfter-requestAfter);
      }else if((reduction.blocks||[]).some(block=>block.reason==="duplicate")){
        const duplicate=Math.min(requestSaved,(reduction.blocks||[]).filter(block=>block.reason==="duplicate").reduce((sum,block)=>sum+Number(block.estimatedTokens||0),0));
        duplicateSaved+=duplicate;topicSaved+=requestSaved-duplicate;
      }else if(reduction.reconstructed)unattributedSaved+=requestSaved;
      else topicSaved+=requestSaved;
      covered++;if(reduction.reconstructed)reconstructed++;
    }
    return {before,after,saved:Math.max(0,before-after),percent:before?Math.max(0,Math.round(100*(before-after)/before)):0,
      duplicateSaved,topicSaved,skillSaved,unattributedSaved,covered,total:groups.length,reconstructed};
  }

  function chronologicalStages(prompt, children = []) {
    const flow = prompt.flow || summary(prompt), events = flow.eventItems || [];
    const operationName = value => String(value || "").replace(/ \(Jev\)/, " with Jev").replace(/^Skill match with Jev$/i,"Skill search").toLowerCase();
    const duplicates = new Set(), paired = new Set(), results = new Map();
    children.forEach(child => {
      const match = events.map((event,index)=>({event,index})).filter(({event,index})=>event.kind === "detail" && !duplicates.has(index)
        && operationName(event.title) === operationName(child.operation)).sort((a,b)=>Math.abs(a.event.time-child.time)-Math.abs(b.event.time-child.time))[0];
      if (match) duplicates.add(match.index);
    });
    events.forEach(event=>{if(event.kind === "tool_result" && event.toolId)results.set(event.toolId,event);});
    const userText=String(prompt.text||"Recorded user input").replace(/\s+/g," ").slice(0,180);
    const screenshots=flow.screenshots||[];
    const items = [{kind:"user",title:"User question",label:userText,preview:userText,time:prompt.time||0,order:0,state:"recorded"},
      ...screenshots.map((shot,index)=>({kind:"screenshot",title:shot.title||"Screenshot "+(index+1),label:shot.preview||"Image attachment",
        screenshot:shot,time:prompt.time||0,order:index+1,state:"recorded"}))];
    events.forEach((event,index)=>{
      if (duplicates.has(index) || event.kind === "tool_result" && paired.has(event.detailIndex)) return;
      if (event.kind === "tool" && results.has(event.toolId)) paired.add(results.get(event.toolId).detailIndex);
      items.push({...event,title:event.kind === "request" ? (modelName(prompt)) + " request with system prompt and tools" : event.title,
        label:event.kind === "tool" ? event.operationPreview || "Open for details" : event.kind === "request"
        ? [modelName(prompt),prompt.contextSize?.estimatedTokens ? "≈ "+Number(prompt.contextSize.estimatedTokens).toLocaleString()+" context tokens" : "Prepared context"].join(" · ")
        : event.title === "Skill search" ? event.skillStatus === "skill"
          ? "Matched " + (event.skillName || "project skill") + " · previous messages excluded"
          : "No match" + (event.skillName ? " · " + event.skillName : "") + (Number.isFinite(event.skillProbability) ? " · " + Math.round(event.skillProbability*100) + "%" : "")
        : event.kind === "model" || event.kind === "user_interjection" ? event.label
        : event.usagePreview?.length || event.title === "Response" && event.preview ? "" : "Recorded event"});
    });
    children.forEach((child,index)=>items.push({kind:/Jev/i.test(child.operation||"")?"jev":"vertex",title:child.operation === "Topic routing with Jev" ? "Choose topic · Jev" : child.operation === "Skill match with Jev" ? "Skill search" : child.operation||"Technical step",
      label:child.flow?.jevOutcome || child.flow?.answerPreview || modelName(child),time:child.time||0,order:-1000+index,prompt:child,state:"recorded"}));
    const openingRank=item=>item.kind==="user"?0:item.kind==="screenshot"?1:2;
    items.sort((a,b)=>openingRank(a)-openingRank(b)||a.time-b.time||a.order-b.order);
    let toolNumber = 0;
    return items.map((item,index)=>({...item,stepNumber:index+1, ...(item.kind === "tool" ? { toolNumber: ++toolNumber } : {})}));
  }

  function groupPrompts(all) {
    const ordered = all.slice().sort((a, b) => (a.time || 0) - (b.time || 0) || String(a.key).localeCompare(String(b.key)));
    const chats = ordered.filter(p => p.operation === "Chat" || p.operation === "Web search");
    if (!chats.length) return ordered.map(prompt => ({ prompt, children: [] }));
    const groups = chats.map(prompt => ({ prompt, children: [] })), byPrompt = new Map(groups.map(group => [group.prompt, group]));
    for (const item of ordered) {
      if (byPrompt.has(item)) continue;
      const exact = item.relatedTurnId && chats.find(chat => chat.turnId === item.relatedTurnId);
      if (item.relatedTurnId && !exact) { groups.push({ prompt: item, children: [] }); continue; }
      const next = chats.find(chat => (chat.time || 0) >= (item.time || 0));
      const previous = chats.slice().reverse().find(chat => (chat.time || 0) < (item.time || 0));
      const owner = exact || (next && previous
        ? (item.time || 0) - (previous.time || 0) <= (next.time || 0) - (item.time || 0) ? previous : next
        : next || previous);
      if (owner) byPrompt.get(owner).children.push(item);
    }
    return groups.sort((a, b) => (a.prompt.time || 0) - (b.prompt.time || 0));
  }

  function groupUsage(group,kind="model") {
    const result = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, costReported: false, costMissing: false, costEstimated: false };
    for (const item of [group.prompt,...(group.children || [])]) {
      if ((item.costKind === "jev" ? "jev" : "model") !== kind) continue;
      const usage = item.usage || {};
      for (const key of ["input","output","cacheRead","cacheWrite"]) result[key] += Number(usage[key] || 0);
      const used = ["input","output","cacheRead","cacheWrite"].some(key => Number(usage[key] || 0) > 0);
      if (Number.isFinite(usage.cost)) { result.cost += usage.cost; result.costReported = true; result.costEstimated ||= Boolean(usage.costEstimated); }
      else if (used || Number(usage.costMissing || 0) > 0) result.costMissing = true;
    }
    return result;
  }

  function usageLines(usage) {
    const total = usage.input + usage.cacheRead + usage.cacheWrite;
    const tokens = "Spent " + total.toLocaleString() + " in (" + usage.input.toLocaleString() + " new, "
      + usage.cacheRead.toLocaleString() + " cache read) · " + usage.output.toLocaleString() + " out";
    const money = !usage.costReported ? "Cost not reported" : (usage.costEstimated ? "Estimated" : "Reported")
      + " cost " + (usage.costEstimated ? "≈ " : "") + "$" + usage.cost.toFixed(6)
      + (usage.costMissing ? " · partial; total unavailable" : "");
    return [tokens, money];
  }

  function mount(rootElement, session, options) {
    const doc = rootElement.ownerDocument, win = doc.defaultView;
    const make = (tag, cls, text) => { const node = doc.createElement(tag); node.className = cls || ""; if (text !== undefined) node.textContent = text; return node; };
    const shell = make("div", "log-flow"), toolbar = make("div", "list-tools");
    const mode = make("span", "vertex-segment-toggle"); mode.setAttribute("role", "group"); mode.setAttribute("aria-label", "Flow content");
    const stepButton = make("button", "active", "Step"), stepsButton = make("button", "", "Timeline"), contextButton = make("button", "", "Context");
    stepButton.type = stepsButton.type = contextButton.type = "button"; stepButton.setAttribute("aria-pressed", "true"); stepsButton.setAttribute("aria-pressed", "false"); contextButton.setAttribute("aria-pressed", "false");
    mode.append(stepButton, stepsButton, contextButton); toolbar.appendChild(mode);
    const topicFilter = make("select", "flow-topic-select"); topicFilter.setAttribute("aria-label", "Filter prompts by topic"); topicFilter.title = "Show prompts from one topic";
    toolbar.appendChild(topicFilter);
    const stepSelect = make("select", "flow-step-select"); stepSelect.setAttribute("aria-label", "Choose prompt step"); stepSelect.title = "Choose a prompt to inspect";
    topicFilter.after(stepSelect);
    const previous = make("button", "", "←"), next = make("button", "", "→"), range = make("span", "muted");
    previous.title = "Previous prompts"; next.title = "Next prompts";
    const fit = make("button", "", "Fit"), zoomOut = make("button", "", "−"), zoomIn = make("button", "", "+"), zoomLabel = make("span", "muted flow-zoom", "100%");
    fit.title = "Fit prompts to the viewport"; zoomOut.title = "Zoom out"; zoomIn.title = "Zoom in";
    [previous, next, range, zoomOut, zoomLabel, zoomIn, fit].forEach(node => { if (node.tagName === "BUTTON") node.type = "button"; toolbar.appendChild(node); });
    shell.appendChild(toolbar);
    const hint = make("div", "muted flow-hint", "Top → bottom: recorded stages. Left → right: prompts. Click a block to open its details. Ctrl + wheel zooms at the pointer.");
    shell.appendChild(hint);
    const stats = make("div", "flow-stats"); stats.hidden = true; shell.appendChild(stats);
    const stage = make("div", "flow-stage"), viewport = make("div", "flow-viewport"), world = make("div", "flow-world");
    viewport.tabIndex = 0; viewport.setAttribute("aria-label", "Conversation flow; scroll horizontally for prompts");
    const space = make("div", "flow-space"); space.appendChild(world); viewport.appendChild(space); stage.appendChild(viewport); shell.appendChild(stage);
    const dialog = make("dialog", "flow-dialog"), dialogHead = make("div", "flow-dialog-head"), dialogTitle = make("strong"), close = make("button", "", "Close");
    const inspector = make("div", "flow-inspector"); inspector.setAttribute("aria-live", "polite");
    close.type = "button"; close.onclick = () => dialog.close();
    dialogHead.append(dialogTitle, close); dialog.append(dialogHead, inspector); shell.appendChild(dialog);
    rootElement.appendChild(shell);
    let renderer = null, scene = null, camera = null, geometry = null, frame = 0, disposed = false, page = 0, zoom = 1, selectedKey = "", view = "steps";
    const revealTimers = new Set();
    const followRight = options?.followRight === true;
    let followedWidth = null, followedItemCount = Number.isInteger(options?.state?.followedItemCount) ? options.state.followedItemCount : null;
    const pageSize = 48, prompts = groupPrompts(session.prompts || []), meshes = [], nodes = [];
    let selectedPrompt = Math.max(0, prompts.length - 1);
    const state = options?.state || {};
    followedWidth = Number.isFinite(state.followedWidth) ? state.followedWidth : null;
    let followPaused=state.followPaused===true,lastScrollLeft=Number(state.scrollLeft)||0;
    selectedPrompt = Math.max(0, Math.min(Number.isInteger(state.selectedPrompt) ? state.selectedPrompt : selectedPrompt, Math.max(0, prompts.length - 1)));
    let selectedTopic = typeof state.topicFilter === "string" ? state.topicFilter : "all";
    const topicOptions = new Map();
    let hasUntagged = false;
    prompts.forEach(group => {
      const topic = group.prompt.topic;
      if (!topic?.id) { hasUntagged = true; return; }
      if (!topicOptions.has(topic.id)) topicOptions.set(topic.id, topic.label || "");
    });
    const fillFilters = () => {
      topicFilter.replaceChildren();
      const all = make("option", "", "All topics"); all.value = "all"; topicFilter.appendChild(all);
      [...topicOptions.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([id,label])=>{
        const number=Number(id.slice(6))||id, option=make("option","", "T"+number+(label?" · "+label:""));option.value=id;topicFilter.appendChild(option);
      });
      if (![...topicFilter.options].some(option=>option.value===selectedTopic)) selectedTopic="all";
      topicFilter.value=selectedTopic;
      const visible=prompts.map((group,index)=>({group,index})).filter(({group})=>selectedTopic==="all"||group.prompt.topic?.id===selectedTopic);
      stepSelect.replaceChildren();
      visible.forEach(({group,index})=>{
        const prompt=group.prompt,question=String(prompt.text||prompt.operation||"Question not logged").replace(/\s+/g," ").slice(0,72);
        const option=make("option","","Prompt "+(index+1)+(prompt.topic?.id?" · T"+(Number(prompt.topic.id.slice(6))||""):"")+" · "+question);
        option.value=String(index);stepSelect.appendChild(option);
      });
      if(visible.length&&!visible.some(item=>item.index===selectedPrompt))selectedPrompt=visible[0].index;
      stepSelect.value=String(selectedPrompt);stepSelect.hidden=true;
      return visible;
    };
    let visiblePrompts=fillFilters();
    const syncSelectorColors=()=>{
      const rgb=win.getComputedStyle(doc.body).backgroundColor.match(/[\d.]+/g)||[0,0,0];
      const luminance=(Number(rgb[0])*299+Number(rgb[1])*587+Number(rgb[2])*114)/1000;
      [topicFilter,stepSelect].forEach(select=>{select.style.colorScheme=luminance<128?"dark":"light";});
    };
    syncSelectorColors();
    page = Math.max(0, Math.min(state.page || 0, Math.ceil(visiblePrompts.length / pageSize) - 1));
    zoom = state.zoom || 1;
    const totals = contextStats(prompts);
    if(totals.covered){
      const headline=make("div","flow-stats-head");
      headline.append(make("strong","flow-stats-saving","≈ "+totals.saved.toLocaleString()+" history tokens omitted"),
        make("span","flow-stats-percent",totals.percent+"% less prior conversation history"));
      const comparison=make("div","flow-stats-comparison","Full history ≈ "+totals.before.toLocaleString()+" → selected history ≈ "+totals.after.toLocaleString()+" tokens · "+totals.covered+"/"+totals.total+" requests measured"+(totals.reconstructed?" · "+totals.reconstructed+" reconstructed":""));
      const reasons=make("div","flow-stats-reasons","Duplicate attempts ≈ "+totals.duplicateSaved.toLocaleString()+" saved · Topic selection ≈ "+totals.topicSaved.toLocaleString()+" saved"+
        (totals.skillSaved?" · Skill match ≈ "+totals.skillSaved.toLocaleString()+" saved":"")+
        (totals.unattributedSaved?" · Older reconstructed logs ≈ "+totals.unattributedSaved.toLocaleString()+" (reason unavailable)":""));
      const bar=make("div","flow-comparison-bar");bar.setAttribute("aria-label",totals.percent+" percent of full conversation context excluded");
      const sent=make("span","flow-bar-included");sent.style.width=(100-totals.percent)+"%";
      const excluded=make("span","flow-bar-excluded");excluded.style.width=totals.percent+"%";
      bar.append(sent,excluded);stats.append(headline,comparison,reasons,bar);
    }else stats.textContent="No recorded context selections in this conversation";
    const colors = { prompt: "--vscode-charts-blue", user: "--vscode-charts-blue", request: "--vscode-charts-blue", included: "--vscode-charts-green", answer: "--vscode-charts-green", model: "--vscode-charts-green", note: "--vscode-charts-purple", tool: "--vscode-charts-orange", steps: "--vscode-charts-orange", jev: "--vscode-charts-purple", excluded: "--vscode-charts-red", vertex: "--vscode-charts-red", checks: "--vscode-charts-yellow", review: "--vscode-charts-purple" };
    function color(variable, fallback) {
      const probe = make("span"); probe.style.color = "var(" + variable + ",var(" + (fallback || "--vscode-editor-foreground") + "))"; shell.appendChild(probe);
      const value = win.getComputedStyle(probe).color; probe.remove(); return value;
    }
    function release() {
      if (scene) { meshes.forEach(mesh => { scene.remove(mesh); mesh.material.dispose(); }); }
      meshes.length = 0;
    }
    function plane(x, y, width, height, fill, opacity) {
      if (!scene) return;
      const mesh = new win.THREE.Mesh(geometry, new win.THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity, depthTest: false, depthWrite: false }));
      mesh.scale.set(width, height, 1); mesh.position.set(x + width / 2, -y - height / 2, 0); mesh.renderOrder = meshes.length; scene.add(mesh); meshes.push(mesh);
    }
    function paint() {
      frame = 0;
      if (disposed || !renderer) return;
      const width = stage.clientWidth, height = stage.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.left = viewport.scrollLeft / zoom; camera.right = (viewport.scrollLeft + width) / zoom;
      camera.top = viewport.scrollTop / zoom; camera.bottom = (viewport.scrollTop + height) / zoom;
      // World y is negative so camera sees the same coordinates as the DOM overlay.
      camera.top *= -1; camera.bottom *= -1; camera.updateProjectionMatrix(); renderer.render(scene, camera);
    }
    const schedule = () => { if (!frame && !disposed) frame = win.requestAnimationFrame(paint); };
    function choose(prompt, node, button) {
      selectedKey = String(prompt.key || prompt.time) + ":" + node.kind + ":" + node.title;
      world.querySelectorAll(".flow-node").forEach(item => item.classList.toggle("selected", item === button));
      dialogTitle.textContent = node.title + " · " + String(prompt.text || "").slice(0, 100);
      inspector.replaceChildren();
      if (!dialog.open) dialog.showModal();
      options.details(prompt, node, inspector);
    }
    let viewportRestored = false;
    function layout() {
      const scrollLeft = viewportRestored ? viewport.scrollLeft : Number(state.scrollLeft) || 0;
      const scrollTop = viewportRestored ? viewport.scrollTop : Number(state.scrollTop) || 0;
      revealTimers.forEach(timer => win.clearTimeout(timer)); revealTimers.clear();
      release(); world.replaceChildren(); nodes.length = 0;
      visiblePrompts=prompts.map((group,index)=>({group,index})).filter(({group})=>selectedTopic==="all"||group.prompt.topic?.id===selectedTopic);
      if(view==="step"&&visiblePrompts.length&&!visiblePrompts.some(item=>item.index===selectedPrompt))selectedPrompt=visiblePrompts[0].index;
      const shownEntries = view === "step" ? visiblePrompts.filter(item=>item.index===selectedPrompt) : visiblePrompts.slice(page * pageSize, (page + 1) * pageSize);
      const shown = shownEntries.map(item=>item.group);
      const blocks = shown.map((group, index) => {
        const prompt = group.prompt;
        if (view === "context") return contextStages(prompt, shownEntries[index].index + 1);
        const technical = item => ({ kind: /Jev/i.test(item.operation || "") ? "jev" : /Orchestrator|Recovery/i.test(item.operation || "") ? "vertex" : "tool", title: item.operation || "Technical step",
          label: item.flow?.jevOutcome || (item.operation === "Screenshot recognition" ? item.flow?.answerPreview : "") || modelName(item),
          section: "User", state: "recorded", prompt: item, time: item.time || 0 });
        const normalize = value => String(value || "").replace(/ \(Jev\)/, " with Jev").toLowerCase();
        if (prompt.flow?.eventItems?.length) {
          const timeline = chronologicalStages(prompt,group.children);
          if (view === "step") {
            const flow = prompt.flow, lastAnswer = (prompt.details || []).filter(detail => detail.type === "answer" && detail.text).pop();
            const answerPreview = lastAnswer?.text || flow.answerPreview;
            if (answerPreview && !timeline.some(node => node.detailIndex === (prompt.details || []).lastIndexOf(lastAnswer) || node.title === "Response")) timeline.push({ kind: "answer", title: prompt.operation === "Screenshot recognition" ? "Image recognition result" : "LLM response",
              label: (prompt.operation === "Screenshot recognition" ? recognitionText(answerPreview) : String(answerPreview)).replace(/\s+/g," ").slice(0,180), ...(lastAnswer ? { detailIndex: (prompt.details || []).lastIndexOf(lastAnswer) } : {}),
              time: prompt.end || prompt.time || 0, order: Number.MAX_SAFE_INTEGER, state: prompt.failed ? "failed" : "recorded" });
            return timeline;
          }
          return timeline;
        }
        const main = stages(prompt).filter(node => node.kind === "prompt" || !group.children.some(item => normalize(item.operation) === normalize(node.title)));
        return main.concat(group.children.map(technical)).sort((a, b) => a.time - b.time);
      });
      if (followRight && view === "step" && blocks[0]) {
        const priorKeys = state.liveFlowKeys, deadlines = state.liveFlowDeadlines || (state.liveFlowDeadlines = {}), keys = [];
        let nextDeadline = Math.max(Date.now(), ...Object.values(deadlines).filter(value => value > Date.now()).map(value => value + 120)), earliest = Infinity;
        blocks[0].forEach(node => {
          const key = String(shown[0]?.prompt?.key || shown[0]?.prompt?.time || "") + ":" + node.stepNumber + ":" + node.kind + ":" + node.title;
          keys.push(key);
          if (priorKeys?.length && !priorKeys.includes(key) && node.kind === "tool") { deadlines[key] = nextDeadline; nextDeadline += 120; }
          else if (priorKeys?.length && !priorKeys.includes(key) && nextDeadline > Date.now() + 120) deadlines[key] = nextDeadline - 120;
        });
        state.liveFlowKeys = keys;
        blocks[0] = blocks[0].filter(node => {
          const key = String(shown[0]?.prompt?.key || shown[0]?.prompt?.time || "") + ":" + node.stepNumber + ":" + node.kind + ":" + node.title;
          if (deadlines[key] > Date.now()) { earliest = Math.min(earliest, deadlines[key]); return false; }
          delete deadlines[key]; return true;
        });
        if (Number.isFinite(earliest)) {
          const timer = win.setTimeout(() => { revealTimers.delete(timer); if (!disposed) layout(); }, Math.max(1, earliest - Date.now()));
          revealTimers.add(timer);
        }
      }
      const stepNodes = blocks[0] || [];
      const hiddenRoundRows = new Set(), noteRounds = [], noteRunByRow = new Map(), detailRounds = new Map();
      const stepRuns = [], roundSources = [], thinkingParagraphs = new Map();
      if (view === "step") {
        stepNodes.forEach((node, index) => {
          if (node.kind === "note") {
            const run = { side: modelName(node.prompt || prompts[selectedPrompt]?.prompt || {}), isModel: true,
              noteEventIndex: node.noteEventIndex, startRow: index, rows: [index] };
            roundSources.push({ row: index, run });
            noteRounds.push({ row: index, eventOrder: node.order, run });
            noteRunByRow.set(index, run);
          }
        });
        stepNodes.forEach((node, index) => {
          if (node.kind !== "model") return;
          const relatedRounds = noteRounds.filter(note => (node.noteEventIndices || []).includes(note.eventOrder)).map(note => note.run);
          if (!relatedRounds.length) {
            const previousThinking = noteRounds.filter(note => note.row < index).at(-1);
            if (previousThinking) relatedRounds.push(previousThinking.run);
          }
          if (relatedRounds.length) {
            // A response record closes the preceding thinking round; it is not another visible round.
            hiddenRoundRows.add(index);
            const run = relatedRounds[relatedRounds.length - 1];
            (node.detailIndices || []).forEach(detailIndex => detailRounds.set(detailIndex, run));
          } else {
            const run = { side: modelName(node.prompt || prompts[selectedPrompt]?.prompt || {}), isModel: true,
              startRow: index, rows: [index] };
            roundSources.push({ row: index, run });
            (node.detailIndices || []).forEach(detailIndex => detailRounds.set(detailIndex, run));
          }
        });
        roundSources.sort((a, b) => a.row - b.row).forEach((source, index) => {
          source.run.round = index + 1;
          stepRuns.push(source.run);
        });
        let activeThinkingRound = null;
        stepNodes.forEach((node, index) => {
          if (node.kind === "tool") {
            const operation = String(node.title || "");
            if (/^verification$/i.test(operation)) {
              stepRuns.push({ side: "VERTEX", isModel: false, startRow: index, rows: [index] });
              return;
            }
            if (/^review$/i.test(operation)) {
              stepRuns.push({ side: "User", isModel: false, startRow: index, rows: [index] });
              return;
            }
            const run = activeThinkingRound || detailRounds.get(node.detailIndex);
            if (run) run.rows.push(index);
            else stepRuns.push({ side: node.title || "Operation", isModel: false, startRow: index, rows: [index] });
          } else if (node.kind === "note") {
            activeThinkingRound = noteRunByRow.get(index) || null;
          } else if (node.kind === "model") {
            activeThinkingRound = hiddenRoundRows.has(index)
              ? noteRounds.filter(note => note.row < index).at(-1)?.run || activeThinkingRound
              : roundSources.find(source => source.row === index)?.run || null;
          } else if (node.kind === "request" || node.kind === "user_interjection") {
            activeThinkingRound = null;
            const isUser = node.kind === "user_interjection";
            stepRuns.push({ side: isUser ? "User" : modelName(node.prompt || prompts[selectedPrompt]?.prompt || {}),
              isModel: !isUser, startRow: index, rows: [index] });
          } else if (node.kind === "answer" || node.title === "Response") {
            const run = detailRounds.get(node.detailIndex) || activeThinkingRound;
            if (run) run.rows.push(index);
            else stepRuns.push({ side: modelName(node.prompt || prompts[selectedPrompt]?.prompt || {}),
              isModel: true, startRow: index, rows: [index] });
          } else if (node.kind !== "note") {
            const isUser = node.kind === "user" || node.kind === "user_interjection" || node.kind === "screenshot";
            const isModel = node.kind === "answer" || node.title === "Response";
            stepRuns.push({ side: isUser ? "User" : isModel ? modelName(node.prompt || prompts[selectedPrompt]?.prompt || {}) : node.title || "Operation",
              isModel, startRow: index, rows: [index] });
          }
        });
        stepRuns.sort((a, b) => a.startRow - b.startRow);
        for (let index = 0; index < stepRuns.length - 1;) {
          const run = stepRuns[index], next = stepRuns[index + 1];
          const row = run.rows[0], nextRow = next.rows[0];
          if ((run.rows.length === 1 || next.rows.length === 1) && stepNodes[row]?.kind === "note"
            && stepNodes[nextRow]?.kind === "note" && run.side === next.side) {
            const paragraphs = [...(thinkingParagraphs.get(row) || [stepNodes[row].preview]),
              ...(thinkingParagraphs.get(nextRow) || [stepNodes[nextRow].preview])].filter(Boolean);
            thinkingParagraphs.set(row, paragraphs);
            hiddenRoundRows.add(nextRow);
            run.rows.push(...next.rows.slice(1));
            stepRuns.splice(index + 1, 1);
          } else index++;
        }
        let visibleRound = 0;
        stepRuns.forEach(run => { if (run.round != null) run.round = ++visibleRound; });
      }
      const stepPositions = new Map();
      const stepHeight = node => {
        const row = stepNodes.indexOf(node), paragraphs = thinkingParagraphs.get(row);
        return paragraphs ? Math.max(75, 34 + paragraphs.reduce((height, text) => height + 14 * Math.ceil(text.length / 42) + 8, 0)) : 75;
      };
      stepRuns.forEach((run, column) => {
        let y = 52;
        run.rows.forEach(row => {
          stepPositions.set(row, { column, y, side: run.side });
          y += stepHeight(blocks[0][row]) + 24;
        });
        run.bottom = y;
      });
      const stepBottom = Math.max(299, ...stepRuns.map(run => run.bottom));
      const width = view === "step" ? Math.max(1236, stepRuns.length * 280 + 36) : Math.max(1, shown.length) * 280 + 24;
      const maxBlockTokens = Math.max(1, ...blocks.flat().filter(node => node.kind === "included" || node.kind === "excluded")
        .map(node => Number(node.estimatedTokens || 0)));
      const nodeHeight = node => view === "context" && node.kind === "section" ? 40 : view === "context" && (node.kind === "included" || node.kind === "excluded")
        ? 52 + Math.round(108 * Math.sqrt(Number(node.estimatedTokens || 0) / maxBlockTokens))
        : view === "steps" && node.usagePreview?.length ? Math.min(150, 50 + node.usagePreview.length * 22)
          : view === "steps" && node.kind === "note" ? 150
          : view === "steps" && node.kind === "prompt" ? 92
            : view === "steps" && node.kind === "tool" ? node.operationDiff ? 92 : node.operationPreview ? 88 : 60
              : view === "steps" && node.kind === "model" ? 132
                : view === "steps" && (node.kind === "screenshot" || node.preview && (node.kind === "request" || node.kind === "user" || node.kind === "user_interjection" || node.title === "Response")) ? 92 : 72;
      const height = view === "step" ? Math.max(340, stepBottom + 30) : Math.max(672, ...blocks.map(items => (view==="context"?242:88) + items.reduce((sum, node, row) => sum + nodeHeight(node) + 24 + (view === "steps" && node.kind === "tool" && items[row - 1]?.kind !== "note" && (items[row - 1]?.kind !== "tool" || items[row - 1]?.noteEventIndex !== node.noteEventIndex) ? 32 : 0), 0)));
      const surface = color("--vscode-editorWidget-background"), border = color("--vscode-panel-border");
      shown.forEach((group, index) => {
        const prompt = group.prompt;
        const actualUsage = groupUsage(group);
        const recordedStages = blocks[index];
        const stepWidth = 280;
        const x = view === "step" ? 16 : 16 + index * 280;
        const laneWidth = view === "step" ? Math.max(1200, stepRuns.length * stepWidth) : 260;
        plane(x, 12, laneWidth, height - 28, surface, 1);
        const topicNumber = Number(prompt.topic?.id?.slice(6)) || 0;
        const topicAccent = color("--vscode-charts-" + ["blue", "green", "orange", "purple", "red", "yellow"][topicNumber % 6]);
        plane(x, 12, laneWidth, 3, topicAccent, 1);
        const lane = make("div", "flow-lane" + (view === "step" ? " flow-step-lane" : "")); lane.style.left = x + "px"; lane.style.width = laneWidth + "px"; lane.style.height = height - 16 + "px";
        const heading = make("div", "flow-lane-heading");
        const promptNumber=shownEntries[index].index+1;
        const request = "Prompt " + promptNumber;
        const question = String(prompt.text || prompt.operation || "Question not logged").replace(/\s+/g, " ").slice(0, 120);
        const title = make("strong"); title.style.color = topicAccent; title.title = String(prompt.text || prompt.operation || "Question not logged");
        title.append(make("span", "flow-prompt-index", request + ":"), make("span", "flow-prompt-question", " " + question)); heading.appendChild(title);
        lane.appendChild(heading);
        if(view==="context"&&prompt.flow?.contextReduction){
          const reduction=prompt.flow.contextReduction;
          const questionCharacters=Number.isFinite(reduction.currentPromptCharacters)?reduction.currentPromptCharacters:String(prompt.text||"").length;
          const full=Math.ceil((Number(reduction.beforeCharacters||0)+questionCharacters)/4);
          const sent=Math.ceil((Number(reduction.afterCharacters||0)+questionCharacters)/4);
          const saved=Math.max(0,full-sent),percent=full?Math.round(100*saved/full):0;
          const gain=make("div","flow-lane-gain");
          const [spent,cost]=usageLines(actualUsage);
          gain.append(make("span","flow-spend",spent),make("span","flow-spend",cost),
            make("span","flow-spend",reduction.skill?"−"+(Number(reduction.beforeCharacters||0)?100:0)+"% previous history":"−"+percent+"% previous history"));
          const bar=make("div","flow-comparison-bar"),included=make("span","flow-bar-included"),excluded=make("span","flow-bar-excluded");
          included.style.width=(100-percent)+"%";excluded.style.width=percent+"%";bar.append(included,excluded);gain.appendChild(bar);lane.appendChild(gain);
        }
        if(view==="context"){
          let position=230, includedStart=null, excludedStart=null;
          recordedStages.forEach(node=>{if(node.kind==="section"&&node.sectionRole==="included")includedStart=position;
            if(node.kind==="section"&&node.sectionRole==="excluded")excludedStart=position;
            position+=nodeHeight(node)+24;});
          if(includedStart!==null&&excludedStart!==null){
            plane(x+8,includedStart-8,244,Math.max(0,excludedStart-includedStart-8),color("--vscode-charts-green"),.12);
            plane(x+8,excludedStart-8,244,Math.max(0,position-excludedStart-16),color("--vscode-charts-red"),.12);
          }
        }
        let cursorY = view==="context"?230:view === "step" ? 32 : 76;
        let thinkingGroup = null;
        const visibleStepRows = view === "step" ? stepRuns.flatMap(run => run.rows) : [];
        recordedStages.forEach((node, row) => {
          if (view === "step" && hiddenRoundRows.has(row)) return;
          const topicIndex = Number(String(node.topicId || "").slice(6));
          const topicColor = Number.isFinite(topicIndex) && topicIndex > 0 ? "--vscode-charts-" + ["blue", "green", "orange", "purple", "red", "yellow"][topicIndex % 6] : null;
          if (view === "steps" && node.kind === "tool" && (!thinkingGroup || thinkingGroup.dataset.noteEventIndex !== String(node.noteEventIndex)) && recordedStages[row - 1]?.kind !== "note") cursorY += 32;
          const stepView = view === "step";
          const y = stepView ? stepPositions.get(row).y : cursorY, accent = color(node.state === "failed" ? "--vscode-errorForeground" : node.state === "unknown" || node.state === "unverified" ? "--vscode-descriptionForeground" : stepView && node.kind === "request" ? colors.included : (view === "steps" || stepView) && (node.kind === "request" || node.kind === "user" || node.kind === "user_interjection" || node.kind === "model") ? colors.request : (view === "steps" || stepView) && (node.kind === "answer" || node.title === "Response") ? colors.answer : view === "context" && (node.kind === "included" || node.kind === "excluded") ? colors[node.kind] : topicColor || colors[node.kind]);
          const isPrompt = node.kind === "prompt" && view === "steps";
          const stepPosition = stepView ? stepPositions.get(row) : null;
          const compactRound = stepView && node.kind === "model" && node.toolCount > 0;
          const blockWidth = stepView ? 260 : 236, left = stepView ? 10 + stepPosition.column * stepWidth : 12, blockHeight = stepView ? stepHeight(node) : nodeHeight(node);
          const stepY = stepView ? stepPosition.y : y;
          if (!stepView) cursorY += blockHeight + (view === "steps" && node.kind === "note" ? 8 : 24);
          if (view === "steps" && (node.kind === "note" || node.kind === "tool" || node.kind === "model")) {
            if (node.kind === "note" || !thinkingGroup || thinkingGroup.dataset.noteEventIndex !== String(node.noteEventIndex)) {
              thinkingGroup = make("div", "flow-thinking-group");
              thinkingGroup.dataset.noteEventIndex = String(node.noteEventIndex);
              thinkingGroup.style.top = (node.kind === "note" ? y - 8 : y - 28) + "px";
              if (node.kind === "tool") {
              const heading = make("button", "flow-thinking-heading", node.notePreview || "LLM processing");
              heading.type = "button"; heading.title = node.notePreview || "Tool calls made during LLM processing";
                heading.onclick = () => choose(node.prompt || prompt, node.noteEventIndex != null
                  ? { kind: "note", title: node.notePreview || "Assistant text", noteEventIndex: node.noteEventIndex } : node, heading);
                thinkingGroup.appendChild(heading);
              }
              lane.appendChild(thinkingGroup);
            }
            thinkingGroup.style.height = (cursorY - Number.parseFloat(thinkingGroup.style.top) - 12) + "px";
          } else thinkingGroup = null;
          if(node.kind==="section"){
            const section = make("div", "flow-section " + node.sectionRole);
            section.style.top = y + "px";
            section.style.setProperty("--flow-accent",color(node.sectionRole==="included"?"--vscode-charts-green":"--vscode-charts-red"));
            section.append(make("strong","",node.title),make("span","",node.label));
            lane.appendChild(section);
            return;
          }
          const visibleIndex = stepView ? visibleStepRows.indexOf(row) : row;
          const nextRow = stepView ? visibleStepRows[visibleIndex + 1] : row + 1;
          if (nextRow != null && nextRow < recordedStages.length) {
            if (stepView) {
              const nextPosition = stepPositions.get(nextRow);
              const nextLeft = 10 + nextPosition.column * stepWidth, nextY = nextPosition.y;
              const nextHeight = stepHeight(recordedStages[nextRow]);
              // DOM connectors survive the accessible/WebGL fallback and follow the world zoom.
              const connection = make("div", "flow-connection");
              connection.setAttribute("aria-hidden", "true");
              connection.title = "recorded order";
              Object.assign(connection.style, { position: "absolute", pointerEvents: "none", color: "var(--vscode-descriptionForeground)", background: "transparent" });
              if (nextPosition.column === stepPosition.column) {
                Object.assign(connection.style, { left: left + blockWidth / 2 + "px", top: stepY + blockHeight + "px", height: nextY - stepY - blockHeight + "px", borderLeft: "1px solid currentColor" });
                const arrow = make("span", "", "↓");
                Object.assign(arrow.style, { position: "absolute", bottom: "-2px", left: "-5px", background: "transparent" });
                connection.appendChild(arrow);
              } else {
                const fromY = stepY + blockHeight / 2, toY = nextY + nextHeight / 2;
                Object.assign(connection.style, { left: left + blockWidth + "px", top: Math.min(fromY, toY) + "px", width: "20px", height: Math.abs(fromY - toY) + "px" });
                const outgoing = make("span"), vertical = make("span"), incoming = make("span", "", "→");
                Object.assign(outgoing.style, { position: "absolute", left: "0", top: fromY - Math.min(fromY, toY) + "px", width: "10px", borderTop: "1px solid currentColor", background: "transparent" });
                Object.assign(vertical.style, { position: "absolute", left: "10px", top: "0", height: "100%", borderLeft: "1px solid currentColor", background: "transparent" });
                Object.assign(incoming.style, { position: "absolute", left: "9px", top: toY - Math.min(fromY, toY) - 9 + "px", width: nextLeft - left - blockWidth - 9 + "px", background: "transparent" });
                connection.append(outgoing, vertical, incoming);
              }
              lane.appendChild(connection);
            } else plane(x + 24, y + blockHeight - 2, 2, 26, border, 1);
          }
          plane(x + left, stepY, blockWidth, blockHeight, accent, node.state === "unknown" ? .05 : node.kind === "excluded" ? .04 : .12);
          plane(x + left, stepY, 3, blockHeight, accent, 1);
          const button = make("button", "flow-node " + node.state + " " + node.kind + (isPrompt ? " flow-prompt" : "") + (stepView ? " flow-step-node" : "") + ((view === "steps" || stepView) && node.kind === "tool" ? " flow-operation" : "") + ((view === "steps" || stepView) && node.kind === "tool" && (node.operationDiff || node.operationPreview) ? " flow-operation-preview" : "") + ((view === "steps" || stepView) && node.kind === "note" ? " flow-thinking-note" : "")); button.type = "button";
          button.style.height = blockHeight + "px";
          const target = node.prompt || prompt;
          button.classList.toggle("selected", selectedKey === String(target.key || target.time) + ":" + node.kind + ":" + node.title);
          button.style.top = (thinkingGroup && (node.kind === "tool" || node.kind === "note") ? y - Number.parseFloat(thinkingGroup.style.top) : stepView ? y : stepY) + "px"; if (stepView) button.style.left = left + "px"; button.style.setProperty("--flow-accent", accent);
          button.setAttribute("aria-label", (stepView ? "Prompt " + promptNumber + ", " : "Prompt " + promptNumber + ": ") + node.title + ", " + node.label);
          button.title = node.title + ": " + node.label;
          if (isPrompt) {
            button.appendChild(make("span", "flow-model", modelName(prompt)));
            const promptText = make("span", "flow-prompt-text", node.label); button.appendChild(promptText);
            const info = usageLines(actualUsage);
            const footer = make("span", "flow-prompt-footer");
            footer.appendChild(make("strong", "", "Prompt " + promptNumber));
            if (topicNumber) { const badge = make("span", "flow-topic-badge", "T" + topicNumber); badge.style.color = topicAccent; footer.appendChild(badge); }
            footer.appendChild(make("small", "flow-usage", info.join(" · ")));
            footer.title=info.join(" · ");
            button.appendChild(footer);
          } else {
            const sharedCard = view === "steps" || stepView;
            let cardTitle = compactRound ? modelName(target) + " · processing"
              : node.kind === "tool" ? node.title + (node.fileName ? " · " + node.fileName : "")
                : node.kind === "note" ? "Thinking" : node.title;
            if (stepView && stepPosition && stepRuns[stepPosition.column]?.rows[0] === row) {
              const run = stepRuns[stepPosition.column];
              if (run.round != null) cardTitle = "Round " + run.round + ": " + modelName(target);
              else if (run.side === "VERTEX") cardTitle = "VERTEX: " + cardTitle;
              else if (run.side === "User") cardTitle = "User: " + cardTitle;
              else if (run.isModel) cardTitle = node.kind === "request"
                ? "VERTEX → " + modelName(target) : (node.kind === "answer" || node.title === "Response")
                  ? modelName(target) + " · Response" : modelName(target) + " · processing";
            }
            button.appendChild(make("strong", "", (sharedCard && node.kind === "tool" && node.toolNumber ? node.toolNumber + ". " : "") + cardTitle));
            if (sharedCard && node.usagePreview?.length) {
              button.appendChild(make("span", "flow-step-preview", node.usagePreview.join("\n")));
            }
            if (sharedCard && !compactRound && (node.kind === "model" || node.kind === "note") && node.preview) {
              const paragraphs = stepView && thinkingParagraphs.get(row);
              if (paragraphs) paragraphs.forEach(text => button.appendChild(make("span", "flow-step-preview", text)));
              else button.appendChild(make("span", "flow-step-preview", node.preview));
              button.title += "\n" + node.preview;
            }
            if ((stepView || view === "steps") && node.kind === "tool" && node.operationDiff) {
              const diff = make("span", "flow-step-preview flow-step-diff");
              node.operationDiff.changes.forEach(change => {
                const line = make("span", "flow-diff-change");
                if (change.prefix) line.appendChild(document.createTextNode(change.prefix));
                if (change.removed) line.appendChild(make("del", "flow-diff-removed", change.removed));
                if (change.added) line.appendChild(make("ins", "flow-diff-added", change.added));
                if (change.suffix) line.appendChild(document.createTextNode(change.suffix));
                diff.appendChild(line);
              });
              if (!node.operationDiff.removed.length && !node.operationDiff.added.length) diff.appendChild(make("span", "flow-diff-empty", "Edit applied"));
              button.appendChild(diff);
            } else if (sharedCard && node.kind === "tool" && node.operationPreview) button.appendChild(make("span", "flow-step-preview", node.operationPreview));
            else if ((stepView || view === "steps") && node.preview && (node.kind === "request" || node.kind === "user" || node.kind === "user_interjection" || node.title === "Response"))
              button.appendChild(make("span", "flow-step-preview " + (node.title === "Response" ? "flow-step-answer" : "flow-step-user-prompt"), node.preview));
            if (sharedCard && node.kind === "screenshot") {
              const tiles = make("span", "flow-step-screenshot-tiles");
              const tile = make("span", "flow-step-screenshot-tile");
              tile.append(make("strong", "", node.screenshot?.title || node.title), make("small", "", node.screenshot?.preview || node.label));
              tiles.appendChild(tile);
              button.appendChild(tiles);
            }
            if ((!sharedCard || node.kind !== "tool" && node.kind !== "note")
              && !(sharedCard && node.preview && (node.kind === "request" || node.kind === "user" || node.kind === "user_interjection" || node.title === "Response"))
              && !(sharedCard && node.kind === "screenshot")) {
              if (node.label) button.appendChild(make("span", "", compactRound
                  ? node.toolCount + (node.toolCount === 1 ? " tool call" : " tool calls") : node.label));
            } else if (node.kind === "tool" && node.explanation && !node.operationPreview && !node.operationDiff) button.appendChild(make("span", "", node.explanation));
            if (node.prompt && node.prompt !== prompt && node.prompt.usage) {
              const own = groupUsage({ prompt: node.prompt }, node.prompt.costKind === "jev" ? "jev" : "model");
              if (own.costReported || own.input || own.output || own.cacheRead || own.cacheWrite) {
                const [spentText, costText] = usageLines(own);
                button.appendChild(make("small", "flow-usage", costText));
                button.title += "\n" + spentText + " · " + costText;
              }
            }
          }
          button.onclick = () => choose(target, node, button); (thinkingGroup && (node.kind === "tool" || node.kind === "note") ? thinkingGroup : lane).appendChild(button); nodes.push({ node, button });
        });
        world.appendChild(lane);
        if (index) plane(x - 20, 38, 20, 2, border, 1);
      });
      world.style.width = width + "px"; world.style.height = height + "px"; world.style.transform = "scale(" + zoom + ")";
      zoomLabel.textContent = Math.round(zoom * 100) + "%";
      space.style.width = width * zoom + "px"; space.style.height = height * zoom + "px";
      // A remounted viewport has no scroll range until its content is sized.
      // Rebuilding cards can also temporarily clamp an existing viewport to zero.
      // Assigning the same offset still cancels a running smooth scroll, so write only a real change.
      if (viewport.scrollLeft !== scrollLeft) viewport.scrollLeft = scrollLeft;
      if (viewport.scrollTop !== scrollTop) viewport.scrollTop = scrollTop;
      viewportRestored = true;
      lastScrollLeft = viewport.scrollLeft;
      if (followRight && view === "step") {
        const contentWidth = width * zoom, right = Math.max(0, contentWidth - viewport.clientWidth);
        const itemCount = blocks[0]?.length || 0;
        const previousWidth = followedWidth ?? state.followedWidth;
        const previousItemCount = followedItemCount ?? state.followedItemCount;
        if (previousWidth == null) {
          if (!followPaused && state.scrollLeft == null) viewport.scrollLeft = right;
        } else if (!followPaused && previousItemCount != null && itemCount > previousItemCount) {
          // A persisted scroll offset may no longer be at the end when a live Flow is reopened.
          // Explicit manual scrolling pauses follow; otherwise every newly recorded step follows right.
          viewport.scrollTo({ left: right, behavior: "smooth" });
        }
        followedWidth = contentWidth;
        followedItemCount = itemCount;
      }
      previous.hidden = next.hidden = view === "step" || visiblePrompts.length <= pageSize;
      previous.disabled = page === 0; next.disabled = (page + 1) * pageSize >= visiblePrompts.length;
      range.textContent = !visiblePrompts.length ? "No requests" : view === "step" ? "Prompt " + (selectedPrompt + 1) + " · " + visiblePrompts.length + " shown" : (page * pageSize + 1) + "–" + Math.min((page + 1) * pageSize, visiblePrompts.length) + " / " + visiblePrompts.length + (selectedTopic === "all" ? " requests · scroll horizontally" : " requests · filtered by topic · scroll horizontally");
      schedule();
    }
    try {
      if (!win.THREE) throw Error("Three.js is unavailable");
      scene = new win.THREE.Scene(); geometry = new win.THREE.PlaneGeometry(1, 1);
      camera = new win.THREE.OrthographicCamera(0, 1, 0, -1, .1, 10); camera.position.z = 5;
      renderer = new win.THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
      renderer.domElement.className = "flow-canvas"; stage.prepend(renderer.domElement);
    } catch (error) {
      hint.textContent = "Three.js unavailable; showing accessible flow blocks. " + error.message;
      shell.classList.add("flow-fallback");
      if (renderer) renderer.dispose(); renderer = null;
    }
    function changeZoom(value, pointX = viewport.clientWidth / 2, pointY = viewport.clientHeight / 2) {
      const next = Math.max(.08, Math.min(3, value));
      if (Math.abs(next - zoom) < .001) return;
      const worldX = (viewport.scrollLeft + pointX) / zoom, worldY = (viewport.scrollTop + pointY) / zoom;
      zoom = next; layout();
      viewport.scrollLeft = worldX * zoom - pointX;
      viewport.scrollTop = worldY * zoom - pointY;
      schedule();
    }
    function setView(nextView) { view = nextView; stepButton.classList.toggle("active", view === "step"); stepsButton.classList.toggle("active", view === "steps"); contextButton.classList.toggle("active", view === "context"); stepButton.setAttribute("aria-pressed", String(view === "step")); stepsButton.setAttribute("aria-pressed", String(view === "steps")); contextButton.setAttribute("aria-pressed", String(view === "context"));
      stats.hidden = view !== "context";
      previous.hidden = next.hidden = view === "step" || visiblePrompts.length <= pageSize;
      stepSelect.hidden = view !== "step" || visiblePrompts.length < 2;
      hint.textContent = view === "context" ? "Each column compares Jev's selected context with the full history for that request. Included blocks are above excluded blocks; colors identify topics. Tokens are estimated from characters / 4. Ctrl + wheel zooms at the pointer." : view === "step" ? "Choose a prompt, then follow its recorded user action, model steps, tool calls and response from left to right. Select a card to inspect its recorded details." : "Top → bottom: recorded stages. Left → right: prompts. Click a block to open its recorded details. Ctrl + wheel zooms at the pointer."; layout(); }
    stepButton.onclick = () => setView("step"); stepsButton.onclick = () => setView("steps"); contextButton.onclick = () => setView("context");
    topicFilter.onchange = () => { selectedTopic=topicFilter.value;visiblePrompts=fillFilters();page=0;if(dialog.open)dialog.close();inspector.replaceChildren();viewport.scrollLeft=0;stepSelect.hidden=view!=="step"||visiblePrompts.length<2;options?.onTopicChange?.(selectedTopic);layout(); };
    stepSelect.onchange = () => { selectedPrompt = Math.max(0, Math.min(prompts.length - 1, Number(stepSelect.value) || 0)); viewport.scrollLeft = 0; if(dialog.open)dialog.close(); inspector.replaceChildren(); layout(); };
    previous.onclick = () => { page--; viewport.scrollLeft = 0; if(dialog.open)dialog.close(); inspector.replaceChildren(); layout(); };
    next.onclick = () => { page++; viewport.scrollLeft = 0; if(dialog.open)dialog.close(); inspector.replaceChildren(); layout(); };
    zoomOut.onclick = () => changeZoom(zoom / 1.15); zoomIn.onclick = () => changeZoom(zoom * 1.15);
    fit.onclick = () => changeZoom(stage.clientWidth / (view === "step" ? (world.offsetWidth || 1236) : Math.min(pageSize, visiblePrompts.length) * 280 + 24));
    const wheelZoom = event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      changeZoom(zoom * Math.exp(-event.deltaY / 320), event.clientX - bounds.left, event.clientY - bounds.top);
    };
    viewport.addEventListener("wheel", wheelZoom, { passive: false });
    const onScroll = () => {
      const current=viewport.scrollLeft;
      if(followRight&&current<lastScrollLeft)followPaused=true;
      else if(followRight&&followPaused&&current>=Math.max(0,world.offsetWidth*zoom-viewport.clientWidth)-32)followPaused=false;
      lastScrollLeft=current;schedule();
    };
    viewport.addEventListener("scroll", onScroll);
    // A panel that is still settling changes the viewport width after mount. Keep following,
    // but do not replace the round's smooth movement with an instantaneous assignment.
    const onResize = () => {
      if (followRight && view === "step" && !followPaused) {
        const right = Math.max(0, world.offsetWidth * zoom - viewport.clientWidth);
        if (viewport.scrollLeft !== right) viewport.scrollTo({ left: right, behavior: "smooth" });
        lastScrollLeft = viewport.scrollLeft;
      }
      schedule();
    };
    const resize = new win.ResizeObserver(onResize); resize.observe(stage);
    const theme = new win.MutationObserver(layout); theme.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
    const lost = event => { event.preventDefault(); shell.classList.add("flow-fallback"); hint.textContent = "Graphics context lost; flow blocks and details remain available."; };
    renderer?.domElement.addEventListener("webglcontextlost", lost);
    setView(["steps", "context"].includes(state.view) ? state.view : "step");
    return () => { Object.assign(state, { page, zoom, view, selectedPrompt, topicFilter: selectedTopic, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, followedWidth, followedItemCount, followPaused }); disposed = true; revealTimers.forEach(timer => win.clearTimeout(timer)); revealTimers.clear(); if(dialog.open)dialog.close(); if (frame) win.cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect(); viewport.removeEventListener("scroll", onScroll); viewport.removeEventListener("wheel", wheelZoom); release(); geometry?.dispose(); renderer?.domElement.removeEventListener("webglcontextlost", lost); renderer?.dispose(); renderer?.forceContextLoss(); shell.remove(); };
  }
  const api = { summary, timeBreakdown, stages, contextStages, contextStats, chronologicalStages, groupPrompts, groupUsage, usageLines, providerUsage, mount };
  if (typeof module === "object" && module.exports) module.exports = api; else root.vertexLogFlow = api;
})(typeof window === "object" ? window : globalThis);
