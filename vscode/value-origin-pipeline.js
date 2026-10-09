"use strict";
/* Which sources a Value origin analysis reads, decided once for both hosts. VS Code and Eclipse each read SAP their
   own way - VS Code through its ADT client, Eclipse through the ABAP project's session - so each hands in only how to
   read an object (load) and a part of a class (loadPart). How much is read is not theirs to choose: the two once
   diverged, Eclipse reading every customer object the source named while VS Code read only what the slice needed. */
const { collectDemandSources } = require("./value-origin-demand");

const MAX_SOURCES = 240;

/* initial: the sources of the object the cursor is in; target: the value, located in them.
   Answers { sources, warnings, skipped }. */
function collect(initial, target, { load, loadPart, cancelled, progress } = {}) {
  if (typeof load !== "function" || typeof loadPart !== "function") {
    throw new Error("Value origin needs a reader for objects and for class parts.");
  }
  return collectDemandSources(initial, target, load, loadPart, { maxSources: MAX_SOURCES, cancelled, progress });
}

module.exports = { collect, MAX_SOURCES };
