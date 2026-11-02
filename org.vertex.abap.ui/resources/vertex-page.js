/* What the VERTEX Tools pages share - Metrics, SelecTor, Versions and Chat - put in place of the marker in a page's
   script by the host that reads the page (PageView.readResource in Eclipse; tools-window.js and extension.js in VS
   Code), so it is the page's own code: no global of its own, no load order. Each part uses what its page declares
   (have, backends, USES, BACKEND, message, say, recall, remember, TYPES) and nothing else; a page that has no use
   for a part never calls it.

   A page varies a part only where it says so: setupView(root) before the setup page is drawn, missingMatters(use)
   for which missing service is worth a line, USER_KIND for the class say() gives the user's own lines. */

/* ---------- the object fields ---------- */

function objectName() {
  return document.getElementById("name").value.trim().toUpperCase();
}

function objectType() {
  return document.getElementById("type").value;
}

/* The type arrives from the object tree with its subtype - CLAS/OC. Only the
   head selects the entry; an unknown one is added rather than dropped, so a
   window opened on it still shows what it was opened for. */
function fillTypes(chosen) {
  var head = chosen ? String(chosen).split("/")[0] : "";
  var known = TYPES.slice();
  var found = known.some(function (t) { return t[0] === head; });
  if (head && !found) { known.unshift([head, head]); }

  var box = document.getElementById("type");
  known.forEach(function (t) {
    var option = document.createElement("option");
    option.value = t[0];
    option.textContent = t[1];
    if (t[0] === head) { option.selected = true; }
    box.appendChild(option);
  });
}

/* ---------- what this system has: the shared half ---------- */

/* Unknown counts as usable: only a system that said so loses part of the window. */
function usable(service) {
  return have === null || (!!have[service] && !!have[service].active);
}

function whyMissing(service) {
  var said = have && have[service];
  if (!said) { return "the VERTEX hub there is older than this window"; }
  if (said.backend && backends[said.backend] === false) {
    return said.handler + " is not active, because " + said.backend + " is not installed";
  }
  return said.handler + " is not active";
}

/* A line under the bar for what the system lacks; a page that says it only
   where it would be used decides with missingMatters. */
function sayMissing() {
  var lost = USES.filter(function (u) {
    return !u.main && (typeof missingMatters !== "function" || missingMatters(u)) && !usable(u.service);
  });
  var line = document.getElementById("missing");
  line.textContent = lost.length === 0 ? "" : "Not on this system: " + lost.map(function (u) {
    return u.what + " - " + whyMissing(u.service);
  }).join("; ") + ".";
  line.hidden = lost.length === 0;
}

/* A 404 is a setup state while the system has not said what it has, or when it
   said part of what this window reads is missing. When it has all of it, the
   404 is the resource's own answer and is shown as one. */
function notFound(detail) {
  if (have !== null && USES.every(function (u) { return usable(u.service); })) { message(detail); }
  else { setupPage(detail); }
}

/* ---------- when the ABAP half is not there: the shared half ----------

   Why there is a setup page, and what BACKEND names, is said where each page
   declares its BACKEND. */

/* Opening a link is the host's business: in Eclipse it would otherwise
   navigate the view away from this page, and a webview cannot open one at
   all. A host that offers nothing leaves the address to be copied. */
function projectLink(text, url) {
  var link = document.createElement("span");
  link.className = "link";
  if (typeof sdeBrowse === "function") {
    link.textContent = text || url;
    link.title = url;
    link.addEventListener("click", function () { sdeBrowse(url); });
  } else {
    link.className = "link plain";
    link.textContent = url;
    link.title = "Copy this address into a browser";
  }
  return link;
}

/* The short link, on the start screen, always. Somebody who has just installed
   the plugin and typed nothing yet is exactly who needs to know where the
   other half of it lives. */
function startLink() {
  var line = document.createElement("div");
  line.className = "startlink";
  line.appendChild(document.createTextNode("This window reads ABAP from "));
  BACKEND.forEach(function (one, i) {
    if (i > 0) {
      line.appendChild(document.createTextNode(i + 1 === BACKEND.length ? " and " : ", "));
    }
    line.appendChild(projectLink(one.name, one.url));
  });
  document.getElementById("root").appendChild(line);
}

function setupPage(detail) {
  var root = document.getElementById("root");
  root.className = "setup";
  if (typeof setupView === "function") { setupView(root); }
  root.innerHTML = "";

  var head = document.createElement("h3");
  var why = document.createElement("p");
  if (have === null) {
    head.textContent = "The ABAP half is not on this system";
    why.textContent = "VERTEX is a page and a set of ADT resources. The page is"
                    + " installed here; the resources answer nothing, so there is"
                    + " nothing for it to read. A VERTEX hub older than"
                    + " this window cannot say what it has either: if it is"
                    + " installed, pull it again.";
  } else {
    head.textContent = "Part of the ABAP half is missing on this system";
    why.textContent = "The VERTEX hub answers here, and says what this window can read:";
  }
  root.appendChild(head);
  root.appendChild(why);

  if (have !== null) {
    var found = document.createElement("ul");
    USES.forEach(function (u) {
      var li = document.createElement("li");
      li.className = usable(u.service) ? "ok" : "no";
      li.textContent = usable(u.service) ? u.what + " - there"
                                         : u.what + " - missing: " + whyMissing(u.service);
      found.appendChild(li);
    });
    root.appendChild(found);
  }

  var what = document.createElement("ul");
  BACKEND.forEach(function (one) {
    var li = document.createElement("li");
    li.appendChild(projectLink(one.name, one.url));
    li.appendChild(document.createTextNode(" - " + one.why));
    what.appendChild(li);
  });
  root.appendChild(what);

  var steps = document.createElement("ol");
  (have !== null
    ? ["Pull what is missing or older with abapGit and activate it.",
       "Reopen this window."]
    : ["Pull it with abapGit and activate it.",
       "Nothing to register by hand: the BAdI implementation that claims"
         + " /sap/bc/adt/vertex/* is an object of the repository and arrives"
         + " with its filter already on it.",
       "Reopen this window."]).forEach(function (step) {
    var li = document.createElement("li");
    li.textContent = step;
    steps.appendChild(li);
  });
  root.appendChild(steps);

  if (detail) {
    var said = document.createElement("pre");
    said.className = "said";
    said.textContent = detail;
    root.appendChild(said);
  }
}

/* ---------- the model of the assistant ---------- */

/* Claude Code's aliases, or the catalog Codex reports: the host knows which. */
/* A Claude model by its full id - a version the aliases no longer reach. The
   page asks the host to check it with one short request; what came back
   stays in the list, the rest is only offered. */
var SPECIFY = "?version";

function addVersionOptions(box, data, kept) {
  var listed = data.models.some(function (m) { return m.id === kept; });
  if (kept && !listed) {
    var own = document.createElement("option");
    own.value = kept;
    own.textContent = data.probed && data.probed.id === kept ? data.probed.label : kept;
    box.appendChild(own);
  }
  var specify = document.createElement("option");
  specify.value = SPECIFY;
  specify.textContent = "Specify version...";
  box.appendChild(specify);
}

function specifyVersion() {
  var box = document.getElementById("model");
  var who = document.getElementById("who").value;
  box.value = recall("model." + who);
  if (document.getElementById("versionrow")) { document.getElementById("versionid").focus(); return; }
  var row = document.createElement("div");
  row.id = "versionrow";
  row.style.cssText = "display: flex; gap: 4px; padding: 4px 6px;";
  var input = document.createElement("input");
  input.id = "versionid";
  input.placeholder = "claude-opus-5";
  input.spellcheck = false;
  input.style.cssText = "flex: 1 1 0; min-width: 0;";
  var check = document.createElement("button");
  check.textContent = "Check";
  var cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  function close() { row.parentNode.removeChild(row); }
  function go() {
    var id = input.value.trim();
    if (!id) { input.focus(); return; }
    close();
    say(USER_KIND, "VERTEX", "Checking " + id + " with Claude Code ...");
    askModels(id);
  }
  check.addEventListener("click", go);
  cancel.addEventListener("click", close);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { go(); } else if (e.key === "Escape") { close(); }
  });
  row.appendChild(input); row.appendChild(check); row.appendChild(cancel);
  var holder = box.parentNode;
  holder.parentNode.insertBefore(row, holder.nextSibling);
  input.focus();
}

function askModels(version) {
  var box = document.getElementById("model");
  box.innerHTML = "";
  var waiting = document.createElement("option");
  waiting.textContent = "loading ...";
  box.appendChild(waiting);
  box.disabled = true;
  sdeModels(document.getElementById("who").value, version || "");
}

/* The host's answer to askModels, on a page that draws the list itself (SelecTor, Versions); Chat reads it with the
   rest of its assistant's answer. */
function fillModels(data) {
  // An answer for an assistant no longer chosen: the one that is has its own
  // request on the way.
  if (data.assistant !== document.getElementById("who").value) { return; }
  var box = document.getElementById("model");
  box.innerHTML = "";
  if (data.error) {
    var none = document.createElement("option");
    none.textContent = "no models";
    box.appendChild(none);
    say("error", "VERTEX", data.error);
    return;
  }
  data.models.forEach(function (m) {
    var option = document.createElement("option");
    option.value = m.id;
    option.textContent = m.label;
    box.appendChild(option);
  });
  var kept = data.probed ? data.probed.id : recall("model." + data.assistant);
  if (data.specify) { addVersionOptions(box, data, kept); }
  if (data.probed) { remember("model." + data.assistant, kept); say("assistant", "VERTEX", "Model " + data.probed.label + " selected."); }
  if (data.probeError) { say("error", "VERTEX", data.probeError); }
  for (var k = 0; k < box.options.length; k += 1) { if (box.options[k].value === kept) { box.value = kept; } }
  box.disabled = false;
}
