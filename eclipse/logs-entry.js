"use strict";
// What the Eclipse Session Logs page calls as window.vertexLogs: VS Code's log reading (log-report.js), its snapshot
// page (log-snapshot.js) and its reading of a logged object (session-log.js). Java reads and deletes the files.
module.exports = { parseSession: require("../vscode/log-report").parseSession, snapshotHtml: require("../vscode/log-snapshot").html,
  objectReference: require("../vscode/session-log").objectReference };
