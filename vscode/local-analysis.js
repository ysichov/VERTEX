"use strict";

const path = require("path");
const analysis = require("./frontend-analysis");

function isLocalAbap(document) {
  const uri = document && document.uri;
  return !!(uri && ["file", "untitled"].includes(uri.scheme) &&
    (document.languageId === "abap" || /\.abap$/i.test(uri.fsPath || uri.path || "")));
}

function sourceObject(document) {
  if (!isLocalAbap(document)) { return null; }
  const text = document.getText();
  const declaration = /^\s*(?:CLASS|INTERFACE|REPORT|PROGRAM)\s+([\w/]+)/im.exec(text);
  const kind = /^\s*(CLASS|INTERFACE|REPORT|PROGRAM)\b/im.exec(text)?.[1]?.toUpperCase();
  const filename = path.basename(document.uri.fsPath || document.uri.path || "");
  // A function group's file (abapGit: <group>.fugr.<include or module>.abap): the module or include it holds.
  const group = /^([^.]+)\.fugr\.([^.]+)\.abap$/i.exec(filename);
  if (group) return /^[A-Z0-9_/$]+$/i.test(group[2]) ? { object_name: group[2].toUpperCase(), object_type: "FUNC", group: group[1].toUpperCase() } : null;
  const suffix = /\.(clas|intf|prog|incl)\.abap$/i.exec(filename)?.[1]?.toUpperCase();
  const base = filename.replace(/\.(?:clas|intf|prog|incl)\.abap$/i, "").replace(/\.abap$/i, "");
  const name = (suffix ? base : declaration?.[1] || base).toUpperCase();
  const type = suffix ? ({ CLAS: "CLAS", INTF: "INTF" }[suffix] || "PROG")
    : kind === "CLASS" ? "CLAS" : kind === "INTERFACE" ? "INTF" : "PROG";
  return /^[A-Z0-9_/$]+$/.test(name) ? { object_name: name, object_type: type } : null;
}

// A module's parameters, for a local file of a function group whose XML is beside it.
function functionParams(uri) {
  if (!uri || uri.scheme !== "file") return {};
  const params = require("./sap-fugr").moduleParameters(uri.fsPath);
  return params.length ? { functionParams: params } : {};
}

async function declaredVariables(document, request = {}, vscode) {
  const object = sourceObject(document);
  if (!object) throw new Error("Open a local ABAP program or class first.");
  const parser = require("./value-origin-linter").createParser();
  try {
    const uri = document.uri.toString();
    const parsed = await parser.parse({ id: uri, name: object.object_name,
      objectName: object.object_name, objectType: object.object_type, text: document.getText(), ...functionParams(document.uri) });
    const sources = [parsed.source];
    if (vscode?.workspace?.findFiles && vscode.workspace.openTextDocument) {
      const session = create(vscode, document, object);
      const loaded = new Set([object.object_type + ":" + object.object_name]);
      const add = async (name, type) => {
        const key = type + ":" + name;
        if (loaded.has(key)) return;
        loaded.add(key);
        try {
          const dependency = await session.find(name, type);
          const result = await parser.parse({ id: dependency.uri.toString(), name, objectName: name,
            objectType: type, text: dependency.getText(), ...functionParams(dependency.uri) });
          sources.push(result.source);
        } catch (_) { /* A missing dependency must not hide the report's own variables. */ }
      };
      // Inline DATA from NEW class( )->method( ) gets its type from the method signature.
      for (const [, name] of document.getText().matchAll(/\bNEW\s+([A-Z][\w/]*)\s*\(/gi))
        await add(name.toUpperCase(), "CLAS");
      // RETURNING types commonly live in a separate global interface.
      for (const source of [...sources])
        for (const [, name] of source.text.matchAll(/\b([A-Z][\w/]*)\s*=>\s*[A-Z][\w/]*/gi))
          if (/^(?:Z|Y)IF_/i.test(name)) await add(name.toUpperCase(), "INTF");
    }
    const graph = require("./value-origin").analyze(sources, { source: uri, line: 1 });
    const declarations = graph.declarations || [];
    const focus = Number.isInteger(request.line) ? require("./value-origin-points").routineAt(declarations,
      { objectType: object.object_type, objectName: object.object_name, targetSource: uri, line: request.line }) : null;
    const global = declarations.find(item => item.source === uri && item.name === "GLOBAL");
    const answer = { ...object, line: request.line || null,
      scope: focus ? String(focus.owner || "").toUpperCase() + "->" + String(focus.name).toUpperCase() : "",
      name: focus ? String(focus.name).toUpperCase() : "",
      params: focus?.params || [], locals: focus?.locals || [],
      globals: !focus || request.globals ? (global?.locals || []) : null };
    if (vscode?.workspace?.findFiles) {
      const session = create(vscode, document, object);
      answer.warnings = await require("./value-origin-points").completeStructures(
        { globals: answer.globals || [], routines: [{ params: answer.params, locals: answer.locals }] },
        require("./value-origin").typeComponents,
        async name => (await session.find(name, "INTF")).getText());
    }
    return answer;
  } finally { await parser.close(); }
}

function create(vscode, primary, object) {
  const documents = new Map([[object.object_type + ":" + object.object_name, primary]]);
  async function find(name, type) {
    name = String(name).toUpperCase();
    type = String(type).toUpperCase();
    const key = type + ":" + name;
    if (documents.has(key)) { return documents.get(key); }
    if (!vscode.workspace.findFiles) { throw new Error(name + " was not found in the local workspace."); }
    const uris = await vscode.workspace.findFiles("**/*.abap", "**/node_modules/**", 2000);
    const ownerFolder = path.dirname(primary.uri.fsPath || primary.uri.path || "");
    const candidates = uris.filter(uri => path.basename(uri.fsPath || uri.path || "").toUpperCase().startsWith(name + "."));
    const matches = [];
    for (const uri of candidates) {
      const document = await vscode.workspace.openTextDocument(uri);
      const found = sourceObject(document);
      if (found?.object_name === name && found.object_type === type) {
        if (path.dirname(uri.fsPath || uri.path || "") === ownerFolder) {
          documents.set(key, document); return document;
        }
        matches.push(document);
      }
    }
    if (matches.length > 1) throw new Error(name + " occurs in multiple package folders. Open the intended package folder first.");
    if (matches.length === 1) { documents.set(key, matches[0]); return matches[0]; }
    throw new Error(name + " was not found in the local workspace.");
  }
  async function request(resource, progress, cancelled) {
    const api = { local: true, analysisReader: () => async ({ object_name, object_type }) => {
      const document = await find(object_name, object_type);
      return { object_name, object_type, source_url: document.uri.toString(), source: document.getText(), includes: [] };
    }, objectNavigator };
    return analysis.request(api, resource, progress, cancelled);
  }
  /* Object Navigator of a local program: its tree from the parse of the program and its includes, each include a file of
     its own as abapGit writes it. The Parts list keeps its own reading of the source. */
  async function objectNavigator(name, type, node, parts) {
    if (parts) throw new Error("Object Navigator is not available for this system.");
    if (type !== "PROG") throw new Error("Object Navigator of local files shows a program; " + type + " needs a SAP system.");
    const { parseSource } = require("./value-origin-linter");
    const read = [], seen = new Set();
    for (let queue = [String(name).toUpperCase()]; queue.length;) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      const document = await find(next, "PROG");
      const statements = parseSource({ id: document.uri.toString(), name: next, objectName: next, objectType: "PROG", text: document.getText() }).source.aceStatements;
      read.push({ name: next, statements });
      for (const s of statements) if (s.parserKind === "Include" && s.tokens[1]) queue.push(String(s.tokens[1].value).toUpperCase());
    }
    return require("./object-navigator").localTree(read);
  }
  async function openSource(args) {
    const document = await find(args.name, args.type || object.object_type);
    const lines = document.getText().split(/\r?\n/);
    const method = String(args.method || "").toUpperCase();
    const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let found = method ? lines.findIndex(line => new RegExp("^\\s*(?:METHOD|FORM|FUNCTION)\\s+" + escaped + "\\b", "i").test(line)) : -1;
    if (found < 0 && method) found = lines.findIndex(line => new RegExp("^\\s*(?:CLASS-)?METHODS\\s+" + escaped + "\\b", "i").test(line));
    const line = Number.isInteger(args.line) && args.line > 0 ? args.line - 1 : Math.max(0, found);
    const at = new vscode.Position(Math.min(document.lineCount - 1, line), 0);
    const editor = await vscode.window.showTextDocument(document, { viewColumn: args.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.One, preserveFocus: args.preserveFocus === true });
    editor.selection = new vscode.Selection(at, at);
    editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  return { object, primary, find, request, openSource, documentObject: document => {
    const found = sourceObject(document);
    return found && documents.get(found.object_type + ":" + found.object_name) === document ? found : null;
  } };
}

async function createPackage(vscode, folder) {
  const root = path.resolve(folder.fsPath || folder.path);
  const pattern = vscode.RelativePattern ? new vscode.RelativePattern(folder, "**/*.abap") : "**/*.abap";
  const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 2000);
  const documents = new Map();
  for (const uri of uris) {
    const file = path.resolve(uri.fsPath || uri.path || "");
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    const document = await vscode.workspace.openTextDocument(uri);
    const object = sourceObject(document);
    if (object) {
      const key = object.object_type + ":" + object.object_name;
      const previous = documents.get(key);
      if (previous && previous.uri.toString() !== uri.toString())
        throw new Error(object.object_name + " occurs in multiple folders. Select one package folder to resolve this name.");
      documents.set(key, document);
    }
  }
  if (!documents.size) throw new Error("No ABAP programs or classes were found in this folder.");
  const name = (path.basename(root).toUpperCase().replace(/[^A-Z0-9_/$]/g, "_") || "LOCAL_PACKAGE");
  const object = { object_name: name, object_type: "DEVC" };
  const first = documents.values().next().value;
  const session = create(vscode, first, sourceObject(first));
  const find = async (name, type) => {
    const document = documents.get(String(type).toUpperCase() + ":" + String(name).toUpperCase());
    if (!document) throw new Error(name + " was not found in the local package.");
    return document;
  };
  const api = { local: true,
    packageObjects: async () => [...documents.keys()].map(key => {
      const [object_type, object_name] = key.split(":"); return { object_type, object_name };
    }),
    analysisReader: () => async ({ object_name, object_type }) => {
      const document = await find(object_name, object_type);
      return { object_name, object_type, source_url: document.uri.toString(), source: document.getText(), includes: [] };
    }
  };
  let versions = "";
  return { ...session, object, find,
    request: (resource, progress, cancelled) => {
      const current = [...documents.values()].map(document => document.uri.toString() + ":" + document.version).join("\n");
      if (current !== versions) { analysis.invalidate(api); versions = current; }
      return analysis.request(api, resource, progress, cancelled);
    },
    openSource: async args => {
      const document = await find(args.name, args.type || "CLAS");
      return create(vscode, document, sourceObject(document)).openSource(args);
    },
    documentObject: document => {
      const found = sourceObject(document);
      return found && documents.get(found.object_type + ":" + found.object_name) === document ? found : null;
    }
  };
}

async function originSources(vscode, document, target, progress = () => {}, cancelled = () => false, onParsed = () => {}) {
  const object = sourceObject(document);
  if (!object) { throw new Error("Open a local ABAP program or class first."); }
  const session = create(vscode, document, object);
  const parser = require("./value-origin-linter").createParser(cancelled);
  const parsed = new Map(), warnings = [];
  async function load(name, type) {
    if (cancelled()) { throw new Error("Value origin cancelled."); }
    const current = await session.find(name, type);
    const id = current.uri.toString();
    if (parsed.has(id)) { return [parsed.get(id)]; }
    progress(name);
    const result = await parser.parse({ id, name, objectName: name, objectType: type, text: current.getText(), ...functionParams(current.uri) });
    parsed.set(id, result.source);
    warnings.push(...result.warnings);
    onParsed(result.source);
    return [result.source];
  }
  try {
    const [own] = await load(object.object_name, object.object_type);
    const position = document.offsetAt(new vscode.Position(target.line - 1, target.column || 0));
    const offset = own.aceStatements.filter(statement => statement.offset <= position).at(-1)?.offset ?? position;
    const mapped = { ...target, source: own.id, offset };
    const collected = await require("./value-origin-pipeline").collect([own], mapped,
      { load, loadPart: async () => [], cancelled, progress });
    return { ...collected, diagnostics: ["Local ABAP source + abaplint"], warnings: [...warnings, ...collected.warnings],
      target: mapped, sourceFor: uri => parsed.has(uri) ? uri : null,
      openSource: async (source, node) => ({ document: await session.find(source.objectName, source.objectType), line: node.line }) };
  } finally { await parser.close(); }
}

function whereUsed(vscode, primary, sourceOf) {
  let documents;
  async function all() {
    if (!documents) {
      documents = new Map([[primary.uri.toString(), primary]]);
      const uris = vscode.workspace.findFiles ? await vscode.workspace.findFiles("**/*.abap", "**/node_modules/**", 2000) : [];
      for (const uri of uris) if (!documents.has(uri.toString())) {
        const document = await vscode.workspace.openTextDocument(uri);
        if (sourceObject(document)) documents.set(uri.toString(), document);
      }
    }
    return documents.values();
  }
  return async (source, line, column) => {
    const selected = source.text.split(/\r?\n/)[line - 1] || "";
    const name = /^\s*(?:METHOD|FORM)\s+([\w~]+)/i.exec(selected)?.[1]
      || /[A-Za-z_][\w-]*/.exec(selected.slice(column))?.[0];
    if (!name) return { places: [], skipped: [] };
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const routine = /^\s*(?:METHOD|FORM)\b/i.test(selected);
    const pattern = routine ? new RegExp("(?:->|=>)\\s*" + escaped + "\\b|\\bPERFORM\\s+" + escaped + "\\b", "i")
      : new RegExp("\\b" + escaped + "\\b", "i");
    const places = [];
    for (const document of await all()) {
      const data = sourceObject(document), lines = document.getText().split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) if (pattern.test(lines[i]) && !/^\s*(?:METHODS?|FORM)\b/i.test(lines[i])) {
        places.push({ source: await sourceOf(document, data), line: i + 1 });
      }
    }
    return { places, skipped: [] };
  };
}

module.exports = { isLocalAbap, sourceObject, declaredVariables, create, createPackage, originSources, whereUsed };
