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
    uml: "UML diagram", metrics: "Metrics", scheme: "Logic diagram", flow: "Calls diagram" };
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
    // The part within the object - a method, a form, an event - when the
    // request named one. Kept only when there is one, so a plain navigation
    // stays the three fields it always was.
    const part = String(value.part || "").trim();
    return part ? { type, name, action, part } : { type, name, action };
  }
  const navigationSchema = { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
    required: ["type", "name", "action", "part"], properties: {
      type: { type: "string", enum: objects.map(o => o[0]) }, name: { type: "string" },
      action: { type: "string", enum: Object.keys(labels) },
      part: { type: ["string", "null"], description: "The method, form or event within the object, when the request names one; otherwise null." }
    } }] };
  const instructions = "When asked to run a VERTEX function, return navigation with the exact object type, name and action. "
    + "Only an explicit request to open, show or switch to a function changes the view. "
    + "A request to open or show is answered with one short sentence naming what opens - no summary, review or description "
    + "of its content, even when that content is supplied as context, unless the request asks for it. Explaining, describing, reviewing or any question "
    + "about what is on screen keeps the view: navigation null. "
    + "Use the current workspace object when requested. Ask if the object is ambiguous. Do not claim execution: the UI runs the function after your reply. "
    + "Use null navigation for other answers. Available types and actions: " + JSON.stringify(objects)
    + ". In Tools, show/view/open source uses action view for PROG, CLAS and FUNC. Return navigation instead of calling open_sap_object for viewing. For explicit editing requests use open_sap_object to open an editable VS Code tab. Default to review for TR, diff for packages and data for tables. Logic diagram (action scheme) is the flowchart of one method; Calls diagram (action flow) is which unit calls which in the whole object. Diff is the version history: versions, history, what changed, compare versions or who changed it all mean action diff, never view. Package UML uses DEVC/uml. When the request names a method, form or event of the object - CLASS->METHOD, CLASS=>METHOD, 'method X of class Y' - put the object in name and that unit alone in part; otherwise part is null.";
  const api = { objects, labels, normalize, navigationSchema, instructions };
  if (typeof module !== "undefined") module.exports = api;
  else root.VertexObjects = api;
})(typeof window === "undefined" ? globalThis : window);
