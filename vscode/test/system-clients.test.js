"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readSystem } = require("../auth/systems");
const { rows } = require("../system-table");

const entry = { name: "ER6", url: "https://h", user: "u", client: "600", clients: ["610"] };

test("the entry's client is the default, and the picked one of its list takes over", () => {
  assert.equal(readSystem(entry).system.client, "600");
  assert.deepEqual(readSystem(entry).system.clients, ["600", "610"]);
  assert.equal(readSystem(entry, "610").system.client, "610");
  assert.equal(readSystem(entry, "999").system.client, "600");
  assert.equal(readSystem({ ...entry, client: undefined }).system.client, "610");
  assert.equal(readSystem({ name: "A", url: "https://h", user: "u", client: "100" }).system.clients, undefined);
});

test("clients must be a list of numbers", () => {
  assert.match(readSystem({ ...entry, clients: "610" }).error, /list of SAP clients/);
  assert.match(readSystem({ ...entry, clients: ["abc"] }).error, /one to three digits/);
  assert.deepEqual(readSystem({ ...entry, clients: [610, "610", 620] }).system.clients, ["600", "610", "620"]);
});

test("a client switch changes the login identity, so a password is kept per client", () => {
  const { loginIdentity } = require("../auth/systems");
  assert.notEqual(loginIdentity(readSystem(entry).system), loginIdentity(readSystem(entry, "610").system));
});

test("the table shows the picked client and offers the list", () => {
  const vscode = { workspace: { getConfiguration: () => ({ get: key => key === "systems" ? [entry] : "" }) } };
  const [row] = rows(vscode, name => name === "ER6" ? "610" : undefined);
  assert.equal(row.client, "610");
  assert.deepEqual(row.clients, ["600", "610"]);
});

test("a client added in the table goes after the default and the clients already listed", () => {
  const { clientList } = require("../system-table");
  assert.deepEqual([...clientList({ client: "100" }), "200"], ["100", "200"]);
  assert.deepEqual(clientList({ client: "600", clients: ["600", 610] }), ["600", "610"]);
});

test("a single word is looked up in the system, and only an unknown one goes to the model", async () => {
  const direct = require("../direct-search");
  assert.deepEqual(direct.objectRequest("SCARR"), { query: "SCARR", openEditor: false, word: true });
  assert.equal(direct.objectRequest("two words"), null);
  const opened = [];
  const found = await direct.answer("SCARR", { word: true, search: async () => ({ objects: [{ object_name: "SCARR", object_type: "TABL" }] }), open: async o => opened.push(o) });
  assert.match(found, /SCARR/);
  assert.equal(opened.length, 1);
  assert.equal(await direct.answer("hello", { word: true, search: async () => ({ objects: [] }), open: async () => {} }), null);
  assert.match(await direct.answer("Z_NONE", { search: async () => ({ objects: [] }), open: async () => {} }), /No program/);
});
