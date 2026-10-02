"use strict";
const { analyze, variableAt } = require('./value-origin');
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
function html(graph, nonce, mermaidSource = '', cspSource = '', styleSource = '', flowSource = '') {
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
  const scopeKey = label => String(label || '').replace(/->/g, '→').toUpperCase();
  const callsFrom = new Map();
  for (const call of graph.calls || []) {
    const from = scopeKey(call.caller);
    if (!callsFrom.has(from)) callsFrom.set(from, new Set());
    for (const target of call.targets || []) callsFrom.get(from).add(scopeKey(target.label));
  }
  const scopeDepth = new Map();
  {
    const entry = String(graph.selectedProgram || '').toUpperCase();
    const queue = [...callsFrom.keys()].filter(key => key === entry || key.startsWith(entry + '→'));
    queue.forEach(key => scopeDepth.set(key, 0));
    while (queue.length) {
      const from = queue.shift(), depth = scopeDepth.get(from) || 0;
      for (const to of callsFrom.get(from) || []) {
        if (scopeDepth.has(to) && scopeDepth.get(to) <= depth + 1) continue;
        scopeDepth.set(to, depth + 1);
        queue.push(to);
      }
    }
  }
  const stackOfScope = label => scopeDepth.get(scopeKey(label)) ?? 0;
  const maxStack = Math.max(0, ...scopeDepth.values(), ...(graph.executionFlow || []).map(step => step.depth || 0));
  const flowItems = (graph.executionFlow || []).map((step, index) => ({ step, index, bse: step.type === 'operation' && bseOperatorKeys.has(step.source + ':' + step.line), children: [] })), flowRoots = [], executionStack = [];
  for (const item of flowItems) {
    executionStack.length = Math.min(executionStack.length, item.step.depth + 1);
    const parent = executionStack[item.step.depth - 1];
    (parent ? parent.children : flowRoots).push(item);
    executionStack[item.step.depth] = item;
  }
  const sourceButton = item => `<button class="location code-location" title="Open source; Ctrl+Click opens beside" data-node="" data-source="${escape(item.step.source)}" data-line="${item.step.line}">&lt;/&gt;</button>`;
  const bseById = new Map((graph.nodes || []).map(node => [node.id, node])), dataDefinitions = new Map();
  const canonical = value => String(value || '').toUpperCase().replace(/\s+/g, '');
  for (const edge of graph.edges || []) {
    const value = bseById.get(edge.to), definition = bseById.get(edge.from);
    if (value?.kind !== 'value' || !definition || !['calculation', 'parameter', 'call'].includes(definition.kind)) continue;
    if (!dataDefinitions.has(canonical(value.text))) dataDefinitions.set(canonical(value.text), { definition, valueId: value.id });
  }
  const stripData = value => String(value || '').replace(/\bDATA\s*\(\s*([^()]+?)\s*\)/ig, '$1');
  const dataNames = step => {
    const text = stripData(step.text || step.caller), assigned = text.match(/\b([A-Za-z_]\w*(?:-[A-Za-z_]\w*)?)\s*=/i);
    const calculated = new Set((step.calculated || []).map(canonical));
    if (assigned) calculated.add(canonical(assigned[1]));
    const composed = new Set((step.composed || []).map(canonical));
    const right = assigned ? text.slice(text.indexOf('=') + 1) : text;
    for (const name of right.match(/\b[a-z][a-z0-9_]*(?:-[a-z][a-z0-9_]*)?\b/ig) || []) {
      if (!['new', 'value', 'conv', 'cond', 'when', 'then', 'else', 'true', 'false', 'abap_true', 'abap_false'].includes(name.toLowerCase())) composed.add(canonical(name));
    }
    return { calculated, composed };
  };
  const dataText = step => stripData(step.text || step.caller);
  const syntaxCode = value => {
    const text = String(value || ''), token = /'(?:''|[^'])*'|\b(?:DATA|NEW|VALUE|CONV|WHEN|THEN|ELSE|IF|ENDIF|SELECT|FROM|INTO|CORRESPONDING|FIELDS|OF|TABLE|ORDER|BY|CHANGING|EXPORTING|IMPORTING|RETURNING)\b|\b\d+(?:\.\d+)?\b/ig;
    let output = '', offset = 0, match;
    while ((match = token.exec(text))) {
      output += escape(text.slice(offset, match.index));
      const value = match[0], kind = value.startsWith("'") ? 'string' : /^\d/.test(value) ? 'number' : 'keyword';
      output += `<span class="syntax-${kind}">${escape(value)}</span>`; offset = match.index + value.length;
    }
    return output + escape(text.slice(offset));
  };
  const symbolicExpression = (step, removeData = false) => {
    const text = removeData ? dataText(step) : String(step.text || step.caller), names = dataNames(step), token = /\b[a-z][a-z0-9_]*(?:-[a-z][a-z0-9_]*)?\b/ig;
    let output = '', offset = 0, match;
    while ((match = token.exec(text))) {
      output += syntaxCode(text.slice(offset, match.index));
      const name = match[0], key = canonical(name), definition = dataDefinitions.get(key)?.definition;
      if (names.calculated.has(key)) output += `<span class="data-calculated">${escape(name)}</span>`;
      else if (names.composed.has(key)) output += definition ? `<button class="data-composed" title="Open the definition of ${escape(name)}" data-node="${escape(definition.id)}" data-source="${escape(definition.source)}" data-line="${definition.line}">${escape(name)}</button>` : `<span class="data-composed">${escape(name)}</span>`;
      else output += syntaxCode(name);
      offset = match.index + name.length;
    }
    return output + syntaxCode(text.slice(offset));
  };
  const dataFormula = step => symbolicExpression(step, true);
  const codeFormula = step => symbolicExpression(step, true);
  const formulaGraph = { nodes: [], edges: [] };
  // A formula node is read as an expression, not as the statement it came from.
  // An assignment already reads as one; a SELECT is reduced to what it takes
  // and where from, because its projection is not part of the derivation.
  const formulaLabel = value => {
    const flat = String(value || '').replace(/\s+/g, ' ').trim();
    if (!/^SELECT\b/i.test(flat)) return flat;
    const table = /\bFROM\s+([\w~\/]+)/i.exec(flat)?.[1] || '?';
    const into = /\bINTO\s+(?:CORRESPONDING\s+FIELDS\s+OF\s+)?(?:TABLE\s+)?([\w@\-]+)/i.exec(flat)?.[1] || '';
    const fields = flat.replace(/^SELECT\s+(?:SINGLE\s+)?/i, '').split(/\bFROM\b/i)[0]
      .split(',').map(field => field.trim().split(/\s+AS\s+/i).at(-1)).filter(Boolean);
    const shown = fields.length > 3 ? fields.slice(0, 3).join(', ') + ', … (' + fields.length + ')' : fields.join(', ');
    return (into ? into + ' = ' : '') + 'SELECT ' + shown + ' FROM ' + table + '.';
  };
  const isInvocationResult = node => node?.kind === 'calculation' && /=\s*(?:NEW\s+)?[A-Za-z_]\w*(?:\s*\([^)]*\))?\s*(?:->|=>)/i.test(node.text || '');
  const isDataTransfer = node => /^\s*(?:DATA\s*\(\s*)?[A-Za-z_]\w*(?:-[A-Za-z_]\w*)?\s*\)?\s*=\s*[A-Za-z_]\w*(?:-[A-Za-z_]\w*)?\s*\.\s*$/i.test(node?.text || '');
  const isTechnicalValue = node => node?.kind === 'value' && /^(?:LO_|LT_|LS_STEP|RT_|RO_)/i.test(node.text || '');
  // The breakpoint pair bounds every Type, Formula included. As everywhere
  // else, it bounds the entry program alone: a called method keeps its whole
  // frame, because its lines are not in the editor's coordinate system.
  const withinBounds = node => !graph.flowBounds || !node || node.source !== graph.selectedSource
    || (node.line >= graph.flowBounds.from && node.line <= graph.flowBounds.to);
  const formulaInputs = nodeId => (graph.edges || []).filter(edge => edge.to === nodeId).map(edge => bseById.get(edge.from)).filter(node => node?.kind === 'value' && !isTechnicalValue(node) && withinBounds(node));
  const formulaDefinitions = (valueId, visited = new Set(), component = '') => {
    if (!valueId || visited.has(valueId)) return [];
    const value = bseById.get(valueId);
    component = value?.kind === 'value' && value.text.includes('-')
      ? canonical(value.text).split('-').slice(1).join('-') : component;
    const next = new Set(visited).add(valueId);
    return (graph.edges || []).filter(edge => edge.to === valueId).flatMap(edge => {
      const node = bseById.get(edge.from);
      if (!node || !withinBounds(node)) return [];
      if (node.kind === 'select' && component && /INTO\s+CORRESPONDING\s+FIELDS/i.test(node.text)) {
        const projection = node.text.split(/\bFROM\b/i)[0].replace(/^SELECT\s+(?:SINGLE\s+)?/i, '');
        const fields = projection.split(',').map(field => canonical(field.trim().split(/\s+AS\s+/i).at(-1)).split('~').at(-1));
        if (!fields.includes('*') && !fields.includes(component)) return [];
      }
      if (['calculation', 'select'].includes(node.kind) && !isInvocationResult(node)) return isDataTransfer(node) ? formulaInputs(node.id).flatMap(input => formulaDefinitions(input.id, next, component)) : [node];
      if (node.kind === 'calculation' && isInvocationResult(node)) return formulaDefinitions(node.id, next, component);
      if (['call', 'parameter'].includes(node.kind)) return formulaInputs(node.id).flatMap(input => formulaDefinitions(input.id, next, component));
      if (node.kind === 'loop') return formulaInputs(node.id).flatMap(input => formulaDefinitions(input.id, next, component));
      return [];
    });
  };
  // The guard is the path walked to here, not every value ever seen: a variable
  // read by two branches has to expand under both, or the second branch ends
  // without its inputs.
  let maxLevel = 0;
  const formulaSteps = (valueId, depth = 0, parentId = null, edgeLabel = '', walked = new Set()) => {
    if (!valueId || walked.has(valueId) || depth > 40) return '';
    const path = new Set(walked).add(valueId);
    const definitions = formulaDefinitions(valueId);
    if (definitions.length) maxLevel = Math.max(maxLevel, depth + 1);
    return definitions.map(definition => {
      const known = formulaGraph.nodes.find(node => node.id === definition.id);
      if (known) { if ((known.level ?? 0) > depth + 1) known.level = depth + 1; }
      else {
        const formulaVariables = new Set([...formulaInputs(definition.id).map(node => canonical(node.text)), ...(graph.edges || []).filter(edge => edge.from === definition.id).map(edge => bseById.get(edge.to)).filter(node => node?.kind === 'value').map(node => canonical(node.text))]);
        formulaGraph.nodes.push({ ...definition, location: definition.location || definition.source, dataText: definition.text, label: formulaLabel(definition.text), stack: stackOfScope(definition.location), level: depth + 1, variables: [...formulaVariables] });
      }
      if (parentId && !formulaGraph.edges.some(edge => edge.from === parentId && edge.to === definition.id)) {
        formulaGraph.edges.push({ from: parentId, to: definition.id, label: edgeLabel });
      }
      const step = { text: formulaLabel(definition.text), calculated: [], composed: [] };
      const inputs = formulaInputs(definition.id);
      const children = inputs.map(input => formulaSteps(input.id, depth + 1, definition.id, input.text, path)).join(''), caption = `<span class="formula-expression">${dataFormula(step)}</span><button class="location code-location" title="Open this formula in source; Ctrl+Click opens beside" data-node="${escape(definition.id)}" data-source="${escape(definition.source)}" data-line="${definition.line}">&lt;/&gt;</button>`;
      return children ? `<details class="formula-node" data-formula-node="${escape(definition.id)}" data-level="${depth + 1}"><summary>${caption}</summary><div class="formula-children">${children}</div></details>` : `<div class="formula-leaf" data-formula-node="${escape(definition.id)}" data-level="${depth + 1}">${caption}</div>`;
    }).join('');
  };
  // A derivation has one top: the value that was asked about. Its definitions
  // are its branches, however many of them there are - several tops would read
  // as several unrelated formulas.
  const formulaRoot = () => {
    const value = bseById.get(graph.root), id = 'formularoot';
    const source = value?.source || graph.selectedSource, line = value?.line || graph.selectedLine || 0;
    const branches = formulaSteps(graph.root, 0, id, graph.selectedVariable || '');
    if (!branches) return '';
    formulaGraph.nodes.unshift({ id, location: value?.location || graph.selectedProgram || graph.selectedSource,
      text: graph.selectedVariable || '?', label: graph.selectedVariable || '?', dataText: graph.selectedVariable || '?',
      source, line, stack: 0, level: 0, variables: [] });
    const caption = `<span class="formula-expression">${escape(graph.selectedVariable || '?')}</span><button class="location code-location" title="Open the selected value in source; Ctrl+Click opens beside" data-node="${escape(id)}" data-source="${escape(source)}" data-line="${line}">&lt;/&gt;</button>`;
    return `<details class="formula-node" data-formula-node="${escape(id)}" data-level="0" open><summary>${caption}</summary><div class="formula-children">${branches}</div></details>`;
  };
  const formulaView = formulaRoot() || '<p class="edge">No symbolic formula was resolved for this value.</p>';
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
  const flowNodes = [{ id: 'bseroot', location: graph.selectedProgram || 'PROGRAM', text: graph.selectedProgram || 'PROGRAM', depth: 0, stack: 0, type: 'program' }], flowEdges = [], flowClasses = new Map(), flowMethods = new Map();
  for (const [scope, items] of byScope) {
    const [klass, method = 'GLOBAL'] = scope.split('→'), classId = 'bsec' + flowClasses.size;
    if (!flowClasses.has(klass)) { flowClasses.set(klass, classId); flowNodes.push({ id: classId, location: klass, text: klass, source: items[0].point.source, line: items[0].point.line, depth: 1, stack: stackOfScope(scope), type: 'class' }); }
    const methodKey = klass + '→' + method, methodId = 'bsem' + flowMethods.size;
    if (!flowMethods.has(methodKey)) { flowMethods.set(methodKey, methodId); flowNodes.push({ id: methodId, location: scope, text: method, source: items[0].point.source, line: items[0].point.line, depth: 2, stack: stackOfScope(scope), type: 'method' }); }
    // ABAP blocks are hierarchy, not unrelated sequential rows.  A control
    // statement becomes the collapsible parent of its body in both FLOW Tree
    // and Mermaid; ENDIF/ENDLOOP only close that level and are not fake nodes.
    const blocks = [];
    for (const { point, index } of items) {
      const first = String(point.text || point.changed || '').trim().match(/^([A-Z-]+)/i)?.[1]?.toUpperCase() || '';
      if (/^END(?:IF|CASE|LOOP|DO|WHILE|SELECT)$/.test(first)) { while (blocks.at(-1)?.branch) blocks.pop(); blocks.pop(); continue; }
      // WHEN / ELSE / ELSEIF are branches of the open IF or CASE, exactly as in
      // Logic: the branch closes the previous one and owns the statements that
      // follow it, instead of standing beside them under the CASE.
      const branch = ['WHEN', 'ELSE', 'ELSEIF'].includes(first);
      if (branch) while (blocks.at(-1)?.branch) blocks.pop();
      const id = 'bseflow' + index, parent = blocks.at(-1)?.id || flowMethods.get(methodKey);
      flowNodes.push({ id, location: scope, text: point.text || point.changed, source: point.source, line: point.line, bse: !!point.included, branch, depth: 2 + blocks.length, stack: stackOfScope(scope), type: 'operation' });
      flowEdges.push({ from: parent, to: id, label: String(point.line) });
      if (branch || ['IF', 'CASE', 'LOOP', 'DO', 'WHILE', 'SELECT'].includes(first)) blocks.push({ id, branch });
    }
  }
  const className = label => String(label || '').split('->')[0].toUpperCase();
  const rootClass = String(graph.selectedProgram || '').toUpperCase();
  const uniqueFlowEdge = (from, to, label = '') => { if (from && to && from !== to && !flowEdges.some(edge => edge.from === from && edge.to === to)) flowEdges.push({ from, to, label: String(label || '') }); };
  const methodIdOf = label => flowMethods.get(String(label || '').replace('->', '→').toUpperCase());
  // The root program is already the root node.  Its first procedure must be
  // reachable before any outbound call, otherwise the entry statement (for
  // example line 15) is visually skipped.
  const rootMethod = [...flowMethods.entries()].find(([key]) => key.startsWith(rootClass + '→'))?.[1];
  uniqueFlowEdge('bseroot', rootMethod);
  // What crosses a call is the one thing an edge between two procedures does
  // not say. The bindings ACE resolved at the call site become a node on that
  // edge, so the value is visible where it changes its name.
  let passedIndex = 0;
  for (const call of graph.calls || []) {
    const callerClass = className(call.caller), callerMethod = methodIdOf(call.caller);
    const callerOperation = flowNodes.find(node => node.type === 'operation' && node.source === call.source && node.line === call.line && String(node.location || '').startsWith(callerClass + '→'))?.id;
    const passed = (graph.nodes || []).filter(node => node.kind === 'parameter' && node.source === call.source && node.line === call.line).map(node => node.text);
    let gate = callerOperation;
    if (passed.length) {
      const id = 'bsearg' + (passedIndex++);
      flowNodes.push({ id, location: call.caller, text: [...new Set(passed)].join(', '), source: call.source, line: call.line,
        depth: 3, stack: stackOfScope(call.caller), branch: false, type: 'parameter' });
      uniqueFlowEdge(callerOperation || rootMethod || 'bseroot', id, call.line);
      gate = id;
    }
    for (const target of call.targets || []) {
      const targetClass = className(target.label), child = flowClasses.get(targetClass), targetMethod = methodIdOf(target.label);
      if (!child) continue;
      if (callerClass === rootClass) { uniqueFlowEdge(gate || rootMethod || 'bseroot', child, call.line); uniqueFlowEdge(child, targetMethod, call.line); }
      else if (callerMethod) {
        if (targetClass === callerClass) uniqueFlowEdge(gate || callerMethod, targetMethod, call.line);
        else { uniqueFlowEdge(gate || callerMethod, child, call.line); uniqueFlowEdge(child, targetMethod, call.line); }
      }
    }
  }
  const originTitle = (graph.selectedVariable || '?') + ' Origin — Backward Symbolic Execution';
  // Everything the drawing needs, in one place: the shared flow script is a
  // file, not a template, so what the page used to interpolate into it - the
  // title, the BSE caption and tree, the two depth maxima - travels here.
  const mermaidGraph = { nodes: mermaidNodes, edges: mermaidEdges, formula: formulaGraph, bseFlow: { nodes: flowNodes, edges: flowEdges },
    originTitle, maxStack, maxLevel,
    bseFlowHtml: `<p class="edge">BSE FLOW${graph.flowBounds ? ` — breakpoints ${graph.flowBounds.from}–${graph.flowBounds.to}` : ''}</p>${bseFlowTree || '<p>No BSE flow points in the selected range.</p>'}` };
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSource}; script-src 'nonce-${nonce}' ${cspSource}"><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  button:not(.data-composed){width:100%;text-align:left;background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border:1px solid var(--vscode-focusBorder);padding:8px;cursor:pointer;white-space:normal;overflow:auto;max-height:85px}.flow-data{display:none}.data-composed{display:inline;width:auto;max-width:none;margin:0;padding:0;border:0;background:transparent;color:var(--vscode-textLink-foreground);font:inherit;text-decoration:underline;text-decoration-style:dotted;cursor:pointer}
  pre{white-space:pre-wrap}strong{font-family:var(--vscode-editor-font-family)}
  .children{border-left:1px solid var(--vscode-panel-border);margin-left:8px;padding-left:16px}.node,.leaf{margin:8px 0;padding:6px;background:var(--vscode-editorWidget-background)}summary{cursor:pointer;overflow-wrap:anywhere}code{white-space:pre-wrap;font-family:var(--vscode-editor-font-family);background:transparent!important}button.location{display:inline-block;width:auto;max-width:100%;padding:2px 5px;margin-left:6px;color:var(--vscode-textLink-foreground);border-color:var(--vscode-panel-border)}.code-location{font-family:var(--vscode-editor-font-family);font-weight:bold}.syntax-keyword{color:var(--vscode-symbolIcon-keywordForeground)}.syntax-string{color:var(--vscode-debugTokenExpression-stringForeground)}.syntax-number{color:var(--vscode-debugTokenExpression-numberForeground)}.flow-call{color:var(--vscode-textLink-foreground);text-decoration:underline;text-decoration-style:dotted;cursor:help}.edge,small{color:var(--vscode-descriptionForeground)}.unknown,.boundary,.warning{border-left:3px solid var(--vscode-editorWarning-foreground);padding-left:10px}.call-frame{margin:6px 0;padding:6px 8px;border-left:2px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.call-stack{margin:6px 0 0 10px;padding-left:12px;border-left:1px solid var(--vscode-panel-border);list-style:none}.analysis-log{max-height:560px;overflow:auto;user-select:text;padding:12px;background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-panel-border)}.flow-target{margin:5px 0;padding:8px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.flow-node{margin:3px 0}.flow-node>summary{list-style-position:outside}.flow-row{margin:3px 0;padding:5px;background:transparent!important}.flow-row.included{background:transparent!important}.flow-row.excluded{opacity:.75}.execution-node,.execution-leaf{display:block;margin:3px 0}.execution-node>summary{list-style:none}.execution-node>summary::-webkit-details-marker{display:none}.flow-toggle{display:inline-block;width:1em;margin-right:3px;color:var(--vscode-descriptionForeground);transition:transform .12s}.execution-node[open]>.flow-toggle{transform:rotate(90deg)}.execution-node[open]>summary>.flow-toggle{transform:rotate(90deg)}.execution-children{margin-left:18px;padding-left:10px;border-left:1px solid var(--vscode-panel-border)}.flow-children{margin-left:18px;border-left:1px solid var(--vscode-panel-border);padding-left:10px}.flow-input{padding:4px;color:var(--vscode-descriptionForeground)}.flow-condition{margin:3px 0;color:var(--vscode-descriptionForeground)}.help{position:absolute;right:8px;top:8px;z-index:50}.help summary{list-style:none;border:1px solid var(--vscode-focusBorder);padding:2px 8px;font-weight:bold}.help>div{display:none}.help[open]{position:fixed;inset:0;z-index:200;background:var(--vscode-editor-background);padding:20px;overflow:auto}.help[open] summary{float:right}.help[open]>div{display:block;clear:both;max-width:900px;margin:48px auto;padding:20px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border)}.debug-toggle{display:none}.debug-button{float:right;margin:8px;border:1px solid var(--vscode-focusBorder);padding:2px 8px}.debug-only{display:none}.debug-toggle:checked~.debug-only{display:block}.scenario{margin:8px 0;border:1px solid var(--vscode-panel-border)}.scenario label{margin:0 8px}.bse-workspace{height:calc(100vh - 125px);min-height:360px;margin-top:8px}.bse-view-toggle{display:flex;margin:0 0 8px}.bse-view-toggle button{width:auto;margin-right:4px}.bse-tree-pane,.bse-diagram-pane{height:calc(100% - 42px);overflow:auto}.mermaid-controls{margin:6px 0}.mermaid-controls button{width:auto;margin-right:4px}.mermaid-viewport{height:calc(100% - 46px);min-height:180px;overflow:auto;border:1px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background)}.mermaid-canvas{display:inline-block;padding:12px;transform-origin:top left}.mermaid-panel{height:100%}.mermaid-panel.fullscreen{position:fixed;inset:0;z-index:100;background:var(--vscode-editor-background);padding:12px}.mermaid-panel.fullscreen .mermaid-viewport{height:calc(100% - 48px)}
  </style>${styleSource ? `<link rel="stylesheet" href="${styleSource}">` : ''}</head><body><details class="help"><summary aria-label="Value origin help">?</summary><div><strong>Value origin</strong> traces static source dependencies backwards across calls. It proves source relationships, not runtime values: loop order, database contents and unknown dispatches remain boundaries. Expand a branch to inspect its inputs; click <code>&lt;/&gt;</code> to open source, Ctrl+Click to open beside. <strong>All branches</strong> shows every static alternative. Choosing a selection-screen radio button simulates that exclusive choice and hides other radio branches. Mermaid shows the same expanded branches: click a diagram node to expand or collapse it, double-click it to open source. Use the mouse wheel to zoom and drag empty space to pan. ${(graph.skipped || []).length ? `<p>Analysis boundaries kept outside the graph: ${escape(graph.skipped.join(', '))}</p>` : ''}</div></details><input id="debug-toggle" class="debug-toggle" type="checkbox"><label class="debug-button" for="debug-toggle" title="Show technical analysis sections">🐞</label><h2>Value origin — ACE backward analysis</h2>
  ${(graph.warnings || []).map(w => `<p class="warning">${escape(w)}</p>`).join('')}
  ${scenarioControls ? `<details class="scenario-panel"><summary>Simulate selection screen</summary>${scenarioControls}</details>` : ''}<div id="bse-workspace" class="bse-workspace"><template data-flow-pane="tree"><p class="edge">Execution flow${graph.flowBounds ? ` between breakpoints ${graph.flowBounds.from}–${graph.flowBounds.to}` : ''} — changes and parameter transfers to ${escape(graph.selectedVariable || '?')}</p>${aceExecution || '<p>ACE execution flow was not produced.</p>'}</template><template data-flow-pane="formula"><p class="edge">Formula derivation — click a branch to expand its input formulas</p>${formulaView}</template></div>
  <script id="mermaid-data" type="application/json">${JSON.stringify(mermaidGraph).replaceAll('<', '\\u003c')}</script>${flowSource ? `<script nonce="${nonce}" src="${flowSource}"></script>` : `<script nonce="${nonce}">${flowScript()}</script>`}
  <script nonce="${nonce}">(()=>{const state=${JSON.stringify(graph.restore || {}).replaceAll('<', '\\u003c')};if(!state.choice)return;const panel=document.querySelector('.scenario-panel');if(panel)panel.open=true;const selected=document.querySelector('.scenario input[value="'+state.choice+'"]');if(selected){selected.checked=true;selected.dispatchEvent(new Event('change',{bubbles:true}));}if(state.mode){document.querySelector('.bse-view-toggle [data-mode="'+state.mode+'"]').click();}if(state.view){document.querySelector('.bse-view-toggle [data-view="'+state.view+'"]').click();}})();</script>
  <details class="debug-only"><summary>BSE dependency tree (technical)</summary>${dependencyTree}</details><details class="debug-only"><summary>ACE source closure (${(graph.sourceClosure || []).length})</summary><p class="edge">These are the exact objects whose ACE index was loaded for this analysis. Missing factory or implementation here explains an unresolved call.</p><pre class="analysis-log">${escape((graph.sourceClosure || []).map(item => `${item.objectType || '?'} ${item.objectName || item.name} · ${item.name}`).join('\n') || 'No ACE sources were loaded.')}</pre></details>
  <details class="debug-only"><summary>Static call stack contributing to the selected value</summary><div class="call-stack">${callPath || '<p>No resolved calls.</p>'}</div></details>
  <details class="debug-only"><summary>ACE Flow traversal log (${(graph.flowLog || []).length})</summary><p class="edge">Only points reached while resolving the selected value are listed, with the edge that included each one.</p><button id="copy-flow" class="location">Copy log</button><div class="analysis-log">${fullLog || escape(analysisLog)}</div></details>
  ${mermaidSource ? `<script nonce="${nonce}" src="${mermaidSource}"></script>` : ''}<script nonce="${nonce}">const api=acquireVsCodeApi(),flowLog=${JSON.stringify(flowLogText).replaceAll('<', '\\u003c')};window.bseMermaidOpen=id=>api.postMessage({node:id});document.addEventListener('click',e=>{const b=e.target.closest('button[data-node]');if(b)api.postMessage({node:b.dataset.node,source:b.dataset.source,line:Number(b.dataset.line)||0,openBeside:e.ctrlKey||e.metaKey});});document.getElementById('copy-flow').addEventListener('click',async()=>{await navigator.clipboard.writeText(flowLog);document.getElementById('copy-flow').textContent='Copied';});const setScenario=active=>{document.querySelectorAll('[data-scenario]').forEach(node=>{node.hidden=!!active&&node.dataset.scenario!==active;if(node.hidden&&node.tagName==='DETAILS')node.open=false;});document.dispatchEvent(new Event('bse:scenario'));};document.querySelectorAll('.scenario input').forEach(input=>input.addEventListener('change',e=>setScenario(e.target.value)));const host=document.getElementById('mermaid-graph'),viewport=document.getElementById('mermaid-viewport'),panel=document.getElementById('mermaid-panel');let zoom=1,drag;const applyZoom=()=>{host.style.transform='scale('+zoom+')';host.style.marginRight=Math.max(0,(zoom-1)*host.offsetWidth)+'px';host.style.marginBottom=Math.max(0,(zoom-1)*host.offsetHeight)+'px';};const fit=()=>{const svg=host.querySelector('svg');if(!svg)return;const box=svg.viewBox.baseVal,width=box.width||svg.width.baseVal.value,height=box.height||svg.height.baseVal.value;zoom=Math.min(1,(viewport.clientWidth-32)/width,(viewport.clientHeight-70)/height);applyZoom();viewport.scrollLeft=0;viewport.scrollTop=0;};const changeZoom=amount=>{zoom=Math.max(.2,Math.min(3,zoom+amount));applyZoom();};document.getElementById('mermaid-out').onclick=()=>changeZoom(-.2);document.getElementById('mermaid-in').onclick=()=>changeZoom(.2);document.getElementById('mermaid-fit').onclick=fit;document.getElementById('mermaid-full').onclick=()=>{panel.classList.toggle('fullscreen');document.getElementById('mermaid-full').textContent=panel.classList.contains('fullscreen')?'Exit full screen':'Full screen';requestAnimationFrame(fit);};viewport.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.2,Math.min(3,zoom*Math.exp(-e.deltaY*.001)));applyZoom();},{passive:false});viewport.addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('g.node,button'))return;drag={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};});document.addEventListener('mousemove',e=>{if(!drag)return;viewport.scrollLeft=drag.left-(e.clientX-drag.x);viewport.scrollTop=drag.top-(e.clientY-drag.y);});document.addEventListener('mouseup',()=>{drag=null;});document.addEventListener('bse:mermaid-rendered',()=>requestAnimationFrame(fit));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('fullscreen')){panel.classList.remove('fullscreen');document.getElementById('mermaid-full').textContent='Full screen';requestAnimationFrame(fit);}});if(typeof mermaid==='undefined'){host.textContent='Mermaid library is unavailable.';}else{mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'dark',flowchart:{htmlLabels:false,useMaxWidth:false}});document.dispatchEvent(new Event('bse:mermaid-ready'));}</script></body></html>`;
}
function register(vscode, context, getSources) {
  // Reopening the same origin must not repeat a complete remote ACE closure.
  // Keep it deliberately short-lived: an edit, another cursor target or a
  // breakpoint change gets a new graph, while an accidental close/reopen is
  // immediate.
  let recentAnalysis;
  context.subscriptions.push(vscode.commands.registerCommand('vertex.valueOrigin', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) throw new Error('Select a variable in an ABAP source editor.');
      const variable = variableAt(editor.document.getText(), editor.document.offsetAt(editor.selection.active));
      if (!variable) throw new Error('Place the cursor on a variable.');
      const target = { source: editor.document.uri.toString(), line: editor.selection.active.line + 1, column: editor.selection.active.character, variable };
      const points = (vscode.debug.breakpoints || []).filter(point => point.enabled !== false && point.location?.uri?.toString() === target.source)
        .map(point => point.location.range.start.line + 1).sort((left, right) => left - right);
      const from = points.filter(line => line <= target.line).at(-1), to = points.find(line => line >= target.line);
      if (Number.isInteger(from) && Number.isInteger(to) && from < to) target.flowBounds = { source: target.source, from, to };
      const cacheKey = JSON.stringify([target.source, editor.document.version, target.line, target.column, target.variable, target.flowBounds || null]);
      let loaded, graph;
      if (recentAnalysis?.key === cacheKey && recentAnalysis.expiresAt > Date.now()) {
        ({ loaded, graph } = recentAnalysis);
      } else {
        loaded = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Value origin — ACE call index', cancellable: true },
          (progress, token) => getSources(editor.document, target, name => progress.report({ message: name }), () => token.isCancellationRequested));
        const sources = loaded.sources;
        graph = analyze(sources, { ...loaded.target, flowBounds: target.flowBounds });
        graph.warnings = loaded.warnings;
        graph.skipped = loaded.skipped;
        graph.sourceClosure = sources.map(source => ({ name: source.name, objectName: source.aceOwner || source.objectName, objectType: source.aceOwner ? source.aceOwnerType : source.objectType }));
        graph.nodes.forEach(n => { n.sourceName = sources.find(s => s.id === n.source)?.name || n.source; });
        recentAnalysis = { key: cacheKey, expiresAt: Date.now() + 30000, loaded, graph };
      }
      const sources = loaded.sources, originViewColumn = editor.viewColumn || vscode.ViewColumn.One;
      const panel = vscode.window.createWebviewPanel('vertex.valueOrigin', 'Value origin', vscode.ViewColumn.Beside, { enableScripts: true });
      const mermaid = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'resources', 'mermaid.min.js')).toString() : '';
      const styles = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'value-origin.css')).toString() : '';
      // The flow - tree, diagram and the controls over both - is one script for
      // every VERTEX view that draws one; this page supplies the graph only.
      const flowScript = panel.webview.asWebviewUri && context.extensionUri ? panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'resources', 'vertex-flow.js')).toString() : '';
      panel.webview.html = html(graph, require('crypto').randomBytes(18).toString('hex'), mermaid, panel.webview.cspSource || '', styles, flowScript);
      panel.webview.onDidReceiveMessage(async message => {
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
