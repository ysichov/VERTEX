/* The magnifier over a diagram - one for every VERTEX view that draws a Mermaid diagram: Tools (UML, Calls, Logic),
   the flow of Value origin and the debugger's diagram. It is a separate file so that there is one lens, not one per
   view; a page that draws a diagram loads this before it draws.

   The lens is an inert copy of the SVG over the point under the pointer: it never changes the diagram's own zoom or
   position. "Lens on" is an explicit choice of the reader, so it is not second-guessed by any heuristic about text
   size (that made it flicker on diagrams whose line metrics differ between SVGs). Shift and the wheel, or two fingers
   on the touchpad, set how strong it is. Written in the plain style of the oldest page that uses it. */
(function (root) {
  "use strict";
  var ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 4 4" stroke="currentColor" stroke-width="1.5"/></svg>';
  // The page's own colours where it has them (the VS Code theme's), else the ones the Tools pages name.
  var CSS = ".uml-lens{position:fixed;width:180px;height:180px;border-radius:50%;overflow:hidden;pointer-events:none;z-index:10;" +
    "display:none;border:2px solid var(--vscode-input-border,var(--vscode-panel-border,var(--field-border,#888)));" +
    "background:var(--vscode-editor-background,var(--bg,#fff));box-shadow:0 4px 14px #0006}" +
    ".uml-lens svg{position:absolute;max-width:none}" +
    ".uml-lens-zoom{position:absolute;right:22px;bottom:14px;z-index:1;padding:0 5px;border-radius:8px;font-size:11px;" +
    "color:var(--vscode-foreground,var(--fg,#000));background:var(--vscode-editor-background,var(--bg,#fff));opacity:.85}";
  var state = { zoom: 2.5, enabled: false };
  var last = null, buttons = [];

  function style() {
    if (document.getElementById("vertex-lens-style")) { return; }
    var tag = document.createElement("style");
    tag.id = "vertex-lens-style";
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }
  function remove() {
    Array.prototype.forEach.call(document.querySelectorAll(".uml-lens"), function (old) { old.parentNode.removeChild(old); });
  }
  // An SVG, or the pane that holds some; the connectors a hybrid diagram draws between its parts are not diagrams.
  function svgsOf(target) {
    if (!target) { return []; }
    if (target.tagName && String(target.tagName).toLowerCase() === "svg") { return [target]; }
    return Array.prototype.filter.call(target.querySelectorAll("svg"), function (svg) {
      return !svg.classList.contains("hybrid-connector");
    });
  }

  /* Put the lens on the diagram `target` (an SVG, or a pane holding some). `anywhere`: over any point of the diagram;
     else only over a node. Called after every drawing: the previous drawing's lens goes with it. */
  function install(target, anywhere) {
    last = { target: target, anywhere: anywhere };
    remove();
    var sources = svgsOf(target);
    if (!sources.length || !state.enabled) { return; }
    style();
    var lens = document.createElement("div");
    lens.className = "uml-lens";
    lens.setAttribute("aria-hidden", "true");
    var copy = null, copiedSource = null, radius = 90;
    var badge = document.createElement("span");
    badge.className = "uml-lens-zoom";
    badge.textContent = state.zoom.toFixed(1) + "×";
    lens.appendChild(badge);
    document.body.appendChild(lens);

    function isNode(element, svg) {
      while (element && element !== svg) {
        if (element.matches && element.matches("g.node")) { return true; }
        element = element.parentNode;
      }
      return false;
    }
    function hide() { lens.style.display = "none"; }
    function move(event) {
      var svg = event.currentTarget;
      if (!anywhere && !isNode(event.target, svg)) { hide(); return; }
      var source = svg.getBoundingClientRect();
      if (!source.width || !source.height) { hide(); return; }
      var box = svg.viewBox && svg.viewBox.baseVal;
      var scale = box && box.width > 0 ? source.width / box.width : 1;
      if (scale >= 0.7) { hide(); return; }
      // The copy is made when the pointer first comes, not when the diagram is drawn: a drawing nobody looks at costs nothing.
      if (copiedSource !== svg) {
        if (copy) { copy.parentNode.removeChild(copy); }
        copy = svg.cloneNode(true);
        lens.insertBefore(copy, badge);
        copiedSource = svg;
      }
      var left = Math.min(window.innerWidth - radius * 2 - 8, event.clientX + 16);
      var top = Math.min(window.innerHeight - radius * 2 - 8, event.clientY + 16);
      lens.style.left = Math.max(8, left) + "px";
      lens.style.top = Math.max(8, top) + "px";
      // Bring small diagrams to at most 70% of their natural scale.
      // Shift-wheel may lower magnification, but never exceeds that ceiling.
      var factor = Math.max(1, (0.7 / scale) * Math.min(1, state.zoom / 2.5));
      badge.textContent = factor.toFixed(1) + "×";
      copy.style.width = Math.round(source.width * factor) + "px";
      copy.style.height = Math.round(source.height * factor) + "px";
      copy.style.left = Math.round(radius - (event.clientX - source.left) * factor) + "px";
      copy.style.top = Math.round(radius - (event.clientY - source.top) * factor) + "px";
      lens.style.display = "block";
    }
    sources.forEach(function (svg) {
      svg.addEventListener("pointermove", move);
      // Shift and two fingers on the touchpad (or the wheel) set how strong the lens is, smoothly: the change follows how
      // far the fingers moved. With Shift held the browser turns a vertical scroll into a horizontal one, so either
      // direction counts. Ctrl and a pinch stay the whole picture's zoom.
      svg.addEventListener("wheel", function (event) {
        if (!event.shiftKey || lens.style.display !== "block") { return; }
        event.preventDefault();
        event.stopPropagation();
        var delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        state.zoom = Math.max(1.5, Math.min(6, state.zoom * Math.exp(-delta * 0.01)));
        badge.textContent = state.zoom.toFixed(1) + "×";
        move(event);
      }, { passive: false });
      svg.addEventListener("pointerleave", hide);
    });
  }

  function sync() {
    buttons.forEach(function (button) {
      // Both marks: the pages style an on/off switch by one or the other.
      button.classList.toggle("on", state.enabled);
      button.classList.toggle("active", state.enabled);
      button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
    });
  }
  function setEnabled(on) {
    state.enabled = !!on;
    sync();
    if (!state.enabled) { remove(); }
    else if (last) { install(last.target, last.anywhere); }
  }
  /* Make `element` the lens switch: the magnifier icon, named and pressed as a switch, on and off with the lens. */
  function button(element) {
    element.innerHTML = ICON;
    element.setAttribute("aria-label", "Magnifier");
    element.title = "Magnifier over the diagram: on / off (Shift and the wheel set how strong)";
    buttons.push(element);
    element.addEventListener("click", function () { setEnabled(!state.enabled); });
    sync();
  }

  root.vertexLens = { install: install, setEnabled: setEnabled, enabled: function () { return state.enabled; },
    button: button, remove: remove, icon: ICON };
})(typeof window !== "undefined" ? window : this);
