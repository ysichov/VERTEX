"use strict";
/* The Value origin page as it ships: built from the files packaging puts in resources/, its scripts run in order in one
   global scope, as a webview runs them. A top-level name declared twice - `const api` in a shared script and again in
   the page - is a SyntaxError raised before a script runs, and it silently killed every click in the window once. A
   runtime error here only means there is no DOM; a SyntaxError means the page is broken. */
const test = require("node:test"), assert = require("node:assert/strict");
const vm = require("vm"), path = require("path"), { execFileSync } = require("child_process"), fs = require("fs");

test("the packaged Value origin page loads every script without a syntax error or a clash of global names", () => {
  // What packaging does first: the shared files are copied beside the extension.
  execFileSync(process.execPath, [path.join(__dirname, "..", "copy-pages.js")], { stdio: "ignore" });
  const original = path.join(__dirname, "..", "..", "org.vertex.abap.ui", "resources", "vertex-abap-control.js");
  assert.equal(fs.readFileSync(path.join(__dirname, "..", "resources", "vertex-abap-control.js"), "utf8"),
    fs.readFileSync(original, "utf8"), "the packaged statement rules are the one original");
  const { analyze } = require("./origin-view-fixture");
  const { html } = require("../value-origin-view");
  const text = ["REPORT zpage.", "DATA a TYPE i.", "a = 1.", "WRITE a."].join("\n");
  const page = html(analyze([{ id: "zpage.prog.abap", text }], { source: "zpage.prog.abap", line: 4, variable: "a" }), "n");
  const scripts = [...page.matchAll(/<script nonce="n">([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 3, "the page inlines its scripts");
  const context = vm.createContext({ acquireVsCodeApi: () => ({ postMessage() {} }), console });
  for (const [at, script] of scripts.entries()) {
    try { new vm.Script(script, { filename: "page-script-" + at + ".js" }).runInContext(context); }
    catch (error) {
      if (error && error.name === "SyntaxError") { assert.fail("script " + at + " of the page does not load: " + error.message); }
    }
  }
});
