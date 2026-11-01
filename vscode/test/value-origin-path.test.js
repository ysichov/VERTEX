"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { analyze } = require("./origin-view-fixture");
const { pathFormula } = require("../value-origin-path");

// The caption of the definition on LINE in the Formula pane: its classes and its title.
const caption = (html, line) => (html.match(new RegExp('<button class="data-composed[^"]*"[^>]*data-line="' + line + '"', "g")) || [])[0] || "";

test("after a run the analysis's whole formula stays, each definition marked ran or not run", () => {
  const graph = analyze([{ id: "demo", text: "DATA a TYPE i.\nIF p = 1.\n  a = 2.\nELSE.\n  a = 3.\nENDIF.\nWRITE a." }], { source: "demo", variable: "a", line: 7 });
  const html = pathFormula(graph, [{ object: "DEMO", line: 3 }]).panes.formula;
  assert.match(caption(html, 3), /class="data-composed vx-ran"[^>]*title="[^"]* - ran;/);
  assert.match(caption(html, 5), /class="data-composed vx-not-run"[^>]*title="[^"]* - not run in this run;/, "the branch the run did not take is kept, grey");
});

test("a SELECT the run executed that found nothing is marked red by its sy-subrc", () => {
  const graph = analyze([{ id: "demo", text: "DATA a TYPE i.\nSELECT SINGLE f FROM ztab WHERE id = 1 INTO @a.\nWRITE a." }], { source: "demo", variable: "a", line: 3 });
  const formula = executed => pathFormula(graph, executed).panes.formula;
  assert.match(caption(formula([{ object: "DEMO", line: 2, subrc: "4" }]), 2), /vx-empty"[^>]*title="[^"]* - SELECT found nothing \(sy-subrc 4\);/);
  assert.match(caption(formula([{ object: "DEMO", line: 2, subrc: "0" }]), 2), /vx-ran"/);
  assert.match(caption(formula([{ object: "DEMO", line: 2 }]), 2), /vx-ran"/, "without SY-SUBRC in the record a SELECT that ran is only ran");
});
