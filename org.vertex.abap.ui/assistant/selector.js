"use strict";

// SelecTor's assistant: what it may learn about a table, and the shape of the
// answer it has to give.
//
// Everything an assistant is shown here is metadata. The layout of a table is
// read from the join resource without a row count, which is the one answer of
// SDE that carries the fields, their texts and keys, and the tables the
// dictionary offers around them, and reads no row to do it. Table contents are
// business data: the model configures the query, and SelecTor runs it and
// shows the rows to the person who asked, not to the model.

const OPTIONS = ["EQ", "NE", "GT", "GE", "LT", "LE", "CP", "NP", "BT", "NB"];
const RANGED = ["BT", "NB"];

// The page's own words for which way a key points.
const DIRECTION = { O: "foreign key", I: "used by", T: "text table", M: "added" };

const TOOLS = [
  {
    name: "sap_table_layout",
    description:
      "The layout of an SAP table as VERTEX SelecTor builds a query from it: the fields of "
      + "the base table, which filters go on; the tables the ABAP dictionary offers to join "
      + "around it; and, for the join given, the tables in the statement and every field as "
      + "an alias~field key with the aggregations a pivot allows for it. Reads no table "
      + "contents.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "The base table, for example SFLIGHT."
        },
        join: {
          type: "array",
          items: { type: "string" },
          description: "Tables taken into the join so far, in order. Each has to be among "
                     + "the tables offered around the ones before it."
        }
      },
      required: ["table"]
    }
  }
];

/* What the assistant must hand back: the whole state SelecTor is to be put in,
   not a change to it. Every property is required and none may be added, which
   is the form both Claude Code's --json-schema and Codex's --output-schema
   accept; "not used" is an empty string or an empty list. */
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "table", "filters", "join", "fields", "pivot"],
  properties: {
    reply: { type: "string" },
    table: { type: "string" },
    filters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "sign", "option", "low", "high"],
        properties: {
          field: { type: "string" },
          sign: { type: "string", enum: ["I", "E"] },
          option: { type: "string", enum: OPTIONS },
          low: { type: "string" },
          high: { type: "string" }
        }
      }
    },
    join: { type: "array", items: { type: "string" } },
    fields: { type: "array", items: { type: "string" } },
    pivot: {
      type: "object",
      additionalProperties: false,
      required: ["rows", "cols", "vals"],
      properties: {
        rows: { type: "array", items: { type: "string" } },
        cols: { type: "array", items: { type: "string" } },
        vals: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "agg"],
            properties: { key: { type: "string" }, agg: { type: "string" } }
          }
        }
      }
    }
  }
};

const INSTRUCTIONS = [
  "You set up queries in VERTEX SelecTor, a browser for SAP tables. The user says what they",
  "want to see; you answer with the complete state SelecTor is to be put in, and SelecTor",
  "runs the query and shows the rows itself. You never see table contents and cannot ask",
  "for them.",
  "",
  "- Use the supplied SAP layouts; call sap_table_layout for any missing layout. Never guess a table, a field,",
  "  a join table or a key.",
  "- filters go on fields of the base table only, named plainly as the tool lists them under",
  "  \"Fields of\" (CARRID), never as an alias~field key. sign I includes, E excludes. option is one",
  "  of EQ NE GT GE LT LE CP NP BT NB; CP and NP take * patterns; BT and NB need low and",
  "  high, every other option leaves high empty. Values are written as SAP stores them:",
  "  codes in upper case, dates as YYYYMMDD, numbers without separators.",
  "- join lists the tables to join, in order, and only tables sap_table_layout offers. After",
  "  choosing one, use the supplied layout for that exact join or call the tool with the join so far.",
  "- fields is the SELECT list of a join, as alias~field keys from the tool. Leave it empty",
  "  to keep SelecTor's own proposal, which is every field.",
  "- pivot: rows and cols are alias~field keys; vals are keys with an agg the tool lists for",
  "  that field. Leave all three empty for no pivot. A pivot needs no join.",
  "- The request comes with SelecTor's current state. Return the complete state wanted,",
  "  keeping whatever the user did not ask to change.",
  "- If the request cannot be done with these means, leave table empty and say why.",
  "- reply: one or two sentences, in the language the user wrote in, saying what was set up."
].join("\n");

function prompt(text, state) {
  return "SelecTor's current state:\n" + JSON.stringify(state || {}, null, 2)
       + "\n\nRequest:\n" + String(text || "");
}

// Prepare metadata in the host, where SAP access is already available. Individual
// layouts do not share aliases: only the layout of the exact join defines them.
async function preparePrompt(deps, text, state) {
  state = state || {};
  const requested = new Set((String(text || "").match(/(?:\/[A-Za-z0-9_]+\/)?[A-Za-z][A-Za-z0-9_]{2,29}/g) || []).map(upper));
  const cache = new Map();
  const sections = [];
  async function read(table, join) {
    const path = layoutPath(table, join);
    if (!cache.has(path)) {
      try {
        cache.set(path, await readLayout(deps, table, join));
      } catch (error) {
        cache.set(path, { error: error.message });
      }
      const result = cache.get(path);
      sections.push("Layout request: " + JSON.stringify({ table, join }) + "\n"
        + (result.error ? "Layout unavailable: " + result.error : layoutText(result.data, table)));
    }
    return cache.get(path);
  }
  const tables = [...new Set(names([state.table].concat(names(state.join))))];
  // Recognize table names without assuming a particular SAP naming prefix. SAP
  // validates identifiers; a word in prose is never accepted as a schema.
  const keywords = new Set("SELECT JOIN INNER LEFT RIGHT OUTER FROM WHERE GROUP BY HAVING ORDER ASC DESC PIVOT COUNT SUM AVG MIN MAX DISTINCT AND OR NOT NULL AS ON".split(" "));
  const probes = [...requested].filter(t => !keywords.has(t) && !tables.includes(t));
  for (const table of tables) { await read(table, []); }
  for (const table of probes.slice(0, 32)) { await read(table, []); }
  if (probes.length > 32) { sections.push("Additional identifiers were not prefetched; use sap_table_layout for missing tables."); }
  const valid = [...cache.entries()].filter(([p, r]) => !r.error
    && upper(r.data.table) === decodeURIComponent(p.split("/").pop()))
    .map(([p]) => decodeURIComponent(p.split("/").pop()));
  // A request may replace the current base (for example SFLIGHT -> SBOOK
  // to filter CANCELLED). Supply joins rooted at each requested table so the
  // model can choose the base from the requested filters, not the open page.
  const bases = [...new Set([upper(state.table)].concat(valid.filter(t => requested.has(t))))].filter(Boolean);
  for (const base of bases) {
    const joined = base === upper(state.table) ? names(state.join).slice() : [];
    let result = await read(base, joined);
    const pending = new Set(valid.filter(t => t !== base && !joined.includes(t) && requested.has(t)));
    while (!result.error && pending.size) {
      const next = (result.data.candidates || []).map(c => upper(c.tabname)).find(t => pending.has(t));
      if (!next) { break; }
      pending.delete(next);
      joined.push(next);
      result = await read(base, joined);
    }
  }
  return prompt(text, state) + "\n\nSAP metadata (no table contents). Each layout has its own aliases; use the exact join layout for the plan:\n\n" + sections.join("\n\n");
}

/* ---------- reading the layout ---------- */

function layoutPath(table, join) {
  let p = "/sap/bc/adt/zsde/join/" + encodeURIComponent(upper(table));
  names(join).forEach(function (name, i) {
    p += (i === 0 ? "?" : "&") + "t" + (i + 1) + "=" + encodeURIComponent(name);
  });
  // No row count on purpose: without one the resource answers with the
  // statement and reads nothing.
  return p;
}

async function readLayout(deps, table, join) {
  const body = await deps.fetch(deps.context, layoutPath(table, join));
  if (typeof body !== "string") {
    return { error: "No answer from the SAP system." };
  }
  if (body.indexOf("ERROR:") === 0) {
    // The host marks a missing resource for its pages; to a model it is the
    // sentence after the mark that means something.
    return { error: body.substring(6).replace(/^NOBACKEND:/, "") };
  }
  try {
    return { data: JSON.parse(body) };
  } catch (e) {
    return { error: "The layout of " + upper(table) + " is not JSON: " + body.substring(0, 300) };
  }
}

function layoutText(data, table) {
  const base = upper(data.table || table);
  const fields = data.fields || [];
  const own = fields.filter(function (f) { return upper(f.tabname) === base; });
  const lines = [];

  lines.push("Base table " + base + ".");
  lines.push("");
  lines.push("Fields of " + base + " - a filter names one of these plainly, not as a key"
             + " (field, key, type, text):");
  own.forEach(function (f) {
    lines.push("  " + pad(upper(f.fieldname), 30) + " " + (truthy(f.key) ? "key " : "    ")
               + pad(f.datatype || "", 5) + " " + (f.ddtext || ""));
  });

  lines.push("");
  const offered = data.candidates || [];
  if (offered.length === 0) {
    lines.push("The dictionary offers no table to join around it.");
  } else {
    lines.push("Tables the dictionary offers to join (table, relation, text):");
    offered.forEach(function (c) {
      lines.push("  " + pad(upper(c.tabname), 30) + " "
                 + pad(DIRECTION[c.direction] || c.direction || "", 12) + " "
                 + (c.ddtext || "") + (truthy(c.selected) ? "  [in the join]" : ""));
    });
  }

  const tables = data.tables || [];
  if (tables.length > 0) {
    lines.push("");
    lines.push("Tables in the statement (alias, table, join type, condition):");
    tables.forEach(function (t) {
      lines.push("  " + pad(t.alias || "", 4) + " " + pad(upper(t.tabname), 30) + " "
                 + pad(t.jtype || "", 10) + " " + (t.cond || ""));
    });
  }

  lines.push("");
  lines.push("Keys for fields and pivot (key, text, aggregations):");
  fields.forEach(function (f) {
    lines.push("  " + pad(keyOf(f), 36) + " " + pad(f.ddtext || "", 40) + " "
               + (f.aggs && f.aggs.length ? f.aggs.join(" ") : "COUNT"));
  });
  return lines.join("\n");
}

async function callTool(deps, name, args) {
  if (name !== "sap_table_layout") {
    return fail("This server has no tool called " + name + ".");
  }
  const table = args && args.table ? upper(args.table) : "";
  if (!table) {
    return fail("Name the base table, for example SFLIGHT.");
  }
  const answer = await readLayout(deps, table, args.join);
  if (answer.error) { return fail(answer.error); }
  return ok(layoutText(answer.data, table));
}

/* ---------- checking what came back ---------- */

/* The plan against the dictionary, before anything is put on the page. A model
   that names a field the table does not have gets its plan refused with the
   reason, instead of a selection panel quietly missing a line. What passes is
   written the way the page writes it: field names in lower case as the table
   resource returns them, keys as alias~field in lower case. */
async function checkPlan(deps, plan) {
  const reply = String(plan && plan.reply || "").trim();
  const table = upper(plan && plan.table);
  if (!table) {
    return { reply: reply, table: "", filters: [], join: [], fields: [],
             pivot: { rows: [], cols: [], vals: [] } };
  }

  const join = names(plan.join);
  const answer = await readLayout(deps, table, join);
  if (answer.error) {
    throw new Error("The plan asks for " + table + (join.length ? " joined with " + join.join(", ") : "")
                    + ", and SAP answered: " + answer.error);
  }
  const fields = answer.data.fields || [];
  const own = {};
  fields.forEach(function (f) {
    if (upper(f.tabname) === table) { own[upper(f.fieldname)] = f; }
  });
  const byKey = {};
  fields.forEach(function (f) { byKey[keyOf(f)] = f; });

  const filters = (plan.filters || []).map(function (f) {
    const field = own[upper(f.field)];
    if (!field) {
      throw new Error("The plan filters on " + upper(f.field) + ", which " + table
                      + " does not have. Filters go on fields of the base table.");
    }
    const option = upper(f.option);
    if (OPTIONS.indexOf(option) < 0) {
      throw new Error("The plan uses option " + option + " on " + upper(f.field) + ".");
    }
    const ranged = RANGED.indexOf(option) >= 0;
    if (ranged && String(f.high || "") === "") {
      throw new Error("The plan uses " + option + " on " + upper(f.field) + " without an upper bound.");
    }
    return {
      field: String(field.fieldname).toLowerCase(),
      text: field.ddtext || "",
      sign: upper(f.sign) === "E" ? "E" : "I",
      option: option,
      low: String(f.low || ""),
      high: ranged ? String(f.high) : ""
    };
  });

  const key = function (raw, what) {
    const k = String(raw || "").trim().toLowerCase();
    if (!byKey[k]) {
      throw new Error("The plan puts " + raw + " into " + what + ", and the join has no such key.");
    }
    return k;
  };
  const pivot = plan.pivot || {};
  const vals = (pivot.vals || []).map(function (v) {
    const k = key(v.key, "the measures");
    const allowed = byKey[k].aggs && byKey[k].aggs.length ? byKey[k].aggs : ["COUNT"];
    const agg = upper(v.agg);
    if (allowed.indexOf(agg) < 0) {
      throw new Error("The plan aggregates " + k + " by " + agg + "; the pivot allows "
                      + allowed.join(", ") + " for it.");
    }
    return { key: k, agg: agg };
  });

  return {
    reply: reply,
    table: table,
    filters: filters,
    join: join,
    fields: (plan.fields || []).map(function (f) { return key(f, "the SELECT list"); }),
    pivot: {
      rows: (pivot.rows || []).map(function (f) { return key(f, "the pivot rows"); }),
      cols: (pivot.cols || []).map(function (f) { return key(f, "the pivot columns"); }),
      vals: vals
    }
  };
}

/* ---------- small things ---------- */

function keyOf(f) {
  return (String(f.alias || "") + "~" + String(f.fieldname || "")).toLowerCase();
}

function names(list) {
  return (Array.isArray(list) ? list : [])
    .map(function (t) { return upper(t); })
    .filter(Boolean);
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function truthy(flag) {
  return flag === true || flag === "X";
}

function pad(text, width) {
  const s = String(text);
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
exports.preparePrompt = preparePrompt;
exports.checkPlan = checkPlan;
exports.layoutPath = layoutPath;
exports.layoutText = layoutText;
