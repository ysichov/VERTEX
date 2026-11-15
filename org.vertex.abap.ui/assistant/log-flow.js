"use strict";

// The log's lightweight graphical index and browser renderer. No source/answer bodies
// are copied into the index; details use the existing promptDetail bridge.
(function (root) {
  function summary(prompt) {
    const details = prompt.details || [], timeline = prompt.timeline || [];
    const calls = details.filter(d => d.type === "tool");
    const checks = calls.filter(d => /^(?:Verification|Lint|Tests?)$/i.test(d.name || ""));
    const reviews = calls.filter(d => d.name === "Review");
    const jev = details.filter(d => /Jev|Orchestrator.*(?:plan|selection)/i.test(d.type || ""));
    if (!jev.length && prompt.decision) jev.push({ type: "Jev decision", section: "Model answer" });
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
    return {
      jev: jev.map(d => ({ label: d.type, ...(d.section ? { section: d.section } : {}) })),
      models: models.length, cliTurns: models.filter(t => t.usageScope === "cli_turn").length,
      tools: calls.filter(d => !checks.includes(d) && !reviews.includes(d)).length,
      checks: checks.map(d => ({ id: d.tool_id, label: d.name, state: stateOf(d) })),
      reviews: reviews.map(d => ({ id: d.tool_id, label: "Review", state: "recorded" })),
      answer: details.some(d => d.type === "answer"), failed: Boolean(prompt.failed)
    };
  }

  function stages(prompt) {
    const flow = prompt.flow || summary(prompt);
    const finalCheck = flow.checks[flow.checks.length - 1];
    return [
      { kind: "prompt", present: true, title: "Prompt", label: String(prompt.text || "(prompt text not logged)").replace(/\s+/g, " ").slice(0, 110), section: "User", state: "recorded" },
      { kind: "jev", present: flow.jev.length > 0, title: "Jev", label: flow.jev.map(x => x.label).join(" · "), section: flow.jev[0]?.section || flow.jev[0]?.label, state: "recorded" },
      { kind: "steps", present: flow.models > 0 || flow.tools > 0, title: "LLM steps", label: (flow.cliTurns ? flow.cliTurns + " Codex turn(s) · internal calls unknown" : flow.models + " model call(s)") + " · " + flow.tools + " tools", section: "Steps", state: "recorded" },
      { kind: "checks", present: flow.checks.length > 0, title: "Checks", label: finalCheck ? (finalCheck.state === "unknown" ? "Result not logged" : finalCheck.state.toUpperCase()) + " · " + flow.checks.length + " run(s)" : "", section: "Steps", state: finalCheck?.state || "unknown" },
      { kind: "answer", present: flow.failed || flow.answer, title: "Answer", label: flow.failed ? "Request failed" : "Model answer", section: "Model answer", state: flow.failed ? "failed" : "recorded" },
      { kind: "review", present: flow.reviews.length > 0, title: "Review", label: flow.reviews.length + " recorded decision(s)", section: "Steps", state: "recorded" }
    ].filter(node => node.present);
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
    const hint = make("div", "muted flow-hint", "Top → bottom: recorded stages. Left → right: prompts. Click a block for details. Actual tool/model order is in Steps.");
    shell.appendChild(hint);
    const stage = make("div", "flow-stage"), viewport = make("div", "flow-viewport"), world = make("div", "flow-world");
    viewport.tabIndex = 0; viewport.setAttribute("aria-label", "Conversation flow; scroll horizontally for prompts");
    const space = make("div", "flow-space"); space.appendChild(world); viewport.appendChild(space); stage.appendChild(viewport); shell.appendChild(stage);
    const inspector = make("div", "flow-inspector"); inspector.setAttribute("aria-live", "polite"); shell.appendChild(inspector);
    rootElement.appendChild(shell);
    let renderer = null, scene = null, camera = null, geometry = null, frame = 0, disposed = false, page = 0, zoom = 1, selectedKey = "";
    const pageSize = 12, prompts = session.prompts || [], meshes = [], nodes = [];
    const colors = { prompt: "--vscode-charts-blue", jev: "--vscode-charts-purple", steps: "--vscode-charts-orange", checks: "--vscode-charts-green", answer: "--vscode-charts-green", review: "--vscode-charts-purple" };
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
      selectedKey = String(prompt.key || prompt.time) + ":" + node.kind;
      world.querySelectorAll(".flow-node").forEach(item => item.classList.toggle("selected", item === button));
      inspector.replaceChildren(make("strong", "", node.title + " · " + String(prompt.text || "").slice(0, 100)));
      options.details(prompt, node, inspector);
    }
    function layout() {
      release(); world.replaceChildren(); nodes.length = 0;
      const shown = prompts.slice(page * pageSize, (page + 1) * pageSize), width = Math.max(1, shown.length) * 280 + 24, height = 672;
      const surface = color("--vscode-editorWidget-background"), border = color("--vscode-panel-border");
      shown.forEach((prompt, index) => {
        const x = 16 + index * 280;
        plane(x, 12, 260, 644, surface, 1);
        const lane = make("div", "flow-lane"); lane.style.left = x + "px"; lane.style.width = "260px";
        const head = make("div", "flow-lane-heading");
        head.appendChild(make("strong", "", "Prompt " + (page * pageSize + index + 1)));
        head.appendChild(make("span", "muted", [prompt.topic?.id, prompt.provider, prompt.model].filter(Boolean).join(" · ")));
        lane.appendChild(head);
        const recordedStages = stages(prompt);
        recordedStages.forEach((node, row) => {
          const y = 76 + row * 92, accent = color(node.state === "failed" ? "--vscode-errorForeground" : node.state === "unknown" || node.state === "unverified" ? "--vscode-descriptionForeground" : colors[node.kind]);
          if (row < recordedStages.length - 1) plane(x + 24, y + 70, 2, 22, border, 1);
          plane(x + 12, y, 236, 72, accent, node.state === "unknown" ? .05 : .12);
          plane(x + 12, y, 3, 72, accent, 1);
          const button = make("button", "flow-node " + node.state); button.type = "button";
          button.classList.toggle("selected", selectedKey === String(prompt.key || prompt.time) + ":" + node.kind);
          button.style.top = y + "px"; button.style.setProperty("--flow-accent", accent);
          button.setAttribute("aria-label", "Prompt " + (page * pageSize + index + 1) + ": " + node.title + ", " + node.label);
          button.title = node.title + ": " + node.label;
          button.appendChild(make("strong", "", node.title)); button.appendChild(make("span", "", node.label));
          button.onclick = () => choose(prompt, node, button); lane.appendChild(button); nodes.push({ node, button });
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
    previous.onclick = () => { page--; viewport.scrollLeft = 0; inspector.replaceChildren(); layout(); };
    next.onclick = () => { page++; viewport.scrollLeft = 0; inspector.replaceChildren(); layout(); };
    zoomOut.onclick = () => changeZoom(zoom / 1.15); zoomIn.onclick = () => changeZoom(zoom * 1.15);
    fit.onclick = () => changeZoom(stage.clientWidth / (Math.min(pageSize, prompts.length) * 280 + 24));
    viewport.addEventListener("scroll", schedule);
    const resize = new win.ResizeObserver(schedule); resize.observe(stage);
    const theme = new win.MutationObserver(layout); theme.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
    const lost = event => { event.preventDefault(); shell.classList.add("flow-fallback"); hint.textContent = "Graphics context lost; flow blocks and details remain available."; };
    renderer?.domElement.addEventListener("webglcontextlost", lost);
    layout();
    return () => { disposed = true; if (frame) win.cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect(); viewport.removeEventListener("scroll", schedule); release(); geometry?.dispose(); renderer?.domElement.removeEventListener("webglcontextlost", lost); renderer?.dispose(); renderer?.forceContextLoss(); shell.remove(); };
  }
  const api = { summary, stages, mount };
  if (typeof module === "object" && module.exports) module.exports = api; else root.vertexLogFlow = api;
})(typeof window === "object" ? window : globalThis);
