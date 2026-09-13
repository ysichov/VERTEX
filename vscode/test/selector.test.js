"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mcp = require("../mcp");
const selector = require("../selector");

// Shaped as ZCL_SDE_ADT_RES_JOIN writes it: SFLIGHT alone, or joined with SCARR.
function layout(join) {
  const own = [
    { sel: true, pos: 1, alias: "T0", tabname: "SFLIGHT", fieldname: "CARRID", key: true,
      ddtext: "Airline Code", datatype: "CHAR", aggs: ["COUNT"], agg: "COUNT" },
    { sel: true, pos: 2, alias: "T0", tabname: "SFLIGHT", fieldname: "FLDATE", key: true,
      ddtext: "Flight date", datatype: "DATS", aggs: ["COUNT", "MIN", "MAX"], agg: "COUNT" },
    { sel: true, pos: 3, alias: "T0", tabname: "SFLIGHT", fieldname: "PRICE", key: false,
      ddtext: "Airfare", datatype: "CURR", aggs: ["SUM", "AVG", "MIN", "MAX", "COUNT"], agg: "SUM" }
  ];
  const joined = join.includes("SCARR");
  return {
    table: "sflight", sql: "SELECT", pivot: false, rows: null,
    candidates: [{ tabname: "SCARR", ddtext: "Airline", direction: "O",
                   alias: joined ? "T1" : "", selected: joined }],
    tables: joined ? [{ alias: "T1", tabname: "SCARR", ddtext: "Airline", jtype: "INNER",
                        cond: "t1~carrid = t0~carrid" }] : [],
    fields: joined ? own.concat([{ sel: true, pos: 4, alias: "T1", tabname: "SCARR",
                                   fieldname: "CARRNAME", key: false, ddtext: "Airline name",
                                   datatype: "CHAR", aggs: ["COUNT"], agg: "COUNT" }]) : own
  };
}

function sap(paths) {
  return {
    context: {},
    fetch: async (_, path) => {
      paths.push(path);
      const url = new URL(path, "http://sap");
      if (!url.pathname.startsWith("/sap/bc/adt/zsde/join/")) { return "ERROR:unexpected " + path; }
      if (url.pathname.endsWith("/NOPE")) { return "ERROR:NOBACKEND:HTTP 404: no table NOPE"; }
      const join = [...url.searchParams.entries()].filter(([k]) => /^t\d+$/.test(k)).map(([, v]) => v);
      if (join.includes("SBOOK")) {
        return "ERROR:HTTP 400: SBOOK is not among the tables offered around SFLIGHT.";
      }
      return JSON.stringify(layout(join));
    }
  };
}

const none = { rows: [], cols: [], vals: [] };

test("the layout is asked for without a row count, so SAP reads no row", () => {
  const path = selector.layoutPath("sflight", ["scarr", " "]);
  assert.equal(path, "/sap/bc/adt/zsde/join/SFLIGHT?t1=SCARR");
  assert.doesNotMatch(path, /rows/);
});

test("the tool gives fields for filters, tables to join and keys for the rest", async () => {
  const paths = [];
  const result = await selector.callTool(sap(paths), "sap_table_layout", { table: "sflight" });
  const text = result.content[0].text;
  assert.equal(result.isError, undefined);
  assert.match(text, /CARRID\s+key CHAR\s+Airline Code/);
  assert.match(text, /SCARR\s+foreign key\s+Airline/);
  assert.match(text, /t0~price\s+Airfare\s+SUM AVG MIN MAX COUNT/);
  const missing = await selector.callTool(sap(paths), "sap_table_layout", {});
  assert.equal(missing.isError, true);
});

test("a plan comes back written the way the page writes it", async () => {
  const plan = await selector.checkPlan(sap([]), {
    reply: "SFLIGHT for AA with the airline name.",
    table: "sflight",
    filters: [{ field: "CARRID", sign: "I", option: "EQ", low: "AA", high: "stray" },
              { field: "fldate", sign: "E", option: "BT", low: "20260101", high: "20260131" }],
    join: ["scarr"],
    fields: ["T1~CARRNAME", "t0~carrid"],
    pivot: none
  });
  assert.deepEqual(plan, {
    reply: "SFLIGHT for AA with the airline name.",
    table: "SFLIGHT",
    filters: [
      { field: "carrid", text: "Airline Code", sign: "I", option: "EQ", low: "AA", high: "" },
      { field: "fldate", text: "Flight date", sign: "E", option: "BT", low: "20260101", high: "20260131" }
    ],
    join: ["SCARR"],
    fields: ["t1~carrname", "t0~carrid"],
    pivot: none
  });
});

test("a plan naming what the dictionary does not have is refused with the reason", async () => {
  const base = { reply: "", table: "SFLIGHT", filters: [], join: [], fields: [], pivot: none };
  await assert.rejects(selector.checkPlan(sap([]), { ...base,
    filters: [{ field: "CARRNAME", sign: "I", option: "EQ", low: "X", high: "" }] }),
    /CARRNAME, which SFLIGHT does not have/);
  await assert.rejects(selector.checkPlan(sap([]), { ...base, join: ["SBOOK"] }),
    /SAP answered: HTTP 400: SBOOK is not among the tables offered/);
  await assert.rejects(selector.checkPlan(sap([]), { ...base, table: "NOPE" }),
    /SAP answered: HTTP 404: no table NOPE/);
  await assert.rejects(selector.checkPlan(sap([]), { ...base,
    filters: [{ field: "FLDATE", sign: "I", option: "BT", low: "20260101", high: "" }] }),
    /without an upper bound/);
  await assert.rejects(selector.checkPlan(sap([]), { ...base, fields: ["t1~carrname"] }),
    /no such key/);
  await assert.rejects(selector.checkPlan(sap([]), { ...base,
    pivot: { rows: ["t0~fldate"], cols: [], vals: [{ key: "t0~carrid", agg: "SUM" }] } }),
    /the pivot allows COUNT for it/);
});

test("an empty table is an answer that changes nothing and reads nothing", async () => {
  const paths = [];
  const plan = await selector.checkPlan(sap(paths), {
    reply: "There is no such table.", table: "", filters: [], join: [], fields: [], pivot: none
  });
  assert.equal(plan.table, "");
  assert.equal(plan.reply, "There is no such table.");
  assert.deepEqual(paths, []);
});

test("the SelecTor endpoint serves its own tool and leaves the review on /mcp alone", async () => {
  const paths = [];
  const server = mcp.create({ ...sap(paths),
                              pages: { "/selector": { tools: selector.TOOLS, call: selector.callTool } } });
  const running = await server.start();
  const post = async (route, body) => {
    const response = await fetch(running.url.replace(/\/mcp$/, route), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + server.token },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: response.status === 200 ? await response.json() : null };
  };
  try {
    const own = await post("/selector", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.deepEqual(own.body.result.tools.map(t => t.name), ["sap_table_layout"]);
    const review = await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(review.body.result.tools.map(t => t.name),
                     ["sap_transport_changes", "sap_transport_diff"]);
    const called = await post("/selector", { jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "sap_table_layout", arguments: { table: "SFLIGHT", join: ["SCARR"] } } });
    assert.match(called.body.result.content[0].text, /t1~carrname/);
    assert.deepEqual(paths, ["/sap/bc/adt/zsde/join/SFLIGHT?t1=SCARR"]);
    const crossed = await post("/selector", { jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "sap_transport_changes", arguments: { request: "X" } } });
    assert.equal(crossed.body.error.code, -32602);
  } finally { await server.stop(); }

  const plain = mcp.create({ ...sap(paths) });
  const started = await plain.start();
  try {
    const response = await fetch(started.url.replace(/\/mcp$/, "/selector"), {
      method: "POST", headers: { Authorization: "Bearer " + plain.token }, body: "{}"
    });
    assert.equal(response.status, 404);
  } finally { await plain.stop(); }
});
