#!/usr/bin/env node
"use strict";

const { create } = require("../vscode/mcp");
const { configuration, createReader } = require("./sap");

const config = configuration();
const token = process.env.VERTEX_MCP_TOKEN;
if (!token) {
  throw new Error("VERTEX_MCP_TOKEN is required for HTTP MCP");
}

const server = create({
  fetch: createReader(config),
  context: { secrets: { get: async () => token, store: async () => {} } },
  port: Number(process.env.VERTEX_MCP_PORT || 37777),
  host: process.env.VERTEX_MCP_HOST || "127.0.0.1",
  version: "0.1.0"
});

server.start().then(running => {
  process.stderr.write("VERTEX MCP listening at " + running.url + "\n");
}).catch(error => {
  process.stderr.write("VERTEX: " + error.message + "\n");
  process.exitCode = 1;
});

process.on("SIGINT", () => server.stop().then(() => process.exit(0)));
process.on("SIGTERM", () => server.stop().then(() => process.exit(0)));
