"use strict";

// The log's lightweight graphical index and browser renderer. Full source and answer bodies
// stay behind the promptDetail bridge; the index carries short summaries of service results.
(function (root) {
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
    const eventItems = (prompt.events || []).map((event, order) => {
      if (event.kind === "model" || event.kind === "note") return null;
      const detail = details[event.detail];
      const title = event.kind === "request" ? "LLM request and context" : event.kind === "tool_result" ? (event.tool || "Tool") + " result"
        : event.kind === "tool" ? [detail?.name || "Tool", detail?.input?.description || detail?.input?.file_path || detail?.input?.pattern || ""].filter(Boolean).join(" · ")
        : detail?.routing?.status === "skill" ? "Skill search"
        : detail?.type === "answer" ? "Response" : detail?.type || "Recorded step";
      const preview = ["thinking", "answer"].includes(detail?.type)
        ? String(detail.text || "").split(/\r?\n/).map(line => line.replace(/^\s*(?:#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/, "").replace(/\*\*/g, "").trim()).find(Boolean)?.slice(0, 110) || ""
        : "";
      return { kind: event.kind, title: String(title).replace(/\s+/g," ").slice(0,110), time: event.time || prompt.time || 0, order,
        ...(preview ? { preview } : {}), detailIndex: event.detail, detailIndices: event.kind === "request" ? event.details : undefined,
        skillName: detail?.routing?.skill || detail?.routing?.candidate, skillStatus: detail?.routing?.status,
        skillProbability: detail?.routing?.probability,
        toolId: detail?.tool_id || "", state: detail?.type === "tool" && checks.includes(detail) ? stateOf(detail) : detail?.failed ? "failed" : "recorded" };
    }).filter(Boolean);
    const routing = details.findLast(d => d.routing?.contextReduction)?.routing;
    const reduction = routing?.contextReduction || prompt.contextReduction;
    return {
      timing: timeBreakdown(prompt),
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
      answerPreview: prompt.operation === "Screenshot recognition" ? answerText.replace(/\s+/g, " ").slice(0, 130) : "",
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
    const items = [{kind:"user",title:"User question",label:"Recorded user input",time:prompt.time||0,order:0,state:"recorded"}];
    events.forEach((event,index)=>{
      if (duplicates.has(index) || event.kind === "tool_result" && paired.has(event.detailIndex)) return;
      if (event.kind === "tool" && results.has(event.toolId)) paired.add(results.get(event.toolId).detailIndex);
      items.push({...event,label:event.kind === "tool" ? "Tool call and result" : event.kind === "request"
        ? [prompt.model || prompt.provider || "Model",prompt.contextSize?.estimatedTokens ? "≈ "+Number(prompt.contextSize.estimatedTokens).toLocaleString()+" context tokens" : "Prepared context"].join(" · ")
        : event.title === "Skill search" ? event.skillStatus === "skill"
          ? "Matched " + (event.skillName || "project skill") + " · previous messages excluded"
          : "No match" + (event.skillName ? " · " + event.skillName : "") + (Number.isFinite(event.skillProbability) ? " · " + Math.round(event.skillProbability*100) + "%" : "")
        : "Recorded event"});
    });
    children.forEach((child,index)=>items.push({kind:/Jev/i.test(child.operation||"")?"jev":"vertex",title:child.operation === "Topic routing with Jev" ? "Choose topic · Jev" : child.operation === "Skill match with Jev" ? "Skill search" : child.operation||"Technical step",
      label:child.flow?.jevOutcome || child.flow?.answerPreview || String(child.model||child.provider||""),time:child.time||0,order:-1000+index,prompt:child,state:"recorded"}));
    return items.sort((a,b)=>a.time-b.time||a.order-b.order).map((item,index)=>({...item,stepNumber:index+1}));
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
    const stepsButton = make("button", "active", "Steps"), contextButton = make("button", "", "Context");
    stepsButton.type = contextButton.type = "button"; stepsButton.setAttribute("aria-pressed", "true"); contextButton.setAttribute("aria-pressed", "false");
    mode.append(stepsButton, contextButton); toolbar.appendChild(mode);
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
    const pageSize = 48, prompts = groupPrompts(session.prompts || []), meshes = [], nodes = [];
    const state = options?.state || {};
    page = Math.max(0, Math.min(state.page || 0, Math.ceil(prompts.length / pageSize) - 1));
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
    const colors = { prompt: "--vscode-charts-blue", user: "--vscode-charts-blue", request: "--vscode-charts-green", included: "--vscode-charts-green", answer: "--vscode-charts-green", model: "--vscode-charts-green", tool: "--vscode-charts-orange", steps: "--vscode-charts-orange", jev: "--vscode-charts-purple", excluded: "--vscode-charts-red", vertex: "--vscode-charts-red", checks: "--vscode-charts-yellow", review: "--vscode-charts-purple" };
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
    function layout() {
      release(); world.replaceChildren(); nodes.length = 0;
      const shown = prompts.slice(page * pageSize, (page + 1) * pageSize), width = Math.max(1, shown.length) * 280 + 24;
      const blocks = shown.map((group, index) => {
        const prompt = group.prompt;
        if (view === "context") return contextStages(prompt, page * pageSize + index + 1);
        const technical = item => ({ kind: /Jev/i.test(item.operation || "") ? "jev" : /Orchestrator|Recovery/i.test(item.operation || "") ? "vertex" : "tool", title: item.operation || "Technical step",
          label: item.flow?.jevOutcome || (item.operation === "Screenshot recognition" ? item.flow?.answerPreview : "") || String(item.model || item.provider || ""),
          section: "User", state: "recorded", prompt: item, time: item.time || 0 });
        const normalize = value => String(value || "").replace(/ \(Jev\)/, " with Jev").toLowerCase();
        if (prompt.flow?.eventItems?.length) return chronologicalStages(prompt,group.children);
        const main = stages(prompt).filter(node => node.kind === "prompt" || !group.children.some(item => normalize(item.operation) === normalize(node.title)));
        return main.concat(group.children.map(technical)).sort((a, b) => a.time - b.time);
      });
      const maxBlockTokens = Math.max(1, ...blocks.flat().filter(node => node.kind === "included" || node.kind === "excluded")
        .map(node => Number(node.estimatedTokens || 0)));
      const nodeHeight = node => view === "context" && node.kind === "section" ? 40 : view === "context" && (node.kind === "included" || node.kind === "excluded")
        ? 52 + Math.round(108 * Math.sqrt(Number(node.estimatedTokens || 0) / maxBlockTokens)) : node.kind === "prompt" && view === "steps" ? 92 : 72;
      const height = Math.max(672, ...blocks.map(items => (view==="context"?242:88) + items.reduce((sum, node) => sum + nodeHeight(node) + 24, 0)));
      const surface = color("--vscode-editorWidget-background"), border = color("--vscode-panel-border");
      shown.forEach((group, index) => {
        const prompt = group.prompt;
        const actualUsage = groupUsage(group);
        const x = 16 + index * 280;
        plane(x, 12, 260, height - 28, surface, 1);
        const topicNumber = Number(prompt.topic?.id?.slice(6)) || 0;
        const topicAccent = color("--vscode-charts-" + ["blue", "green", "orange", "purple", "red", "yellow"][topicNumber % 6]);
        plane(x, 12, 260, 3, topicAccent, 1);
        const lane = make("div", "flow-lane"); lane.style.left = x + "px"; lane.style.width = "260px"; lane.style.height = height - 16 + "px";
        const heading = make("div", "flow-lane-heading");
        const request = "Prompt " + (page * pageSize + index + 1);
        const title = make("strong", "", request + (topicNumber ? " · T" + topicNumber : "")); title.style.color = topicAccent; heading.appendChild(title);
        const question = String(prompt.text || prompt.operation || "Question not logged").replace(/\s+/g, " ").slice(0, 120);
        const caption = make("span", "", question); caption.title = String(prompt.text || prompt.operation || "Question not logged");
        heading.appendChild(caption); lane.appendChild(heading);
        const recordedStages = blocks[index];
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
        let cursorY = view==="context"?230:76;
        recordedStages.forEach((node, row) => {
          const topicIndex = Number(String(node.topicId || "").slice(6));
          const topicColor = Number.isFinite(topicIndex) && topicIndex > 0 ? "--vscode-charts-" + ["blue", "green", "orange", "purple", "red", "yellow"][topicIndex % 6] : null;
          const y = cursorY, accent = color(node.state === "failed" ? "--vscode-errorForeground" : node.state === "unknown" || node.state === "unverified" ? "--vscode-descriptionForeground" : view === "context" && (node.kind === "included" || node.kind === "excluded") ? colors[node.kind] : topicColor || colors[node.kind]);
          const isPrompt = node.kind === "prompt" && view === "steps";
          const left = 12, blockWidth = 236, blockHeight = nodeHeight(node);
          cursorY += blockHeight + 24;
          if(node.kind==="section"){
            const section = make("div", "flow-section " + node.sectionRole);
            section.style.top = y + "px";
            section.style.setProperty("--flow-accent",color(node.sectionRole==="included"?"--vscode-charts-green":"--vscode-charts-red"));
            section.append(make("strong","",node.title),make("span","",node.label));
            lane.appendChild(section);
            return;
          }
          if (row < recordedStages.length - 1) plane(x + 24, y + blockHeight - 2, 2, 26, border, 1);
          plane(x + left, y, blockWidth, blockHeight, accent, node.state === "unknown" ? .05 : node.kind === "excluded" ? .04 : .12);
          plane(x + left, y, 3, blockHeight, accent, 1);
          const button = make("button", "flow-node " + node.state + " " + node.kind + (isPrompt ? " flow-prompt" : "")); button.type = "button";
          button.style.height = blockHeight + "px";
          const target = node.prompt || prompt;
          button.classList.toggle("selected", selectedKey === String(target.key || target.time) + ":" + node.kind + ":" + node.title);
          button.style.top = y + "px"; button.style.setProperty("--flow-accent", accent);
          button.setAttribute("aria-label", "Prompt " + (page * pageSize + index + 1) + ": " + node.title + ", " + node.label);
          button.title = node.title + ": " + node.label;
          if (isPrompt) {
            const modelName = [prompt.model, prompt.provider].filter(Boolean).join(" · ") || "Model unknown";
            button.appendChild(make("span", "flow-model", modelName));
            const promptText = make("span", "flow-prompt-text", node.label); button.appendChild(promptText);
            const info = usageLines(actualUsage);
            const footer = make("span", "flow-prompt-footer");
            footer.appendChild(make("strong", "", (node.stepNumber ? "Step " + node.stepNumber + " · " : "") + "Prompt " + (page * pageSize + index + 1) + (view === "steps" && node.stepNumber ? " · " + recordedStages.length + " steps" : "")));
            if (topicNumber) { const badge = make("span", "flow-topic-badge", "T" + topicNumber); badge.style.color = topicAccent; footer.appendChild(badge); }
            footer.appendChild(make("small", "flow-usage", info.join(" · ")));
            footer.title=info.join(" · ");
            button.appendChild(footer);
          } else {
            button.appendChild(make("strong", "", (view === "steps" && node.stepNumber ? node.stepNumber + ". " : "") + node.title));
            button.appendChild(make("span", "", node.label));
            if (node.prompt && node.prompt !== prompt && node.prompt.usage) {
              const own = groupUsage({ prompt: node.prompt }, node.prompt.costKind === "jev" ? "jev" : "model");
              if (own.costReported || own.input || own.output || own.cacheRead || own.cacheWrite) {
                const [spentText, costText] = usageLines(own);
                button.appendChild(make("small", "flow-usage", costText));
                button.title += "\n" + spentText + " · " + costText;
              }
            }
          }
          button.onclick = () => choose(target, node, button); lane.appendChild(button); nodes.push({ node, button });
        });
        world.appendChild(lane);
        if (index) plane(x - 20, 38, 20, 2, border, 1);
      });
      world.style.width = width + "px"; world.style.height = height + "px"; world.style.transform = "scale(" + zoom + ")";
      zoomLabel.textContent = Math.round(zoom * 100) + "%";
      space.style.width = width * zoom + "px"; space.style.height = height * zoom + "px";
      previous.hidden = next.hidden = prompts.length <= pageSize;
      previous.disabled = page === 0; next.disabled = (page + 1) * pageSize >= prompts.length;
      range.textContent = prompts.length ? (page * pageSize + 1) + "–" + Math.min((page + 1) * pageSize, prompts.length) + " / " + prompts.length + " requests · scroll horizontally" : "No requests";
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
    function setView(nextView) { view = nextView; stepsButton.classList.toggle("active", view === "steps"); contextButton.classList.toggle("active", view === "context"); stepsButton.setAttribute("aria-pressed", String(view === "steps")); contextButton.setAttribute("aria-pressed", String(view === "context"));
      stats.hidden = view !== "context";
      hint.textContent = view === "context" ? "Each column compares Jev's selected context with the full history for that request. Included blocks are above excluded blocks; colors identify topics. Tokens are estimated from characters / 4. Ctrl + wheel zooms at the pointer." : "Top → bottom: recorded stages. Left → right: prompts. Click a block to open its details. Ctrl + wheel zooms at the pointer."; layout(); }
    stepsButton.onclick = () => setView("steps"); contextButton.onclick = () => setView("context");
    previous.onclick = () => { page--; viewport.scrollLeft = 0; if(dialog.open)dialog.close(); inspector.replaceChildren(); layout(); };
    next.onclick = () => { page++; viewport.scrollLeft = 0; if(dialog.open)dialog.close(); inspector.replaceChildren(); layout(); };
    zoomOut.onclick = () => changeZoom(zoom / 1.15); zoomIn.onclick = () => changeZoom(zoom * 1.15);
    fit.onclick = () => changeZoom(stage.clientWidth / (Math.min(pageSize, prompts.length) * 280 + 24));
    const wheelZoom = event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      changeZoom(zoom * Math.exp(-event.deltaY / 320), event.clientX - bounds.left, event.clientY - bounds.top);
    };
    viewport.addEventListener("wheel", wheelZoom, { passive: false });
    viewport.addEventListener("scroll", schedule);
    const resize = new win.ResizeObserver(schedule); resize.observe(stage);
    const theme = new win.MutationObserver(layout); theme.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
    const lost = event => { event.preventDefault(); shell.classList.add("flow-fallback"); hint.textContent = "Graphics context lost; flow blocks and details remain available."; };
    renderer?.domElement.addEventListener("webglcontextlost", lost);
    setView(state.view === "context" ? "context" : "steps");
    viewport.scrollLeft = state.scrollLeft || 0; viewport.scrollTop = state.scrollTop || 0;
    return () => { Object.assign(state, { page, zoom, view, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop }); disposed = true; if(dialog.open)dialog.close(); if (frame) win.cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect(); viewport.removeEventListener("scroll", schedule); viewport.removeEventListener("wheel", wheelZoom); release(); geometry?.dispose(); renderer?.domElement.removeEventListener("webglcontextlost", lost); renderer?.dispose(); renderer?.forceContextLoss(); shell.remove(); };
  }
  const api = { summary, timeBreakdown, stages, contextStages, contextStats, chronologicalStages, groupPrompts, groupUsage, usageLines, mount };
  if (typeof module === "object" && module.exports) module.exports = api; else root.vertexLogFlow = api;
})(typeof window === "object" ? window : globalThis);
