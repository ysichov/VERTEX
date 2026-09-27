"use strict";
const { analyze, variableAt } = require('./value-origin');
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function html(graph, nonce) {
  const byId = new Map(graph.nodes.map(n => [n.id, n])), expanded = new Set();
  function tree(id, depth = 0, label = '') {
    const n = byId.get(id); if (!n) return '';
    const caption = `<span class="edge">${escape(label)}</span> <code>${escape(n.text)}</code> <button class="location" title="Open source here; Ctrl+Click opens beside" data-node="${n.id}">${escape(n.location || n.sourceName || n.source)}:${n.line}</button>`;
    if (expanded.has(id)) return `<div class="leaf">↳ ${caption} <small>shared dependency</small></div>`;
    expanded.add(id);
    const children = graph.edges.filter(e => e.to === id);
    if (!children.length) return `<div class="leaf ${n.kind}">${caption}</div>`;
    return `<details class="node" ${depth < 4 ? 'open' : ''}><summary>${caption}</summary><div class="children">${children.map(e => tree(e.from, depth + 1, e.label)).join('')}</div></details>`;
  }
  const dependencyTree = tree(graph.root);
  // The dependency graph is traversed backward.  Render call frames from its
  // edges rather than the flat, de-duplicated navigation list, otherwise the
  // nesting which explains how a value crosses methods is lost.
  const incoming = new Map();
  for (const e of graph.edges) incoming.set(e.to, [...(incoming.get(e.to) || []), e]);
  const callFor = n => (graph.calls || []).find(c => c.source === n.source && c.line === n.line);
  const renderedFrames = new Set();
  function callFrames(id, depth = 0, ancestors = new Set()) {
    if (ancestors.has(id)) return '';
    const nextAncestors = new Set(ancestors); nextAncestors.add(id);
    const children = [...(incoming.get(id) || [])].sort((a, b) => (byId.get(a.from)?.line || 0) - (byId.get(b.from)?.line || 0));
    return children.map(e => {
      const n = byId.get(e.from); if (!n) return '';
      const nested = callFrames(n.id, depth + (n.kind === 'call' ? 1 : 0), nextAncestors);
      if (n.kind !== 'call') return nested;
      const found = callFor(n), caller = found?.caller || n.location || n.sourceName || n.source;
      const targets = n.callee || found?.callees?.join(' | ') || found?.method + ' (unresolved)';
      const frameKey = `${n.source}:${n.line}:${caller}:${targets}`;
      if (renderedFrames.has(frameKey)) return '';
      renderedFrames.add(frameKey);
      // The call index owns the caller's statement location. A nested node
      // can belong to an interface signature, which must never steal this
      // navigation target.
      const source = found?.source || n.source, line = found?.line || n.line;
      const caption = `<code>${escape(caller)} → ${escape(targets)}</code>${n.possible || found?.possible ? ' <span class="edge">possible targets</span>' : ''} <button class="location" title="Open the calling statement; Ctrl+Click opens beside" data-node="${n.id}" data-source="${escape(source)}" data-line="${line}">line ${line}</button>`;
      return nested ? `<details class="call-frame" ${depth === 0 ? 'open' : ''}><summary>${caption}</summary><ul class="call-stack">${nested}</ul></details>` : `<div class="call-frame">${caption}</div>`;
    }).join('');
  }
  const callPath = callFrames(graph.root);
  const logLine = n => `[${n.id}] ${n.kind} · ${n.location || n.sourceName || n.source}:${n.line}${n.callee ? ` · calls ${n.callee}${n.possible ? ' (possible target)' : ''}` : ''}\n  ${n.text}`;
  const analysisLog = [
    'VALUE ORIGIN — STATIC ACE ANALYSIS',
    graph.notice,
    '', 'ACE SOURCE CLOSURE:',
    ...(graph.sourceClosure || []).map(item => `${item.objectType || '?'} ${item.objectName || item.name} · ${item.name}`),
    '', 'NODES (selected variable backwards):',
    ...graph.nodes.map(logLine),
    '', 'DEPENDENCIES (source → consumer):',
    ...graph.edges.map(e => `${e.from} → ${e.to}  [${e.label}]`)
  ].join('\n');
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  button{width:100%;text-align:left;background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border:1px solid var(--vscode-focusBorder);padding:8px;cursor:pointer;white-space:normal;overflow:auto;max-height:85px}
  pre{white-space:pre-wrap}strong{font-family:var(--vscode-editor-font-family)}
  .children{border-left:1px solid var(--vscode-panel-border);margin-left:8px;padding-left:16px}.node,.leaf{margin:8px 0;padding:6px;background:var(--vscode-editorWidget-background)}summary{cursor:pointer;overflow-wrap:anywhere}code{white-space:pre-wrap;font-family:var(--vscode-editor-font-family)}.location{width:auto;max-width:100%;padding:2px 5px;margin-left:6px;color:var(--vscode-textLink-foreground);border-color:var(--vscode-panel-border)}.edge,small{color:var(--vscode-descriptionForeground)}.unknown,.boundary,.warning{border-left:3px solid var(--vscode-editorWarning-foreground);padding-left:10px}.call-frame{margin:6px 0;padding:6px 8px;border-left:2px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.call-stack{margin:6px 0 0 10px;padding-left:12px;border-left:1px solid var(--vscode-panel-border);list-style:none}.analysis-log{max-height:560px;overflow:auto;user-select:text;padding:12px;background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-panel-border)}
  </style></head><body><h2>Value origin — ACE backward analysis</h2><p>${escape(graph.notice)}</p><p>${graph.truncated ? 'Graph limit reached; analysis is incomplete.' : ''} Expand dependencies and click a source location to inspect the calculation. Ctrl+Click opens it beside the current editor.</p>
  ${(graph.warnings || []).map(w => `<p class="warning">${escape(w)}</p>`).join('')}
  ${(graph.skipped || []).length ? `<p class="edge">System dependencies were kept as analysis boundaries: ${escape(graph.skipped.join(', '))}</p>` : ''}
  <details><summary>ACE source closure (${(graph.sourceClosure || []).length})</summary><p class="edge">These are the exact objects whose ACE index was loaded for this analysis. Missing factory or implementation here explains an unresolved call.</p><pre class="analysis-log">${escape((graph.sourceClosure || []).map(item => `${item.objectType || '?'} ${item.objectName || item.name} · ${item.name}`).join('\n') || 'No ACE sources were loaded.')}</pre></details>
  <details open><summary>Static call stack contributing to the selected value</summary><div class="call-stack">${callPath || '<p>No resolved calls.</p>'}</div></details>
  <h3>Backward dependencies</h3>${dependencyTree}
  <details><summary>Copyable analysis log</summary><p class="edge">Select text and copy it with Ctrl+C.</p><pre class="analysis-log">${escape(analysisLog)}</pre></details>
  <script nonce="${nonce}">const api=acquireVsCodeApi();document.addEventListener('click',e=>{const b=e.target.closest('button[data-node]');if(b)api.postMessage({node:b.dataset.node,source:b.dataset.source,line:Number(b.dataset.line)||0,openBeside:e.ctrlKey||e.metaKey});});</script></body></html>`;
}
function register(vscode, context, getSources) {
  context.subscriptions.push(vscode.commands.registerCommand('vertex.valueOrigin', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) throw new Error('Select a variable in an ABAP source editor.');
      const variable = variableAt(editor.document.getText(), editor.document.offsetAt(editor.selection.active));
      if (!variable) throw new Error('Place the cursor on a variable.');
      const target = { source: editor.document.uri.toString(), line: editor.selection.active.line + 1, column: editor.selection.active.character, variable };
      const loaded = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Value origin — ACE call index', cancellable: true },
        (progress, token) => getSources(editor.document, target, name => progress.report({ message: name }), () => token.isCancellationRequested));
      const sources = loaded.sources, originViewColumn = editor.viewColumn || vscode.ViewColumn.One;
      const graph = analyze(sources, loaded.target);
      graph.warnings = loaded.warnings;
      graph.skipped = loaded.skipped;
      graph.sourceClosure = sources.map(source => ({ name: source.name, objectName: source.aceOwner || source.objectName, objectType: source.aceOwner ? source.aceOwnerType : source.objectType }));
      graph.nodes.forEach(n => { n.sourceName = sources.find(s => s.id === n.source)?.name || n.source; });
      const panel = vscode.window.createWebviewPanel('vertex.valueOrigin', 'Value origin', vscode.ViewColumn.Beside, { enableScripts: true });
      panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'));
      panel.webview.onDidReceiveMessage(async message => {
        const n = graph.nodes.find(n => message && n.id === message.node);
        if (!n) return;
        const source = sources.find(s => s.id === (message.source || n.source)); if (!source) return;
        const opened = await loaded.openSource(source, { ...n, line: message.line || n.line });
        const document = opened.document, line = message.line || opened.line || n.line;
        const at = new vscode.Position(Math.min(document.lineCount - 1, line - 1), 0);
        await vscode.window.showTextDocument(document, { viewColumn: message.openBeside ? vscode.ViewColumn.Beside : originViewColumn,
          selection: new vscode.Range(at, at), preview: !message.openBeside });
      });
    } catch (e) { vscode.window.showErrorMessage('VERTEX: ' + e.message); }
  }));
}
module.exports = { register, html };
