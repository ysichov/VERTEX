"use strict";

// JSON-facing repository operations. No VS Code, model, MCP or credentials here.
const { createHash, randomUUID } = require("crypto");
const TYPES = Object.freeze({ PROG: "PROG/P", CLAS: "CLAS/OC", FUNC: "FUGR/FF", INTF: "INTF/OI" });
const INCLUDES = ["main", "definitions", "implementations", "macros", "testclasses"];
const revision = source => createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
const MAX_SOURCE = 2 * 1024 * 1024;

function name(value, label = "object_name") {
  if (typeof value !== "string" || !/^[A-Z0-9_/$]+$/i.test(value) || value.length > 40) {
    throw new Error("Invalid " + label + ". Use an exact SAP technical name.");
  }
  return value.toUpperCase();
}
function type(value) {
  if (!Object.hasOwn(TYPES, value)) { throw new Error("Supported object_type values: PROG, CLAS, FUNC, INTF."); }
  return value;
}
function sourceText(value) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > MAX_SOURCE) {
    throw new Error("Source must be non-empty and at most 2 MiB.");
  }
  return value;
}
function adtPath(value, base = "/sap/bc/adt/") {
  if (typeof value !== "string" || !value || /[\\<>"\s]/.test(value)) {
    throw new Error("SAP returned an invalid ADT source URI.");
  }
  const url = new URL(value, "https://sap.invalid" + base.replace(/\/$/, "") + "/");
  if (url.origin !== "https://sap.invalid" || !url.pathname.startsWith("/sap/bc/adt/")) {
    throw new Error("SAP returned an ADT URI outside the connected system.");
  }
  if (url.search) { throw new Error("Unexpected query in ADT object URI."); }
  return url.pathname;
}
function sourcePath(structure, objectUrl, include = "main") {
  if (!INCLUDES.includes(include)) { throw new Error("Unknown class include."); }
  const part = (structure.includes || []).find(i => i["class:includeType"] === include);
  const raw = part && part["abapsource:sourceUri"]
    || (include === "main" && structure.metaData["abapsource:sourceUri"]);
  if (!raw) { throw new Error("SAP did not expose source for include " + include + "."); }
  return adtPath(raw, objectUrl);
}
function row(item) {
  return {
    object_name: item["adtcore:name"],
    // Some ADT backends expose a function module as its generated include
    // (`FUGR/I`) rather than the usual module reference (`FUGR/FF`).
    object_type: Object.keys(TYPES).find(key => TYPES[key] === item["adtcore:type"])
      || (/^FUGR\//.test(String(item["adtcore:type"])) ? "FUNC" : undefined),
    description: item["adtcore:description"] || "",
    package: item["adtcore:packageName"] || "",
    object_url: adtPath(item["adtcore:uri"])
  };
}
function createRepository({ client, systemId, emit = () => {} }) {
  const drafts = new Map();
  let applying = false;
  let executing = false;
  async function search(args) {
    const query = args.query;
    if (typeof query !== "string" || !/^[A-Z0-9_/$*+]+$/i.test(query) || query.length > 80) {
      throw new Error("Use a SAP name or name pattern (* and + wildcards).");
    }
    const max = args.limit === undefined ? 50 : args.limit;
    if (!Number.isInteger(max) || max < 1 || max > 200) { throw new Error("limit must be 1..200."); }
    const types = args.object_type ? [type(args.object_type)] : Object.keys(TYPES);
    const all = [];
    // A stateful SAP client is never shared by parallel requests.
    for (const key of types) {
      const matches = await client.searchObject(query.toUpperCase(), TYPES[key], max + 1);
      all.push(...matches.filter(x => x["adtcore:type"] === TYPES[key]).map(row));
    }
    return { system: systemId, objects: all.slice(0, max), truncated: all.length > max };
  }
  async function resolve(args) {
    const kind = type(args.object_type), objectName = name(args.object_name);
    const found = await client.searchObject(objectName, TYPES[kind], 200);
    let exact = found.filter(x => x["adtcore:type"] === TYPES[kind]
      && String(x["adtcore:name"]).toUpperCase() === objectName);
    // Function modules are indexed differently across ADT releases. A
    // type-filtered quick search can omit a standard FM, while an unfiltered
    // exact search returns its FUGR reference. Keep both the exact-name and
    // FUGR-family checks; this is not a fuzzy fallback.
    if (kind === "FUNC" && !exact.length) {
      const fallback = await client.searchObject(objectName, undefined, 200);
      exact = fallback.filter(x => /^FUGR\//.test(String(x["adtcore:type"]))
        && String(x["adtcore:name"]).toUpperCase() === objectName);
    }
    if (exact.length !== 1) { throw new Error(kind + " " + objectName + (exact.length ? " is ambiguous." : " was not found.")); }
    return row(exact[0]);
  }
  async function read(args) {
    const object = await resolve(args);
    const structure = await client.objectStructure(object.object_url, "active");
    const include = args.include || "main";
    if (object.object_type !== "CLAS" && include !== "main") { throw new Error("Includes apply only to classes."); }
    const source_url = sourcePath(structure, object.object_url, include);
    const active = await client.getObjectSource(source_url, { version: "active" });
    const source = await client.getObjectSource(source_url, { version: "workingArea" });
    if (Buffer.byteLength(source) > MAX_SOURCE) { throw new Error("SAP source exceeds the 2 MiB limit."); }
    return { ...object, system: systemId, include, source_url, source,
      revision: revision(source), active_revision: revision(active),
      includes: (structure.includes || []).map(i => i["class:includeType"]) };
  }
  function remember(data) {
    if (drafts.size >= 100) { throw new Error("Too many pending changes. Discard or apply a draft first."); }
    const change_id = randomUUID();
    const draft = { ...data, change_id, system: systemId, state: "prepared" };
    drafts.set(change_id, draft);
    return { ...draft };
  }
  async function modify(args) {
    sourceText(args.source);
    if (typeof args.base_revision !== "string") { throw new Error("Read the object first and supply base_revision."); }
    const current = await read(args);
    if (current.revision !== args.base_revision && current.revision !== revision(args.source)) {
      throw new Error("Source changed in SAP. Read it again before preparing a change.");
    }
    return remember({ ...current, operation: "modify", original_source: current.source,
      source: args.source, base_revision: current.revision, transport: args.transport || "" });
  }
  async function create(args) {
    const kind = type(args.object_type), objectName = name(args.object_name);
    // Interfaces are read and changed, not created.
    if (kind === "INTF") { throw new Error("Creating an interface is not supported."); }
    sourceText(args.source);
    if (!/^(Z|Y|\/[A-Z0-9_]+\/)/.test(objectName)) { throw new Error("Create an object in a customer namespace."); }
    const matches = await client.searchObject(objectName, TYPES[kind], 200);
    if (matches.some(x => String(x["adtcore:name"]).toUpperCase() === objectName && x["adtcore:type"] === TYPES[kind])) {
      throw new Error("Object already exists. Use modify_sap_object.");
    }
    const parentName = name(kind === "FUNC" ? args.function_group : args.package, "parent");
    const parentType = kind === "FUNC" ? "FUGR/F" : "DEVC/K";
    const parents = await client.searchObject(parentName, parentType, 200);
    const parent = parents.find(x => String(x["adtcore:name"]).toUpperCase() === parentName && x["adtcore:type"] === parentType);
    if (!parent) { throw new Error("Parent " + parentName + " was not found."); }
    if (typeof args.description !== "string" || !args.description.trim() || args.description.length > 60) {
      throw new Error("Provide a description of 1..60 characters.");
    }
    return remember({ operation: "create", object_type: kind, object_name: objectName,
      include: "main", original_source: "", source: args.source, base_revision: null,
      package: kind === "FUNC" ? parent["adtcore:packageName"] || "" : parentName,
      parent_name: parentName, parent_url: adtPath(parent["adtcore:uri"]),
      description: args.description, transport: args.transport || "" });
  }
  function draft(id) {
    const found = drafts.get(id);
    if (!found) { throw new Error("Unknown or expired change. Prepare it again."); }
    return { ...found };
  }
  async function apply(id, { source, transport = "" }) {
    if (applying || executing) { throw new Error("SAP session is busy. Wait for the current operation to finish."); }
    const change = drafts.get(id);
    if (!change || change.state !== "prepared") { throw new Error("Change is not ready; read SAP and prepare a new draft."); }
    sourceText(source);
    if (transport && !/^[A-Z0-9]{1,30}$/.test(transport)) { throw new Error("Invalid transport request/task."); }
    applying = true;
    let lock, object, saved = false, created = false, mutationAttempted = false, outcome, failure;
    try {
      change.state = "applying";
      client.stateful = "stateful";
      if (change.operation === "create") {
        if (change.package !== "$TMP" && !transport) { throw new Error("Supply a transport for creation outside $TMP."); }
        // This atomic SAP create refuses an object created since preview.
        mutationAttempted = true;
        await client.createObject({ objtype: TYPES[change.object_type], name: change.object_name,
          parentName: change.parent_name, parentPath: change.parent_url,
          description: change.description, transport });
        created = true;
      }
      object = await resolve(change);
      lock = await client.lock(object.object_url);
      const structure = await client.objectStructure(object.object_url);
      const source_url = sourcePath(structure, object.object_url, change.include);
      let activateExistingInactive = false;
      if (change.operation === "modify") {
        const current = await client.getObjectSource(source_url, { version: "active" });
        const working = await client.getObjectSource(source_url, { version: "workingArea" });
        // A preceding save can have written exactly this source but left it
        // inactive. Retrying must activate that known source, not reject it
        // as a conflict or write it a second time.
        activateExistingInactive = revision(current) === change.active_revision
          && revision(working) === revision(source)
          && revision(current) !== revision(source);
        if (!activateExistingInactive && (revision(current) !== change.active_revision || revision(working) !== change.base_revision)) {
          throw new Error("Active or inactive SAP source changed since preview. Nothing was overwritten.");
        }
      }
      // $TMP is authoritative package metadata. Some systems do not mark a
      // local lock with IS_LOCAL, but still accept a blank transport.
      if (change.package !== "$TMP" && lock.IS_LOCAL !== "X" && !transport && !lock.CORRNR) {
        throw new Error("SAP requires a transport request/task for this object.");
      }
      const diagnostics = await client.syntaxCheck(source_url, source_url, source);
      if (diagnostics.some(d => /^(E|A|ERROR|ABORT)$/i.test(d.severity))) {
        throw new Error("Syntax check failed: " + diagnostics.map(d => `Line ${d.line}: ${d.text}`).join("; "));
      }
      if (!activateExistingInactive) {
        emit({ type: "status", message: "Saving " + change.object_name });
        mutationAttempted = true;
        await client.setObjectSource(source_url, source, lock.LOCK_HANDLE, transport || lock.CORRNR);
        saved = true;
      }
      // Activation takes its own backend lock. Release our editing lock first,
      // otherwise SAP can report our own user as currently editing the object.
      await client.unLock(object.object_url, lock.LOCK_HANDLE);
      lock = undefined;
      client.stateful = "stateless";
      const inactive = await client.getObjectSource(source_url, { version: "workingArea" });
      if (revision(inactive) !== revision(source)) {
        throw new Error("SAP working source changed before activation. Activation was not requested.");
      }
      // Activate the exact source unit. preaudit is not universally supported
      // by older ABAP systems and is not a substitute for the syntax check
      // already performed above.
      const activation = await client.activate(change.object_name, object.object_url, source_url, false);
      if (!activation.success) {
        throw new Error("Source saved inactive; activation failed: " + activation.messages.map(m => m.shortText).join("; "));
      }
      const actual = await client.getObjectSource(source_url, { version: "active" });
      if (revision(actual) !== revision(source)) { throw new Error("Activation returned success, but active source differs. Inspect SAP before retrying."); }
      outcome = { system: systemId, object_name: change.object_name, object_type: change.object_type,
        saved: true, activated: true, revision: revision(actual), diagnostics };
      change.state = "applied";
    } catch (error) {
      change.state = mutationAttempted ? "needs-inspection" : "prepared";
      failure = new Error(error.message + (created ? " A new object was created in SAP; inspect it before retrying." : "")
        + (saved ? " SAP source was written; activation was not confirmed." : "")
        + (mutationAttempted && !saved ? " A write was attempted; inspect SAP before retrying." : ""));
    } finally {
      if (lock) {
        try { await client.unLock(object.object_url, lock.LOCK_HANDLE); }
        catch (error) {
          const warning = "Could not release SAP lock: " + error.message;
          if (outcome) { outcome.warning = warning; }
          else { failure = new Error((failure ? failure.message + " " : "") + warning); }
        }
      }
      try { await client.logout(); } catch (_) { /* release stateful session best effort */ }
      client.stateful = "stateless";
      applying = false;
    }
    if (failure) { throw failure; }
    return outcome;
  }
  const handlers = { search_sap_objects: search, read_sap_object: read,
    create_sap_object: create, modify_sap_object: modify };
  async function execute(tool, args) {
    if (applying || executing) { throw new Error("SAP session is busy. Use separate sessions for parallel operations."); }
    if (!Object.hasOwn(handlers, tool)) { throw new Error("Unknown SAP code tool: " + tool); }
    executing = true;
    const task_id = randomUUID();
    emit({ type: "tool.call", task_id, tool });
    try {
      const result = await handlers[tool](args || {});
      emit({ type: "tool.result", task_id, tool });
      return result;
    } catch (error) { emit({ type: "error", task_id, tool, message: error.message }); throw error; }
    finally { executing = false; }
  }
  // What the ABAP compiler knows about a name at a position of the source -
  // ADT's own element info and navigation, what F3 and the hover use in
  // Eclipse. The source sent is the editor's text, saved or not. Lines count
  // from 1, columns from 0.
  const elementInfo = (sourceUrl, source, line, column) =>
    client.codeCompletionElement(sourceUrl, source, line, column);
  const definition = (sourceUrl, source, line, start, end) =>
    client.findDefinition(sourceUrl, source, line, start, end, false);
  // The active source behind a URL that navigation pointed at - a type pool,
  // an interface, another class - whatever kind of object it is.
  const sourceAt = url => client.getObjectSource(adtPath(String(url).split("#")[0]), { version: "active" });
  // A data element's domain or built-in type, for its hover.
  const dataElement = async elementName => (await client.getDataElementProperties(
    "/sap/bc/adt/ddic/dataelements/" + encodeURIComponent(name(elementName, "data element").toLowerCase()))).properties;
  // ABAP Unit on an object, what Ctrl+Shift+F10 does in Eclipse: SAP runs
  // the test classes and returns classes, methods, times and alerts. Risk
  // level harmless only, as Eclipse's default; every duration.
  async function unitTests(objectUrl) {
    if (applying || executing) { throw new Error("SAP session is busy. Wait for the current operation to finish."); }
    executing = true;
    try {
      return await client.unitTestRun(adtPath(objectUrl), { harmless: true, dangerous: false, critical: false,
        short: true, medium: true, long: true });
    } finally { executing = false; }
  }
  // ATC on an object with the system's default check variant, as Eclipse
  // runs it without a variant of its own: the variant opens a worklist, the
  // run fills it, the worklist carries the findings with their places.
  async function atcCheck(objectUrl) {
    if (applying || executing) { throw new Error("SAP session is busy. Wait for the current operation to finish."); }
    executing = true;
    try {
      // Which of the three ADT calls SAP refused is part of the error.
      const step = async (name, call) => {
        try { return await call(); } catch (error) { throw new Error("ATC " + name + ": " + (error && error.message || error)); }
      };
      const customizing = await step("customizing (GET /atc/customizing)", () => client.atcCustomizing());
      const property = customizing.properties.find(p => p.name === "systemCheckVariant");
      const variant = property && String(property.value || "");
      if (!variant) { throw new Error("SAP has no default ATC check variant (ATC customizing, systemCheckVariant)."); }
      const worklist = await step("worklist for variant " + variant + " (POST /atc/worklists)", () => client.atcCheckVariant(variant));
      const run = await step("run on worklist " + worklist + " (POST /atc/runs)", () => client.createAtcRun(worklist, adtPath(objectUrl), 1000));
      const result = await step("findings of run " + run.id + " (GET /atc/worklists)", () => client.atcWorklists(run.id, run.timestamp, "", false));
      return { variant, infos: run.infos, findings: result.objects.flatMap(object => object.findings.map(finding => ({
        object_name: object.name, object_type: object.type, priority: finding.priority,
        check: finding.checkTitle, message: finding.messageTitle,
        uri: finding.location.uri, line: finding.location.range.start.line, column: finding.location.range.start.column }))) };
    } finally { executing = false; }
  }
  // Where-used, what Ctrl+Shift+G does in Eclipse: SAP names the objects
  // that use the name at line/column of the saved source, then the places
  // in each. Lines count from 1, columns from 0.
  async function whereUsed(sourceUrl, line, column) {
    const references = await client.usageReferences(adtPath(sourceUrl), line, column);
    const used = references.filter(reference => reference.objectIdentifier);
    const found = used.length ? await client.usageReferenceSnippets(used) : [];
    // A place inside a class comes as a fragment - #type=CLAS/OM;name=<method>
    // - its line counted from that fragment. SAP maps the fragment to where
    // it starts in the source; the place's line is counted on from there.
    const fragments = new Map();
    const places = [];
    for (const object of found) {
      for (const snippet of object.snippets) {
        const at = snippet.uri, start = at.start || { line: 0, column: 0 }, end = at.end || start;
        let uri = at.uri, line = start.line, endLine = end.line;
        if (at.type && at.name) {
          const key = [at.uri, at.type, at.name].join("|");
          if (!fragments.has(key)) { fragments.set(key, await client.fragmentMappings(adtPath(at.uri), at.type, at.name)); }
          const fragment = fragments.get(key);
          uri = fragment.uri; line = fragment.line + start.line - 1; endLine = fragment.line + end.line - 1;
        }
        places.push({ object: object.objectIdentifier, uri, content: snippet.content || "", description: snippet.description,
          line, column: start.column, end_line: endLine, end_column: end.column });
      }
    }
    return places;
  }
  // The ABAP keyword documentation for the statement at line/column, as
  // F1 gives it in Eclipse: SAP's own HTML page.
  const documentation = (sourceUrl, source, line, column) =>
    client.abapDocumentation(adtPath(sourceUrl), source, line, column);
  return { execute, apply, draft, unitTests, atcCheck, whereUsed, documentation, elementInfo, definition, sourceAt, dataElement, discard: id => drafts.delete(id),
    dispose: async () => { drafts.clear(); await client.logout(); } };
}
module.exports = { createRepository, TYPES, revision, adtPath, sourcePath };
