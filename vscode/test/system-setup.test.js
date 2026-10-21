"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("fs"), os = require("os"), path = require("path");
const { landscape } = require("../system-setup");

test("SAP Logon SNC single sign-on imports direct RFC settings", () => {
  const file = path.join(os.tmpdir(), "vertex-snc-direct-" + process.pid + ".xml");
  fs.writeFileSync(file, '<Landscape><Services>'
    + '<Service type="SAPGUI" name="Snc" systemid="SNC" server="snchost:3200" sncname="p:CN=SNC" sncop="9"/>'
    + '<Service type="SAPGUI" name="Password" systemid="PWD" server="pwdhost:3201" sncname="p:CN=PWD" sncnosso="1"/>'
    + '</Services></Landscape>');
  try {
    const { systems } = landscape([file]);
    assert.deepEqual(systems[0].snc, { partnerName: "p:CN=SNC", qop: "9" });
    assert.equal(systems[0].host, "snchost");
    assert.deepEqual(systems[1].snc, { partnerName: "p:CN=PWD" });
    assert.equal(systems[1].authType, undefined);
  } finally { fs.unlinkSync(file); }
});

test("the sidebar auth switch updates only authType and retains SNC settings", async () => {
  const { setSystemAuthType } = require("../system-setup");
  const values = { systems: [{ name: "DEV", url: "https://dev", user: "USER", authType: "snc",
    snc: { partnerName: "p:CN=DEV" }, rfc: { ashost: "devhost", sysnr: "00" } }] };
  const updates = [];
  const config = { get: key => values[key], inspect: () => ({ workspaceValue: values.systems }),
    update: async (key, value, target) => { updates.push({ key, value, target }); values[key] = value; } };
  const vscode = { ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }, workspace: { getConfiguration: () => config } };
  await setSystemAuthType(vscode, "DEV", false);
  assert.equal(values.systems[0].authType, "basic");
  assert.deepEqual(values.systems[0].snc, { partnerName: "p:CN=DEV" });
  await setSystemAuthType(vscode, "DEV", true);
  assert.equal(values.systems[0].authType, "snc");
  assert.equal(updates.length, 2);
  assert.ok(updates.every(update => update.target === 2));
});

test("the sidebar auth switch refuses SNC without its RFC parameters", async () => {
  const { setSystemAuthType } = require("../system-setup");
  let updated = false;
  const config = { get: () => [{ name: "DEV", url: "https://dev", user: "USER" }], inspect: () => ({}),
    update: async () => { updated = true; } };
  await assert.rejects(() => setSystemAuthType({ workspace: { getConfiguration: () => config } }, "DEV", true), /snc.partnerName/);
  assert.equal(updated, false);
});

test("remove systems updates the configured scope and repairs an active selection", async () => {
  const { removeSystems } = require("../system-setup");
  const values = { systems: [{ name: "DEV", url: "https://dev" }, { name: "QAS", destination: "QAS" }], active: "QAS" };
  const updates = [];
  const config = {
    get: key => values[key],
    inspect: key => key === "systems" ? { workspaceValue: values.systems } : { globalValue: values.active },
    update: async (key, value, target) => { updates.push({ key, value, target }); values[key] = value; }
  };
  const vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    workspace: { getConfiguration: () => config },
    window: {
      showQuickPick: async items => [items[1]],
      showInformationMessage: () => {}
    }
  };
  await removeSystems(vscode);
  assert.deepEqual(updates, [
    { key: "systems", value: [{ name: "DEV", url: "https://dev" }], target: 2 },
    { key: "active", value: "DEV", target: 1 }
  ]);
});

test("cancelling system removal leaves configuration intact", async () => {
  const { removeSystems } = require("../system-setup");
  let updated = false;
  await removeSystems({
    workspace: { getConfiguration: () => ({ get: () => [{ name: "DEV" }], update: () => { updated = true; } }) },
    window: { showQuickPick: async () => undefined }
  });
  assert.equal(updated, false);
});

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

test("SNC logon group without an RFC application server is explained and skipped", () => {
  const file = path.join(os.tmpdir(), "vertex-snc-group-" + process.pid + ".xml");
  fs.writeFileSync(file, '<Landscape><Messageservers><Messageserver uuid="m1" host="msg" port="3600"/></Messageservers>'
    + '<Services><Service type="SAPGUI" name="SNC Group" systemid="PRD" msid="m1" sncname="p:CN=PRD"/></Services></Landscape>');
  try {
    const result = landscape([file]);
    assert.deepEqual(result.systems, []);
    assert.match(result.skipped[0], /SNC logon group.*no application server/);
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

test("an ADT workspace supplies systems without SAP Logon", () => {
  const { eclipseProjects } = require("../system-setup");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vertex-adt-workspace-"));
  const project = path.join(workspace, ".metadata", ".plugins", "org.eclipse.core.resources.semantic", ".cache", "DEV_100_USER_en");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, ".destination.properties"),
    "systemConfiguration=Development\nserver=dev.example.com\nsystemId=DEV\nsystemNumber=01\nclient=100\nuser=USER\npassword=secret\n");
  try {
    assert.deepEqual(eclipseProjects(workspace), [{ id: "DEV", title: "Development", host: "dev.example.com",
      instance: "01", client: "100", user: "USER" }]);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
