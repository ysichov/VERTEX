"use strict";
/* What a line needs to be reached inside its METHOD or FORM: the branches that enclose it, the branches before it
   that must not be taken because they leave, and the CHECKs on the way. Statements come from abaplint (parserKind),
   never from a pattern over the text; every condition is shown as it is written in the code. */

const opens = { If: 'IF', Case: 'CASE', Try: 'TRY', Loop: 'LOOP', Do: 'LOOP', While: 'LOOP', SelectLoop: 'LOOP', At: 'LOOP', Provide: 'LOOP' };
const closes = { EndIf: 'IF', EndCase: 'CASE', EndTry: 'TRY', EndLoop: 'LOOP', EndDo: 'LOOP', EndWhile: 'LOOP', EndSelect: 'LOOP', EndAt: 'LOOP', EndProvide: 'LOOP' };
const branches = { ElseIf: 'IF', Else: 'IF', When: 'CASE', WhenOthers: 'CASE', Catch: 'TRY', Cleanup: 'TRY' };
const procedures = { MethodImplementation: 'EndMethod', Form: 'EndForm' };

// line: the cursor's line - a statement starting on it is the one meant even when the cursor stands in its indentation.
function reachPath(statements, offset, line) {
  const all = statements || [];
  const starting = all.findIndex(s => s.line === line);
  const at = starting >= 0 ? starting : all.filter(s => s.offset <= offset).length - 1;
  if (at < 0) throw new Error('The cursor is before the first statement.');
  let start = -1;
  for (let i = at; i >= 0; i--) {
    const kind = all[i].parserKind;
    if (procedures[kind]) { start = i; break; }
    if (Object.values(procedures).includes(kind) && i < at) break;
  }
  if (start < 0) throw new Error('Put the cursor inside a METHOD or FORM: the path is built inside one of them.');
  const end = all.findIndex((s, i) => i > start && s.parserKind === procedures[all[start].parserKind]);
  if (end >= 0 && end < at) throw new Error('Put the cursor inside a METHOD or FORM: the path is built inside one of them.');
  const target = all[at];
  const entryOf = s => ({ line: s.line, text: s.text });
  if (at === start) return { procedure: entryOf(all[start]), target: entryOf(target), path: [], unreachable: null };

  // A frame is an open block; each branch keeps what was found in it: gates (CHECK, branches that must be avoided)
  // and the statement that leaves it, if one does unconditionally.
  const stack = [{ kind: 'PROC', open: all[start], branches: [{ open: all[start], items: [], exit: null }] }];
  const branch = () => stack[stack.length - 1].branches.at(-1);
  const loopId = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === 'LOOP') return i; return -1; };
  // What leaves: the procedure (RETURN, RAISE, LEAVE PROGRAM, CHECK/EXIT outside a loop) or the loop's pass (CHECK,
  // CONTINUE, EXIT inside a loop). A pass left matters only to lines inside that same loop.
  const leaves = s => {
    const k = s.parserKind, word = String(s.tokens[1]?.value || '').toUpperCase();
    if (k === 'Return' || k === 'Raise' || (k === 'Leave' && word === 'PROGRAM')) return { scope: -1 };
    if (k === 'Exit' || k === 'Continue') return { scope: loopId() };
    return null;
  };

  for (let i = start + 1; i < at; i++) {
    const s = all[i], k = s.parserKind, current = branch();
    if (closes[k]) { close(); continue; }
    if (branches[k] && stack.length > 1) { stack[stack.length - 1].branches.push({ open: s, items: [], exit: null }); continue; }
    if (current.exit) { if (opens[k]) stack.push({ kind: opens[k], open: s, branches: [{ open: s, items: [], exit: null }], dead: true }); continue; }
    if (opens[k]) { stack.push({ kind: opens[k], open: s, branches: [{ open: s, items: [], exit: null }] }); continue; }
    if (k === 'Check') { current.items.push({ ...entryOf(s), verdict: 'true', scope: loopId() }); continue; }
    const leaving = leaves(s);
    if (leaving) current.exit = { ...entryOf(s), scope: leaving.scope };
  }

  function close() {
    const frame = stack.pop(), parent = branch();
    if (frame.dead) return;
    const depth = stack.length; // the closed frame's own index: a LOOP's pass-scoped gates end with it
    const keep = items => items.flatMap(item => {
      if (item.children) { const children = keep(item.children); return children.length ? [{ ...item, children }] : []; }
      return frame.kind === 'LOOP' && item.scope === depth ? [] : [item];
    });
    const kept = frame.branches.map(b => ({ ...b, items: keep(b.items),
      exit: b.exit && !(frame.kind === 'LOOP' && b.exit.scope === depth) ? b.exit : null }));
    const covering = frame.kind === 'IF' ? frame.branches.some(b => b.open.parserKind === 'Else')
      : frame.kind === 'CASE' ? frame.branches.some(b => b.open.parserKind === 'WhenOthers') : false;
    const choosing = frame.kind === 'IF' || frame.kind === 'CASE';
    const options = choosing && frame.kind === 'CASE' ? kept.slice(1) : kept;
    if (choosing && covering && options.every(b => b.exit)) { parent.exit = { ...options.at(-1).exit, scope: Math.min(...options.map(b => b.exit.scope)) }; return; }
    if (frame.kind === 'TRY' && kept[0].exit) { parent.items.push({ ...entryOf(frame.open), verdict: 'raises', reason: kept[0].exit, scope: kept[0].exit.scope }); }
    for (const b of (frame.kind === 'TRY' ? kept.slice(1) : options)) {
      if (b.exit) parent.items.push({ ...entryOf(b.open), verdict: 'avoid', reason: b.exit, scope: b.exit.scope });
      else if (b.items.length) parent.items.push({ ...entryOf(b.open), verdict: 'when', children: b.items });
    }
    if (frame.kind === 'LOOP' && kept[0].exit) parent.items.push({ ...entryOf(frame.open), verdict: 'skip', reason: kept[0].exit, scope: kept[0].exit.scope });
    if (frame.kind === 'LOOP' && kept[0].items.length) parent.items.push({ ...entryOf(frame.open), verdict: 'when', children: kept[0].items });
  }

  const own = branches[target.parserKind] && stack.length > 1 && stack[stack.length - 1].kind === branches[target.parserKind];
  if (own) stack[stack.length - 1].branches.push({ open: target, items: [], exit: null, target: true });
  const dead = stack.find(f => f.dead) || null;
  const blocked = stack.map(f => f.branches.at(-1).exit).find(Boolean) || null;

  const path = [];
  stack.forEach((frame, index) => {
    const taken = frame.branches.at(-1);
    if (frame.kind === 'IF' || frame.kind === 'CASE') {
      const before = frame.kind === 'CASE' ? frame.branches.slice(1, -1) : frame.branches.slice(0, -1);
      if (frame.kind === 'CASE') path.push({ ...entryOf(frame.open), verdict: 'case' });
      before.forEach(b => path.push({ ...entryOf(b.open), verdict: 'false' }));
      const otherwise = ['Else', 'WhenOthers'].includes(taken.open.parserKind);
      if (!taken.target && !(frame.kind === 'CASE' && taken.open === frame.open)) path.push({ ...entryOf(taken.open), verdict: otherwise ? 'else' : 'true' });
    } else if (frame.kind === 'LOOP') path.push({ ...entryOf(frame.open), verdict: 'entered' });
    else if (frame.kind === 'TRY' && taken.open !== frame.open && !taken.target) {
      path.push({ ...entryOf(frame.open), verdict: 'raises' });
      if (taken.open.parserKind === 'Catch') path.push({ ...entryOf(taken.open), verdict: 'catches' });
    }
    if (index === 0 && frame.kind !== 'PROC') return;
    path.push(...taken.items.map(strip));
  });
  function strip(item) { const { scope, ...rest } = item; if (rest.reason) rest.reason = { line: rest.reason.line, text: rest.reason.text }; return rest.children ? { ...rest, children: rest.children.map(strip) } : rest; }

  return { procedure: entryOf(all[start]), target: entryOf(target), path,
    unreachable: dead ? { line: dead.open.line, text: dead.open.text, reason: 'after a statement that always leaves' }
      : blocked ? { line: blocked.line, text: blocked.text, reason: 'always leaves before this line' } : null };
}

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = { true: 'true', false: 'false', case: '', entered: 'entered', raises: 'raises an exception', catches: 'catches it',
  avoid: 'must not be taken', skip: 'must not be entered', when: 'if taken:' };

function page(result, nonce, cspSource) {
  const row = (item, depth) => '<li style="margin-left:' + depth * 18 + 'px"><a href="#" data-line="' + item.line + '">'
    + item.line + '</a> <code>' + escape(item.text) + '</code>'
    + (words[item.verdict] ? ' <span class="verdict ' + item.verdict + '">' + words[item.verdict] + '</span>' : '')
    + (item.reason ? ' <span class="reason">— leaves at <a href="#" data-line="' + item.reason.line + '">' + item.reason.line + '</a> <code>' + escape(item.reason.text) + '</code></span>' : '')
    + '</li>' + (item.children || []).map(child => row(child, depth + 1)).join('');
  const body = result.unreachable
    ? '<p class="unreachable">Not reachable: <a href="#" data-line="' + result.unreachable.line + '">' + result.unreachable.line + '</a> <code>'
      + escape(result.unreachable.text) + '</code> ' + escape(result.unreachable.reason) + '.</p>' : '';
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' + cspSource + ' \'nonce-' + nonce + '\'; script-src \'nonce-' + nonce + '\';">'
    + '<style nonce="' + nonce + '">body{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}'
    + 'code{font-family:var(--vscode-editor-font-family)}a{color:var(--vscode-textLink-foreground)}ul{list-style:none;padding-left:0}li{margin:3px 0}'
    + '.verdict{color:var(--vscode-descriptionForeground);font-style:italic}.verdict.false,.verdict.avoid,.verdict.skip{color:var(--vscode-errorForeground)}'
    + '.reason{color:var(--vscode-descriptionForeground)}.unreachable{color:var(--vscode-errorForeground)}</style></head><body>'
    + '<p>Path to <a href="#" data-line="' + result.target.line + '">' + result.target.line + '</a> <code>' + escape(result.target.text) + '</code><br>in <code>'
    + escape(result.procedure.text) + '</code></p>' + body
    + (result.path.length ? '<ul>' + result.path.map(item => row(item, 0)).join('') + '</ul>' : '<p>No condition: the line runs whenever the routine does.</p>')
    + '<script nonce="' + nonce + '">const vscode=acquireVsCodeApi();document.addEventListener("click",e=>{const a=e.target.closest("a[data-line]");'
    + 'if(a){e.preventDefault();vscode.postMessage({line:Number(a.dataset.line)});}});</script></body></html>';
}

function register(vscode, context) {
  context.subscriptions.push(vscode.commands.registerCommand('vertex.reachPath', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('VERTEX: open an ABAP source first.'); return; }
    const document = editor.document, uri = document.uri.toString();
    const objectType = /\.clas\.|\/CLAS\//i.test(uri) ? 'CLAS' : 'PROG';
    const parser = require('./value-origin-linter').createParser();
    let parsed;
    try { parsed = await parser.parse({ id: uri, name: document.fileName, objectName: '', objectType, text: document.getText() }); }
    catch (error) { vscode.window.showErrorMessage('VERTEX: the source could not be parsed: ' + error.message); return; }
    finally { await parser.close(); }
    let result;
    try { result = reachPath(parsed.source.aceStatements, document.offsetAt(editor.selection.active), editor.selection.active.line + 1); }
    catch (error) { vscode.window.showErrorMessage('VERTEX: ' + error.message); return; }
    if (parsed.warnings.length) vscode.window.showWarningMessage('VERTEX: the parser did not understand some statements; the path may miss conditions there: ' + parsed.warnings.join('; '));
    const panel = vscode.window.createWebviewPanel('vertex.reachPath', 'Path to line ' + result.target.line, vscode.ViewColumn.Beside, { enableScripts: true });
    panel.webview.html = page(result, require('crypto').randomBytes(18).toString('hex'), panel.webview.cspSource || '');
    panel.webview.onDidReceiveMessage(async message => {
      if (!message || !message.line) return;
      const shown = await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn });
      const position = new vscode.Position(message.line - 1, 0);
      shown.selection = new vscode.Selection(position, position);
      shown.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    });
  }));
}

module.exports = { reachPath, page, register };
