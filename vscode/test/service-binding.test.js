"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const binding = published => '<srvb:serviceBinding srvb:published="' + published + '" adtcore:name="ZUI_X_O4" xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings">'
  + '<atom:link href="/sap/bc/adt/businessservices/odatav4/ZUI_X_O4" rel="http://www.sap.com/categories/odatav4" title="ODATAV4"/>'
  + '<srvb:services srvb:name="ZUI_X_O4"><srvb:content srvb:version="0001"/></srvb:services></srvb:serviceBinding>';
const status = (severity, short, long) => '<asx:abap><asx:values><DATA><SEVERITY>' + severity + '</SEVERITY><SHORT_TEXT>' + short
  + '</SHORT_TEXT><LONG_TEXT>' + long + '</LONG_TEXT></DATA></asx:values></asx:abap>';

function repository(answer) {
  let published = false;
  const requests = [];
  const client = { httpClient: { request: async (url, options) => {
    requests.push([options.method, url]);
    if (options.method === "GET") return { status: 200, body: binding(published) };
    const reply = answer();
    if (reply.publish) published = true;
    return { status: 200, body: reply.body };
  } } };
  return { repo: require("../sap-code").createRepository({ client, systemId: "A4H" }), requests };
}

test("a V4 binding is published at the V4 address with its service version, and the answer is SAP's", async () => {
  const { repo, requests } = repository(() => ({ publish: true, body: status("OK", "ZUI_X_O4 published locally", "") }));
  const answer = await repo.publishBinding("zui_x_o4", true);
  assert.deepEqual(requests[1], ["POST", "/sap/bc/adt/businessservices/odatav4/publishjobs?servicename=ZUI_X_O4&serviceversion=0001"]);
  assert.deepEqual([answer.odata_version, answer.service_version, answer.published_before, answer.published, answer.message],
    ["V4", "0001", false, true, "ZUI_X_O4 published locally"]);
});

test("an ERROR inside SAP's 200 answer is a failure with SAP's words, not a quiet nothing", async () => {
  const { repo } = repository(() => ({ publish: false, body: status("ERROR", "Local Publish of ZUI_X_O4 failed", "(Un-)Publishing of SRVB ZUI_X_O4 in Customizing Client not allowed") }));
  await assert.rejects(repo.publishBinding("ZUI_X_O4", true), /Publishing ZUI_X_O4 failed: Local Publish of ZUI_X_O4 failed\n\(Un-\)Publishing of SRVB ZUI_X_O4 in Customizing Client not allowed It is not published now\./);
  await assert.rejects(repo.publishBinding("bad name!", true), /Name a service binding/);
});
