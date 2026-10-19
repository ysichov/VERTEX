"use strict";

// A request that is nothing but an object name needs no model: search the
// system, open the one exact match, or list what was found. Failures are thrown,
// not answered.

const NAME = /^[A-Z0-9_\/$*+]{3,40}$/i;

/**
 * True when the text is one SAP object name or name pattern and nothing else.
 * A plain word ("hello", "help") is not: a name must carry _, a digit, /, $ or a
 * wildcard, or start with the customer prefix Z or Y.
 */
function isObjectName(text) {
  const value = String(text || "").trim();
  return NAME.test(value) && /[A-Z]/i.test(value)
    && (/[_0-9\/$*+]/.test(value) || /^[ZY]/i.test(value));
}

/** Recognise a small, unambiguous imperative without asking the model. */
function objectRequest(text) {
  const value = String(text || "").trim();
  if (isObjectName(value)) { return { query: value, openEditor: false }; }
  const found = value.match(/^(?:open|edit|открой)\s+(?:(?:class|program|function|module|класс|программу|функцию)\s+)?([A-Z0-9_\/$*+]{3,40})(?:\s+(?:please|пожалуйста))?[.!]?$/i);
  return found && isObjectName(found[1]) ? { query: found[1], openEditor: true } : null;
}

// Search results may carry a connection key or a plain system name.
function systemName(value) {
  return require("./auth/systems").keyInfo(value).name;
}

/**
 * search(args) -> { objects: [{ object_name, object_type, description, package }], truncated }
 * open({ object_type, object_name }) -> anything; it throws on failure.
 * Returns the answer text for the chat.
 */
async function answer(text, { search, open, system, choices = () => {} }) {
  const query = String(text).trim().toUpperCase();
  let found = await search({ query, limit: 50 });
  if (!(found?.objects || []).length && !/[*+]/.test(query)) {
    for (const pattern of [query + "*", "*" + query + "*"]) {
      const wider = await search({ query: pattern, limit: 50 });
      if ((wider?.objects || []).length) { found = wider; break; }
    }
  }
  const label = system || systemName(found && found.system);
  const where = label ? " in system " + label : "";
  const objects = (found && found.objects) || [];
  const exact = objects.filter(o => String(o.object_name).toUpperCase() === query);
  // A pattern can still resolve to exactly one object.  The result count is
  // what determines whether a choice is needed, not the spelling of the
  // query: a solitary ZVERTEX*LAB result should open just like ZVERTEX_DEBUG_LAB.
  if (objects.length === 1 || exact.length === 1) {
    const object = exact[0] || objects[0];
    await open({ object_type: object.object_type, object_name: object.object_name });
    return "Opened " + object.object_type + " **" + object.object_name + "**"
      + (object.package ? " (package " + object.package + ")" : "") + where + ".";
  }
  if (!objects.length) {
    return "No program, class, function module or package named **" + query + "**" + where + ".";
  }
  const listed = exact.length > 1 ? exact : objects;
  choices(listed.map(o => ({ object_type: o.object_type, object_name: o.object_name,
    description: o.description || '', package: o.package || '' })));
  const list = listed.map(o => "- " + o.object_type + " **" + o.object_name + "**"
    + (o.description ? " — " + o.description : "") + (o.package ? " (" + o.package + ")" : ""));
  return (exact.length > 1 ? "Several objects are named **" + query + "**" : "Found for **" + query + "**") + where + ":\n\n"
    + list.join("\n") + (found.truncated ? "\n\nMore matches exist; narrow the pattern." : "")
    + "\n\nClick a name to open it.";
}

module.exports = { isObjectName, objectRequest, answer };
