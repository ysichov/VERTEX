"use strict";
const fs = require("fs"), path = require("path");
const source = path.join(__dirname, "..", "org.vertex.abap.ui", "resources", "object-tools.js");
module.exports = require(fs.existsSync(source) ? source : "./resources/object-tools");
