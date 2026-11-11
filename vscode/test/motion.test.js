"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const motion = require("../motion");
const host = value => ({ workspace: { getConfiguration: () => ({ get: (key, fallback) => value === undefined ? fallback : value }) } });

test("vertex.animations: auto adds nothing; on and off mark the page's body", () => {
  assert.equal(motion.apply("<html><body><p>x</p></body>", host("auto")), "<html><body><p>x</p></body>");
  assert.equal(motion.apply("<body>", host("on")), '<body class="vertex-motion-on">');
  assert.equal(motion.apply('<body class="vertex-docked-debug" data-x="1">', host("off")), '<body class="vertex-motion-off vertex-docked-debug" data-x="1">');
  assert.equal(motion.mode(host("sideways")), "auto", "an unknown value is auto");
  assert.equal(motion.mode(host(undefined)), "auto");
});

test("without motion the scenes and logos are hidden, and on overrides reduced motion", () => {
  const fs = require("node:fs"), path = require("node:path");
  const scenes = require("../../org.vertex.abap.ui/resources/vertex-task-visual.js").css;
  assert.match(scenes, /@media\(prefers-reduced-motion:reduce\)\{body:not\(\.vertex-motion-on\) \.vertex-task-visual\{display:none!important\}\}/);
  assert.match(scenes, /body\.vertex-motion-off \.vertex-task-visual\{display:none!important\}/);
  const page = fs.readFileSync(path.join(__dirname, "..", "pages", "visual-debug.html"), "utf8");
  assert.match(page, /body\.vertex-motion-off #notice\.busy:before\{display:none\}/);
  const sidebar = fs.readFileSync(path.join(__dirname, "..", "sidebar.js"), "utf8");
  assert.match(sidebar, /body\.vertex-motion-off #messages \.vertex\.task::before \{ display: none; \}/);
});
