"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { request } = require("../bsp-front");
const { dispatch } = require("../mcp");

test("BSP search finds Manage Risks through the MCP tool", async () => {
  let sql;
  const api = { query: async (statement, rows) => {
    sql = statement;
    assert.equal(rows, 31);
    return { values: [{ APPLNAME: "GRC_RM_RISK", TEXT: "Manage Risks" }] };
  } };
  const deps = { fetch: async (_context, path) => JSON.stringify(await request(api, path)) };
  const listed = await dispatch(deps, { method: "tools/list" });
  assert.ok(listed.tools.some(tool => tool.name === "sap_bsp_search"));
  const result = await dispatch(deps, { method: "tools/call", params: {
    name: "sap_bsp_search", arguments: { query: "Manage Risks" }
  } });
  assert.match(sql, /text LIKE '%Manage Risks%'/);
  assert.match(result.content[0].text, /GRC_RM_RISK — Manage Risks/);
});
