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

/* In VS Code a search names its system by the connection key - url, client,
   user, name - and only the name belongs in an answer. */
function systemName(value) {
  const text = String(value || "");
  try { const key = JSON.parse(text); if (Array.isArray(key) && key[3]) { return String(key[3]); } } catch (e) { /* a plain name */ }
  return text;
}

/**
 * search(args) -> { objects: [{ object_name, object_type, description, package }], truncated }
 * open({ object_type, object_name }) -> anything; it throws on failure.
 * Returns the answer text for the chat.
 */
async function answer(text, { search, open, system }) {
  const query = String(text).trim().toUpperCase();
  const found = await search({ query, limit: 50 });
  const label = system || systemName(found && found.system);
  const where = label ? " in system " + label : "";
  const objects = (found && found.objects) || [];
  const exact = objects.filter(o => String(o.object_name).toUpperCase() === query);
  if (!query.includes("*") && !query.includes("+") && exact.length === 1) {
    const object = exact[0];
    await open({ object_type: object.object_type, object_name: object.object_name });
    return "Opened " + object.object_type + " **" + object.object_name + "**"
      + (object.package ? " (package " + object.package + ")" : "") + where + ".";
  }
  if (!objects.length) {
    return "No program, class or function module named **" + query + "**" + where + ".";
  }
  const list = (exact.length > 1 ? exact : objects).map(o => "- " + o.object_type + " **" + o.object_name + "**"
    + (o.description ? " — " + o.description : "") + (o.package ? " (" + o.package + ")" : ""));
  return (exact.length > 1 ? "Several objects are named **" + query + "**" : "Found for **" + query + "**") + where + ":\n\n"
    + list.join("\n") + (found.truncated ? "\n\nMore matches exist; narrow the pattern." : "")
    + "\n\nAsk to open one of them by name and type.";
}

module.exports = { isObjectName, objectRequest, answer };
