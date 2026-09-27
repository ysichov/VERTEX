"use strict";
const { tokenize, statements } = require("./value-origin-tokens");
function mermaid(graph) {
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').split('\n').join(' ');
  return ['flowchart BT', ...graph.nodes.map(node => '  ' + node.id + '["' + escape(node.text) + ' · L' + node.line + '"]'), ...graph.edges.map(edge => '  ' + edge.from + ' -->|' + escape(edge.label) + '| ' + edge.to)].join('\n');
}
module.exports = { tokenize, statements, mermaid, ...require("./value-origin-model") };
