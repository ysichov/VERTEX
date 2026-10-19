"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const http = require("http");

let selectorQuery;
function setSelectorQuery(query) { selectorQuery = query; }
function selectorSql(input) {
  if (!input || typeof input.select !== "string") throw new Error("Unsupported Open SQL request.");
  const sql = input.select.trim().replace(/~/g, ".")
    .replace(/"([A-Za-z_]\w*)"AS\b/gi, '"$1" AS')
    .replace(/"([A-Za-z_]\w*)"/g, "$1");
  if (!/^SELECT\s/i.test(sql) || /;|--|\/\*/.test(sql)) throw new Error("Unsupported Open SQL SELECT syntax.");
  return sql.replace(/\s+ORDER BY PRIMARY KEY\b/gi,
    input.primaryKey?.length ? " ORDER BY " + input.primaryKey.join(", ") : "")
    .replace(/\s+UP TO\s+\d+\s+ROWS\b/gi, "");
}
async function startSelectorBridge(query = selectorQuery) {
  if (!query) throw new Error("SAP SelecTor is unavailable in this VS Code window.");
  const token = crypto.randomBytes(24).toString("hex");
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/select" || request.headers.authorization !== "Bearer " + token) {
      response.writeHead(403).end(); return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024) throw new Error("SELECT request is too large.");
      }
      const input = JSON.parse(body);
      const limit = /\bUP TO\s+(\d+)\s+ROWS\b/i.exec(input.select || "");
      const sql = selectorSql(input);
      const data = await query(sql, limit ? Number(limit[1]) : 10000);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ rows: (data.values || []).map(row =>
        Object.fromEntries(Object.entries(row).map(([name, value]) => [name.toLowerCase(), value]))) }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { env: { VERTEX_SELECTOR_PORT: String(server.address().port), VERTEX_SELECTOR_TOKEN: token },
    close: () => server.close() };
}

function modulePath(root, name) { return path.join(root, "node_modules", ...name.split("/")); }
/* The program's selection screen 1000 (selection-screen.js) and the texts it is shown with: the radio groups, the other
   PARAMETERS and the SELECT-OPTIONS are each taken from it. */
const screenModel = document => require("./selection-screen").selectionScreen(document.getText()).elements;
function scenariosFor(document) {
  const groups = new Map();
  for (const element of screenModel(document)) {
    if (element.kind !== "parameter" || !element.radio) continue;
    if (!groups.has(element.radio)) groups.set(element.radio, { group: element.radio, choices: [], default: "" });
    const group = groups.get(element.radio);
    group.choices.push({ name: element.name, label: element.name });
    if (element.default && element.default.toUpperCase() === "X") group.default = element.name;
  }
  return [...groups.values()];
}
function parametersFor(document) {
  return screenModel(document).filter(element => element.kind === "parameter" && !element.radio).map(element => ({
    name: element.name, kind: element.checkbox ? "checkbox" : "value",
    default: element.checkbox ? (element.default.toUpperCase() === "X" ? "X" : "") : element.defaultName ? "" : element.default,
    numeric: element.numeric, upper: element.upper }));
}
function rangesFor(document) { return screenModel(document).filter(element => element.kind === "select-option"); }
/* The selection screen as the panel draws it, with its texts: abapGit's text pool beside a local file, or the texts an
   SAP run read with the program (vertex-texts.json in its folder). */
function screenFor(document) {
  const file = document.uri.fsPath, texts = { selections: {}, symbols: {} };
  const pool = file.replace(/\.abap$/i, ".xml");
  if (fs.existsSync(pool)) Object.assign(texts, require("./selection-screen").textPoolOf(fs.readFileSync(pool, "utf8")));
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const read = path.join(dir, "vertex-texts.json");
    if (fs.existsSync(read)) {
      const all = JSON.parse(fs.readFileSync(read, "utf8")), own = all[path.basename(file).split(".")[0].toUpperCase()];
      if (own) Object.assign(texts, own);
      if (own?.error) texts.error = own.error;
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  return { elements: screenModel(document), texts };
}

function automaticInputFilter(file, inputRoot) {
  const candidates = new Map();
  function scan(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const location = path.join(dir, item.name);
      if (item.isDirectory()) scan(location);
      else if (/\.(?:(?:clas|intf)\.abap|(?:tabl|dtel|doma)\.xml)$/i.test(item.name)) {
        candidates.set(item.name.split(".")[0].toLowerCase(), location);
      }
    }
  }
  scan(inputRoot);
  const selected = new Set();
  function include(sourceFile) {
    if (selected.has(sourceFile)) return;
    selected.add(sourceFile);
    // A function module is part of its group: the group's XML and every include of it go with it.
    const group = /^(.+?)\.fugr\./i.exec(path.basename(sourceFile));
    if (group) for (const sibling of fs.readdirSync(path.dirname(sourceFile))) {
      if (sibling.toLowerCase().startsWith(group[1].toLowerCase() + ".fugr.")) include(path.join(path.dirname(sourceFile), sibling));
    }
    if (/\.(?:clas|intf|prog)\.abap$/i.test(sourceFile)) {
      const metadata = sourceFile.replace(/\.abap$/i, ".xml");
      if (fs.existsSync(metadata)) selected.add(metadata);
    }
    const source = fs.readFileSync(sourceFile, "utf8").replace(/^\s*\*.*$/gm, "");
    for (const [name, location] of candidates) {
      if (!selected.has(location) && new RegExp("\\b" + name + "\\b", "i").test(source)) include(location);
    }
  }
  include(file);
  const filters = [...selected].map(sourceFile => {
    const escaped = path.basename(sourceFile).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return "(?:^|[/\\\\])" + escaped + "$";
  });
  const classes = [...selected].filter(sourceFile => /\.(?:clas|intf)\.abap$/i.test(sourceFile))
    .map(sourceFile => path.basename(sourceFile).replace(/\.(?:clas|intf)\.abap$/i, "").toUpperCase());
  return { filters, classes, files: [...selected] };
}

function coreDdicNames(core) {
  const names = new Set();
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (/\.dtel\.xml$/i.test(item.name)) names.add(item.name.replace(/\.dtel\.xml$/i, "").toUpperCase());
    }
  }
  if (fs.existsSync(path.join(core, "src", "ddic"))) visit(path.join(core, "src", "ddic"));
  return names;
}

function localDdicAliases(files, folder, known = new Set()) {
  const names = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bCHAR(\d{1,4})\b/gi)) names.add("CHAR" + Number(match[1]));
    for (const alias of ["XFELD", "WERTV8", "LAND1", "WAERS", "DATS", "MANDT", "INT4"]) {
      if (new RegExp("\\b" + alias + "\\b", "i").test(source)) names.add(alias);
    }
  }
  if (!names.size) return [];
  fs.mkdirSync(folder, { recursive: true });
  const created = [];
  for (const name of names) {
    if (known.has(name) || files.some(file => path.basename(file).toUpperCase() === name + ".DTEL.XML")) continue;
    const length = name.startsWith("CHAR") ? Number(name.slice(4)) :
      ({ XFELD: 1, LAND1: 3, WAERS: 5, WERTV8: 15, DATS: 8, MANDT: 3, INT4: 10 })[name];
    const datatype = name === "WERTV8" ? "CURR" : name === "DATS" ? "DATS" : name === "INT4" ? "INT4" : "CHAR";
    const decimals = name === "WERTV8" ? "<DECIMALS>2</DECIMALS>" : "";
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_DTEL" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DD04V><ROLLNAME>${name}</ROLLNAME><DATATYPE>${datatype}</DATATYPE><LENG>${length}</LENG>${decimals}</DD04V></asx:values></asx:abap></abapGit>`;
    fs.writeFileSync(path.join(folder, name.toLowerCase() + ".dtel.xml"), xml);
    created.push(name);
  }
  return created;
}

async function flowClasses(file, inputRoot) {
  const classFiles = [];
  function scan(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const location = path.join(dir, item.name);
      if (item.isDirectory()) scan(location);
      else if (/\.(?:clas|intf)\.abap$/i.test(item.name)) classFiles.push(location);
    }
  }
  scan(inputRoot);
  const { createParser } = require("./value-origin-linter");
  const { buildIndex } = require("./value-origin-model");
  const { analysisUnits } = require("./frontend-analysis");
  const callGraph = require("./call-graph");
  const parser = createParser();
  try {
    const sources = [];
    for (const location of [file, ...classFiles]) {
      const filename = path.basename(location);
      const objectType = /\.clas\.abap$/i.test(filename) ? "CLAS" : /\.intf\.abap$/i.test(filename) ? "INTF" : "PROG";
      const source = { id: location, name: filename, objectName: filename.split(".")[0].toUpperCase(),
        objectType, text: fs.readFileSync(location, "utf8") };
      sources.push((await parser.parse(source)).source);
    }
    const index = buildIndex(sources), units = analysisUnits(index), graph = callGraph.create(index, units);
    const rootName = path.basename(file).split(".")[0].toUpperCase();
    const entries = units.filter(unit => unit.source.objectName === rootName && unit.unitType === "EVENT");
    const used = new Set();
    await callGraph.walk(entries, { calls: async (procedure, statement) => graph.calls(procedure, statement),
      onCall: (_procedure, _statement, record) => {
        for (const target of record.targets) if (["CLAS", "INTF"].includes(target.source.objectType))
          used.add(target.source.objectName);
      } });
    return [...used].sort();
  } finally { await parser.close(); }
}

async function prepareFlow(project, document, output) {
  if (!project.automatic) return;
  const config = JSON.parse(fs.readFileSync(project.configFile, "utf8"));
  const inputRoot = path.resolve(project.root,
    Array.isArray(config.input_folder) ? config.input_folder[0] : config.input_folder);
  try {
    const names = await flowClasses(document.uri.fsPath, inputRoot);
    const filenames = new Map();
    function scan(dir) {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const location = path.join(dir, item.name);
        if (item.isDirectory()) scan(location);
        else if (/\.(?:clas|intf)\.abap$/i.test(item.name)) filenames.set(item.name.split(".")[0].toUpperCase(), location);
      }
    }
    scan(inputRoot);
    for (const name of names) {
      const location = filenames.get(name);
      if (!location) continue;
      const dependency = automaticInputFilter(location, inputRoot);
      config.input_filter.push(...dependency.filters);
      project.includedClasses.push(...dependency.classes);
    }
    config.input_filter = [...new Set(config.input_filter)];
    project.includedClasses = [...new Set(project.includedClasses)].sort();
    fs.writeFileSync(project.configFile, JSON.stringify(config));
    output.appendLine("Flow classes: " + (names.join(", ") || "none"));
  } catch (error) { output.appendLine("Flow analysis unavailable: " + error.message); }
}

/* Where a file without abap_transpile.json is transpiled from: the workspace it is in, else its folder (the one above a
   src folder), and the input folder inside that. */
function automaticRoot(file, workspaceRoot) {
  const workspace = workspaceRoot && path.resolve(workspaceRoot);
  const insideWorkspace = workspace && (file === workspace || file.startsWith(workspace + path.sep));
  const parent = path.dirname(file);
  const root = insideWorkspace ? workspace : path.basename(parent).toLowerCase() === "src" ? path.dirname(parent) : parent;
  const input = fs.existsSync(path.join(root, "src")) && file.startsWith(path.join(root, "src") + path.sep) ? "src" : ".";
  return { root, input };
}

/* A method or function module at the line of a class or function group file, with the screen of its parameters:
   null where the line is in neither, or the file is no class or group. An error says why it cannot be called. */
function entryScreen(document, line) {
  const entry = require("./local-entry");
  const file = path.resolve(document.uri.fsPath);
  const target = entry.targetAt(file, document.getText(), line);
  if (!target) return null;
  const { root, input } = automaticRoot(file, null);
  const files = automaticInputFilter(file, path.join(root, input)).files;
  return entry.screenOf(entry.parametersOf(target, files), files);
}

/* The sources a transpiler run of this document takes: under its abap_transpile.json project, or the file and what it
   uses. A breakpoint anywhere else belongs to another object, not to this run. */
function runScope(vscode, document) {
  const file = path.resolve(document.uri.fsPath);
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "abap_transpile.json"))) return { root: dir };
    if (path.dirname(dir) === dir) break;
  }
  const { root, input } = automaticRoot(file, vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath);
  return { files: automaticInputFilter(file, path.join(root, input)).files.filter(f => /\.abap$/i.test(f)).map(f => path.resolve(f)) };
}

function projectFor(document, workspaceRoot, driver) {
  if (!document || document.uri.scheme !== "file" || !/\.abap$/i.test(document.uri.fsPath)) {
    throw new Error("Open a saved local .abap file first.");
  }
  let dir = path.dirname(document.uri.fsPath);
  while (true) {
    const configFile = path.join(dir, "abap_transpile.json");
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
      if (!config.output_folder || typeof config.output_folder !== "string") {
        throw new Error("abap_transpile.json needs an output_folder.");
      }
      if (config.write_source_map !== true) {
        throw new Error("Set write_source_map to true in abap_transpile.json for ABAP source debugging.");
      }
      const localCli = path.join(modulePath(dir, "@abaplint/transpiler-cli"), "abap_transpile");
      const bundledCli = path.join(modulePath(__dirname, "@abaplint/transpiler-cli"), "abap_transpile");
      const cli = fs.existsSync(localCli) ? localCli : bundledCli;
      if (!fs.existsSync(cli)) {
        throw new Error("The VERTEX transpiler is missing. Reinstall the VS Code extension.");
      }
      // The folder VERTEX wrote for an SAP object's run is VERTEX's own: the program that calls a method goes into its inputs.
      if (driver && fs.existsSync(path.join(dir, "vertex-includes.json"))) {
        config.input_folder = [...new Set([].concat(config.input_folder, path.dirname(driver)))];
        config.input_filter = [...new Set(config.input_filter.concat("(?:^|[/\\\\])" + path.basename(driver).replace(/[.]/g, "\\.") + "$"))];
        fs.writeFileSync(configFile, JSON.stringify(config));
      } else if (driver) throw new Error("A method or function module of a project with its own abap_transpile.json cannot be run yet: its inputs are the project's.");
      return { root: dir, configFile, cli, entry: path.resolve(dir, config.output_folder, "index.mjs") };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const file = path.resolve(document.uri.fsPath);
  const { root, input } = automaticRoot(file, workspaceRoot);
  const dependencyList = automaticInputFilter(file, path.join(root, input));
  const key = crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
  const temporary = path.join(os.tmpdir(), "vertex-local-abap", key + "-" + process.pid);
  fs.mkdirSync(temporary, { recursive: true });
  const configFile = path.join(temporary, "abap_transpile.json");
  const outputFolder = path.join(temporary, "output");
  const core = path.join(__dirname, "vendor", "open-abap-core");
  const hasCore = fs.existsSync(path.join(core, "src"));
  const aliases = localDdicAliases(dependencyList.files, path.join(temporary, "ddic"),
    hasCore ? coreDdicNames(core) : new Set());
  const filters = dependencyList.filters.concat(aliases.map(name =>
    "(?:^|[/\\\\])" + name.toLowerCase() + "\\.dtel\\.xml$"));
  if (hasCore) filters.push("(?:^|[/\\\\])[^/\\\\]+\\.(?:dtel|doma)\\.xml$");
  const inputs = [input];
  // A method or function module run: the program that calls it, from a folder of its own.
  if (driver) { inputs.push(path.dirname(driver)); filters.push("(?:^|[/\\\\])" + path.basename(driver).replace(/[.]/g, "\\.") + "$"); }
  if (hasCore) inputs.push(path.join(core, "src", "ddic"));
  if (aliases.length) inputs.push(path.join(temporary, "ddic"));
  fs.writeFileSync(configFile, JSON.stringify({ input_folder: inputs.length > 1 ? inputs : input,
    input_filter: filters, output_folder: outputFolder,
    write_unit_tests: true, write_source_map: true, options: { addFilenames: true } }));
  const cli = path.join(modulePath(__dirname, "@abaplint/transpiler-cli"), "abap_transpile");
  if (!fs.existsSync(cli)) throw new Error("The VERTEX transpiler is missing. Reinstall the VS Code extension.");
  // A local file's build is taken again while no source of its folder changed: the stamp is every ABAP and XML file
  // there - its path, size and last change - and the configuration, so an edit, a new file or a removed one transpiles.
  const stampParts = [JSON.stringify(fs.readFileSync(configFile, "utf8"))];
  const stampOf = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const at = path.join(dir, item.name);
    if (item.isDirectory()) { if (!["node_modules", ".git"].includes(item.name)) stampOf(at); }
    else if (/\.(?:abap|xml)$/i.test(item.name)) { const stat = fs.statSync(at); stampParts.push(at + " " + stat.size + " " + stat.mtimeMs); }
  } };
  stampOf(path.join(root, input));
  return { root, configFile, cli, entry: path.join(outputFolder, "index.mjs"), automatic: true,
    includedClasses: dependencyList.classes, stamp: crypto.createHash("sha256").update(stampParts.join("\n")).digest("hex") };
}

function stageRuntime(project) {
  const outputRoot = path.dirname(project.entry);
  const visited = new Set();
  function stripMissingMaps(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const location = path.join(dir, item.name);
      if (item.isDirectory()) stripMissingMaps(location);
      else if (item.name.endsWith(".js")) {
        const contents = fs.readFileSync(location, "utf8");
        const cleaned = contents.replace(/^\/\/# sourceMappingURL=([^\r\n]+\.map)\r?$/gm,
          (line, mapName) => fs.existsSync(path.join(dir, mapName)) ? line : "");
        if (cleaned !== contents) fs.writeFileSync(location, cleaned);
      }
    }
  }
  function stage(name) {
    if (visited.has(name)) return;
    visited.add(name);
    if (fs.existsSync(modulePath(outputRoot, name))) return;
    const source = modulePath(__dirname, name);
    if (!fs.existsSync(source)) throw new Error("Bundled " + name + " is missing. Reinstall the VS Code extension.");
    const target = modulePath(outputRoot, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    if (name === "@abaplint/runtime") stripMissingMaps(target);
    const metadata = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    for (const dependency of Object.keys(metadata.dependencies || {})) stage(dependency);
  }
  stage("@abaplint/runtime");
  // The transpiler emits SY-VLINE as sy.get().vline, but the bundled runtime
  // omits this standard list separator. Patch only the staged run copy.
  const syFile = path.join(modulePath(outputRoot, "@abaplint/runtime"), "build", "src", "builtin", "sy.js");
  const sySource = fs.readFileSync(syFile, "utf8");
  if (!/\bvline:\s*new types_1\.Character\(/.test(sySource)) {
    const anchor = "exports.sy = new types_1.Structure({";
    if (!sySource.includes(anchor)) throw new Error("The staged ABAP runtime has an unexpected SY definition.");
    fs.writeFileSync(syFile, sySource.replace(anchor,
      anchor + "\n    vline: new types_1.Character(1).set(\"|\"),"));
  }
}

function initializeSelectorDatabase(project) {
  const init = path.join(path.dirname(project.entry), "_init.mjs");
  if (!fs.existsSync(init)) return;
  const source = fs.readFileSync(init, "utf8");
  if (source.includes("VERTEX SAP SelecTor")) return;
  const anchor = "  const insert = [];";
  if (!source.includes(anchor)) return;
  const setup = "  // VERTEX SAP SelecTor\n" +
    "  const selectorPending = new Map(); let selectorNext = 0;\n" +
    "  if (process.env.VERTEX_SELECTOR_PIPE) {\n" +
    "    const readline = await import('node:readline');\n" +
    "    readline.createInterface({ input: process.stdin }).on('line', line => {\n" +
    "      try { const reply = JSON.parse(line); const pending = selectorPending.get(reply.id);\n" +
    "        if (pending) { selectorPending.delete(reply.id); reply.error ? pending.reject(new Error(reply.error)) : pending.resolve(reply.result); }\n" +
    "      } catch (_) {}\n" +
    "    });\n" +
    "  }\n" +
    // Each SELECT goes into the run's record too, with the rows it brought or why it failed.
    "  const selectorRows = async input => {\n" +
    "    if (process.env.VERTEX_SELECTOR_PIPE) return await new Promise((resolve, reject) => {\n" +
    "      const id = ++selectorNext; selectorPending.set(id, { resolve, reject });\n" +
    "      process.stdout.write('VERTEX_SELECTOR_REQUEST:' + JSON.stringify({ id, input }) + '\\n');\n" +
    "    });\n" +
    "    const port = process.env.VERTEX_SELECTOR_PORT;\n" +
    "    if (!port) throw new Error('SAP SelecTor is required for Open SQL SELECT.');\n" +
    "    const response = await fetch('http://127.0.0.1:' + port + '/select', { method: 'POST',\n" +
    "      headers: { authorization: 'Bearer ' + process.env.VERTEX_SELECTOR_TOKEN, 'content-type': 'application/json' },\n" +
    "      body: JSON.stringify(input) });\n" +
    "    const data = await response.json();\n" +
    "    if (!response.ok) throw new Error(data.error || 'SAP SelecTor SELECT failed.');\n" +
    "    return data;\n" +
    "  };\n" +
    "  abap.context.databaseConnections.DEFAULT = { async select(input) {\n" +
    "    try { const data = await selectorRows(input);\n" +
    "      globalThis.__vertexTrace?.sql?.push({ select: input.select, rows: (data.rows || []).length }); return data; }\n" +
    "    catch (error) { globalThis.__vertexTrace?.sql?.push({ select: input.select, error: error.message }); throw error; }\n" +
    "  } };\n";
  fs.writeFileSync(init, source.replace(anchor, setup + anchor));
}

function transpile(project, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [project.cli, project.configFile], { cwd: project.root, windowsHide: true });
    child.stdout.on("data", chunk => output.append(chunk.toString()));
    child.stderr.on("data", chunk => output.append(chunk.toString()));
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error("ABAP transpilation failed (exit " + code + "). See VERTEX Local ABAP output.")));
  });
}

function repairInlineProgramDeclarations(source, lines) {
  const declarations = [];
  for (const match of source.matchAll(/\bDATA\s*\(\s*([A-Za-z_]\w*)\s*\)\s*=\s*([\s\S]*?)\./gi)) {
    const name = match[1].toLowerCase();
    if (lines.some(line => new RegExp("\\blet\\s+" + name + "\\s*=", "i").test(line))) continue;
    const rhs = match[2];
    const conditional = /^\s*COND\s+CHAR(\d+)\s*\(/i.exec(rhs);
    const method = /^\s*NEW\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*->\s*([A-Za-z_]\w*)/i.exec(rhs);
    if (conditional) {
      declarations.push("let " + name + " = new abap.types.Character(" + Number(conditional[1]) + ");");
    } else if (method) {
      declarations.push("let " + name + " = abap.Classes[" + JSON.stringify(method[1].toUpperCase()) +
        "].METHODS[" + JSON.stringify(method[2].toUpperCase()) +
        "].parameters && Object.values(abap.Classes[" + JSON.stringify(method[1].toUpperCase()) +
        "].METHODS[" + JSON.stringify(method[2].toUpperCase()) +
        "].parameters).find(p => p.parm_kind === 'R').type();");
    } else {
      throw new Error("The transpiler omitted inline declaration " + match[1] + "; its type could not be inferred safely.");
    }
  }
  if (declarations.length) lines[0] += " " + declarations.join(" ");
}

/* The transpiler leaves two things of a selection screen as a throw in the program it writes: every SELECTION-SCREEN
   statement ("transpiler todo"), and a PARAMETERS with LENGTH or DECIMALS ("not supported", since it would cut a value
   silently). SELECTION-SCREEN only lays the screen out, which the panel draws: its throw goes. Such a parameter is
   declared with its length and decimals and given its DEFAULT. The line each stands on is kept, so the map still holds;
   a parameter of another type, or with a DEFAULT that is no literal, stays a throw that says so. */
function repairSelectionScreen(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const SCREEN = 'throw new Error("SelectionScreen, transpiler todo");', SIZED = 'throw new Error("Parameter, not supported, transpiler");';
  if (!lines.some(line => line.includes(SCREEN) || line.includes(SIZED))) return;
  let map = null;
  try { map = JSON.parse(fs.readFileSync(file + ".map", "utf8")); } catch (_) { /* none: a sized parameter is then not placed */ }
  const places = map ? require("./local-trace").mappedPlaces(map) : [], models = new Map(), used = new Map();
  const modelOf = source => {
    if (!models.has(source)) models.set(source, require("./selection-screen").selectionScreen(fs.readFileSync(source, "utf8")).elements);
    return models.get(source);
  };
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes(SCREEN)) lines[index] = lines[index].replace(SCREEN, "");
    if (!lines[index].includes(SIZED)) continue;
    const place = places[index], source = place && map.sources?.[place[0]] && path.resolve(path.dirname(file), map.sources[place[0]]);
    if (!source || !fs.existsSync(source)) continue;
    // The pieces of a chain all start on the chain's line: each throw there is the next sized piece.
    const key = source + ":" + place[1], taken = used.get(key) || 0;
    const sized = modelOf(source).filter(e => e.kind === "parameter" && e.start === place[1] && (e.length !== undefined || e.decimals !== undefined));
    const element = sized[taken];
    used.set(key, taken + 1);
    if (!element) continue;
    const name = element.name.toLowerCase(), length = element.length || 1, decimals = element.decimals || 0;
    const declared = { C: `new abap.types.Character(${length}, {})`, N: `new abap.types.Numc({length: ${length}})`,
      P: `new abap.types.Packed({length: ${length}, decimals: ${decimals}})`, X: `new abap.types.Hex({length: ${length}})` }[element.type];
    let replacement;
    if (!declared) replacement = `throw new Error(${JSON.stringify("Parameter " + element.name + " TYPE " + element.type + " with LENGTH or DECIMALS is not run by the transpiler.")});`;
    else if (element.default && element.defaultName) replacement = `throw new Error(${JSON.stringify("Parameter " + element.name + ": its DEFAULT " + element.default + " is no literal, and the transpiler cannot give it.")});`;
    else replacement = `let ${name} = ${declared};` + (element.default ? ` ${name}.set(${JSON.stringify(element.upper ? element.default.toUpperCase() : element.default)});` : "");
    lines[index] = lines[index].replace(SIZED, replacement);
  }
  fs.writeFileSync(file, lines.join("\n"));
}

/* The SELECT-OPTIONS the screen was given, as rows of their range tables in place of the DEFAULT's: after the lines
   where the program declares and fills each, on the last of them. */
function setRanges(file, document, given) {
  const ranges = rangesFor(document).filter(range => Object.prototype.hasOwnProperty.call(given, range.name));
  if (!ranges.length) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const range of ranges) {
    const name = range.name.toLowerCase();
    let at = lines.findIndex(line => line.includes("let " + name + " = abap.types.TableFactory.construct("));
    if (at < 0) throw new Error("Generated SELECT-OPTIONS " + range.name + " was not found.");
    while (at < lines.length && !/withHeader/.test(lines[at])) at++;
    while (lines[at + 1] && (lines[at + 1].trimStart().startsWith(name + ".") || lines[at + 1].trim() === "abap.statements.append({source: " + name + "});")) at++;
    const rows = (given[range.name] || []).map(row => {
      const value = text => { let v = String(text ?? "");
        if (range.numeric) { if (!/^-?\d+(?:\.\d+)?$/.test(v.trim() || "0")) throw new Error("SELECT-OPTIONS " + range.name + " needs numbers, not " + JSON.stringify(v) + "."); return String(Number(v.trim() || "0")); }
        return JSON.stringify(range.upper ? v.toUpperCase() : v); };
      const option = String(row.option || (row.high ? "BT" : "EQ")).toUpperCase(), sign = String(row.sign || "I").toUpperCase();
      if (!["EQ", "NE", "GT", "GE", "LT", "LE", "BT", "NB", "CP", "NP"].includes(option) || !["I", "E"].includes(sign))
        throw new Error("SELECT-OPTIONS " + range.name + ": " + sign + " " + option + " is no range row.");
      return `${name}.get().sign.set(${JSON.stringify(sign)});${name}.get().option.set(${JSON.stringify(option)});` +
        `${name}.get().low.set(${value(row.low)});${name}.get().high.set(${value(row.high)});abap.statements.append({source: ${name}});`;
    });
    lines[at] += ` ${name}.clear();` + rows.join("");
  }
  fs.writeFileSync(file, lines.join("\n"));
}

function entryFor(project, document, selection = {}) {
  const filename = path.basename(document.uri.fsPath);
  const source = document.getText();
  const isProgram = /\.prog\.abap$/i.test(filename) || /^\s*(?:REPORT|PROGRAM)\s+/im.test(source);
  if (!isProgram) {
    if (!fs.existsSync(project.entry)) {
      throw new Error("No ABAP Unit entry point was generated. Set write_unit_tests to true and add a test class.");
    }
    return project.entry;
  }
  const outputRoot = path.dirname(project.entry);
  const generatedName = filename.replace(/\.abap$/i, ".mjs");
  const candidates = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const itemPath = path.join(dir, item.name);
      if (item.isDirectory()) visit(itemPath);
      else if (item.name.toLowerCase() === generatedName.toLowerCase()) candidates.push(itemPath);
    }
  }
  visit(outputRoot);
  if (!candidates.length && !/\.prog\.abap$/i.test(filename)) {
    // abaplint takes the object type from the abapGit file name: a plain .abap file is no program to it.
    throw new Error("The transpiler made no program of " + filename + ": it takes the object type from the file name. Name it "
      + filename.replace(/\.abap$/i, ".prog.abap") + ".");
  }
  if (candidates.length !== 1) {
    throw new Error("Expected one generated program for " + filename + "; found " + candidates.length + ".");
  }
  repairSelectionScreen(candidates[0]);
  setRanges(candidates[0], document, selection.$ranges || {});
  const groups = scenariosFor(document);
  // Plain PARAMETERS and checkboxes: the value the selection screen was given, set after the program's own DEFAULT and
  // upper-cased as SAP would.
  const given = selection.$parameters || {};
  const parameters = parametersFor(document).filter(parameter => Object.prototype.hasOwnProperty.call(given, parameter.name));
  if (parameters.length) {
    const lines = fs.readFileSync(candidates[0], "utf8").split(/\r?\n/);
    for (const parameter of parameters) {
      const name = parameter.name.toLowerCase();
      let at = lines.findIndex(line => line.trimStart().startsWith("let " + name + " = "));
      if (at < 0) throw new Error("Generated parameter " + parameter.name + " was not found.");
      while (lines[at + 1]?.trimStart().startsWith(name + ".set(")) at++;
      let value = String(given[parameter.name] ?? "");
      if (parameter.kind === "checkbox") value = value ? "X" : "";
      else if (parameter.upper) value = value.toUpperCase();
      if (parameter.numeric && !/^-?\d+(?:\.\d+)?$/.test(value.trim() || "0")) throw new Error("Parameter " + parameter.name + " needs a number, not " + JSON.stringify(value) + ".");
      lines[at] += name + ".set(" + (parameter.numeric ? String(Number(value.trim() || "0")) : JSON.stringify(value)) + ");";
    }
    fs.writeFileSync(candidates[0], lines.join("\n"));
  }
  if (groups.some(group => selection[group.group])) {
    const lines = fs.readFileSync(candidates[0], "utf8").split(/\r?\n/);
    repairInlineProgramDeclarations(source, lines);
    let anchor = -1, lastName = "";
    for (const group of groups) for (const choice of group.choices) {
      const name = choice.name.toLowerCase();
      const index = lines.findIndex(line => line.trimStart().startsWith("let " + name + " = "));
      if (index < 0) throw new Error("Generated parameter " + choice.name + " was not found.");
      if (index > anchor) { anchor = index; lastName = name; }
    }
    while (lines[anchor + 1]?.trimStart().startsWith(lastName + ".set(")) anchor++;
    const assignments = [];
    for (const group of groups) {
      const selected = selection[group.group] || group.default || group.choices[0]?.name;
      if (!group.choices.some(choice => choice.name === selected)) throw new Error("Unknown choice for radio group " + group.group + ".");
      for (const choice of group.choices) {
        assignments.push(choice.name.toLowerCase() + ".set(abap.CharacterFactory.get(1," + JSON.stringify(choice.name === selected ? "X" : "") + "));" );
      }
    }
    lines[anchor] += assignments.join("");
    fs.writeFileSync(candidates[0], lines.join("\n"));
  }
  if (!groups.some(group => selection[group.group])) {
    const lines = fs.readFileSync(candidates[0], "utf8").split(/\r?\n/);
    repairInlineProgramDeclarations(source, lines);
    fs.writeFileSync(candidates[0], lines.join("\n"));
  }
  const wrapper = path.join(outputRoot, "vertex-local-entry.mjs");
  const relative = "./" + path.relative(outputRoot, candidates[0]).replaceAll("\\", "/");
  fs.writeFileSync(wrapper, "await import(" + JSON.stringify(relative) + ");\n" +
    "if (globalThis.abap?.console?.get) { const text = abap.console.get(); process.stdout.write(text + '\\n');" +
    " if (process.env.VERTEX_LOCAL_OUTPUT_FILE) (await import('node:fs')).writeFileSync(process.env.VERTEX_LOCAL_OUTPUT_FILE, text); }\n");
  return wrapper;
}

function debugConfiguration(project, entry, outputFile = "", bridgeEnv = {}) {
  return { type: "node", request: "launch", name: "VERTEX Local ABAP", program: entry,
    cwd: project.root, sourceMaps: true, smartStep: true, internalConsoleOptions: "neverOpen",
    outFiles: [path.dirname(project.entry) + "/**/*.mjs"],
    skipFiles: ["<node_internals>/**", "**/node_modules/**", "**/_init.mjs", "**/vertex-local-entry.mjs"],
    env: { ...bridgeEnv, ...(outputFile ? { VERTEX_LOCAL_OUTPUT_FILE: outputFile } : {}) } };
}

function repairSelectLoops(outputRoot) {
  let repaired = 0;
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) { if (item.name !== "node_modules") visit(file); continue; }
      if (!item.name.endsWith(".mjs")) continue;
      const original = fs.readFileSync(file, "utf8");
      const fixed = original.replace(
        /(await abap\.statements\.select\((\w+), \{select: "SELECT ([\s\S]*?) FROM "[\s\S]*?\}\);\s*for \(const (\w+) of \2\.array\(\)\) \{\s*)(\w+)\.set\(\4\);/g,
        (all, prefix, table, columns, row, target) => {
          const declaration = new RegExp("\\blet " + target + " = new abap\\.types\\.(\\w+)\\b").exec(original);
          if (!declaration) return all;
          if (declaration[1] === "Structure") {
            repaired++;
            return prefix + "abap.statements.moveCorresponding(" + row + ", " + target + ");";
          }
          const column = /^\\?"(\w+)\\?"$/.exec(columns);
          if (!column) return all;
          repaired++;
          return prefix + target + ".set(" + row + ".get()." + column[1].toLowerCase() + ");";
        });
      if (fixed !== original) fs.writeFileSync(file, fixed);
    }
  }
  visit(outputRoot);
  return repaired;
}

async function launch(vscode, debug, options = {}) {
  const document = options.document || vscode.window.activeTextEditor?.document;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document?.uri)?.uri.fsPath;
  if (document.isDirty) await document.save();
  // A method or a function module: the program that calls it with the values of the screen is what runs.
  let driver = null, driverDocument = null;
  const called = options.selection && options.selection.$entry;
  if (called) {
    const screen = entryScreen(document, options.entryLine);
    if (!screen) throw new Error("The cursor is no longer in a method or a function module of " + path.basename(document.uri.fsPath) + ".");
    const source = require("./local-entry").driverSource(screen, called);
    const folder = path.join(os.tmpdir(), "vertex-local-entry", String(process.pid));
    fs.mkdirSync(folder, { recursive: true });
    driver = path.join(folder, require("./local-entry").DRIVER + ".prog.abap");
    fs.writeFileSync(driver, source);
    driverDocument = { uri: { fsPath: driver, scheme: "file" }, getText: () => source, isDirty: false };
  }
  const project = projectFor(document, workspaceRoot, driver);
  const output = vscode.window.createOutputChannel("VERTEX Local ABAP");
  // A run unchanged since its last transpiling - an SAP object's same build (sap-cache.js), or a local file whose folder
  // has not changed (projectFor's stamp) - and no call program of its own takes that transpiled code again, from its
  // untouched copy: the record's instrumentation and the
  // screen's values change the code in place.
  const root = path.dirname(project.configFile), outputRoot = path.dirname(project.entry);
  const stampFile = path.join(root, "vertex-fingerprint.json"), builtFile = path.join(root, "vertex-built.json"), pristine = path.join(root, "output-pristine");
  const readJson = file => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; } };
  const stamp = !driver && (project.stamp || readJson(stampFile)?.fingerprint);
  const reuse = !!stamp && fs.existsSync(pristine) && readJson(builtFile)?.fingerprint === stamp;
  output.appendLine((reuse ? "Unchanged since the last run, transpiled code taken again: " : "Transpiling ") + project.root);
  if (reuse) {
    // Only the modules of the user's code are changed in place: those are put back, the rest of the output stays.
    for (const relative of readJson(path.join(pristine, "files.json")) || []) fs.copyFileSync(path.join(pristine, relative), path.join(outputRoot, relative));
    stageRuntime(project);
  } else try {
    await prepareFlow(project, document, output);
    if (project.automatic) output.appendLine("Included classes/interfaces: " +
      (project.includedClasses.length ? project.includedClasses.join(", ") : "none"));
    await transpile(project, output);
    // An SAP program's run: its includes were written into it, and its map is pointed back at them.
    if (fs.existsSync(path.join(path.dirname(project.configFile), "vertex-includes.json")))
      require("./sap-transpile").remapIncludes(path.dirname(project.configFile), path.dirname(project.entry));
    // An SAP run's function modules get the DEFAULTs the transpiler leaves unset.
    const defaults = path.join(path.dirname(project.configFile), "vertex-defaults.json");
    if (fs.existsSync(defaults)) require("./sap-fugr").applyModuleDefaults(path.dirname(project.entry), JSON.parse(fs.readFileSync(defaults, "utf8")));
    output.appendLine("Transpilation complete; staging runtime.");
    stageRuntime(project);
    output.appendLine("Runtime staged; preparing local execution.");
    initializeSelectorDatabase(project);
    if (stamp) {
      // The untouched copy of what a run changes in place: each module whose map names ABAP of the user's (open-abap-core's
      // is never instrumented), with _init.mjs.
      fs.rmSync(pristine, { recursive: true, force: true });
      const kept = [];
      const visit = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const at = path.join(dir, item.name);
        if (item.isDirectory()) { if (item.name !== "node_modules") visit(at); continue; }
        if (!item.name.endsWith(".mjs")) continue;
        let own = item.name === "_init.mjs";
        if (!own && fs.existsSync(at + ".map")) {
          const sources = (readJson(at + ".map") || {}).sources || [];
          own = sources.some(source => /\.abap$/i.test(source) && !String(source).toLowerCase().split(/[\\/]/).includes("open-abap-core"));
        }
        if (own) kept.push(path.relative(outputRoot, at));
      } };
      visit(outputRoot);
      for (const relative of kept) { fs.mkdirSync(path.dirname(path.join(pristine, relative)), { recursive: true }); fs.copyFileSync(path.join(outputRoot, relative), path.join(pristine, relative)); }
      fs.writeFileSync(path.join(pristine, "files.json"), JSON.stringify(kept));
      fs.writeFileSync(builtFile, JSON.stringify({ fingerprint: stamp }));
    }
    output.hide?.();
  } catch (error) {
    require("./sap-cache").requireRecompile(project.root);
    output.show(true);
    throw error;
  }
  const selection = { ...(options.selection || {}) };
  if (driverDocument) delete selection.$entry;
  if (!options.selection) for (const group of scenariosFor(document)) {
    const choices = group.choices.map(choice => ({ label: choice.name, description: choice.name === group.default ? "default" : "" }));
    const picked = await vscode.window.showQuickPick(choices, { title: "Local ABAP · radio group " + group.group, placeHolder: "Choose the value for this run" });
    if (!picked) return;
    selection[group.group] = picked.label;
  }
  if (!options.selection) {
    const parameters = parametersFor(document);
    if (parameters.length) selection.$parameters = {};
    for (const parameter of parameters) {
      const value = parameter.kind === "checkbox"
        ? (await vscode.window.showQuickPick([{ label: "X" }, { label: "(blank)" }], { title: "Local ABAP · " + parameter.name, placeHolder: "Checkbox" }))?.label
        : await vscode.window.showInputBox({ title: "Local ABAP · " + parameter.name, value: parameter.default, prompt: "Selection screen parameter" });
      if (value === undefined) return;
      selection.$parameters[parameter.name] = value === "(blank)" ? "" : value;
    }
  }
  const entry = entryFor(project, driverDocument || document, selection);
  const repairedSelects = repairSelectLoops(path.dirname(project.entry));
  if (repairedSelects) output.appendLine("Repaired " + repairedSelects + " SELECT work-area assignments.");
  output.appendLine("Entry ready.");
  const bridge = !options.trace && !options.live && project.automatic && selectorQuery ? await startSelectorBridge() : null;
  if (options.trace || options.live) {
    const outputRoot = path.dirname(project.entry);
    const traceFile = path.join(outputRoot, "vertex-local-trace.json");
    // The program written to call a method or function module is not recorded: the run shows the code it calls.
    const instrumented = require("./local-trace").instrumentProject(outputRoot, !!options.live,
      driver ? [path.basename(driver)] : [], options.interventions || []);
    if (!instrumented) throw new Error("No generated ABAP source maps were found for tracing.");
    output.appendLine("Instrumented " + instrumented + " ABAP modules.");
    const traceEntry = require("./local-trace").traceBootstrap(outputRoot, entry, traceFile, !!options.live);
    output.appendLine("Trace ready; executing.");
    if (options.live) {
      const child = spawn(process.execPath, [traceEntry], { cwd: project.root, windowsHide: true,
        env: { ...process.env, VERTEX_SELECTOR_PIPE: "1" } });
      const records = []; let pending = null, initial, firstResolve, firstReject, closed = false;
      let stdout = "", stderr = "", buffer = "";
      const first = new Promise((resolve, reject) => { firstResolve = resolve; firstReject = reject; });
      const fail = error => {
        if (initial === undefined) firstReject(error);
        if (pending) { pending.reject(error); pending = null; }
        output.appendLine(error.message); output.show(true);
      };
      const resume = () => { if (!closed) child.stdin.write('{"vertexTrace":"resume"}\n'); };
      child.stdout.on("data", chunk => {
        buffer += chunk.toString(); let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).replace(/\r$/, ""); buffer = buffer.slice(end + 1);
          // WRITE leaves its text without a newline, so a record can follow program output on the same line.
          // The last statement's SELECTs, after the program: they belong to the last record.
          const tailAt = line.indexOf("VERTEX_TRACE_TAIL:");
          if (tailAt >= 0) {
            stdout += line.slice(0, tailAt);
            const last = records[records.length - 1];
            if (last) last.sql = (last.sql || []).concat(JSON.parse(line.slice(tailAt + "VERTEX_TRACE_TAIL:".length)));
            continue;
          }
          const recordAt = line.indexOf("VERTEX_TRACE_RECORD:");
          if (recordAt >= 0) {
            stdout += line.slice(0, recordAt);
            const record = JSON.parse(line.slice(recordAt + "VERTEX_TRACE_RECORD:".length)); records.push(record);
            if (initial === undefined) { initial = record; firstResolve(record); }
            else if (pending) {
              pending.records.push(record);
              const depth = record.stack?.length || 1;
              const hit = pending.breakpoints.some(bp => bp.active && bp.line === record.line &&
                bp.url.toLowerCase() === record.file.toLowerCase());
              const watched = require("./local-watchpoint").hits(record, records.slice(0, -1), pending.watchpoints).length > 0;
              const stop = pending.kind === "into" || pending.kind === "continue" && (hit || watched) ||
                pending.kind === "over" && depth <= pending.depth || pending.kind === "out" && depth < pending.depth;
              if (stop) { const done = pending; pending = null; done.resolve({ records: done.records, ended: false }); }
              else resume();
            }
            continue;
          }
          const marker = line.indexOf("VERTEX_SELECTOR_REQUEST:");
          if (marker >= 0) {
            stdout += line.slice(0, marker);
            const requestText = line.slice(marker + "VERTEX_SELECTOR_REQUEST:".length);
            Promise.resolve().then(async () => {
              const request = JSON.parse(requestText);
              if (!selectorQuery) throw new Error("Configure and select an SAP system for Open SQL SELECT.");
              const input = request.input, limit = /\bUP TO\s+(\d+)\s+ROWS\b/i.exec(input.select || "");
              const data = await selectorQuery(selectorSql(input), limit ? Number(limit[1]) : 10000);
              return { id: request.id, result: { rows: (data.values || []).map(row =>
                Object.fromEntries(Object.entries(row).map(([name, value]) => [name.toLowerCase(), value]))) } };
            }).then(reply => child.stdin.write(JSON.stringify(reply) + "\n"), error => {
              // The program gets the failure as an empty result, so the reason is said where the reader looks: the
              // output of the run and the VERTEX Local ABAP channel.
              const said = "[VERTEX] SELECT failed: " + error.message;
              stdout += "\n" + said + "\n"; output.appendLine(said); output.show(true);
              child.stdin.write(JSON.stringify({ id: JSON.parse(requestText).id, error: error.message }) + "\n");
            });
          } else stdout += line + "\n";
        }
      });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", fail);
      child.on("close", code => {
        closed = true; bridge?.close();
        // The last WRITE ends without a line break: what is left in the buffer is output too.
        if (buffer) { const at = buffer.indexOf("VERTEX_TRACE_RECORD:"); stdout += at >= 0 ? buffer.slice(0, at) : buffer; buffer = ""; }
        // A failure is said at the ABAP line it happened on; Node's own text stays in the output channel.
        if (code !== 0) { const said = require("./local-trace").abapFailure(stderr); if (said) output.appendLine(stderr);
          fail(new Error(said || stderr || "Local ABAP exited with code " + code)); return; }
        if (initial === undefined) firstReject(new Error("Local ABAP completed without a recorded statement."));
        if (pending) { const done = pending; pending = null; done.resolve({ records: done.records, ended: true }); }
      });
      await first;
      return { records: [initial], live: {
        next(kind, breakpoints = [], watchpoints = []) {
          if (closed) return Promise.resolve({ records: [], ended: true });
          if (pending) return Promise.reject(new Error("A local step is already running."));
          return new Promise((resolve, reject) => {
            pending = { resolve, reject, records: [], kind, breakpoints, watchpoints,
              depth: records.at(-1)?.stack?.length || 1 };
            resume();
          });
        }, stop() { if (!closed) child.kill(); }, get output() { return stdout; }
      } };
    }
    try {
      const startedAt = Date.now();
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [traceEntry], { cwd: project.root, windowsHide: true,
          env: { ...process.env, VERTEX_SELECTOR_PIPE: "1" } });
        let stdout = "", stderr = "", pending = "";
        child.stdout.on("data", chunk => {
          pending += chunk.toString();
          let end;
          while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end).replace(/\r$/, ""); pending = pending.slice(end + 1);
            const marker = line.indexOf("VERTEX_SELECTOR_REQUEST:");
            if (marker < 0) { stdout += line + "\n"; continue; }
            stdout += line.slice(0, marker);
            const requestText = line.slice(marker + "VERTEX_SELECTOR_REQUEST:".length);
            Promise.resolve().then(async () => {
              const request = JSON.parse(requestText);
              if (!selectorQuery) throw new Error("Configure and select an SAP system for Open SQL SELECT.");
              const input = request.input, limit = /\bUP TO\s+(\d+)\s+ROWS\b/i.exec(input.select || "");
              const data = await selectorQuery(selectorSql(input), limit ? Number(limit[1]) : 10000);
              return { id: request.id, result: { rows: (data.values || []).map(row =>
                Object.fromEntries(Object.entries(row).map(([name, value]) => [name.toLowerCase(), value]))) } };
            }).then(reply => child.stdin.write(JSON.stringify(reply) + "\n"), error => {
              const request = JSON.parse(requestText);
              child.stdin.write(JSON.stringify({ id: request.id, error: error.message }) + "\n");
            });
          }
        });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", code => {
          if (code === 0) { resolve({ stdout: stdout + pending, stderr }); return; }
          const said = require("./local-trace").abapFailure(stderr);
          if (said) output.appendLine(stderr);
          reject(new Error(said || stderr || "Local ABAP exited with code " + code));
        });
      });
      return { records: JSON.parse(fs.readFileSync(traceFile, "utf8")), output: result.stdout,
        durationMs: Date.now() - startedAt };
    } finally { bridge?.close(); }
  }
  if (debug) {
    const outputFile = options.onOutput ? path.join(path.dirname(project.entry), "vertex-local-result.txt") : "";
    if (outputFile) fs.rmSync(outputFile, { force: true });
    if (outputFile) {
      const subscription = vscode.debug.onDidTerminateDebugSession(session => {
        if (session.name !== "VERTEX Local ABAP") return;
        if (fs.existsSync(outputFile)) options.onOutput(fs.readFileSync(outputFile, "utf8") + "\n");
        bridge?.close();
        subscription.dispose();
      });
    }
    const started = await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(document.uri),
      debugConfiguration(project, entry, outputFile, bridge?.env));
    if (!started) { bridge?.close(); throw new Error("The VS Code Node debugger could not start."); }
    if (!outputFile && bridge) vscode.debug.onDidTerminateDebugSession(session => {
      if (session.name === "VERTEX Local ABAP") bridge.close();
    });
    await vscode.commands?.executeCommand("workbench.view.explorer");
  } else {
    if (options.onOutput || bridge) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [entry], { cwd: project.root, windowsHide: true,
          env: { ...process.env, ...bridge?.env } });
        child.stdout.on("data", chunk => options.onOutput ? options.onOutput(chunk.toString()) : output.append(chunk.toString()));
        child.stderr.on("data", chunk => options.onOutput ? options.onOutput(chunk.toString()) : output.append(chunk.toString()));
        child.on("error", reject);
        child.on("close", code => { bridge?.close(); code === 0 ? resolve() : reject(new Error("Local ABAP exited with code " + code + ".")); });
      });
      if (!options.onOutput) output.show(true);
      return;
    }
    const terminal = vscode.window.createTerminal({ name: "VERTEX Local ABAP", cwd: project.root });
    terminal.show();
    bridge?.close();
    terminal.sendText('node "' + entry.replaceAll('"', '""') + '"');
  }
}

function register(vscode, context) {
  for (const [command, debug] of [["vertex.localRun", false], ["vertex.localDebug", true]]) {
    context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
      try { if (debug) await vscode.commands.executeCommand("vertex.openVisualDebug");
        else await launch(vscode, false); }
      catch (error) { vscode.window.showErrorMessage("VERTEX Local ABAP: " + error.message); }
    }));
  }
}

module.exports = { screenFor, rangesFor, repairSelectionScreen, localDdicAliases, coreDdicNames, projectFor, runScope, scenariosFor, parametersFor, entryScreen, transpile, stageRuntime, initializeSelectorDatabase, startSelectorBridge,
  selectorSql, setSelectorQuery, entryFor, debugConfiguration,
  flowClasses, prepareFlow, repairSelectLoops, launch, register };
