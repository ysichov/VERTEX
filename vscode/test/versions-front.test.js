"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { request } = require("../versions-front");

// A feed as ADT gives it for an include: newest first, the active version as 00000 among them.
function session() {
  const asked = [];
  const feed = [
    { id: "00002", uri: "/v/00002/content", time: "2025-01-02T10:00:00Z", author: "TOCH", title: "Second", transport: "ALCK900002" },
    { id: "00000", uri: "/v/00000/content", time: "2025-01-03T10:00:00Z", author: "TOCH", title: "", transport: "" },
    { id: "00001", uri: "/v/00001/content", time: "2025-01-01T10:00:00Z", author: "LYT", title: "First", transport: "ALCK900001" }];
  const sources = { "/v/00001/content": "a\nb", "/v/00002/content": "a\nc", "/v/00000/content": "a\nc" };
  const api = {
    revisions: async url => { asked.push(url); return feed; },
    revisionSource: async uri => sources[uri],
    currentSource: async () => "now",
    query: async sql => {
      asked.push(sql);
      if (/FROM e070/.test(sql)) { return { values: [{ TRKORR: "ALCK900002" }].filter(() => /trfunction = 'T'/.test(sql) && false) }; }
      if (/FROM usr21/.test(sql)) { return { values: [{ BNAME: "TOCH", NAME_TEXT: "Oleh T" }] }; }
      return { values: [] };
    }
  };
  return { api, asked };
}

test("a program is one part, itself", async () => {
  const { api } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/ZPROG?type=PROG");
  assert.deepStrictEqual(answer.parts, [{ class: "", unit: "ZPROG", name: "ZPROG", part_type: "REPS", section: "" }]);
});

test("the versions come from ADT's feed, newest first, the active one as 99998, with transport and name", async () => {
  const { api, asked } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/%2FALLOY%2FFIAA_REPORT_IMPL?type=INCL&part=%2FALLOY%2FFIAA_REPORT_IMPL&ptype=REPS");
  assert.strictEqual(asked[0], "/sap/bc/adt/programs/includes/%2Falloy%2Ffiaa_report_impl");
  assert.deepStrictEqual(answer.versions.map(v => [v.version, v.request, v.author_name]),
    [["99998", "", "Oleh T"], ["00002", "ALCK900002", "Oleh T"], ["00001", "ALCK900001", ""]]);
  assert.match(answer.versions[1].date, /^\d{8}$/);
});

test("dups=X keeps the earliest of identical sources", async () => {
  const { api } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/ZPROG?type=PROG&part=ZPROG&ptype=REPS&dups=X");
  assert.deepStrictEqual(answer.versions.map(v => v.version), ["00002", "00001"]);
});

test("a diff of two versions, and of the first against nothing", async () => {
  const { api } = session();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/ZPROG?type=PROG&part=ZPROG&ptype=REPS&from=00001&to=00002");
  assert.deepStrictEqual(answer.ops, [{ op: "=", text: "a" }, { op: "-", text: "b" }, { op: "+", text: "c" }]);
  assert.deepStrictEqual([answer.added, answer.deleted, answer.kept], [1, 1, 1]);
  const first = await request(api, "/sap/bc/adt/vertex/versions/ZPROG?type=PROG&part=ZPROG&ptype=REPS&from=&to=00001");
  assert.strictEqual(first.added, 2);
});


// A class in three versions: v1 has RUN; v2 changes only HELPER; v3 changes RUN.
const CLASS = body => "CLASS zcl_x DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS run.\n  PRIVATE SECTION.\n    METHODS helper.\nENDCLASS.\n"
  + "CLASS zcl_x IMPLEMENTATION.\n  METHOD run.\n" + body.run + "\n  ENDMETHOD.\n  METHOD helper.\n" + body.helper + "\n  ENDMETHOD.\nENDCLASS.\n";
function classSession() {
  const asked = [];
  const sources = { "/c/1": CLASS({ run: "    x = 1.", helper: "    y = 1." }), "/c/2": CLASS({ run: "    x = 1.", helper: "    y = 2." }),
    "/c/3": CLASS({ run: "    x = 3.", helper: "    y = 2." }) };
  const api = {
    revisions: async (url, include) => { asked.push([url, include]); return [
      { id: "00003", uri: "/c/3", time: "2025-01-03T10:00:00Z", author: "A", transport: "K3" },
      { id: "00002", uri: "/c/2", time: "2025-01-02T10:00:00Z", author: "A", transport: "K2" },
      { id: "00001", uri: "/c/1", time: "2025-01-01T10:00:00Z", author: "A", transport: "K1" }]; },
    revisionSource: async uri => sources[uri],
    currentSource: async (url, include) => {
      if (!include) { return sources["/c/3"]; }
      if (include === "implementations") { return "CLASS lcl DEFINITION.\nENDCLASS."; }
      if (include === "testclasses") { throw new Error("ZCL_X=======CCAU does not have any inactive version"); }
      throw new Error("Request failed with status code 404");
    },
    query: async () => ({ values: [] })
  };
  return { api, asked };
}

test("a class is its non-empty sections, its methods by section and its local includes", async () => {
  const { api } = classSession();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/ZCL_X?type=CLAS");
  assert.deepStrictEqual(answer.parts.map(p => [p.part_type, p.unit, p.section]), [
    ["CPUB", "", "public"], ["CPRI", "", "private"], ["METH", "RUN", "public"], ["METH", "HELPER", "private"], ["CINC", "", ""]]);
  assert.strictEqual(answer.parts[2].name, "ZCL_X" + " ".repeat(25) + "RUN");
  assert.strictEqual(answer.parts[4].name, "ZCL_X" + "=".repeat(25) + "CCIMP");
});

test("a method's history is the versions of its class where its text changed, and its diff is of that method alone", async () => {
  const { api } = classSession();
  const part = encodeURIComponent("ZCL_X" + " ".repeat(25) + "RUN");
  const history = await request(api, "/sap/bc/adt/vertex/versions/ZCL_X?type=CLAS&part=" + part + "&ptype=METH");
  assert.deepStrictEqual(history.versions.map(v => v.version), ["00003", "00001"]);
  const changed = await request(api, "/sap/bc/adt/vertex/versions/ZCL_X?type=CLAS&part=" + part + "&ptype=METH&from=00001&to=00003");
  assert.deepStrictEqual(changed.ops, [{ op: "=", text: "  METHOD run." }, { op: "-", text: "    x = 1." }, { op: "+", text: "    x = 3." },
    { op: "=", text: "  ENDMETHOD." }]);
});



// A function group in a namespace, as TFDIR and TRDIR describe it.
function groupSession() {
  const asked = [];
  const api = {
    query: async sql => {
      asked.push(sql);
      if (/FROM tfdir WHERE pname/.test(sql)) { return { values: [{ FUNCNAME: "VIEWFRAME_/NS/V", INCLUDE: "01" }] }; }
      if (/FROM trdir/.test(sql)) { return { values: [{ NAME: "/NS/LFGU01" }, { NAME: "/NS/LFGF01" }] }; }
      if (/FROM tfdir WHERE funcname/.test(sql)) { return { values: [{ PNAME: "/NS/SAPLFG" }] }; }
      return { values: [] };
    },
    revisions: async url => { asked.push(url); return []; }
  };
  return { api, asked };
}

test("a function group is its main program, a FUNC per module and its other includes, namespace and all", async () => {
  const { api, asked } = groupSession();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/%2FNS%2FFG?type=FUGR");
  assert.deepStrictEqual(answer.parts.map(p => [p.part_type, p.name]),
    [["REPS", "/NS/SAPLFG"], ["REPS", "/NS/LFGF01"], ["FUNC", "VIEWFRAME_/NS/V"]]);
  assert.ok(asked.some(sql => sql === "SELECT name FROM trdir WHERE name LIKE '/NS/LFG%' ESCAPE '#' AND sqlx = 'X'"));
});

test("a function module, an interface and a CDS view read their own ADT feeds", async () => {
  const { api, asked } = groupSession();
  await request(api, "/sap/bc/adt/vertex/versions/VIEWFRAME_%2FNS%2FV?type=FUNC&part=VIEWFRAME_%2FNS%2FV&ptype=FUNC");
  assert.strictEqual(asked.at(-1), "/sap/bc/adt/functions/groups/%2Fns%2Ffg/fmodules/viewframe_%2Fns%2Fv");
  await request(api, "/sap/bc/adt/vertex/versions/ZIF_X?type=INTF&part=" + encodeURIComponent("ZIF_X" + "=".repeat(25) + "IU") + "&ptype=REPS");
  assert.strictEqual(asked.at(-1), "/sap/bc/adt/oo/interfaces/zif_x");
  await request(api, "/sap/bc/adt/vertex/versions/ZI_X?type=DDLS&part=ZI_X&ptype=DDLS");
  assert.strictEqual(asked.at(-1), "/sap/bc/adt/ddic/ddl/sources/zi_x");
});

// A request with one task, and what E071 holds for them; TRDIR, TFDIR and DD02L for the parts' homes.
function scopeSession() {
  const asked = [];
  const api = {
    query: async sql => {
      asked.push(sql);
      if (/FROM e070 WHERE trkorr = 'ALCK900001'/.test(sql)) { return { values: [{ TRKORR: "ALCK900001" }] }; }
      if (/FROM e070 WHERE strkorr/.test(sql)) { return { values: [{ TRKORR: "ALCK900002" }] }; }
      if (/FROM e071/.test(sql)) {
        return { values: [{ PGMID: "R3TR", OBJECT: "CLAS", OBJ_NAME: "ZCL_X" }, { PGMID: "LIMU", OBJECT: "METH", OBJ_NAME: "ZCL_Y" + " ".repeat(25) + "RUN" },
          { PGMID: "LIMU", OBJECT: "REPS", OBJ_NAME: "ZPROG" }, { PGMID: "R3TR", OBJECT: "TABL", OBJ_NAME: "ZTAB" },
          { PGMID: "R3TR", OBJECT: "PROG", OBJ_NAME: "ZPROG" }] };
      }
      if (/FROM tadir/.test(sql)) { return { values: [{ PGMID: "R3TR", OBJECT: "DTEL", OBJ_NAME: "ZDE" }] }; }
      if (/FROM trdir WHERE name = 'ZPROG'/.test(sql)) { return { values: [{ SUBC: "1" }] }; }
      if (/FROM dd02l/.test(sql)) { return { values: [{ TABCLASS: "INTTAB" }] }; }
      return { values: [] };
    },
    revisions: async (url, include) => { asked.push(url + (include ? "#" + include : "")); return []; }
  };
  return { api, asked };
}

test("a transport request lists the objects of itself and its tasks, a container as one object, once each", async () => {
  const { api, asked } = scopeSession();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/ALCK900001?type=TR");
  assert.strictEqual(answer.scope, true);
  assert.deepStrictEqual(answer.parts.map(p => [p.part_type, p.name.trim()]), [
    ["METH", "ZCL_Y" + " ".repeat(25) + "RUN"], ["REPS", "ZPROG"], ["CLAS", "ZCL_X"], ["TABD", "ZTAB"]]);
  assert.ok(asked.some(sql => /FROM e071 WHERE trkorr IN \( 'ALCK900001', 'ALCK900002' \)/.test(sql)));
});

test("a part opened inside a request reads the feed of the object it belongs to", async () => {
  const { api, asked } = scopeSession();
  await request(api, "/sap/bc/adt/vertex/versions/ALCK900001?type=TR&part=ZPROG&ptype=REPS");
  assert.strictEqual(asked.at(-1), "/sap/bc/adt/programs/programs/zprog");
  await request(api, "/sap/bc/adt/vertex/versions/ALCK900001?type=TR&part=" + encodeURIComponent("ZCL_Y" + " ".repeat(25) + "RUN") + "&ptype=METH");
  assert.strictEqual(asked.at(-1), "/sap/bc/adt/oo/classes/zcl_y#main");
  await request(api, "/sap/bc/adt/vertex/versions/ALCK900001?type=TR&part=ZTAB&ptype=TABD");
  assert.strictEqual(asked.at(-1), "/sap/bc/adt/ddic/structures/ztab");
});

test("a package lists what TADIR keeps under it; a data element reads its own feed", async () => {
  const { api, asked } = scopeSession();
  const answer = await request(api, "/sap/bc/adt/vertex/versions/ZPACK?type=DEVC");
  assert.deepStrictEqual(answer.parts.map(p => [p.part_type, p.name]), [["DTED", "ZDE"]]);
  await request(api, "/sap/bc/adt/vertex/versions/ZDE?type=DTEL&part=ZDE&ptype=DTED");
  assert.strictEqual(asked.at(-1), "/sap/bc/adt/ddic/dataelements/zde");
});

test("a user's requests: owned and held through a task, open by default, newest first, described in the session's language", async () => {
  const asked = [];
  const api = {
    user: () => "SYCHOV",
    language: () => "E",
    query: async sql => {
      asked.push(sql);
      if (/AND strkorr = ' '/.test(sql)) { return { values: [{ TRKORR: "ALCK900001" }] }; }
      if (/INNER JOIN e070 AS r/.test(sql)) { return { values: [{ TRKORR: "ALCK900002" }, { TRKORR: "ALCK900001" }] }; }
      if (/FROM e070 WHERE trkorr IN/.test(sql)) {
        return { values: [{ TRKORR: "ALCK900001", TRFUNCTION: "K", TRSTATUS: "D", AS4USER: "SYCHOV", AS4DATE: "20261001", AS4TIME: "100000" },
          { TRKORR: "ALCK900002", TRFUNCTION: "W", TRSTATUS: "L", AS4USER: "OTHER", AS4DATE: "20261005", AS4TIME: "090000" }] };
      }
      if (/FROM e07t/.test(sql)) {
        return { values: [{ TRKORR: "ALCK900001", LANGU: "D", AS4TEXT: "Deutsch" }, { TRKORR: "ALCK900001", LANGU: "E", AS4TEXT: "English" }] };
      }
      if (/FROM usr21/.test(sql)) { return { values: [{ BNAME: "SYCHOV", NAME_TEXT: "Yurii Sychov" }] }; }
      return { values: [] };
    }
  };
  const answer = await request(api, "/sap/bc/adt/vertex/requests");
  assert.strictEqual(answer.user, "SYCHOV");
  assert.deepStrictEqual(answer.requests.map(r => [r.request, r.text, r.type, r.status, r.owner_name]), [
    ["ALCK900002", "", "customizing", "modifiable, protected", ""],
    ["ALCK900001", "English", "workbench", "modifiable", "Yurii Sychov"]]);
  assert.ok(asked.some(sql => /trstatus IN \( 'D', 'L' \)/.test(sql)));
  await request(api, "/sap/bc/adt/vertex/requests?released=true");
  assert.ok(asked.some(sql => /trstatus IN \( 'D', 'L', 'O', 'R', 'N' \)/.test(sql)));
  await assert.rejects(request(api, "/sap/bc/adt/vertex/requests?user=SY*"), /not a pattern/);
});
