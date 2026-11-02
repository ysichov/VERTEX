"use strict";
// The Eclipse pages as the plugin carries them: eclipse/<page> with eclipse-calls.js, the one-request-at-a-time bridge
// to its view, put where the page marks it. eclipse/prepare.js writes them into org.vertex.abap.ui/assistant/.
const fs = require("node:fs");
const path = require("node:path");

const CALLS = "/*ECLIPSE_CALLS*/";

function page(name) {
  const text = fs.readFileSync(path.join(__dirname, name), "utf8");
  return text.includes(CALLS) ? text.replace(CALLS, () => fs.readFileSync(path.join(__dirname, "eclipse-calls.js"), "utf8").trimEnd()) : text;
}

module.exports = { page, CALLS };
