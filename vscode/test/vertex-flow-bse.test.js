"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const source = require("node:fs").readFileSync(path.resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");

test("in the BSE scope what is left stays green: the scope does not take the colour away", () => {
  assert.doesNotMatch(source, /body\.bse-only[^']*bse-operator/, "no rule that neutralises the green of a node");
  assert.doesNotMatch(source, /body\.bse-only \.bse-operation/, "nor the green of a branch");
});

test("every node the BSE scope shows is marked as part of the slice, the tree and the diagram alike", () => {
  assert.match(source, /if\(node\.bse\|\|flowBseOnly\)\(edges\.length\?caption:branch\)\.classList\.add\('bse-operation'\)/, "the tree");
  assert.match(source, /if\(node\.bse\|\|flowBseOnly\)element\.classList\.add\('bse-operator'\)/, "the diagram");
});

test("Collapse all and Expand all are one switch whose icon shows what a click does, at the root of the tree and in the diagram's toolbar", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(!script.includes("data-expand-choice"), "not two buttons");
  const make = script.slice(script.indexOf("const makeExpandSwitch="), script.indexOf("const attachTreeSwitch="));
  assert.ok(make.includes("data-expand-switch") && make.includes("branchMode=branchMode==='expand'?'collapse':'expand'"), "a click turns it over");
  const mark = script.slice(script.indexOf("const markMode="), script.indexOf("const setDepth="));
  assert.ok(mark.includes("collapsed?ICON_EXPAND:ICON_COLLAPSE"), "the icon is the action a click takes");
  assert.ok(mark.includes("document.querySelectorAll('[data-expand-switch]')"), "every switch shows the one state");
  assert.ok(script.includes("root.append(' ',makeExpandSwitch())") && script.includes("document.getElementById('mermaid-fit').before(makeExpandSwitch())"), "at the root of the tree and before Fit");
  assert.ok(script.includes("'Expand this branch'") && script.includes("'Collapse this branch'"), "a branch alone is opened or closed from the node's menu");
});
test("the Tree / Diagram switch is two icons, each named by its title", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  for (const choice of ["tree", "diagram"]) {
    const at = script.indexOf('data-view-choice="' + choice + '"');
    const button = script.slice(at, script.indexOf("</button>", at));
    assert.ok(button.includes('title="' + (choice === "tree" ? "Tree:" : "Diagram:")) && button.includes("<svg"), choice + " is an icon with a name");
    assert.ok(!/>(Tree|Diagram)$/.test(button), choice + " has no words on it");
  }
});

test("opening or closing a node keeps the zoom and the place; the other redrawings are still fitted", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  const toggle = script.slice(script.indexOf("window.bseMermaidToggle="), script.indexOf("const mermaidNode="));
  assert.equal((toggle.match(/keepView=true/g) || []).length, 3, "set where a node is opened or closed - flow, formula, tree");
  assert.ok(/flowExpanded\.add\(id\);keepView=true;rebuild\(\)/.test(toggle), "in the flow, right before the redrawing that follows");
  assert.ok(!/setTimeout\(\(\)=>\{[^}]*keepView=true;if\(document\.body/.test(toggle), "never before it is known that a redrawing follows: the next one would lose its fit");
  const rendered = script.slice(script.indexOf("document.addEventListener('bse:mermaid-rendered',()=>{if(keepView)"), script.indexOf("document.addEventListener('keydown',e=>{if(e.key==='Escape'"));
  assert.ok(rendered.includes("keepView=false;requestAnimationFrame(applyZoom)") && rendered.includes("else requestAnimationFrame(fit)"), "kept for that drawing only, fitted otherwise");
  assert.ok(script.includes("document.getElementById('mermaid-fit').click()"), "a view or direction change still fits");
});

test("FLOW shares the Calls palette and BSE overrides routine colour",()=>{
 const graph=require('../../org.vertex.abap.ui/resources/vertex-flow-graph');
 assert.deepEqual(graph.palette.constr,['#E1BEE7','#6A1B9A']);
 assert.equal(graph.routineColor('START-OF-SELECTION',{type:'PROG'}),'event');
 assert.equal(graph.routineColor('RUN',{type:'PROG'}),'form');
 assert.equal(graph.routineColor('CONSTRUCTOR',{type:'CLAS'}),'constr');
 assert.match(source,/graph\.bseFlow&&graph\.bseFlow\.palette/);
 assert.ok(source.indexOf("style.textContent+='g.node.bse-operator")>source.indexOf("Object.keys(palette).forEach"));
});

test("Show from here draws the FLOW diagram from one node, and the path bar and Esc go back", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes("flowVisible(focusPath.length?focusPath[focusPath.length-1]:'bseroot')"), "the diagram is walked from the chosen node");
  assert.ok(script.includes("host.addEventListener('contextmenu'") && script.includes("'Show from here'"), "a right click on a node offers it");
  assert.ok(script.includes("bar.append(step('Whole flow',0,"), "the path bar starts at the whole flow");
  assert.ok(script.includes("event.key!=='Escape'") && script.includes("focusPath.pop()"), "Esc goes back one step");
  assert.ok(script.includes("graph.flowReadings.active=reading.mode;focusPath=carryFocus(graph.bseFlow,reading.bseFlow);"), "another reading keeps the branch shown");
  assert.ok(script.includes("[node.key,'m|'+(node.group||node.location),'c|'+node.owner]"), "found again by key, else as its routine, else as its class");
});

test("a WHEN is the label on the line from its CASE, not a second box in the diagram", () => {
  const builder = require("../../org.vertex.abap.ui/resources/vertex-flow-graph.js");
  const rows = [["CASE p_a.", 1], ["WHEN 'X'.", 2], ["lv_x = 1.", 3], ["WHEN OTHERS.", 4], ["lv_x = 2.", 5], ["ENDCASE.", 6]]
    .map(([text, line]) => ({ scope: "ZDEMO→START-OF-SELECTION", name: "ZDEMO", line, aceLine: line, text, type: "PROG" }));
  const flow = builder.build({ rows, sites: [], point: { url: "", line: 0 }, name: "ZDEMO" }, "steps").bseFlow;
  const text = Object.fromEntries(flow.nodes.map(node => [node.id, node.text]));
  const drawn = flow.diagramEdges.map(edge => text[edge.from] + " -> " + text[edge.to] + " [" + edge.label + "]");
  assert.ok(drawn.includes("CASE p_a. -> lv_x = 1. [WHEN 'X'.]") && drawn.includes("CASE p_a. -> lv_x = 2. [WHEN OTHERS.]"), drawn.join("; "));
  assert.ok(!drawn.some(edge => /WHEN[^\]]*->|-> WHEN/.test(edge)), "no edge reaches a WHEN box");
  assert.ok(flow.nodes.filter(node => /^WHEN/.test(node.text)).every(node => node.diagramHidden), "the tree keeps them; the diagram leaves them out");
});

test("in the BSE scope a kept block is drawn whole: its END statement comes with it", () => {
  const builder = require("../../org.vertex.abap.ui/resources/vertex-flow-graph.js");
  const rows = [["IF a = 1.", 1], ["b = 2.", 2], ["ENDIF.", 3]].map(([text, line]) => ({ scope: "ZDEMO→START-OF-SELECTION", name: "ZDEMO", line, aceLine: line, text, type: "PROG" }));
  const flow = builder.build({ rows, sites: [], point: { url: "", line: 0 }, name: "ZDEMO" }, "steps").bseFlow;
  const open = flow.nodes.find(node => node.text === "IF a = 1."), close = flow.nodes.find(node => node.text === "ENDIF.");
  assert.equal(close.closes, open.id, "ENDIF knows the IF it closes");
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes("if(node.closes&&keep.has(node.closes)&&withinDepth(node))keep.add(node.id);"), "the BSE scope keeps it with its block");
});

test("the BSE scope has no Logic reading: Logic is hidden there and a Logic view turns to Statements", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes("logic.hidden=flowBseOnly;"), "hidden in BSE, back with Full");
  assert.ok(script.includes("if(flowBseOnly&&graph.flowReadings.active==='logic')flowReading.querySelector('[data-flow-reading=\"steps\"]').click();"), "Logic turns to Statements");
});

test("a label backing goes beside its text, which dagre nests deeper than ELK does", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes("text.parentNode.insertBefore(back,text);") && !script.includes("label.insertBefore(back,text);"));
});

test("an ELK routine frame opens the node menu like its node: it is found by its caption", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes("svg.querySelectorAll('g.subgraph').forEach(frame=>{") && script.includes("if(routine)frame.dataset.bseNode=routine.id;"));
});

test("a click on a FLOW diagram label sends the node's source and line, which the window opens beside", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes("window.bseMermaidOpen(node.id,node);"));
  const page = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../value-origin-view.js"), "utf8");
  assert.ok(page.includes("api.postMessage(node&&node.source?{node:id,source:node.source,line:Number(node.line)||0}:{node:id})"));
});

test("Visual Debug gives the shared view the same four readings as Value origin, and no separate Logic button", () => {
  const page = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../pages/visual-debug.html"), "utf8");
  assert.ok(page.includes('data.flowReadings={active:flowMode,baseStack:0,items:["classes","methods","logic","steps"]'), "four readings of one record");
  const join = page.slice(page.indexOf("function joinToolbars(){"), page.indexOf("function openRecordFlow(){"));
  assert.ok(!join.includes('$("flogic")') && !join.includes('"fclasses"'), "the window's own reading buttons stay out of the row");
  assert.ok(page.includes('document.addEventListener("bse:reading"'), "the window follows the view's reading");
  assert.ok(page.includes("window.vertexFlowReading=function(mode){var g=buildReading(mode,true);"), "the other readings are built when the view asks for one");
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes("document.dispatchEvent(new CustomEvent('bse:reading',{detail:reading.mode}))"));
  assert.ok(script.includes("built=window.vertexFlowReading?window.vertexFlowReading(reading.mode):"), "the view asks the host first, else builds from the page's input");
});

test("a jump from a diagram to the code is remembered, so Back returns to where the reader was", () => {
  const view = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../value-origin-view.js"), "utf8");
  assert.ok(view.includes("if (options.remember && !message.openBeside)"), "Value origin");
  const workbench = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../code-workbench.js"), "utf8");
  assert.ok(workbench.includes("remember: editor => navigation.push({ document: editor.document, at: editor.selection.active }),"), "Value origin is given the history");
  const reveal = workbench.slice(workbench.indexOf("async function revealSource("), workbench.indexOf("async function openToolSource("));
  assert.ok(reveal.includes("navigation.push({ document: leaving.document, at: leaving.selection.active })"), "Tools diagrams");
});

test("a label shows < > & as written in the code, not Mermaid's escape of them", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(script.includes(".replace(/&lt;/g,'<').replace(/&gt;/g,'>')") && script.includes(".replace(/&amp;/g,'&')"));
  assert.ok(script.indexOf(".replace(/&lt;/g,'<')") < script.indexOf("svg.querySelectorAll('.edgeLabel').forEach(label=>"), "before the label backings are measured");
});
