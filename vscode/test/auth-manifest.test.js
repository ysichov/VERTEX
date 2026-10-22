"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const manifest = require("../package.json");
const configuration = Array.isArray(manifest.contributes.configuration)
  ? manifest.contributes.configuration.find(entry => entry.properties["vertex.systems"])
  : manifest.contributes.configuration;
const item = configuration.properties["vertex.systems"].items;
test("vertex.systems declares authType, snc and rfc, and no password", () => {
  assert.deepEqual(item.properties.authType.enum, ["basic", "snc"]);
  assert.ok(item.properties.snc.properties.partnerName);
  assert.ok(item.properties.rfc.properties.ashost && item.properties.rfc.properties.sysnr);
  assert.equal(item.properties.password, undefined);
  // Since 0.9.11 a system connects only directly: no SAP ADT extension destination alternative.
  assert.deepEqual(item.required, ["url", "user"]);
  assert.equal(item.anyOf, undefined);
});
test("the auth packages are registry dependencies", () => {
  for (const p of ["@mcp-abap-adt/auth-broker", "@mcp-abap-adt/auth-providers", "@mcp-abap-adt/auth-stores", "@mcp-abap-adt/auth-errors", "@mcp-abap-adt/connection"]) {
    assert.match(manifest.dependencies[p], /^\^\d/);
  }
});
