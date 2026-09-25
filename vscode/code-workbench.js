"use strict";

const { createRepository, TYPES, revision } = require("./sap-code");
const { hunks, reviewedSource, askPrompt } = require("./code-review");
// Every tool that reaches SAP takes the system by name: the main chat can read
// in one and prepare a change for another. review_sap_changes works on the
// open editor tab, which already knows its system.
const SYSTEM = { type: "string", description: "SAP system name from vertex.systems. Omit for the active system. "
  + "Use it when the user names a system, or to reach the system an open editor or VERTEX Tools window belongs to." };
const withSystem = tool => tool.name === "review_sap_changes" ? tool : { ...tool,
  inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, system: SYSTEM } } };
const schemas = require("./schemas/sap-code-tools.json").concat([{
  name: "open_sap_object",
  description: "Open SAP source in an editable VS Code tab on the right. Use for requests to open/show code. Does not save to SAP.",
  // Opens the SAP editor without modifying repository data.
  annotations: { readOnlyHint: true, destructiveHint: false },
  inputSchema: require("./schemas/sap-code-tools.json").find(t => t.name === "read_sap_object").inputSchema
}, {
  name: "review_sap_changes",
  description: "Open review for manual edits in the active SAP source tab. Shows independently approvable hunks and an Approve all action. Does not save to SAP.",
  annotations: { readOnlyHint: true, destructiveHint: false },
  inputSchema: { type: "object", additionalProperties: false, properties: {} }
}]).map(withSystem);

function register(vscode, context, { active, password, pin, pinned, systems }) {
  const events = require("./agent-events").createEmitter();
  const repositories = new Map(), texts = new Map(), opened = new Map(), drafts = new Map();
  const navigation = [];
  const externalSignatures = new Map();
  let sequence = 0;
  const provider = { provideTextDocumentContent: uri => texts.get(uri.toString()) || "" };
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("vertex-source", provider));
  async function repository(savedKey) {
    const chosen = active();
    if (savedKey) {
      const [url, client, user, name, allowInsecureCertificate] = JSON.parse(savedKey);
      chosen.system = { url, client, user, name, allowInsecureCertificate };
      chosen.error = undefined;
    }
    if (chosen.error) { throw new Error(chosen.error); }
    const system = { ...chosen.system };
    const key = JSON.stringify([system.url, system.client || "", system.user, system.name,
      system.allowInsecureCertificate === true]);
    if (!repositories.has(key)) {
      const pw = await password(context, system);
      if (!pw) { throw new Error("SAP password was not supplied."); }
      const { ADTClient } = require("abap-adt-api");
      const client = new ADTClient(system.url, system.user, pw, system.client || "", "EN", { timeout: 60000 });
      client.httpClient.httpclient = require("./sap-http").create(system);
      repositories.set(key, { key, label: `${system.name} / ${system.user} / ${system.client || "default"}`,
        api: createRepository({ client, systemId: key,
          emit: event => events.emit({ ...event, system: system.name }) }) });
    }
    return repositories.get(key);
  }
  const fileEvents = new vscode.EventEmitter();
  const savedEntries = context.workspaceState.get("sapEditors", {});
  async function rememberEditor(uri, entry) {
    savedEntries[uri.toString()] = { key: entry.repo.key, data: entry.data };
    await context.workspaceState.update("sapEditors", savedEntries);
  }
  async function fileEntry(uri) {
    const key = uri.toString();
    if (!opened.has(key)) {
      const saved = savedEntries[key];
      if (!saved) { throw vscode.FileSystemError.FileNotFound(uri); }
      const repo = await repository(saved.key);
      let data = saved.data && { ...saved.data };
      // A tab can outlive an extension reload, including an upgrade from a
      // version which stored only its object metadata.  Do not let that stale
      // entry make VS Code show its generic "editor could not be opened" page:
      // reconstruct the read-only buffer from SAP and replace the old state.
      if (!data || typeof data.source !== "string") {
        if (!data || !data.object_name || !data.object_type) {
          throw vscode.FileSystemError.FileNotFound(uri);
        }
        data = await repo.api.execute("read_sap_object", {
          object_name: data.object_name, object_type: data.object_type,
          include: data.include || "main"
        });
        savedEntries[key] = { key: repo.key, data };
        await context.workspaceState.update("sapEditors", savedEntries);
      }
      opened.set(key, { repo, data });
    }
    return opened.get(key);
  }
  const sapFiles = {
    onDidChangeFile: fileEvents.event,
    watch: () => ({ dispose() {} }),
    async stat(uri) {
      const entry = await fileEntry(uri);
      return { type: vscode.FileType.File, ctime: 0, mtime: entry.mtime || 0,
        size: Buffer.byteLength(entry.data.source) };
    },
    async readFile(uri) { return Buffer.from((await fileEntry(uri)).data.source); },
    async writeFile(uri, content) {
      const entry = await fileEntry(uri), source = Buffer.from(content).toString("utf8");
      // Review has already activated exactly these bytes. Let VS Code mark
      // the document clean without writing SAP again or saving declined hunks.
      if (entry.acknowledged) {
        if (revision(source) !== entry.acknowledged) { throw new Error("Editor changed after review; remaining edits are not saved."); }
        return;
      }
      await saveSource(entry, source);
      await rememberEditor(uri, entry);
      entry.mtime = Date.now();
      fileEvents.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    },
    readDirectory: () => [],
    createDirectory() { throw vscode.FileSystemError.NoPermissions("SAP folders cannot be created here."); },
    delete() { throw vscode.FileSystemError.NoPermissions("SAP objects cannot be deleted here."); },
    rename() { throw vscode.FileSystemError.NoPermissions("SAP objects cannot be renamed here."); }
  };
  context.subscriptions.push(fileEvents,
    vscode.workspace.registerFileSystemProvider("vertex-sap", sapFiles, { isCaseSensitive: true }));
  function position(line, character) {
    return vscode.Position ? new vscode.Position(line, character) : { line, character };
  }
  function range(line, from, to) {
    return vscode.Range ? new vscode.Range(position(line, from), position(line, to))
      : { start: position(line, from), end: position(line, to) };
  }
  function location(uri, line, column, length) {
    const target = range(line, column, column + length);
    return vscode.Location ? new vscode.Location(uri, target) : { uri, range: target };
  }
  // Definitions and implementations are separate ADT class includes.  Keep
  // this deliberately narrow: it makes F12 useful without pretending that a
  // text search can resolve locals, data elements or arbitrary method calls.
  function methodAnchor(document, at) {
    const line = document.getText().split(/\r?\n/)[at.line] || "";
    const word = /[A-Za-z0-9_\/]/;
    let from = Math.min(at.character, line.length), to = from;
    while (from > 0 && word.test(line.charAt(from - 1))) { from--; }
    while (to < line.length && word.test(line.charAt(to))) { to++; }
    const name = line.slice(from, to);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { return null; }
    const prefix = line.slice(0, from);
    if (/^\s*METHOD\s+$/i.test(prefix)) { return { name: name.toUpperCase(), implementation: true, from, to }; }
    if (/^\s*(?:CLASS-)?METHODS\s*(?::\s*)?$/i.test(prefix)) {
      return { name: name.toUpperCase(), implementation: false, from, to };
    }
    // An unqualified call belongs to this class.  Its useful first stop is
    // the implementation; a second F12 on METHOD takes the reader back to
    // the declaration.  Calls through -> or => are deliberately left for a
    // future cross-class resolver.
    if (/^\s*\(/.test(line.slice(to)) && !/(?:->|=>)\s*$/.test(prefix)) {
      return { name: name.toUpperCase(), implementation: true, call: true, from, to };
    }
    return null;
  }
  const blockOpen = { DO: "ENDDO", LOOP: "ENDLOOP", METHOD: "ENDMETHOD", FORM: "ENDFORM", IF: "ENDIF", CASE: "ENDCASE" };
  const blockClose = Object.fromEntries(Object.entries(blockOpen).map(([open, close]) => [close, open]));
  function structuralAnchor(document, at) {
    const line = document.getText().split(/\r?\n/)[at.line] || "";
    const match = /^\s*(DO|ENDDO|LOOP|ENDLOOP|METHOD|ENDMETHOD|FORM|ENDFORM|IF|ELSEIF|ELSE|ENDIF|CASE|WHEN|ENDCASE)\b/i.exec(line);
    if (!match) return null;
    const from = match.index + match[0].indexOf(match[1]), to = from + match[1].length;
    if (at.character < from || at.character > to) return null;
    return { name: match[1].toUpperCase(), from, to, line: at.line };
  }
  /* Double-click jumps from a block's opening to its end and back; with
     BRANCHES - Ctrl+click and F12 - IF and CASE step through ELSEIF, ELSE
     and WHEN on the way. */
  function structuralTarget(document, at, branches) {
    const anchor = structuralAnchor(document, at);
    if (!anchor) return undefined;
    const lines = document.getText().split(/\r?\n/), frames = [], targets = new Map();
    lines.forEach((line, index) => {
      const hit = /^\s*(DO|ENDDO|LOOP|ENDLOOP|METHOD|ENDMETHOD|FORM|ENDFORM|IF|ELSEIF|ELSE|ENDIF|CASE|WHEN|ENDCASE)\b/i.exec(line);
      if (!hit) return;
      const word = hit[1].toUpperCase(), column = hit.index + hit[0].indexOf(hit[1]);
      if (blockOpen[word]) { frames.push({ kind: word, start: { index, column, word }, branches: [] }); return; }
      if (word === "ELSEIF" || word === "ELSE" || word === "WHEN") {
        const expected = word === "WHEN" ? "CASE" : "IF";
        const frame = [...frames].reverse().find(item => item.kind === expected);
        if (frame) frame.branches.push({ index, column, word });
        return;
      }
      const expected = blockClose[word], frame = frames.length && frames[frames.length - 1];
      if (!expected || !frame || frame.kind !== expected) return;
      frames.pop();
      const end = { index, column, word }, next = pos => ({ document, target: location(document.uri, pos.index, pos.column, pos.word.length) });
      targets.set(frame.start.index, branches && frame.branches[0] || end);
      frame.branches.forEach((branch, item) => targets.set(branch.index, frame.branches[item + 1] || end));
      targets.set(end.index, frame.start);
    });
    const target = targets.get(anchor.line);
    return target && { document, target: location(document.uri, target.index, target.column, target.word.length) };
  }
  function methodLine(source, name, implementation) {
    const lines = source.split(/\r?\n/), exact = new RegExp("^\\s*METHOD\\s+" + name + "\\b", "i");
    if (implementation) { return lines.findIndex(line => exact.test(line)); }
    for (let start = 0; start < lines.length; start++) {
      if (!/^\s*(?:CLASS-)?METHODS\b/i.test(lines[start])) { continue; }
      let statement = lines[start];
      for (let end = start + 1; end < lines.length && !/\./.test(statement); end++) { statement += "\n" + lines[end]; }
      if (new RegExp("\\b" + name + "\\b", "i").test(statement)) { return start; }
    }
    return -1;
  }
  function methodSignature(source, name) {
    const wanted = new RegExp("^\\s*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    for (const statement of abapStatements(source)) {
      if (/^(?:CLASS-)?METHODS\b/i.test(statement.text)) {
        const members = splitChain(statement.text.replace(/^(?:CLASS-)?METHODS\s*:?[\s]*/i, ""));
        const member = members.find(item => wanted.test(item));
        if (member) {
          const parameters = member.match(/\b(?:IMPORTING|EXPORTING|CHANGING|RETURNING|RAISING|EXCEPTIONS)\b[\s\S]*\.?$/i);
          return parameters ? formatParameters(parameters[0]) : "";
        }
      }
      if (/^FORM\b/i.test(statement.text)) {
        const member = statement.text.replace(/^FORM\s+/i, "");
        if (wanted.test(member)) {
          const parameters = member.match(/\b(?:USING|TABLES|CHANGING|RAISING|EXCEPTIONS)\b[\s\S]*\.?$/i);
          return parameters ? formatParameters(parameters[0]) : "";
        }
      }
    }
    return "";
  }
  function formatParameters(source) {
    const sections = source.replace(/\.$/, "").split(/\b(IMPORTING|EXPORTING|CHANGING|RETURNING|RAISING|EXCEPTIONS|USING|TABLES)\b/i);
    const result = [];
    for (let index = 1; index < sections.length; index += 2) {
      const heading = sections[index].toUpperCase(), body = sections[index + 1].replace(/\s+/g, " ").trim();
      result.push(heading);
      // A parameter starts with its name (or VALUE(name)) followed by TYPE or
      // LIKE.  Everything until the next such start belongs to that parameter
      // (DEFAULT, OPTIONAL, and so on).
      const starts = [], matcher = /(?:^|\s)(!?[A-Za-z_][A-Za-z0-9_]*|VALUE\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\))\s+(?=(?:TYPE|LIKE)\b)/gi;
      let match;
      while ((match = matcher.exec(body))) { starts.push(match.index + (match[0].charAt(0) === " " ? 1 : 0)); }
      if (starts.length) {
        starts.forEach((start, item) => result.push("  " + body.slice(start, starts[item + 1] || body.length).trim().replace(/^!/, "")));
      } else if (body) {
        // RAISING and EXCEPTIONS are a name list rather than typed parameters.
        body.split(/\s+/).forEach(item => result.push("  " + item));
      }
    }
    return result.join("\n");
  }
  function methodInformation(document, at) {
    const anchor = methodAnchor(document, at);
    if (!anchor) { return undefined; }
    const signature = methodSignature(document.getText(), anchor.name);
    return signature ? { anchor, signature } : undefined;
  }
  // A compact lexer, deliberately statement-based like ACE's CL_CI_SCAN use.
  // It treats comments and quoted/template literals as opaque, so a period in
  // either cannot split a declaration or method signature.
  function abapStatements(source) {
    const result = []; let text = "", line = 0, start = 0, quote = false, template = false, comment = false, atLineStart = true;
    const flush = end => { if (text.trim()) result.push({ text: text.replace(/\s+/g, " ").trim(), start, end }); text = ""; };
    for (let index = 0; index < source.length; index++) {
      const ch = source[index], next = source[index + 1];
      if (ch === "\r") continue;
      if (ch === "\n") {
        if (!comment) text += " "; comment = false; line++; atLineStart = true;
        // A completed statement may be followed by a newline.  The next
        // statement starts on that following line, not on the line of its
        // preceding period.
        if (!text.trim()) start = line;
        continue;
      }
      if (comment) continue;
      if (atLineStart && /\s/.test(ch)) { text += ch; continue; }
      if (atLineStart && ch === "*") { comment = true; continue; }
      atLineStart = false;
      if (!template && ch === "'" ) { quote = !quote; text += ch; continue; }
      if (!quote && ch === "|" && next === "|") { text += "||"; index++; continue; }
      if (!quote && ch === "|") { template = !template; text += ch; continue; }
      if (!quote && !template && ch === '"') { comment = true; continue; }
      text += ch;
      if (!quote && !template && ch === ".") { flush(line); start = line; }
    }
    flush(line); return result;
  }
  function splitChain(text) {
    const result = [], current = []; let depth = 0, quote = false, template = false;
    for (let index = 0; index < text.length; index++) {
      const ch = text[index], next = text[index + 1];
      if (!template && ch === "'") quote = !quote;
      else if (!quote && ch === "|" && next === "|") { current.push(ch, next); index++; continue; }
      else if (!quote && ch === "|") template = !template;
      if (!quote && !template && ch === "(") depth++;
      if (!quote && !template && ch === ")") depth = Math.max(0, depth - 1);
      if (!quote && !template && !depth && ch === ",") { result.push(current.join("").trim()); current.length = 0; continue; }
      current.push(ch);
    }
    if (current.join("").trim()) result.push(current.join("").trim()); return result;
  }
  /* The identifier under the cursor: its text and where it starts and ends
     on the line. Characters, not patterns - what it is, SAP decides. */
  function wordAt(document, at) {
    const line = document.getText().split(/\r?\n/)[at.line] || "";
    const part = ch => (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")
      || ch === "_" || ch === "/";
    let from = Math.min(at.character, line.length), to = from;
    while (from > 0 && part(line.charAt(from - 1))) { from--; }
    while (to < line.length && part(line.charAt(to))) { to++; }
    // Angle brackets belong to the name only as a field symbol's <...>; the
    // > of => and -> is not part of the method name after it.
    if (from < to && line.charAt(from - 1) === "<" && line.charAt(to) === ">") { from--; to++; }
    return from < to ? { name: line.slice(from, to), from, to } : null;
  }
  /* The SAP source a VERTEX tab shows, for asking ADT about it. */
  function sourceOf(document) {
    const entry = opened.get(document.uri.toString()) || readOnly.get(document.uri.toString());
    if (!entry || !entry.repo || !entry.repo.api || typeof entry.repo.api.elementInfo !== "function") { return null; }
    const url = entry.data.source_url || (entry.data.object_url + "/source/main");
    return { entry, url };
  }
  /* ADT's answer for the name at a position, kept per text and position:
     the same hover asked twice costs one request. */
  const adtAnswers = new Map();
  async function adtAsk(kind, document, at) {
    const source = sourceOf(document), word = wordAt(document, at);
    if (!source || !word) { return undefined; }
    const text = document.getText();
    const key = [kind, document.uri.toString(), document.version, at.line, word.from].join("|");
    if (!adtAnswers.has(key)) {
      if (adtAnswers.size > 200) { adtAnswers.clear(); }
      adtAnswers.set(key, kind === "info"
        ? source.entry.repo.api.elementInfo(source.url, text, at.line + 1, word.from)
        : source.entry.repo.api.definition(source.url, text, at.line + 1, word.from, word.to));
    }
    try {
      return { word, source, answer: await adtAnswers.get(key) };
    } catch (error) {
      adtAnswers.delete(key);
      throw error;
    }
  }
  /* The element info as a hover: what it is and its type, then SAP's text. */
  function describeElement(info, dataType) {
    if (!info || typeof info === "string") { return info ? String(info) : ""; }
    const lines = [String(info.name || "") + (info.type ? "  (" + info.type + ")" : "")];
    if (dataType) { lines.push(dataType); }
    (info.components || []).forEach(component => (component.entries || []).forEach(entry => {
      if (entry.value) { lines.push(entry.key + ": " + entry.value); }
    }));
    const doc = String(info.doc || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (doc) { lines.push("", doc); }
    return lines.join("\n").trim();
  }
  /* A data element's properties, read once per system and name. */
  const dataElements = new Map();
  async function dataElementOf(repo, name) {
    const key = repo.key + "|" + String(name).toUpperCase();
    if (!dataElements.has(key)) {
      if (dataElements.size > 200) { dataElements.clear(); }
      dataElements.set(key, repo.api.dataElement(String(name)));
    }
    try { return await dataElements.get(key); } catch (error) { dataElements.delete(key); throw error; }
  }
  /* `domain: VERSNO  NUMC 5`, or the built-in type when there is no domain. */
  function describeDataElement(properties) {
    if (!properties || !properties.dataType) { return ""; }
    const size = properties.dataTypeLength ? " " + Number(properties.dataTypeLength)
      + (properties.dataTypeDecimals ? "," + Number(properties.dataTypeDecimals) : "") : "";
    return (properties.typeName ? "domain: " + properties.typeName.toUpperCase() + "  " : "type: ") + properties.dataType + size;
  }
  // ADT's object type codes for the things a hover meets, in words.
  const ELEMENT_KINDS = { "CLAS/OA": "attribute", "INTF/IA": "attribute", "CLAS/OM": "method", "INTF/IO": "method",
    "CLAS/OT": "type", "INTF/IT": "type", "CLAS/OE": "event", "INTF/IE": "event",
    "PROG/PD": "variable", "PROG/PY": "type", "PROG/PU": "form" };
  /* The declaration SAP's navigation points at, as it is written in this tab:
     from the declared name to the end of its line, without the closing
     period or comma - `mv_name TYPE string`, `i_text TYPE string`. */
  /* The declaration of the name, starting where SAP's navigation points. For
     a variable or an attribute that is the name itself. For a parameter ADT
     points at its method - `METHODS constructor` - so the name is looked for
     further on in that one statement, up to its period. Returns the line and
     column of the name, and the declaration written there. */
  async function adtDeclared(document, at) {
    let asked;
    try {
      asked = await adtAsk("definition", document, at);
    } catch (error) {
      // On the declaration itself ADT answers with an info message instead
      // of a location: the name is declared right here. VERTEX logs on in
      // English, so the text is stable; it carries no message number.
      if (!/Definition location found; where-used list may be possible/i.test(String(error && error.message))) { throw error; }
      const word = wordAt(document, at);
      const lines = document.getText().split(/\r?\n/);
      const found = declaredIn(document.getText(), { line: at.line + 1, column: word.from }, word.name);
      if (!found) { return undefined; }
      const opening = /\bBEGIN\s+OF\s+$/i.exec(lines[at.line].slice(0, word.from));
      return opening ? { ...found, text: opening[0].trim().toUpperCase() + " " + found.text } : found;
    }
    const found = asked && asked.answer;
    if (!found || !found.url || !found.line) { return undefined; }
    if (String(found.url).split("#")[0] !== asked.source.url) { return undefined; }
    return declaredIn(document.getText(), found, asked.word.name);
  }
  function declaredIn(text, found, name) {
    const lines = text.split(String.fromCharCode(10)).map(line => line.split(String.fromCharCode(13)).join(""));
    const wanted = name.toUpperCase();
    const isPart = ch => (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_";
    for (let index = found.line - 1, from = found.column || 0; index < lines.length; index++, from = 0) {
      const upper = lines[index].toUpperCase();
      for (let at2 = upper.indexOf(wanted, from); at2 >= 0; at2 = upper.indexOf(wanted, at2 + 1)) {
        const before = at2 > 0 ? upper.charAt(at2 - 1) : " ", after = upper.charAt(at2 + wanted.length);
        if (isPart(before) || isPart(after)) { continue; }
        let piece = lines[index].slice(at2).trim();
        while (piece.endsWith(".") || piece.endsWith(",")) { piece = piece.slice(0, -1).trim(); }
        return { line: index, column: at2, text: piece };
      }
      // The statement ends here: a period outside a comment or a literal is
      // the end of the METHODS or DATA statement SAP pointed into.
      if (lines[index].split('"')[0].trim().endsWith(".")) { break; }
    }
    return undefined;
  }
  async function adtDeclaration(document, at) {
    const declared = await adtDeclared(document, at);
    return declared && declared.text || undefined;
  }
  /* Where SAP says the name is defined - in this tab when it is this source. */
  async function adtDefinition(document, at) {
    const declared = await adtDeclared(document, at);
    if (!declared) { return undefined; }
    return { document, target: location(document.uri, declared.line, declared.column, wordAt(document, at).name.length) };
  }
  /* A declaration SAP points at in another object - a type pool, an
     interface, another class: that object's source is read, once per URL. */
  const foreignSources = new Map();
  /* Read-only views of other objects, by URI: the system and the ADT source
     URL they show, so hover and navigation work inside them too. */
  const readOnly = new Map();
  async function adtForeign(document, at) {
    const asked = await adtAsk("definition", document, at);
    const found = asked && asked.answer;
    if (!found || !found.url || !found.line) { return undefined; }
    const url = String(found.url).split("#")[0];
    if (url === asked.source.url || typeof asked.source.entry.repo.api.sourceAt !== "function") { return undefined; }
    const repo = asked.source.entry.repo, key = repo.key + "|" + url;
    if (!foreignSources.has(key)) {
      if (foreignSources.size > 50) { foreignSources.clear(); }
      foreignSources.set(key, repo.api.sourceAt(url));
    }
    let source;
    try { source = await foreignSources.get(key); } catch (error) { foreignSources.delete(key); throw error; }
    const declared = declaredIn(source, found, asked.word.name);
    return declared && { ...declared, url, source, repo };
  }
  async function readOnlyView(foreign) {
    const known = [...readOnly.entries()].find(([, item]) => item.repo === foreign.repo
      && item.data.source_url === foreign.url && item.document && !item.document.isClosed);
    if (known) { return known[1].document; }
    const name = decodeURIComponent(foreign.url.replace(/\/(?:source\/main|includes\/\w+)$/, "").split("/").pop()).toUpperCase();
    const document = await snapshot(foreign.source, name + " (read-only)");
    readOnly.set(document.uri.toString(), { repo: foreign.repo, document, data: { object_name: name, source_url: foreign.url } });
    return document;
  }
  /* Where SAP says the name is defined, in another object. A class or a
     program or an interface opens as its VERTEX tab; any other kind opens read-only. */
  async function adtForeignDefinition(document, at) {
    const foreign = await adtForeign(document, at);
    if (!foreign) { return undefined; }
    const klass = /^\/sap\/bc\/adt\/oo\/classes\/([^/]+)\/(?:source\/main|includes\/(definitions|implementations|macros|testclasses))$/i.exec(foreign.url);
    const program = /^\/sap\/bc\/adt\/programs\/programs\/([^/]+)\/source\/main$/i.exec(foreign.url);
    const face = /^\/sap\/bc\/adt\/oo\/interfaces\/([^/]+)\/source\/main$/i.exec(foreign.url);
    const target = klass || program || face
      ? (await sourceDocument(foreign.repo, { object_type: klass ? "CLAS" : program ? "PROG" : "INTF",
        object_name: decodeURIComponent((klass || program || face)[1]).toUpperCase(), ...(klass && klass[2] ? { include: klass[2] } : {}) })).document
      : await readOnlyView(foreign);
    return { document: target, target: location(target.uri, foreign.line, foreign.column, wordAt(document, at).name.length) };
  }
  function procedureAt(source, line) {
    let current;
    for (const statement of abapStatements(source)) {
      if (statement.start > line) break;
      const opened = /^(METHOD|FORM|FUNCTION)\s+([\w/~]+)/i.exec(statement.text);
      if (opened) { current = { kind: opened[1].toUpperCase(), name: opened[2], start: statement.start }; continue; }
      if (/^END(?:METHOD|FORM|FUNCTION)\b/i.test(statement.text)) current = undefined;
    }
    return current;
  }
  function localDeclaration(source, line, name) {
    const procedure = procedureAt(source, line);
    if (!procedure) return undefined;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const named = new RegExp("^\\s*" + escaped + "\\s+(?:TYPE|LIKE)\\b", "i");
    for (const statement of abapStatements(source)) {
      if (statement.start < procedure.start || statement.start > line) continue;
      const declaration = /^(?:DATA|CONSTANTS|STATICS|FIELD-SYMBOLS?)\b\s*:?[\s\S]*$/i.exec(statement.text);
      if (declaration) {
        const members = splitChain(declaration[0].replace(/^(?:DATA|CONSTANTS|STATICS|FIELD-SYMBOLS?)\s*:?[\s]*/i, "").replace(/\.$/, ""));
        const member = members.find(item => named.test(item));
        if (member) return member.replace(/\s+/g, " ").trim() + ".";
      }
      if (new RegExp("\\b(?:DATA|FINAL|FIELD-SYMBOL)\\s*\\(\\s*" + escaped + "\\s*\\)", "i").test(statement.text)) {
        return "DATA(" + name.toLowerCase() + ").";
      }
    }
    return undefined;
  }
  function declarationLine(source, name, at) {
    const lines = source.split(/\r?\n/), escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = new RegExp("\\b(?:CLASS-)?(?:DATA|TYPES|CONSTANTS|STATICS|FIELD-SYMBOLS?)\\b[^.]*\\b" + escaped + "\\b|\\b(?:DATA|FINAL)\\s*\\(\\s*" + escaped + "\\s*\\)|\\b(?:IMPORTING|EXPORTING|CHANGING|RETURNING|RAISING)\\b[^.]*\\b" + escaped + "\\b", "i");
    // Prefer the current method's scope.  A same-named local must win over a
    // class attribute, and it also makes the lookup instantaneous.
    let start = at.line, end = at.line;
    while (start > 0 && !/^\s*METHOD\s+/i.test(lines[start])) { start--; }
    while (end < lines.length - 1 && !/^\s*ENDMETHOD\b/i.test(lines[end])) { end++; }
    for (let line = start; line <= end; line++) { if (declaration.test(lines[line])) { return line; } }
    for (let line = 0; line < lines.length; line++) { if (declaration.test(lines[line])) { return line; } }
    return -1;
  }
  function externalCallAnchor(document, at) {
    const line = document.getText().split(/\r?\n/)[at.line] || "";
    const inside = (from, length) => at.character >= from && at.character <= from + length;
    const staticCall = /\b([A-Za-z_/$][A-Za-z0-9_/$]*)\s*=>\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let match;
    while ((match = staticCall.exec(line))) {
      const classAt = match.index, methodAt = line.indexOf(match[2], classAt + match[1].length);
      if (inside(classAt, match[1].length) || inside(methodAt, match[2].length)) {
        return { kind: "method", object_type: "CLAS", object_name: match[1].toUpperCase(), method: match[2].toUpperCase(),
          name: (inside(classAt, match[1].length) ? match[1] : match[2]).toUpperCase() };
      }
    }
    const instanceCall = /\b([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    while ((match = instanceCall.exec(line))) {
      const objectAt = match.index, methodAt = line.indexOf(match[2], objectAt + match[1].length);
      if (inside(objectAt, match[1].length) || inside(methodAt, match[2].length)) {
        return { kind: "instance-method", instance: match[1].toUpperCase(), method: match[2].toUpperCase(),
          name: (inside(objectAt, match[1].length) ? match[1] : match[2]).toUpperCase() };
      }
    }
    // NEW zcl_foo( ... ) is a call of its constructor, as in Eclipse.
    const newCall = /\bNEW\s+([A-Za-z_/$][A-Za-z0-9_/$]*)\s*\(/ig;
    while ((match = newCall.exec(line))) {
      const classAt = line.indexOf(match[1], match.index + 3);
      if (inside(classAt, match[1].length)) {
        return { kind: "constructor", object_type: "CLAS", object_name: match[1].toUpperCase(), name: match[1].toUpperCase() };
      }
    }
    const functionCall = /\bCALL\s+FUNCTION\s+['"]?([A-Za-z_/$][A-Za-z0-9_/$]*)/ig;
    while ((match = functionCall.exec(line))) {
      const nameAt = line.indexOf(match[1], match.index);
      if (inside(nameAt, match[1].length)) {
        return { kind: "function", object_type: "FUNC", object_name: match[1].toUpperCase(), name: match[1].toUpperCase() };
      }
    }
    return null;
  }
  function instanceClass(document, at, instance) {
    const source = document.getText();
    let declaration = localDeclaration(source, at.line, instance);
    if (!declaration) {
      const line = declarationLine(source, instance, at);
      if (line >= 0) {
        const lines = source.split(/\r?\n/);
        declaration = lines[line] || "";
        for (let next = line + 1; next < lines.length && !/\./.test(declaration); next++) declaration += " " + lines[next].trim();
      }
    }
    const type = declaration && new RegExp("\\b" + instance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "\\b\\s+TYPE\\s+REF\\s+TO\\s+([A-Za-z_/$][A-Za-z0-9_/$]*)\\b", "i").exec(declaration);
    return type && type[1].toUpperCase();
  }
  function classAnchor(document, at) {
    const line = document.getText().split(/\r?\n/)[at.line] || "";
    const pattern = /\b(?:TYPE\s+REF\s+TO|INHERITING\s+FROM)\s+([A-Za-z_/$][A-Za-z0-9_/$]*)\b/ig;
    let match;
    while ((match = pattern.exec(line))) {
      const from = line.indexOf(match[1], match.index);
      if (at.character >= from && at.character <= from + match[1].length) {
        return { kind: "class", object_type: "CLAS", object_name: match[1].toUpperCase(), name: match[1].toUpperCase() };
      }
    }
    return null;
  }
  async function saveSource(entry, source) {
    if (entry.saving) { throw new Error("This SAP object is already being saved."); }
    entry.saving = true;
    let draft;
    try {
      const transport = entry.data.package === "$TMP" ? "" : await vscode.window.showInputBox({
        title: "Transport request/task", value: entry.transport || "" });
      if (transport === undefined) { throw new Error("Save & Activate cancelled."); }
      const yes = await vscode.window.showWarningMessage(`Save & Activate ${entry.data.object_name} in ${entry.repo.label}?`,
        { modal: true, detail: "SAP will check syntax, save and activate the editor contents." }, "Save & Activate");
      if (yes !== "Save & Activate") { throw new Error("Save & Activate cancelled."); }
      draft = await entry.repo.api.execute("modify_sap_object", { ...entry.data,
        base_revision: entry.data.revision, source });
      const result = await entry.repo.api.apply(draft.change_id, { source, transport: transport.trim().toUpperCase() });
      entry.data = { ...entry.data, source, revision: result.revision, active_revision: result.revision };
      entry.transport = transport;
      vscode.window.showInformationMessage(entry.data.object_name + " saved and activated.");
      if (result.warning) { vscode.window.showWarningMessage(result.warning); }
    } finally {
      if (draft) { entry.repo.api.discard(draft.change_id); }
      entry.saving = false;
    }
  }
  async function acknowledgeSave(entry) {
    await rememberEditor(entry.document.uri, entry);
    if (revision(entry.document.getText()) !== entry.data.revision) { return; }
    entry.acknowledged = entry.data.revision;
    try { await entry.document.save(); }
    finally { entry.acknowledged = undefined; }
  }
  async function snapshot(source, title) {
    const uri = vscode.Uri.parse("vertex-source:/" + (++sequence) + "/" + encodeURIComponent(title) + ".abap");
    texts.set(uri.toString(), source);
    const document = await vscode.workspace.openTextDocument(uri);
    return vscode.languages.setTextDocumentLanguage(document, "abap");
  }
  async function sourceDocument(repo, args) {
    const data = await repo.api.execute("read_sap_object", args);
    let entry = [...opened.values()].find(e => e.repo === repo && e.data.object_url === data.object_url
      && e.data.include === data.include && e.document && !e.document.isClosed);
    if (!entry) {
      const system = require("crypto").createHash("sha256").update(repo.key).digest("hex").slice(0, 16);
      const uri = vscode.Uri.parse("vertex-sap:/" + system + "/" + data.object_type + "/"
        + encodeURIComponent(data.object_name) + (data.include === "main" ? "" : "." + data.include) + ".abap");
      entry = opened.get(uri.toString()) || { repo, data };
      if (entry.document && entry.document.isClosed) { entry.data = data; }
      opened.set(uri.toString(), entry);
      await rememberEditor(uri, entry);
      entry.document = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(entry.document, "abap");
    }
    return entry;
  }
  async function showSource(repo, args) {
    const entry = await sourceDocument(repo, args);
    await vscode.window.showTextDocument(entry.document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    return { opened: true, object_name: entry.data.object_name, object_type: entry.data.object_type,
      include: entry.data.include, system: repo.label, note: "Editable local buffer opened. No changes saved to SAP." };
  }
  async function methodCounterpart(document, at) {
    const entry = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document)
      || readOnly.get(document.uri.toString());
    if (!entry || entry.data.object_type !== "CLAS") { return undefined; }
    const anchor = methodAnchor(document, at);
    if (!anchor) { return undefined; }
    // A class main source already contains its global declaration and
    // implementation.  This is the normal VERTEX editor and navigation must
    // be instant there; do not make four ADT requests just to move a cursor.
    const wantedImplementation = anchor.call || !anchor.implementation;
    const localLine = methodLine(document.getText(), anchor.name, wantedImplementation);
    if (localLine >= 0 && localLine !== at.line) {
      const text = document.getText().split(/\r?\n/)[localLine];
      return { document, target: location(document.uri, localLine,
        Math.max(0, text.toUpperCase().indexOf(anchor.name)), anchor.name.length) };
    }
    if (anchor.call) { return undefined; }
    const include = anchor.implementation ? "definitions" : "implementations";
    const target = await sourceDocument(entry.repo, { object_type: "CLAS",
      object_name: entry.data.object_name, include });
    const line = methodLine(target.document.getText(), anchor.name, !anchor.implementation);
    if (line < 0) { return undefined; }
    const text = target.document.getText().split(/\r?\n/)[line];
    const column = text.toUpperCase().indexOf(anchor.name);
    return { document: target.document, target: location(target.document.uri, line,
      Math.max(0, column), anchor.name.length) };
  }
  async function externalCallTarget(document, at) {
    const current = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document)
      || readOnly.get(document.uri.toString());
    const call = current && (externalCallAnchor(document, at) || classAnchor(document, at));
    if (!call) { return undefined; }
    if (call.kind === "instance-method") {
      const objectName = instanceClass(document, at, call.instance);
      if (!objectName) { return undefined; }
      call.object_type = "CLAS";
      call.object_name = objectName;
      call.kind = "method";
    }
    const target = await sourceDocument(current.repo, { object_type: call.object_type, object_name: call.object_name });
    let line = 0, column = 0, length = call.object_name.length;
    // A class without its own constructor opens at its start.
    if (call.kind === "constructor" && methodLine(target.document.getText(), "CONSTRUCTOR", true) >= 0) {
      call.kind = "method"; call.method = "CONSTRUCTOR";
    }
    if (call.kind === "method") {
      line = methodLine(target.document.getText(), call.method, true);
      if (line < 0) { return undefined; }
      const text = target.document.getText().split(/\r?\n/)[line];
      column = Math.max(0, text.toUpperCase().indexOf(call.method)); length = call.method.length;
    }
    return { document: target.document, target: location(target.document.uri, line, column, length) };
  }
  async function externalMethodInformation(document, at) {
    const current = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document)
      || readOnly.get(document.uri.toString());
    const call = current && externalCallAnchor(document, at);
    if (!call || call.kind !== "method") { return undefined; }
    const key = current.repo.key + "|" + call.object_name + "|" + call.method;
    if (!externalSignatures.has(key)) {
      const resolve = async name => {
        const data = await current.repo.api.execute("read_sap_object", { object_type: "CLAS", object_name: name });
        const signature = methodSignature(data.source, call.method);
        if (signature) { return { signature, owner: name }; }
        const parent = /\bINHERITING\s+FROM\s+([A-Za-z_/$][A-Za-z0-9_/$]*)/i.exec(data.source);
        return parent ? resolve(parent[1].toUpperCase()) : null;
      };
      externalSignatures.set(key, resolve(call.object_name).catch(() => null));
    }
    const found = await externalSignatures.get(key);
    if (!found) { return undefined; }
    return { call, signature: found.signature, owner: found.owner };
  }
  async function inheritedMethodInformation(document, at) {
    const current = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document)
      || readOnly.get(document.uri.toString());
    const anchor = current && current.data.object_type === "CLAS" && methodAnchor(document, at);
    if (!anchor || methodSignature(document.getText(), anchor.name)) { return undefined; }
    const parent = /\bINHERITING\s+FROM\s+([A-Za-z_/$][A-Za-z0-9_/$]*)/i.exec(document.getText());
    if (!parent) { return undefined; }
    const key = current.repo.key + "|" + current.data.object_name + "|" + anchor.name + "|inherited";
    if (!externalSignatures.has(key)) {
      const resolve = async name => {
        const data = await current.repo.api.execute("read_sap_object", { object_type: "CLAS", object_name: name });
        const signature = methodSignature(data.source, anchor.name);
        if (signature) { return { signature, owner: name }; }
        const next = /\bINHERITING\s+FROM\s+([A-Za-z_/$][A-Za-z0-9_/$]*)/i.exec(data.source);
        return next ? resolve(next[1].toUpperCase()) : null;
      };
      externalSignatures.set(key, resolve(parent[1].toUpperCase()).catch(() => null));
    }
    const found = await externalSignatures.get(key);
    return found && { anchor, signature: found.signature, owner: found.owner };
  }
  function selectTarget(editor, target) {
    const start = target.range.start, end = target.range.end;
    editor.selection = vscode.Selection ? new vscode.Selection(start, end) : { start, end, active: end };
    if (typeof editor.revealRange === "function") {
      editor.revealRange(target.range, vscode.TextEditorRevealType && vscode.TextEditorRevealType.InCenter);
    }
  }
  async function moveTo(editor, result) {
    navigation.push({ document: editor.document, at: editor.selection.active });
    // Keep a clean source flow in one editor group.  A dirty SAP buffer is
    // never replaced: the destination opens beside it so the user can save
    // or discard the pending change deliberately.
    const clean = !editor.document.isDirty;
    const target = result.document === editor.document ? editor : await vscode.window.showTextDocument(result.document, {
      preview: clean,
      viewColumn: clean ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside
    });
    if (target) { selectTarget(target, result.target); }
  }
  async function goBack() {
    const previous = navigation.pop();
    if (!previous) {
      vscode.window.showInformationMessage("VERTEX: there is no previous VERTEX navigation position.");
      return;
    }
    const activeEditor = vscode.window.activeTextEditor;
    const clean = !activeEditor || !activeEditor.document.isDirty;
    const editor = previous.document === (activeEditor && activeEditor.document)
      ? activeEditor : await vscode.window.showTextDocument(previous.document, {
        preview: clean,
        viewColumn: clean ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside
      });
    if (editor) { selectTarget(editor, { range: range(previous.at.line, previous.at.character, previous.at.character) }); }
  }
  // QUIET is a double-click: a word SAP knows nothing about - a keyword - is
  // simply selected, not answered with a message.
  async function goToClassMethod(chosenEditor, chosenPosition, quiet) {
    const editor = chosenEditor || vscode.window.activeTextEditor;
    const at = chosenPosition || (editor && editor.selection && editor.selection.active);
    if (!editor || !at) { return; }
    // F12 walks the branches; the double-click (QUIET) jumps to the end.
    const structure = structuralTarget(editor.document, at, !quiet);
    if (structure) { await moveTo(editor, structure); return; }
    const method = await methodCounterpart(editor.document, at);
    const variable = method ? undefined : await adtDefinition(editor.document, at);
    // Standing on the definition itself: going to it again means going back.
    if (variable && variable.target.range.start.line === at.line && navigation.length) { await goBack(); return; }
    const result = method || (variable && variable.target.range.start.line !== at.line ? variable : undefined)
      || await externalCallTarget(editor.document, at) || await adtForeignDefinition(editor.document, at);
    if (!result) {
      if (quiet) { return; }
      vscode.window.showInformationMessage("VERTEX: place the cursor on a method, variable, static class call or CALL FUNCTION name.");
      return;
    }
    await moveTo(editor, result);
  }
  context.subscriptions.push(vscode.commands.registerCommand("vertex.goToClassMethod", () =>
    goToClassMethod().catch(error => vscode.window.showErrorMessage("VERTEX: " + error.message))));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.navigateBack", () =>
    goBack().catch(error => vscode.window.showErrorMessage("VERTEX: " + error.message))));
  // VS Code exposes double-click as a mouse selection of exactly one word.
  // It does not supply a click count, so this is intentionally kept narrow:
  // only a complete identifier selection may start contextual navigation.
  if (typeof vscode.window.onDidChangeTextEditorSelection === "function") {
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
      const mouse = vscode.TextEditorSelectionChangeKind && vscode.TextEditorSelectionChangeKind.Mouse;
      const selection = event && event.selections && event.selections.length === 1 && event.selections[0];
      if (!mouse || !event || event.kind !== mouse || !selection || selection.isEmpty
        || (event.textEditor.document.uri.scheme !== "vertex-sap"
          && !readOnly.has(event.textEditor.document.uri.toString()))) { return; }
      const anchor = structuralAnchor(event.textEditor.document, selection.active)
        || methodAnchor(event.textEditor.document, selection.active)
        || wordAt(event.textEditor.document, selection.active)
        || externalCallAnchor(event.textEditor.document, selection.active)
        || classAnchor(event.textEditor.document, selection.active);
      if (!anchor || event.textEditor.document.getText(selection).toUpperCase() !== String(anchor.name).toUpperCase()) { return; }
      goToClassMethod(event.textEditor, selection.active, true)
        .catch(error => vscode.window.showErrorMessage("VERTEX: " + error.message));
    }));
  }
  /* The tab's structure for Outline, Ctrl+Shift+O, breadcrumbs and sticky
     scroll, from the text itself - saved or not, no SAP request. A class is
     its sections with their methods, each method leading to its
     implementation; a program is its events, forms, modules and local
     classes. */
  const EVENT = /^(LOAD-OF-PROGRAM|INITIALIZATION|START-OF-SELECTION|END-OF-SELECTION|TOP-OF-PAGE(?: DURING LINE-SELECTION)?|END-OF-PAGE|AT SELECTION-SCREEN(?: OUTPUT| ON [\w-]+(?: [\w-]+)?)?|AT LINE-SELECTION|AT USER-COMMAND|AT PF\d+)\s*\.?$/i;
  function outline(source) {
    const kinds = vscode.SymbolKind || { Class: 4, Method: 5, Interface: 10, Function: 11, Namespace: 2, Event: 23 };
    const lines = source.split(/\r?\n/);
    // A plain tree first; VS Code's ranges are immutable, so they are made last.
    const node = (name, detail, kind, start, end) => ({ name, detail, kind, start, end, at: start, children: [] });
    const result = [], classes = new Map();
    let owner, section, block, event;
    const closeEvent = line => { if (event) { event.end = Math.max(event.start, line - 1); event = undefined; } };
    for (const statement of abapStatements(source)) {
      const text = statement.text.replace(/\.$/, "");
      let hit;
      if ((hit = /^CLASS\s+([\w/]+)\s+DEFINITION\b(.*)$/i.exec(text))) {
        if (/\b(?:DEFERRED|LOAD)\b/i.test(hit[2])) { continue; }
        closeEvent(statement.start);
        const key = hit[1].toUpperCase();
        owner = classes.get(key);
        if (!owner) { owner = { item: node(hit[1], "", kinds.Class, statement.start, statement.end), methods: new Map() }; classes.set(key, owner); result.push(owner.item); }
        section = undefined; continue;
      }
      if ((hit = /^INTERFACE\s+([\w/]+)(.*)$/i.exec(text))) {
        if (/\b(?:DEFERRED|LOAD)\b/i.test(hit[2])) { continue; }
        closeEvent(statement.start);
        owner = { item: node(hit[1], "", kinds.Interface, statement.start, statement.end), methods: new Map() };
        result.push(owner.item); section = owner.item; continue;
      }
      if ((hit = /^CLASS\s+([\w/]+)\s+IMPLEMENTATION$/i.exec(text))) {
        closeEvent(statement.start);
        const key = hit[1].toUpperCase();
        owner = classes.get(key);
        if (!owner) { owner = { item: node(hit[1], "", kinds.Class, statement.start, statement.end), methods: new Map() }; classes.set(key, owner); result.push(owner.item); }
        section = undefined; continue;
      }
      if (owner && /^END(?:CLASS|INTERFACE)$/i.test(text)) {
        owner.item.end = Math.max(owner.item.end, statement.end); owner = undefined; section = undefined; continue;
      }
      if (owner && (hit = /^(PUBLIC|PROTECTED|PRIVATE)\s+SECTION$/i.exec(text))) {
        section = node(hit[1].toUpperCase() + " SECTION", "", kinds.Namespace, statement.start, statement.end);
        owner.item.children.push(section); continue;
      }
      if (owner && section && (hit = /^(?:CLASS-)?METHODS\s*:?\s*([\s\S]*)$/i.exec(text))) {
        for (const member of splitChain(hit[1])) {
          const name = /^([\w/~]+)/.exec(member);
          if (!name) { continue; }
          const item = node(name[1], "", kinds.Method, statement.start, statement.end);
          section.children.push(item); owner.methods.set(name[1].toUpperCase(), item);
        }
        continue;
      }
      if (owner && (hit = /^METHOD\s+([\w/~]+)$/i.exec(text))) { block = { owner, name: hit[1], start: statement.start }; continue; }
      if (block && block.owner && /^ENDMETHOD$/i.test(text)) {
        // A method leads to its implementation.
        const known = block.owner.methods.get(block.name.toUpperCase());
        if (known) { known.start = known.at = block.start; known.end = statement.end; }
        else { block.owner.item.children.push(node(block.name, "", kinds.Method, block.start, statement.end)); }
        block = undefined; continue;
      }
      if (!owner && !block && (hit = /^(FORM|MODULE|FUNCTION)\s+([\w/]+)/i.exec(text))) {
        closeEvent(statement.start);
        block = { kind: hit[1].toLowerCase(), name: hit[2], start: statement.start }; continue;
      }
      if (block && !block.owner && /^END(?:FORM|MODULE|FUNCTION)$/i.test(text)) {
        result.push(node(block.name, block.kind, kinds.Function, block.start, statement.end));
        block = undefined; continue;
      }
      if (!owner && !block && EVENT.test(text)) {
        closeEvent(statement.start);
        event = node(text.toUpperCase().replace(/\s+/g, " "), "event", kinds.Event, statement.start, statement.end);
        result.push(event);
      }
    }
    closeEvent(lines.length);
    const make = item => {
      const children = item.children.map(make);
      // A parent covers its children: a section's methods live in the implementation.
      const start = Math.min(item.start, ...children.map(child => child.range.start.line));
      const end = Math.max(item.end, ...children.map(child => child.range.end.line));
      const text = lines[item.at] || "", column = Math.max(0, text.toUpperCase().indexOf(item.name.toUpperCase().split(" ")[0]));
      const full = vscode.Range ? new vscode.Range(position(start, 0), position(end, (lines[end] || "").length))
        : { start: position(start, 0), end: position(end, (lines[end] || "").length) };
      const chosen = range(item.at, column, Math.min(text.length, column + item.name.length));
      const symbol = vscode.DocumentSymbol ? new vscode.DocumentSymbol(item.name, item.detail, item.kind, full, chosen)
        : { name: item.name, detail: item.detail, kind: item.kind, range: full, selectionRange: chosen };
      symbol.children = children;
      return symbol;
    };
    return result.map(make);
  }
  if (vscode.languages && typeof vscode.languages.registerDocumentSymbolProvider === "function") {
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
      [{ scheme: "vertex-sap", language: "abap" }, { scheme: "vertex-source", language: "abap" }],
      { provideDocumentSymbols: document => outline(document.getText()) }));
  }
  if (vscode.languages && typeof vscode.languages.registerDefinitionProvider === "function") {
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
      [{ scheme: "vertex-sap", language: "abap" }, { scheme: "vertex-source", language: "abap" }], {
        async provideDefinition(document, at) {
          const result = structuralTarget(document, at, true) || await methodCounterpart(document, at)
            || await externalCallTarget(document, at);
          return result && result.target;
        }
      }));
  }
  // Only identifiers that resolve as methods may trigger signature lookups.
  if (vscode.languages && typeof vscode.languages.registerHoverProvider === "function") {
    context.subscriptions.push(vscode.languages.registerHoverProvider(
      [{ scheme: "vertex-sap", language: "abap" }, { scheme: "vertex-source", language: "abap" }], {
        async provideHover(document, at) {
          const method = methodInformation(document, at);
          if (method) {
            const target = range(at.line, method.anchor.from, method.anchor.to);
            return vscode.Hover ? new vscode.Hover([{ language: "abap", value: method.signature }], target)
              : { contents: [{ language: "abap", value: method.signature }], range: target };
          }
          // Variables, parameters, attributes, types: what the ABAP compiler
          // says about the name, through ADT - no guessing from the text.
          let element, declared, dataType;
          try {
            element = await adtAsk("info", document, at);
            declared = await adtDeclaration(document, at);
            if (!declared) { const foreign = await adtForeign(document, at); declared = foreign && foreign.text; }
            if (!declared && element && element.answer && element.answer.type === "DTEL/DE") {
              dataType = describeDataElement(await dataElementOf(element.source.entry.repo, element.answer.name));
            }
          } catch (error) {
            // Said in the hover: VS Code drops a provider's error in silence.
            const value = "VERTEX: SAP could not describe this name - " + (error && error.message || error);
            return vscode.Hover ? new vscode.Hover([{ language: "text", value }]) : { contents: [{ language: "text", value }] };
          }
          // What the element is, from SAP; how it is declared, from the line
          // SAP's navigation points at - the element info carries no type.
          const kind = element && element.answer && typeof element.answer === "object" && ELEMENT_KINDS[element.answer.type];
          const described = declared ? (kind ? kind + ": " : "") + declared
            : element && describeElement(element.answer, dataType);
          if (described) {
            const target = range(at.line, element.word.from, element.word.to);
            return vscode.Hover ? new vscode.Hover([{ language: "abap", value: described }], target)
              : { contents: [{ language: "abap", value: described }], range: target };
          }
          const inherited = await inheritedMethodInformation(document, at);
          if (inherited) {
            const value = "Declared in " + inherited.owner + "\n\n" + inherited.signature;
            return vscode.Hover ? new vscode.Hover([{ language: "abap", value }], range(at.line, inherited.anchor.from, inherited.anchor.to))
              : { contents: [{ language: "abap", value }], range: range(at.line, inherited.anchor.from, inherited.anchor.to) };
          }
          const external = await externalMethodInformation(document, at);
          if (!external) { return undefined; }
          const value = "Declared in " + external.owner + "\n\n" + external.signature;
          return vscode.Hover ? new vscode.Hover([{ language: "abap", value }])
            : { contents: [{ language: "abap", value }] };
        }
      }));
  }
  async function showDraft(repo, draft) {
    const before = await snapshot(draft.original_source, draft.object_name + "-before");
    const document = await vscode.workspace.openTextDocument({ language: "abap", content: draft.source });
    drafts.set(draft.change_id, { repo, draft, document, before });
    await vscode.commands.executeCommand("vscode.diff", before.uri, document.uri,
      `${repo.label}: ${draft.object_name} (draft — not saved to SAP)`, { preview: false });
    vscode.window.showInformationMessage("Edit the draft, then use VERTEX: Apply SAP Code Draft to check and save it.");
    await openReview({ document }, { repo, document, data: { ...draft,
      source: draft.original_source, revision: draft.base_revision } }, draft);
  }
  async function reviewActive() {
    const editor = vscode.window.activeTextEditor;
    const entry = editor && opened.get(editor.document.uri.toString());
    if (!entry) { throw new Error("Open a SAP object first."); }
    entry.document = editor.document;
    return openReview(editor, entry);
  }
  async function openReview(editor, entry, prepared) {
    const after = editor.document.getText();
    const parts = hunks(entry.data.source, after);
    if (!parts.length) { return { opened: false, message: "There are no changes to review." }; }
    const panel = vscode.window.createWebviewPanel("vertex.review", "Review " + entry.data.object_name,
      vscode.ViewColumn.Beside, { enableScripts: true });
    panel.webview.html = require('./code-review').reviewHtml(parts, { before: entry.data.source,
      after: editor.document.getText(), objectName: entry.data.object_name, objectType: entry.data.object_type,
      system: entry.repo.label, ai: !!prepared });
    const base = entry.data.source, baseRevision = entry.data.revision;
    let applying = false, finished = false;
    panel.webview.onDidReceiveMessage(async message => {
      if (message && message.action === "ask" && Number.isInteger(message.hunk) && parts[message.hunk]) {
        await vscode.commands.executeCommand("vertex.askReviewBlock",
          askPrompt(parts[message.hunk], after, entry.repo.label, entry.data.object_name));
        return;
      }
      if (!message || message.action !== "apply") { return; }
      if (applying || finished) { return; }
      applying = true;
      let draft;
      try {
      if (entry.saving || entry.data.revision !== baseRevision) { throw new Error("SAP editor base changed. Open a new review before applying."); }
      const approved = Array.isArray(message.approved) ? [...new Set(message.approved.filter(i => Number.isInteger(i) && i >= 0 && i < parts.length))] : [];
      if (!approved.length) { throw new Error("Approve at least one block."); }
      if (prepared && prepared.operation === "create" && approved.length !== parts.length) {
        throw new Error("Approve all blocks to create a new SAP object.");
      }
      const source = reviewedSource(base, parts, approved);
      draft = prepared || await entry.repo.api.execute("modify_sap_object", { ...entry.data,
        base_revision: baseRevision, source });
      const local = entry.data.package === "$TMP";
      const transport = local ? "" : await vscode.window.showInputBox({ title: "Transport request/task", value: draft.transport || "" });
      if (transport === undefined) { await panel.webview.postMessage({ action: "cancelled" }); return; }
      const yes = await vscode.window.showWarningMessage("Apply " + approved.length + " reviewed hunk(s) to " + entry.data.object_name + "?",
        { modal: true, detail: "SAP will check syntax, save and activate." }, "Apply");
      if (yes !== "Apply") { await panel.webview.postMessage({ action: "cancelled" }); return; }
      if (entry.saving || entry.data.revision !== baseRevision) { throw new Error("SAP editor base changed. Open a new review before applying."); }
      const result = await entry.repo.api.apply(draft.change_id, { source, transport: transport.trim().toUpperCase() });
      finished = true;
      // The open editor may still contain declined hunks. Move its SAP base
      // forward only to the reviewed source, so a later review shows exactly
      // the unsaved remainder rather than offering saved hunks again.
      entry.data.source = source;
      entry.data.revision = result.revision;
      entry.data.active_revision = result.revision;
      if (entry.document.uri.scheme === "vertex-sap") { await acknowledgeSave(entry); }
      if (prepared) { drafts.delete(prepared.change_id); }
      await panel.webview.postMessage({ action: "saved", approved });
      vscode.window.showInformationMessage(entry.data.object_name + " saved and activated.");
      if (result.warning) { vscode.window.showWarningMessage(result.warning); }
      } catch (error) {
        const detail = String(error && error.message || error);
        await panel.webview.postMessage({ action: "error", message: detail });
        vscode.window.showErrorMessage("VERTEX: " + detail);
      } finally {
        applying = false;
        if (draft && (!prepared || finished)) { entry.repo.api.discard(draft.change_id); }
      }
    });
    return { opened: true, hunks: parts.length, message: "Review opened with " + parts.length + " hunk(s)." };
  }
  function command(id, callback) {
    // Most commands remain internal; Save & Activate is also exposed in the editor.
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try { return await callback(); }
      catch (error) { vscode.window.showErrorMessage("VERTEX: " + String(error.message || error).slice(0, 3000)); }
    }));
  }
  command("vertex.searchCode", async () => {
    const query = await vscode.window.showInputBox({ title: "Search SAP code", prompt: "Program, class or function module name; * and + wildcards supported" });
    if (!query) { return; }
    const repo = await repository();
    const result = await repo.api.execute("search_sap_objects", { query, limit: 100 });
    if (!result.objects.length) { vscode.window.showInformationMessage("No matching SAP objects."); return; }
    const picked = await vscode.window.showQuickPick(result.objects.map(object => ({
      label: object.object_name, description: object.object_type + " " + object.package,
      detail: object.description, object
    })), { title: result.truncated ? "First 100 matches — refine the pattern for more" : "Open SAP source" });
    if (picked) { await showSource(repo, picked.object); }
  });
  command("vertex.readCode", async () => {
    const object_type = await vscode.window.showQuickPick(Object.keys(TYPES), { title: "SAP object type" });
    if (!object_type) { return; }
    const object_name = await vscode.window.showInputBox({ title: "SAP object name" });
    if (object_name) { await showSource(await repository(), { object_type, object_name }); }
  });
  command("vertex.editCode", async () => {
    const editor = vscode.window.activeTextEditor;
    const current = editor && opened.get(editor.document.uri.toString());
    if (!current) { throw new Error("Open an object with VERTEX: Search SAP Code or Read SAP Code first."); }
    const draft = await current.repo.api.execute("modify_sap_object", {
      ...current.data, base_revision: current.data.revision, source: current.data.source
    });
    await showDraft(current.repo, draft);
  });
  command("vertex.reviewCodeChanges", reviewActive);
  // ABAP Unit in VS Code's Test Explorer: object, then its test classes, then
  // their methods, as the ABAP Unit view shows them in Eclipse.
  const tests = vscode.tests.createTestController("vertexAbapUnit", "ABAP Unit");
  const testedObjects = new Map();
  context.subscriptions.push(tests);
  // A stack line points at an include and a line: /sap/bc/adt/oo/classes/zcl_x/includes/testclasses#start=19,0.
  async function failureLocation(repo, uri) {
    const found = /^\/sap\/bc\/adt\/(oo\/classes|programs\/programs)\/([^/#]+)(?:\/includes\/(\w+))?[^#]*#.*?start=(\d+)(?:,(\d+))?/
      .exec(String(uri || ""));
    if (!found) { return undefined; }
    const object_type = found[1] === "oo/classes" ? "CLAS" : "PROG";
    const include = found[3] || "main";
    if (object_type === "PROG" && include !== "main") { return undefined; }
    const entry = await sourceDocument(repo, { object_type, include,
      object_name: decodeURIComponent(found[2]).toUpperCase() });
    return new vscode.Location(entry.document.uri, position(Number(found[4]) - 1, Number(found[5] || 0)));
  }
  async function alertMessage(repo, alert) {
    const message = new vscode.TestMessage([alert.title, ...(alert.details || [])].filter(Boolean).join("\n"));
    for (const frame of alert.stack || []) {
      message.location = await failureLocation(repo, frame["adtcore:uri"]);
      if (message.location) { break; }
    }
    return message;
  }
  async function runTests(request, token) {
    const roots = new Set();
    for (const item of request.include || [...tests.items].map(([, item]) => item)) {
      let root = item;
      while (root.parent) { root = root.parent; }
      roots.add(root);
    }
    const run = tests.createTestRun(request);
    try {
      for (const root of roots) {
        if (token.isCancellationRequested) { break; }
        const { repo, data } = testedObjects.get(root.id);
        run.enqueued(root);
        const classes = await repo.api.unitTests(data.object_url);
        root.children.replace([]);
        if (!classes.length) {
          run.errored(root, new vscode.TestMessage(data.object_name + " has no test classes that SAP ran."));
          continue;
        }
        for (const clas of classes) {
          const classItem = tests.createTestItem(root.id + "/" + clas["adtcore:name"], clas["adtcore:name"]);
          root.children.add(classItem);
          if (clas.alerts.length) {
            run.errored(classItem, await Promise.all(clas.alerts.map(alert => alertMessage(repo, alert))));
          }
          for (const method of clas.testmethods) {
            const methodItem = tests.createTestItem(classItem.id + "/" + method["adtcore:name"], method["adtcore:name"].toLowerCase());
            classItem.children.add(methodItem);
            const duration = Math.round(Number(method.executionTime || 0) * 1000);
            if (method.alerts.length) {
              run.failed(methodItem, await Promise.all(method.alerts.map(alert => alertMessage(repo, alert))), duration);
            } else { run.passed(methodItem, duration); }
          }
        }
      }
    } catch (error) {
      run.appendOutput(String(error.message || error).replace(/\r?\n/g, "\r\n") + "\r\n");
      vscode.window.showErrorMessage("VERTEX: ABAP Unit: " + String(error.message || error).slice(0, 3000));
    } finally { run.end(); }
  }
  tests.createRunProfile("Run", vscode.TestRunProfileKind.Run, runTests, true);
  // The object comes from the active tab, or - from View source - by name,
  // in which case its tab is opened (not shown) to carry the failure links.
  async function unitTestsOf(object) {
    let entry, document;
    if (object) {
      entry = await sourceDocument(await repository(), { object_name: object.object_name, object_type: object.object_type });
      document = entry.document;
    } else {
      document = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
      if (!document || document.uri.scheme !== "vertex-sap") { throw new Error("Open a SAP source tab first."); }
      entry = await fileEntry(document.uri);
    }
    if (!["CLAS", "PROG"].includes(entry.data.object_type)) { throw new Error("ABAP Unit runs for a class or a program."); }
    if (document.isDirty) { throw new Error("The tab has changes that are not in SAP. Save & Activate first: ABAP Unit runs the active source."); }
    const id = entry.repo.key + "|" + entry.data.object_url;
    let root = tests.items.get(id);
    if (!root) {
      root = tests.createTestItem(id, entry.data.object_name, document.uri);
      root.description = entry.data.object_type + " · " + entry.repo.label;
      tests.items.add(root);
    }
    testedObjects.set(id, { repo: entry.repo, data: entry.data });
    await vscode.commands.executeCommand("workbench.view.testing.focus");
    const cancel = new vscode.CancellationTokenSource();
    try { await runTests(new vscode.TestRunRequest([root]), cancel.token); } finally { cancel.dispose(); }
  }
  command("vertex.runUnitTests", () => unitTestsOf());
  command("vertex.saveAndActivate", async () => {
    const document = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
    if (!document || document.uri.scheme !== "vertex-sap") { throw new Error("Open a SAP source tab first."); }
    const entry = await fileEntry(document.uri);
    entry.document = document;
    if (document.isDirty) { await document.save(); }
    else {
      await saveSource(entry, document.getText());
      await rememberEditor(document.uri, entry);
    }
  });
  command("vertex.readClassInclude", async () => {
    const editor = vscode.window.activeTextEditor;
    const current = editor && opened.get(editor.document.uri.toString());
    if (!current || current.data.object_type !== "CLAS") { throw new Error("Open a class with VERTEX first."); }
    const include = await vscode.window.showQuickPick(current.data.includes, { title: "Class source include" });
    if (include) { await showSource(current.repo, { ...current.data, include }); }
  });
  command("vertex.createCode", async () => {
    const object_type = await vscode.window.showQuickPick(Object.keys(TYPES).filter(kind => kind !== "INTF"), { title: "Create SAP object draft" });
    if (!object_type) { return; }
    const object_name = await vscode.window.showInputBox({ title: "New SAP object name" });
    if (!object_name) { return; }
    const parent = await vscode.window.showInputBox({ title: object_type === "FUNC" ? "Existing function group" : "SAP package", value: object_type === "FUNC" ? "" : "$TMP" });
    if (!parent) { return; }
    const description = await vscode.window.showInputBox({ title: "Object description (up to 60 characters)" });
    if (!description) { return; }
    const upper = object_name.toUpperCase();
    const source = object_type === "PROG" ? `REPORT ${upper}.\n`
      : object_type === "FUNC" ? `FUNCTION ${upper}.\n\nENDFUNCTION.\n`
      : `CLASS ${upper} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\n\nCLASS ${upper} IMPLEMENTATION.\nENDCLASS.\n`;
    const repo = await repository();
    const draft = await repo.api.execute("create_sap_object", { object_type, object_name,
      package: parent, function_group: parent, description, source });
    await showDraft(repo, draft);
  });
  async function selectDraft() {
    const current = vscode.window.activeTextEditor;
    const selected = current && [...drafts.values()].find(d => d.document.uri.toString() === current.document.uri.toString());
    if (selected) { return selected; }
    const picked = await vscode.window.showQuickPick([...drafts.values()].map(d => ({
      label: d.draft.object_name, description: d.repo.label, draft: d
    })), { title: "Select SAP code draft" });
    return picked && picked.draft;
  }
  command("vertex.applyCodeDraft", async () => {
    const selected = await selectDraft();
    if (!selected) { return; }
    const { repo, draft, document, before } = selected;
    if (document.isClosed) { throw new Error("Draft editor was closed. Read SAP and prepare a new draft."); }
    await vscode.commands.executeCommand("vscode.diff", before.uri, document.uri,
      `${repo.label}: ${draft.object_name} — review before applying`);
    const transport = await vscode.window.showInputBox({ title: "Transport request/task",
      prompt: "Leave blank for a local object or an existing SAP lock assignment", value: draft.transport || "" });
    if (transport === undefined) { return; }
    const source = document.getText(), version = document.version;
    const approved = await vscode.window.showWarningMessage(
      `Apply ${draft.operation} of ${draft.object_type} ${draft.object_name} to ${repo.label}?`,
      { modal: true, detail: "SAP will check syntax, save and activate. A failed creation may leave an inactive object to inspect." }, "Apply");
    if (approved !== "Apply") { return; }
    if (document.version !== version || document.isClosed) { throw new Error("Draft changed during confirmation. Review it again."); }
    const result = await repo.api.apply(draft.change_id, { source, transport: transport.trim().toUpperCase() });
    drafts.delete(draft.change_id);
    repo.api.discard(draft.change_id);
    vscode.window.showInformationMessage(`${draft.object_name} saved and activated in ${repo.label}.`);
    if (result.warning) { vscode.window.showWarningMessage(result.warning); }
  });
  command("vertex.discardCodeDraft", async () => {
    const selected = await selectDraft();
    if (selected) { selected.repo.api.discard(selected.draft.change_id); drafts.delete(selected.draft.change_id); }
  });
  context.subscriptions.push({ dispose() {
    for (const repo of repositories.values()) { void repo.api.dispose().catch(() => {}); }
    repositories.clear(); texts.clear(); opened.clear(); drafts.clear();
  } });
  // Host/agent interface: create/modify only PREPARE and open a diff. Apply is UI-only.
  return { schemas, onEvent: events.on, runUnitTests: unitTestsOf,
    editorContext() {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document) { return null; }
      const selection = editor.selection;
      const selected = selection && !selection.isEmpty && selection.start && selection.end
        ? editor.document.getText(selection).trim() : "";
      const selected_fragment = selected ? {
        text: selected.slice(0, 64000),
        path: editor.document.uri.scheme === "file" ? editor.document.uri.fsPath : editor.document.uri.toString(),
        language: editor.document.languageId || "",
        start_line: selection.start.line + 1,
        end_line: selection.end.line + 1
      } : null;
      const entry = opened.get(editor.document.uri.toString());
      // An ADT editor tab is owned by another extension, so it is not in
      // `opened`. Its complete source remains private to that editor; an
      // explicit selection is nevertheless exactly what the user asked chat
      // about and is safe, useful context to hand over.
      if (!entry) { return selected_fragment ? { selected_fragment } : null; }
      return { system: entry.repo.label, system_name: JSON.parse(entry.repo.key)[3], object_name: entry.data.object_name,
        object_type: entry.data.object_type, include: entry.data.include,
        base_revision: entry.data.revision, source: editor.document.getText(), selected_fragment };
    },
    get instructions() {
      const names = systems().map(s => s.name);
      const current = active();
      const own = pinned ? pinned() : "";
      return require("fs").readFileSync(require("path").join(__dirname, "prompts/tools/sap-code.md"), "utf8")
        + "\n\nConfigured SAP systems: " + (names.join(", ") || "none") + ". "
        + (own ? "This chat belongs to a VERTEX Tools window on " + own + " and works with that system only."
               : "Active system: " + (current.error ? "none" : current.system.name) + ".");
    },
    async execute(tool, args) {
      const { system, ...rest } = args || {};
      if (!system) { return run(tool, rest); }
      const wanted = String(system).trim();
      const names = systems().map(s => s.name);
      const found = names.find(n => n.toUpperCase() === wanted.toUpperCase());
      if (!found) { throw new Error("There is no SAP system " + wanted + ". Configured: " + names.join(", ") + "."); }
      // A Tools window's chat stays on the window's system.
      const own = pinned ? pinned() : "";
      if (own && own !== found) { throw new Error("This window works with " + own + " only; ask in the VERTEX panel's chat to reach " + found + "."); }
      return pin(found, () => run(tool, rest));
    } };
  async function run(tool, args) {
    const repo = await repository();
    if (tool === "open_sap_object") { return showSource(repo, args); }
    if (tool === "review_sap_changes") { return reviewActive(); }
    const result = await repo.api.execute(tool, args);
    // A change to an existing object goes into its tab, unsaved, like an edit
    // of the user's own; saving it - Save & Activate or Review & Activate - is
    // the user's step. A new object has no tab yet and stays a draft.
    if (result.change_id && result.operation === "modify") { return changeInTab(repo, result); }
    if (result.change_id) { await showDraft(repo, result); }
    return result;
  }
  async function changeInTab(repo, draft) {
    repo.api.discard(draft.change_id);
    const entry = await sourceDocument(repo, { object_type: draft.object_type,
      object_name: draft.object_name, include: draft.include });
    const document = entry.document;
    const flat = text => String(text).replace(/\r\n/g, "\n");
    // Unsaved edits in the tab that SAP does not have would be replaced by a
    // change written against the SAP source: refused rather than lost.
    if (flat(document.getText()) !== flat(draft.original_source)) {
      throw new Error("The tab of " + draft.object_name + " has changes that are not in SAP. The change was not applied: "
        + "save or undo them first, then ask again.");
    }
    const edit = new vscode.WorkspaceEdit();
    const lines = document.getText().split(/\r?\n/);
    edit.replace(document.uri, new vscode.Range(position(0, 0),
      position(lines.length - 1, lines[lines.length - 1].length)), draft.source);
    if (!await vscode.workspace.applyEdit(edit)) { throw new Error("VS Code did not apply the change to the tab of " + draft.object_name + "."); }
    await vscode.window.showTextDocument(document, { preview: false });
    return { changed_in_tab: true, object_name: draft.object_name, object_type: draft.object_type, include: draft.include,
      system: repo.label, note: "The change is in the editor tab and not saved to SAP. The user saves it with Save & Activate or Review & Activate, or undoes it." };
  }
}
module.exports = { register };
