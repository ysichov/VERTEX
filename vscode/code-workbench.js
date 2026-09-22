"use strict";

const { createRepository, TYPES, revision } = require("./sap-code");
const { hunks, reviewedSource, askPrompt } = require("./code-review");
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
}]);

function register(vscode, context, { active, password }) {
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
  function structuralTarget(document, at) {
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
      targets.set(frame.start.index, frame.branches[0] || end);
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
  function parameterDeclaration(source, method, parameter) {
    for (const statement of abapStatements(source)) {
      if (!/^(?:CLASS-)?METHODS\b|^FORM\b/i.test(statement.text)) continue;
      const isForm = /^FORM\b/i.test(statement.text);
      const members = isForm ? [statement.text.replace(/^FORM\s+/i, "")] : splitChain(statement.text.replace(/^(?:CLASS-)?METHODS\s*:?\s*/i, ""));
      for (const member of members) {
        const name = /^\s*([\w/~]+)/.exec(member);
        if (!name || name[1].toUpperCase() !== method.toUpperCase()) continue;
        const parameters = /(?:!?(\w+)|(?:VALUE|REFERENCE)\s*\(\s*!?(\w+)\s*\))\s+(TYPE|LIKE)\s+([\s\S]*?)(?=\s+(?:!?\w+|(?:VALUE|REFERENCE)\s*\(\s*!?\w+\s*\))\s+(?:TYPE|LIKE)\b|\s+(?:IMPORTING|EXPORTING|CHANGING|RETURNING|RAISING|EXCEPTIONS)\b|$)/gi;
        let match;
        while ((match = parameters.exec(member))) {
          if ((match[1] || match[2]).toUpperCase() === parameter.toUpperCase()) {
            return (match[1] || match[2]) + " " + match[3].toUpperCase() + " " + match[4].replace(/\s+/g, " ").replace(/\.$/, "").trim();
          }
        }
      }
    }
    return undefined;
  }
  function variableAnchor(document, at) {
    const line = document.getText().split(/\r?\n/)[at.line] || "";
    const word = /[A-Za-z0-9_<>]/;
    let from = Math.min(at.character, line.length), to = from;
    while (from > 0 && word.test(line.charAt(from - 1))) { from--; }
    while (to < line.length && word.test(line.charAt(to))) { to++; }
    const name = line.slice(from, to);
    // Restrict this first resolver to ABAP's conventional variable prefixes.
    // It avoids turning every keyword or table component into a false jump.
    // Both common ABAP parameter conventions are valid: `iv_text` and the
    // shorter `i_text` / `e_text` / `c_text` used especially by FORMs and
    // older code.  They must be resolved before falling back to VS Code's
    // generic word hover.
    if (!/^(?:(?:[ilrmtg][vstor])|(?:[cgs][vstor])|[iecrpt]|ty|tt|ts)_[A-Za-z0-9_]+$/i.test(name)
      && !/^<[A-Za-z_][A-Za-z0-9_]*>$/.test(name)) { return null; }
    return { name: name.toUpperCase(), from, to };
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
  function variableType(line, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const typed = line.match(new RegExp("\\b" + escaped + "\\b\\s+(TYPE|LIKE)\\s+(.+?)(?:\\s+(?:VALUE|READ-ONLY)\\b|\\.)", "i"));
    if (typed) { return typed[2].trim(); }
    if (new RegExp("\\b(?:DATA|FINAL)\\s*\\(\\s*" + escaped + "\\s*\\)", "i").test(line)) {
      return "inline declaration — type inferred from the expression";
    }
    // Keep the declaration visible even when ABAP uses a multiline or
    // project-specific type form that the compact parser cannot normalize.
    return line.trim() || "declared in the current scope";
  }
  function variableInformation(document, at) {
    const anchor = variableAnchor(document, at);
    if (!anchor) { return undefined; }
    const source = document.getText(), line = declarationLine(source, anchor.name, at);
    if (line < 0) { return undefined; }
    const lines = source.split(/\r?\n/);
    let declaration = lines[line] || "";
    // ABAP method signatures and DATA declarations are often wrapped across
    // lines. Keep the complete statement available to the type resolver.
    for (let next = line + 1; next < lines.length && !/\./.test(declaration); next++) {
      declaration += " " + lines[next].trim();
    }
    declaration = declaration.trim();
    // Do not add a competing variable hover for parameters declared in a
    // method signature; the method hover remains the single source there.
    const signatureContext = lines.slice(Math.max(0, line - 8), line + 1).join(" ");
    if (/\b(?:CLASS-)?METHODS\b[\s\S]*\b(?:IMPORTING|EXPORTING|CHANGING|RETURNING)\b/i.test(signatureContext)
      || /^\s*(?:IMPORTING|EXPORTING|CHANGING|RETURNING)\b/i.test(declaration)) {
      return { anchor, line, type: "", declaration, signatureParameter: true };
    }
    return { anchor, line, type: variableType(declaration, anchor.name), declaration };
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
    const entry = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document);
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
    const current = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document);
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
    if (call.kind === "method") {
      line = methodLine(target.document.getText(), call.method, true);
      if (line < 0) { return undefined; }
      const text = target.document.getText().split(/\r?\n/)[line];
      column = Math.max(0, text.toUpperCase().indexOf(call.method)); length = call.method.length;
    }
    return { document: target.document, target: location(target.document.uri, line, column, length) };
  }
  async function externalMethodInformation(document, at) {
    const current = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document);
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
    const current = opened.get(document.uri.toString()) || [...opened.values()].find(item => item.document === document);
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
  function variableDeclaration(document, at) {
    const info = variableInformation(document, at);
    if (!info || info.line === at.line) { return undefined; }
    const anchor = info.anchor, source = document.getText(), line = info.line;
    const text = source.split(/\r?\n/)[line];
    return { document, target: location(document.uri, line,
      Math.max(0, text.toUpperCase().indexOf(anchor.name)), anchor.name.length) };
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
    const target = result.document === editor.document ? editor
      : await vscode.window.showTextDocument(result.document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    if (target) { selectTarget(target, result.target); }
  }
  async function goBack() {
    const previous = navigation.pop();
    if (!previous) {
      vscode.window.showInformationMessage("VERTEX: there is no previous VERTEX navigation position.");
      return;
    }
    const editor = previous.document === (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document)
      ? vscode.window.activeTextEditor : await vscode.window.showTextDocument(previous.document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    if (editor) { selectTarget(editor, { range: range(previous.at.line, previous.at.character, previous.at.character) }); }
  }
  async function goToClassMethod(chosenEditor, chosenPosition) {
    const editor = chosenEditor || vscode.window.activeTextEditor;
    const at = chosenPosition || (editor && editor.selection && editor.selection.active);
    if (!editor || !at) { return; }
    const structure = structuralTarget(editor.document, at);
    if (structure) { await moveTo(editor, structure); return; }
    const method = await methodCounterpart(editor.document, at);
    const variable = method ? undefined : variableDeclaration(editor.document, at);
    const result = method || variable || await externalCallTarget(editor.document, at);
    if (!result) {
      const info = variableInformation(editor.document, at);
      if (info && info.line === at.line && navigation.length) { await goBack(); return; }
      vscode.window.showInformationMessage("VERTEX: place the cursor on a method, variable, static class call or CALL FUNCTION name.");
      return;
    }
    await moveTo(editor, result);
  }
  context.subscriptions.push(vscode.commands.registerCommand("vertex.goToClassMethod", () =>
    goToClassMethod().catch(error => vscode.window.showErrorMessage("VERTEX: " + error.message))));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.navigateBack", () =>
    goBack().catch(error => vscode.window.showErrorMessage("VERTEX: " + error.message))));
  if (typeof vscode.window.onDidChangeTextEditorSelection === "function") {
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
      const mouse = vscode.TextEditorSelectionChangeKind && vscode.TextEditorSelectionChangeKind.Mouse;
      const selection = event && event.selections && event.selections.length === 1 && event.selections[0];
      if (!mouse || !event || event.kind !== mouse || !selection || selection.isEmpty
        || event.textEditor.document.uri.scheme !== "vertex-sap") { return; }
    const anchor = structuralAnchor(event.textEditor.document, selection.active)
        || methodAnchor(event.textEditor.document, selection.active)
        || variableAnchor(event.textEditor.document, selection.active)
        || externalCallAnchor(event.textEditor.document, selection.active)
        || classAnchor(event.textEditor.document, selection.active);
      // A double-click selects exactly the identifier.  Do not navigate on a
      // drag selection: selecting code remains essential for copying and chat.
      if (!anchor || event.textEditor.document.getText(selection).toUpperCase() !== anchor.name) { return; }
      goToClassMethod(event.textEditor, selection.active)
        .catch(error => vscode.window.showErrorMessage("VERTEX: " + error.message));
    }));
  }
  if (vscode.languages && typeof vscode.languages.registerDefinitionProvider === "function") {
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
      { scheme: "vertex-sap", language: "abap" }, {
        async provideDefinition(document, at) {
          const result = structuralTarget(document, at) || await methodCounterpart(document, at)
            || await externalCallTarget(document, at);
          return result && result.target;
        }
      }));
  }
  // Only identifiers that resolve as methods may trigger signature lookups.
  if (vscode.languages && typeof vscode.languages.registerHoverProvider === "function") {
    context.subscriptions.push(vscode.languages.registerHoverProvider(
      { scheme: "vertex-sap", language: "abap" }, {
        async provideHover(document, at) {
          const variable = variableAnchor(document, at);
          if (variable) {
            const source = document.getText();
            const procedure = procedureAt(source, at.line);
            // Local declarations win; a parameter is resolved only in this
            // exact METHOD or FORM.  No source from a call site is involved.
            const declaration = localDeclaration(source, at.line, variable.name);
            const value = declaration ? variableType(declaration, variable.name)
              : procedure && parameterDeclaration(source, procedure.name, variable.name);
            if (!value) return undefined;
            const target = range(at.line, variable.from, variable.to);
            return vscode.Hover ? new vscode.Hover([{ language: "abap", value }], target)
              : { contents: [{ language: "abap", value }], range: target };
          }
          const method = methodInformation(document, at);
          if (method) {
            const target = range(at.line, method.anchor.from, method.anchor.to);
            return vscode.Hover ? new vscode.Hover([{ language: "abap", value: method.signature }], target)
              : { contents: [{ language: "abap", value: method.signature }], range: target };
          }
          // Resolve locals and parameters before any inherited/external lookup.
          // This keeps a variable hover immediate and prevents a stale
          // network signature request from leaving a `Loading...` tooltip.
          const info = variableInformation(document, at);
          if (info && !info.signatureParameter) {
            const target = range(at.line, info.anchor.from, info.anchor.to);
            return vscode.Hover ? new vscode.Hover([{ language: "abap", value: info.type }], target)
              : { contents: [{ language: "abap", value: info.type }], range: target };
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
    const object_type = await vscode.window.showQuickPick(Object.keys(TYPES), { title: "Create SAP object draft" });
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
  return { schemas, onEvent: events.on,
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
      return { system: entry.repo.label, object_name: entry.data.object_name,
        object_type: entry.data.object_type, include: entry.data.include,
        base_revision: entry.data.revision, source: editor.document.getText(), selected_fragment };
    },
    instructions: require("fs").readFileSync(require("path").join(__dirname, "prompts/tools/sap-code.md"), "utf8"), async execute(tool, args) {
    const repo = await repository();
    if (tool === "open_sap_object") { return showSource(repo, args); }
    if (tool === "review_sap_changes") { return reviewActive(); }
    const result = await repo.api.execute(tool, args);
    if (result.change_id) { await showDraft(repo, result); }
    return result;
  } };
}
module.exports = { register };
