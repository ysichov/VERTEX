"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");

const PAGE = path.join(__dirname, "../../org.vertex.abap.ui/resources/mcp.html");

/* The page's own document, small enough to read back: a node keeps its tag, its text and what was put in it. */
function fakeDocument() {
  const node = tag => ({
    tag, children: [], className: "", textContent: "", dataset: {}, style: {}, attributes: {},
    append(...items) { items.forEach(item => this.children.push(item)); },
    appendChild(item) { this.children.push(item); return item; },
    setAttribute(name, value) { this.attributes[name] = value; },
    add(option) { this.children.push(option); }
  });
  return { createElement: node, createTextNode: text => ({ tag: "#text", textContent: text, children: [] }) };
}
function pageContext(from, to, extra = {}) {
  const page = fs.readFileSync(PAGE, "utf8");
  const start = page.indexOf(from);
  assert.ok(start > 0, "mcp.html no longer contains " + from);
  const end = to ? page.indexOf(to) : page.indexOf("</script>");
  assert.ok(end > start, "mcp.html no longer contains " + (to || "</script>"));
  // The page builds options the way a document does; the fake keeps the value and the text it was given.
  const Option = function (text, value) { return { tag: "option", textContent: text, value, children: [] }; };
  const context = { document: fakeDocument(), Option, tool: { name: "SAPQuery" }, ...extra };
  vm.createContext(context);
  vm.runInContext(page.slice(start, end), context);
  return context;
}
const flat = node => (node.textContent || "") + (node.children || []).map(flat).join(" ");

test("the result view follows the shape of the answer, not the name of the tool", () => {
  const context = pageContext("function kind(text)");
  // An array of objects is the table it is, with every column its rows carry.
  const table = context.text(JSON.stringify([{ ID: 1, NAME: "A" }, { ID: 2, OTHER: null }]));
  const grid = table.children.find(child => child.tag === "table");
  assert.ok(grid, "an array of objects is shown as a table");
  assert.deepEqual(grid.children[0].children.map(cell => cell.textContent), ["ID", "NAME", "OTHER"]);
  assert.deepEqual(grid.children[1].children.map(cell => cell.textContent), ["1", "A", ""]);
  assert.deepEqual(grid.children[2].children.map(cell => cell.textContent), ["2", "", "null"]);
  // A fenced block is code in the language it names.
  const fenced = context.text("```abap\nWRITE 'x'.\n```");
  assert.match(flat(fenced), /abap/);
  assert.match(flat(fenced), /WRITE 'x'\./);
  // A SELECT is recognised by the same anchored test the logs use - no reading of the text.
  const sql = context.text("SELECT carrid FROM spfli WHERE connid = '0400'.");
  assert.match(flat(sql), /SQL/);
  assert.match(flat(sql), /SELECT carrid/);
  // Anything else is shown as it came: a view of its own, not a failure.
  const plain = context.text("Short dump ABAP_RUNTIME_ERROR at line 42");
  assert.equal(plain.children[0].tag, "pre");
  assert.match(flat(plain), /ABAP_RUNTIME_ERROR/);
  // A JSON object that is not a row list keeps its own shape.
  const tree = context.text(JSON.stringify({ system: "A4H", counts: { dumps: 2 } }));
  assert.match(flat(tree), /system/);
  assert.match(flat(tree), /A4H/);
});

test("rows carried under a key are the table, with the stated column order and the counts beside it", () => {
  const context = pageContext("function kind(text)");
  // What a query answer looks like: the rows under a key, the columns named, the counts around them.
  const answer = { totalRows: 356, rowsReturned: 2, executedQueryString: "SELECT * FROM SFLIGHT",
    columns: ["MANDT", "CARRID", "CONNID"],
    rows: [{ CARRID: "AA", MANDT: "100", CONNID: 17 }, { CARRID: "LH", MANDT: "100", CONNID: 400 }] };
  const shown = context.text(JSON.stringify(answer));
  const grid = shown.children.find(child => child.tag === "div" && child.children.some(node => node.tag === "table"))
    || shown.children.find(child => child.tag === "table");
  const table = grid.tag === "table" ? grid : grid.children.find(node => node.tag === "table");
  assert.ok(table, "an answer carrying rows is shown as a table");
  // The order the answer states wins over the order the first row happens to have.
  assert.deepEqual(table.children[0].children.map(cell => cell.textContent), ["MANDT", "CARRID", "CONNID"]);
  assert.deepEqual(table.children[1].children.map(cell => cell.textContent), ["100", "AA", "17"]);
  // The counts and the statement stay beside the rows rather than being dropped.
  const text = flat(shown);
  assert.match(text, /totalRows: 356/);
  assert.match(text, /SELECT \* FROM SFLIGHT/);
  // A column only the rows carry is still shown.
  const extra = context.text(JSON.stringify({ columns: ["A"], rows: [{ A: 1, B: 2 }] }));
  assert.match(flat(extra), /B/);
  // An object with no row list is not forced into a table.
  assert.equal(context.rowsUnderKey({ rows: 5 }), null);
  assert.equal(context.rowsUnderKey({ rows: [] }), null);
});

test("a parameter control comes from the schema's own type, enum and default", () => {
  const context = pageContext("function control(name, property)", "function field(name, property)",
    { required: ["name"] });
  const enumerated = context.control("type", { type: "string", enum: ["CLAS", "PROG"], default: "PROG" });
  assert.equal(enumerated.tag, "select");
  // An optional field may be left unanswered, so its list starts with nothing chosen.
  assert.deepEqual(enumerated.children.map(option => option.value), ["", "CLAS", "PROG"]);
  assert.equal(enumerated.value, "PROG");
  const flag = context.control("released", { type: "boolean", default: true });
  assert.equal(flag.type, "checkbox");
  assert.equal(flag.checked, true);
  const rows = context.control("maxRows", { type: "integer", minimum: 1, maximum: 10000, default: 100 });
  assert.equal(rows.type, "number");
  assert.equal(rows.min, "1");
  assert.equal(rows.max, "10000");
  assert.equal(rows.value, "100");
  // A required list keeps every value and offers no empty choice.
  const must = context.control("name", { type: "string", enum: ["A", "B"] });
  assert.deepEqual(must.children.map(option => option.value), ["A", "B"]);
  // A structured parameter is typed as the JSON the tool asks for.
  assert.equal(context.control("filters", { type: "array" }).tag, "textarea");
});

test("the page's own script parses and carries the marker the window fills in", () => {
  const page = fs.readFileSync(PAGE, "utf8");
  // The page does not use the shared Tools code, so nothing else parse-checks it.
  const scripts = [...page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(match => !match[1].includes("application/json") && match[2].trim()).map(match => match[2]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
  // The window puts the chosen server and tool in through this marker, as it does for every other page.
  assert.equal(page.split("/*INIT*/null/*INIT*/").length - 1, 1);
  // The two canonical controls are used as they are, not redefined here.
  assert.match(page, /class="vertex-segment-toggle"/);
  assert.doesNotMatch(page, /\.vertex-segment-toggle\s*\{/);
});

/* One MCP server in miniature, answering tools/list and tools/call. */
function fakeServer() {
  const calls = [];
  const tools = [{ name: "SAPQuery", description: "Run SQL", inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } }];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const message = JSON.parse(body);
      if (message.id === undefined) { response.writeHead(202); response.end(); return; }
      const result = message.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {} }
        : message.method === "tools/list" ? { tools }
        : (calls.push(message.params), { content: [{ type: "text", text: "ran " + message.params.name }] });
      response.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "s1" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, calls, port: server.address().port })));
}

test("the Tools window runs one named tool of one named server and refuses an unknown one", async () => {
  const fake = await fakeServer();
  const settings = { mcpServers: [{ name: "ARC-1", url: "http://127.0.0.1:" + fake.port + "/mcp" }] };
  const vscode = { workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) } };
  // What a server last reported is kept here, as the extension keeps it in globalState.
  let kept = {};
  const catalog = { get: () => kept, update: async value => { kept = value; } };
  const manager = require("../mcp-external").create({ vscode, active: () => ({ error: "unused" }), password: async () => "", storage: null, catalog });
  try {
    const answer = await manager.runTool("ARC-1", "SAPQuery", { sql: "SELECT 1 FROM dummy" });
    assert.deepEqual(fake.calls, [{ name: "SAPQuery", arguments: { sql: "SELECT 1 FROM dummy" } }]);
    assert.equal(answer.content[0].text, "ran SAPQuery");
    // The window may not invent a tool the server does not serve, nor a server that is not configured.
    await assert.rejects(manager.runTool("ARC-1", "SAPDelete", {}), /has no tool SAPDelete/);
    await assert.rejects(manager.runTool("Nowhere", "SAPQuery", {}), /is not in vertex\.chat\.mcpServers/);
    // What the pickers list is what was kept of the server, with each tool's own schema.
    const listed = manager.overview().find(entry => entry.name === "ARC-1");
    assert.equal(listed.tools[0].name, "SAPQuery");
    assert.deepEqual(listed.tools[0].inputSchema.required, ["sql"]);
  } finally { manager.stop(); await new Promise(resolve => fake.server.close(resolve)); }
});
