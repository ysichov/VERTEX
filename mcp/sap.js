"use strict";

const http = require("node:http");
const https = require("node:https");

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

function createReader(config) {
  return async function read(_context, resource) {
    // Only the shared review tools may choose a path; credentials never follow redirects.
    if (!resource.startsWith("/sap/bc/adt/zsde/review/")) {
      throw new Error("The standalone reader only supports the SAP review resource.");
    }
    const url = new URL(resource, config.url);
    if (config.client) { url.searchParams.set("sap-client", config.client); }
    return new Promise((resolve, reject) => {
      const req = (url.protocol === "https:" ? https : http).request(url, {
        method: "GET",
        rejectUnauthorized: !config.allowInsecureCertificate,
        headers: { Accept: "application/json",
          Authorization: "Basic " + Buffer.from(config.user + ":" + config.password).toString("base64") }
      }, res => {
        const chunks = [];
        let size = 0;
        res.on("data", chunk => {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) { req.destroy(new Error("SAP response exceeds 16 MiB.")); return; }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString("utf8"));
          } else {
            const hint = res.statusCode === 401 ? "Check SAP user and password."
              : res.statusCode === 403 ? "Check SAP authorizations."
              : res.statusCode === 404 ? "Check the SDE ADT review resource installation."
              : res.statusCode >= 300 && res.statusCode < 400 ? "Redirects are not followed; configure the SAP endpoint directly."
              : "The SAP review resource failed.";
            reject(new Error("SAP HTTP " + res.statusCode + ": " + hint));
          }
        });
      });
      // Wall-clock deadline includes connection establishment and response body.
      const timer = setTimeout(() => req.destroy(new Error("SAP request timed out.")), config.timeout);
      req.on("close", () => clearTimeout(timer));
      req.on("error", error => reject(new Error(
        error.message === "SAP request timed out." || error.message === "SAP response exceeds 16 MiB."
          ? error.message : "SAP connection failed (" + (error.code || "network error") + ").")));
      req.end();
    });
  };
}

module.exports = { configuration, createReader };
