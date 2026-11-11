"use strict";
// What the VERTEX Tools pages share (org.vertex.abap.ui/resources/vertex-page.js) reaches every page on every path a
// host reads it by: VS Code's Tools window, VS Code's single-page window, and Eclipse's PageView.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { toolsPage, RESOURCES, MARKER } = require("./tools-page");

const PAGES = ["metrics.html", "table.html", "versions.html", "chat.html"];
const shared = fs.readFileSync(path.join(RESOURCES, "vertex-page.js"), "utf8");
const scriptsOf = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(match => !match[1].includes("application/json") && match[2].trim()).map(match => match[2]);
// The names vertex-page.js declares: running it declares them and runs none of them.
const declared = (() => { const context = vm.createContext({}); vm.runInContext(shared, context); return Object.keys(context); })();

test("each Tools page marks the shared code once and declares none of its names itself", () => {
  assert.ok(declared.includes("setupPage") && declared.includes("specifyVersion") && declared.includes("fillTypes"));
  for (const name of PAGES) {
    const page = fs.readFileSync(path.join(RESOURCES, name), "utf8");
    assert.equal(page.split(MARKER).length - 1, 1, name + " marks it once");
    // A second declaration would silently replace the shared one: function declarations are hoisted, the last wins.
    for (const own of declared) assert.doesNotMatch(page, new RegExp("^(?:function " + own + "\\(|var " + own + "\\b)", "m"), name + " declares " + own);
  }
  for (const name of ["table.html", "versions.html", "chat.html"])
    assert.match(fs.readFileSync(path.join(RESOURCES, name), "utf8"), /^var USER_KIND = "(user|you)";$/m, name + " says how its user's lines look");
});

test("with the shared code put in, every script of every Tools page parses", () => {
  for (const name of PAGES) {
    const page = toolsPage(name);
    assert.ok(!page.includes(MARKER) && page.includes("function setupPage(detail)"), name);
    scriptsOf(page).forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script), name + " script " + index));
  }
});

test("VS Code's Tools window carries every page with the shared code put in", () => {
  const html = require("../tools-window").html(RESOURCES, null);
  assert.ok(!html.includes(MARKER));
  // chat, metrics, versions and table, each once; the navigator has no use for it.
  assert.equal(html.split("function setupPage(detail)").length - 1, 4);
});

test("VS Code's single-page window puts the shared code in, as extension.js reads a page", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "extension.js"), "utf8");
  const body = name => { const start = source.indexOf("function " + name + "("); return source.slice(start, source.indexOf("\n}\n", start) + 2); };
  // pageHtml requires the extension's own modules (motion.js, vertex-logo.js) by relative path.
  const context = vm.createContext({ fs, path, PAGES: RESOURCES, SHIM: "", SERVICES: require(path.join(RESOURCES, "tool-routes.js")).SERVICES, JSON, String,
    require: id => require(id.startsWith(".") ? path.join(__dirname, "..", id) : id) });
  vm.runInContext(body("pageHtml") + body("initialLiteral"), context);
  for (const service of ["table", "metrics", "versions"]) {
    const page = context.pageHtml(service, null);
    assert.ok(!page.includes(MARKER) && page.includes("function setupPage(detail)"), service);
  }
});

test("Eclipse's PageView puts the shared code into any page it reads, and every bundle read goes through it", () => {
  const ui = path.join(__dirname, "..", "..", "org.vertex.abap.ui", "src", "org", "vertex", "abap", "ui");
  const view = fs.readFileSync(path.join(ui, "PageView.java"), "utf8");
  assert.match(view, /private static final String SHARED_PAGE = "\/\*VERTEX_PAGE\*\/";/);
  assert.match(view, /protected String readResource\(String path\) throws IOException \{\s*String text = readEntry\(path\);[\s\S]*?path\.endsWith\("\.html"\) && text\.contains\(SHARED_PAGE\)[\s\S]*?text\.replace\(SHARED_PAGE, readEntry\("resources\/vertex-page\.js"\)\)/);
  // Nothing else opens a bundle entry: a page cannot be read past the replacement.
  for (const file of fs.readdirSync(ui).filter(name => name.endsWith(".java") && name !== "PageView.java"))
    assert.doesNotMatch(fs.readFileSync(path.join(ui, file), "utf8"), /getEntry\(|readEntry\(/, file);
});
