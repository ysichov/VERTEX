#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const { dispatch } = require("../vscode/mcp");
const { configuration, createReader } = require("./sap");

async function serve(deps, input = process.stdin, output = process.stdout) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  function send(message) { output.write(JSON.stringify(message) + "\n"); }
  // Sequential processing also drains pending requests when stdin reaches EOF.
  for await (const line of lines) {
    if (!line.trim()) { continue; }
    let message;
    try { message = JSON.parse(line); }
    catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } });
      continue;
    }
    if (!message || Array.isArray(message) || message.jsonrpc !== "2.0"
        || typeof message.method !== "string"
        || (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number")) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request." } });
      continue;
    }
    if (message.id === undefined) { continue; }
    try {
      send({ jsonrpc: "2.0", id: message.id, result: await dispatch(deps, message) });
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id,
        error: { code: error.code || -32603, message: error.message } });
    }
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write("VERTEX standalone MCP (stdio)\n"
      + "Usage: node mcp/server.js\n"
      + "Required environment: VERTEX_SAP_URL, VERTEX_SAP_USER, VERTEX_SAP_PASSWORD\n"
      + "Optional: VERTEX_SAP_CLIENT, VERTEX_SAP_TIMEOUT_MS (30000),\n"
      + "          VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE (false)\n"
      + "No VS Code, listening port or MCP bearer token is needed.\n");
    return;
  }
  if (process.argv.length > 2) { throw new Error("Unknown arguments. Use --help."); }
  const config = configuration();
  await serve({ fetch: createReader(config), version: "0.1.0" });
}

if (require.main === module) {
  main().catch(error => {
    // stdout belongs exclusively to MCP. Never print credentials or configuration.
    process.stderr.write("VERTEX: " + error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { serve };
