"use strict";
const { analyze, mermaid, variableAt } = require('./value-origin');
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function html(graph, nonce) {
  // Local SVG: no CDN, network, Mermaid execution or source-defined links.
  const width = 1100, row = 100;
  const positions = new Map(graph.nodes.map((n, i) => [n.id, { x: 190, y: i * row + 20 }]));
  const paths = graph.edges.map((e, i) => {
    const a = positions.get(e.from), b = positions.get(e.to), x = 20 + i % 15 * 9;
    return `<path d="M190 ${a.y + 25} H${x} V${b.y + 25} H185" marker-end="url(#arrow)"><title>${escape(e.label)}</title></path>`;
  }).join('');
  const cards = graph.nodes.map(n => {
    const pos = positions.get(n.id);
    return `<foreignObject x="${pos.x}" y="${pos.y}" width="890" height="90"><div xmlns="http://www.w3.org/1999/xhtml"><button data-node="${n.id}">${escape(n.kind)} · ${escape(n.location || n.sourceName || n.source)}:${n.line}${n.callee ? `<br/><small>calls ${escape(n.callee)}${n.possible ? ' (possible)' : ''}</small>` : ''}<br/><strong>${escape(n.text)}</strong></button></div></foreignObject>`;
  }).join('');
  const byId = new Map(graph.nodes.map(n => [n.id, n])), expanded = new Set();
  function tree(id, depth = 0, label = '') {
    const n = byId.get(id); if (!n) return '';
    const caption = `<span class="edge">${escape(label)}</span> <code>${escape(n.text)}</code> <button class="location" data-node="${n.id}">${escape(n.location || n.sourceName || n.source)}:${n.line}</button>`;
    if (expanded.has(id)) return `<div class="leaf">↳ ${caption} <small>shared dependency</small></div>`;
    expanded.add(id);
    const children = graph.edges.filter(e => e.to === id);
    if (!children.length) return `<div class="leaf ${n.kind}">${caption}</div>`;
    return `<details class="node" ${depth < 4 ? 'open' : ''}><summary>${caption}</summary><div class="children">${children.map(e => tree(e.from, depth + 1, e.label)).join('')}</div></details>`;
  }
  const dependencyTree = tree(graph.root);
  const callPath = (graph.calls || []).map(c => {
    const at = graph.nodes.find(n => n.source === c.source && n.line === c.line);
    return `<li><code>${escape(c.caller)} → ${escape(c.callees.join(' | ') || c.method + ' (unresolved)')}</code>${c.possible ? ' <span class="edge">possible targets</span>' : ''} ${at ? `<button class="location" data-node="${at.id}">line ${c.line}</button>` : ''}</li>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  button{width:100%;text-align:left;background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border:1px solid var(--vscode-focusBorder);padding:8px;cursor:pointer;white-space:normal;overflow:auto;max-height:85px}
  path{fill:none;stroke:var(--vscode-descriptionForeground)}polygon{fill:var(--vscode-descriptionForeground)}pre{white-space:pre-wrap}strong{font-family:var(--vscode-editor-font-family)}
  .children{border-left:1px solid var(--vscode-panel-border);margin-left:8px;padding-left:16px}.node,.leaf{margin:8px 0;padding:6px;background:var(--vscode-editorWidget-background)}summary{cursor:pointer;overflow-wrap:anywhere}code{white-space:pre-wrap;font-family:var(--vscode-editor-font-family)}.location{width:auto;max-width:100%;padding:2px 5px;margin-left:6px;color:var(--vscode-textLink-foreground);border-color:var(--vscode-panel-border)}.edge,small{color:var(--vscode-descriptionForeground)}.unknown,.boundary,.warning{border-left:3px solid var(--vscode-editorWarning-foreground);padding-left:10px}li{margin:8px 0}.diagram{overflow:auto}
  </style></head><body><h2>Value origin — ACE backward analysis</h2><p>${escape(graph.notice)}</p><p>${graph.truncated ? 'Graph limit reached; analysis is incomplete.' : ''} Expand dependencies and click a source location to inspect the calculation.</p>
  ${(graph.warnings || []).map(w => `<p class="warning">${escape(w)}</p>`).join('')}
  ${(graph.skipped || []).length ? `<p class="edge">System dependencies were kept as analysis boundaries: ${escape(graph.skipped.join(', '))}</p>` : ''}
  <details open><summary>Call path contributing to the selected value</summary><ul>${callPath || '<li>No resolved calls.</li>'}</ul></details>
  <h3>Backward dependencies</h3>${dependencyTree}
  <details><summary>Full dependency diagram</summary><div class="diagram"><svg width="${width}" height="${graph.nodes.length * row + 30}"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><polygon points="0 0, 7 3, 0 6"/></marker></defs>${paths}${cards}</svg></div></details>
  <details><summary>Mermaid text</summary><pre>${escape(mermaid(graph))}</pre></details>
  <script nonce="${nonce}">const api=acquireVsCodeApi();document.addEventListener('click',e=>{const b=e.target.closest('button[data-node]');if(b)api.postMessage({node:b.dataset.node});});</script></body></html>`;
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
      const sources = loaded.sources, documents = new Map(sources.map(s => [s.id, s.document]));
      const graph = analyze(sources, loaded.target);
      graph.warnings = loaded.warnings;
      graph.skipped = loaded.skipped;
      graph.nodes.forEach(n => { n.sourceName = sources.find(s => s.id === n.source)?.name || n.source; });
      const panel = vscode.window.createWebviewPanel('vertex.valueOrigin', 'Value origin', vscode.ViewColumn.Beside, { enableScripts: true });
      panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'));
      panel.webview.onDidReceiveMessage(async message => {
        const n = graph.nodes.find(n => message && n.id === message.node);
        if (!n) return;
        const document = documents.get(n.source); if (!document) return;
        const at = new vscode.Position(Math.min(document.lineCount - 1, n.line - 1), 0);
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(at, at), preview: false });
      });
    } catch (e) { vscode.window.showErrorMessage('VERTEX: ' + e.message); }
  }));
}
module.exports = { register, html };
