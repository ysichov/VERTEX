"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRepository, revision, adtPath, sourcePath } = require("../sap-code");

function fixture(kind = "PROG") {
  const type = { PROG: "PROG/P", CLAS: "CLAS/OC", FUNC: "FUGR/FF" }[kind];
  const calls = [], events = [];
  const url = kind === "PROG" ? "/sap/bc/adt/programs/programs/ztest"
    : kind === "CLAS" ? "/sap/bc/adt/oo/classes/ztest" : "/sap/bc/adt/functions/groups/zgroup/fmodules/ztest";
  let active = "original", working = active, exists = true, localLock = true;
  const client = {
    async searchObject(query, filter) {
      calls.push(["search", query, filter]);
      if (filter === "DEVC/K" || filter === "FUGR/F") {
        return [{ "adtcore:name": query, "adtcore:type": filter, "adtcore:uri": "/sap/bc/adt/packages/local", "adtcore:packageName": "$TMP" }];
      }
      return exists && filter === type ? [{ "adtcore:name": "ZTEST", "adtcore:type": type,
        "adtcore:uri": url, "adtcore:packageName": "$TMP" }] : [];
    },
    async objectStructure() { return { metaData: { "abapsource:sourceUri": "source/main" }, includes: kind === "CLAS"
      ? [{ "class:includeType": "main", "abapsource:sourceUri": "source/main" },
        { "class:includeType": "testclasses", "abapsource:sourceUri": "includes/testclasses" }] : [] }; },
    async getObjectSource(path, options) { calls.push(["read", options.version, path]); return options.version === "workingArea" ? working : active; },
    async createObject(options) { calls.push(["create", options]); if (exists) { throw Error("Already exists"); } exists = true; },
    async lock(path) { calls.push(["lock", path]); return { LOCK_HANDLE: "handle", IS_LOCAL: localLock ? "X" : "", CORRNR: "" }; },
    async syntaxCheck(...args) { calls.push(["check", ...args]); return []; },
    async setObjectSource(path, source, handle, transport) { calls.push(["write", path, handle, transport]); working = source; },
    async activate() { calls.push(["activate"]); active = working; return { success: true, messages: [] }; },
    async unLock(...args) { calls.push(["unlock", ...args]); },
    async logout() { calls.push(["logout"]); }
  };
  const repo = createRepository({ client, systemId: "DEV:100:USER", emit: e => events.push(e) });
  return { client, calls, events, repo, url, setActive: v => { active = v; working = v; },
    setWorking: v => { working = v; }, localLock: value => { localLock = value; }, absent: () => { exists = false; }, present: () => { exists = true; } };
}
async function change(f) {
  const read = await f.repo.execute("read_sap_object", { object_type: "PROG", object_name: "ZTEST" });
  return f.repo.execute("modify_sap_object", { object_type: "PROG", object_name: "ZTEST",
    base_revision: read.revision, source: "replacement" });
}
test("activation runs after releasing the editing lock and can recover a saved draft", async () => {
  const f = fixture();
  let locked = false;
  const lock = f.client.lock, unlock = f.client.unLock, activate = f.client.activate;
  f.client.lock = async (...args) => { locked = true; return lock(...args); };
  f.client.unLock = async (...args) => { locked = false; return unlock(...args); };
  f.client.activate = async () => {
    assert.equal(locked, false, "activation must not collide with our own lock");
    assert.equal(f.client.stateful, "stateless");
    throw Error("Activation unavailable");
  };
  const draft = await change(f);
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /source was written/);
  f.client.activate = activate;
  const retry = await f.repo.execute("modify_sap_object", { object_type: "PROG", object_name: "ZTEST",
    base_revision: draft.base_revision, source: draft.source });
  await f.repo.apply(retry.change_id, { source: retry.source });
  assert.equal(f.calls.filter(c => c[0] === "write").length, 1);
});
test("failed unlock prevents activation", async () => {
  const f = fixture(), draft = await change(f);
  f.client.unLock = async () => { throw Error("Unlock failed"); };
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /Unlock failed/);
  assert.equal(f.calls.some(c => c[0] === "activate"), false);
});
test("working source changed after unlock is not activated", async () => {
  const f = fixture(), draft = await change(f);
  f.client.unLock = async () => { f.setWorking("another editor"); };
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /changed before activation/);
  assert.equal(f.calls.some(c => c[0] === "activate"), false);
});
test("$TMP object saves without a transport even if SAP lock omits IS_LOCAL", async () => {
  const f = fixture();
  f.localLock(false);
  const draft = await change(f);
  await f.repo.apply(draft.change_id, { source: draft.source, transport: "" });
  assert.deepEqual(f.calls.find(c => c[0] === "write").slice(2), ["handle", ""]);
});
test("known inactive source is activated without a duplicate write", async () => {
  const f = fixture();
  const draft = await change(f);
  f.setWorking(draft.source);
  await f.repo.apply(draft.change_id, { source: draft.source });
  assert.equal(f.calls.filter(c => c[0] === "write").length, 0);
  assert.equal(f.calls.filter(c => c[0] === "activate").length, 1);
});
test("existing inactive edits are read, reviewed and can be saved", async () => {
  const f = fixture();
  f.setWorking("previous inactive edits");
  const read = await f.repo.execute("read_sap_object", { object_type: "PROG", object_name: "ZTEST" });
  assert.equal(read.source, "previous inactive edits");
  assert.equal(read.active_revision, revision("original"));
  const draft = await change(f);
  assert.equal(draft.original_source, read.source);
  await f.repo.apply(draft.change_id, { source: "manually edited replacement" });
  assert.equal(f.calls.filter(c => c[0] === "write").length, 1);
});
test("inactive edits changed after opening prevent preparing a stale review", async () => {
  const f = fixture();
  const read = await f.repo.execute("read_sap_object", { object_type: "PROG", object_name: "ZTEST" });
  f.setWorking("another editor");
  await assert.rejects(f.repo.execute("modify_sap_object", { object_type: "PROG", object_name: "ZTEST",
    base_revision: read.revision, source: "replacement" }), /Source changed in SAP/);
  assert.equal(f.calls.some(c => c[0] === "write"), false);
});
test("matching inactive target does not bypass an active version conflict", async () => {
  const f = fixture(), draft = await change(f);
  f.setActive("another activation");
  f.setWorking(draft.source);
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /changed since preview/);
  assert.equal(f.calls.some(c => c[0] === "write" || c[0] === "activate"), false);
});
for (const kind of ["PROG", "CLAS", "FUNC"]) {
  test(kind + " resolves by exact type/name and returns full source + revision", async () => {
    const f = fixture(kind);
    const result = await f.repo.execute("read_sap_object", { object_type: kind, object_name: "ztest" });
    assert.equal(result.source, "original");
    assert.equal(result.revision, revision("original"));
    assert.equal(result.source_url, f.url + "/source/main");
    assert.equal(f.calls.filter(c => c[0] === "write").length, 0);
  });
}
test("function module read falls back to an unfiltered exact FUGR search", async () => {
  const f = fixture("FUNC"), search = f.client.searchObject;
  f.client.searchObject = async (query, filter) => {
    if (filter === "FUGR/FF") return [];
    if (filter === undefined) return [{ "adtcore:name": "SAPGUI_PROGRESS_INDICATOR", "adtcore:type": "FUGR/I",
      "adtcore:uri": f.url, "adtcore:packageName": "SABP" }];
    return search(query, filter);
  };
  const result = await f.repo.execute("read_sap_object", { object_type: "FUNC", object_name: "SAPGUI_PROGRESS_INDICATOR" });
  assert.equal(result.object_type, "FUNC");
  assert.equal(result.object_name, "SAPGUI_PROGRESS_INDICATOR");
  assert.equal(result.source, "original");
});
test("class includes use their discovered source URL", async () => {
  const f = fixture("CLAS");
  const result = await f.repo.execute("read_sap_object", { object_type: "CLAS", object_name: "ZTEST", include: "testclasses" });
  assert.equal(result.source_url, f.url + "/includes/testclasses");
});
test("no exact search match does not read another object", async () => {
  const f = fixture();
  await assert.rejects(f.repo.execute("read_sap_object", { object_type: "PROG", object_name: "ZMISSING" }), /not found/);
  assert.equal(f.calls.filter(c => c[0] === "read").length, 0);
});
test("prepare never writes and application checks under lock, writes, activates, verifies and unlocks", async () => {
  const f = fixture(), draft = await change(f);
  assert.equal(f.calls.some(c => c[0] === "write" || c[0] === "lock"), false);
  f.calls.length = 0;
  const result = await f.repo.apply(draft.change_id, { source: draft.source });
  assert.equal(result.activated, true);
  assert.deepEqual(f.calls.map(c => c[0]), ["search", "lock", "read", "read", "check", "write", "unlock", "read", "activate", "read", "logout"]);
  assert.equal(f.client.stateful, "stateless");
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /not ready/);
});
for (const area of ["active", "working"]) {
  test("changed " + area + " source aborts with no overwrite and releases lock", async () => {
    const f = fixture(), draft = await change(f);
    if (area === "active") { f.setActive("another editor"); } else { f.setWorking("unsaved SAP draft"); }
    await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /changed since preview/);
    assert.equal(f.calls.some(c => c[0] === "write"), false);
    assert.equal(f.calls.some(c => c[0] === "unlock"), true);
  });
}
test("syntax failure never writes; SAP lock failure never tries to unlock another user's lock", async () => {
  const f = fixture(), draft = await change(f);
  f.client.syntaxCheck = async () => [{ severity: "E", line: 2, text: "Syntax error" }];
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /Syntax check failed/);
  assert.equal(f.calls.some(c => c[0] === "write"), false);
  f.calls.length = 0;
  f.client.lock = async () => { throw Error("Locked by another user"); };
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /another user/);
  assert.equal(f.calls.some(c => c[0] === "unlock"), false);
});
test("failed activation is reported as a saved source, never automatically retried", async () => {
  const f = fixture(), draft = await change(f);
  f.client.activate = async () => ({ success: false, messages: [{ shortText: "Dependency error" }] });
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /saved inactive/);
  assert.equal(f.repo.draft(draft.change_id).state, "needs-inspection");
  assert.equal(f.calls.some(c => c[0] === "unlock"), true);
});
test("network failure on write leaves an uncertain state and prevents duplicate write", async () => {
  const f = fixture(), draft = await change(f);
  f.client.setObjectSource = async () => { throw Error("Connection reset"); };
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /write was attempted/);
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /not ready/);
});
for (const kind of ["PROG", "CLAS", "FUNC"]) {
  test("create " + kind + " is deferred until apply with the right parent and type", async () => {
    const f = fixture(kind); f.absent();
    const draft = await f.repo.execute("create_sap_object", { object_type: kind, object_name: "ZTEST",
      package: "$TMP", function_group: "ZGROUP", source: "new source", description: "Test" });
    assert.equal(f.calls.some(c => c[0] === "create"), false);
    await f.repo.apply(draft.change_id, { source: draft.source });
    const options = f.calls.find(c => c[0] === "create")[1];
    assert.equal(options.parentName, kind === "FUNC" ? "ZGROUP" : "$TMP");
    assert.equal(options.objtype, { PROG: "PROG/P", CLAS: "CLAS/OC", FUNC: "FUGR/FF" }[kind]);
  });
}
test("same-name object created after preview cannot be overwritten", async () => {
  const f = fixture(); f.absent();
  const draft = await f.repo.execute("create_sap_object", { object_type: "PROG", object_name: "ZTEST", package: "$TMP", description: "Test", source: "new" });
  f.present();
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source }), /Already exists/);
  assert.equal(f.calls.some(c => c[0] === "write"), false);
});
test("transport is sent with write; source verification failure is not reported as success", async () => {
  const f = fixture(), draft = await change(f);
  f.client.activate = async () => ({ success: true, messages: [] });
  await assert.rejects(f.repo.apply(draft.change_id, { source: draft.source, transport: "DEVK900001" }), /active source differs/);
  assert.equal(f.calls.find(c => c[0] === "write")[3], "DEVK900001");
});
test("credentials cannot be redirected by a source URI", () => {
  assert.throws(() => adtPath("https://other.invalid/source"), /outside/);
  assert.throws(() => adtPath("//other.invalid/source"), /outside/);
  assert.throws(() => adtPath("../../../../outside", "/sap/bc/adt/x"), /outside/);
  assert.throws(() => sourcePath({ metaData: {} }, "/sap/bc/adt/programs/x"), /did not expose/);
});
test("invalid bounds and missing revisions fail before writes", async () => {
  const f = fixture();
  await assert.rejects(f.repo.execute("search_sap_objects", { query: "Z*", limit: Infinity }), /limit/);
  await assert.rejects(f.repo.execute("modify_sap_object", { object_type: "PROG", object_name: "ZTEST", source: "x" }), /base_revision/);
  await assert.rejects(f.repo.execute("apply", {}), /Unknown/);
  assert.equal(f.calls.length, 0);
});

test("where-used counts a place inside a class method from where SAP says the method starts", async () => {
  const mapped = [];
  const client = {
    async usageReferences() { return [{ objectIdentifier: "ABAPFULLNAME;ZCL_A" }, { objectIdentifier: "" }]; },
    async usageReferenceSnippets(used) {
      assert.equal(used.length, 1);
      return [{ objectIdentifier: "ABAPFULLNAME;ZCL_A", snippets: [
        { content: "show_source( ).", description: "", uri: { uri: "/sap/bc/adt/oo/classes/zcl_a/source/main", type: "CLAS/OM", name: "RUN",
          start: { line: 3, column: 4 }, end: { line: 3, column: 15 } } },
        { content: "show_source( ).", description: "", uri: { uri: "/sap/bc/adt/oo/classes/zcl_a/source/main", type: "CLAS/OM", name: "RUN",
          start: { line: 5, column: 4 }, end: { line: 5, column: 15 } } },
        { content: "PERFORM x.", description: "", uri: { uri: "/sap/bc/adt/programs/programs/zp/source/main",
          start: { line: 12, column: 2 }, end: { line: 12, column: 9 } } }] }];
    },
    async fragmentMappings(url, type, name) { mapped.push([url, type, name]); return { uri: url, line: 100, column: 2 }; }
  };
  const places = await createRepository({ client, systemId: "S" }).whereUsed("/sap/bc/adt/oo/classes/zcl_b/source/main", 7, 9);
  assert.deepEqual(mapped, [["/sap/bc/adt/oo/classes/zcl_a/source/main", "CLAS/OM", "RUN"]]);
  assert.deepEqual(places.map(p => [p.uri, p.line, p.column, p.end_line]), [
    ["/sap/bc/adt/oo/classes/zcl_a/source/main", 102, 4, 102],
    ["/sap/bc/adt/oo/classes/zcl_a/source/main", 104, 4, 104],
    ["/sap/bc/adt/programs/programs/zp/source/main", 12, 2, 12]]);
});
