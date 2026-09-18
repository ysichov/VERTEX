"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function page() {
  function element() {
    return { value: "", checked: false, style: {}, children: [], options: [], handlers: {},
      set innerHTML(value) { this.children = []; },
      appendChild(child) { this.children.push(child); this.options.push(child); },
      addEventListener(name, handler) { this.handlers[name] = handler; } };
  }
  const elements = {};
  const calls = [];
  const found = [];
  const context = vm.createContext({ document: {
    getElementById(id) { return elements[id] || (elements[id] = element()); },
    createElement: element, createTextNode: text => ({ textContent: text })
  }, sdeLoad: (...args) => calls.push(args), sdeRequests: (...args) => found.push(args) });
  const html = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/versions.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.split("/* ---------- wiring ---------- */")[0], context);
  context.status = context.note = () => {};
  context.document.getElementById("name").value = "DEVK900578";
  context.document.getElementById("type").value = "TR";
  context.scope = true;
  return { context, elements, calls, found };
}

test("finding requests sends the user as typed, or nobody for your own", () => {
  const { context, elements, found } = page();
  context.parts = [{ name: "ZCL_OLD", unit: "ZCL_OLD", part_type: "CLAS" }];
  context.findRequests();
  assert.deepEqual(found[0], ["", ""]);
  assert.equal(context.scope, false);
  assert.equal(context.parts.length, 0);
  elements.user.value = " sychov ";
  elements.released.checked = true;
  context.findRequests();
  assert.deepEqual(found[1], ["SYCHOV", "true"]);
});

test("a found request opens as its typed number would", () => {
  const { context, elements, calls } = page();
  context.sdeTake = () => JSON.stringify({ user: "SYCHOV", released: false, requests: [
    { request: "ALCK900123", text: "Fix", owner: "OTHER", owner_name: "Some One",
      type: "workbench", status: "modifiable", date: "20260917", time: "101500" }] });
  context.sdeReady();
  assert.equal(context.showing.view, "requests");
  const rows = elements.root.children[0].children[1].children;
  assert.equal(rows.length, 1);
  elements.type.value = "CLAS";
  rows[0].handlers.click();
  assert.equal(elements.type.value, "TR");
  assert.deepEqual(calls[0], ["ALCK900123", "TR", "", "", "", ""]);
});

test("no requests found is said, not drawn as an empty table", () => {
  const { context } = page();
  const notes = [];
  context.note = text => notes.push(text);
  context.renderRequests({ user: "SYCHOV", released: false, requests: [] });
  context.renderRequests({ user: "SYCHOV", released: true, requests: [] });
  assert.deepEqual(notes, ["No open requests of SYCHOV.", "No requests of SYCHOV."]);
});

test("the finder is offered for transport requests only", () => {
  const { context, elements } = page();
  context.showFinder();
  assert.equal(elements.finder.style.display, "");
  elements.type.value = "CLAS";
  context.showFinder();
  assert.equal(elements.finder.style.display, "none");
});

// The parts are a table now: the rows sit in its body, after any heading.
function partRows(elements) {
  const table = elements.partlist.children.find(child => child.children.length === 2);
  return table.children[1].children;
}

test("parts are a table of type and name, headed by their object", () => {
  const { context, elements, calls } = page();
  elements.name.value = "ZCL_X";
  elements.type.value = "CLAS";
  context.scope = false;
  context.renderPartList({ object: "zcl_x", type: "clas", scope: false, parts: [
    { name: "ZCL_X", unit: "Public section", part_type: "CPUB" },
    { name: "ZCL_X".padEnd(30) + "SHOW", unit: "SHOW", part_type: "METH" }] });
  assert.equal(elements.partlist.children[0].textContent, "ZCL_X");
  const rows = partRows(elements);
  assert.deepEqual(rows.map(r => r.children.map(td => td.textContent)),
    [["CPUB", "Public section"], ["METH", "SHOW"]]);
  rows[1].handlers.click();
  assert.deepEqual(calls[0], ["ZCL_X", "CLAS", "ZCL_X".padEnd(30) + "SHOW", "METH", "", ""]);
});

test("transport VRSD rows retain scope and exact padded part keys", () => {
  for (const type of ["REPS", "METH", "TABD", "DOMD", "DTED", "CPUB", "FUNC", "DDLS"]) {
    const { context, elements, calls } = page();
    const name = type === "METH" ? "ZCL_EXAMPLE".padEnd(30) + "METHOD" : "/ALLOY/GRC_LANGUAGE_TABLE";
    context.parts = [{ name, unit: "display label", part_type: type }];
    context.renderParts();
    partRows(elements)[0].handlers.click();
    assert.deepEqual(calls[0], ["DEVK900578", "TR", name, type, "", ""]);
    assert.equal(context.came_from, null);
  }
});

test("containers expand by technical name and can return to transport", () => {
  for (const type of ["CLAS", "INTF", "FUGR"]) {
    const { context, elements, calls } = page();
    context.parts = [{ name: "Z_CONTAINER", unit: "display label", part_type: type }];
    context.renderParts();
    partRows(elements)[0].handlers.click();
    assert.deepEqual(calls[0], ["Z_CONTAINER", type, "", "", "", ""]);
    context.goBack();
    assert.deepEqual(calls[1], ["DEVK900578", "TR", "", "", "", ""]);
  }
});

const ABOUT_VERSIONS = { name: "versions", handler: "ZCL_SDE_ADT_RES_VERSIONS", backend: "AVE", active: true };

test("what the system does not have is not drawn, and the line under the bar says why", () => {
  const { context, elements } = page();
  context.sdeAbout = () => {};
  context.askAbout(() => {});
  context.sdeTake = () => JSON.stringify({ services: [ABOUT_VERSIONS,
      { name: "review", handler: "ZCL_SDE_ADT_RES_REVIEW", backend: "AVE", active: false }],
    backends: [{ name: "AVE", installed: false }] });
  context.sdeReady();
  assert.equal(context.askingAbout, false);
  assert.equal(elements.finder.style.display, "none");
  context.renderCards();
  assert.equal(elements.cards.children.length, 0);
  assert.equal(elements.missing.hidden, false);
  assert.equal(elements.missing.textContent, "Not on this system: the saved review - "
    + "ZCL_SDE_ADT_RES_REVIEW is not active, because AVE is not installed; finding requests - "
    + "the Simple-Data-Explorer there is older than this window.");
});

test("without the resource the window is for, it opens on what is missing", () => {
  const { context, elements, calls } = page();
  context.INITIAL = { name: "DEVK900578", type: "TR" };
  const asked = [];
  context.sdeAbout = () => asked.push("about");
  context.askAbout(context.startWindow);
  assert.deepEqual(asked, ["about"]);
  context.sdeTake = () => JSON.stringify({ services: [{ ...ABOUT_VERSIONS, active: false }],
    backends: [{ name: "AVE", installed: false }] });
  context.sdeReady();
  assert.equal(calls.length, 0);
  assert.equal(elements.root.className, "setup");
  assert.equal(elements.root.children[0].textContent, "Part of the ABAP half is missing on this system");
  assert.equal(elements.root.children[2].children[0].textContent, "the version history - missing: "
    + "ZCL_SDE_ADT_RES_VERSIONS is not active, because AVE is not installed");
});

test("a system that cannot say what it has keeps every part of the window", () => {
  const { context, elements, calls } = page();
  context.INITIAL = { name: "DEVK900578", type: "TR" };
  context.sdeAbout = () => {};
  context.askAbout(context.startWindow);
  context.sdeTake = () => "ERROR:NOBACKEND:HTTP 404: not found";
  context.sdeReady();
  assert.equal(context.have, null);
  assert.equal(elements.finder.style.display, "");
  assert.equal(elements.missing.hidden, true);
  assert.deepEqual(calls[0], ["DEVK900578", "TR", "", "", "", ""]);
});

test("a 404 with everything there is the resource's own answer, not a setup page", () => {
  const { context, elements } = page();
  context.have = { versions: { active: true }, review: { active: true }, requests: { active: true } };
  context.notFound("HTTP 404: something");
  assert.equal(elements.root.className, "message");
  context.have = null;
  context.notFound("HTTP 404: something");
  assert.equal(elements.root.className, "setup");
});

test("the user field starts as whoever the system says is logged on, and keeps what was typed", () => {
  const about = JSON.stringify({ user: "SYCHOV", services: [ABOUT_VERSIONS], backends: [] });
  const fresh = page();
  fresh.context.sdeAbout = () => {};
  fresh.context.askAbout(() => {});
  fresh.context.sdeTake = () => about;
  fresh.context.sdeReady();
  assert.equal(fresh.elements.user.value, "SYCHOV");

  const typed = page();
  typed.context.document.getElementById("user").value = "PETRENKO";
  typed.context.sdeAbout = () => {};
  typed.context.askAbout(() => {});
  typed.context.sdeTake = () => about;
  typed.context.sdeReady();
  assert.equal(typed.elements.user.value, "PETRENKO");
});

test("a class is shown by section: the section, its methods marked, then the rest", () => {
  const { context, elements, calls } = page();
  elements.name.value = "ZCL_X";
  elements.type.value = "CLAS";
  context.renderPartList({ object: "zcl_x", type: "clas", scope: false, parts: [
    { name: "ZCL_X", unit: "Public section", part_type: "CPUB", section: "public" },
    { name: "ZCL_X", unit: "Private section", part_type: "CPRI", section: "private" },
    { name: "ZCL_X==========CCIMP", unit: "Local class implementation", part_type: "CINC", section: "" },
    { name: "ZCL_X".padEnd(30) + "BUILD", unit: "BUILD", part_type: "METH", section: "private" },
    { name: "ZCL_X".padEnd(30) + "SHOW", unit: "SHOW", part_type: "METH", section: "public" },
    { name: "ZCL_X".padEnd(30) + "ZIF_Y~RUN", unit: "ZIF_Y~RUN", part_type: "METH", section: "public" }] });
  const rows = partRows(elements);
  const text = td => td.textContent || td.children.map(c => c.textContent || "").join("");
  assert.deepEqual(rows.map(r => r.children.map(text)), [
    ["", "CPUB", "Public section"], ["", "METH", "SHOW"], ["", "METH", "ZIF_Y~RUN"],
    ["", "CPRI", "Private section"], ["", "METH", "BUILD"],
    ["", "Other"], ["", "CINC", "Local class implementation"]]);
  assert.equal(rows[0].className, "group pick");
  // The visibility comes first, in its own column; a part of no section has none.
  assert.equal(rows[1].children[0].children[0].className, "vis public");
  assert.equal(rows[4].children[0].children[0].className, "vis private");
  assert.equal(rows[6].children[0].children.length, 0);
  rows[3].handlers.click();
  assert.deepEqual(calls[0], ["ZCL_X", "CLAS", "ZCL_X", "CPRI", "", ""]);
});
