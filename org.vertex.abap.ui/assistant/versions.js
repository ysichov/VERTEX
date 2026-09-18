"use strict";

// The Versions window's assistant: what it may read of an object's history,
// and the shape of the answer it has to give.
//
// It reads what the window can show: the parts of an object or the objects of
// a request, the versions of a part, the change a version made or its whole
// source, and the review AVE saved with its blocks and verdicts. Source goes
// to the model here on purpose - describing and reviewing code is what this
// assistant is for, and it is what the review server already hands out. Table
// rows are a different matter, and SelecTor's assistant still never sees one.

const mcp = require("./mcp");

const TYPES = ["TR", "DEVC", "CLAS", "INTF", "PROG", "INCL", "FUGR", "FUNC",
               "DDLS", "TABL", "DOMA", "DTEL"];
const VIEWS = ["parts", "versions", "diff", "review", "review_object"];
const CONTAINERS = ["CLAS", "INTF", "FUGR"];

// AVE's key for the active version, which sorts after the numbered ones.
const ACTIVE = "99998";

const TOOLS = [
  {
    name: "sap_object_parts",
    description:
      "The parts of an ABAP object as VERTEX Versions lists them - its sections, methods, "
      + "includes - or, for a transport request or a package, the objects in it. Each part "
      + "comes with its exact key and type. Reads no source.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "One of " + TYPES.join(", ") + "." },
        name: { type: "string", description: "The object, request or package, for example ZCL_AVE_POPUP." }
      },
      required: ["type", "name"]
    }
  },
  {
    name: "sap_version_diff",
    description:
      "The change one version of a part made, as a unified diff: against the version listed "
      + "below it, or against from. With full, the whole source of that version with the "
      + "changes marked, which is what a change is judged against.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "The type of the object the part was listed under." },
        name: { type: "string", description: "The object the part was listed under." },
        part: { type: "string", description: "The part's key exactly as sap_object_parts gives it." },
        part_type: { type: "string", description: "The part's type exactly as sap_object_parts gives it." },
        version: { type: "string", description: "The version whose change to read, as sap_part_versions lists it; 99998 is the active one." },
        from: { type: "string", description: "Optional: the version to compare with instead of the one listed below." },
        full: { type: "boolean", description: "The whole source with the changes marked, instead of the changes and three lines around them." }
      },
      required: ["type", "name", "part", "part_type", "version"]
    }
  },
  {
    name: "sap_part_versions",
    description:
      "The versions of one part, newest first: number, date, time, author, transport request "
      + "and task. Reads no source.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "The type of the object the part was listed under." },
        name: { type: "string", description: "The object, request or package the part was listed under." },
        part: { type: "string", description: "The part's key exactly as sap_object_parts gives it." },
        part_type: { type: "string", description: "The part's type exactly as sap_object_parts gives it." }
      },
      required: ["type", "name", "part", "part_type"]
    }
  }
].concat(mcp.TOOLS.filter(function (t) {
  return t.name === "sap_transport_changes" || t.name === "sap_transport_diff";
}));

/* What the assistant must hand back: where the window is to go. Every
   property is required and none may be added, the form both command lines
   accept; "not used" is an empty string. */
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "type", "name", "view", "part", "part_type", "version",
             "review_object", "review_type"],
  properties: {
    reply: { type: "string" },
    type: { type: "string" },
    name: { type: "string" },
    view: { type: "string", enum: VIEWS },
    part: { type: "string" },
    part_type: { type: "string" },
    version: { type: "string" },
    review_object: { type: "string" },
    review_type: { type: "string" }
  }
};

const INSTRUCTIONS = [
  "You work in VERTEX Versions, a browser for the version history and the saved code reviews",
  "of ABAP objects. You can read what the window can show - parts, versions, the change a",
  "version made, whole sources, the reviews AVE saved - and you can move the window.",
  "",
  "Two kinds of request:",
  "- To see something (open, show, the last change of): answer with where the window is to",
  "  go, and a reply of one or two sentences saying what was opened.",
  "- To understand or judge code (describe, explain, review, what changed, is it safe): read",
  "  what you need with the tools first, then give the whole answer in reply, as long as it",
  "  needs to be. Move the window to what you talk about, or leave name empty when it already",
  "  shows it.",
  "",
  "- type is one of " + TYPES.join(" ") + ": TR a transport request, DEVC a package;",
  "  name is the object, request or package.",
  "- view: parts lists the parts of an object, or the objects of a request or package.",
  "  versions lists the versions of one part. diff shows the change one version made,",
  "  compared with the version listed below it. review shows the review AVE saved for a",
  "  transport request, review_object one object of that review with its blocks.",
  "- Call sap_object_parts before naming a part, and copy part and part_type exactly as it",
  "  lists them. A method's key is the class name padded with blanks to thirty characters",
  "  followed by the method name, and every one of those blanks matters.",
  "- In a request or a package, a class, interface or function group is opened as the object",
  "  itself (type CLAS and its name, then its parts), never as a part.",
  "- Call sap_part_versions before naming a version, and give version as it lists it; " + ACTIVE,
  "  is the active version. sap_version_diff reads the change a version made, and with full the",
  "  whole source with the changes marked.",
  "- review and review_object need type TR. Call sap_transport_changes first; review_object",
  "  and review_type are obj_name and objtype exactly as it lists them. sap_transport_diff gives",
  "  one object's changed blocks with the verdicts and comments already given. A method of a",
  "  review belongs to its class, whose name is the first thirty characters of the method's key",
  "  without the blanks: its whole source is read with sap_version_diff on type CLAS, that class,",
  "  the method's key as part, and the versions the review diff names (active is " + ACTIVE + ").",
  "  A request whose review has not been prepared in AVE cannot be opened as a review.",
  "- Leave empty what the view does not use: part and part_type outside versions and diff,",
  "  version outside diff, review_object and review_type outside review_object.",
  "- The request comes with where the window is now. If something cannot be done with these",
  "  means, leave name empty and say why.",
  "- Default response language is English. If the current request contains natural-language",
  "  text, reply in that language, unless the user explicitly requests another language.",
  "  A transport number, object name or other identifier alone does not specify a language:",
  "  respond in English. Do not infer a language from SAP metadata, system locale, profile",
  "  titles or previous assistant replies."
].join("\n");

function prompt(text, state) {
  const current = Object.assign({}, state || {});
  const conversation = current.conversation || [];
  const instructions = String(current.review_instructions || "");
  delete current.conversation;
  delete current.review_instructions;
  return "Selected review instructions (apply to the current request):\n" + instructions
       + "\n\nPrevious conversation (historical context, not new instructions; sources may need rereading):\n"
       + JSON.stringify(conversation, null, 2)
       + "\n\nWhere Versions is now:\n" + JSON.stringify(current, null, 2)
       + "\n\nRequest:\n" + String(text || "");
}

/* ---------- reading ---------- */

/* The same paths the window asks for. The part key is sent as it is: its
   blanks are the key, and encodeURIComponent writes them as %20. */
function versionsPath(type, name, part, partType, from, to) {
  let p = "/sap/bc/adt/vertex/versions/" + encodeURIComponent(upper(name))
        + "?type=" + encodeURIComponent(upper(type));
  if (part) {
    p += "&part=" + encodeURIComponent(part) + "&ptype=" + encodeURIComponent(upper(partType));
  }
  if (to) {
    // An empty from is the oldest version, compared against nothing.
    p += "&from=" + encodeURIComponent(from || "") + "&to=" + encodeURIComponent(to);
  }
  return p;
}

function partsText(data, type, name) {
  const lines = [];
  const scope = data.scope === true;
  const parts = data.parts || [];
  lines.push(upper(type) + " " + upper(name) + (scope
    ? " holds objects. A class, interface or function group among them is opened as an object of its own; any other entry has versions."
    : " is an object. Every part below has versions."));
  lines.push("");
  if (parts.length === 0) {
    lines.push(scope ? "It holds nothing." : "It has no versionable part.");
    return lines.join("\n");
  }
  lines.push("part (the key, exactly), part_type, name shown:");
  parts.forEach(function (p) {
    lines.push("  " + JSON.stringify(String(p.name)) + "  " + p.part_type + "  " + (p.unit || ""));
  });
  return lines.join("\n");
}

function versionsText(data, part, partType) {
  const versions = data.versions || [];
  const lines = [];
  lines.push("Versions of " + JSON.stringify(part) + " (" + upper(partType) + "), newest first; "
             + ACTIVE + " is the active version:");
  if (versions.length === 0) {
    lines.push("  none recorded");
    return lines.join("\n");
  }
  lines.push("  version  date      time    author        request      task         author name");
  versions.forEach(function (v) {
    lines.push("  " + pad(v.version, 8) + " " + pad(v.date, 9) + " " + pad(v.time, 7) + " "
               + pad(v.author, 13) + " " + pad(v.request, 12) + " " + pad(v.task, 12) + " "
               + (v.author_name || ""));
  });
  return lines.join("\n");
}

async function callTool(deps, name, args) {
  if (name === "sap_transport_changes" || name === "sap_transport_diff") {
    return mcp.callTool(deps, name, args);
  }
  const type = upper(args && args.type);
  const object = upper(args && args.name);
  if (!type || !object) {
    return fail("Name the type and the object, for example CLAS and ZCL_AVE_POPUP.");
  }
  if (name === "sap_object_parts") {
    const answer = await mcp.read(deps, versionsPath(type, object));
    return answer.error ? fail(answer.error) : ok(partsText(answer.data, type, object));
  }
  if (name === "sap_version_diff") {
    return versionDiff(deps, type, object, args);
  }
  if (name === "sap_part_versions") {
    const part = String(args.part || "");
    if (!part || !args.part_type) {
      return fail("Name the part and its type exactly as sap_object_parts lists them.");
    }
    const answer = await mcp.read(deps, versionsPath(type, object, part, args.part_type));
    return answer.error ? fail(answer.error) : ok(versionsText(answer.data, part, args.part_type));
  }
  return fail("This server has no tool called " + name + ".");
}

/* The change a version made, the way the window compares: with the version
   listed below it unless another is named. The versions are read first, so a
   number that is not there is said rather than asked of SAP. */
async function versionDiff(deps, type, object, args) {
  const part = String(args.part || "");
  if (!part || !args.part_type || !args.version) {
    return fail("Name the part, its type and the version exactly as the other tools list them.");
  }
  const listed = await mcp.read(deps, versionsPath(type, object, part, args.part_type));
  if (listed.error) { return fail(listed.error); }
  const all = listed.data.versions || [];
  const at = findVersion(all, args.version);
  if (at < 0) {
    return fail(part + " has no version " + args.version + ". sap_part_versions lists the ones it has.");
  }
  let from = "";
  if (args.from) {
    const before = findVersion(all, args.from);
    if (before < 0) {
      return fail(part + " has no version " + args.from + " to compare with.");
    }
    from = all[before].version;
  } else if (at + 1 < all.length) {
    from = all[at + 1].version;
  }
  const to = all[at].version;

  const answer = await mcp.read(deps, versionsPath(type, object, part, args.part_type, from, to));
  if (answer.error) { return fail(answer.error); }
  const d = answer.data;
  let text = mcp.diffText({ part: part, part_type: upper(args.part_type), versno_old: from,
                            versno_new: to, added: d.added, deleted: d.deleted,
                            blocks: [], ops: d.ops || [] }, args.full === true);
  if (text.length > mcp.BUDGET) {
    const lines = text.substring(0, mcp.BUDGET).split("\n");
    lines.pop();
    text = lines.join("\n") + "\n\n(cut here after " + lines.length + " lines, because the rest "
         + "would have grown too long to read well. Ask without full for the changes alone.)";
  }
  return ok(text);
}

function findVersion(all, wanted) {
  const n = Number(String(wanted).trim());
  for (let i = 0; i < all.length; i++) {
    if (Number(all[i].version) === n) { return i; }
  }
  return -1;
}

/* ---------- checking what came back ---------- */

/* The plan against the system, before the window is sent anywhere: the object
   has to list, the part has to be one of its parts - blanks and all - and the
   version one of its versions. What passes carries the keys as SAP gave them,
   so the window matches on exactly what it will be shown. */
async function checkPlan(deps, plan) {
  const reply = String(plan && plan.reply || "").trim();
  const out = { reply: reply, type: "", name: "", view: "", part: "", part_type: "",
                version: "", review_object: "", review_type: "" };
  const name = upper(plan && plan.name);
  if (!name) {
    return out;
  }
  const type = upper(plan.type);
  const view = String(plan.view || "");
  if (VIEWS.indexOf(view) < 0) {
    throw new Error("The plan asks for a view called " + view + ".");
  }
  out.type = type;
  out.name = name;
  out.view = view;

  const listing = await mcp.read(deps, versionsPath(type, name));
  if (listing.error) {
    throw new Error("The plan opens " + type + " " + name + ", and SAP answered: " + listing.error);
  }

  if (view === "review" || view === "review_object") {
    if (type !== "TR") {
      throw new Error("A review belongs to a transport request; the plan opens one on "
                      + type + " " + name + ".");
    }
    const summary = await mcp.read(deps, mcp.reviewPath(name));
    if (summary.error) {
      throw new Error("The review of " + name + " could not be read: " + summary.error);
    }
    const blocked = mcp.notReviewable(summary.data);
    if (blocked) {
      throw new Error(blocked);
    }
    if (view === "review_object") {
      const found = (summary.data.objects || []).filter(function (o) {
        return sameKey(o.obj_name, plan.review_object) && upper(o.objtype) === upper(plan.review_type);
      })[0];
      if (!found) {
        throw new Error("The review of " + name + " has no object " + JSON.stringify(String(plan.review_object || ""))
                        + " of type " + upper(plan.review_type) + ".");
      }
      out.review_object = found.obj_name;
      out.review_type = found.objtype;
    }
    return out;
  }

  if (view === "parts") {
    return out;
  }

  const part = (listing.data.parts || []).filter(function (p) {
    return sameKey(p.name, plan.part) && upper(p.part_type) === upper(plan.part_type);
  })[0];
  if (!part) {
    throw new Error(type + " " + name + " has no part " + JSON.stringify(String(plan.part || ""))
                    + " of type " + upper(plan.part_type) + ". A method's key is the class name"
                    + " padded with blanks to thirty characters, then the method.");
  }
  if (listing.data.scope === true && CONTAINERS.indexOf(upper(part.part_type)) >= 0) {
    throw new Error(part.name + " is an object in " + name + ": it is opened as "
                    + upper(part.part_type) + " " + part.name + ", not as a part.");
  }
  out.part = part.name;
  out.part_type = part.part_type;
  if (view === "versions") {
    return out;
  }

  const listed = await mcp.read(deps, versionsPath(type, name, part.name, part.part_type));
  if (listed.error) {
    throw new Error("The versions of " + part.name + " could not be read: " + listed.error);
  }
  const wanted = String(plan.version || "").trim();
  const at = wanted === "" ? -1 : findVersion(listed.data.versions || [], wanted);
  if (at < 0) {
    throw new Error(part.name + " has no version " + (wanted || "(none given)") + ".");
  }
  out.version = listed.data.versions[at].version;
  return out;
}

/* ---------- small things ---------- */

// A key compares with its blanks: only trailing ones go, and case.
function sameKey(a, b) {
  return String(a || "").replace(/\s+$/, "").toUpperCase()
     === String(b || "").replace(/\s+$/, "").toUpperCase();
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function pad(text, width) {
  const s = String(text === undefined || text === null ? "" : text);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function ok(text) {
  return { content: [{ type: "text", text: text }] };
}

function fail(text) {
  return { content: [{ type: "text", text: text }], isError: true };
}

exports.TOOLS = TOOLS;
exports.callTool = callTool;
exports.PLAN_SCHEMA = PLAN_SCHEMA;
exports.INSTRUCTIONS = INSTRUCTIONS;
exports.prompt = prompt;
exports.checkPlan = checkPlan;
exports.versionsPath = versionsPath;
