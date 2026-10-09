"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { analyze } = require("./origin-view-fixture");
const { formula } = require("../value-origin-formula");

const expression = (lines, line, variable) => formula(analyze([{ id: "demo", text: lines.join("\n") }], { source: "demo", line, variable })).expression.text;

test("an alternative under IF says when it holds, the one it overrides says otherwise", () => {
  const text = expression(["g = b * r.", "IF g > 1000.", "  g = g - 50.", "ENDIF.", "a = g."], 5, "a");
  assert.match(text, /\(b \* r\) otherwise/);
  assert.match(text, /\(\(b \* r\) - 50\) when g > 1000/);
});

test("an ELSE branch is the condition's negation", () => {
  const text = expression(["IF x > 1.", "  a = 1.", "ELSE.", "  a = 2.", "ENDIF.", "WRITE a."], 6, "a");
  assert.match(text, /1 when x > 1/);
  assert.match(text, /2 when NOT \(x > 1\)/);
});

test("a WHEN branch reads as the CASE value equal to it", () => {
  const text = expression(["CASE k.", "  WHEN 1.", "    a = 10.", "  WHEN 2.", "    a = 20.", "ENDCASE.", "WRITE a."], 7, "a");
  assert.match(text, /10 when k = 1/);
  assert.match(text, /20 when k = 2/);
});
