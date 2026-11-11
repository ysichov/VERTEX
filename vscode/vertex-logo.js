"use strict";
/* The VERTEX logo as a page needs it: vscode/images/logo.png, the transparent VERTEX mark, put in as a data URL where a
   page or vertex-controls.css marks VERTEX_LOGO. Eclipse's PageView does the same from the copy in its bundle. */
const fs = require("fs");
const path = require("path");

let url = "";
function dataUrl() {
  if (!url) url = "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "images", "logo.png")).toString("base64");
  return url;
}
function fill(text) { return String(text).split("/*VERTEX_LOGO*/").join(dataUrl()); }

module.exports = { dataUrl, fill };
