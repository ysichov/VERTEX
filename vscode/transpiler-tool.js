"use strict";

const schema = {
  name: "run_abap_transpiler",
  annotations: { readOnlyHint: true, destructiveHint: false },
  description: "Run an ABAP report, class method or function module with the local transpiler and return its output. This simulates ABAP execution; it is not a SAP runtime run. SELECT may read the selected SAP system through VERTEX. Parallel runs use isolated local projects. Use interventions to replace a scalar variable immediately before a specified ABAP line for a testable hypothesis; the trace records before and after values. Use this first for runnable code; if compilation or runtime says the case is unsupported, explain why and ask the user whether to run it in SAP. For a class, read its source and supply entry_line inside the method. Supply selection values for reports that need parameters.",
  inputSchema: { type: "object", additionalProperties: false, required: ["object_type", "object_name"], properties: {
    object_type: { type: "string", enum: ["PROG", "CLAS", "FUNC"] },
    object_name: { type: "string", description: "Exact SAP technical name." },
    entry_line: { type: "integer", minimum: 1, description: "Line inside the class method or function module to execute. Required for CLAS." },
    screen_only: { type: "boolean", description: "Return the selection screen or method argument fields without executing." },
    selection: { type: "object", description: "Selection screen values. Radio group IDs map to chosen parameter names; other values go in $parameters. For a method or function module, supply its $entry arguments.", additionalProperties: true },
    interventions: { type: "array", maxItems: 10, description: "Local transpiler only: replace a scalar ABAP variable before the chosen source line. Each replacement is recorded in the run history.", items: { type: "object", additionalProperties: false,
      required: ["object_name", "line", "name", "value"], properties: {
        object_name: { type: "string", description: "Exact program, class, include or function module name containing the line." },
        line: { type: "integer", minimum: 1 }, name: { type: "string", description: "Simple ABAP variable or parameter name." },
        value: { type: ["string", "number", "boolean"] }, occurrence: { type: "integer", minimum: 1, description: "Which execution of this line; default 1." }
      } } },
    system: { type: "string", description: "Configured SAP system; defaults to the active system." }
  } }
};

function validate(args) {
  const kind = String(args?.object_type || "").toUpperCase();
  if (!["PROG", "CLAS", "FUNC"].includes(kind)) throw new Error("The transpiler can run PROG, CLAS or FUNC only.");
  const object_name = String(args?.object_name || "").toUpperCase();
  if (!/^[A-Z0-9_/$]+$/.test(object_name) || object_name.length > 40) throw new Error("Use an exact SAP object name.");
  if (kind === "CLAS" && (!Number.isInteger(args.entry_line) || args.entry_line < 1))
    throw new Error("Read the class source and supply entry_line inside the method to run.");
  if (args.entry_line !== undefined && (!Number.isInteger(args.entry_line) || args.entry_line < 1))
    throw new Error("entry_line must be a positive source line.");
  if (args.selection !== undefined && (!args.selection || Array.isArray(args.selection) || typeof args.selection !== "object"))
    throw new Error("selection must be an object of parameter values.");
  const interventions = args.interventions || [];
  if (!Array.isArray(interventions) || interventions.length > 10) throw new Error("interventions must contain at most 10 replacements.");
  for (const item of interventions) {
    if (!item || !/^[A-Z0-9_/$]+$/i.test(item.object_name || "") || !/^[A-Z_][A-Z0-9_]*$/i.test(item.name || "")
      || !Number.isInteger(item.line) || item.line < 1 || item.occurrence !== undefined && (!Number.isInteger(item.occurrence) || item.occurrence < 1)
      || !["string", "number", "boolean"].includes(typeof item.value) || typeof item.value === "number" && !Number.isFinite(item.value))
      throw new Error("Each intervention needs an exact object_name, positive line, simple variable name, finite scalar value and optional positive occurrence.");
  }
  return { object_name, object_type: kind, entryLine: args.entry_line || 0, selection: args.selection || {},
    ...(interventions.length ? { interventions: interventions.map((item, index) => ({ id: index + 1, object_name: item.object_name.toUpperCase(),
      line: item.line, name: item.name.toUpperCase(), value: item.value, occurrence: item.occurrence || 1 })) } : {}) };
}

function describeScreen(screen) {
  return (screen?.elements || []).filter(e => !e.hidden && ["parameter", "select-option"].includes(e.kind))
    .map(e => ({ name: e.name, label: screen.texts?.selections?.[e.name] || e.name, kind: e.kind,
      ...(e.radio ? { radio_group: e.radio } : {}), ...(e.checkbox ? { checkbox: true } : {}),
      ...(e.obligatory ? { obligatory: true } : {}), ...(e.default ? { default: e.default } : {}) }));
}

// ABAP names are case-insensitive, so keys and radio choices are upper-cased. Anything the screen does not
// have is refused: an ignored key would run the defaults and look like the requested case.
function normalizeSelection(screen, selection) {
  const elements = (screen?.elements || []).filter(e => ["parameter", "select-option"].includes(e.kind));
  const groups = {};
  for (const e of elements) if (e.radio) (groups[e.radio.toUpperCase()] ||= []).push(e.name.toUpperCase());
  const plain = new Set(elements.filter(e => e.kind === "parameter" && !e.radio).map(e => e.name.toUpperCase()));
  const ranges = new Set(elements.filter(e => e.kind === "select-option").map(e => e.name.toUpperCase()));
  const shape = Object.entries(groups).map(([g, c]) => '"' + g + '": one of ' + c.join("/")).join("; ");
  const result = {};
  for (const [key, value] of Object.entries(selection || {})) {
    const name = key.toUpperCase();
    if (name === "$PARAMETERS" || name === "$RANGES") {
      const known = name === "$PARAMETERS" ? plain : ranges, out = {};
      for (const [field, v] of Object.entries(value || {})) {
        if (!known.has(field.toUpperCase())) throw new Error(field + " is not a " + (name === "$PARAMETERS" ? "parameter" : "select-option")
          + " of this selection screen. Known: " + ([...known].join(", ") || "none") + ".");
        out[field.toUpperCase()] = v;
      }
      result[name === "$PARAMETERS" ? "$parameters" : "$ranges"] = out;
    } else if (name === "$ENTRY") result.$entry = value;
    else if (groups[name]) {
      const choice = String(value).toUpperCase();
      if (!groups[name].includes(choice)) throw new Error("Radio group " + name + " has no choice " + value + ". Use " + groups[name].join("/") + ".");
      result[name] = choice;
    } else throw new Error("Selection key " + key + " is not on this screen. Radio groups: " + (shape || "none")
      + "; other parameters go in $parameters, select-options in $ranges.");
  }
  return result;
}

function missingSelection(screen, selection) {
  return (screen?.elements || []).filter(e => e.obligatory && !e.hidden && !e.radio &&
    (e.kind === "parameter" || e.kind === "select-option")).filter(e => {
    if (e.kind === "select-option") return !(selection.$ranges?.[e.name]?.length || e.default?.low);
    const value = selection.$parameters?.[e.name];
    return !(value !== undefined ? String(value).trim() : String(e.default || "").trim());
  }).map(e => e.name);
}

function missingEntry(entry, selection) {
  const values = selection.$entry || {};
  return [
    ...(entry.creation || []).filter(p => !p.optional && !p.default && values.creation?.[p.name] === undefined)
      .map(p => "constructor " + p.name),
    ...(entry.parameters || []).filter(p => ["importing", "changing", "tables"].includes(p.direction)
      && !p.optional && !p.default && values.parameters?.[p.name] === undefined).map(p => p.name)
  ];
}

function createRunQueue() {
  let tail = Promise.resolve();
  return work => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
}

module.exports = { schema, validate, describeScreen, normalizeSelection, missingSelection, missingEntry, createRunQueue };
