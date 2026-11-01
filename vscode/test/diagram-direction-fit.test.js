"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const read = name => fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources", name), "utf8");
test("Metrics requests fit before rendering either new direction", () => {
  const source = read("metrics.html"), start = source.indexOf("function setDirection(value)");
  const code = source.slice(start, source.indexOf("/* The library", start));
  for (const direction of ["TB", "LR"]) {
    const draws = [], context = { lastMermaid: "old SVG", refit: false, document: { querySelectorAll: () => [] },
      draw: force => draws.push([force, context.refit, context.direction]) };
    vm.createContext(context); vm.runInContext(code, context); context.setDirection(direction);
    assert.deepEqual(draws, [[true, true, direction]]);
  }
});
test("FLOW direction change fits after the replacement SVG arrives", () => {
  const source = read("vertex-flow.js");
  const marker = "document.querySelectorAll('[data-mermaid-direction]').forEach(button=>button.addEventListener('click',()=>{";
  const start = source.indexOf(marker) + marker.length, end = source.indexOf("}));window.vertexLens.button", start);
  assert.ok(start >= marker.length && end > start);
  const handler = source.slice(start, end);
  const event = "document.addEventListener('bse:mermaid-rendered',()=>{";
  const renderedStart = source.indexOf(event, source.indexOf('const viewport='));
  const rendered = source.slice(renderedStart + event.length, source.indexOf("});document.addEventListener('keydown'", renderedStart));
  for (const direction of ["TD", "LR", "auto"]) {
    const frames = [], fits = [], context = { directionManual: false, direction: "LR", renderedOnce: true, keepView: true,
      button: { dataset: { mermaidDirection: direction } }, document: { querySelectorAll: () => [] },
      rebuild: () => {}, requestAnimationFrame: fn => frames.push(fn), fit: () => fits.push("new SVG"),
      applyZoom: () => assert.fail("old viewport must not override the new fit") };
    vm.createContext(context); vm.runInContext(handler, context);
    assert.equal(fits.length, 0, "no fit while Mermaid is still rendering");
    assert.equal(frames.length, 0);
    vm.runInContext(rendered, context); frames.forEach(fn => fn());
    assert.deepEqual(fits, ["new SVG"]);
  }
});
test("switching Classes, Methods or Statements fits the replacement diagram", () => {
  const source = read("vertex-flow.js");
  const reading = source.slice(source.indexOf("flowReading.querySelectorAll('[data-flow-reading]').forEach(button=>button.addEventListener('click'"), source.indexOf("if(graph.hasSelectedValue===false)"));
  assert.match(reading, /syncDepth\(\);renderedOnce=false;keepView=false;applyBranchChoice\(\)/);
  const rendered = source.slice(source.indexOf("document.addEventListener('bse:mermaid-rendered',()=>{if(!renderedOnce"), source.indexOf("document.addEventListener('keydown',e=>{if(e.key==='Escape'"));
  const frames = [], fits = [], context = { renderedOnce: true, keepView: true,
    requestAnimationFrame: fn => frames.push(fn), fit: () => fits.push('replacement SVG'),
    applyZoom: () => assert.fail('old zoom must not be restored') };
  vm.createContext(context);
  vm.runInContext('renderedOnce=false;keepView=false;', context);
  vm.runInContext(rendered.replace("document.addEventListener('bse:mermaid-rendered',()=>{", '').replace(/\}\);$/, ''), context);
  frames.forEach(fn => fn());
  assert.deepEqual(fits, ['replacement SVG']);
});
