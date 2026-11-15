"use strict";

// The log's lightweight graphical index and browser renderer. Full source and answer bodies
// stay behind the promptDetail bridge; the index carries short summaries of service results.
(function (root) {
  function summary(prompt) {
    const details = prompt.details || [], timeline = prompt.timeline || [];
    const calls = details.filter(d => d.type === "tool");
    const checks = calls.filter(d => /^(?:Verification|Lint|Tests?)$/i.test(d.name || ""));
    const reviews = calls.filter(d => d.name === "Review");
    const jev = details.map((detail, index) => ({ ...detail, detailIndex: index })).filter(d => /Jev|Orchestrator|Recovery:/i.test(d.type || ""));
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
    return {
      jev: jev.map(d => ({ label: d.type, time: eventTime(d.detailIndex),
        detail: /^Recovery: started$/i.test(d.type) ? "Automatic retry started"
          : /^Recovery: finished$/i.test(d.type) ? "Automatic retry completed"
          : /^Recovery: awaiting user$/i.test(d.type) ? "Waiting for user continuation"
          : d.verification?.status ? String(d.verification.status).toUpperCase()
          : /Topic routing/i.test(d.type) ? "Topic selected by Jev" : "Recorded operation",
        ...(d.section ? { section: d.section } : {}),
        ...(d.verification?.status ? { state: d.verification.status } : {}) })),
      models: models.length, cliTurns: models.filter(t => t.usageScope === "cli_turn").length, stepItems,
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

  function mount(rootElement, session, options) {
    const doc = rootElement.ownerDocument, win = doc.defaultView;
    const make = (tag, cls, text) => { const node = doc.createElement(tag); node.className = cls || ""; if (text !== undefined) node.textContent = text; return node; };
    const shell = make("div", "log-flow"), toolbar = make("div", "list-tools");
    const previous = make("button", "", "←"), next = make("button", "", "→"), range = make("span", "muted");
    previous.title = "Previous prompts"; next.title = "Next prompts";
    const fit = make("button", "", "Fit"), zoomOut = make("button", "", "−"), zoomIn = make("button", "", "+");
    fit.title = "Fit prompts to the viewport"; zoomOut.title = "Zoom out"; zoomIn.title = "Zoom in";
    [previous, next, range, zoomOut, zoomIn, fit].forEach(node => { node.type = "button"; toolbar.appendChild(node); });
    shell.appendChild(toolbar);
    const hint = make("div", "muted flow-hint", "Top → bottom: recorded stages. Left → right: prompts. Click a block to open its details.");
    shell.appendChild(hint);
    const stage = make("div", "flow-stage"), viewport = make("div", "flow-viewport"), world = make("div", "flow-world");
    viewport.tabIndex = 0; viewport.setAttribute("aria-label", "Conversation flow; scroll horizontally for prompts");
    const space = make("div", "flow-space"); space.appendChild(world); viewport.appendChild(space); stage.appendChild(viewport); shell.appendChild(stage);
    const dialog = make("dialog", "flow-dialog"), dialogHead = make("div", "flow-dialog-head"), dialogTitle = make("strong"), close = make("button", "", "Close");
    const inspector = make("div", "flow-inspector"); inspector.setAttribute("aria-live", "polite");
    close.type = "button"; close.onclick = () => dialog.close();
    dialogHead.append(dialogTitle, close); dialog.append(dialogHead, inspector); shell.appendChild(dialog);
    rootElement.appendChild(shell);
    let renderer = null, scene = null, camera = null, geometry = null, frame = 0, disposed = false, page = 0, zoom = 1, selectedKey = "";
    const pageSize = 12, prompts = groupPrompts(session.prompts || []), meshes = [], nodes = [];
    const colors = { prompt: "--vscode-charts-blue", answer: "--vscode-charts-green", model: "--vscode-charts-green", tool: "--vscode-charts-orange", steps: "--vscode-charts-orange", jev: "--vscode-charts-purple", vertex: "--vscode-charts-red", checks: "--vscode-charts-yellow", review: "--vscode-charts-purple" };
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
      const blocks = shown.map(group => {
        const prompt = group.prompt;
        const technical = item => ({ kind: /Jev/i.test(item.operation || "") ? "jev" : /Orchestrator|Recovery/i.test(item.operation || "") ? "vertex" : "tool", title: item.operation || "Technical step",
          label: item.flow?.jevOutcome || (item.operation === "Screenshot recognition" ? item.flow?.answerPreview : "") || String(item.model || item.provider || ""),
          section: "User", state: "recorded", prompt: item, time: item.time || 0 });
        const normalize = value => String(value || "").replace(/ \(Jev\)/, " with Jev").toLowerCase();
        const main = stages(prompt).filter(node => node.kind === "prompt" || !group.children.some(item => normalize(item.operation) === normalize(node.title)));
        return main.concat(group.children.map(technical)).sort((a, b) => a.time - b.time);
      });
      const height = Math.max(672, ...blocks.map(items => 88 + items.length * 102));
      const surface = color("--vscode-editorWidget-background"), border = color("--vscode-panel-border");
      shown.forEach((group, index) => {
        const prompt = group.prompt;
        const x = 16 + index * 280;
        plane(x, 12, 260, height - 28, surface, 1);
        const topicNumber = Number(prompt.topic?.id?.slice(6)) || 0;
        const topicAccent = color("--vscode-charts-" + ["blue", "green", "orange", "purple", "red", "yellow"][topicNumber % 6]);
        plane(x, 12, 260, 3, topicAccent, 1);
        const lane = make("div", "flow-lane"); lane.style.left = x + "px"; lane.style.width = "260px"; lane.style.height = height - 16 + "px";
        const recordedStages = blocks[index];
        recordedStages.forEach((node, row) => {
          const y = 76 + row * 102, accent = color(node.state === "failed" ? "--vscode-errorForeground" : node.state === "unknown" || node.state === "unverified" ? "--vscode-descriptionForeground" : colors[node.kind]);
          const isPrompt = node.kind === "prompt";
          const left = 12, blockWidth = 236, blockHeight = isPrompt ? 92 : 72;
          if (row < recordedStages.length - 1) plane(x + 24, y + blockHeight - 2, 2, 32, border, 1);
          plane(x + left, y, blockWidth, blockHeight, accent, node.state === "unknown" ? .05 : .12);
          plane(x + left, y, 3, blockHeight, accent, 1);
          const button = make("button", "flow-node " + node.state + (isPrompt ? " flow-prompt" : "")); button.type = "button";
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
            const usage = prompt.usage || {}, info = [];
            const input = Number(usage.input || 0), output = Number(usage.output || 0);
            if (input || output) info.push(input.toLocaleString() + " in · " + output.toLocaleString() + " out tokens");
            if (Number.isFinite(usage.cost)) info.push((usage.costEstimated ? "≈ " : "") + "$" + Number(usage.cost).toFixed(6));
            const footer = make("span", "flow-prompt-footer");
            footer.appendChild(make("strong", "", "Prompt " + (page * pageSize + index + 1)));
            if (topicNumber) { const badge = make("span", "flow-topic-badge", "T" + topicNumber); badge.style.color = topicAccent; footer.appendChild(badge); }
            if (info.length) footer.appendChild(make("small", "flow-usage", info.join(" · ")));
            button.appendChild(footer);
          } else {
            button.appendChild(make("strong", "", node.title));
            button.appendChild(make("span", "", node.label));
          }
          button.onclick = () => choose(target, node, button); lane.appendChild(button); nodes.push({ node, button });
        });
        world.appendChild(lane);
        if (index) plane(x - 20, 38, 20, 2, border, 1);
      });
      world.style.width = width + "px"; world.style.height = height + "px"; world.style.transform = "scale(" + zoom + ")";
      space.style.width = width * zoom + "px"; space.style.height = height * zoom + "px";
      previous.disabled = page === 0; next.disabled = (page + 1) * pageSize >= prompts.length;
      range.textContent = prompts.length ? (page * pageSize + 1) + "–" + Math.min((page + 1) * pageSize, prompts.length) + " / " + prompts.length + " prompts" : "No prompts";
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
    function changeZoom(value) { zoom = Math.max(.45, Math.min(1.5, value)); layout(); }
    previous.onclick = () => { page--; viewport.scrollLeft = 0; if(dialog.open)dialog.close(); inspector.replaceChildren(); layout(); };
    next.onclick = () => { page++; viewport.scrollLeft = 0; if(dialog.open)dialog.close(); inspector.replaceChildren(); layout(); };
    zoomOut.onclick = () => changeZoom(zoom / 1.15); zoomIn.onclick = () => changeZoom(zoom * 1.15);
    fit.onclick = () => changeZoom(stage.clientWidth / (Math.min(pageSize, prompts.length) * 280 + 24));
    viewport.addEventListener("scroll", schedule);
    const resize = new win.ResizeObserver(schedule); resize.observe(stage);
    const theme = new win.MutationObserver(layout); theme.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
    const lost = event => { event.preventDefault(); shell.classList.add("flow-fallback"); hint.textContent = "Graphics context lost; flow blocks and details remain available."; };
    renderer?.domElement.addEventListener("webglcontextlost", lost);
    layout();
    return () => { disposed = true; if(dialog.open)dialog.close(); if (frame) win.cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect(); viewport.removeEventListener("scroll", schedule); release(); geometry?.dispose(); renderer?.domElement.removeEventListener("webglcontextlost", lost); renderer?.dispose(); renderer?.forceContextLoss(); shell.remove(); };
  }
  const api = { summary, stages, groupPrompts, mount };
  if (typeof module === "object" && module.exports) module.exports = api; else root.vertexLogFlow = api;
})(typeof window === "object" ? window : globalThis);
