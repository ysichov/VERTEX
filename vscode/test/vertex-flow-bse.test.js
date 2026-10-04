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

test("Collapse all and Expand all are one switch that offers the other each time, at the root of the tree and in the diagram's toolbar", () => {
  const script = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../org.vertex.abap.ui/resources/vertex-flow.js"), "utf8");
  assert.ok(!script.includes("data-expand-choice"), "not two buttons any more");
  const bar = script.slice(script.indexOf("const expandToggle=document.createElement"), script.indexOf("modeToggle.append(expandToggle);"));
  assert.ok(!bar.includes("data-expand-switch"), "the top bar keeps the depth and no switch");
  const mark = script.slice(script.indexOf("const markMode="), script.indexOf("const setDepth="));
  assert.ok(mark.includes("collapsed?ICON_EXPAND:ICON_COLLAPSE") && mark.includes("collapsed?'Expand all':'Collapse all'"), "it offers expand when collapsed, collapse when expanded");
  assert.ok(mark.includes("document.querySelectorAll('[data-expand-switch]')"), "every switch shows the one state");
  const apply = script.slice(script.indexOf("const applyBranchChoice="), script.indexOf("/* In the BSE scope everything that is left"));
  assert.ok(!apply.includes("setDepth("), "it leaves the depth alone");
  assert.ok(apply.includes("branchMode=branchMode==='expand'?'collapse':'expand'"), "a click turns it over");
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
