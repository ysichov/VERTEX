"use strict";
/* The statement rules live once: org.vertex.abap.ui/resources/vertex-abap-control.js, beside the pages that inline them.
   They used to be kept twice - here and there - and packaging overwrote the page copy with this one, so a fix made in
   one of them did not ship. This module only finds that file: the repository's original when running from a checkout,
   the copy packaging puts in resources/ when running from a vsix. */
const fs = require("fs");
const path = require("path");

const original = path.join(__dirname, "..", "org.vertex.abap.ui", "resources", "vertex-abap-control.js");
const packaged = path.join(__dirname, "resources", "vertex-abap-control.js");
const file = fs.existsSync(original) ? original : packaged;
if (!fs.existsSync(file)) {
  throw new Error("vertex-abap-control.js was found neither at " + original + " nor at " + packaged + ".");
}
module.exports = require(file);
module.exports.file = file;
