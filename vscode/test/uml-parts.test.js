"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("UML Scheme renders the Source/Diff-style Parts navigator for every ADT class type", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/metrics.html"), "utf8");
  assert.match(page, /function renderUmlParts\(\)/);
  assert.match(page, /\["", "Type", "Name"\]/);
  assert.match(page, /CPUB/);
  assert.match(page, /CPRO/);
  assert.match(page, /CPRI/);
  assert.match(page, /type === "CLASS" \|\| type === "CLAS" \|\| type\.indexOf\("CLAS\/"\) === 0/);
  assert.match(page, /mode === "scheme" && classMetrics\(\)/);
});
