"use strict";
// Run before PDE export: bundle the same implementation used by VS Code.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const target = path.join(root, "org.vertex.abap.ui", "assistant");
fs.mkdirSync(target, { recursive: true });
for (const file of ["assistant.js", "mcp.js", "selector.js", "versions.js", "code-review.js", "session-log.js", "direct-search.js"]) {
  fs.copyFileSync(path.join(root, "vscode", file), path.join(target, file));
}
for (const file of ["bridge.js", "chat.js"]) {
  fs.copyFileSync(path.join(__dirname, file), path.join(target, file));
}
console.log("Prepared Eclipse assistant runtime.");
