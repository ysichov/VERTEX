"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const bsp = require("../bsp-files");
const feed = (app, children) => '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">'
  + children.map(([type, path]) => '<atom:entry><atom:category term="' + type + '"/><atom:title>' + app + '/' + path + '</atom:title></atom:entry>').join('')
  + '</atom:feed>';
test("BSP resources can be listed, read and searched by UI text", async () => {
  const calls = [];
  const files = { "": feed("GRC_RM_RISK", [["folder", "i18n"], ["file", "manifest.json"]]),
    i18n: feed("GRC_RM_RISK", [["file", "i18n/i18n.properties"]]),
    "manifest.json": '{"sap.app":{"title":"{{appTitle}}"}}',
    "i18n/i18n.properties": 'appTitle=Manage Risks\nlabelRiskType=Risk Type\n' };
  const api = { ui5Resource: async (app, path) => { calls.push([app, path]); return files[path]; } };
  assert.deepEqual((await bsp.list(api, { app: "GRC_RM_RISK" })).entries.map(x => x.path), ["i18n", "manifest.json"]);
  assert.equal((await bsp.read(api, { app: "GRC_RM_RISK", path: "i18n/i18n.properties" })).content.split('\n')[1], "labelRiskType=Risk Type");
  const found = await bsp.search(api, { app: "GRC_RM_RISK", query: "Risk Type" });
  assert.deepEqual(found.hits, [{ path: "i18n/i18n.properties", line: 2, text: "labelRiskType=Risk Type" }]);
  assert.equal(found.filesScanned, 2);
  await assert.rejects(bsp.read(api, { app: "GRC_RM_RISK", path: "../secret.txt" }), /Invalid BSP/);
});
