"use strict";

// ADT transport with a per-system TLS policy on the request itself.
function create(system) {
  const base = new URL(system.url);
  const secure = base.protocol === "https:";
  if (!secure && base.protocol !== "http:") { throw new Error("Unsupported SAP URL protocol"); }
  const http = require(secure ? "https" : "http");
  const rejectUnauthorized = system.allowInsecureCertificate !== true;
  const agent = new http.Agent(secure ? { rejectUnauthorized } : {});
  return { request(options) {
    return new Promise((resolve, reject) => {
      const url = new URL(options.url, base);
      if (url.origin !== base.origin) { reject(new Error("ADT request outside configured SAP system")); return; }
      for (const [key, value] of Object.entries(options.qs || {})) {
        if (value !== undefined && value !== null) { url.searchParams.set(key, String(value)); }
      }
      const headers = { ...options.headers };
      const body = options.body;
      if (body !== undefined) { headers["Content-Length"] = Buffer.byteLength(body); }
      const req = http.request(url, {
        method: options.method || "GET", headers, agent,
        rejectUnauthorized,
        auth: options.auth ? options.auth.username + ":" + options.auth.password : undefined
      }, res => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { text += chunk; });
        res.on("error", reject);
        res.on("end", () => resolve({ body: text, status: res.statusCode,
          statusText: res.statusMessage, headers: res.headers }));
      });
      req.setTimeout(options.timeout || 60000, () => req.destroy(new Error("SAP request timed out")));
      req.on("error", reject);
      req.end(body);
    });
  } };
}
module.exports = { create };
