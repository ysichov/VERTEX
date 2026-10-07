"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path");
const { landscape } = require("../system-setup");

test("SAP Logon entries give the host and instance; a logon group gives its message server's host", () => {
  const file = path.join(os.tmpdir(), "vertex-landscape-" + process.pid + ".xml");
  fs.writeFileSync(file, '<Landscape><Messageservers>'
    + '<Messageserver uuid="m1" name="PRD" host="msghost.corp" port="3601"/>'
    + '<Messageserver uuid="m2" name="QAS" host="qms" port="sapmsQAS"/></Messageservers><Services>'
    + '<Service type="SAPGUI" name="Prod" systemid="PRD" msid="m1" server="PUBLIC"/>'
    + '<Service type="SAPGUI" name="QA" systemid="QAS" msid="m2" server="SPACE"/>'
    + '<Service type="SAPGUI" name="Lost" systemid="LST" msid="m9" server="X"/>'
    + '<Service type="SAPGUI" name="Dev" systemid="DEV" server="devhost:3205"/></Services></Landscape>');
  try {
    const { systems, skipped } = landscape([file]);
    assert.deepEqual(systems, [
      { id: "PRD", title: "Prod", host: "msghost.corp", instance: "01", group: "PUBLIC" },
      { id: "QAS", title: "QA", host: "qms", instance: "", group: "SPACE" },
      { id: "DEV", title: "Dev", host: "devhost", instance: "05" }]);
    assert.deepEqual(skipped, ["Lost (logon group, message server not described)"]);
  } finally { fs.unlinkSync(file); }
});

test("an Eclipse installation's recent workspaces are read from its Java properties value", () => {
  const { recentWorkspaces } = require("../system-setup");
  const install = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-eclipse-"));
  fs.mkdirSync(path.join(install, "configuration", ".settings"), { recursive: true });
  const B = String.fromCharCode(92);
  fs.writeFileSync(path.join(install, "configuration", ".settings", "org.eclipse.ui.ide.prefs"),
    "MAX_RECENT_WORKSPACES=10\nRECENT_WORKSPACES=D" + B + ":" + B + B + "Eclipse" + B + B + "workspace" + B + "nC" + B + ":" + B + B + "ws2\nRECENT_WORKSPACES_PROTOCOL=3\n");
  try { assert.deepEqual(recentWorkspaces(install), ["D:" + B + "Eclipse" + B + "workspace", "C:" + B + "ws2"]); }
  finally { fs.rmSync(install, { recursive: true, force: true }); }
});
