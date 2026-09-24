"use strict";
const fs = require("fs"), path = require("path");
const source = path.join(__dirname, "..", "org.vertex.abap.ui", "resources", "object-tools.js");
const model = require(fs.existsSync(source) ? source : "./resources/object-tools");

// Visual Debug is VS Code's alone: the debugger it draws lives in this
// extension. Eclipse loads the same model without it. The Tools page gets the
// same call, so the page and the assistant offer the same functions.
const VISUAL_DEBUG = ["vdebug", "Visual Debug", ["PROG", "CLAS", "FUNC"],
  "Visual Debug (action vdebug, PROG, CLAS and FUNC) is the source with breakpoints, the stop and the variables of the "
  + "debugger you drive with the debug_* tools - the same session. Open it when the user asks to debug visually or to see the "
  + "debugger; it does not start a run."];
model.enable(...VISUAL_DEBUG);

module.exports = model;
module.exports.VISUAL_DEBUG = VISUAL_DEBUG;
