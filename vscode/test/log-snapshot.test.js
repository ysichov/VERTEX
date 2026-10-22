"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const snapshot = require("../log-snapshot");

test("a recorded UML renders its saved methods and edges without a repository request", () => {
  const source = snapshot.umlSource({ nodes: [{ name: "ZCL_A", methods: ["RUN"] }, { name: "ZIF_A", kind: "interface", methods: ["EXECUTE"] }],
    edges: [{ source: "ZCL_A", target: "ZIF_A", kind: "implementation" }] });
  assert.match(source, /n0 : RUN\(\)/);
  assert.match(source, /<<interface>> n1/);
  assert.match(source, /n0 \.\.\|> n1/);
});

test("snapshot HTML escapes log text and has valid scripts for both snapshot types", () => {
  for (const kind of ["uml", "metrics"]) {
    const html = snapshot.html({ kind, name: "</script><script>bad()</script>", data: { columns: ["unit_name"], units: [{ unit_name: "RUN" }], nodes: [] } }, "mermaid.js", "local:");
    assert.doesNotMatch(html, /<script>bad/);
    for (const script of html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    assert.match(html, /var\(--vscode-editor-background\)/);
  }
});
