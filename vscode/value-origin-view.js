"use strict";
const { analyze, variableAt } = require('./value-origin');
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ACE method includes start at line 1, whereas the editable class document
// contains every method.  openSource translates the include position to that
// document; never replace its answer with the include-local line.
const navigationLine = (opened, requestedLine) => opened?.line || requestedLine;
function html(graph, nonce, mermaidSource = '', cspSource = '') {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const scenarioChoices = (graph.scenarios || []).flatMap(group => group.choices.map(choice => choice.name));
  const scenarioOf = n => scenarioChoices.find(name => n.kind === 'value' && String(n.text).toUpperCase() === name ||
    n.kind === 'input' && String(n.text).toUpperCase().includes('PARAMETERS ' + name)) || '';
  function tree(id, depth = 0, label = '', parent = null, ancestors = new Set()) {
    const n = byId.get(id); if (!n) return '';
    const transfer = n.componentTransfer ? ` <span class="edge">transfers ${escape(n.component.slice(1))}</span>` : '';
    const samePlace = parent && parent.location === n.location && parent.line === n.line;
    const scenario = scenarioOf(n), scenarioAttr = scenario ? ` data-scenario="${scenario}"` : '';
    const place = samePlace ? '' : ` <button class="location" title="Open source here; Ctrl+Click opens beside" data-node="${n.id}">${escape(n.location || n.sourceName || n.source)}:${n.line}</button>`;
    const caption = `<span class="edge">${escape(label)}</span> <code>${escape(n.text)}</code>${transfer}${place}`;
    if (ancestors.has(id)) return `<div class="leaf"${scenarioAttr}>↳ ${caption} <small>cyclic dependency</small></div>`;
    const nextAncestors = new Set(ancestors); nextAncestors.add(id);
    const children = graph.edges.filter(e => e.to === id);
    // RETURNING is a transport detail between two variables. It is useful in
    // the audit log, but it must not become a visual level in the result.
    if (n.kind === 'call' && n.text.startsWith('RETURNING ')) return children.map(e => tree(e.from, depth, e.label, n, nextAncestors)).join('');
    if (!children.length) return `<div class="leaf ${n.kind}"${scenarioAttr}>${caption}</div>`;
    return `<details class="node" data-node="${n.id}"${scenarioAttr}><summary>${caption}</summary><div class="children">${children.map(e => tree(e.from, depth + 1, e.label, n, nextAncestors)).join('')}</div></details>`;
  }
  const dependencyTree = tree(graph.root);
  // The BSE graph is discovered backwards, but the primary presentation is
  // an execution flow. Keep only operations that change data or move it
  // across a call; values merely entering an operation are not steps.
  const executionKinds = new Set(['calculation', 'select', 'call', 'parameter']);
  const executionIds = new Set(graph.nodes.filter(n => executionKinds.has(n.kind) || n.id === graph.root).map(n => n.id));
  const executionEdges = [], executionSeen = new Set();
  for (const start of executionIds) {
    const queue = [start], visited = new Set([start]);
    while (queue.length) {
      const from = queue.shift();
      for (const edge of graph.edges.filter(e => e.from === from)) {
        if (executionIds.has(edge.to)) {
          const key = start + '>' + edge.to + ':' + edge.label;
          if (start !== edge.to && !executionSeen.has(key)) { executionSeen.add(key); executionEdges.push({ from: start, to: edge.to, label: edge.label }); }
        } else if (!visited.has(edge.to)) { visited.add(edge.to); queue.push(edge.to); }
      }
    }
  }
  const executionOrder = (left, right) => {
    const a = byId.get(typeof left === 'string' ? left : left.from), b = byId.get(typeof right === 'string' ? right : right.from);
    return String(a?.source).localeCompare(String(b?.source)) || (a?.line || 0) - (b?.line || 0) || String(a?.text).localeCompare(String(b?.text));
  };
  const executionChildren = id => executionEdges.filter(edge => edge.from === id).sort((left, right) => {
    const a = byId.get(left.to), b = byId.get(right.to);
    return String(a?.source).localeCompare(String(b?.source)) || (a?.line || 0) - (b?.line || 0) || String(a?.text).localeCompare(String(b?.text));
  });
  const executionTargets = new Set(executionEdges.map(edge => edge.to));
  const executionLabel = n => n.kind === 'parameter' ? 'parameter transfer' : n.kind === 'select' ? 'data change (SELECT)' : n.kind === 'call' ? 'call / return' : 'calculated';
  function executionNode(id, ancestors = new Set()) {
    const n = byId.get(id); if (!n) return '';
    const caption = `<span class="edge">${executionLabel(n)}</span> <code>${escape(n.text)}</code> <button class="location" title="Open source here; Ctrl+Click opens beside" data-node="${n.id}">${escape(n.location || n.sourceName || n.source)}:${n.line}</button>`;
    if (ancestors.has(id)) return `<div class="leaf">↳ ${caption} <small>cyclic flow</small></div>`;
    const next = new Set(ancestors); next.add(id);
    const children = executionChildren(id);
    if (!children.length) return `<div class="leaf ${n.kind}">${caption}</div>`;
    return `<details class="node" data-node="${n.id}"><summary>${caption}</summary><div class="children">${children.map(edge => executionNode(edge.to, next)).join('')}</div></details>`;
  }
  const executionRoots = [...executionIds].filter(id => !executionTargets.has(id)).sort(executionOrder);
  const executionTree = executionRoots.map(id => executionNode(id)).join('') || dependencyTree;
  const executionCalls = (graph.calls || []).filter(call => call.transformsSelectedValue);
  const calledTargets = new Set(executionCalls.flatMap(call => (call.targets || []).map(target => target.label)));
  const entryCalls = executionCalls.filter(call => !calledTargets.has(call.caller));
  const executionEntry = entryCalls.map(call => {
    const targets = (call.targets || []).map(target => target.label).join(' | ') || call.callees?.join(' | ') || call.method;
    const statement = call.text || call.caller + ' → ' + targets;
    return `<div class="flow-row included"><span class="edge">call</span> <code>${escape(statement)}</code> <button class="location" title="Open calling statement; Ctrl+Click opens beside" data-node="" data-source="${escape(call.source)}" data-line="${call.line}">${escape(call.caller)}:${call.line}</button> <span class="edge">→ ${escape(targets)}</span></div>`;
  }).join('');
  const aceExecution = (graph.executionFlow || []).map(step => {
    const indent = step.depth ? ` style="margin-left:${step.depth * 20}px"` : '';
    if (step.type === 'call') {
      const targets = (step.targets || []).map(target => target.label).join(' | ');
      return `<div class="flow-row included"${indent}><code>${escape(step.text || step.caller)}</code> <button class="location" data-node="" data-source="${escape(step.source)}" data-line="${step.line}">${escape(step.caller)}:${step.line}</button> <span class="edge">→ ${escape(targets)}</span></div>`;
    }
    return `<div class="flow-row included"${indent}><code>${escape(step.text)}</code> <button class="location" data-node="" data-source="${escape(step.source)}" data-line="${step.line}">${escape(step.scope)}:${step.line}</button></div>`;
  }).join('');
  const scenarioControls = (graph.scenarios || []).map(group => `<fieldset class="scenario"><legend>Simulate radio group ${escape(group.group)}</legend><label><input type="radio" name="scenario-${escape(group.group)}" value="" checked> All branches</label>${group.choices.map(choice => `<label><input type="radio" name="scenario-${escape(group.group)}" value="${escape(choice.name)}"> ${escape(choice.label)}</label>`).join('')}</fieldset>`).join('');
  // Call depth is not graph depth. The dependency graph also contains field
  // copies and actual/formal bindings, so walking its edges made a misleading
  // pseudo-stack with duplicates. Build the stack from calls only: a call is
  // nested strictly below a call whose resolved target is its caller.
  const callFrames = () => {
    const calls = (graph.calls || []).filter(call => call.transformsSelectedValue).sort((a, b) => a.line - b.line || a.caller.localeCompare(b.caller));
    const targetNames = new Set(calls.flatMap(call => (call.targets || []).map(target => target.label)));
    const roots = calls.filter(call => !targetNames.has(call.caller));
    const frame = (found, depth = 0, ancestors = new Set()) => {
      const key = `${found.source}:${found.line}:${found.caller}:${found.method}`;
      if (ancestors.has(key)) return '<div class="call-frame"><small>recursive call</small></div>';
      const nextAncestors = new Set(ancestors); nextAncestors.add(key);
      // A call-stack row describes a dispatch. Its link therefore opens the
      // resolved implementation, never the interface METHODS declaration or
      // merely the caller. Each alternative has its own target link.
      const targetLinks = (found?.targets || []).map(target =>
        `<button class="location" title="Open the contributing calculation; Ctrl+Click opens beside" data-node="" data-source="${escape(target.source)}" data-line="${target.line}">${escape(target.label)}</button>`).join(' ');
      const fallback = found.callees?.join(' | ') || found.method + ' (unresolved)';
      const caption = `<code>${escape(found.caller)} → ${targetLinks || escape(fallback)}</code>${found.possible ? ' <span class="edge">possible targets</span>' : ''}`;
      const targetSet = new Set((found.targets || []).map(target => target.label));
      const children = calls.filter(call => targetSet.has(call.caller));
      const nested = children.map(child => frame(child, depth + 1, nextAncestors)).join('');
      return nested ? `<details class="call-frame" ${depth < 2 ? 'open' : ''}><summary>${caption}</summary><ul class="call-stack">${nested}</ul></details>` : `<div class="call-frame">${caption}</div>`;
    };
    return roots.map(root => frame(root)).join('');
  };
  const callPath = callFrames();
  const flow = graph.flow || [], byFlowId = new Map(flow.map(row => [row.id, row]));
  const flowRow = row => `<div class="flow-row ${row.included ? 'included' : 'excluded'}"><button class="location" title="Open ACE Flow point" data-node="" data-source="${escape(row.source)}" data-line="${row.line}">${escape(row.scope)}:${row.line}</button> <code>${escape(row.changed)}</code> ${row.included ? 'included' : 'excluded'} <span class="edge">— ${escape(row.reason)}${row.links?.length ? ` Depends on: ${escape(row.links.map(link => link.name).join(', '))}.` : ''}</span></div>`;
  const flowRows = rows => rows.map(flowRow).join('');
  const childIds = new Set(flow.flatMap(row => (row.links || []).map(link => link.pointId).filter(Boolean)));
  const flowTree = (row, seen = new Set(), depth = 0) => {
    if (seen.has(row.id)) return flowRow(row);
    const next = new Set(seen); next.add(row.id);
    const dependencies = (row.links || []).map(link => link.pointId ? flowTree(byFlowId.get(link.pointId), next, depth + 1) : `<div class="flow-input"><code>${escape(link.name)}</code> <span class="edge">input / no calculation point</span></div>`).join('');
    const condition = row.condition ? `<details class="flow-condition"><summary>${escape(row.condition.text)} <span class="edge">execution condition</span></summary><div class="flow-children">${row.condition.inputs.map(input => `<div class="flow-input"><code>${escape(input)}</code></div>`).join('')}</div></details>` : '';
    const children = dependencies + condition;
    return children ? `<details class="flow-node" ${depth === 0 ? 'open' : ''}><summary>${flowRow(row)}</summary><div class="flow-children">${children}</div></details>` : flowRow(row);
  };
  const result = flow.filter(row => row.included && !childIds.has(row.id)).map(row => flowTree(row)).join('');
  const selected = `<details class="flow-node" open><summary><span class="flow-target"><strong>Selected value</strong> <code>${escape(graph.selectedVariable || '?')}</code> <span class="edge">— the backward slice starts here${graph.selectedLine ? ` (line ${graph.selectedLine})` : ''}.</span></span></summary><div class="flow-children">${result || '<p>No ACE Flow point was reached.</p>'}</div></details>`;
  const fullLog = (graph.flowLog || []).map(row => `<div class="flow-row included"><button class="location" title="Open traversed point" data-node="" data-source="${escape(row.source)}" data-line="${row.line}">${escape(row.scope)}:${row.line}</button> <code>${escape(row.text)}</code> <span class="edge">— ${escape(row.reason)}</span></div>`).join('');
  const flowLogText = (graph.flowLog || []).map(row => `${row.scope}:${row.line} ${row.text} — ${row.reason}`).join('\n');
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
  const mermaidNodes = graph.nodes.slice(0, 180);
  const mermaidIds = new Set(mermaidNodes.map(node => node.id));
  const mermaidLabel = value => String(value || '').replaceAll('"', "'").replaceAll('\n', ' ');
  const mermaidText = ['flowchart TD', ...mermaidNodes.map(node =>
    `  ${node.id}["${mermaidLabel(node.location || node.source)}\\n${mermaidLabel(node.text)}"]`),
    ...graph.edges.filter(edge => mermaidIds.has(edge.from) && mermaidIds.has(edge.to)).map(edge =>
      `  ${edge.from} -->|${mermaidLabel(edge.label)}| ${edge.to}`),
    ...mermaidNodes.map(node => `  click ${node.id} bseMermaidOpen "Open source"`),
    graph.nodes.length > mermaidNodes.length ? '  note["Graph is limited to 180 nodes"]' : ''].filter(Boolean).join('\n');
  const mermaidGraph = { root: graph.root, nodes: mermaidNodes.map(node => ({ id: node.id, location: node.location || node.source,
    line: node.line, text: node.text, scenario: scenarioOf(node) })), edges: graph.edges.filter(edge => mermaidIds.has(edge.from) && mermaidIds.has(edge.to)) };
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}"><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  button{width:100%;text-align:left;background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border:1px solid var(--vscode-focusBorder);padding:8px;cursor:pointer;white-space:normal;overflow:auto;max-height:85px}
  pre{white-space:pre-wrap}strong{font-family:var(--vscode-editor-font-family)}
  .children{border-left:1px solid var(--vscode-panel-border);margin-left:8px;padding-left:16px}.node,.leaf{margin:8px 0;padding:6px;background:var(--vscode-editorWidget-background)}summary{cursor:pointer;overflow-wrap:anywhere}code{white-space:pre-wrap;font-family:var(--vscode-editor-font-family)}.location{width:auto;max-width:100%;padding:2px 5px;margin-left:6px;color:var(--vscode-textLink-foreground);border-color:var(--vscode-panel-border)}.edge,small{color:var(--vscode-descriptionForeground)}.unknown,.boundary,.warning{border-left:3px solid var(--vscode-editorWarning-foreground);padding-left:10px}.call-frame{margin:6px 0;padding:6px 8px;border-left:2px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.call-stack{margin:6px 0 0 10px;padding-left:12px;border-left:1px solid var(--vscode-panel-border);list-style:none}.analysis-log{max-height:560px;overflow:auto;user-select:text;padding:12px;background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-panel-border)}.flow-target{margin:5px 0;padding:8px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.flow-node{margin:3px 0}.flow-node>summary{list-style-position:outside}.flow-row{margin:3px 0;padding:5px;border-left:3px solid var(--vscode-descriptionForeground)}.flow-row.included{border-left-color:var(--vscode-testing-iconPassed);background:var(--vscode-diffEditor-insertedLineBackground)}.flow-row.excluded{opacity:.75}.flow-children{margin-left:18px;border-left:1px solid var(--vscode-panel-border);padding-left:10px}.flow-input{padding:4px;color:var(--vscode-descriptionForeground)}.flow-condition{margin:3px 0;color:var(--vscode-descriptionForeground)}.help{position:absolute;right:8px;top:8px;z-index:50}.help summary{list-style:none;border:1px solid var(--vscode-focusBorder);padding:2px 8px;font-weight:bold}.help>div{display:none}.help[open]{position:fixed;inset:0;z-index:200;background:var(--vscode-editor-background);padding:20px;overflow:auto}.help[open] summary{float:right}.help[open]>div{display:block;clear:both;max-width:900px;margin:48px auto;padding:20px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border)}.debug-toggle{display:none}.debug-button{float:right;margin:8px;border:1px solid var(--vscode-focusBorder);padding:2px 8px}.debug-only{display:none}.debug-toggle:checked~.debug-only{display:block}.scenario{margin:8px 0;border:1px solid var(--vscode-panel-border)}.scenario label{margin:0 8px}.bse-workspace{display:grid;grid-template-rows:minmax(150px,45%) 7px minmax(220px,1fr);height:calc(100vh - 125px);min-height:560px;margin-top:8px}.bse-tree-pane,.bse-diagram-pane{min-height:0;overflow:auto}.bse-splitter{background:var(--vscode-panel-border);cursor:row-resize;position:relative}.bse-splitter:after{content:'';position:absolute;top:2px;bottom:2px;left:25%;right:25%;border-top:1px solid var(--vscode-descriptionForeground)}.mermaid-controls{margin:6px 0}.mermaid-controls button{width:auto;margin-right:4px}.mermaid-viewport{height:calc(100% - 46px);min-height:180px;overflow:auto;border:1px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background)}.mermaid-canvas{display:inline-block;padding:12px;transform-origin:top left}.mermaid-canvas svg{max-width:none}.mermaid-panel{height:100%}.mermaid-panel.fullscreen{position:fixed;inset:0;z-index:100;background:var(--vscode-editor-background);padding:12px}.mermaid-panel.fullscreen .mermaid-viewport{height:calc(100% - 48px)}
  </style></head><body><details class="help"><summary aria-label="Value origin help">?</summary><div><strong>Value origin</strong> traces static source dependencies backwards across resolved calls. It proves source relationships, not runtime values: loop order, database contents and unknown dispatches remain boundaries. Expand a branch to inspect its inputs; click a source location to open it, Ctrl+Click to open beside. <strong>All branches</strong> shows every static alternative. Choosing a selection-screen radio button simulates that exclusive choice and hides other radio branches. Mermaid shows the same filtered dependency set; use the mouse wheel to zoom and drag empty space to pan. ${(graph.skipped || []).length ? `<p>Analysis boundaries kept outside the graph: ${escape(graph.skipped.join(', '))}</p>` : ''}</div></details><input id="debug-toggle" class="debug-toggle" type="checkbox"><label class="debug-button" for="debug-toggle" title="Show technical analysis sections">🐞</label><h2>Value origin — ACE backward analysis</h2>
  ${(graph.warnings || []).map(w => `<p class="warning">${escape(w)}</p>`).join('')}
  ${scenarioControls ? `<details class="scenario-panel"><summary>Simulate selection screen</summary>${scenarioControls}</details>` : ''}<div id="bse-workspace" class="bse-workspace"><div id="bse-tree-pane" class="bse-tree-pane"><details><summary>Execution flow — changes and parameter transfers to ${escape(graph.selectedVariable || '?')}</summary>${aceExecution || executionEntry + executionTree}</details></div><div id="bse-splitter" class="bse-splitter" role="separator" aria-label="Resize dependency diagram" aria-orientation="horizontal"></div><div id="bse-diagram-pane" class="bse-diagram-pane"><details open><summary>Mermaid — flow to the selected value</summary><div id="mermaid-panel" class="mermaid-panel"><div class="mermaid-controls"><button id="mermaid-out">−</button><button id="mermaid-in">+</button><button id="mermaid-fit">Fit</button><button id="mermaid-full">Full screen</button></div><div id="mermaid-viewport" class="mermaid-viewport"><div id="mermaid-graph" class="mermaid-canvas"></div></div></div></details></div></div>
  <script id="mermaid-data" type="application/json">${JSON.stringify(mermaidGraph).replaceAll('<', '\\u003c')}</script><script nonce="${nonce}">
  (()=>{
    const host=document.getElementById('mermaid-graph'),graph=JSON.parse(document.getElementById('mermaid-data').textContent),workspace=document.getElementById('bse-workspace'),treePane=document.getElementById('bse-tree-pane'),splitter=document.getElementById('bse-splitter');
    // During flow validation render the complete selected slice. Tree state
    // must not hide steps from the diagram.
    const open=()=>new Set(graph.nodes.map(node=>node.id));
    let sequence=0,generation=0,splitDrag;
    const pathToRoot=start=>{const queue=[[start]],visited=new Set([start]);while(queue.length){const path=queue.shift(),last=path[path.length-1];if(last===graph.root)return path;graph.edges.filter(edge=>edge.from===last).forEach(edge=>{if(!visited.has(edge.to)){visited.add(edge.to);queue.push(path.concat(edge.to));}});}return [start];};
    const rebuild=()=>{
      const current=++generation,opened=open(),shown=new Set(),edgeKeys=new Set(),active=document.querySelector('.scenario input:checked')?.value||'';
      opened.forEach(id=>{const path=pathToRoot(id);path.forEach(node=>shown.add(node));for(let index=0;index<path.length-1;index++)edgeKeys.add(path[index]+'>'+path[index+1]);});
      const nodes=graph.nodes.filter(node=>shown.has(node.id)&&(!active||!node.scenario||node.scenario===active)),ids=new Set(nodes.map(node=>node.id)),aliases=new Map(),compact=[];
      nodes.forEach(node=>{const address=(node.location||'')+':'+(node.line||0),known=aliases.get(address);if(known){aliases.set(node.id,known.id);if(String(known.text).startsWith('RETURNING ')&&!String(node.text).startsWith('RETURNING '))known.text=node.text;}else{const visible={...node};aliases.set(address,visible);aliases.set(node.id,visible.id);compact.push(visible);}});
      const compactEdges=[];
      graph.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to)&&edgeKeys.has(edge.from+'>'+edge.to)).forEach(edge=>{const from=aliases.get(edge.from),to=aliases.get(edge.to);if(from&&to&&from!==to&&!compactEdges.some(item=>item.from===from&&item.to===to&&item.label===edge.label))compactEdges.push({from,to,label:edge.label});});
      host.style.display=compact.length?'inline-block':'none';if(!compact.length||typeof mermaid==='undefined')return;
      // BSE finds this slice backwards, but the diagram is a normal execution
      // flow: source values enter calls and calculations, then reach result.
      const text=['flowchart TD',...compact.map(node=>'  '+node.id+'["'+String(node.location).replaceAll('"',"'")+'\\n'+String(node.text).replaceAll('"',"'")+'"]'),...compactEdges.map(edge=>'  '+edge.from+' -->|'+edge.label+'| '+edge.to),...compact.map(node=>'  click '+node.id+' bseMermaidOpen "Open source"')].join('\\n');
      mermaid.render('bse-expanded-'+(++sequence),text).then(result=>{if(current!==generation)return;host.innerHTML=result.svg;result.bindFunctions&&result.bindFunctions(host);document.dispatchEvent(new Event('bse:mermaid-rendered'));}).catch(error=>{if(current===generation)host.textContent='Mermaid: '+error.message;});
    };
    splitter.addEventListener('pointerdown',event=>{splitDrag={y:event.clientY,top:treePane.getBoundingClientRect().height};splitter.setPointerCapture(event.pointerId);});
    splitter.addEventListener('pointermove',event=>{if(!splitDrag)return;const available=workspace.clientHeight-7,top=Math.max(150,Math.min(available-220,splitDrag.top+event.clientY-splitDrag.y));workspace.style.gridTemplateRows=top+'px 7px minmax(220px,1fr)';});
    splitter.addEventListener('pointerup',()=>{splitDrag=null;});splitter.addEventListener('pointercancel',()=>{splitDrag=null;});
    document.querySelectorAll('details.node').forEach(node=>node.addEventListener('toggle',rebuild));document.addEventListener('bse:scenario',rebuild);document.addEventListener('bse:mermaid-ready',rebuild);
  })();</script>
  <details class="debug-only"><summary>BSE dependency tree (technical)</summary>${dependencyTree}</details><details class="debug-only"><summary>ACE source closure (${(graph.sourceClosure || []).length})</summary><p class="edge">These are the exact objects whose ACE index was loaded for this analysis. Missing factory or implementation here explains an unresolved call.</p><pre class="analysis-log">${escape((graph.sourceClosure || []).map(item => `${item.objectType || '?'} ${item.objectName || item.name} · ${item.name}`).join('\n') || 'No ACE sources were loaded.')}</pre></details>
  <details class="debug-only"><summary>Static call stack contributing to the selected value</summary><div class="call-stack">${callPath || '<p>No resolved calls.</p>'}</div></details>
  <details class="debug-only"><summary>ACE Flow traversal log (${(graph.flowLog || []).length})</summary><p class="edge">Only points reached while resolving the selected value are listed, with the edge that included each one.</p><button id="copy-flow" class="location">Copy log</button><div class="analysis-log">${fullLog || escape(analysisLog)}</div></details>
  ${mermaidSource ? `<script nonce="${nonce}" src="${mermaidSource}"></script>` : ''}<script nonce="${nonce}">const api=acquireVsCodeApi(),flowLog=${JSON.stringify(flowLogText).replaceAll('<', '\\u003c')};window.bseMermaidOpen=id=>api.postMessage({node:id});document.addEventListener('click',e=>{const b=e.target.closest('button[data-node]');if(b)api.postMessage({node:b.dataset.node,source:b.dataset.source,line:Number(b.dataset.line)||0,openBeside:e.ctrlKey||e.metaKey});});document.getElementById('copy-flow').addEventListener('click',async()=>{await navigator.clipboard.writeText(flowLog);document.getElementById('copy-flow').textContent='Copied';});const setScenario=active=>{document.querySelectorAll('[data-scenario]').forEach(node=>{node.hidden=!!active&&node.dataset.scenario!==active;if(node.hidden&&node.tagName==='DETAILS')node.open=false;});document.dispatchEvent(new Event('bse:scenario'));};document.querySelectorAll('.scenario input').forEach(input=>input.addEventListener('change',e=>setScenario(e.target.value)));const host=document.getElementById('mermaid-graph'),viewport=document.getElementById('mermaid-viewport'),panel=document.getElementById('mermaid-panel');let zoom=1,drag;const applyZoom=()=>{host.style.transform='scale('+zoom+')';host.style.marginRight=Math.max(0,(zoom-1)*host.offsetWidth)+'px';host.style.marginBottom=Math.max(0,(zoom-1)*host.offsetHeight)+'px';};const fit=()=>{const svg=host.querySelector('svg');if(!svg)return;const box=svg.viewBox.baseVal,width=box.width||svg.width.baseVal.value,height=box.height||svg.height.baseVal.value;zoom=Math.min(1,(viewport.clientWidth-32)/width,(viewport.clientHeight-70)/height);applyZoom();viewport.scrollLeft=0;viewport.scrollTop=0;};const changeZoom=amount=>{zoom=Math.max(.2,Math.min(3,zoom+amount));applyZoom();};document.getElementById('mermaid-out').onclick=()=>changeZoom(-.2);document.getElementById('mermaid-in').onclick=()=>changeZoom(.2);document.getElementById('mermaid-fit').onclick=fit;document.getElementById('mermaid-full').onclick=()=>{panel.classList.toggle('fullscreen');document.getElementById('mermaid-full').textContent=panel.classList.contains('fullscreen')?'Exit full screen':'Full screen';requestAnimationFrame(fit);};viewport.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.2,Math.min(3,zoom*Math.exp(-e.deltaY*.001)));applyZoom();},{passive:false});viewport.addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('g.node,button'))return;drag={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};});document.addEventListener('mousemove',e=>{if(!drag)return;viewport.scrollLeft=drag.left-(e.clientX-drag.x);viewport.scrollTop=drag.top-(e.clientY-drag.y);});document.addEventListener('mouseup',()=>{drag=null;});document.addEventListener('bse:mermaid-rendered',()=>requestAnimationFrame(fit));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('fullscreen')){panel.classList.remove('fullscreen');document.getElementById('mermaid-full').textContent='Full screen';requestAnimationFrame(fit);}});if(typeof mermaid==='undefined'){host.textContent='Mermaid library is unavailable.';}else{mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'dark',flowchart:{htmlLabels:false,useMaxWidth:false}});document.dispatchEvent(new Event('bse:mermaid-ready'));}</script></body></html>`;
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
      const mermaid = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'resources', 'mermaid.min.js')).toString() : '';
      panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'), mermaid, panel.webview.cspSource || '');
      panel.webview.onDidReceiveMessage(async message => {
        const n = graph.nodes.find(n => message && n.id === message.node);
        const source = sources.find(s => s.id === (message.source || n?.source)); if (!source) return;
        const requestedLine = message.line || n?.line || 1;
        const opened = await loaded.openSource(source, { ...(n || {}), line: requestedLine });
        const document = opened.document, line = navigationLine(opened, requestedLine);
        const at = new vscode.Position(Math.min(document.lineCount - 1, line - 1), 0);
        await vscode.window.showTextDocument(document, { viewColumn: message.openBeside ? vscode.ViewColumn.Beside : originViewColumn,
          selection: new vscode.Range(at, at), preview: !message.openBeside });
      });
    } catch (e) { vscode.window.showErrorMessage('VERTEX: ' + e.message); }
  }));
}
module.exports = { register, html, navigationLine };
