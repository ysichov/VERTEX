"use strict";
const { analyze, variableAt, literalAt, callsIn, variablePaths } = require('./value-origin');
const { pathRows, siteRows } = require('./value-origin-points');
const { formula, scopeStacks } = require('./value-origin-formula');
const { symbolic, formulaPane, expressionPane } = require('./value-origin-formula-html');
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// ACE method includes start at line 1, whereas the editable class document
// contains every method.  openSource translates the include position to that
// document; never replace its answer with the include-local line.
const navigationLine = (opened, requestedLine) => opened?.line || requestedLine;

/* The flow - tree, diagram, and the controls over both - is one script, shared
   with every VERTEX view that draws a flow. A webview loads it by address; with
   no address to give (a test, or a host that cannot serve files) the page
   carries the same file inline. One source either way. */
let flowScriptText = null;
function flowScript() {
  if (flowScriptText !== null) { return flowScriptText; }
  const fs = require('fs'), path = require('path');
  const places = [path.join(__dirname, 'resources', 'vertex-flow.js'),
    path.join(__dirname, '..', 'org.vertex.abap.ui', 'resources', 'vertex-flow.js')];
  for (const file of places) {
    try { return flowScriptText = fs.readFileSync(file, 'utf8'); } catch (error) { /* the next one */ }
  }
  throw new Error('vertex-flow.js was not found in ' + places.join(' or ') + '.');
}
// The flow's graph builder is shared with the debugger's flow path; a required module, from the packaged copy or the repository's.
function flowGraphBuilder() {
  const path = require('path');
  for (const file of [path.join(__dirname, 'resources', 'vertex-flow-graph.js'), path.join(__dirname, '..', 'org.vertex.abap.ui', 'resources', 'vertex-flow-graph.js')]) {
    try { return require(file); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') { throw error; } }
  }
  throw new Error('vertex-flow-graph.js was not found.');
}
// The flow builder and the ABAP control rules it needs, for the page to build a reading when it is asked for: from the
// packaged copy or the repository's. A host (Eclipse) hands the page its own instead.
const resourceTexts = new Map();
function resourceScript(name) {
  if (resourceTexts.has(name)) { return resourceTexts.get(name); }
  const fs = require('fs'), path = require('path');
  const places = [path.join(__dirname, 'resources', name), path.join(__dirname, '..', 'org.vertex.abap.ui', 'resources', name)];
  for (const file of places) {
    try { const text = fs.readFileSync(file, 'utf8'); resourceTexts.set(name, text); return text; } catch (error) { /* the next one */ }
  }
  throw new Error(name + ' was not found in ' + places.join(' or ') + '.');
}
// The magnifier every diagram has, loaded before the flow that uses it - the same way, by address or inline.
let lensScriptText = null;
function lensScript() {
  if (lensScriptText !== null) { return lensScriptText; }
  const fs = require('fs'), path = require('path');
  const places = [path.join(__dirname, 'resources', 'vertex-lens.js'),
    path.join(__dirname, '..', 'org.vertex.abap.ui', 'resources', 'vertex-lens.js')];
  for (const file of places) {
    try { return lensScriptText = fs.readFileSync(file, 'utf8'); } catch (error) { /* the next one */ }
  }
  throw new Error('vertex-lens.js was not found in ' + places.join(' or ') + '.');
}
/* A script carried in the page rather than loaded by address: its text must not close the tag it stands in. */
const inlineScript = (nonce, text) => `<script nonce="${nonce}">${String(text).replace(/<\/script/gi, '<\\/script')}</script>`;
/* `host` is for a host that cannot hand the page an address and has no files to read here - the Eclipse plugin runs
   this in its browser: the flow graph builder as an object, the scripts and the stylesheet as text, what the head
   adds (the theme), and a script defining acquireVsCodeApi for the page's messages. */
function html(graph, nonce, mermaidSource = '', cspSource = '', styleSource = '', flowSource = '', lensSource = '', host = null) {
  const scripts = (host && host.scripts) || {};
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
  const bseOperatorKeys = new Set((graph.boundedFlow || []).map(point => point.source + ':' + point.line));
  // Everything here is read off the flow, and the flow knows the call stack:
  // the resolved calls say which procedure reaches which. A procedure's depth
  // is how many calls away from the entry program it stands, and every node of
  // every Type is stamped with the depth of the procedure it belongs to, so
  // one control on the page can bound them all.
  const { stackOfScope, maxStack: scopeMax } = scopeStacks(graph);
  const maxStack = Math.max(scopeMax, ...(graph.executionFlow || []).map(step => step.depth || 0));
  const flowItems = (graph.executionFlow || []).map((step, index) => ({ step, index, bse: step.type === 'operation' && bseOperatorKeys.has(step.source + ':' + step.line), children: [] })), flowRoots = [], executionStack = [];
  for (const item of flowItems) {
    executionStack.length = Math.min(executionStack.length, item.step.depth + 1);
    const parent = executionStack[item.step.depth - 1];
    (parent ? parent.children : flowRoots).push(item);
    executionStack[item.step.depth] = item;
  }
  const sourceButton = item => `<button class="location code-location" title="Open source; Ctrl+Click opens beside" data-node="" data-source="${escape(item.step.source)}" data-line="${item.step.line}">&lt;/&gt;</button>`;
  const { bseById, canonical, stripData, dataNames, dataText, syntaxCode, symbolicExpression, dataFormula, codeFormula } = symbolic(graph);
  // The derivation is the shared algorithm's (value-origin-formula.js); this draws its tree.
  const derivation = formula(graph), formulaGraph = { nodes: derivation.nodes, edges: derivation.edges }, maxLevel = derivation.maxLevel;
  const formulaView = formulaPane(graph, derivation);
  // The slider has to reach the deepest row the tree actually drew, which is
  // further than the shallowest position a node is known at.
  const flowCode = step => {
    const text = codeFormula(step), targets = (step.targets || []).map(target => target.label).join(' | ');
    if (step.type !== 'call' || !targets) return text;
    const methods = (step.targets || []).map(target => String(target.label).split('->').at(-1).split('~').at(-1)).filter(Boolean);
    const pattern = methods.map(method => method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return pattern ? text.replace(new RegExp(`\\b[\\w-]+(?:-&gt;|=&gt;)(?:${pattern})\\b`, 'ig'), match => `<span class="flow-call" title="${escape(targets)}">${match}</span>`) : text;
  };
  const isEmptyConstructor = step => /^\s*(?:DATA\s*\(\s*)?[A-Za-z_]\w*(?:-[A-Za-z_]\w*)?\s*\)?\s*=\s*NEW\s+[A-Za-z_]\w*(?:=>[A-Za-z_]\w*)?\s*\(\s*\)\s*\.\s*$/i.test(step.text || step.caller || '');
  const executionItem = item => {
    const caption = `<span class="flow-row included${item.bse ? ' bse-operation' : ''}"><code><span class="flow-code">${flowCode(item.step)}</span><span class="flow-data">${dataFormula(item.step)}</span></code>${sourceButton(item)}</span>`;
    return item.children.length ? `<details class="execution-node" data-flow="${item.index}" data-stack="${item.step.depth ?? stackOfScope(item.step.scope || item.step.caller)}"><summary><span class="flow-toggle" aria-hidden="true">▶</span>${caption}</summary><div class="execution-children">${item.children.map(executionItem).join('')}</div></details>` : `<div class="execution-leaf${isEmptyConstructor(item.step) ? ' data-technical' : ''}" data-flow="${item.index}" data-stack="${item.step.depth ?? stackOfScope(item.step.scope || item.step.caller)}">${caption}</div>`;
  };
  const aceExecution = flowRoots.map(executionItem).join('');
  const bseFlow = (graph.fullFlow || graph.boundedFlow || graph.flow || []).slice().sort((left, right) => String(left.scope).localeCompare(String(right.scope)) || left.line - right.line);
  const byScope = new Map();
  bseFlow.forEach((point, index) => { const scope = point.scope || point.source; if (!byScope.has(scope)) byScope.set(scope, []); byScope.get(scope).push({ point, index }); });
  const bseFlowTree = [...byScope.entries()].map(([scope, items]) => {
    const [klass, method = 'GLOBAL'] = scope.split('→');
    return `<details class="bse-flow-class" open><summary><strong>${escape(klass)}</strong></summary><details class="bse-flow-method" open><summary>${escape(method)}</summary>${items.map(({ point, index }) => `<div class="flow-row included" data-bse-flow="${index}"><code>${escape(point.changed)}${point.dependencies?.length ? ` ← ${escape(point.dependencies.join(', '))}` : ''}</code><button class="location code-location" title="Open source; Ctrl+Click opens beside" data-node="bseflow${index}" data-source="${escape(point.source)}" data-line="${point.line}">&lt;/&gt;</button></div>`).join('')}</details></details>`;
  }).join('');
  const pipelineStatus = graph.pipeline ? `<div class="pipeline-status"><strong>${escape(graph.pipeline.caption)}</strong><br><code>SELECT step_no, modifier_class FROM ZLOG_PIPELINE WHERE scenario_id = '${escape(graph.pipeline.scenario)}' ORDER BY step_no</code><ol>${graph.pipeline.steps.map(step => `<li><code>${escape(step.step_no)} → ${escape(step.modifier_class)}</code></li>`).join('')}</ol></div>` : '';
  const scenarioControls = (graph.scenarios || []).map(group => `<fieldset class="scenario"><style>.scenario-choice .scenario-load{display:none}.scenario-choice:has(input:checked) .scenario-load{display:inline-block}.pipeline-status{margin:8px 0 0;padding:7px;border-left:3px solid var(--vscode-testing-iconPassed);background:var(--vscode-textCodeBlock-background)}.pipeline-status ol{margin:4px 0 0;padding-left:24px}</style><legend>Simulate radio group ${escape(group.group)}</legend><label><input type="radio" name="scenario-${escape(group.group)}" value="" checked> All branches</label>${group.choices.map(choice => `<span class="scenario-choice"><label><input type="radio" name="scenario-${escape(group.group)}" value="${escape(choice.name)}"> ${escape(choice.label)}</label><button class="location scenario-load" title="Read the configured pipeline for this scenario" data-node="scenario:${escape(choice.name)}">Load selected configuration</button></span>`).join('')}${pipelineStatus}</fieldset>`).join('');
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
  const traversalLogText = (graph.flowLog || []).map(row => `${row.scope}:${row.line} ${row.text} — ${row.reason}`).join('\n');
  const logLine = n => `[${n.id}] ${n.kind} · ${n.location || n.sourceName || n.source}:${n.line}${n.callee ? ` · calls ${n.callee}${n.possible ? ' (possible target)' : ''}` : ''}\n  ${n.text}`;
  const analysisLog = [
    'VALUE ORIGIN — STATIC ' + (graph.analysisEngine || 'ACE') + ' ANALYSIS',
    graph.notice,
    '', 'SOURCE CLOSURE:',
    ...(graph.sourceClosure || []).map(item => `${item.objectType || '?'} ${item.objectName || item.name} · ${item.name}`),
    '', 'NODES (selected variable backwards):',
    ...graph.nodes.map(logLine),
    '', 'DEPENDENCIES (source → consumer):',
    ...graph.edges.map(e => `${e.from} → ${e.to}  [${e.label}]`)
  ].join('\n');
  const assignedVariable = text => (String(text || '').match(/(?:DATA\s*\(\s*)?([A-Z_]\w*(?:-[A-Z_]\w*)?)\s*=/i) || [])[1] || '';
  const mermaidNodes = (graph.executionFlow || []).map((step, index) => ({
    id: 'flow' + index, location: step.type === 'call' ? step.caller : step.scope,
    line: step.line, text: step.text || step.caller, dataText: dataText(step), dataLabel: assignedVariable(dataText(step)),
    source: step.source, type: step.type, bse: step.type === 'operation' && bseOperatorKeys.has(step.source + ':' + step.line), variables: [...dataNames(step).calculated, ...dataNames(step).composed], depth: step.depth || 0
  }));
  const mermaidEdges = [], callerStack = [];
  mermaidNodes.forEach(node => {
    callerStack.length = Math.min(callerStack.length, node.depth + 1);
    const caller = callerStack[node.depth - 1];
    if (caller) mermaidEdges.push({ from: caller.id, to: node.id, label: node.line ? String(node.line) : '' });
    callerStack[node.depth] = node;
  });
  // The flow is drawn by the one builder the debugger's flow path uses; only where its rows come from differs - here the
  // analysis of the chosen value, there the analysis from a breakpoint.
  if (!graph.codeFlow) throw new Error('Value origin: the analysis carries no code flow (graph.codeFlow) to draw.');
  const { rows: homeRows, sites: localSites } = graph.flowScope || flowScope(graph);
  const builder = (host && host.flowGraph) || flowGraphBuilder(), flowInput = { rows: homeRows, sites: localSites,
    point: { url: '', line: 0 }, name: graph.selectedProgram || 'PROGRAM' };
  const codeFlow = builder.build(flowInput, 'methods');
  const flowReadings = [['classes', 'Classes'], ['methods', 'Methods'], ['logic', 'Logic'], ['steps', 'Statements']]
    .map(([mode, label]) => mode === 'methods' ? { mode, label, bseFlow: codeFlow.bseFlow, maxStack: codeFlow.maxStack } : { mode, label });
  const originTitle = graph.originTitle ? graph.originTitle : graph.selectedVariable ? graph.selectedVariable + ' Origin — Backward Symbolic Execution' : 'Forward flow from line ' + (graph.selectedLine || '?');
  // Everything the drawing needs, in one place: the shared flow script is a
  // file, not a template, so what the page used to interpolate into it - the
  // title, the BSE caption and tree, the two depth maxima - travels here.
  const mermaidGraph = { nodes: mermaidNodes, edges: mermaidEdges, formula: formulaGraph, bseFlow: codeFlow.bseFlow,
    originTitle, maxStack: Math.max(maxStack, codeFlow.maxStack), maxLevel,
    flowReadings: { active: 'methods', baseStack: maxStack, items: flowReadings, input: flowInput },
    bseFlowHtml: `<p class="edge">BSE FLOW${graph.flowBounds ? ` — breakpoints ${graph.flowBounds.from}–${graph.flowBounds.to}` : ''}</p>${bseFlowTree || '<p>No BSE flow points in the selected range.</p>'}` };
  graph.drawn = mermaidGraph;
  graph.derived = derivation;
  const diagnosticLog = ['Engine: ' + (graph.analysisEngine || 'ACE'),
    'Selected: ' + (graph.selectedProgram || '?') + ':' + (graph.selectedLine || '?') + ' ' + (graph.selectedVariable || '?'),
    ...(graph.diagnostics || []),
    'Graph: ' + graph.nodes.length + ' nodes, ' + graph.edges.length + ' edges',
    'FLOW: ' + (graph.fullFlow || []).length + ' statements; slice: ' + (graph.boundedFlow || []).length,
    'Formula: ' + derivation.nodes.length + ' nodes',
    'Expression: ' + (derivation.expression?.text || '(none)'),
    ...(graph.warnings || []).map(w => 'Warning: ' + w),
    ...(graph.skipped || []).map(s => 'Skipped: ' + s)].join('\n');
  // Export the same structures that feed the panes, without applying the
  // current visual depth or collapsing repeated derivation branches.
  const treeLogs = [
    'FLOW TREE (JSON):\n' + JSON.stringify({ roots: flowRoots, fullFlow: graph.fullFlow || [],
      boundedFlow: graph.boundedFlow || [], calls: graph.calls || [], pipeline: graph.pipeline || null }, null, 2),
    'FORMULA TREE (JSON):\n' + JSON.stringify(derivation, null, 2),
    'EXPRESSION (JSON):\n' + JSON.stringify(derivation.expression || null, null, 2)
  ].join('\n\n');
  const flowLogText = [diagnosticLog, analysisLog, 'FLOW TRAVERSAL:', traversalLogText || '(none)', treeLogs].join('\n\n');
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSource}; script-src 'nonce-${nonce}' ${cspSource}"><script nonce="${nonce}">if(typeof acquireVsCodeApi==='function'){window.vertexHost=acquireVsCodeApi();window.addEventListener('error',e=>window.vertexHost.postMessage({kind:'pageError',message:String(e.message||e)+(e.filename?' ('+e.filename+':'+e.lineno+')':'')}));}</script><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  button:not(.data-composed):where(:not(.vertex-toggle,.vertex-icon-button,.vertex-segment-toggle button)){width:100%;text-align:left;background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border:1px solid var(--vscode-focusBorder);padding:8px;cursor:pointer;white-space:normal;overflow:auto;max-height:85px}.flow-data{display:none}.data-composed{display:inline;width:auto;max-width:none;margin:0;padding:0;border:0;background:transparent;color:var(--vscode-textLink-foreground);font:inherit;text-decoration:underline;text-decoration-style:dotted;cursor:pointer}
  pre{white-space:pre-wrap}strong{font-family:var(--vscode-editor-font-family)}
  .children{border-left:1px solid var(--vscode-panel-border);margin-left:8px;padding-left:16px}.node,.leaf{margin:8px 0;padding:6px;background:var(--vscode-editorWidget-background)}summary{cursor:pointer;overflow-wrap:anywhere}code{white-space:pre-wrap;font-family:var(--vscode-editor-font-family);background:transparent!important}.syntax-keyword{color:var(--vscode-symbolIcon-keywordForeground)}.syntax-string{color:var(--vscode-debugTokenExpression-stringForeground)}.syntax-number{color:var(--vscode-debugTokenExpression-numberForeground)}.flow-call{color:var(--vscode-textLink-foreground);text-decoration:underline;text-decoration-style:dotted;cursor:help}.unknown,.boundary,.warning{border-left:3px solid var(--vscode-editorWarning-foreground);padding-left:10px}.call-frame{margin:6px 0;padding:6px 8px;border-left:2px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.call-stack{margin:6px 0 0 10px;padding-left:12px;border-left:1px solid var(--vscode-panel-border);list-style:none}.analysis-log{max-height:560px;overflow:auto;user-select:text;padding:12px;background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-panel-border)}.help{position:absolute;right:8px;top:8px;z-index:50}.help summary{list-style:none;border:1px solid var(--vscode-focusBorder);padding:2px 8px;font-weight:bold}.help>div{display:none}.help[open]{position:fixed;inset:0;z-index:200;background:var(--vscode-editor-background);padding:20px;overflow:auto}.help[open] summary{float:right}.help[open]>div{display:block;clear:both;max-width:900px;margin:48px auto;padding:20px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border)}.debug-toggle{display:none}.debug-button{position:absolute;right:46px;top:8px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:28px;height:28px;margin:0;border:1px solid var(--vscode-button-border,var(--vscode-panel-border));border-radius:5px;background:var(--vscode-button-secondaryBackground,var(--vscode-editorWidget-background));color:var(--vscode-button-secondaryForeground,var(--vscode-editor-foreground));cursor:pointer}.debug-button:hover{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-list-hoverBackground))}h2{padding-right:82px}.debug-only{display:none}.debug-toggle:checked~.debug-only{display:block}.scenario{margin:8px 0;border:1px solid var(--vscode-panel-border)}.scenario label{margin:0 8px}
  </style>${host && host.style ? `<style>${host.style}</style>` : styleSource ? `<link rel="stylesheet" href="${styleSource}">` : ''}${(host && host.head) || ''}</head><body><details class="help"><summary aria-label="Value origin help">?</summary><div><strong>Value origin</strong> traces static source dependencies backwards across calls. It proves source relationships, not runtime values: loop order, database contents and unknown dispatches remain boundaries. Expand a branch to inspect its inputs; click a linked label or source location to open code; Ctrl+Click on source buttons opens beside. Alt+Left returns through editor navigation history. <strong>All branches</strong> shows every static alternative. Choosing a selection-screen radio button simulates that exclusive choice and hides other radio branches. Mermaid shows the same expanded branches: click the linked label to open source and the frame to expand or collapse it. Use the zoom slider or mouse wheel and drag empty space to pan. Theme changes preserve the view. The magnifier is available below 70% scale and reaches an effective 70%. The bug control shows technical analysis sections; Copy log exports the full analysis. ${(graph.skipped || []).length ? `<p>Analysis boundaries kept outside the graph: ${escape(graph.skipped.join(', '))}</p>` : ''}</div></details><input id="debug-toggle" class="debug-toggle" type="checkbox"><label class="debug-button" for="debug-toggle" title="Show technical analysis sections">🐞</label><h2>Value origin — ${escape(graph.analysisEngine || 'ACE')} backward analysis</h2>
  ${graph.stopNotice ? `<p class="warning">⛔ ${escape(graph.stopNotice)}</p>` : ''}${(graph.warnings || []).map(w => `<p class="warning">${escape(w)}</p>`).join('')}
  <details class="origin-log debug-only"><summary>Analysis log — ${escape(graph.analysisEngine || 'ACE')}</summary><button id="copy-flow" class="location">Copy log</button><pre class="analysis-log">${escape(diagnosticLog)}</pre><div class="analysis-log">${fullLog || escape(analysisLog)}</div><p class="edge">Copy log includes FLOW, Formula and Expression structures.</p></details>
  ${scenarioControls ? `<details class="scenario-panel"><summary>Simulate selection screen</summary>${scenarioControls}</details>` : ''}<div id="bse-workspace" class="bse-workspace"><template data-flow-pane="tree"><p class="edge">Execution flow${graph.flowBounds ? ` between breakpoints ${graph.flowBounds.from}–${graph.flowBounds.to}` : ''} — changes and parameter transfers to ${escape(graph.selectedVariable || '?')}</p>${aceExecution || '<p>Execution flow was not produced.</p>'}</template><template data-flow-pane="formula">${formulaView}</template><template data-flow-pane="expression">${expressionPane(derivation)}</template></div>
  <script id="mermaid-data" type="application/json">${JSON.stringify(mermaidGraph).replaceAll('<', '\\u003c')}</script>${scripts.lens ? inlineScript(nonce, scripts.lens) : lensSource ? `<script nonce="${nonce}" src="${lensSource}"></script>` : `<script nonce="${nonce}">${lensScript()}</script>`}${host ? '' : inlineScript(nonce, resourceScript('vertex-abap-control.js')) + inlineScript(nonce, resourceScript('vertex-flow-graph.js'))}${scripts.flow ? inlineScript(nonce, scripts.flow) : inlineScript(nonce, flowScript())}<script nonce="${nonce}">if(!window.vertexFlow){const box=document.getElementById('bse-workspace');if(box)box.innerHTML='<p class="warning">The flow view did not load${flowSource ? ` from ${flowSource}` : ''}: the page has its data but nothing to draw it with.</p>';}</script>
  <script nonce="${nonce}">(()=>{const state=${JSON.stringify(graph.restore || {}).replaceAll('<', '\\u003c')};if(!state.choice)return;const panel=document.querySelector('.scenario-panel');if(panel)panel.open=true;const selected=document.querySelector('.scenario input[value="'+state.choice+'"]');if(selected){selected.checked=true;selected.dispatchEvent(new Event('change',{bubbles:true}));}if(state.mode){document.querySelector('.bse-view-toggle [data-mode="'+state.mode+'"]').click();}if(state.view){document.querySelector('.bse-view-toggle [data-view="'+state.view+'"]').click();}})();</script>
  <details class="debug-only"><summary>BSE dependency tree (technical)</summary>${dependencyTree}</details><details class="debug-only"><summary>${escape(graph.analysisEngine || 'ACE')} source closure (${(graph.sourceClosure || []).length})</summary><p class="edge">These are the exact source objects loaded for this analysis. Missing factory or implementation here explains an unresolved call.</p><pre class="analysis-log">${escape((graph.sourceClosure || []).map(item => `${item.objectType || '?'} ${item.objectName || item.name} · ${item.name}`).join('\n') || 'No sources were loaded.')}</pre></details>
  <details class="debug-only"><summary>Static call stack contributing to the selected value</summary><div class="call-stack">${callPath || '<p>No resolved calls.</p>'}</div></details>

  ${scripts.mermaid ? inlineScript(nonce, scripts.mermaid) : mermaidSource ? `<script nonce="${nonce}" src="${mermaidSource}"></script>` : ''}${host && host.bridge ? inlineScript(nonce, host.bridge) : ''}<script nonce="${nonce}">const api=window.vertexHost||acquireVsCodeApi(),flowLog=${JSON.stringify(flowLogText).replaceAll('<', '\\u003c')};window.bseMermaidOpen=(id,node)=>api.postMessage(node&&node.source?{node:id,source:node.source,line:Number(node.line)||0}:{node:id});const reportScreen=()=>setTimeout(()=>{const mode=document.querySelector('[data-mode-choice].active'),view=document.querySelector('[data-view-choice].active'),depth=window.vertexFlow&&window.vertexFlow.depth();api.postMessage({kind:'screen',mode:mode?mode.dataset.modeChoice:null,view:view?view.dataset.viewChoice:null,depth:depth===undefined?null:depth});});['click','input','bse:mermaid-rendered','bse:scenario'].forEach(type=>document.addEventListener(type,reportScreen));window.addEventListener('load',reportScreen);document.addEventListener('click',e=>{const b=e.target.closest('button[data-node]');if(b)api.postMessage({node:b.dataset.node,source:b.dataset.source,line:Number(b.dataset.line)||0,openBeside:e.ctrlKey||e.metaKey});});document.getElementById('copy-flow').addEventListener('click',async()=>{const button=document.getElementById('copy-flow');try{if(${!host}){button.textContent='Copying…';api.postMessage({kind:'copyLog',text:flowLog});}else{await navigator.clipboard.writeText(flowLog);button.textContent='Copied';}}catch(error){button.textContent='Copy failed';button.title=error.message;}});window.addEventListener('message',event=>{const message=event.data;if(message&&message.kind==='copyLogResult'){const button=document.getElementById('copy-flow');button.textContent=message.ok?'Copied':'Copy failed';button.title=message.error||'';}});const setScenario=active=>{document.querySelectorAll('[data-scenario]').forEach(node=>{node.hidden=!!active&&node.dataset.scenario!==active;if(node.hidden&&node.tagName==='DETAILS')node.open=false;});document.dispatchEvent(new Event('bse:scenario'));};document.querySelectorAll('.scenario input').forEach(input=>input.addEventListener('change',e=>setScenario(e.target.value)));if(typeof mermaid==='undefined'){const host=document.getElementById('mermaid-graph');if(host)host.textContent='Mermaid library is unavailable.';}else{mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'dark',flowchart:{htmlLabels:false,useMaxWidth:false}});document.dispatchEvent(new Event('bse:mermaid-ready'));}</script></body></html>`;
}
/* The statements the flow draws and the calls between them: { rows, sites }. */
function flowScope(graph) {
  // One source, four readings of it, as Visual Debug reads its record: classes, routines, the logic, every statement.
  // Only the reading shown first is built here; the page builds another from the same input when it is asked for.
  // With a value chosen and no breakpoints bounding the flow, it goes into a call only where the value is computed:
  // a callee with a statement of the slice, or one that calls such a callee. Every statement of the object is still
  // shown; another call is a step, not a way into its routine. Between breakpoints the whole run is the point, so
  // there every call is followed.
  const relevant = graph.selectedVariable && !graph.flowBounds
    ? new Set(graph.codeFlow.rows.filter(row => row.included).map(row => String(row.scope).toUpperCase())) : null;
  // The routine a call stands in, as the rows name it - a site's own method is empty for an event block.
  const scopeAt = new Map(graph.codeFlow.rows.map(row => [row.name + ':' + row.line, String(row.scope).toUpperCase()]));
  if (relevant) {
    for (let grew = true; grew;) {
      grew = false;
      for (const site of graph.codeFlow.sites) {
        const caller = scopeAt.get(site.name + ':' + site.line);
        if (caller && !relevant.has(caller) && site.callees.some(callee => relevant.has(String(callee).toUpperCase()))) { relevant.add(caller); grew = true; }
      }
    }
  }
  const flowSites = relevant ? graph.codeFlow.sites.filter(site => site.callees.some(callee => relevant.has(String(callee).toUpperCase())))
    : graph.codeFlow.sites;
  // A variable local to its routine has no history outside it: the routines that call this one, and the rest of the
  // class, are not drawn. The flow starts at the routine and goes down only into the calls that compute the value.
  // Forward starts in the routine around the selected line, whatever the value is - local, parameter or attribute: the
  // class around it is not the flow. With no value chosen it is the run from that line on, and every customer routine
  // it calls, whole. The routine's rows tell how the flow names it.
  const around = (graph.declarations || []).find(d => d.source === graph.selectedSource && d.name !== 'GLOBAL'
    && d.first <= graph.selectedLine && d.last >= graph.selectedLine);
  const home = around && graph.codeFlow.rows.find(row => row.source === around.source && row.line >= around.first && row.line <= around.last);
  let homeRows = graph.codeFlow.rows, localSites = flowSites;
  if (graph.flowBounds) {
    // Between breakpoints: the routine they stand in, only its statements between them, and every routine those
    // statements call, all the way down and whole - the same class's methods beyond the breakpoints included. Routines
    // no call from there reaches are not part of the run and are not drawn.
    const within = row => row.source === graph.selectedSource && !row.outside;
    const starts = new Set(homeRows.filter(within).map(row => String(row.scope).toUpperCase()));
    const inRange = new Set(homeRows.filter(row => !row.outside).map(row => row.name + ':' + row.line));
    const keep = new Set(starts);
    const callsFrom = site => { const caller = scopeAt.get(site.name + ':' + site.line);
      return keep.has(caller) && (!starts.has(caller) || inRange.has(site.name + ':' + site.line)); };
    for (let grew = true; grew;) {
      grew = false;
      for (const site of graph.codeFlow.sites) if (callsFrom(site))
        for (const callee of site.callees.map(callee => String(callee).toUpperCase())) if (!keep.has(callee)) { keep.add(callee); grew = true; }
    }
    homeRows = homeRows.filter(row => { const scope = String(row.scope).toUpperCase();
      return keep.has(scope) && !(starts.has(scope) && row.outside); });
    localSites = graph.codeFlow.sites.filter(callsFrom);
  } else if (home) {
    const keep = new Set([String(home.scope).toUpperCase()]);
    for (let grew = true; grew;) {
      grew = false;
      for (const site of flowSites) {
        if (!keep.has(scopeAt.get(site.name + ':' + site.line))) continue;
        for (const callee of site.callees.map(callee => String(callee).toUpperCase()))
          if ((!relevant || relevant.has(callee)) && !keep.has(callee)) { keep.add(callee); grew = true; }
      }
    }
    const homeScope = String(home.scope).toUpperCase(), before = (scope, line) => !relevant && scope === homeScope && line < graph.selectedLine;
    homeRows = homeRows.filter(row => keep.has(String(row.scope).toUpperCase()) && !before(String(row.scope).toUpperCase(), row.line));
    localSites = flowSites.filter(site => keep.has(scopeAt.get(site.name + ':' + site.line)) && !before(scopeAt.get(site.name + ':' + site.line), site.line));
  }
  return { rows: homeRows, sites: localSites, start: home ? String(home.scope).toUpperCase() : null };
}

/* The flow walked in the order it runs - a routine's statements by line, a call's routine where the call is made - and
   stopped where a breakpoint stands, as a run in the debugger would be. `breakpointAt(row)` names the breakpoint on a
   statement or answers null; `ask(points)` answers 'stop', 'next' or 'ignore'. On 'stop' the flow ends with the
   statement of the breakpoint and `stoppedAt` names it; a breakpoint is asked about once. */
async function stopAtBreakpoints(scope, breakpointAt, ask) {
  const U = value => String(value || '').toUpperCase(), byScope = new Map(), sitesAt = new Map();
  for (const row of scope.rows) { if (!byScope.has(U(row.scope))) byScope.set(U(row.scope), []); byScope.get(U(row.scope)).push(row); }
  for (const list of byScope.values()) list.sort((left, right) => left.line - right.line);
  for (const site of scope.sites) { const key = site.name + ':' + site.line; if (!sitesAt.has(key)) sitesAt.set(key, []); sitesAt.get(key).push(site); }
  // Where the run begins: the routine of the selected line, or else every routine no call of the flow reaches.
  const called = new Set(scope.sites.flatMap(site => site.callees.map(U)));
  const roots = scope.start ? [scope.start] : [...byScope.keys()].filter(key => !called.has(key));
  const kept = new Set(), asked = new Set();
  let asking = true, stoppedAt = null;
  const walk = async (key, active) => {
    for (const row of byScope.get(key) || []) {
      kept.add(row.name + ':' + row.line);
      const point = asking && !asked.has(row.name + ':' + row.line) && breakpointAt(row);
      if (point) {
        asked.add(row.name + ':' + row.line);
        const answer = await ask([point]);
        if (answer === 'stop') { stoppedAt = [point]; return true; }
        if (answer === 'ignore') asking = false;
        else if (answer !== 'next') throw new Error('Unknown answer at a breakpoint: ' + answer);
      }
      for (const site of sitesAt.get(row.name + ':' + row.line) || [])
        for (const callee of site.callees.map(U))
          if (!active.has(callee) && await walk(callee, new Set([...active, callee]))) return true;
    }
    return false;
  };
  for (const root of roots) if (await walk(root, new Set([root]))) break;
  if (!stoppedAt) return scope;
  const rows = scope.rows.filter(row => kept.has(row.name + ':' + row.line)), reached = new Set(rows.map(row => U(row.scope)));
  // A call at the breakpoint itself is not made: the run stops before its routine.
  const sites = scope.sites.filter(site => kept.has(site.name + ':' + site.line))
    .map(site => ({ ...site, callees: site.callees.filter(callee => reached.has(U(callee))) })).filter(site => site.callees.length);
  return { rows, sites, start: scope.start, stoppedAt };
}

/* What the assistant is told of the open Value origin window: the value, and the flow as the window draws it - the
   statements in execution order, each at the depth of the calls it stands in, marked where the value's slice reaches it.
   It is the analysis (what can happen), never a record of a run. Null while no window is open. */
const MAX_ORIGIN_STEPS = 150;
let openOrigin = null;
// What the reader has on screen decides what the assistant is told: the mode (the flow, the formula derivation or the
// derivation of the value), within the depth the window is set to. `screen` says which, so the answer can name it.
function originContext() {
  if (!openOrigin) { return null; }
  const { graph, screen } = openOrigin;
  if (!graph.drawn) { throw new Error('Value origin: the window has not been drawn, so there is no screen to describe.'); }
  if (!screen) { return null; }
  const depth = Number.isInteger(screen.depth) ? screen.depth : Infinity;
  if (screen.mode !== 'flow' && screen.mode !== 'formula' && screen.mode !== 'expression') { return null; }
  const shownScreen = { mode: screen.mode, view: screen.view, depth: Number.isInteger(screen.depth) ? screen.depth : 'all' };
  if (screen.mode === 'expression') {
    return graph.derived.expression ? { value: graph.selectedVariable || null, program: graph.selectedProgram || null, screen: shownScreen, kind: 'expression', expression: graph.derived.expression } : null;
  }
  const kind = screen.mode;
  let items;
  if (kind === 'flow') {
    items = graph.drawn.bseFlow.nodes.filter(node => node.type === 'operation' && node.stack <= depth)
      .map(node => ({ depth: node.stack, in: node.location, text: node.text, in_slice: !!node.bse }));
  } else {
    items = graph.drawn.formula.nodes.filter(node => node.level <= depth).map(node => ({ level: node.level, text: node.dataText || node.text }));
  }
  return { value: graph.selectedVariable || null, program: graph.selectedProgram || null,
    screen: { mode: screen.mode, view: screen.view, depth: Number.isInteger(screen.depth) ? screen.depth : 'all' },
    kind, items: items.length, shown: Math.min(items.length, MAX_ORIGIN_STEPS), [kind]: items.slice(0, MAX_ORIGIN_STEPS) };
}

function register(vscode, context, getSources, options = {}) {
  // Reopening the same origin must not repeat a complete remote ACE closure.
  // Keep it deliberately short-lived: an edit, another cursor target or a
  // breakpoint change gets a new graph, while an accidental close/reopen is
  // immediate.
  let recentAnalysis;
  context.subscriptions.push(vscode.commands.registerCommand(options.command || 'vertex.valueOrigin', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) throw new Error('Select a variable in an ABAP source editor.');
      const offset = editor.document.offsetAt(editor.selection.active), text = editor.document.getText();
      // A literal or a comment has no history: said, not analysed as if its word were a variable.
      const inside = literalAt(text, offset);
      if (inside) throw new Error(inside === 'comment' ? 'The cursor is in a comment: a comment has no value history. Place it on a variable.'
        : 'The cursor is in a text literal: a literal has no value history. Place it on a variable.');
      // No variable under the cursor: the flow forward from this line, with no slice of a value.
      const variable = variableAt(text, offset) || '';
      const target = { source: editor.document.uri.toString(), line: editor.selection.active.line + 1, column: editor.selection.active.character, variable };
      if (!variable) { target.flowPath = true; target.flowRange = { from: target.line, to: editor.document.lineCount }; }
      const cacheKey = JSON.stringify([target.source, editor.document.version, target.line, target.column, target.variable]);
      let loaded, graph;
      if (recentAnalysis?.key === cacheKey && recentAnalysis.expiresAt > Date.now()) {
        ({ loaded, graph } = recentAnalysis);
      } else {
        const loadStarted = Date.now();
        loaded = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: options.progressTitle || 'Value origin — ACE call index', cancellable: true },
          (progress, token) => getSources(editor.document, target, name => progress.report({ message: name }), () => token.isCancellationRequested));
        // The name in METHOD, FORM or FUNCTION is the routine, not a value: the routine's flow, with no slice. The parsed
        // statement at the cursor says so; the sources are read again for the flow, as a run with no variable reads them.
        const own = loaded.sources.find(source => source.id === loaded.target.source);
        const at = own && (own.aceStatements || []).filter(statement => statement.offset <= loaded.target.offset).at(-1);
        // So is the name of a method called there (lo_x->get( ), zcl_y=>create( )): a call is a step of the flow, not a value.
        const called = at && callsIn(at.tokens).some(call => call.method && String(target.variable).toUpperCase()
          === String((call.receiver || call.owner) + call.arrow + call.method).toUpperCase());
        const routineLine = at && ['METHOD', 'FORM', 'FUNCTION'].includes(String(at.tokens[0]?.value).toUpperCase());
        // The title says where the cursor was, what name stood there and how it was read, so a result is never a riddle.
        const place = 'Forward flow — line ' + target.line + ', col ' + (target.column + 1);
        const named = target.variable;
        let originTitle = !named ? place + ': no name under the cursor' : place + ': ' + named + ' — slice of this value';
        // A word the parsed statement does not read as a variable - a keyword such as DATA or IF - is no value either.
        const keyword = named && at && !called && !routineLine && !variablePaths(at.tokens).some(path => String(path.name).toUpperCase() === String(named).toUpperCase());
        if (named && at && (called || routineLine || keyword)) {
          originTitle = place + ': ' + named + (called ? ' is a method call, not a value' : routineLine ? ' is the routine itself' : ' is not a value');
          target.variable = ''; target.flowPath = true; target.flowRange = { from: target.line, to: editor.document.lineCount };
          loaded = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: options.progressTitle || 'Value origin — ACE call index', cancellable: true },
            (progress, token) => getSources(editor.document, target, name => progress.report({ message: name }), () => token.isCancellationRequested));
        }
        const sources = loaded.sources;
        const sliceStarted = Date.now();
        graph = analyze(sources, loaded.target);
        graph.diagnostics = [...(loaded.diagnostics || []), 'Source closure total: ' + (sliceStarted - loadStarted) + ' ms',
          'Backward slice: ' + (Date.now() - sliceStarted) + ' ms'];
        graph.analysisEngine = options.engine || 'ACE';
        graph.originTitle = originTitle;
        graph.warnings = loaded.warnings;
        graph.skipped = loaded.skipped;
        graph.sourceClosure = sources.map(source => ({ name: source.name, objectName: source.aceOwner || source.objectName, objectType: source.aceOwner ? source.aceOwnerType : source.objectType }));
        graph.nodes.forEach(n => { n.sourceName = sources.find(s => s.id === n.source)?.name || n.source; });
        recentAnalysis = { key: cacheKey, expiresAt: Date.now() + (options.cacheMs ?? 30000), loaded, graph };
      }
      graph.codeFlow = { rows: pathRows(graph, loaded.sources), sites: siteRows(graph, loaded.sources) };
      // The editor's breakpoints stop the flow where the run would stop, and the reader decides whether it goes on.
      const breakpoints = (vscode.debug.breakpoints || []).filter(point => point.enabled !== false && point.location?.uri)
        .map(point => ({ source: loaded.sourceFor ? loaded.sourceFor(point.location.uri.toString()) : null, line: point.location.range.start.line + 1 }))
        .filter(point => point.source);
      graph.flowScope = await stopAtBreakpoints(flowScope(graph),
        row => breakpoints.some(point => point.source === row.source && point.line === row.line) ? { location: row.location, line: row.line } : null,
        async points => {
          const stop = 'Stop analysis', next = 'Continue to next', ignore = 'Ignore breakpoints';
          const answer = await vscode.window.showWarningMessage('VERTEX: breakpoint reached:\n' + points.map(point => point.location + ', line ' + point.line).join('\n'),
            { modal: true }, stop, next, ignore);
          // Escape ends the analysis here as Stop does: what was found so far is shown.
          return !answer || answer === stop ? 'stop' : answer === next ? 'next' : 'ignore';
        });
      graph.stopNotice = graph.flowScope.stoppedAt ? 'Stopped at breakpoint: ' + graph.flowScope.stoppedAt.map(point => point.location + ', line ' + point.line).join('; ')
        + '. The flow after it is not shown.' : '';
      const sources = loaded.sources, originViewColumn = editor.viewColumn || vscode.ViewColumn.One;
      const panel = vscode.window.createWebviewPanel(options.command || 'vertex.valueOrigin', options.panelTitle || 'Value origin', vscode.ViewColumn.Beside, { enableScripts: true });
      const mine = { graph, screen: null };
      openOrigin = mine;
      panel.onDidChangeViewState(() => { if (panel.active) { openOrigin = mine; } });
      panel.onDidDispose(() => { if (openOrigin === mine) { openOrigin = null; } });
      const mermaid = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'resources', 'mermaid.min.js')).toString() : '';
      const styles = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'value-origin.css')).toString() : '';
      // The flow - tree, diagram and the controls over both - is one script for
      // every VERTEX view that draws one; this page supplies the graph only.
      const flowScript = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'resources', 'vertex-flow.js')).toString() : '';
      const lensUri = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'resources', 'vertex-lens.js')).toString() : '';
      panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'), mermaid, panel.webview.cspSource || '', styles, flowScript, lensUri);
      panel.webview.onDidReceiveMessage(async message => {
        if (message?.kind === 'copyLog') {
          try {
            await vscode.env.clipboard.writeText(String(message.text || ''));
            await panel.webview.postMessage({ kind: 'copyLogResult', ok: true });
          } catch (error) {
            await panel.webview.postMessage({ kind: 'copyLogResult', ok: false, error: error.message });
          }
          return;
        }
        if (message?.kind === 'pageError') { vscode.window.showErrorMessage('VERTEX: the Value origin page failed: ' + message.message); return; }
        if (message?.kind === 'screen') { mine.screen = { mode: message.mode, view: message.view, depth: message.depth }; return; }
        const scenarioNode = /^scenario:([A-Z0-9_]+)$/i.exec(message?.node || '');
        if (scenarioNode) {
          try {
            const pipeline = await loaded.loadPipeline?.(scenarioNode[1]);
            if (!pipeline) return;
            graph.pipeline = { ...pipeline,
              caption: `Loaded from ${pipeline.table}: scenario ${pipeline.scenario} (${pipeline.steps.length} step${pipeline.steps.length === 1 ? '' : 's'})` };
            graph.restore = { choice: scenarioNode[1], mode: 'formula', view: 'diagram' };
            panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'), mermaid, panel.webview.cspSource || '', styles);
          } catch (error) {
            vscode.window.showErrorMessage('VERTEX: cannot load ZLOG_PIPELINE: ' + error.message);
          }
          return;
        }
        if (message?.kind === 'scenario') {
          if (!message.choice) {
            delete graph.pipeline;
              panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'), mermaid, panel.webview.cspSource || '', styles);
            return;
          }
          try {
            const pipeline = await loaded.loadPipeline?.(message.choice);
            if (!pipeline) return;
            graph.pipeline = { ...pipeline,
              caption: `Loaded from ${pipeline.table}: scenario ${pipeline.scenario} (${pipeline.steps.length} step${pipeline.steps.length === 1 ? '' : 's'})` };
            panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'), mermaid, panel.webview.cspSource || '', styles);
          } catch (error) {
            vscode.window.showErrorMessage('VERTEX: cannot load ZLOG_PIPELINE: ' + error.message);
          }
          return;
        }
        const flowIndex = /^flow(\d+)$/.exec(message?.node || ''), bseFlowIndex = /^bseflow(\d+)$/.exec(message?.node || '');
        const n = flowIndex ? graph.executionFlow[Number(flowIndex[1])] : bseFlowIndex ? graph.boundedFlow[Number(bseFlowIndex[1])] : graph.nodes.find(n => message && n.id === message.node);
        // A node of the code flow names its source as the debugger's flow does: "origin:<source>|<OWNER->ROUTINE>".
        const marked = /^origin:([^|]*)\|(.*)$/.exec(message?.source || '');
        const source = sources.find(s => s.id === (marked ? marked[1] : (message.source || n?.source)));
        if (!source) { vscode.window.showErrorMessage('VERTEX: the analysis has no source for this node (' + String((marked ? marked[1] : message.source) || message.node || '?') + ').'); return; }
        const requestedLine = message.line || n?.line || 1;
        const opened = await loaded.openSource(source, { ...(n || {}), ...(marked && marked[2] ? { location: marked[2] } : {}), line: requestedLine });
        const document = opened.document, line = navigationLine(opened, requestedLine);
        const at = new vscode.Position(Math.min(document.lineCount - 1, line - 1), 0);
        // The place left in that column goes into VERTEX's navigation history, so Back returns to it.
        if (options.remember && !message.openBeside) { const leaving = (vscode.window.visibleTextEditors || []).find(editor => editor.viewColumn === originViewColumn); if (leaving) { options.remember(leaving); } }
        await vscode.commands.executeCommand('vscode.open', document.uri, { viewColumn: message.openBeside ? vscode.ViewColumn.Beside : originViewColumn,
          selection: new vscode.Range(at, at), preview: !message.openBeside });
      });
    } catch (e) { vscode.window.showErrorMessage('VERTEX: ' + e.message); }
  }));
}
module.exports = { register, html, navigationLine, originContext, flowScope, stopAtBreakpoints };
