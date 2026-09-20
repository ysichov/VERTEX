/* Shared object/action contract, used by both hosts and the assistant. */
(function (root) {
  "use strict";
  const objects = [
    ["TABL", "Table", ["data", "join", "pivot", "diff"]],
    ["CLAS", "Class", ["view", "uml", "metrics", "scheme", "flow", "diff"]],
    ["INTF", "Interface", ["uml", "diff"]],
    ["PROG", "Program", ["view", "metrics", "scheme", "flow", "diff"]],
    ["INCL", "Include", ["metrics", "scheme", "flow", "diff"]],
    ["DEVC", "Package", ["uml", "metrics", "diff"]],
    ["TR", "Transport request", ["review", "diff"]],
    ["FUGR", "Function group", ["diff"]],
    ["FUNC", "Function module", ["view", "diff"]],
    ["DDLS", "CDS", ["diff"]], ["DOMA", "Domain", ["diff"]], ["DTEL", "Data element", ["diff"]]
  ];
  const labels = { view: "View source", data: "Data", join: "Join", pivot: "Pivot", diff: "Diff", review: "Review",
    uml: "UML", metrics: "Metrics", scheme: "Scheme", flow: "Flow" };
  // Visual order is not the default action: Diff belongs at the end of the
  // picker, while a class/package opened from a version-oriented command must
  // still start on Diff unless the caller selected a view explicitly.
  const defaults = { TABL: "data", CLAS: "view", INTF: "diff", PROG: "view",
    INCL: "diff", DEVC: "diff", TR: "review", FUGR: "diff", FUNC: "view",
    DDLS: "diff", DOMA: "diff", DTEL: "diff" };
  function normalize(value) {
    const type = String(value.type || "CLAS").toUpperCase().split("/")[0];
    const item = objects.find(o => o[0] === type);
    if (!item) throw new Error("Unsupported object type: " + type);
    const name = String(value.name || "").trim().toUpperCase();
    if (name && !/^[A-Z0-9_/$]+$/.test(name)) throw new Error("Use an exact SAP object name.");
    const action = value.action || defaults[type] || item[2][0];
    if (!item[2].includes(action)) throw new Error(labels[action] + " is unavailable for " + item[1]);
    return { type, name, action };
  }
  const navigationSchema = { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
    required: ["type", "name", "action"], properties: {
      type: { type: "string", enum: objects.map(o => o[0]) }, name: { type: "string" },
      action: { type: "string", enum: Object.keys(labels) }
    } }] };
  const instructions = "When asked to run a VERTEX function, return navigation with the exact object type, name and action. "
    + "Use the current workspace object when requested. Ask if the object is ambiguous. Do not claim execution: the UI runs the function after your reply. "
    + "Use null navigation for other answers. Available types and actions: " + JSON.stringify(objects)
    + ". Default to review for TR and diff for versioned code objects and packages; data for tables. Package UML uses DEVC/uml.";
  const api = { objects, labels, normalize, navigationSchema, instructions };
  if (typeof module !== "undefined") module.exports = api;
  else root.VertexObjects = api;
})(typeof window === "undefined" ? globalThis : window);
