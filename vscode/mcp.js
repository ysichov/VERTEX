"use strict";

// An MCP server, so that an agent already living in the editor - Copilot,
// Claude Code, Codex - can read what a transport request changed and review it
// itself. VERTEX supplies no agent and no model of its own: those tools have a
// loop, a chat, a model picker and the user's own subscription, and all of that
// is better than anything written here would be. What they cannot do is know
// SAP. That is what this hands them.
//
// The review at /mcp is read-only on purpose. A tool result goes to the model,
// so it offers what a reviewer looks at and nothing that writes. The debugger
// at /debug is the one exception, and a narrow one: it sets breakpoints and
// holds a listener, but changes no code, no data and no variable.
//
// The host injects the SAP reader. VS Code uses the same fetch() as its pages,
// with the active system and SecretStorage password. The standalone stdio
// host in ../mcp/server.js supplies its own reader and environment credentials.
// The shared tools and dispatcher do not depend on the VS Code API.
//
// This module also hosts Streamable HTTP on 127.0.0.1, which is what the specification
// asks of a local server: one endpoint, POST for requests, 405 for the GET
// stream nobody opens here, the Origin header checked, and a bearer token so
// that "on this machine" does not mean "any process on this machine".

const http = require("http");
const crypto = require("crypto");

// Versions of the protocol this server knows. The newest is offered when a
// client asks for one that is not here; the client then decides.
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];

// Unchanged lines further than this from a change are dropped. Three is what
// versions.html folds to, and for the same reason: three places a change,
// more is scrolling. Kept equal on purpose - a reader and a model should be
// looking at the same diff.
const CONTEXT = 3;

// What one tool result may be worth. Past this the answer is cut and says so:
// a model given a whole transport at once reads none of it well.
const BUDGET = 60000;

/* ---------- the tools ---------- */

const TOOLS = [
  {
    name: "sap_transport_changes",
    annotations: { readOnlyHint: true, destructiveHint: false },
    description:
      "List what a transport request changed on the SAP system: every object in it, "
      + "who changed it, how many blocks and lines, and whether a reviewer has already "
      + "approved or declined them. Ask for this before a diff, to choose what to read.",
    inputSchema: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: "Transport request or task, for example DEVK900123."
        }
      },
      required: ["request"]
    }
  },
  {
    name: "sap_transport_diff",
    annotations: { readOnlyHint: true, destructiveHint: false },
    description:
      "The diff of a transport request as unified diff, with each review block marked "
      + "by its number, its author and any verdict a reviewer already gave. Name an "
      + "object to read that one; leave it out to walk the whole request until the "
      + "answer gets too long. Use it to review the change.",
    inputSchema: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: "Transport request or task, for example DEVK900123."
        },
        object: {
          type: "string",
          description:
            "One object of the request, as obj_name from sap_transport_changes. "
            + "A method key carries its class padded to thirty characters, so copy it "
            + "rather than typing it."
        },
        object_type: {
          type: "string",
          description: "Its objtype from sap_transport_changes, for example METH or REPS."
        }
      },
      required: ["request"]
    }
  }
];

/* ---------- reading the system ---------- */

/* Every answer of the review resource is JSON, or a sentence beginning with
   ERROR: that fetch() made out of a failure. Both are turned into something a
   model can act on: the failure says what went wrong rather than arriving as
   an empty object. */
async function read(deps, path) {
  const body = await deps.fetch(deps.context, path);
  if (typeof body !== "string") {
    return { error: "The extension returned nothing for " + path };
  }
  if (body.indexOf("ERROR:") === 0) {
    return { error: body.substring(6).replace("NOBACKEND:", "") };
  }
  try {
    return { data: JSON.parse(body) };
  } catch (e) {
    return { error: "The system answered something that is not JSON: " + body.substring(0, 300) };
  }
}

function reviewPath(request, part, ptype) {
  let path = "/sap/bc/adt/vertex/review/" + encodeURIComponent(String(request).toUpperCase());
  if (part) {
    path += "?part=" + encodeURIComponent(part)
          + "&ptype=" + encodeURIComponent(ptype || "");
  }
  return path;
}

/* ---------- turning a review into text ---------- */

/* The review resource lists the objects of a request only once AVE has
   prepared a review for it: the blocks and the diffs are read out of that
   saved review, never computed on the fly. An empty list therefore means one
   of three different things, and a model told "nothing changed" when the
   truth is "nobody prepared the review yet" would report a clean transport. */
function notReviewable(data) {
  if (data.table !== true) {
    return "This system has no ZAVE_REVIEW table, so AVE has nowhere to keep a review "
         + "and there are no blocks to read. The table is created as AVE's documentation "
         + "describes.";
  }
  if (data.saved !== true) {
    return "No review has been prepared in AVE for " + String(data.request).toUpperCase()
         + " yet. These tools read the review AVE saves - the diffs and the blocks come "
         + "from it - so there is nothing to read until somebody prepares it in AVE. "
         + "This does not mean the request changed nothing.";
  }
  return "";
}

function changesText(data) {
  const objects = data.objects || [];
  const lines = [];
  const blocked = notReviewable(data);
  if (blocked) { return blocked; }
  lines.push("Transport " + String(data.request).toUpperCase()
             + " changed " + objects.length + (objects.length === 1 ? " object" : " objects")
             + ", review saved " + data.saved_at + " by " + data.saved_by + ".");
  lines.push("");
  if (objects.length === 0) {
    // AVE's report leaves out an object with no changed line, so a saved review
    // can list nothing - which is a different thing from a request with no code.
    lines.push("The saved review lists no object with a changed line.");
    return lines.join("\n");
  }
  lines.push("objtype  obj_name                                  blocks  +/-/~      state");
  objects.forEach(function (o) {
    const counts = o.inserted + "/" + o.deleted + "/" + o.modified;
    const state = o.open > 0
      ? o.open + " open"
      : (o.declined > 0 ? o.declined + " declined" : "all approved");
    lines.push(
      pad(o.objtype, 8) + " " + pad(o.obj_name, 41) + " "
      + pad(String(o.hunks), 7) + " " + pad(counts, 10) + " " + state
      + (o.is_created ? "  (new object)" : "")
      + "   by " + (o.author_name || o.author));
  });
  lines.push("");
  lines.push("Ask sap_transport_diff with object and object_type from this list to read one.");
  return lines.join("\n");
}

function pad(text, width) {
  const value = String(text === undefined || text === null ? "" : text);
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/* The diff of one part, as a model reads best: unified, with the review's own
   blocks as headers. The block boundaries are AVE's - it cut them while
   walking the diff and the saved verdicts are filed against them, so inventing
   hunks here would put the model's findings on different ground than the
   reviewer's buttons. */
/* FULL keeps every line, with the changes still marked: the whole source is
   what a change is judged against, and AVE hands a model the same choice. */
function diffText(data, full) {
  const ops = data.ops || [];
  const blocks = data.blocks || [];
  const lines = [];

  lines.push("--- " + data.part + " (" + data.part_type + ") version "
             + (data.versno_old || "none") );
  lines.push("+++ " + data.part + " (" + data.part_type + ") version "
             + (data.versno_new || "active"));
  lines.push("@@ " + data.added + " added, " + data.deleted + " deleted, "
             + blocks.length + (blocks.length === 1 ? " block" : " blocks") + " @@");

  // OP_FROM counts from one; a block the payload could not place carries zero.
  const opens = {};
  blocks.forEach(function (b) {
    if (b.op_from > 0) { opens[b.op_from - 1] = b; }
  });

  const show = full ? ops.map(function () { return true; }) : mask(ops);
  let line = 0;
  let folded = false;

  ops.forEach(function (op, index) {
    if (op.op !== "-") { line++; }
    if (opens[index]) {
      lines.push("");
      lines.push(blockHeader(opens[index]));
      folded = false;
    }
    if (!show[index]) {
      if (!folded) { lines.push("   ..."); folded = true; }
      return;
    }
    folded = false;
    const mark = op.op === "=" ? " " : op.op;
    const at = op.op === "-" ? "    " : pad(String(line), 4);
    lines.push(at + " " + mark + " " + op.text);
  });

  blocks.filter(function (b) { return !(b.op_from > 0); }).forEach(function (b) {
    lines.push("");
    lines.push("(block the saved review could not place in this diff) " + blockHeader(b));
  });

  return lines.join("\n");
}

function blockHeader(b) {
  let head = "@@ block " + b.hunk_no + " · " + b.change_kind + ", " + b.change_count
           + (b.change_count === 1 ? " line" : " lines")
           + " · from line " + b.start_line
           + " · by " + (b.author_name || b.author);
  if (b.action === "A") {
    head += " · approved by " + (b.reviewer_name || b.reviewer);
  } else if (b.action === "D") {
    head += " · DECLINED by " + (b.reviewer_name || b.reviewer);
  } else {
    head += " · not reviewed yet";
  }
  head += " @@";
  if (b.note) { head += "\n   note: " + b.note; }
  (b.messages || []).forEach(function (m) {
    head += "\n   " + (m.is_decline ? "decline" : "comment") + " by "
          + (m.author_name || m.author) + ": " + m.text;
  });
  return head;
}

function mask(ops) {
  const show = ops.map(function () { return false; });
  ops.forEach(function (op, i) {
    if (op.op === "=") { return; }
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) {
      show[k] = true;
    }
  });
  return show;
}

/* ---------- what a tool call does ---------- */

async function callTool(deps, name, args) {
  const request = (args && args.request ? String(args.request) : "").trim();
  if (!request) {
    return fail("Name the transport request, for example DEVK900123.");
  }

  if (name === "sap_transport_changes") {
    const answer = await read(deps, reviewPath(request));
    if (answer.error) { return fail(answer.error); }
    // Not a failure of the tool, but not an answer the model may treat as a
    // clean request either - so it is flagged as an error it has to read.
    if (notReviewable(answer.data)) { return fail(notReviewable(answer.data)); }
    return ok(changesText(answer.data));
  }

  if (name === "sap_transport_diff") {
    const object = args.object ? String(args.object) : "";
    if (object) {
      const answer = await read(deps, reviewPath(request, object, args.object_type));
      if (answer.error) { return fail(answer.error); }
      if (notReviewable(answer.data)) { return fail(notReviewable(answer.data)); }
      return ok(diffText(answer.data));
    }

    // No object named: walk the request, and stop at the budget rather than
    // handing back more than a model will read.
    const summary = await read(deps, reviewPath(request));
    if (summary.error) { return fail(summary.error); }
    if (notReviewable(summary.data)) { return fail(notReviewable(summary.data)); }
    const objects = summary.data.objects || [];
    const parts = [changesText(summary.data)];
    let used = parts[0].length;
    let done = 0;

    for (const o of objects) {
      const answer = await read(deps, reviewPath(request, o.obj_name, o.objtype));
      if (answer.error) {
        parts.push("\n\n=== " + o.obj_name + " ===\ncould not be read: " + answer.error);
        done++;
        continue;
      }
      const text = "\n\n=== " + o.display_name + " (" + o.objtype + " " + o.obj_name
                 + ") ===\n" + diffText(answer.data);
      if (used + text.length > BUDGET && done > 0) { break; }
      parts.push(text);
      used += text.length;
      done++;
    }

    if (done < objects.length) {
      parts.push("\n\n" + (objects.length - done) + " of " + objects.length
                 + " objects are not in this answer, because it would have grown too long. "
                 + "Ask sap_transport_diff again with one object at a time: "
                 + objects.slice(done).map(function (o) { return o.obj_name; }).join(", "));
    }
    return ok(parts.join(""));
  }

  return fail("This server has no tool called " + name + ".");
}

function ok(text) {
  return { content: [{ type: "text", text: text }] };
}

function fail(text) {
  return { content: [{ type: "text", text: text }], isError: true };
}

/* ---------- the debugger ---------- */

/* Short on purpose: the assistant's own reasoning does the debugging. This only
   says how the tools fit together and what must not be done. */
const DEBUG_INSTRUCTIONS = [
  "VERTEX debugs ABAP on the user's SAP system through ADT.",
  "Method: form a hypothesis, set breakpoints (prefer a condition written like an ABAP IF, or mode log for a watchpoint, over stepping line by line), start the program with debug_run, collect stops with debug_wait, read what matters with debug_read, refine, and end with a verdict that names the line and the values that prove it.",
  "A run started from SAP Logon (standalone SAP GUI) is never caught - SAP's design. Start it with debug_run, which opens WebGUI.",
  "Nothing here changes a variable or the code. Do not ask for more than a question needs: stops return only what changed and tables in short.",
  "When done, call debug_stop: it lets the program go, stops listening and removes every breakpoint."
].join(" ");

const DEBUG_TOOLS = [
  {
    name: "debug_set_breakpoint",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: "Set a breakpoint and start listening for the user's runs. Mode stop hands the stop to you; mode log records the variables that changed and lets the program run on (a watchpoint, no turn spent). "
      + "A condition is checked by SAP, which skips every pass where it is false - written like an ABAP IF: lv_total > 1000, LINES( lt_items ) > 0, sy-tabix = 3, oref IS BOUND AND oref->attr = 'X'. Built-in functions need blanks inside the brackets. "
      + "The same object and line again replaces its condition and mode.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        object_type: { type: "string", enum: ["PROG", "INCL", "CLAS"], description: "PROG by default. A class line counts in its main source." },
        name: { type: "string", description: "Program, include or class name." },
        line: { type: "integer", minimum: 1, description: "Line of an executable statement." },
        condition: { type: "string", description: "Optional, up to 255 characters." },
        mode: { type: "string", enum: ["stop", "log"], description: "stop (default) or log." },
        take_over: { type: "boolean", description: "Only when the user agreed: take over from another debugger (Eclipse, ABAP FS) listening for the same user." }
      },
      required: ["name", "line"]
    }
  },
  {
    name: "debug_clear_breakpoints",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: "Remove one breakpoint by its id from debug_status, or all of them without an id.",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "string" } } }
  },
  {
    name: "debug_run",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: "Start an executable program (report) in WebGUI in the user's browser, so that the breakpoints can catch it. The user may have to log on there. Other objects - a class, a function module - are run by the user; ask them to.",
    inputSchema: { type: "object", additionalProperties: false, properties: { program: { type: "string" } }, required: ["program"] }
  },
  {
    name: "debug_wait",
    annotations: { readOnlyHint: true, destructiveHint: false },
    description: "Wait for the program to stop or finish. Returns the stop - where, the stack, the source lines, the variables that changed since the last stop (all of them at the first) and the first rows of any table that changed - plus what log breakpoints recorded since the last call and runs that ended.",
    inputSchema: { type: "object", additionalProperties: false, properties: { seconds: { type: "integer", minimum: 1, maximum: 280, description: "60 by default." } } }
  },
  {
    name: "debug_read",
    annotations: { readOnlyHint: true, destructiveHint: false },
    description: "Read one variable at the current stop by name: a field's value, a structure's fields, or rows from..to of a table (at most 200 at a time). Names as ABAP writes them: LS_ORDER, GS_INVOICE-ITEMS, ME->MV_RATE.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { name: { type: "string" }, from: { type: "integer", minimum: 1 }, to: { type: "integer", minimum: 1 } },
      required: ["name"]
    }
  },
  {
    name: "debug_step",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: "Move a stopped program on: over (next statement), into (into a call), out (to the caller), continue (to the next stop breakpoint or the end). Returns what debug_wait returns.",
    inputSchema: { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["over", "into", "out", "continue"] } }, required: ["kind"] }
  },
  {
    name: "debug_status",
    annotations: { readOnlyHint: true, destructiveHint: false },
    description: "The system, whether it listens, where the program stands, the breakpoints with their ids, and how much the debugger answers have cost so far.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "debug_log",
    annotations: { readOnlyHint: true, destructiveHint: false },
    description: "Everything the log breakpoints recorded in this debugging session, in order.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "debug_stop",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: "End debugging: let a stopped program run on, stop listening, remove every breakpoint.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  }
];

/* An answer cut to the budget, saying so - the same rule as the review. */
function debugAnswer(dbg, value) {
  let text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  if (text.length > BUDGET) {
    text = text.substring(0, BUDGET) + "\n... cut at " + BUDGET + " characters. Read a table in smaller ranges with debug_read.";
  }
  return ok(dbg.counted(text));
}

function debugSet(dbg) {
  return {
    tools: DEBUG_TOOLS,
    instructions: DEBUG_INSTRUCTIONS,
    call: async function (deps, name, args) {
      switch (name) {
        case "debug_set_breakpoint": {
          const bp = await dbg.setBreakpoint(args);
          return debugAnswer(dbg, "Breakpoint " + bp.id + " at " + bp.name + " line " + bp.line + ", mode " + bp.mode
            + (bp.condition ? ", condition " + bp.condition : "") + ". Listening for the user's runs.");
        }
        case "debug_clear_breakpoints":
          await dbg.clearBreakpoints(args.id);
          return debugAnswer(dbg, args.id ? "Removed " + args.id + "." : "Removed every breakpoint.");
        case "debug_run":
          return debugAnswer(dbg, "Opened in the browser: " + await dbg.run(args.program)
            + "\nNow call debug_wait. If the user has to log on, the program starts after that.");
        case "debug_wait": return debugAnswer(dbg, await dbg.wait(args.seconds));
        case "debug_read": return debugAnswer(dbg, await dbg.read(args.name, args.from, args.to));
        case "debug_step": return debugAnswer(dbg, await dbg.step(args.kind));
        case "debug_status": return debugAnswer(dbg, dbg.status());
        case "debug_log": return debugAnswer(dbg, dbg.log());
        case "debug_stop":
          await dbg.stop();
          return debugAnswer(dbg, "Stopped: the program runs on, nothing listens, no breakpoint is left.");
      }
      return fail("This server has no tool called " + name + ".");
    }
  };
}

/* ---------- the protocol ---------- */

/* The review tools, unless a caller names another set: the standalone server
   calls dispatch with two arguments and serves the review alone. */
const REVIEW = { tools: TOOLS, call: callTool };

async function dispatch(deps, message, set) {
  const served = set || REVIEW;
  const method = message.method;

  if (method === "initialize") {
    const asked = message.params && message.params.protocolVersion;
    return {
      protocolVersion: PROTOCOLS.indexOf(asked) >= 0 ? asked : PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "vertex", version: deps.version || "0" },
      ...(served.instructions ? { instructions: served.instructions } : {})
    };
  }
  if (method === "ping") { return {}; }
  if (method === "tools/list") { return { tools: served.tools }; }
  if (method === "tools/call") {
    const params = message.params || {};
    if (!served.tools.some(function (t) { return t.name === params.name; })) {
      const error = new Error("Unknown tool: " + params.name);
      error.code = -32602;
      throw error;
    }
    try {
      return await served.call(deps, params.name, params.arguments || {});
    } catch (e) {
      // A tool that fails is an answer, not a broken protocol: the model is
      // told what went wrong and can try something else.
      return fail(e && e.message ? e.message : String(e));
    }
  }

  const unknown = new Error("Unknown method: " + method);
  unknown.code = -32601;
  throw unknown;
}

/* ---------- the endpoint ---------- */

/* One server per window. A configured port starts at extension activation;
   port zero remains lazy. Secrets survive reloads through SecretStorage. */
function create(deps) {
  let token;
  let started = null;

  function handler(req, res) {
    if (!authorised(req)) {
      return send(res, 401, { "WWW-Authenticate": "Bearer" },
                  JSON.stringify({ error: "A bearer token is required." }));
    }
    if (!originAllowed(req)) {
      return send(res, 403, {}, JSON.stringify({ error: "Origin not allowed." }));
    }
    // /mcp is the review everybody registers. The other addresses are what a
    // window hands the assistant it starts - /selector, /versions - and exist
    // only when the host passed their sets in: separate addresses, so adding
    // to them never changes what a Copilot, Claude Code or Codex registration
    // sees.
    const route = req.url.split("?")[0];
    // A window that keeps its own system names it in the address it hands
    // the assistant, and the calls run against that system.
    const system = new URL(req.url, "http://localhost").searchParams.get("system") || "";
    const within = work => system && deps.pin ? deps.pin(system, work) : work();
    const pages = deps.pages || {};
    const set = route === "/mcp" ? REVIEW
              : (Object.prototype.hasOwnProperty.call(pages, route) ? pages[route] : null);
    if (!set) {
      return send(res, 404, {}, "");
    }
    // No SSE stream is offered here, and no session is kept: the specification
    // answers both with one status code each.
    if (req.method === "GET" || req.method === "DELETE") {
      return send(res, 405, {}, "");
    }
    if (req.method !== "POST") {
      return send(res, 405, {}, "");
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", async function () {
      let message;
      try {
        message = JSON.parse(body);
      } catch (e) {
        return send(res, 400, {}, JSON.stringify({
          jsonrpc: "2.0", id: null,
          error: { code: -32700, message: "The body is not JSON." }
        }));
      }

      if (!message || Array.isArray(message) || message.jsonrpc !== "2.0"
          || typeof message.method !== "string") {
        return send(res, 400, {}, JSON.stringify({
          jsonrpc: "2.0", id: null,
          error: { code: -32600, message: "Invalid JSON-RPC request." }
        }));
      }

      const version = req.headers["mcp-protocol-version"];
      if (version && PROTOCOLS.indexOf(String(version)) < 0) {
        return send(res, 400, {}, JSON.stringify({
          jsonrpc: "2.0", id: message.id || null,
          error: { code: -32600, message: "Protocol version " + version + " is not supported." }
        }));
      }

      // A notification or a response carries no id and gets no answer.
      if (message.id === undefined || message.id === null) {
        try { await within(() => dispatch(deps, message, set)); } catch (e) { /* nothing to answer to */ }
        return send(res, 202, {}, "");
      }

      try {
        const result = await within(() => dispatch(deps, message, set));
        send(res, 200, {}, JSON.stringify({ jsonrpc: "2.0", id: message.id, result: result }));
      } catch (e) {
        send(res, 200, {}, JSON.stringify({
          jsonrpc: "2.0", id: message.id,
          error: { code: e.code || -32603, message: e && e.message ? e.message : String(e) }
        }));
      }
    });
  }

  function authorised(req) {
    const given = String(req.headers.authorization || "");
    return given === "Bearer " + token;
  }

  /* The specification asks for this by name: without it a page in a browser
     could reach a server that is only listening on this machine. A client that
     sends no Origin at all is a program, not a page. */
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) { return true; }
    return /^vscode-file:\/\//.test(origin)
        || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  }

  function send(res, status, headers, body) {
    res.writeHead(status, Object.assign({
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body || "", "utf8")
    }, headers));
    res.end(body || "");
  }

  return {
    get token() { return token; },
    /** A page's address, carrying the system of the window that asks, if it keeps one. */
    route: function (url) {
      const system = deps.pinned ? deps.pinned() : "";
      return system ? url + "?system=" + encodeURIComponent(system) : url;
    },
    /** The address, starting the server on first ask. */
    start: function () {
      if (started) { return started; }
      started = Promise.resolve().then(async function () {
        const secrets = deps.context && deps.context.secrets;
        token = secrets ? await secrets.get("vertex.mcp.token") : token;
        if (!token) {
          token = crypto.randomBytes(24).toString("hex");
          if (secrets) { await secrets.store("vertex.mcp.token", token); }
        }
        return new Promise(function (resolve, reject) {
          const server = http.createServer(handler);
          server.on("error", reject);
          const host = deps.host || "127.0.0.1";
          server.listen(deps.port || 0, host, function () {
            const address = host === "0.0.0.0" ? "127.0.0.1" : host;
            resolve({ server: server, url: "http://" + address + ":" + server.address().port + "/mcp" });
          });
        });
      }).catch(function (error) {
        started = null;
        if (error.code === "EADDRINUSE") {
          throw new Error("MCP port " + deps.port + " is already in use. Close the other VERTEX window or change vertex.mcp.port and reload this window.");
        }
        throw error;
      });
      return started;
    },
    stop: function () {
      if (!started) { return; }
      const stopping = started.then(function (running) {
        return new Promise(function (resolve) { running.server.close(resolve); });
      }, function () { });
      started = null;
      return stopping;
    }
  };
}

exports.create = create;
// Shared protocol and tools for the standalone stdio host as well as VS Code.
exports.dispatch = dispatch;
exports.debugSet = debugSet;
exports.DEBUG_TOOLS = DEBUG_TOOLS;
exports.TOOLS = TOOLS;
// The Versions window's assistant reads the review summary the way this
// server does, and refuses an unprepared review in the same words.
exports.callTool = callTool;
exports.read = read;
exports.reviewPath = reviewPath;
exports.notReviewable = notReviewable;
exports.BUDGET = BUDGET;
// Exported for the tests that check the rendering without a system behind it.
exports.changesText = changesText;
exports.diffText = diffText;
