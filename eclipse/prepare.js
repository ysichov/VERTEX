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
fs.copyFileSync(path.join(root, "org.vertex.abap.ui", "resources", "object-tools.js"), path.join(target, "object-tools.js"));
// Value origin runs in the plugin's browser: the VS Code analysis and page as one script, its stylesheet, and the
// Eclipse page that hosts them.
fs.writeFileSync(path.join(target, "value-origin.js"), require("./value-origin-bundle").bundle(root));
fs.copyFileSync(path.join(root, "vscode", "value-origin.css"), path.join(target, "value-origin.css"));
fs.copyFileSync(path.join(__dirname, "value-origin.html"), path.join(target, "value-origin.html"));
console.log("Prepared Eclipse Value origin.");

// The statement rules are org.vertex.abap.ui/resources/vertex-abap-control.js itself; vscode/abap-control.js only
// finds that file. Copying it over the rules - as this script did - left a finder where the rules belong.

fs.writeFileSync(path.join(root,'org.vertex.abap.ui/resources/vertex-frontend.js'),require('./frontend-bundle').bundle(root));

fs.copyFileSync(path.join(root,"vscode/licenses/abaplint-MIT.txt"),path.join(root,"org.vertex.abap.ui/resources/abaplint-MIT.txt"));

// Visual Debug is the same page in both editors; only its host bridge differs.
fs.copyFileSync(path.join(root, 'vscode/pages/visual-debug.html'), path.join(target, 'visual-debug.html'));
fs.copyFileSync(path.join(__dirname, 'visual-debug-host.js'), path.join(target, 'visual-debug-host.js'));
