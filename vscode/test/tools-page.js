"use strict";
// A VERTEX Tools page as a host hands it to the browser: the page with what the Tools pages share (vertex-page.js) put
// where it marks it - as tools-window.js, extension.js and Eclipse's PageView do. FILE, when given, is a page read from
// elsewhere (the packaged VSIX); the shared file beside it is used when there is one.
const fs = require("node:fs");
const path = require("node:path");

const RESOURCES = path.join(__dirname, "..", "..", "org.vertex.abap.ui", "resources");
const MARKER = "/*VERTEX_PAGE*/";

function toolsPage(name, file) {
  const page = file || path.join(RESOURCES, name);
  const beside = path.join(path.dirname(page), "vertex-page.js");
  const shared = fs.readFileSync(fs.existsSync(beside) ? beside : path.join(RESOURCES, "vertex-page.js"), "utf8");
  return fs.readFileSync(page, "utf8").replace(MARKER, () => shared);
}

module.exports = { toolsPage, RESOURCES, MARKER };
