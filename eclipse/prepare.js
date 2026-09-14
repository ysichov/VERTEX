"use strict";
// Run before PDE export: bundle the same implementation used by VS Code.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const target = path.join(root, "org.vertex.abap.ui", "assistant");
fs.mkdirSync(target, { recursive: true });
for (const file of ["assistant.js", "mcp.js", "selector.js", "versions.js"]) {
  fs.copyFileSync(path.join(root, "vscode", file), path.join(target, file));
}
fs.copyFileSync(path.join(__dirname, "bridge.js"), path.join(target, "bridge.js"));
console.log("Prepared Eclipse assistant runtime.");
