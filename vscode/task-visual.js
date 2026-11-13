"use strict";
/* The waiting scenes live once: org.vertex.abap.ui/resources/vertex-task-visual.js, beside the pages that inline them.
   This module only finds that file: the repository's original when running from a checkout, the copy packaging puts
   in resources/ when running from a vsix. */
const fs = require("fs");
const path = require("path");

const original = path.join(__dirname, "..", "org.vertex.abap.ui", "resources", "vertex-task-visual.js");
const packaged = path.join(__dirname, "resources", "vertex-task-visual.js");
const file = fs.existsSync(original) ? original : packaged;
if (!fs.existsSync(file)) {
  throw new Error("vertex-task-visual.js was found neither at " + original + " nor at " + packaged + ".");
}
/* source() hands the file's own text to a webview that has to run the scenes itself: the edit scene is driven from
   JS, so the page needs the module, not only its markup and styles. */
module.exports = Object.assign({}, require(file), { source: () => fs.readFileSync(file, "utf8") });
