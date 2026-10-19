"use strict";
/* A program of an SAP system run with the ABAP transpiler: its active source and every customer class, interface and
   include it names, read through ADT, written as an abapGit folder with its own abap_transpile.json. Whatever cannot
   be read stops the run: a missing dependency is never left out of it. Function modules are not read
   yet, and a program that calls one is refused by name; a name after REF TO that is no class or interface is left to
   the dictionary (sap-ddic.js). The transpiler writes a program's INCLUDE as a comment and runs
   on without it, so the program is given to it with its includes written in, and the map of what it made is pointed
   back at the program and the includes as SAP holds them: a step into an include stands in the include. */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { tokenize } = require("./value-origin-tokens");
const { customerObject } = require("./value-origin-model");

const up = value => String(value || "").toUpperCase();
// SAP accepts >< as an old spelling of <>; the bundled transpiler emits invalid JavaScript for it.
function normalizeLegacyNotEqual(source) {
  const tokens = tokenize(source), places = [];
  for (let i = 0; i + 1 < tokens.length; i++) if (tokens[i].kind === "symbol" && tokens[i].value === ">"
    && tokens[i + 1].kind === "symbol" && tokens[i + 1].value === "<"
    && tokens[i].endOffset === tokens[i + 1].offset) places.push(tokens[i].offset);
  if (!places.length) return source;
  let fixed = source;
  for (const at of places.reverse()) fixed = fixed.slice(0, at) + "<>" + fixed.slice(at + 2);
  return fixed;
}
// The class includes a run needs; test classes are not run.
const CLASS_PARTS = { definitions: "locals_def", implementations: "locals_imp", macros: "macros" };

/* The objects a source names, with the kind the name stands for there. A name after TYPE alone may be a class or a
   DDIC type, and is left to the transpiler, which reports what it cannot resolve. */
function namedObjects(text, customer = customerObject) {
  const tokens = tokenize(text), found = new Map(), functions = new Set();
  const word = i => tokens[i] && tokens[i].kind === "word" ? up(tokens[i].value) : "";
  const at = i => up(tokens[i] && tokens[i].value);
  for (let i = 0; i < tokens.length; i++) {
    const current = at(i);
    if (current === "NEW" && word(i + 1)) found.set(word(i + 1), "CLAS");
    if (tokens[i].kind === "word" && at(i + 1) === "=>") found.set(current, "CLAS");
    if (current === "INTERFACES" && word(i + 1)) found.set(word(i + 1), "INTF");
    // REF TO names a class, an interface or a dictionary type: "REF" is tried as a class, then left to the dictionary.
    if (current === "REF" && at(i + 1) === "TO" && word(i + 2) && !found.has(word(i + 2))) found.set(word(i + 2), "REF");
    if (current === "INHERITING" && at(i + 1) === "FROM" && word(i + 2)) found.set(word(i + 2), "CLAS");
    if (current === "CAST" && word(i + 1)) found.set(word(i + 1), "CLAS");
    if (current === "RAISING" || current === "CATCH") {
      for (let j = i + 1; word(j) && !["INTO", "RESUMABLE", "BEFORE"].includes(word(j)); j++) found.set(word(j), "CLAS");
    }
    if (current === "INCLUDE" && word(i + 1) && !["TYPE", "STRUCTURE"].includes(word(i + 1))) found.set(word(i + 1), "INCL");
    if (current === "CALL" && at(i + 1) === "FUNCTION" && tokens[i + 2] && tokens[i + 2].kind === "literal")
      functions.add(up(tokens[i + 2].value.slice(1, -1)));
  }
  for (const name of [...found.keys()]) if (!customer(name)) found.delete(name);
  return { objects: found, functions: [...functions].filter(customer) };
}

/* ---------- what the run reaches ----------
   A source as its statements, by its tokens: those of each routine (METHOD, FORM, FUNCTION, MODULE ... END...) and the
   rest. A routine is reached from where the run starts, through the calls of the routines reached: meth( ), me->meth( ),
   x=>meth( ), CALL METHOD, PERFORM - by name, so an instance call reaches every method of that name. What a reached
   statement names is read; what nothing reached names is left out of the run, and the transpiler (unknownTypes
   runtimeError) fails only if the run gets there after all - a dynamic call, say. */
const ROUTINE_START = { METHOD: "ENDMETHOD", FORM: "ENDFORM", FUNCTION: "ENDFUNCTION", MODULE: "ENDMODULE" };
function statementsOf(text) {
  const tokens = tokenize(text), list = [];
  let current = [];
  for (const token of tokens) {
    if (token.kind === "symbol" && token.value === ".") { if (current.length) list.push(current); current = []; }
    else current.push(token);
  }
  if (current.length) list.push(current);
  return list;
}
function partsOf(text) {
  const routines = new Map(), global = [];
  let open = null;
  for (const statement of statementsOf(text)) {
    const first = up(statement[0].value);
    if (!open && ROUTINE_START[first] && statement[1]) {
      const name = statement[2] && statement[2].value === "~" && statement[3]
        ? up(statement[1].value) + "~" + up(statement[3].value) : up(statement[1].value);
      open = { name, end: ROUTINE_START[first], statements: [statement], first: statement[0].line, last: statement[0].line };
      continue;
    }
    if (open) {
      open.statements.push(statement);
      open.last = statement[statement.length - 1].line;
      if (first === open.end) { (routines.get(open.name) || routines.set(open.name, []).get(open.name)).push(open); open = null; }
      continue;
    }
    global.push(statement);
  }
  return { routines, global };
}
const textOf = statement => statement.map(token => token.value).join(" ") + ".";
const STUB = 'ASSERT 1 = 2. " VERTEX: not transpiled - not reached from where the run started';
/* A class source with the bodies of the methods not in `reached` (names) left out: the METHOD and ENDMETHOD lines stay, the
   first line between them fails if the run gets there after all, the others are blank - every line keeps its number, so
   breakpoints and steps stand where SAP has them. */
function stubUnreached(text, reached, kinds = ["METHOD"]) {
  const lines = text.split("\n");
  for (const [name, list] of partsOf(text).routines) {
    if (reached.has(name)) continue;
    for (const routine of list) {
      if (!kinds.includes(up(routine.statements[0][0].value))) continue;
      const open = routine.statements[0], close = routine.statements[routine.statements.length - 1];
      const from = open[open.length - 1].line, to = close[0].line;
      if (to - from < 2) continue;                                      // no line of its own for the body
      for (let line = from + 1; line < to; line++) lines[line - 1] = line === from + 1 ? STUB : "";
    }
  }
  return lines.join("\n");
}
// The routines and methods a statement calls, by name.
function callsOf(statement) {
  const names = new Set(), at = i => up(statement[i] && statement[i].value), sym = i => statement[i] && statement[i].kind === "symbol" ? statement[i].value : "";
  for (let i = 0; i < statement.length; i++) {
    const token = statement[i];
    if (token.kind === "word" && sym(i + 1) === "(") names.add(up(token.value));
    if ((sym(i) === "->" || sym(i) === "=>") && statement[i + 1] && statement[i + 1].kind === "word") names.add(at(i + 1));
    if (at(i) === "PERFORM" && statement[i + 1]) names.add(at(i + 1));
    if (at(i) === "CALL" && at(i + 1) === "METHOD") { let j = i + 2; while (sym(j + 1) === "->" || sym(j + 1) === "=>") j += 2; if (statement[j]) names.add(at(j)); }
  }
  return names;
}

/* Every source of the run, read with read({ object_name, object_type, include }) - ADT's active version. A customer
   function module called - or the module run itself - brings its whole function group, read by groups.read(name) and
   found by groups.of(module) (sap-fugr.js); without them a call is refused. */
/* customer(name): whether the run reads that object; standard ones are left to the transpiler, as void. */
async function collect(read, root, { progress = () => {}, cancelled = () => false, groups = null, customer = customerObject, entryLine = 0 } = {}) {
  const loaded = [], seen = new Set(), queue = [];
  const groupsRead = new Set();
  // What is reached: the routines (object:name), the names called, the words used - and what waits for them.
  const reached = new Set(), called = new Set(["CONSTRUCTOR", "CLASS_CONSTRUCTOR"]), used = new Set(), waiting = [];
  const scan = (owner, statements, inGroup) => {
    for (const statement of statements) {
      take(owner, textOf(statement), inGroup);
      for (const name of callsOf(statement)) called.add(name);
      for (const token of statement) if (token.kind === "word") used.add(up(token.value));
    }
  };
  // A loaded source: a program's, an include's, an interface's and a group's own statements run or declare, and are
  // taken whole; a class's routines wait to be reached, its attributes to be used, INHERITING FROM and INTERFACES not.
  const offer = (owner, type, text, inGroup, start) => {
    const parts = partsOf(text);
    if (type !== "CLAS") scan(owner, parts.global, inGroup);
    else for (const statement of parts.global) {
      const words = statement.map(token => up(token.value));
      if (words.includes("INHERITING") || words.includes("INTERFACES") || words[0] === "CLASS" && words.includes("DEFINITION")) { scan(owner, [statement], inGroup); continue; }
      if (["DATA", "CLASS-DATA", "CONSTANTS", "STATICS"].includes(words[0])) {
        // A chained declaration: one item per variable, each taken when the variable is used.
        let item = [];
        const items = [];
        for (const token of statement.slice(1)) { if (token.kind === "symbol" && token.value === ",") { items.push(item); item = []; } else if (!(token.kind === "symbol" && token.value === ":")) item.push(token); }
        items.push(item);
        for (const one of items.filter(i => i.length)) waiting.push({ owner, variable: up(one[0].value), statements: [one], inGroup });
        continue;
      }
      // TYPES and the rest of a definition: taken when a name they declare is used.
      waiting.push({ owner, variable: up((statement[1] && statement[1].kind === "word" ? statement[1] : statement.find((t, k) => k > 0 && t.kind === "word") || statement[0]).value), statements: [statement], inGroup });
    }
    for (const [name, list] of parts.routines) for (const routine of list) {
      const entry = start && (!entryLine || entryLine >= routine.first && entryLine <= routine.last);
      waiting.push({ owner, routine: name, statements: routine.statements, inGroup, entry });
    }
  };
  // What is waiting and now reached: a routine called by name (or where the run starts), a declaration used.
  const settle = () => {
    for (let again = true; again;) {
      again = false;
      for (let k = 0; k < waiting.length; k++) {
        const w = waiting[k];
        const methodName = w.routine && w.routine.includes("~") ? w.routine.slice(w.routine.lastIndexOf("~") + 1) : w.routine;
        const go = w.routine ? w.entry || called.has(w.routine) || called.has(methodName) : used.has(w.variable);
        if (!go) continue;
        waiting.splice(k--, 1);
        if (w.routine) reached.add(w.owner + ":" + w.routine);
        scan(w.owner, w.statements, w.inGroup);
        again = true;
      }
    }
  };
  const take = (owner, text, inGroup = false) => {
    const named = namedObjects(text, customer);
    // A standard SAP module called by a reached function-group routine must
    // be read too, even when it belongs to another function group.
    for (const module of inGroup ? namedObjects(text, () => true).functions : named.functions) {
      // A module called is reached, in a group read already or one read for it.
      called.add(module);
      if (seen.has("FUNC:" + module)) continue;
      if (!groups) throw new Error(owner + " calls function module " + module + ": function modules are not read for this run.");
      seen.add("FUNC:" + module); queue.push({ name: module, type: "FUNC" });
    }
    // A group's own INCLUDEs are read with the group.
    for (const [name, type] of named.objects) if (!(inGroup && type === "INCL") && !seen.has(name)) { seen.add(name); queue.push({ name, type }); }
  };
  const scannedModules = new Set();
  const scanCalledModules = () => {
    for (let again = true; again;) {
      again = false;
      for (const source of loaded) {
        if (source.type !== "FUGR" || source.kind !== "module" || !called.has(source.include)
          || scannedModules.has(source.include)) continue;
        scannedModules.add(source.include);
        // Calls to SAP-standard modules in the same group are local to this
        // build too, even though `customerObject` would not queue them.
        const available = new Set(loaded.filter(item => item.type === "FUGR" && item.kind === "module"
          && item.name === source.name).map(item => item.include));
        for (const module of namedObjects(source.text, () => true).functions)
          if (available.has(module)) called.add(module);
        scan(source.name, statementsOf(source.text), true);
        settle();
        again = true;
      }
    }
  };
  if (up(root.type) === "FUNC") { seen.add("FUNC:" + up(root.name)); called.add(up(root.name)); queue.push({ name: up(root.name), type: "FUNC" }); }
  else { seen.add(up(root.name)); queue.push({ name: up(root.name), type: up(root.type) }); }
  while (queue.length) {
    if (cancelled()) throw new Error("Transpiler run cancelled.");
    const next = queue.shift();
    progress(next.name);
    if (next.type === "FUNC") {
      if (!groups) throw new Error("Function module " + next.name + ": function modules are not read for this run.");
      const group = await groups.of(next.name);
      if (groupsRead.has(group)) continue;
      groupsRead.add(group);
      const read = await groups.read(group);
      for (const source of read.sources) {
        loaded.push({ name: group, type: "FUGR", include: source.name, kind: source.kind, text: source.text, signature: source.signature });
        // A module called (or run) is reached; the group's other modules wait to be called.
        offer(source.name, "FUGR", source.text, true, false);
      }
      settle();
      scanCalledModules();
      continue;
    }
    let data;
    const asClass = next.type === "REF" ? "CLAS" : next.type;
    try { data = await read({ object_name: next.name, object_type: asClass }); }
    catch (error) {
      if (asClass !== "CLAS" || !/was not found/.test(error.message)) throw new Error(next.name + ": " + error.message);
      try { data = await read({ object_name: next.name, object_type: "INTF" }); }
      catch (second) {
        if (next.type === "REF" && /was not found/.test(second.message)) continue;
        throw new Error(next.name + " is neither a class nor an interface in SAP (" + second.message + ").");
      }
    }
    const type = up(data.object_type);
    const text = data.source;
    loaded.push({ name: next.name, type, include: "main", text });
    // The object the run starts in: its routine at the entry line - or, with no line, every one of them.
    const start = next.name === up(root.name) && up(root.type) !== "FUNC";
    offer(next.name, type, text, false, start);
    if (start && type === "CLAS" && !entryLine) waiting.forEach(w => { if (w.owner === next.name && w.routine) w.entry = true; });
    if (type === "CLAS") for (const include of Object.keys(CLASS_PARTS)) {
      if (!(data.includes || []).includes(include)) continue;
      let part;
      try { part = await read({ object_name: next.name, object_type: "CLAS", include }); }
      catch (error) { throw new Error(next.name + "." + include + ": " + error.message); }
      loaded.push({ name: next.name, type, include, text: part.source });
      // A class's local classes: their routines wait to be reached like its own methods.
      offer(next.name, "CLAS", part.source, false, false);
    }
    settle();
    scanCalledModules();
  }
  // What the run reaches is all that goes to the transpiler: a class keeps its definition and the bodies of its reached
  // methods only.
  for (const source of loaded) {
    if (source.type === "CLAS") {
      const names = new Set([...reached].filter(key => key.startsWith(source.name + ":")).map(key => key.slice(source.name.length + 1)));
      source.text = stubUnreached(source.text, names);
    } else if (source.type === "FUGR" && source.kind === "include") {
      const names = new Set([...reached].filter(key => key.startsWith(source.include + ":")).map(key => key.slice(source.include.length + 1)));
      source.text = stubUnreached(source.text, names, ["FORM"]);
    }
  }
  // A direct function-module run compiles the called modules only. An SAP
  // function group can contain many unrelated modules with unsupported ABAP;
  // their bodies are not part of this run's call closure.
  return up(root.type) === "FUNC" ? loaded.filter(source => source.type !== "FUGR" || source.kind !== "module"
    || called.has(source.include)) : loaded;
}

/* abapGit's file name of an object: lower case, a namespace's slashes as #. A function group's part is
   <group>.fugr.<part>.abap. */
function fileName(name, type, include = "main") {
  const base = name.toLowerCase().replace(/\//g, "#");
  if (type === "TYPE") return base + ".type.abap";
  if (type === "FUGR") return base + ".fugr." + include.toLowerCase().replace(/\//g, "#") + ".abap";
  if (type === "CLAS") return base + ".clas." + (include === "main" ? "" : CLASS_PARTS[include] + ".") + "abap";
  if (type === "INTF") return base + ".intf.abap";
  return base + ".prog.abap";
}

/* Where a source read from SAP stands in the folder of a run: a program or include in sap, as SAP holds it; a class
   part or an interface in src. A step in that file is a step in the SAP object it was read from. */
function copyPath(folder, source) {
  return source.type === "PROG" || source.type === "INCL" ? path.join(folder, "sap", fileName(source.name, "PROG"))
    : path.join(folder, "src", fileName(source.name, source.type, source.include));
}

// FORMAT changes only classic list presentation. The transpiler does not implement it;
// omit standalone, single-line FORMAT statements in its copy while keeping line numbers.
// SAP source and the sap/ copies remain untouched for the editor and debugger mapping.
function omitListFormat(text) {
  return String(text).split(/\r?\n/).map(line => /^\s*FORMAT\b[^.]*\.\s*(?:".*)?$/i.test(line)
    ? "* VERTEX transpiler: FORMAT list presentation omitted" : line).join("\n");
}

/* The bundled transpiler rejects STATICS at runtime. Move each module's
   statics to its function group's TOP include under private, stable names.
   This preserves their value across calls while keeping source line counts. */
function liftModuleStatics(text, group, module) {
  const tokens = tokenize(text), changes = [], declarations = [], renamed = new Map(), ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    if (up(tokens[i].value) !== "STATICS") continue;
    let end = i + 1;
    while (end < tokens.length && tokens[end].value !== ".") end++;
    if (end === tokens.length) throw new Error(module + ": STATICS without its period.");
    const begin = tokens[i].offset, finish = tokens[end].endOffset;
    const names = [], colon = tokens[i + 1]?.value === ":";
    for (let at = i + (colon ? 2 : 1); at < end; at++)
      if ((at === i + (colon ? 2 : 1) || tokens[at - 1].value === ",") && tokens[at].kind === "word") names.push(tokens[at]);
    if (!names.length) throw new Error(module + ": STATICS declaration has no field.");
    let declaration = text.slice(begin, finish);
    for (const name of names.slice().reverse()) {
      const key = up(name.value);
      const alias = "ZVX_S" + crypto.createHash("sha1").update(group + "|" + module + "|" + key).digest("hex").slice(0, 20).toUpperCase();
      renamed.set(key, alias);
      const from = name.offset - begin;
      declaration = declaration.slice(0, from) + alias + declaration.slice(from + name.value.length);
    }
    declaration = declaration.replace(/^STATICS/i, "DATA");
    declarations.push(declaration);
    ranges.push([begin, finish]);
    changes.push({ begin, finish, value: text.slice(begin, finish).replace(/[^\r\n]/g, " ") });
    i = end;
  }
  for (const token of tokens) {
    const alias = token.kind === "word" && renamed.get(up(token.value));
    if (alias && !ranges.some(([begin, finish]) => token.offset >= begin && token.offset < finish))
      changes.push({ begin: token.offset, finish: token.endOffset, value: alias });
  }
  changes.sort((a, b) => b.begin - a.begin);
  for (const change of changes) text = text.slice(0, change.begin) + change.value + text.slice(change.finish);
  return { text, declarations };
}

const progXml = (name, kind) => `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><PROGDIR><NAME>${name}</NAME><SUBC>${kind}</SUBC></PROGDIR></asx:values></asx:abap></abapGit>\n`;

/* A program with its INCLUDEs written in, as SAP compiles it: its lines, and for each the file and line it comes from
   (an index into files, a 1-based line). An INCLUDE statement must stand on lines of its own; an include met again
   inside itself is refused. */
function expandIncludes(name, texts) {
  const files = [], lines = [], places = [];
  const put = (current, chain) => {
    const text = texts.get(current);
    if (text == null) throw new Error("Include " + current + " was not read.");
    if (chain.includes(current)) throw new Error("Include " + current + " includes itself: " + chain.concat(current).join(" > ") + ".");
    const index = files.push(current) - 1, own = text.split(/\r?\n/), tokens = tokenize(text), statements = new Map();
    for (let i = 0; i < tokens.length; i++) {
      const next = tokens[i + 1];
      if (up(tokens[i].value) !== "INCLUDE" || !next || next.kind !== "word" || ["TYPE", "STRUCTURE"].includes(up(next.value))) continue;
      if (i > 0 && tokens[i - 1].line === tokens[i].line) {
        throw new Error(current + " line " + tokens[i].line + ": an INCLUDE shares its line with another statement.");
      }
      let end = i;
      while (tokens[end] && tokens[end].value !== ".") end++;
      if (!tokens[end]) throw new Error(current + " line " + tokens[i].line + ": INCLUDE without its period.");
      if (tokens[end + 1] && tokens[end + 1].line === tokens[end].line) {
        throw new Error(current + " line " + tokens[end].line + ": an INCLUDE shares its line with another statement.");
      }
      statements.set(tokens[i].line, { last: tokens[end].line, include: up(next.value) });
    }
    for (let line = 1; line <= own.length; line++) {
      const statement = statements.get(line);
      if (!statement) { lines.push(own[line - 1]); places.push([index, line]); continue; }
      put(statement.include, chain.concat(current));
      line = statement.last;
    }
  };
  put(up(name), []);
  return { files, lines, places };
}

/* The folder of a run, written fresh. src holds what the transpiler reads: the classes and interfaces, the dictionary
   objects as abapGit XML, and each program with its includes written in. sap holds the programs and includes as SAP holds them, which the reader opens, steps
   through and sets breakpoints in; vertex-includes.json says which line of a written-in program is which line there.
   The program run is returned; the transpiler's project is found from it. */
function writeProject(system, sources, dictionary = [], folder = path.join(os.tmpdir(), "vertex-sap-abap",
  String(system || "SAP").replace(/[^A-Za-z0-9_-]/g, "_") + "-" + process.pid)) {
  fs.rmSync(folder, { recursive: true, force: true });
  const src = path.join(folder, "src"), sap = path.join(folder, "sap");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(sap, { recursive: true });
  const written = [], programs = [], texts = new Map();
  // abaplint associates function-group includes only when their names start
  // with L. SAP groups can also include arbitrary names (FF04 uses
  // FIMA_CONSTANTS), so give those files an internal L-prefixed alias.
  const aliasCounts = new Map();
  const nonLIncludes = sources.filter(source => source.type === "FUGR" && source.kind === "include"
    && !source.include.toUpperCase().startsWith("L"));
  const aliasSources = nonLIncludes.map(source => {
    const number = (aliasCounts.get(source.name) || 0) + 1;
    aliasCounts.set(source.name, number);
    return { ...source, include: "L" + source.name + "VERTEX" + String(number).padStart(3, "0") };
  });
  const projectSources = sources.concat(aliasSources);
  const includeAliases = new Map(nonLIncludes.map((source, index) =>
    [source.name + "|" + source.include.toUpperCase(), aliasSources[index].include]));
  const aliasedText = source => source.text.replace(/\bINCLUDE\s+([A-Z0-9_\/]+)(\s*\.)/gi,
    (statement, include, end) => "INCLUDE " + (includeAliases.get(source.name + "|" + include.toUpperCase()) || include) + end)
    .replace(/\bVALUE\s+space\b/gi, "VALUE ' '");
  const moduleBodies = new Map(), groupStatics = new Map();
  for (const source of sources.filter(source => source.type === "FUGR" && source.kind === "module")) {
    const result = liftModuleStatics(require("./sap-fugr").moduleBody(source.text, source.signature), source.name, source.include);
    moduleBodies.set(source, result.text);
    if (result.declarations.length) {
      if (!groupStatics.has(source.name)) groupStatics.set(source.name, []);
      groupStatics.get(source.name).push(...result.declarations);
    }
  }
  for (const [group] of groupStatics) if (!projectSources.some(source => source.type === "FUGR" && source.name === group
      && source.kind === "include" && /TOP$/i.test(source.include)))
    throw new Error("Function group " + group + " has STATICS but no TOP include for their saved values.");
  const moduleText = source => {
    return moduleBodies.get(source);
  };
  let shown = null;
  for (const source of projectSources) {
    if (source.type === "PROG" || source.type === "INCL") {
      const file = copyPath(folder, source);
      fs.writeFileSync(file, source.text);
      texts.set(source.name, source.text);
      if (source.type === "PROG") programs.push(source.name);
      if (!shown) shown = file;
      continue;
    }
    const file = copyPath(folder, source);
    const body = source.kind === "module" ? moduleText(source) : aliasedText(source);
    const statics = source.type === "FUGR" && source.kind === "include" && /TOP$/i.test(source.include)
      ? groupStatics.get(source.name) : null;
    fs.writeFileSync(file, omitListFormat(normalizeLegacyNotEqual(body + (statics?.length ? "\n" + statics.join("\n") + "\n" : ""))));
    written.push(file);
  }
  // The DEFAULTs of the modules' optional parameters, which the transpiler leaves unset (sap-fugr applyModuleDefaults).
  fs.writeFileSync(path.join(folder, "vertex-defaults.json"), JSON.stringify(sources.filter(source => source.kind === "module")
    .map(source => ({ module: source.include, params: [...source.signature.parts.IMPORTING, ...source.signature.parts.CHANGING]
      .filter(param => param.default !== undefined).map(param => ({ name: param.name, default: param.default })) }))));
  // Each function group's XML: its includes and its modules' signatures.
  for (const group of new Set(projectSources.filter(source => source.type === "FUGR").map(source => source.name))) {
    const file = path.join(src, group.toLowerCase().replace(/\//g, "#") + ".fugr.xml");
    fs.writeFileSync(file, require("./sap-fugr").groupXml(group, projectSources.filter(source => source.type === "FUGR" && source.name === group)));
    written.push(file);
  }
  const maps = [];
  for (const name of programs) {
    const expanded = expandIncludes(name, texts), file = path.join(src, fileName(name, "PROG"));
    fs.writeFileSync(file, omitListFormat(expanded.lines.join("\n")));
    fs.writeFileSync(file.replace(/\.abap$/, ".xml"), progXml(name, "1"));
    written.push(file, file.replace(/\.abap$/, ".xml"));
    maps.push({ program: path.basename(file), files: expanded.files.map(include => path.join(sap, fileName(include, "PROG"))),
      places: expanded.places });
  }
  fs.writeFileSync(path.join(folder, "vertex-includes.json"), JSON.stringify(maps));
  for (const object of dictionary) {
    const { file, xml } = require("./sap-ddic").objectXml(object);
    fs.writeFileSync(path.join(src, file), xml);
    written.push(path.join(src, file));
  }
  // The whole of open-abap-core goes with every run: SAP's own classes the code names (CX_SY_*, CL_ABAP_CHAR_UTILITIES,
  // RTTI) and those the runtime raises by itself. It costs a few seconds of transpiling, and no class is left out.
  const core = path.join(__dirname, "vendor", "open-abap-core", "src");
  if (!fs.existsSync(core)) throw new Error("The bundled open-abap-core is missing. Reinstall the VS Code extension.");
  const inputs = ["src", core], filters = written.map(file =>
    "(?:^|[/\\\\])" + path.basename(file).replace(/[.*+?^${}()|[\]\\#]/g, "\\$&") + "$")
    .concat("[/\\\\]open-abap-core[/\\\\]src[/\\\\]");
  // Data elements such as CHAR12 that open-abap-core lacks, made as a local file's run makes them.
  const { localDdicAliases, coreDdicNames } = require("./local-run");
  const aliases = localDdicAliases(written, path.join(folder, "ddic"), coreDdicNames(path.dirname(core)));
  if (aliases.length) {
    inputs.push("ddic");
    filters.push(...aliases.map(name => "(?:^|[/\\\\])" + name.toLowerCase() + "\\.dtel\\.xml$"));
  }
  fs.writeFileSync(path.join(folder, "abap_transpile.json"), JSON.stringify({ input_folder: inputs, input_filter: filters,
    // A type the run did not read compiles, and fails only if the run reaches it: only what is reached is read.
    output_folder: "output", write_unit_tests: true, write_source_map: true, options: { addFilenames: true, addCommonJS: true, unknownTypes: "runtimeError" } }));
  return shown || written[0];
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeVlq(segment) {
  const values = [];
  let value = 0, shift = 0;
  for (const letter of segment) {
    const digit = BASE64.indexOf(letter);
    if (digit < 0) throw new Error("Invalid source map mapping.");
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) shift += 5;
    else { values.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
  }
  return values;
}
function encodeVlq(values) {
  let text = "";
  for (const number of values) {
    let value = number < 0 ? (-number << 1) | 1 : number << 1;
    do { let digit = value & 31; value >>>= 5; if (value) digit |= 32; text += BASE64[digit]; } while (value);
  }
  return text;
}

/* After the transpiler: the map of each written-in program pointed at the program and its includes in sap, so a step,
   a breakpoint and the record stand in the file the line came from. A mapped line with no place is an error. */
function remapIncludes(root, outputRoot) {
  const maps = JSON.parse(fs.readFileSync(path.join(root, "vertex-includes.json"), "utf8"));
  const generated = new Map();
  const visit = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, item.name);
    if (item.isDirectory()) { if (item.name !== "node_modules") visit(at); }
    else if (item.name.endsWith(".mjs.map")) generated.set(item.name.toLowerCase(), at);
  } };
  visit(outputRoot);
  for (const spec of maps) {
    const file = generated.get(spec.program.replace(/\.abap$/i, ".mjs.map").toLowerCase());
    if (!file) throw new Error("The transpiler wrote no map for " + spec.program + ".");
    const map = JSON.parse(fs.readFileSync(file, "utf8"));
    if ((map.sources || []).length !== 1) throw new Error(spec.program + ": its map has " + (map.sources || []).length + " sources, not one.");
    let source = 0, line = 0, column = 0, outSource = 0, outLine = 0, outColumn = 0;
    map.mappings = map.mappings.split(";").map(row => {
      let generatedColumn = 0;
      return row.split(",").filter(Boolean).map(segment => {
        const fields = decodeVlq(segment);
        generatedColumn += fields[0];
        if (fields.length < 4) return encodeVlq([fields[0]]);
        source += fields[1]; line += fields[2]; column += fields[3];
        const place = spec.places[line];
        if (!place) throw new Error(spec.program + ": generated code maps to line " + (line + 1) + ", which the program written in does not have.");
        const out = [fields[0], place[0] - outSource, place[1] - 1 - outLine, column - outColumn];
        outSource = place[0]; outLine = place[1] - 1; outColumn = column;
        if (fields.length >= 5) out.push(fields[4]);
        return encodeVlq(out);
      }).join(",");
    }).join(";");
    map.sources = spec.files;
    delete map.sourcesContent;
    fs.writeFileSync(file, JSON.stringify(map));
  }
}

module.exports = { partsOf, callsOf, stubUnreached, namedObjects, collect, fileName, copyPath, expandIncludes, omitListFormat, writeProject, remapIncludes };
