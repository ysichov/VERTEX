"use strict";
/* The analysis's whole formula with what one recorded run made of it, for both hosts: every definition stays, marked
   ran (green), not run (grey) - the variants the analysis keeps for other paths, a branch whose condition did not
   hold - or a SELECT that ran and found nothing, sy-subrc not 0 (red). Definitions of one value that ran - every
   modifier of a pipeline - are steps in the order the run made them, given to the formula as its pipeline.
   executed: [{ object, line, subrc }] in the order the record holds them; subrc is SY-SUBRC read after a SELECT. */
const { formula } = require("./value-origin-formula");
const paneHtml = require("./value-origin-formula-html");

function pathFormula(graph, executed, sourceOf = node => "origin:" + node.source + "|" + (node.location || "")) {
  if (!graph) throw new Error("No path was analysed: use Analyze flow path first.");
  const up = text => String(text || "").toUpperCase();
  const objectOf = location => up(String(location || "").split(/->|→|=>/)[0]);
  const ran = new Map((executed || []).map(item => [up(item.object) + ":" + Number(item.line), item]));
  const order = [];
  (executed || []).forEach(item => { const object = up(item.object); if (object && !order.includes(object)) order.push(object); });
  const ordered = { ...graph, pipeline: { steps: order.map((object, index) => ({ modifier_class: object, step_no: index + 1 })), scenario: "", byRun: true } };
  const derived = formula(ordered, () => true, definition => {
    const item = ran.get(objectOf(definition.location) + ":" + Number(definition.line));
    if (!item) return { state: "not-run" };
    const subrc = item.subrc == null ? "" : String(item.subrc).trim();
    return /^SELECT\b/i.test(String(definition.text || "")) && subrc !== "" && Number(subrc) !== 0 ? { state: "empty", subrc } : { state: "ran" };
  });
  return { formula: { nodes: derived.nodes, edges: derived.edges, maxLevel: derived.maxLevel },
    panes: { formula: paneHtml.formulaPane(ordered, derived, sourceOf), expression: paneHtml.expressionPane(derived, sourceOf) } };
}

module.exports = { pathFormula };
