"use strict";

/* Go to definition in local ABAP files, by abaplint: it knows the type of a variable - an inline DATA(...) = NEW,
   a parameter, an attribute - so lo_x->m( ) leads to m of lo_x's class, zcl_x=>m( ) to zcl_x's, an interface's method
   to the interface. The sources are the workspace's ABAP and XML files and, for a file outside the workspace, its own
   folder's - each as the editor has it where it is open, else as saved. A method found at its declaration leads on to its implementation where the class has one. */

const fs = require("fs");
const path = require("path");
const local = require("./local-analysis");

const cache = { registry: null, texts: new Map(), uris: new Map() };

/* Every source the definition may be in: name -> { uri, text }. */
async function sourcesFor(vscode, document) {
  const found = new Map(), open = new Map((vscode.workspace.textDocuments || []).map(d => [String(d.uri), d]));
  const add = async uri => {
    const name = path.basename(uri.fsPath || uri.path || String(uri)).toLowerCase();
    if (!/\.(?:abap|xml)$/.test(name) || found.has(name)) return;
    const shown = open.get(String(uri));
    let text = shown ? shown.getText() : null;
    if (text == null && uri.scheme === "file" && uri.fsPath && fs.existsSync(uri.fsPath)) text = fs.readFileSync(uri.fsPath, "utf8");
    if (text == null) text = (await vscode.workspace.openTextDocument(uri)).getText();
    found.set(name, { uri, text });
  };
  found.set(path.basename(document.uri.fsPath || document.uri.path || "").toLowerCase(), { uri: document.uri, text: document.getText() });
  if (vscode.workspace.findFiles) for (const uri of await vscode.workspace.findFiles("**/*.{abap,xml}", "**/node_modules/**", 5000)) await add(uri);
  // A file outside the workspace: its neighbours on disk.
  if (document.uri.scheme === "file" && document.uri.fsPath && fs.existsSync(document.uri.fsPath)) {
    const dir = path.dirname(document.uri.fsPath);
    for (const item of fs.readdirSync(dir)) await add({ scheme: "file", fsPath: path.join(dir, item), toString: () => "file:///" + path.join(dir, item) });
  }
  return found;
}

/* The registry of those sources, parsed again only where a text changed. */
function registryFor(sources) {
  const abaplint = require("@abaplint/core");
  if (!cache.registry) cache.registry = new abaplint.Registry();
  const registry = cache.registry;
  for (const [name, { uri, text }] of sources) {
    cache.uris.set(name, uri);
    if (cache.texts.get(name) === text) continue;
    const file = new abaplint.MemoryFile(name, text);
    if (registry.getFileByName(name)) registry.updateFile(file); else registry.addFile(file);
    cache.texts.set(name, text);
  }
  for (const name of [...cache.texts.keys()]) if (!sources.has(name)) {
    registry.removeFile(registry.getFileByName(name)); cache.texts.delete(name); cache.uris.delete(name);
  }
  registry.parse();
  return registry;
}

/* The implementation of a method, in the file its class is defined in: from abaplint's statements. */
function implementationLine(registry, fileName, method) {
  const abaplint = require("@abaplint/core");
  const file = registry.getFileByName(fileName);
  const object = file && registry.findObjectForFile(file);
  for (const abapFile of object?.getABAPFiles?.() || []) {
    for (const statement of abapFile.getStatements()) {
      if (!(statement.get() instanceof abaplint.Statements.MethodImplementation)) continue;
      const name = statement.findDirectExpression(abaplint.Expressions.MethodName)?.concatTokens() || "";
      if (name.toUpperCase() === method.toUpperCase()) return { file: abapFile.getFilename(), line: statement.getStart().getRow() - 1 };
    }
  }
  return null;
}

async function resolve(vscode, document, position) {
  if (!local.sourceObject(document)) return null;
  const registry = registryFor(await sourcesFor(vscode, document));
  const abaplint = require("@abaplint/core");
  const server = new abaplint.LanguageServer(registry);
  const name = path.basename(document.uri.fsPath || document.uri.path || "").toLowerCase();
  let found = server.gotoDefinition({ textDocument: { uri: name }, position: { line: position.line, character: position.character } });
  // A global class or interface named at the cursor (NEW zcl_x( ), TYPE REF TO zif_x): its definition.
  const under = (document.getText().split(/\r?\n/)[position.line] || "").slice(0, position.character).match(/[\w/]*$/)[0]
    + ((document.getText().split(/\r?\n/)[position.line] || "").slice(position.character).match(/^[\w/]*/)[0]);
  const global = under && (registry.getObject("CLAS", under.toUpperCase()) || registry.getObject("INTF", under.toUpperCase()));
  if (global && (!found || String(found.uri).toLowerCase() === name && found.range.start.line === position.line)) {
    const kind = global.getType() === "CLAS" ? abaplint.Statements.ClassDefinition : abaplint.Statements.Interface;
    for (const abapFile of global.getABAPFiles()) {
      const statement = abapFile.getStatements().find(s => s.get() instanceof kind);
      if (statement) { found = { uri: abapFile.getFilename(), range: { start: { line: statement.getStart().getRow() - 1, character: statement.getStart().getCol() - 1 } } }; break; }
    }
  }
  if (!found) return null;
  let file = String(found.uri).toLowerCase(), line = found.range.start.line, character = found.range.start.character;
  // A method's declaration leads on to its implementation, as SAP's navigation does.
  const declared = registry.getFileByName(file)?.getRaw().split(/\r?\n/)[line] || "";
  const word = declared.slice(character).match(/^[\w~/]+/)?.[0];
  if (word && /^\s*(?:CLASS-)?METHODS\b/i.test(declared)) {
    const implemented = implementationLine(registry, file, word);
    if (implemented) { file = implemented.file.toLowerCase(); line = implemented.line; character = (registry.getFileByName(file)?.getRaw().split(/\r?\n/)[line] || "").toUpperCase().indexOf(word.toUpperCase()); }
  }
  if (file === name && line === position.line) return null;
  const uri = cache.uris.get(file);
  if (!uri) return null;
  const target = file === name ? document : await vscode.workspace.openTextDocument(uri);
  const range = new vscode.Range(line, Math.max(0, character), line, Math.max(0, character) + (word || "").length);
  return { document: target, target: new vscode.Location(target.uri, range) };
}

/* Go to definition inside one SAP source that is not sent to SAP: abaplint over that text alone, in a registry of its
   own. A name declared in another object is not found here. */
async function resolveSource(vscode, document, position, objectType, objectName) {
  const abaplint = require("@abaplint/core");
  const kind = { CLAS: "clas", INTF: "intf" }[objectType] || "prog";
  const name = String(objectName).toLowerCase().replace(/\//g, "#") + "." + kind + ".abap";
  const registry = new abaplint.Registry().addFile(new abaplint.MemoryFile(name, document.getText())).parse();
  const found = new abaplint.LanguageServer(registry).gotoDefinition({ textDocument: { uri: name }, position: { line: position.line, character: position.character } });
  if (!found || String(found.uri).toLowerCase() !== name) return null;
  let line = found.range.start.line, character = found.range.start.character;
  const declared = document.getText().split(/\r?\n/)[line] || "";
  const word = declared.slice(character).match(/^[\w~/]+/)?.[0] || "";
  if (word && /^\s*(?:CLASS-)?METHODS\b/i.test(declared)) {
    const implemented = implementationLine(registry, name, word);
    if (implemented) { line = implemented.line; character = (document.getText().split(/\r?\n/)[line] || "").toUpperCase().indexOf(word.toUpperCase()); }
  }
  if (line === position.line) return null;
  const range = new vscode.Range(line, Math.max(0, character), line, Math.max(0, character) + word.length);
  return { document, target: new vscode.Location(document.uri, range) };
}

function register(vscode, context) {
  if (!vscode.languages?.registerDefinitionProvider) { return; }
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(
    [{ scheme: "file", language: "abap" }, { scheme: "untitled", language: "abap" }],
    { provideDefinition: async (document, position) => (await resolve(vscode, document, position))?.target }));
}

module.exports = { resolve, resolveSource, register };
