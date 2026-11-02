"use strict";
// What the Eclipse Value origin page calls as window.vertexOrigin: the VS Code analysis and its page, unchanged.
// value-origin-bundle.js builds it with every module these require, so nothing here lists them.
const origin = require("../vscode/value-origin"), ace = require("../vscode/value-origin-ace"), points = require("../vscode/value-origin-points"),
  view = require("../vscode/value-origin-view"), open = require("../vscode/value-origin-open"), pipeline = require("../vscode/value-origin-pipeline");
module.exports = { analyze: origin.analyze, collect: pipeline.collect,
  variableAt: origin.variableAt, callsIn: origin.callsIn, variablePaths: origin.variablePaths,
  // Forward's stops at breakpoints and Backward's walk to the callers, as VS Code runs them.
  flowScope: view.flowScope, stopAtBreakpoints: view.stopAtBreakpoints, backward: require("../vscode/backward-usage"),
  classifyStatement: require("../vscode/abap-control").classifyStatement,
  literalAt: origin.literalAt, locateTarget: ace.locateTarget, pathRows: points.pathRows,
  siteRows: points.siteRows, html: view.html, sourceLineIn: open.sourceLineIn, methodLine: open.methodLine };
