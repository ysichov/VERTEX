"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const METHOD = "ZCL_AVE_POPUP                 BUILD_LAYOUT";

/* The Versions script without its wiring, on a document that only remembers
   what was done to it. answer() plays the host: it hands the page one answer
   and calls sdeReady, as the shim does. */
function page(host) {
  function element(tag) {
    return {
      tagName: tag, value: "", className: "", textContent: "", disabled: false,
      selectedIndex: 0, scrollTop: 0, scrollHeight: 0, style: {},
      children: [], options: [], handlers: {},
      classList: { add() {}, remove() {} },
      get text() { return this.textContent; },
      set innerHTML(value) { this.children = []; this.options = []; },
      appendChild(child) {
        this.children.push(child);
        if (child.tagName === "option") { this.options.push(child); }
        return child;
      },
      setAttribute() {},
      addEventListener(name, handler) { this.handlers[name] = handler; },
      focus() {}
    };
  }
  const elements = {};
  const calls = [];
  let waiting = null;
  const globals = {
    document: {
      getElementById(id) { return elements[id] || (elements[id] = element("div")); },
      createElement: element,
      createTextNode: text => ({ textContent: text })
    },
    sdeLoad: (...args) => calls.push(["load", ...args]),
    sdeReview: (...args) => calls.push(["review", ...args]),
    sdeTake: () => waiting
  };
  if (host !== "eclipse") {
    globals.sdeAsk = (...args) => calls.push(["ask", ...args]);
    globals.sdeModels = (...args) => calls.push(["models", ...args]);
  }
  const context = vm.createContext(globals);
  const html = fs.readFileSync(path.join(__dirname, "../../org.vertex.abap.ui/resources/versions.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.split("/* ---------- wiring ---------- */")[0], context);
  context.status = context.note = () => {};
  const answer = data => {
    waiting = typeof data === "string" ? data : JSON.stringify(data);
    context.sdeReady();
  };
  return { context, elements, calls, answer, el: id => globals.document.getElementById(id) };
}

const CLASS_PARTS = { object: "zcl_ave_popup", type: "clas", scope: false, parts: [
  { class: "ZCL_AVE_POPUP", unit: "BUILD_LAYOUT", name: METHOD, part_type: "METH" }] };
const VERSIONS = { object: "zcl_ave_popup", type: "clas", part: METHOD.toLowerCase(), part_type: "meth",
  versions: [{ version: "99998" }, { version: "00012" }, { version: "00011" }] };
const plan = extra => Object.assign({ reply: "", type: "CLAS", name: "ZCL_AVE_POPUP", view: "diff",
  part: METHOD, part_type: "METH", version: "00012", review_object: "", review_type: "" }, extra);

test("a diff plan goes parts, then the part, then the version - each after the last answer", () => {
  const { context, calls, answer } = page();
  context.applyPlan(plan());
  assert.deepEqual(calls, [["load", "ZCL_AVE_POPUP", "CLAS", "", "", "", ""]]);
  answer(CLASS_PARTS);
  assert.deepEqual(calls[1], ["load", "ZCL_AVE_POPUP", "CLAS", METHOD, "METH", "", ""]);
  answer(VERSIONS);
  // The change version 12 made: compared with the version below it.
  assert.deepEqual(calls[2], ["load", "ZCL_AVE_POPUP", "CLAS", METHOD, "METH", "00011", "00012"]);
  assert.equal(context.pending, null);
});

test("a review plan opens the request, its review, then the object in it", () => {
  const { context, calls, answer } = page();
  context.applyPlan(plan({ type: "TR", name: "ALCK900578", view: "review_object", part: "",
                           part_type: "", version: "", review_object: METHOD, review_type: "METH" }));
  answer({ object: "alck900578", type: "tr", scope: true, parts: [
    { class: "", unit: "ZCL_AVE_POPUP", name: "ZCL_AVE_POPUP", part_type: "CLAS" }] });
  assert.deepEqual(calls[1], ["review", "ALCK900578", "", "", ""]);
  assert.equal(context.mode, "R");
  answer({ request: "alck900578", table: true, saved: true, saved_at: "20260913150000",
           saved_by: "SYCHOV", reviewers: [], history: [],
           objects: [{ objtype: "METH", obj_name: METHOD, display_name: "ZCL_AVE_POPUP=>BUILD_LAYOUT",
                       hunks: 1, inserted: 1, deleted: 0, modified: 0, approved: 0, declined: 0, open: 1 }] });
  assert.deepEqual(calls[2], ["review", "ALCK900578", "", METHOD, "METH"]);
});

test("an answer about something else drops the rest of the plan", () => {
  const { context, calls, answer } = page();
  context.applyPlan(plan());
  answer({ object: "z_other", type: "prog", scope: false, parts: [] });
  assert.equal(calls.length, 1);
  assert.equal(context.pending, null);
});

test("an error from SAP stops the plan and the chat says so", () => {
  const { context, calls, answer, el } = page();
  context.applyPlan(plan());
  answer("ERROR:HTTP 400: AVE cannot list the parts of ZCL_AVE_POPUP");
  assert.equal(calls.length, 1);
  assert.equal(context.pending, null);
  assert.match(el("chatlog").children[0].children[1].textContent, /plan stopped here/);
});

test("the assistant is told where the window is, never the source", () => {
  const { context, calls, answer, el } = page();
  el("name").value = "ZCL_AVE_POPUP";
  el("type").value = "CLAS";
  answer(CLASS_PARTS);
  context.loadVersions(context.parts[0]);
  answer(VERSIONS);
  context.loadDiff(1);
  answer({ object: "zcl_ave_popup", part: METHOD.toLowerCase(), from: "00011", to: "00012",
           added: 1, deleted: 0, kept: 1, ops: [{ op: "+", text: "lv_secret = 'source line'." }] });
  const state = context.pageState();
  assert.deepEqual({ view: state.view, part: state.part, version: state.version },
                   { view: "diff", part: METHOD, version: "00012" });

  el("ask").value = "what did Anna change";
  el("model").disabled = false;
  el("model").value = "haiku";
  el("who").value = "claude";
  el("who").options = [{ text: "Claude Code" }];
  context.sendAsk();
  const asked = calls[calls.length - 1];
  assert.equal(asked[0], "ask");
  assert.doesNotMatch(asked[4], /source line/);
});

test("the host's answer is said in the chat and starts the plan", () => {
  const { context, calls, el } = page();
  context.sdeAssistant(JSON.stringify({ call: "ask", model: "claude-haiku-4-5", system: "ALC",
    plan: plan({ reply: "The change version 12 made." }) }));
  const said = el("chatlog").children[0];
  assert.equal(said.children[0].textContent, "Assistant · claude-haiku-4-5 · ALC");
  assert.equal(said.children[2].textContent,
               "CLAS ZCL_AVE_POPUP · ZCL_AVE_POPUP BUILD_LAYOUT (METH) · version 00012");
  assert.deepEqual(calls[0], ["load", "ZCL_AVE_POPUP", "CLAS", "", "", "", ""]);
});

test("in Eclipse the panel says there is no assistant and cannot be used", () => {
  const { context, el, calls } = page("eclipse");
  context.openChat();
  assert.equal(el("send").disabled, true);
  assert.match(el("chatlog").children[0].children[1].textContent, /runs in VS Code for now/);
  assert.deepEqual(calls, []);
});
