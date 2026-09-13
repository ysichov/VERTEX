"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function page() {
  function element() {
    return { value: "", children: [], options: [], handlers: {},
      set innerHTML(value) { this.children = []; },
      appendChild(child) { this.children.push(child); this.options.push(child); },
      addEventListener(name, handler) { this.handlers[name] = handler; } };
  }
  const elements = {};
  const calls = [];
  const context = vm.createContext({ document: {
    getElementById(id) { return elements[id] || (elements[id] = element()); },
    createElement: element, createTextNode: text => ({ textContent: text })
  }, sdeLoad: (...args) => calls.push(args) });
  const html = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/versions.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.split("/* ---------- wiring ---------- */")[0], context);
  context.status = context.note = () => {};
  context.document.getElementById("name").value = "ALCK900578";
  context.document.getElementById("type").value = "TR";
  context.scope = true;
  return { context, elements, calls };
}

test("transport VRSD rows retain scope and exact padded part keys", () => {
  for (const type of ["REPS", "METH", "TABD", "DOMD", "DTED", "CPUB", "FUNC", "DDLS"]) {
    const { context, elements, calls } = page();
    const name = type === "METH" ? "ZCL_EXAMPLE".padEnd(30) + "METHOD" : "ZEXAMPLE_REPORT";
    context.parts = [{ name, unit: "display label", part_type: type }];
    context.renderParts();
    elements.partlist.children[0].handlers.click();
    assert.deepEqual(calls[0], ["ALCK900578", "TR", name, type, "", ""]);
    assert.equal(context.came_from, null);
  }
});

test("containers expand by technical name and can return to transport", () => {
  for (const type of ["CLAS", "INTF", "FUGR"]) {
    const { context, elements, calls } = page();
    context.parts = [{ name: "Z_CONTAINER", unit: "display label", part_type: type }];
    context.renderParts();
    elements.partlist.children[0].handlers.click();
    assert.deepEqual(calls[0], ["Z_CONTAINER", type, "", "", "", ""]);
    context.goBack();
    assert.deepEqual(calls[1], ["ALCK900578", "TR", "", "", "", ""]);
  }
});
