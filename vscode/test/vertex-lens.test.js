"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const resources = path.resolve(__dirname, "../../org.vertex.abap.ui/resources");
const lensSource = fs.readFileSync(path.join(resources, "vertex-lens.js"), "utf8");

// A page with just enough of a DOM for the lens: elements that hold children and listeners.
function page() {
  const body = { children: [] };
  const element = tag => {
    const el = { tag, className: "", style: {}, children: [], listeners: {}, attrs: {}, parentNode: null,
      classList: { set: new Set(), toggle(name, on) { on ? this.set.add(name) : this.set.delete(name); }, contains(name) { return this.set.has(name); } },
      setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; },
      appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
      insertBefore(child) { child.parentNode = el; el.children.unshift(child); return child; },
      removeChild(child) { el.children = el.children.filter(c => c !== child); },
      cloneNode() { return element("svg"); }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
      matches: selector => selector === "g.node" && el.isNode === true, querySelectorAll: () => [] };
    return el;
  };
  body.appendChild = child => { child.parentNode = body; body.children.push(child); };
  body.removeChild = child => { body.children = body.children.filter(c => c !== child); };
  const document = { head: element("head"), body, getElementById: () => null, createElement: element,
    querySelectorAll: selector => selector === ".uml-lens" ? body.children.filter(c => c.className === "uml-lens") : [] };
  const window = { innerWidth: 1000, innerHeight: 800 };
  const context = vm.createContext({ window, document, Math, Array });
  vm.runInContext(lensSource, context);
  return { window, document, body, element };
}
const svgIn = ({ element }) => { const svg = element("svg"); svg.tagName = "svg"; return svg; };
const lenses = ({ body }) => body.children.filter(c => c.className === "uml-lens");

test("the lens is put on the diagram only while it is on, and goes with the drawing it was on", () => {
  const p = page(), svg = svgIn(p);
  p.window.vertexLens.install(svg, true);
  assert.equal(lenses(p).length, 0, "off: nothing is drawn");
  p.window.vertexLens.setEnabled(true);
  assert.equal(lenses(p).length, 1, "switched on: the lens goes on the diagram that was drawn last");
  p.window.vertexLens.install(svgIn(p), true);
  assert.equal(lenses(p).length, 1, "a new drawing replaces the lens, it does not add one");
  p.window.vertexLens.setEnabled(false);
  assert.equal(lenses(p).length, 0, "switched off: gone");
});

test("the lens does not go out while the pointer moves over a diagram, whatever its size", () => {
  const p = page(), svg = svgIn(p);
  p.window.vertexLens.setEnabled(true);
  p.window.vertexLens.install(svg, true);
  const lens = lenses(p)[0];
  svg.listeners.pointermove({ currentTarget: svg, target: svg, clientX: 120, clientY: 80 });
  assert.equal(lens.style.display, "block", "over any point of a flowchart");
  svg.listeners.pointermove({ currentTarget: svg, target: svg, clientX: 300, clientY: 200 });
  assert.equal(lens.style.display, "block", "and it stays while the pointer moves on - no size heuristic hides it");
  svg.listeners.pointerleave();
  assert.equal(lens.style.display, "none", "it goes when the pointer leaves");
});

test("on a class diagram the lens is over a node only", () => {
  const p = page(), svg = svgIn(p), node = p.element("g"), bare = p.element("g");
  node.isNode = true; node.parentNode = svg; bare.parentNode = svg;
  p.window.vertexLens.setEnabled(true);
  p.window.vertexLens.install(svg, false);
  const lens = lenses(p)[0];
  svg.listeners.pointermove({ currentTarget: svg, target: bare, clientX: 50, clientY: 50 });
  assert.equal(lens.style.display, "none");
  svg.listeners.pointermove({ currentTarget: svg, target: node, clientX: 50, clientY: 50 });
  assert.equal(lens.style.display, "block");
});

test("Shift and the wheel set how strong the lens is, within limits", () => {
  const p = page(), svg = svgIn(p);
  p.window.vertexLens.setEnabled(true);
  p.window.vertexLens.install(svg, true);
  const lens = lenses(p)[0], badge = lens.children[lens.children.length - 1];
  svg.listeners.pointermove({ currentTarget: svg, target: svg, clientX: 10, clientY: 10 });
  const wheel = deltaY => svg.listeners.wheel({ shiftKey: true, deltaX: 0, deltaY, preventDefault() {}, stopPropagation() {}, currentTarget: svg, target: svg, clientX: 10, clientY: 10 });
  wheel(-1000);
  assert.equal(badge.textContent, "6.0×", "no stronger than 6");
  wheel(1000);
  assert.equal(badge.textContent, "1.5×", "no weaker than 1.5");
});

test("the switch is an icon, and its state is marked both ways the pages style a switch", () => {
  const p = page(), button = p.element("button");
  button.addEventListener = (type, fn) => { button.click = fn; };
  p.window.vertexLens.button(button);
  assert.ok(String(button.innerHTML).includes("<svg"), "the magnifier icon");
  assert.equal(button.attrs["aria-pressed"], "false");
  button.click();
  assert.deepEqual([button.classList.contains("on"), button.classList.contains("active"), button.attrs["aria-pressed"]], [true, true, "true"]);
});

test("every view that draws a diagram uses the one lens", () => {
  const flow = fs.readFileSync(path.join(resources, "vertex-flow.js"), "utf8"), metrics = fs.readFileSync(path.join(resources, "metrics.html"), "utf8");
  assert.ok(flow.includes("window.vertexLens.install(svg,true)") && !flow.includes("14*scale"), "the flow view has no lens of its own");
  assert.ok(metrics.includes("/*VERTEX_LENS*/") && metrics.includes("window.vertexLens.button(") && !metrics.includes("lensEnabled"), "nor has Tools");
  const tools = require("../tools-window").html(resources, null);
  assert.ok(tools.includes("vertexLens") && !tools.includes("/*VERTEX_LENS*/"), "the Tools page is given the lens in place of the marker");
});
