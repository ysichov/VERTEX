"use strict";
/* Folding of ABAP blocks in the editor, as SAP GUI's editor folds them: a block from its opening statement to the line
   before its closing one (the ENDIF stays in sight), and each branch - ELSEIF, ELSE, WHEN, CATCH, CLEANUP - up to the
   line before the next branch or the end. Blocks come from abaplint's statement kinds, so unformatted code folds as well
   as formatted; never from a pattern over the text. A fold starts on the opening statement's last line, so a condition
   written over several lines stays readable. */

const pairs = {
  If: 'EndIf', Case: 'EndCase', Loop: 'EndLoop', Do: 'EndDo', While: 'EndWhile', SelectLoop: 'EndSelect', Try: 'EndTry',
  At: 'EndAt', Provide: 'EndProvide', MethodImplementation: 'EndMethod', Form: 'EndForm', FunctionModule: 'EndFunction',
  Module: 'EndModule', ClassDefinition: 'EndClass', ClassImplementation: 'EndClass', Interface: 'EndInterface'
};
const branchKinds = new Set(['ElseIf', 'Else', 'When', 'WhenOthers', 'Catch', 'Cleanup']);
const closers = new Set(Object.values(pairs));

function foldingRanges(statements) {
  const ranges = [], stack = [];
  const last = s => s.tokens.at(-1)?.line || s.line;
  const add = (start, end) => { if (end > start) ranges.push({ start, end }); };
  for (const s of statements || []) {
    const kind = s.parserKind;
    if (branchKinds.has(kind) && stack.length) {
      const block = stack.at(-1);
      if (block.branch) add(block.branch, s.line - 1);
      block.branch = last(s);
      continue;
    }
    if (closers.has(kind)) {
      const at = stack.map(b => pairs[b.kind]).lastIndexOf(kind);
      if (at < 0) continue;
      // Blocks left open inside (a statement abaplint did not understand) are dropped, not folded to a guessed end.
      const block = stack.splice(at)[0];
      add(block.start, s.line - 1);
      if (block.branch) add(block.branch, s.line - 1);
      continue;
    }
    if (pairs[kind]) stack.push({ kind, start: last(s), branch: 0 });
  }
  return ranges;
}

/* Where a block keyword leads: an opening statement to its end and the end back to the opening; with branches (F12,
   Ctrl+click) IF and CASE step through ELSEIF, ELSE and WHEN on the way, TRY through CATCH and CLEANUP. Keys and
   targets are statements, by the line of their first token. */
function blockJumps(statements, branches) {
  const jumps = new Map(), stack = [];
  for (const s of statements || []) {
    const kind = s.parserKind;
    if (branchKinds.has(kind) && stack.length) { stack.at(-1).branches.push(s); continue; }
    if (closers.has(kind)) {
      const at = stack.map(b => pairs[b.open.parserKind]).lastIndexOf(kind);
      if (at < 0) continue;
      const block = stack.splice(at)[0];
      jumps.set(block.open.line, branches && block.branches[0] || s);
      block.branches.forEach((branch, i) => jumps.set(branch.line, block.branches[i + 1] || s));
      jumps.set(s.line, block.open);
      continue;
    }
    if (pairs[kind]) stack.push({ open: s, branches: [] });
  }
  return jumps;
}

function register(vscode, context) {
  const statements = require('./abap-statements');
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(statements.forget));
  context.subscriptions.push(vscode.languages.registerFoldingRangeProvider({ language: 'abap' }, {
    async provideFoldingRanges(document) {
      return foldingRanges(await statements.statementsOf(document)).map(r => new vscode.FoldingRange(r.start - 1, r.end - 1));
    }
  }));
}

module.exports = { foldingRanges, blockJumps, register };
