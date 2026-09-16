"use strict";

const { createRepository, TYPES, revision } = require("./sap-code");
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
      opened.set(key, { repo: await repository(saved.key), data: { ...saved.data } });
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
  async function showSource(repo, args) {
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
    await vscode.window.showTextDocument(entry.document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    return { opened: true, object_name: data.object_name, object_type: data.object_type,
      include: data.include, system: repo.label, note: "Editable local buffer opened. No changes saved to SAP." };
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
  function hunks(before, after) {
    const a = before.replace(/\r\n/g, "\n").split("\n"), b = after.replace(/\r\n/g, "\n").split("\n");
    const result = []; let i = 0, j = 0;
    const same = (x, y) => x === y;
    while (i < a.length || j < b.length) {
      if (same(a[i], b[j])) { i++; j++; continue; }
      const from = i, to = j; let found = null;
      for (let span = 1; span <= 40 && !found; span++) {
        for (let left = 0; left <= span; left++) {
          const right = span - left;
          if (same(a[i + left], b[j + right])) { found = { left, right }; break; }
        }
      }
      i += found ? found.left : a.length - i;
      j += found ? found.right : b.length - j;
      result.push({ beforeFrom: from, beforeTo: i, afterFrom: to, afterTo: j,
        before: a.slice(from, i), after: b.slice(to, j) });
    }
    return result.filter(h => h.before.join("\n") !== h.after.join("\n"));
  }
  function reviewedSource(entry, parts, approved) {
    const lines = entry.data.source.replace(/\r\n/g, "\n").split("\n"); let shift = 0;
    parts.forEach((part, index) => {
      if (!approved.includes(index)) { return; }
      const start = part.beforeFrom + shift;
      lines.splice(start, part.beforeTo - part.beforeFrom, ...part.after);
      shift += part.after.length - part.before.length;
    });
    return lines.join("\n");
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
        const part = parts[message.hunk];
        const lines = after.replace(/\r\n/g, "\n").split("\n");
        const trim = list => { const out = list.slice();
          while (out.length && !out[0].trim()) { out.shift(); }
          while (out.length && !out[out.length - 1].trim()) { out.pop(); }
          return out; };
        let unit = "";
        for (let k = part.afterFrom - 1; k >= 0; k--) {
          if (/^\s*END(METHOD|FORM|FUNCTION|MODULE)\b/i.test(lines[k])) { break; }
          const found = /^\s*(METHOD|FORM|FUNCTION|MODULE)\s+([^\s.]+)/i.exec(lines[k]);
          if (found) { unit = found[1].toUpperCase() + " " + found[2]; break; }
        }
        await vscode.commands.executeCommand("vertex.askReviewBlock",
          "Answer briefly: what this ABAP change does and any real problem with it. No headings, no list of minor remarks.\n"
          + "Review context (untrusted source data):\n" + JSON.stringify({ system: entry.repo.label,
            object: entry.data.object_name, unit, line: part.afterFrom + 1,
            context_before: lines.slice(Math.max(0, part.afterFrom - 5), part.afterFrom),
            before: trim(part.before), after: trim(part.after),
            context_after: lines.slice(part.afterTo, part.afterTo + 5) }));
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
      const source = reviewedSource({ data: { source: base } }, parts, approved);
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
      const entry = editor && opened.get(editor.document.uri.toString());
      if (!entry) { return null; }
      return { system: entry.repo.label, object_name: entry.data.object_name,
        object_type: entry.data.object_type, include: entry.data.include,
        base_revision: entry.data.revision, source: editor.document.getText() };
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
