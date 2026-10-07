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

test("Expand all and Collapse all are two buttons, as in SAP GUI, at the root of the tree and in the diagram's toolbar", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(!script.includes("data-expand-switch"), "no single switch that turns over");
  const bar = script.slice(script.indexOf("const expandToggle=document.createElement"), script.indexOf("modeToggle.append(expandToggle);"));
  assert.ok(!bar.includes("makeExpandSwitch"), "the top bar keeps the depth and no buttons");
  const make = script.slice(script.indexOf("const makeExpandSwitch="), script.indexOf("const attachTreeSwitch="));
  assert.ok(make.includes("vertex-segment-toggle") && make.includes("[['expand','Expand all',ICON_EXPAND],['collapse','Collapse all',ICON_COLLAPSE]]"), "one exclusive pair: Expand all, then Collapse all");
  assert.ok(make.includes("branchMode=mode;applyBranchChoice();"), "a click chooses its own mode");
  const mark = script.slice(script.indexOf("const markMode="), script.indexOf("const setDepth="));
  assert.ok(mark.includes("document.querySelectorAll('[data-expand-choice]')") && mark.includes("classList.toggle('active',chosen)"), "every pair shows the mode in force");
  const apply = script.slice(script.indexOf("const applyBranchChoice="), script.indexOf("/* In the BSE scope everything that is left"));
  assert.ok(!apply.includes("setDepth("), "it leaves the depth alone");
  assert.ok(apply.includes("attachTreeSwitch(flowPane)") && apply.includes("root.append(' ',makeExpandSwitch())"), "a switch at the root of the tree");
  assert.ok(apply.includes("document.getElementById('mermaid-fit').before(makeExpandSwitch())"), "and one in the diagram's own toolbar, before Fit");
  assert.ok(script.includes("if(treeSwitchReady)attachTreeSwitch(flowPane)"), "the tree is rebuilt with it");
  const open = script.slice(script.indexOf("const openToDepth="), script.indexOf("const applyDepth="));
  assert.ok(open.includes("branchMode==='expand'"), "what is opened depends on the mode, within the depth");
});

test("the Tree / Diagram switch is two icons, each named by its title", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  for (const choice of ["tree", "diagram"]) {
    const at = script.indexOf('data-view-choice="' + choice + '"');
    const button = script.slice(at, script.indexOf("</button>", at));
    assert.ok(button.includes('title="' + (choice === "tree" ? "Tree" : "Diagram") + '"') && button.includes("<svg"), choice + " is an icon with a name");
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
