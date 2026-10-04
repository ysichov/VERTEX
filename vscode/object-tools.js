"use strict";
const fs = require("fs"), path = require("path");
const source = path.join(__dirname, "..", "org.vertex.abap.ui", "resources", "object-tools.js");
const model = require(fs.existsSync(source) ? source : "./resources/object-tools");

// Visual Debug is not an object view: it is the docked panel beside the editor
// (vertex.openVisualDebug), so neither this model nor the Tools page offers it.
module.exports = model;
