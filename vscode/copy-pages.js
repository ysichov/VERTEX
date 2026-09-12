"use strict";

// The pages are the Eclipse plugin's: they live in its bundle, because that is
// where Eclipse reads them from. A vsix carries only this folder, so a packaged
// extension built straight from the repository would ship with no pages at all.
//
// This copies them in, and vscode:prepublish runs it. Running from the
// repository still reads the originals - see PAGES in extension.js - so there
// is one source of truth and this copy is only ever the packaged one.

const fs = require("fs");
const path = require("path");

const from = path.join(__dirname, "..", "org.vertex.abap.ui", "resources");
const to = path.join(__dirname, "resources");

if (!fs.existsSync(from)) {
  // Packaging outside the repository has nothing to copy from, and a silent
  // success here would produce an extension with no pages.
  console.error("No pages at " + from + ". Package from a checkout of the repository.");
  process.exit(1);
}

fs.mkdirSync(to, { recursive: true });

const pages = fs.readdirSync(from).filter(function (name) {
  return name.endsWith(".html");
});
if (pages.length === 0) {
  console.error("No .html pages in " + from + ".");
  process.exit(1);
}

pages.forEach(function (name) {
  fs.copyFileSync(path.join(from, name), path.join(to, name));
  console.log("copied " + name);
});

// A page is given to the webview as a string, so it has no address to load a
// script from: what it needs, it asks the host for by name and gets as text.
// Those files live next to the pages and travel with them.
const libraries = fs.readdirSync(from).filter(function (name) {
  return name.endsWith(".js");
});
if (libraries.length === 0) {
  console.error("No libraries in " + from + ". The Flow diagram needs mermaid.min.js.");
  process.exit(1);
}

libraries.forEach(function (name) {
  fs.copyFileSync(path.join(from, name), path.join(to, name));
  console.log("copied " + name);
});
