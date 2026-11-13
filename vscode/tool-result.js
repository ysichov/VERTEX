"use strict";

/* What one tool result may take of a chat request, for every provider that runs tools
 * (Anthropic, Copilot and the OpenAI-compatible APIs).
 *
 * A result is bounded, never thrown away. A list is cut to LIST_ENTRIES entries; whatever
 * is still longer than TEXT_BYTES is cut there. Each cut says how much was left out, so the
 * model narrows its request instead of guessing whether the result was empty, enormous or
 * unavailable - a search answered with nothing but "too large" is what makes a model repeat
 * the same query under another mask until the request budget is gone.
 */

const LIST_ENTRIES = 100;
const TEXT_BYTES = 24000;

/** The list a result is, or carries as its objects, when it has one. */
function listOf(data) {
  if (Array.isArray(data)) return { entries: data, withEntries: kept => kept };
  if (data && typeof data === "object" && Array.isArray(data.objects)) {
    return { entries: data.objects, withEntries: kept => ({ ...data, objects: kept }) };
  }
  return null;
}

/** Cut to whole characters: a multi-byte character is never split in half. */
function clip(text, limit) {
  let value = Buffer.from(text, "utf8").subarray(0, limit).toString("utf8");
  while (Buffer.byteLength(value, "utf8") > limit) value = value.slice(0, -1);
  return value;
}

const NARROW_LIST = " Narrow the request - by package, author, name mask or date - instead of repeating it wider.";
const NARROW_TEXT = " Ask for a narrower part - one object, one method, one range - instead of repeating the same call.";

function cut(text) {
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* not JSON: bounded by bytes alone */ }
  const list = listOf(data);
  let note = "";
  if (list && list.entries.length > LIST_ENTRIES) {
    note = "\n[showing " + LIST_ENTRIES + " of " + list.entries.length + " entries; the rest was not sent."
      + NARROW_LIST + "]";
    text = JSON.stringify(list.withEntries(list.entries.slice(0, LIST_ENTRIES)), null, 2);
  }
  if (Buffer.byteLength(text, "utf8") > TEXT_BYTES) {
    const whole = text.length;
    text = clip(text, TEXT_BYTES);
    note = "\n[cut after " + text.length + " of " + whole + " characters; the rest was not sent." + NARROW_TEXT + "]" + note;
  }
  return text + note;
}

/** A tool's result as the string that goes to the model, bounded and labelled. */
function bound(result) {
  // A string result (an MCP server's text content) keeps its JSON encoding: the cut applies
  // to the text the model reads, not to the quoting around it.
  if (typeof result === "string") return JSON.stringify(cut(result));
  return cut(JSON.stringify(result));
}

module.exports = { bound, LIST_ENTRIES, TEXT_BYTES };
