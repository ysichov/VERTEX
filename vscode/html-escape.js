"use strict";
// Text put into a page - an element's content or a quoted attribute - as text: & < > and " are written as entities,
// and nothing (null or undefined) as nothing. The pages built in VS Code and those built in the analysis worker for
// Eclipse (vertex-frontend.js, Value origin) use this one.
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

module.exports = { escapeHtml };
