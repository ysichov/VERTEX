"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mcp = require("../mcp");
const versions = require("../versions");

const METHOD = "ZCL_AVE_POPUP                 BUILD_LAYOUT";

// Shaped as ZCL_SDE_ADT_RES_VERSIONS and ZCL_SDE_ADT_RES_REVIEW write them.
function sap(paths) {
  return {
    context: {},
    fetch: async (_, path) => {
      paths.push(path);
      const url = new URL(path, "http://sap");
      const name = decodeURIComponent(url.pathname.split("/").pop());
      const q = url.searchParams;
      if (url.pathname.startsWith("/sap/bc/adt/zsde/review/")) {
        if (q.get("part")) {
          return JSON.stringify({ request: "devk900578", part: q.get("part").toLowerCase(),
            part_type: "meth", table: true, saved: true, ddic: false, saved_at: "20260913150000",
            versno_old: "00011", versno_new: "00012", added: 1, deleted: 0,
            blocks: [{ hunk_key: "h1", hunk_no: 1, start_line: 2, change_count: 1,
                       change_kind: "inserted", author: "SYCHOV", author_name: "Yurii Sychov",
                       op_from: 2, op_to: 2, action: "", reviewer: "", reviewer_name: "",
                       changed_at: "", note: "", messages: [] }],
            ops: [{ op: "=", text: "METHOD build_layout." }, { op: "+", text: "  SORT lt_fields." },
                  { op: "=", text: "ENDMETHOD." }] });
        }
        if (name === "DEVK900999") {
          return JSON.stringify({ request: "devk900999", table: true, saved: false, objects: [],
                                  reviewers: [], history: [] });
        }
        return JSON.stringify({ request: "devk900578", remote: "", table: true, saved: true,
          saved_at: "20260913150000", saved_by: "SYCHOV",
          objects: [{ objtype: "METH", obj_name: METHOD, class_name: "ZCL_AVE_POPUP", group: "",
                      display_name: "ZCL_AVE_POPUP=>BUILD_LAYOUT", author: "SYCHOV",
                      author_name: "Yurii Sychov", is_created: false, hunks: 2, inserted: 3,
                      deleted: 1, modified: 1, approved: 0, declined: 0, open: 2 }],
          reviewers: [], history: [] });
      }
      if (q.get("to") !== null) {
        const ops = [];
        for (let i = 1; i <= 20; i++) {
          ops.push({ op: "=", text: "  line " + i + "." });
          if (i === 10) {
            ops.push({ op: "-", text: "  lv_width = 20." });
            ops.push({ op: "+", text: "  lv_width = 40." });
          }
        }
        if (q.get("to") === "99998") {
          for (let i = 0; i < 5000; i++) { ops.push({ op: "=", text: "  a long line of the active source, number " + i + "." }); }
        }
        return JSON.stringify({ object: "zcl_ave_popup", type: "clas", part: q.get("part").toLowerCase(),
          part_type: "meth", from: q.get("from"), to: q.get("to"), added: 1, deleted: 1, kept: 20, ops: ops });
      }
      if (name === "NOPE") { return "ERROR:NOBACKEND:HTTP 404: program NOPE does not exist"; }
      if (name === "DEVK900578") {
        return JSON.stringify({ object: "devk900578", type: "tr", scope: true, parts: [
          { class: "", unit: "ZCL_AVE_POPUP", name: "ZCL_AVE_POPUP", part_type: "CLAS" },
          { class: "", unit: "ZEXAMPLE_REPORT", name: "ZEXAMPLE_REPORT", part_type: "REPS" }
        ] });
      }
      if (q.get("part")) {
        return JSON.stringify({ object: "zcl_ave_popup", type: "clas", part: q.get("part").toLowerCase(),
          part_type: "meth", versions: [
            { version: "99998", date: "20260913", time: "101500", author: "SYCHOV",
              author_name: "Yurii Sychov", request: "", task: "" },
            { version: "00012", date: "20260912", time: "170000", author: "SYCHOV",
              author_name: "Yurii Sychov", request: "DEVK900578", task: "DEVK900579" },
            { version: "00011", date: "20260901", time: "090000", author: "MUELLER",
              author_name: "Anna Mueller", request: "DEVK900500", task: "DEVK900501" }
          ] });
      }
      return JSON.stringify({ object: "zcl_ave_popup", type: "clas", scope: false, parts: [
        { class: "ZCL_AVE_POPUP", unit: "BUILD_LAYOUT", name: METHOD, part_type: "METH" },
        { class: "ZCL_AVE_POPUP", unit: "Public section", name: "ZCL_AVE_POPUP                 CU", part_type: "CPUB" }
      ] });
    }
  };
}

const empty = { reply: "", type: "", name: "", view: "parts", part: "", part_type: "",
                version: "", review_object: "", review_type: "" };

test("parts come with their exact keys, and a scope says what its entries are", async () => {
  const own = await versions.callTool(sap([]), "sap_object_parts", { type: "clas", name: "zcl_ave_popup" });
  assert.match(own.content[0].text, /is an object/);
  assert.ok(own.content[0].text.includes('"' + METHOD + '"  METH  BUILD_LAYOUT'));
  const scope = await versions.callTool(sap([]), "sap_object_parts", { type: "TR", name: "DEVK900578" });
  assert.match(scope.content[0].text, /holds objects/);
  const missing = await versions.callTool(sap([]), "sap_object_parts", { type: "PROG", name: "NOPE" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /HTTP 404: program NOPE/);
});

test("versions are listed without asking for a line of source", async () => {
  const paths = [];
  const result = await versions.callTool(sap(paths), "sap_part_versions",
    { type: "CLAS", name: "ZCL_AVE_POPUP", part: METHOD, part_type: "meth" });
  assert.match(result.content[0].text, /99998 is the active version/);
  assert.match(result.content[0].text, /00012\s+20260912/);
  assert.equal(paths[0], "/sap/bc/adt/zsde/versions/ZCL_AVE_POPUP?type=CLAS&part="
               + encodeURIComponent(METHOD) + "&ptype=METH");
  assert.doesNotMatch(paths.join(" "), /from=|to=/);
});

test("the review summary is read the way the review server reads it", async () => {
  const result = await versions.callTool(sap([]), "sap_transport_changes", { request: "DEVK900578" });
  assert.match(result.content[0].text, /Transport DEVK900578 changed 1 object/);
});

test("a plan comes back carrying the keys as SAP gave them", async () => {
  const diff = await versions.checkPlan(sap([]), { ...empty, reply: "The last change.",
    type: "clas", name: "zcl_ave_popup", view: "diff", part: METHOD.toLowerCase(),
    part_type: "meth", version: "12" });
  assert.deepEqual(diff, { reply: "The last change.", type: "CLAS", name: "ZCL_AVE_POPUP",
    view: "diff", part: METHOD, part_type: "METH", version: "00012",
    review_object: "", review_type: "" });

  const review = await versions.checkPlan(sap([]), { ...empty, type: "TR", name: "DEVK900578",
    view: "review_object", review_object: METHOD, review_type: "meth" });
  assert.equal(review.review_object, METHOD);
  assert.equal(review.review_type, "METH");
});

test("a plan the system does not bear out is refused with the reason", async () => {
  const s = sap([]);
  await assert.rejects(versions.checkPlan(s, { ...empty, type: "CLAS", name: "ZCL_AVE_POPUP",
    view: "versions", part: "ZCL_AVE_POPUP BUILD_LAYOUT", part_type: "METH" }),
    /has no part "ZCL_AVE_POPUP BUILD_LAYOUT" of type METH\. A method's key is the class name padded/);
  await assert.rejects(versions.checkPlan(s, { ...empty, type: "TR", name: "DEVK900578",
    view: "versions", part: "ZCL_AVE_POPUP", part_type: "CLAS" }),
    /ZCL_AVE_POPUP is an object in DEVK900578: it is opened as CLAS ZCL_AVE_POPUP/);
  await assert.rejects(versions.checkPlan(s, { ...empty, type: "CLAS", name: "ZCL_AVE_POPUP",
    view: "diff", part: METHOD, part_type: "METH", version: "7" }),
    /has no version 7/);
  await assert.rejects(versions.checkPlan(s, { ...empty, type: "CLAS", name: "ZCL_AVE_POPUP",
    view: "review" }), /A review belongs to a transport request/);
  await assert.rejects(versions.checkPlan(s, { ...empty, type: "TR", name: "DEVK900999",
    view: "review" }), /No review has been prepared in AVE for DEVK900999/);
  await assert.rejects(versions.checkPlan(s, { ...empty, type: "PROG", name: "NOPE",
    view: "parts" }), /The plan opens PROG NOPE, and SAP answered: HTTP 404/);
  await assert.rejects(versions.checkPlan(s, { ...empty, type: "CLAS", name: "ZCL_AVE_POPUP",
    view: "blame" }), /a view called blame/);
});

test("an empty name is an answer that goes nowhere and reads nothing", async () => {
  const paths = [];
  const plan = await versions.checkPlan(sap(paths), { ...empty, reply: "No such object." });
  assert.equal(plan.name, "");
  assert.equal(plan.reply, "No such object.");
  assert.deepEqual(paths, []);
});

test("a version's change is read against the version below it, or against the one named", async () => {
  const paths = [];
  const result = await versions.callTool(sap(paths), "sap_version_diff",
    { type: "CLAS", name: "ZCL_AVE_POPUP", part: METHOD, part_type: "METH", version: "12" });
  const text = result.content[0].text;
  assert.equal(result.isError, undefined);
  assert.match(paths[1], /&from=00011&to=00012$/);
  assert.match(text, /^--- .* version 00011\n\+\+\+ .* version 00012/);
  assert.match(text, /-   lv_width = 20\./);
  assert.match(text, /\+   lv_width = 40\./);
  assert.match(text, /\.\.\./, "unchanged lines far from the change are folded");
  assert.doesNotMatch(text, /line 1\./);

  const named = [];
  await versions.callTool(sap(named), "sap_version_diff",
    { type: "CLAS", name: "ZCL_AVE_POPUP", part: METHOD, part_type: "METH", version: "99998", from: "11" });
  assert.match(named[1], /&from=00011&to=99998$/);

  const full = await versions.callTool(sap([]), "sap_version_diff",
    { type: "CLAS", name: "ZCL_AVE_POPUP", part: METHOD, part_type: "METH", version: "00012", full: true });
  assert.match(full.content[0].text, /line 1\./);
  assert.doesNotMatch(full.content[0].text, /\.\.\./);
});

test("a version that is not listed is refused before any source is asked for", async () => {
  const paths = [];
  const result = await versions.callTool(sap(paths), "sap_version_diff",
    { type: "CLAS", name: "ZCL_AVE_POPUP", part: METHOD, part_type: "METH", version: "7" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /has no version 7/);
  assert.equal(paths.length, 1);
  assert.doesNotMatch(paths[0], /to=/);
});

test("a whole source too long to read well is cut, and says where", async () => {
  const result = await versions.callTool(sap([]), "sap_version_diff",
    { type: "CLAS", name: "ZCL_AVE_POPUP", part: METHOD, part_type: "METH", version: "99998", full: true });
  const text = result.content[0].text;
  assert.ok(text.length <= mcp.BUDGET + 300);
  assert.match(text, /\(cut here after \d+ lines, because the rest would have grown too long/);
});

test("the Versions endpoint serves the lists, the sources and the review's own diff", async () => {
  const server = mcp.create({ ...sap([]),
    pages: { "/versions": { tools: versions.TOOLS, call: versions.callTool } } });
  const running = await server.start();
  const post = async body => {
    const response = await fetch(running.url.replace(/\/mcp$/, "/versions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + server.token },
      body: JSON.stringify(body)
    });
    return response.json();
  };
  try {
    const listed = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.deepEqual(listed.result.tools.map(t => t.name),
                     ["sap_object_parts", "sap_version_diff", "sap_part_versions",
                      "sap_transport_changes", "sap_transport_diff"]);
    const diff = await post({ jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "sap_transport_diff",
                arguments: { request: "DEVK900578", object: METHOD, object_type: "METH" } } });
    assert.match(diff.result.content[0].text, /block 1 · inserted, 1 line/);
    assert.match(diff.result.content[0].text, /\+   SORT lt_fields\./);
  } finally { await server.stop(); }
});
