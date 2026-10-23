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
  const entryOf = s => ({ line: s.line, endLine: s.tokens.at(-1)?.line || s.line, text: s.text });
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
    if (closes[k]) { close(s); continue; }
    if (branches[k] && stack.length > 1) { stack[stack.length - 1].branches.push({ open: s, items: [], exit: null }); continue; }
    if (current.exit) { if (opens[k]) stack.push({ kind: opens[k], open: s, branches: [{ open: s, items: [], exit: null }], dead: true }); continue; }
    if (opens[k]) { stack.push({ kind: opens[k], open: s, branches: [{ open: s, items: [], exit: null }] }); continue; }
    if (k === 'Check') { current.items.push({ ...entryOf(s), verdict: 'true', scope: loopId() }); continue; }
    const leaving = leaves(s);
    if (leaving) current.exit = { ...entryOf(s), scope: leaving.scope };
  }

  // What a closed block gives its parent is written as the code is: its opening line when a later branch is shown,
  // the branches that matter, and its closing statement.
  function close(closing) {
    const frame = stack.pop(), parent = branch(), shown = [];
    if (frame.dead) return;
    const depth = stack.length; // the closed frame's own index: a LOOP's pass-scoped gates end with it
    // A block shown from inside the loop stays only while something that conditions the line is left in it.
    const frame_ = new Set(['context', 'case', 'end']);
    const keep = items => items.flatMap(item => {
      if (item.verdict === 'group') { const children = keep(item.children); return children.some(c => !frame_.has(c.verdict)) ? [{ ...item, children }] : []; }
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
    if (frame.kind === 'TRY' && kept[0].exit) { shown.push({ ...entryOf(frame.open), verdict: 'raises', reason: kept[0].exit, scope: kept[0].exit.scope }); }
    for (const b of (frame.kind === 'TRY' ? kept.slice(1) : choosing ? options : [])) {
      if (b.exit) shown.push({ ...entryOf(b.open), verdict: 'avoid', reason: b.exit, scope: b.exit.scope });
      else if (b.items.length) shown.push({ ...entryOf(b.open), verdict: 'when', children: b.items });
    }
    if (frame.kind === 'LOOP' && kept[0].exit) shown.push({ ...entryOf(frame.open), verdict: 'skip', reason: kept[0].exit, scope: kept[0].exit.scope });
    if (frame.kind === 'LOOP' && kept[0].items.length) shown.push({ ...entryOf(frame.open), verdict: 'when', children: kept[0].items });
    if (!shown.length) return;
    if (shown[0].line !== frame.open.line) shown.unshift({ ...entryOf(frame.open), verdict: frame.kind === 'CASE' ? 'case' : 'context' });
    // WHEN stands one level inside its CASE, as it is written.
    const rows = frame.kind === 'CASE' ? shown.map((row, i) => i ? { ...row, indent: 1 } : row) : shown;
    parent.items.push({ verdict: 'group', children: [...rows, { ...entryOf(closing), verdict: 'end' }] });
  }

  const own = branches[target.parserKind] && stack.length > 1 && stack[stack.length - 1].kind === branches[target.parserKind];
  if (own) stack[stack.length - 1].branches.push({ open: target, items: [], exit: null, target: true });
  const dead = stack.find(f => f.dead) || null;
  const blocked = stack.map(f => f.branches.at(-1).exit).find(Boolean) || null;

  const path = [];
  // Depth as in the code: a block's own lines one level out from what stands inside it.
  const at_ = depth => item => ({ ...item, depth });
  const levels = [];
  stack.forEach((frame, index) => { levels.push(index < 2 ? 0 : levels[index - 1] + 1 + (stack[index - 1].kind === 'CASE' ? 1 : 0)); });
  const inner = index => index === 0 ? 0 : levels[index] + 1 + (stack[index].kind === 'CASE' ? 1 : 0);
  stack.forEach((frame, index) => {
    const taken = frame.branches.at(-1), outer = path.length, head = levels[index];
    if (frame.kind === 'IF' || frame.kind === 'CASE') {
      const before = frame.kind === 'CASE' ? frame.branches.slice(1, -1) : frame.branches.slice(0, -1);
      if (frame.kind === 'CASE') path.push({ ...entryOf(frame.open), verdict: 'case' });
      before.forEach(b => path.push({ ...entryOf(b.open), verdict: 'false' }));
      const otherwise = ['Else', 'WhenOthers'].includes(taken.open.parserKind);
      if (!taken.target && !(frame.kind === 'CASE' && taken.open === frame.open)) path.push({ ...entryOf(taken.open), verdict: otherwise ? 'else' : 'true' });
    } else if (frame.kind === 'LOOP') path.push({ ...entryOf(frame.open), verdict: 'entered' });
    else if (frame.kind === 'TRY' && taken.open === frame.open) path.push({ ...entryOf(frame.open), verdict: 'context' });
    else if (frame.kind === 'TRY' && taken.open !== frame.open && !taken.target) {
      path.push({ ...entryOf(frame.open), verdict: 'raises' });
      if (taken.open.parserKind === 'Catch') path.push({ ...entryOf(taken.open), verdict: 'catches' });
    }
    path.splice(outer, path.length - outer, ...path.slice(outer).map(item => ({ ...item, depth: head + (frame.kind === 'CASE' && item.verdict !== 'case' ? 1 : 0) })));
    path.push(...taken.items.map(strip).map(at_(inner(index))));
  });
  const last = stack.length - 1;
  path.push({ ...entryOf(target), verdict: 'target', depth: own ? levels[last] + (stack[last].kind === 'CASE' ? 1 : 0) : inner(last) });
  // The closing statements of the blocks still open at the line, innermost first, found after it.
  const pending = stack.slice(1).map((frame, index) => levels[index + 1]).reverse();
  let nest = opens[target.parserKind] ? 1 : 0;
  for (let i = at + 1; i < all.length && pending.length; i++) {
    const k = all[i].parserKind;
    if (procedures[k] || Object.values(procedures).includes(k)) break;
    if (opens[k]) nest++;
    else if (closes[k]) { if (nest) nest--; else path.push({ ...entryOf(all[i]), verdict: 'end', depth: pending.shift() }); }
  }
  function strip(item) { const { scope, ...rest } = item; if (rest.reason) rest.reason = { line: rest.reason.line, endLine: rest.reason.endLine, text: rest.reason.text }; return rest.children ? { ...rest, children: rest.children.map(strip) } : rest; }

  return { procedure: entryOf(all[start]), target: entryOf(target), path,
    unreachable: dead ? { line: dead.open.line, text: dead.open.text, reason: 'after a statement that always leaves' }
      : blocked ? { line: blocked.line, text: blocked.text, reason: 'always leaves before this line' } : null };
}

// For the Logic view: each given line's path as the source lines it touches, the line itself included.
function reachLines(statements, lines) {
  const touched = items => items.flatMap(item => [item.line, ...(item.reason ? [item.reason.line] : []), ...touched(item.children || [])]).filter(Boolean);
  const map = {};
  for (const line of new Set(lines)) {
    const statement = statements.find(s => s.line === line);
    if (!statement) continue;
    const result = reachPath(statements, statement.offset, line);
    map[line] = [...new Set([result.procedure.line, ...touched(result.path)])];
  }
  return map;
}

/* Where the variables of the path's conditions get their values: abaplint's Read From references on each condition's
   lines, and for each variable the last Write To of the same declaration before that condition, inside the routine.
   Unknown types are taken as void, so a missing DDIC type does not stop the analysis. Returns the variables, each with
   its source statement (null when the routine does not write it - a parameter, an attribute), and the marks to colour
   on each line: { line: [{ column, length, index }] }. */
function valueSources(text, fileName, statements, result) {
  const abaplint = require('@abaplint/core');
  const config = abaplint.Config.getDefault().get();
  config.syntax.errorNamespace = '^(?!)';
  const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify(config)))
    .addFile(new abaplint.MemoryFile(fileName, text)).parse();
  const object = registry.getFirstObject();
  if (!object) return { variables: [], marks: {} };
  const refs = [];
  const walk = node => { node.getData().references.forEach(ref => refs.push(ref)); node.getChildren().forEach(walk); };
  walk(new abaplint.SyntaxLogic(registry, object).run().spaghetti.getTop());
  const id = ref => ref.resolved ? ref.resolved.getFilename() + ':' + ref.resolved.getStart().getRow() + ':' + ref.resolved.getStart().getCol() : null;
  const row = ref => ref.position.getStart().getRow();
  const from = result.procedure.line, conditions = [];
  const collect = items => items.forEach(item => {
    if (item.line && !['end', 'context'].includes(item.verdict)) conditions.push(item);
    if (item.children) collect(item.children);
  });
  collect(result.path);
  const variables = new Map(), colours = new Map(), marks = {};
  const mark = (ref, index) => (marks[row(ref)] = marks[row(ref)] || []).push({ column: ref.position.getStart().getCol() - 1, length: ref.position.getName().length, index });
  for (const condition of conditions) {
    const reads = refs.filter(ref => ref.referenceType === 'Read From' && id(ref) && row(ref) >= condition.line && row(ref) <= condition.endLine);
    for (const read of reads) {
      const key = id(read);
      const writes = refs.filter(ref => ref.referenceType === 'Write To' && id(ref) === key && row(ref) > from && row(ref) < condition.line);
      const write = writes.sort((a, b) => row(a) - row(b)).at(-1) || null;
      // One colour per variable; a variable written in two places before two conditions lists both sources.
      if (!colours.has(key)) colours.set(key, colours.size);
      const index = colours.get(key), variableKey = key + '@' + (write ? row(write) : '-');
      if (!variables.has(variableKey)) {
        const statement = write && statements.filter(s => s.line <= row(write)).at(-1);
        variables.set(variableKey, { name: read.position.getName(), index,
          source: statement ? { line: statement.line, endLine: statement.tokens.at(-1)?.line || statement.line, text: statement.text } : null });
        if (write) mark(write, index);
      }
      mark(read, index);
    }
  }
  return { variables: [...variables.values()], marks };
}

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = { true: 'true', false: 'false', case: '', context: '', end: '', target: '', entered: 'entered', raises: 'raises an exception', catches: 'catches it',
  avoid: 'must not be taken', skip: 'must not be entered', when: 'if taken:' };

// lines: the source's lines; each row shows its statement's lines as they stand there - indentation, breaks and all.
// relative: numbers are shown from the routine's opening statement (line 1), as SAP GUI numbers a method; the links
// still lead to the source line.
// sources: valueSources' answer, shown under the Value sources toggle; controls: the shared vertex-controls.css.
function page(result, nonce, cspSource, lines, relative = false, sources = null, controls = '') {
  const shown = line => relative ? line - result.procedure.line + 1 : line;
  const marked = (text, line) => {
    const marks = (sources && sources.marks[line] || []).slice().sort((a, b) => a.column - b.column);
    let out = '', at = 0;
    for (const m of marks) {
      if (m.column < at) continue;
      out += escape(text.slice(at, m.column)) + '<span class="v v' + (m.index % 6) + '">' + escape(text.slice(m.column, m.column + m.length)) + '</span>';
      at = m.column + m.length;
    }
    return out + escape(text.slice(at));
  };
  const code = item => '<pre>' + lines.slice(item.line - 1, item.endLine).map((text, i) => marked(text, item.line + i)).join('\n') + '</pre>';
  const origin = sources && sources.variables.length ? '<div class="origins"><p>Where the values come from:</p><ul>'
    + sources.variables.map(v => '<li><span class="name v v' + (v.index % 6) + '">' + escape(v.name) + '</span>'
      + (v.source ? '<a href="#" data-line="' + v.source.line + '">' + shown(v.source.line) + '</a>' + code(v.source)
        : '<span class="reason">not written in this routine - a parameter, an attribute or a global</span>') + '</li>').join('')
    + '</ul></div>' : '';
  // A row shows its statement's lines; a closing statement on a line already shown - IF x. RETURN. ENDIF. on one line -
  // adds nothing and is left out.
  let shownTo = 0;
  const row = (item, depth) => item.verdict === 'group' ? item.children.map(child => row(child, depth + (child.indent || 0))).join('')
    : item.verdict === 'end' && item.line <= shownTo ? '' : (shownTo = Math.max(shownTo, item.endLine || item.line), '<li class="' + item.verdict + '"><a href="#" data-line="' + item.line + '">'
    + shown(item.line) + '</a>' + code(item)
    + (words[item.verdict] ? ' <span class="verdict ' + item.verdict + '">' + words[item.verdict] + '</span>' : '')
    + (item.reason ? ' <span class="reason">— leaves at <a href="#" data-line="' + item.reason.line + '">' + shown(item.reason.line) + '</a></span>' : '')
    + '</li>' + (item.children || []).map(child => row(child, depth + 1 + (child.indent || 0))).join(''));
  const body = result.unreachable
    ? '<p class="unreachable">Not reachable: <a href="#" data-line="' + result.unreachable.line + '">' + shown(result.unreachable.line) + '</a> ' + escape(result.unreachable.reason) + '.</p>' : '';
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src ' + cspSource + ' \'nonce-' + nonce + '\'; script-src \'nonce-' + nonce + '\';">'
    + '<style nonce="' + nonce + '">body{background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}'
    + 'code{font-family:var(--vscode-editor-font-family)}a{color:var(--vscode-textLink-foreground)}ul{list-style:none;padding-left:0}'
    // A row: its line number, then the statement's lines exactly as in the source, then the verdict tag.
    + 'li{display:flex;align-items:flex-end;gap:8px;margin:1px 0}li>a:first-child{min-width:5ch;text-align:right;align-self:flex-start;font-family:var(--vscode-editor-font-family)}'
    + 'pre{margin:0;white-space:pre;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);color:var(--vscode-editor-foreground)}'
    + 'li.target pre{background:var(--vscode-editor-lineHighlightBackground);outline:1px solid var(--vscode-focusBorder)}li.context pre,li.end pre{opacity:.75}body{overflow-x:auto}'
    + '.verdict{display:inline-block;margin-left:6px;padding:0 6px;border:1px solid currentColor;border-radius:8px;font-size:.85em;line-height:1.4;color:var(--vscode-descriptionForeground)}'
    + '.verdict.true,.verdict.entered,.verdict.catches{color:var(--vscode-testing-iconPassed)}'
    + '.verdict.false,.verdict.avoid,.verdict.skip{color:var(--vscode-testing-iconFailed)}'
    + '.reason{color:var(--vscode-descriptionForeground)}.unreachable{color:var(--vscode-errorForeground)}'
    // Value sources: one theme colour per variable, shown only while the toggle is on.
    + '.origins{display:none;margin-top:12px}body.sources .origins{display:block}.origins .name{min-width:12ch;font-family:var(--vscode-editor-font-family)}'
    + 'body.sources .v{font-weight:bold;text-decoration:underline}'
    + ['red', 'blue', 'green', 'orange', 'purple', 'yellow'].map((c, i) => 'body.sources .v' + i + '{color:var(--vscode-charts-' + c + ')}').join('')
    + controls + '</style></head><body>'
    + (sources ? '<p><button type="button" class="vertex-toggle" id="sources" title="Colour the variables of the conditions and show where each gets its value">Value sources</button></p>' : '')
    + '<p>Path to line <a href="#" data-line="' + result.target.line + '">' + shown(result.target.line) + '</a> in <code>'
    + escape(result.procedure.text) + '</code></p>' + body
    + (result.path.length ? '<ul>' + result.path.map(item => row(item, item.depth)).join('') + '</ul>' : '<p>No condition: the line runs whenever the routine does.</p>')
    + origin
    + '<script nonce="' + nonce + '">const vscode=acquireVsCodeApi();'
    + 'const toggle=document.getElementById("sources");if(toggle)toggle.addEventListener("click",()=>{const on=document.body.classList.toggle("sources");toggle.classList.toggle("on",on);});'
    + 'document.addEventListener("click",e=>{const a=e.target.closest("a[data-line]");'
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
    let sources = null;
    try {
      const statements = parsed.source.aceStatements;
      const owner = objectType === 'CLAS' && statements.find(s => s.parserKind === 'ClassDefinition');
      const fileName = owner ? String(owner.tokens[1].value).toLowerCase().replace(/\//g, '#') + '.clas.abap' : 'zvertex_path.prog.abap';
      sources = valueSources(document.getText(), fileName, statements, result);
    } catch (error) { vscode.window.showWarningMessage('VERTEX: abaplint could not find where the condition values come from: ' + error.message); }
    const controls = require('fs').readFileSync(require('path').join(__dirname, 'resources', 'vertex-controls.css'), 'utf8');
    const relative = vscode.workspace.getConfiguration('vertex').get('pathToLine.methodRelativeLines', false);
    const title = relative ? result.target.line - result.procedure.line + 1 : result.target.line;
    const panel = vscode.window.createWebviewPanel('vertex.reachPath', 'Path to line ' + title, vscode.ViewColumn.Beside, { enableScripts: true });
    panel.webview.html = page(result, require('crypto').randomBytes(18).toString('hex'), panel.webview.cspSource || '', document.getText().split(/\r?\n/), relative, sources, controls);
    panel.webview.onDidReceiveMessage(async message => {
      if (!message || !message.line) return;
      const shown = await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn });
      const position = new vscode.Position(message.line - 1, 0);
      shown.selection = new vscode.Selection(position, position);
      shown.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    });
  }));
}

module.exports = { reachPath, reachLines, valueSources, page, register };
