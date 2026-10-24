"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../local-debug-adapter");

test("local debug adapter supplies the VERTEX Smart Debugger picture and variables", async () => {
  const commands = [], published = [];
  const vscode = { debug: { breakpoints: [] }, commands: { async executeCommand(command) { commands.push(command); } } };
  const document = { uri: { fsPath: "C:/work/src/ztest.prog.abap" } };
  const adapter = create(vscode, document, async () => {}, picture => published.push(picture));
  adapter.update({ frame: "START-OF-SELECTION", source: document.uri.fsPath, line: 12,
    variables: [{ name: "a", value: "0", scope: "Script" }] });
  assert.equal(adapter.picture().stopped.at, "ZTEST:12");
  assert.equal(adapter.picture().stopped.frames[0].url, document.uri.fsPath);
  assert.deepEqual(await adapter.command("scopes"), { groups: [{ id: "vertex-local-variables", name: "Locals" }], sy: null });
  assert.deepEqual((await adapter.command("children", { id: "vertex-local-variables" })).children[0].value, "0");
  await adapter.command("step", { kind: "into" });
  assert.deepEqual(commands, ["workbench.action.debug.stepInto"]);
  assert.equal(published.length, 1);
});

test("a waited local step returns its stopped frame and variables together", async () => {
  const vscode = { debug: { breakpoints: [] }, commands: { async executeCommand() {} } };
  const document = { uri: { fsPath: "C:/work/src/ztest.prog.abap" } };
  const adapter = create(vscode, document, async () => {}, () => {});
  const step = adapter.command("step", { kind: "into", wait: true });
  adapter.update({ frame: "START-OF-SELECTION", source: document.uri.fsPath, line: 14, stopEvent: true,
    variables: [{ name: "a", value: "5" }] });
  const stopped = await step;
  assert.equal(stopped.picture.stopped.frames[0].line, 14);
  assert.equal(stopped.groups[0].children[0].value, "5");
});

test("a waited step ignores an old polled frame until a new stop event", async () => {
  const vscode = { debug: { breakpoints: [] }, commands: { async executeCommand() {} } };
  const document = { uri: { fsPath: "C:/work/src/ztest.prog.abap" } };
  const adapter = create(vscode, document, async () => {}, () => {});
  adapter.update({ frame: "START-OF-SELECTION", source: document.uri.fsPath, line: 12, variables: [] });
  let resolved = false;
  const step = adapter.command("step", { kind: "into", wait: true }).then(value => { resolved = true; return value; });
  adapter.update({ frame: "START-OF-SELECTION", source: document.uri.fsPath, line: 12, variables: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false);
  adapter.update({ frame: "START-OF-SELECTION", source: document.uri.fsPath, line: 14,
    variables: [], stopEvent: true });
  assert.equal((await step).picture.stopped.frames[0].line, 14);
});

test("local structure fields can be expanded and selected separately", async () => {
  const vscode = { debug: { breakpoints: [] }, commands: { async executeCommand() {} } };
  const document = { uri: { fsPath: "C:/work/src/ztest.prog.abap" } };
  const adapter = create(vscode, document, async () => {}, () => {});
  adapter.update({ frame: "START-OF-SELECTION", source: document.uri.fsPath, line: 12,
    variables: [{ name: "ls_result", value: { amount: 42, currency: "EUR" } }] });
  const roots = (await adapter.command("children", { id: "vertex-local-variables" })).children;
  assert.equal(roots[0].meta, "structure");
  assert.deepEqual((await adapter.command("children", { id: "ls_result" })).children.map(item => item.name),
    ["amount", "currency"]);
});

test("a structure of a transpiler stop opens to its fields, whichever variable it is", async () => {
  const { create } = require("../local-debug-adapter");
  const vscode = { debug: { breakpoints: [] }, Uri: { file: p => ({ fsPath: p }) } };
  const records = [{ file: "z.prog.abap", line: 1, owner: "Z", routine: "START-OF-SELECTION",
    changed: { lv_a: 1, ls_b: { amount: 5, currency: "EUR" }, ls_c: { x: 1 } } }];
  const adapter = create(vscode, { uri: { fsPath: "z.prog.abap" } }, async () => ({ records, live: null }), () => {});
  await adapter.command("run", { selection: {} });
  assert.equal(adapter.picture().traceLength, 1);
  const fields = (await adapter.command("children", { id: "ls_c" })).children;
  assert.deepEqual(fields.map(field => field.name), ["x"], "not only the first variable can be opened");
  assert.equal((await adapter.command("children", { id: "ls_b" })).children.find(f => f.name === "amount").value, "5");
});

test("the panel sees only the breakpoints of its own object's sources, and Clear all takes only those", async () => {
  const at = (id, file, line) => ({ id, enabled: true, location: { uri: { scheme: "file", fsPath: file }, range: { start: { line: line - 1 } } } });
  const removed = [];
  const vscode = { debug: { breakpoints: [at("A", "C:/TMP/test.prog.abap", 3), at("B", "C:/work/zvertex_debug_lab.prog.abap", 18)],
    removeBreakpoints(list) { removed.push(...list.map(b => b.id)); } }, commands: { async executeCommand() {} } };
  const document = { uri: { fsPath: "C:/TMP/test.prog.abap" } };
  const adapter = create(vscode, document, async () => {}, () => {}, () => ({ files: ["C:/TMP/test.prog.abap"] }));
  assert.deepEqual(adapter.picture().breakpoints.map(b => b.id), ["A"]);
  await adapter.command("clear", {});
  assert.deepEqual(removed, ["A"]);
  await adapter.command("allBreakpoints", { on: true });
  assert.deepEqual(adapter.picture().breakpoints.map(b => b.id), ["A", "B"], "All BP: every ABAP breakpoint");
});

test("an SAP program's run takes the breakpoints of its SAP tabs, and a point set from the panel goes to the tab", async () => {
  const copy = "C:/TMP/vertex-sap-abap/A4H-1/src/zcl_x.clas.abap", tab = "vertex-sap:/abc/CLAS/ZCL_X.abap";
  const at = (id, uri, line) => ({ id, enabled: true, location: { uri, range: { start: { line: line - 1 } } } });
  const added = [];
  const vscode = { debug: { breakpoints: [at("S", { scheme: "vertex-sap", toString: () => tab }, 7),
    at("O", { scheme: "vertex-sap", toString: () => "vertex-sap:/abc/CLAS/ZCL_OTHER.abap" }, 2)], addBreakpoints: list => added.push(...list) },
    Uri: { file: p => ({ scheme: "file", fsPath: p }) }, SourceBreakpoint: function (location) { this.location = location; },
    Location: function (uri, position) { this.uri = uri; this.range = { start: position }; }, Position: function (line) { this.line = line; } };
  const more = { pathOf: uri => uri.scheme === "file" ? uri.fsPath : uri.toString() === tab ? copy : null,
    uriOf: file => file === copy ? { scheme: "vertex-sap", toString: () => tab } : vscode.Uri.file(file) };
  const adapter = create(vscode, { uri: { fsPath: "C:/TMP/vertex-sap-abap/A4H-1/sap/zp.prog.abap" } }, async () => {}, () => {},
    () => ({ root: "C:/TMP/vertex-sap-abap/A4H-1" }), more);
  assert.deepEqual(adapter.picture().breakpoints.map(b => [b.id, b.url, b.line]), [["S", copy, 7]]);
  await adapter.command("set", { url: copy, line: 3 });
  assert.equal(added[0].location.uri.toString(), tab);
});

test("a run still alive is handed to a page opened again", async () => {
  const records = [{ file: "z.prog.abap", line: 1 }, { file: "z.prog.abap", line: 2 }];
  const live = { next: async () => ({ records: [{ file: "z.prog.abap", line: 3 }], ended: false }), stop() {}, output: "Hello" };
  const adapter = create({ debug: { breakpoints: [{ id: "B", enabled: true, location: { uri: { scheme: "file", fsPath: "z.prog.abap" },
    range: { start: { line: 0 } } } }] } }, { uri: { fsPath: "z.prog.abap" } }, async () => ({ records: records.slice(), live }), () => {});
  await adapter.command("run", { selection: {} });
  await adapter.command("step", { live: true, kind: "into" });
  const restored = await adapter.command("restore");
  assert.deepEqual(restored.trace.map(r => r.line), [1, 2, 3]);
  assert.equal(restored.ended, false);
  assert.equal(restored.output, "Hello");
});

test("a kept transpiler run opens at its cited step with its output", async () => {
  const vscode = { debug: { breakpoints: [] }, commands: { async executeCommand() {} } };
  const document = { uri: { fsPath: "C:/runs/r/sources/0/zlab.prog.abap" } };
  const records = [1, 2, 3].map(line => ({ file: document.uri.fsPath, line, owner: "ZLAB", routine: "ZLAB", changed: { n: line } }));
  const adapter = create(vscode, document, () => { throw new Error("kept"); }, () => {}, null,
    { trace: { records, output: "Returned result: 0", at: 1 } });
  assert.equal(adapter.picture().stopped.at, "ZLAB:2");
  const restored = await adapter.command("restore");
  assert.equal(restored.at, 1);
  assert.equal(restored.output, "Returned result: 0");
  assert.equal(restored.trace.length, 3);
  await assert.rejects(adapter.command("run"), /kept/);
});

test("local VERTEX Smart Debugger watchpoint stops replay on a changed structure component", async () => {
  const vscode = { debug: { breakpoints: [] }, commands: { async executeCommand() {} } };
  const document = { uri: { fsPath: "C:/runs/zlab.prog.abap" } };
  const records = [
    { file: document.uri.fsPath, line: 1, owner: "ZLAB", routine: "ZLAB", changed: { "LS_VAR-COUNT": 1 } },
    { file: document.uri.fsPath, line: 2, owner: "ZLAB", routine: "ZLAB", changed: {} },
    { file: document.uri.fsPath, line: 3, owner: "ZLAB", routine: "ZLAB", changed: { "LS_VAR-COUNT": 2 } },
    { file: document.uri.fsPath, line: 4, owner: "ZLAB", routine: "ZLAB", changed: {} }
  ];
  const adapter = create(vscode, document, () => {}, () => {}, null, { trace: { records, at: 0 } });
  const point = await adapter.command("watchpointAdd", { name: "ls_var-count" });
  assert.equal(point.name, "LS_VAR-COUNT");
  await adapter.command("step", { kind: "continue" });
  assert.equal(adapter.picture().stopped.at, "ZLAB:3");
  assert.equal(adapter.picture().stopped.watchpoints[0].id, point.id);
  await adapter.command("watchpointRemove", { id: point.id });
  assert.deepEqual(adapter.picture().watchpoints, []);
});
