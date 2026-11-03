"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readSystem, canonicalOrigin, loginIdentity, connectionKey } = require("../auth/systems");

const base = { name: "DEV", url: "https://Host.Example.com", client: "100", user: "dev" };

test("a system without authType is basic", () => {
  assert.equal(readSystem(base).system.authType, "basic");
});
test("url and user are required for every type", () => {
  assert.match(readSystem({ ...base, url: "" }).error, /url/);
  assert.match(readSystem({ ...base, user: "" }).error, /user/);
  assert.match(readSystem({ ...base, authType: "snc", user: "", snc: { partnerName: "p:CN=X" }, rfc: { ashost: "h", sysnr: "00" } }).error, /user/);
});
test("a password in settings is refused", () => {
  assert.match(readSystem({ ...base, password: "x" }).error, /password/);
});
test("snc needs snc.partnerName and rfc.ashost/sysnr", () => {
  assert.match(readSystem({ ...base, authType: "snc" }).error, /snc\.partnerName/);
  assert.match(readSystem({ ...base, authType: "snc", snc: { partnerName: "p:CN=X" } }).error, /rfc\.ashost/);
  assert.match(readSystem({ ...base, authType: "snc", snc: { partnerName: "p:CN=X" }, rfc: { ashost: "h", sysnr: "0" } }).error, /rfc\.sysnr/);
  assert.match(readSystem({ ...base, authType: "snc", snc: { partnerName: "p:CN=X", qop: "5" }, rfc: { ashost: "h", sysnr: "00" } }).error, /snc\.qop/);
  assert.ok(readSystem({ ...base, authType: "snc", snc: { partnerName: "p:CN=X" }, rfc: { ashost: "h", sysnr: "00" } }).system);
});
test("snc reaches the system through a message server and its logon group as well", () => {
  const snc = { ...base, authType: "snc", snc: { partnerName: "p:CN=X" } };
  assert.match(readSystem({ ...snc, rfc: { mshost: "ms" } }).error, /rfc\.sysid/);
  assert.match(readSystem({ ...snc, rfc: { mshost: "ms", sysid: "PRD", msserv: "36 00" } }).error, /rfc\.msserv/);
  assert.deepEqual(readSystem({ ...snc, rfc: { mshost: "ms", sysid: "prd" } }).system.rfc, { mshost: "ms", sysid: "PRD", group: "PUBLIC", saprouter: undefined });
  const { rfcAddress, describeAddress } = require("../auth/rfc-wire");
  const direct = readSystem({ ...snc, client: "100", rfc: { ashost: "h", sysnr: "00", saprouter: "/H/r/S/3299" } }).system;
  assert.deepEqual(rfcAddress(direct), { ashost: "h", sysnr: "00", lang: "EN", saprouter: "/H/r/S/3299", client: "100" });
  assert.equal(describeAddress(direct), "application server h, instance 00, via SAProuter");
});
test("an unknown authType is refused", () => {
  assert.match(readSystem({ ...base, authType: "jwt" }).error, /authType/);
});
test("canonicalOrigin lower-cases and makes the port explicit", () => {
  assert.equal(canonicalOrigin("HTTPS://Host.Example.com/sap/bc"), "https://host.example.com:443");
  assert.equal(canonicalOrigin("http://h:8000"), "http://h:8000");
});
test("login identity ignores the name and follows url, client, type, user", () => {
  const a = readSystem(base).system;
  assert.match(loginIdentity(a), /^vertex\.auth\.v1\.[0-9a-f]{32}$/);
  assert.equal(loginIdentity(a), loginIdentity(readSystem({ ...base, name: "OTHER" }).system));
  assert.equal(loginIdentity(a), loginIdentity(readSystem({ ...base, user: "DEV", url: "https://host.example.com:443" }).system));
  assert.notEqual(loginIdentity(a), loginIdentity(readSystem({ ...base, client: "200" }).system));
  assert.notEqual(loginIdentity(a), loginIdentity(readSystem({ ...base, user: "other" }).system));
});
test("connection key changes with snc, rfc and certificate policy", () => {
  const snc = { ...base, authType: "snc", snc: { partnerName: "p:CN=X" }, rfc: { ashost: "h", sysnr: "00" } };
  const k = connectionKey(readSystem(snc).system);
  assert.notEqual(k, connectionKey(readSystem({ ...snc, rfc: { ashost: "h2", sysnr: "00" } }).system));
  assert.notEqual(k, connectionKey(readSystem({ ...snc, snc: { partnerName: "p:CN=Y" } }).system));
  assert.notEqual(connectionKey(readSystem(base).system), connectionKey(readSystem({ ...base, allowInsecureCertificate: true }).system));
});

test("url and webgui embedded credentials are refused", () => {
  for (const field of ["url", "webgui"]) for (const credentials of ["privateuser@", ":privatepassword@", "privateuser:privatepassword@"]) {
    const result = readSystem({ ...base, [field]: "https://" + credentials + "host.example.com/sap" });
    assert.equal(result.system, undefined);
    assert.equal(result.error, "System DEV has a user or password in its " + field + ". Remove it: VERTEX keeps passwords in the OS credential store and asks for them.");
  }
});

test("old extension entries are rejected with a direct import hint", () => {
  assert.match(readSystem({ name: "EXT", connection: "sap-adt-extension", destination: "D" }).error, /Import it again for direct RFC\/SNC/);
});

test("keyInfo reads direct and legacy saved keys", () => {
  const { keyInfo } = require("../auth/systems");
  for (const authType of ["basic", "snc"]) assert.deepEqual(keyInfo(connectionKey({ ...base, authType })), { name: base.name });
  assert.deepEqual(keyInfo([base.url, base.client, base.user, base.name, false]), { name: base.name });
  assert.deepEqual(keyInfo("DEV"), { name: "DEV" });
  for (const invalid of [null, undefined, {}, "null", "{}"]) assert.equal(keyInfo(invalid).name, "");
});
