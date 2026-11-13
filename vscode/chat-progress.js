"use strict";

/* A tool call that reached VERTEX's /chat MCP endpoint, told to the chat request that is waiting for it. Claude
   Code reports its steps in its own event stream; Codex does not, so for it the endpoint is where a step shows. */
const listeners = new Set();

function listen(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function report(name) {
  for (const callback of [...listeners]) {
    try { callback(String(name || "")); } catch (_) { /* a listener's failure does not stop the tool call */ }
  }
}

/* Which waiting scene a tool call deserves, by its name. The folder's own tools split in two - looking at the code
   and changing it - while everything the SAP side offers is one conversation with the system. Bash has no scene:
   it is told by its command line instead, and returning null leaves whatever scene is running untouched rather
   than blanking the message for one step. */
const SCENES = { Read: "search", Glob: "search", Grep: "search", Edit: "edit", Write: "edit", Bash: null };

function scene(name) {
  const tool = String(name || "").replace(/^mcp__vertex__/, "");
  return Object.prototype.hasOwnProperty.call(SCENES, tool) ? SCENES[tool] : "mcp";
}

/* What a step is working on, for the line beside the scene: the file a tool reads or writes, the pattern it looks
   for, the command it runs, the SAP object it opens. The scene says what kind of work it is; this says on what. */
function detail(name, input) {
  if (!input || typeof input !== "object") return "";
  const tool = String(name || "").replace(/^mcp__vertex__/, "");
  const one = value => (typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : "");
  // A file arrives resolved against the folder; its last two segments say which file without the whole path.
  const asFile = value => {
    const text = one(value);
    if (!text || text.length < 40) return text;
    const parts = text.split(/[\\/]/).filter(Boolean);
    return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : text;
  };
  const said = tool === "Bash" ? one(input.command)
    : tool === "Grep" || tool === "Glob" ? [one(input.pattern), one(input.path) || one(input.glob)].filter(Boolean).join(" in ")
    : asFile(input.file_path) || [one(input.object_type), one(input.object_name), one(input.method_name)].filter(Boolean).join(" ")
      || one(input.name) || one(input.query);
  return said ? ": " + (said.length > 90 ? said.slice(0, 89) + "…" : said) : "";
}

/* What the search scene spells out while it runs: the pattern being looked for, without the path it is looked for
   in. Only a search by pattern has a word to show; reading a named file does not, and its band stays bits. */
function subject(name, input) {
  if (!input || typeof input !== "object") return "";
  const tool = String(name || "").replace(/^mcp__vertex__/, "");
  if (tool !== "Grep" && tool !== "Glob") return "";
  const pattern = typeof input.pattern === "string" ? input.pattern.trim().replace(/\s+/g, " ") : "";
  return pattern.length > 28 ? pattern.slice(0, 27) + "…" : pattern;
}

module.exports = { listen, report, scene, detail, subject };
