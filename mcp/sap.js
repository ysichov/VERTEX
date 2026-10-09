"use strict";

function configuration(env = process.env) {
  for (const name of ["VERTEX_SAP_URL", "VERTEX_SAP_USER", "VERTEX_SAP_PASSWORD"]) {
    if (!env[name]) { throw new Error("Missing environment variable " + name); }
  }
  let url;
  try { url = new URL(env.VERTEX_SAP_URL); }
  catch { throw new Error("VERTEX_SAP_URL must be an HTTP(S) SAP base URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== "/") {
    throw new Error("VERTEX_SAP_URL must contain only the HTTP(S) origin, without credentials or a path.");
  }
  const timeout = Number(env.VERTEX_SAP_TIMEOUT_MS || 30000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300000) {
    throw new Error("VERTEX_SAP_TIMEOUT_MS must be an integer from 1 to 300000.");
  }
  if (env.VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE
      && !["true", "false"].includes(env.VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE)) {
    throw new Error("VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE must be true or false.");
  }
  if (env.VERTEX_SAP_USER.includes(":")) { throw new Error("VERTEX_SAP_USER cannot contain a colon."); }
  return { url, user: env.VERTEX_SAP_USER, password: env.VERTEX_SAP_PASSWORD,
    client: env.VERTEX_SAP_CLIENT || "", timeout,
    allowInsecureCertificate: env.VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE === "true" };
}

// The review of a request, read over ADT as the VS Code extension reads it: the saved review out of ZAVE_REVIEW
// through ADT's data preview, or - with none saved - the review built from ADT's version feeds (review-front.js).
// Nothing of VERTEX's ABAP is asked for. The tools still name the review by its /vertex/review/ path, which is
// answered here rather than sent to SAP.
// REPOSITORY is for tests: a stand-in for the ADT client's api.
function createReader(config, repository0) {
  let api = repository0 || null;
  const repository = () => {
    if (!api) {
      // abap-adt-api is the VS Code extension's dependency; this server runs from the same checkout.
      const { ADTClient } = require(require.resolve("abap-adt-api", { paths: [require("node:path").join(__dirname, "..", "vscode")] }));
      const client = new ADTClient(config.url, config.user, config.password, config.client || "", "EN", { timeout: config.timeout });
      client.httpClient.httpclient = require("../vscode/sap-http").create({ url: config.url,
        allowInsecureCertificate: config.allowInsecureCertificate });
      api = require("../vscode/sap-code").createRepository({ client, systemId: config.url });
    }
    return api;
  };
  return async function read(_context, resource) {
    if (!resource.startsWith("/sap/bc/adt/vertex/review/")) {
      throw new Error("The standalone reader only supports the review of a request.");
    }
    return JSON.stringify(await require("../vscode/review-front").request(repository(), resource));
  };
}

module.exports = { configuration, createReader };
