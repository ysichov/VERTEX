"use strict";
/* vertex.animations: auto follows Windows and VS Code (reduced motion stops the animations); on animates even when the
   system asks for reduced motion - a remote desktop or VDI usually has Windows animations off; off stops every VERTEX
   animation. Each page's <body> gets vertex-motion-on or vertex-motion-off, which the pages' reduced-motion rules and
   vertex-controls.css read; auto adds nothing. */

function mode(vscode) {
  // A page built outside VS Code (a test, a browser check) has no setting: auto.
  if (!vscode) { try { vscode = require("vscode"); } catch (_) { return "auto"; } }
  const value = vscode.workspace.getConfiguration("vertex").get("animations", "auto");
  return value === "on" || value === "off" ? value : "auto";
}

/** HTML with the animation mode's class on its first <body>. */
function apply(html, vscode) {
  const value = mode(vscode);
  if (value === "auto") return html;
  const name = "vertex-motion-" + value;
  return html.replace(/<body([^>]*)>/i, (tag, attrs) => /\sclass="/.test(attrs)
    ? "<body" + attrs.replace(/\sclass="/, " class=\"" + name + " ") + ">"
    : "<body class=\"" + name + "\"" + attrs + ">");
}

module.exports = { mode, apply };
