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
  const flowItems = (graph.executionFlow || []).map((step, index) => ({ step, index, children: [] })), flowRoots = [], executionStack = [];
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
  const formulaSeen = new Set();
  const isInvocationResult = node => node?.kind === 'calculation' && /=\s*(?:NEW\s+)?[A-Za-z_]\w*(?:\s*\([^)]*\))?\s*(?:->|=>)/i.test(node.text || '');
  const isDataTransfer = node => /^\s*(?:DATA\s*\(\s*)?[A-Za-z_]\w*(?:-[A-Za-z_]\w*)?\s*\)?\s*=\s*[A-Za-z_]\w*(?:-[A-Za-z_]\w*)?\s*\.\s*$/i.test(node?.text || '');
  const isTechnicalValue = node => node?.kind === 'value' && /^(?:LO_|LT_|LS_STEP|RT_|RO_)/i.test(node.text || '');
  const formulaInputs = nodeId => (graph.edges || []).filter(edge => edge.to === nodeId).map(edge => bseById.get(edge.from)).filter(node => node?.kind === 'value' && !isTechnicalValue(node));
  const formulaDefinitions = (valueId, visited = new Set()) => {
    if (!valueId || visited.has(valueId)) return [];
    const next = new Set(visited).add(valueId);
    return (graph.edges || []).filter(edge => edge.to === valueId).flatMap(edge => {
      const node = bseById.get(edge.from);
      if (!node) return [];
      if (['calculation', 'select'].includes(node.kind) && !isInvocationResult(node)) return isDataTransfer(node) ? formulaInputs(node.id).flatMap(input => formulaDefinitions(input.id, next)) : [node];
      if (node.kind === 'calculation' && isInvocationResult(node)) return formulaDefinitions(node.id, next);
      if (['call', 'parameter'].includes(node.kind)) return formulaInputs(node.id).flatMap(input => formulaDefinitions(input.id, next));
      if (node.kind === 'loop') return formulaInputs(node.id).flatMap(input => formulaDefinitions(input.id, next));
      return [];
    });
  };
  const formulaSteps = (valueId, depth = 0) => {
    if (!valueId || formulaSeen.has(valueId) || depth > 40) return '';
    formulaSeen.add(valueId);
    const definitions = formulaDefinitions(valueId);
    return definitions.map(definition => {
      const step = { text: definition.text, calculated: [], composed: [] };
      const inputs = formulaInputs(definition.id).map(node => node.id);
      const children = inputs.map(input => formulaSteps(input, depth + 1)).join(''), caption = `<span class="formula-expression">${dataFormula(step)}</span><button class="location code-location" title="Open this formula in source; Ctrl+Click opens beside" data-node="${escape(definition.id)}" data-source="${escape(definition.source)}" data-line="${definition.line}">&lt;/&gt;</button>`;
      return children ? `<details class="formula-node"${depth === 0 ? ' open' : ''}><summary>${caption}</summary><div class="formula-children">${children}</div></details>` : `<div class="formula-leaf">${caption}</div>`;
    }).join('');
  };
  const formulaView = formulaSteps(graph.root) || '<p class="edge">No symbolic formula was resolved for this value.</p>';
  const flowCode = step => {
    const text = codeFormula(step), targets = (step.targets || []).map(target => target.label).join(' | ');
    if (step.type !== 'call' || !targets) return text;
    const methods = (step.targets || []).map(target => String(target.label).split('->').at(-1).split('~').at(-1)).filter(Boolean);
    const pattern = methods.map(method => method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return pattern ? text.replace(new RegExp(`\\b[\\w-]+(?:-&gt;|=&gt;)(?:${pattern})\\b`, 'ig'), match => `<span class="flow-call" title="${escape(targets)}">${match}</span>`) : text;
  };
  const isEmptyConstructor = step => /^\s*(?:DATA\s*\(\s*)?[A-Za-z_]\w*(?:-[A-Za-z_]\w*)?\s*\)?\s*=\s*NEW\s+[A-Za-z_]\w*(?:=>[A-Za-z_]\w*)?\s*\(\s*\)\s*\.\s*$/i.test(step.text || step.caller || '');
  const executionItem = item => {
    const caption = `<span class="flow-row included"><code><span class="flow-code">${flowCode(item.step)}</span><span class="flow-data">${dataFormula(item.step)}</span></code>${sourceButton(item)}</span>`;
    return item.children.length ? `<details class="execution-node" data-flow="${item.index}"><summary><span class="flow-toggle" aria-hidden="true">▶</span>${caption}</summary><div class="execution-children">${item.children.map(executionItem).join('')}</div></details>` : `<div class="execution-leaf${isEmptyConstructor(item.step) ? ' data-technical' : ''}" data-flow="${item.index}">${caption}</div>`;
  };
  const aceExecution = flowRoots.map(executionItem).join('');
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
  const mermaidNodes = (graph.executionFlow || []).map((step, index) => ({
    id: 'flow' + index, location: step.type === 'call' ? step.caller : step.scope,
    line: step.line, text: step.text || step.caller, dataText: dataText(step), source: step.source, depth: step.depth || 0
  }));
  const mermaidEdges = [], callerStack = [];
  mermaidNodes.forEach(node => {
    callerStack.length = Math.min(callerStack.length, node.depth + 1);
    const caller = callerStack[node.depth - 1];
    if (caller) mermaidEdges.push({ from: caller.id, to: node.id, label: '' });
    callerStack[node.depth] = node;
  });
  const mermaidGraph = { nodes: mermaidNodes, edges: mermaidEdges };
  const originTitle = (graph.selectedVariable || '?') + ' Origin — Backward Symbolic Execution';
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}"><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  button{width:100%;text-align:left;background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border:1px solid var(--vscode-focusBorder);padding:8px;cursor:pointer;white-space:normal;overflow:auto;max-height:85px}
  pre{white-space:pre-wrap}strong{font-family:var(--vscode-editor-font-family)}
  .children{border-left:1px solid var(--vscode-panel-border);margin-left:8px;padding-left:16px}.node,.leaf{margin:8px 0;padding:6px;background:var(--vscode-editorWidget-background)}summary{cursor:pointer;overflow-wrap:anywhere}code{white-space:pre-wrap;font-family:var(--vscode-editor-font-family);background:transparent!important}.location{width:auto;max-width:100%;padding:2px 5px;margin-left:6px;color:var(--vscode-textLink-foreground);border-color:var(--vscode-panel-border)}.code-location{font-family:var(--vscode-editor-font-family);font-weight:bold}.syntax-keyword{color:var(--vscode-symbolIcon-keywordForeground)}.syntax-string{color:var(--vscode-debugTokenExpression-stringForeground)}.syntax-number{color:var(--vscode-debugTokenExpression-numberForeground)}.flow-call{color:var(--vscode-textLink-foreground);text-decoration:underline;text-decoration-style:dotted;cursor:help}.edge,small{color:var(--vscode-descriptionForeground)}.unknown,.boundary,.warning{border-left:3px solid var(--vscode-editorWarning-foreground);padding-left:10px}.call-frame{margin:6px 0;padding:6px 8px;border-left:2px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.call-stack{margin:6px 0 0 10px;padding-left:12px;border-left:1px solid var(--vscode-panel-border);list-style:none}.analysis-log{max-height:560px;overflow:auto;user-select:text;padding:12px;background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-panel-border)}.flow-target{margin:5px 0;padding:8px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-editorWidget-background)}.flow-node{margin:3px 0}.flow-node>summary{list-style-position:outside}.flow-row{margin:3px 0;padding:5px;background:transparent!important}.flow-row.included{background:transparent!important}.flow-row.excluded{opacity:.75}.execution-node,.execution-leaf{display:block;margin:3px 0}.execution-node>summary{list-style:none}.execution-node>summary::-webkit-details-marker{display:none}.flow-toggle{display:inline-block;width:1em;margin-right:3px;color:var(--vscode-descriptionForeground);transition:transform .12s}.execution-node[open]>.flow-toggle{transform:rotate(90deg)}.execution-node[open]>summary>.flow-toggle{transform:rotate(90deg)}.execution-children{margin-left:18px;padding-left:10px;border-left:1px solid var(--vscode-panel-border)}.flow-children{margin-left:18px;border-left:1px solid var(--vscode-panel-border);padding-left:10px}.flow-input{padding:4px;color:var(--vscode-descriptionForeground)}.flow-condition{margin:3px 0;color:var(--vscode-descriptionForeground)}.help{position:absolute;right:8px;top:8px;z-index:50}.help summary{list-style:none;border:1px solid var(--vscode-focusBorder);padding:2px 8px;font-weight:bold}.help>div{display:none}.help[open]{position:fixed;inset:0;z-index:200;background:var(--vscode-editor-background);padding:20px;overflow:auto}.help[open] summary{float:right}.help[open]>div{display:block;clear:both;max-width:900px;margin:48px auto;padding:20px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border)}.debug-toggle{display:none}.debug-button{float:right;margin:8px;border:1px solid var(--vscode-focusBorder);padding:2px 8px}.debug-only{display:none}.debug-toggle:checked~.debug-only{display:block}.scenario{margin:8px 0;border:1px solid var(--vscode-panel-border)}.scenario label{margin:0 8px}.bse-workspace{height:calc(100vh - 125px);min-height:360px;margin-top:8px}.bse-view-toggle{display:flex;margin:0 0 8px}.bse-view-toggle button{width:auto;margin-right:4px}.bse-view-toggle button.active{outline:1px solid var(--vscode-focusBorder);background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.bse-tree-pane,.bse-diagram-pane{height:calc(100% - 42px);overflow:auto}.mermaid-controls{margin:6px 0}.mermaid-controls button{width:auto;margin-right:4px}.mermaid-viewport{height:calc(100% - 46px);min-height:180px;overflow:auto;border:1px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background)}.mermaid-canvas{display:inline-block;padding:12px;transform-origin:top left}.mermaid-panel{height:100%}.mermaid-panel.fullscreen{position:fixed;inset:0;z-index:100;background:var(--vscode-editor-background);padding:12px}.mermaid-panel.fullscreen .mermaid-viewport{height:calc(100% - 48px)}
  </style></head><body><details class="help"><summary aria-label="Value origin help">?</summary><div><strong>Value origin</strong> traces static source dependencies backwards across resolved calls. It proves source relationships, not runtime values: loop order, database contents and unknown dispatches remain boundaries. Expand a branch to inspect its inputs; click <code>&lt;/&gt;</code> to open source, Ctrl+Click to open beside. <strong>All branches</strong> shows every static alternative. Choosing a selection-screen radio button simulates that exclusive choice and hides other radio branches. Mermaid shows the same expanded branches: click a diagram node to expand or collapse it, double-click it to open source. Use the mouse wheel to zoom and drag empty space to pan. ${(graph.skipped || []).length ? `<p>Analysis boundaries kept outside the graph: ${escape(graph.skipped.join(', '))}</p>` : ''}</div></details><input id="debug-toggle" class="debug-toggle" type="checkbox"><label class="debug-button" for="debug-toggle" title="Show technical analysis sections">🐞</label><h2>Value origin — ACE backward analysis</h2>
  ${(graph.warnings || []).map(w => `<p class="warning">${escape(w)}</p>`).join('')}
  ${scenarioControls ? `<details class="scenario-panel"><summary>Simulate selection screen</summary>${scenarioControls}</details>` : ''}<div id="bse-workspace" class="bse-workspace"><div class="bse-view-toggle" role="tablist" aria-label="Value origin view"><button class="active" data-view="tree" role="tab" aria-selected="true">Tree</button><button data-view="diagram" role="tab" aria-selected="false">Diagram</button></div><div id="bse-tree-pane" class="bse-tree-pane"><p class="edge">Execution flow — changes and parameter transfers to ${escape(graph.selectedVariable || '?')}</p>${aceExecution || '<p>ACE execution flow was not produced.</p>'}</div><div id="bse-formula-pane" class="bse-formula-pane" hidden><p class="edge">Formula derivation — click a branch to expand its input formulas</p>${formulaView}</div><div id="bse-diagram-pane" class="bse-diagram-pane" hidden><div id="mermaid-panel" class="mermaid-panel"><div class="mermaid-controls" role="toolbar" aria-label="Diagram layout and zoom"><button class="active" data-mermaid-direction="TD" title="Caller above callee">↓ Top-down</button><button data-mermaid-direction="LR" title="Caller left of callee">→ Left-right</button><button id="mermaid-lens" title="Toggle magnifier over a node" aria-label="Toggle magnifier" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 4 4" stroke="currentColor" stroke-width="1.5"/></svg></button><label class="mermaid-zoom" title="Diagram zoom"><input id="mermaid-zoom" type="range" min="10" max="100" value="100" step="1" aria-label="Diagram zoom"><output id="mermaid-zoom-value">100%</output></label><button id="mermaid-fit" title="Fit diagram">Fit</button><button id="mermaid-out" hidden>−</button><button id="mermaid-in" hidden>+</button><button id="mermaid-full" hidden>Full screen</button></div><div id="mermaid-viewport" class="mermaid-viewport"><div id="mermaid-graph" class="mermaid-canvas"></div></div></div></div></div>
  <script id="mermaid-data" type="application/json">${JSON.stringify(mermaidGraph).replaceAll('<', '\\u003c')}</script><script nonce="${nonce}">
  (()=>{
    const heading=document.querySelector('h2');heading.textContent=${JSON.stringify(originTitle)};heading.insertAdjacentElement('afterend',document.querySelector('.bse-view-toggle'));
    const host=document.getElementById('mermaid-graph'),graph=JSON.parse(document.getElementById('mermaid-data').textContent),treePane=document.getElementById('bse-tree-pane'),formulaPane=document.getElementById('bse-formula-pane'),diagramPane=document.getElementById('bse-diagram-pane');
    const visible=()=>new Set([...document.querySelectorAll('[data-flow]')].filter(element=>{
      let parent=element.parentElement;
      while(parent){if(parent.matches('details.execution-node')&&!parent.open)return false;parent=parent.parentElement;}
      return true;
    }).map(element=>'flow'+element.dataset.flow));
    let sequence=0,generation=0,toggleTimer,direction='TD',lensZoom=2.5,lensEnabled=false,lensElement;
    const themeColor=(name,fallback)=>getComputedStyle(document.body).getPropertyValue(name).trim()||fallback;
    const applyDiagramTheme=svg=>{if(!svg)return;const background=themeColor('--vscode-editor-background','#ffffff'),foreground=themeColor('--vscode-editor-foreground','#111111'),surface=themeColor('--vscode-editorWidget-background',background),border=themeColor('--vscode-panel-border',foreground),line=themeColor('--vscode-descriptionForeground',foreground),style=document.createElementNS('http://www.w3.org/2000/svg','style');svg.style.background=background;host.style.background=background;document.getElementById('mermaid-viewport').style.background=background;style.textContent='g.node:not(.bse-expandable) rect,g.node:not(.bse-expandable) polygon,g.node:not(.bse-expandable) path{fill:'+surface+'!important;stroke:'+border+'!important}g.node text,g.node tspan,.edgeLabel text,.edgeLabel tspan{fill:'+foreground+'!important}.edgePath path,.flowchart-link{stroke:'+line+'!important}.edgeLabel rect{fill:'+background+'!important}g.node.bse-navigable rect{stroke:'+themeColor('--vscode-textLink-foreground',border)+'!important;stroke-width:2px!important}g.node.bse-expandable rect{fill:'+surface+'!important;stroke:'+themeColor('--vscode-focusBorder',border)+'!important;stroke-width:3px!important;stroke-dasharray:4 2}';svg.prepend(style);};
    // Same lens as UML, Calls and Logic: an inert SVG copy over the hovered
    // node. It never changes the diagram's own zoom or position.
    const installUmlLens=svg=>{document.querySelectorAll('.uml-lens').forEach(old=>old.remove());lensElement=undefined;if(!svg)return;const lens=document.createElement('div'),copy=svg.cloneNode(true),badge=document.createElement('span'),radius=90;lens.className='uml-lens';lens.setAttribute('aria-hidden','true');badge.className='uml-lens-zoom';badge.textContent=lensZoom.toFixed(1)+'×';lens.append(copy,badge);document.body.append(lens);lensElement=lens;const isNode=element=>{while(element&&element!==svg){if(element.matches&&element.matches('g.node'))return true;element=element.parentNode;}return false;};const hide=()=>lens.style.display='none';const move=event=>{if(!lensEnabled||!isNode(event.target)){hide();return;}const source=svg.getBoundingClientRect(),box=svg.viewBox?.baseVal,scale=box?.width?source.width/box.width:1;if(!source.width||!source.height||14*scale>=11){hide();return;}lens.style.left=Math.max(8,Math.min(window.innerWidth-radius*2-8,event.clientX+16))+'px';lens.style.top=Math.max(8,Math.min(window.innerHeight-radius*2-8,event.clientY+16))+'px';copy.style.width=Math.round(source.width*lensZoom)+'px';copy.style.height=Math.round(source.height*lensZoom)+'px';copy.style.left=Math.round(radius-(event.clientX-source.left)*lensZoom)+'px';copy.style.top=Math.round(radius-(event.clientY-source.top)*lensZoom)+'px';lens.style.display='block';};svg.addEventListener('pointermove',move);svg.addEventListener('pointerleave',hide);svg.addEventListener('wheel',event=>{if(!lensEnabled||!event.shiftKey||lens.style.display!=='block')return;event.preventDefault();event.stopPropagation();const delta=Math.abs(event.deltaY)>=Math.abs(event.deltaX)?event.deltaY:event.deltaX;lensZoom=Math.max(1.5,Math.min(6,lensZoom*Math.exp(-delta*.01)));badge.textContent=lensZoom.toFixed(1)+'×';move(event);},{passive:false});};
    const rebuild=()=>{
      const current=++generation,shown=visible(),active=document.querySelector('.scenario input:checked')?.value||'';
      if(!shown.size)graph.nodes.filter(node=>!graph.edges.some(edge=>edge.to===node.id)).forEach(node=>shown.add(node.id));
      const nodes=graph.nodes.filter(node=>shown.has(node.id)&&(!active||!node.scenario||node.scenario===active)),ids=new Set(nodes.map(node=>node.id));
      const flowEdges=graph.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to));
      host.style.display='inline-block';if(!nodes.length){host.textContent='No visible flow nodes.';return;}if(typeof mermaid==='undefined')return;
      const quote=value=>String(value||'').replaceAll('"',"'"),dataMode=document.body.classList.contains('data-mode');
      const text=['flowchart '+direction,...nodes.map(node=>node.id+'["'+quote(node.location)+'\\n'+quote(dataMode?node.dataText:node.text)+'"]'),...flowEdges.map(edge=>'  '+edge.from+' --> '+edge.to),...nodes.map(node=>'  click '+node.id+' bseMermaidToggle "Toggle"')].join('\\n');
      mermaid.render('bse-expanded-'+(++sequence),text).then(result=>{if(current!==generation)return;host.innerHTML=result.svg;result.bindFunctions&&result.bindFunctions(host);const svg=host.querySelector('svg');applyDiagramTheme(svg);const expandable=new Set(flowEdges.map(edge=>edge.from));host.querySelectorAll('g.node').forEach(element=>{const node=graph.nodes.find(item=>element.id===item.id||element.id.startsWith(item.id+'-'));if(!node)return;element.dataset.bseNode=node.id;element.classList.add('bse-navigable');element.setAttribute('title',expandable.has(node.id)?'Click to expand or collapse; click </> or double-click to open source':'Click </> or double-click to open source');if(expandable.has(node.id))element.classList.add('bse-expandable');{const box=element.getBBox(),link=document.createElementNS('http://www.w3.org/2000/svg','text');link.setAttribute('x',String(box.x+box.width-28));link.setAttribute('y',String(box.y+14));link.setAttribute('class','bse-code-link');link.textContent='</>';link.setAttribute('title','Open source');link.addEventListener('click',event=>{event.stopPropagation();window.bseMermaidOpen(node.id);});link.addEventListener('dblclick',event=>{event.stopPropagation();window.bseMermaidOpen(node.id);});element.append(link);}});installUmlLens(svg);document.dispatchEvent(new Event('bse:mermaid-rendered'));}).catch(error=>{if(current===generation)host.textContent='Mermaid: '+error.message;});
    };
    window.bseMermaidToggle=id=>{clearTimeout(toggleTimer);toggleTimer=setTimeout(()=>{const index=String(id).replace(/^flow/,'');const node=document.querySelector('[data-flow="'+index+'"]');if(node?.tagName==='DETAILS'){if(!node.open)node.querySelectorAll('details.execution-node[open]').forEach(child=>child.open=false);node.open=!node.open;}},220);};
    const mermaidNode=event=>event.target.closest?.('g.node[data-bse-node]');
    host.addEventListener('click',event=>{if(event.target.closest?.('.bse-code-link'))return;const element=mermaidNode(event);if(!element)return;event.preventDefault();event.stopPropagation();if(element.classList.contains('bse-expandable'))window.bseMermaidToggle(element.dataset.bseNode);},true);
    host.addEventListener('dblclick',event=>{if(event.target.closest?.('.bse-code-link'))return;const element=mermaidNode(event);if(!element)return;event.preventDefault();event.stopPropagation();clearTimeout(toggleTimer);window.bseMermaidOpen(element.dataset.bseNode);},true);
    const selectView=view=>{if(!formulaPane.hidden)selectMode('code');const diagram=view==='diagram';treePane.hidden=diagram;diagramPane.hidden=!diagram;document.querySelectorAll('.bse-view-toggle [data-view]').forEach(button=>{const selected=button.dataset.view===view;button.classList.toggle('active',selected);button.setAttribute('aria-selected',selected);});if(diagram){rebuild();requestAnimationFrame(()=>document.getElementById('mermaid-fit').click());}};
    document.querySelectorAll('.bse-view-toggle [data-view]').forEach(button=>button.addEventListener('click',()=>selectView(button.dataset.view)));
    const style=document.createElement('style');style.textContent='h2{font-size:1em;margin:8px 0 10px}.flow-data{display:none;color:var(--vscode-foreground)}body.data-mode .flow-code{display:none}body.data-mode .flow-data{display:inline}.data-calculated{color:var(--vscode-symbolIcon-variableForeground);font-weight:600}.data-composed{color:var(--vscode-textLink-foreground);text-decoration:underline;text-decoration-style:dotted}.flow-data button.data-composed{width:auto;max-width:none;margin:0;padding:0;border:0;background:transparent;color:var(--vscode-textLink-foreground);cursor:pointer;font:inherit;text-decoration:underline;text-decoration-style:dotted}.bse-view-toggle{display:flex;gap:16px;margin:0 0 8px}.bse-view-toggle [role="tablist"],.mermaid-controls{display:flex;gap:4px;align-items:center}.bse-view-toggle [role="tab"],.mermaid-controls button{--accent:var(--vscode-focusBorder);width:auto;border:0!important;border-bottom:2px solid transparent!important;border-radius:6px;padding:3px 12px;background:var(--vscode-input-background)!important;color:var(--vscode-descriptionForeground);box-shadow:none}.bse-view-toggle [role="tab"]:hover,.mermaid-controls button:hover{color:var(--vscode-foreground)}.bse-view-toggle [role="tab"].active,.mermaid-controls [data-mermaid-direction].active,.mermaid-controls #mermaid-lens.active{color:var(--vscode-foreground);border-bottom-color:var(--accent)!important;box-shadow:0 3px 8px -3px var(--accent)}.mermaid-controls button{padding:3px 8px}.mermaid-controls #mermaid-lens{display:inline-flex;align-items:center;padding:3px 7px}.mermaid-controls #mermaid-lens svg{width:15px;height:15px}.mermaid-zoom{display:inline-flex;align-items:center;gap:5px;color:var(--vscode-descriptionForeground);font-size:12px}.mermaid-zoom input{appearance:none;width:100px;height:4px;border-radius:2px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));accent-color:var(--vscode-focusBorder)}.mermaid-zoom input::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--vscode-input-background)}.mermaid-zoom input::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-6px;border-radius:50%;background:var(--vscode-focusBorder);border:1px solid var(--vscode-editor-background)}.mermaid-zoom output{min-width:3.2em;text-align:right;font-family:var(--vscode-editor-font-family)}#mermaid-graph g.node.bse-navigable{cursor:pointer}#mermaid-graph g.node.bse-expandable rect{stroke:var(--vscode-focusBorder)!important;stroke-width:3px!important;stroke-dasharray:4 2}#mermaid-graph .bse-code-link{fill:var(--vscode-textLink-foreground);font-family:var(--vscode-editor-font-family);font-size:13px;font-weight:700;cursor:pointer;text-decoration:underline}.uml-lens{position:fixed;width:180px;height:180px;border-radius:50%;overflow:hidden;pointer-events:none;z-index:10;display:none;border:2px solid var(--vscode-input-border,var(--vscode-panel-border));background:var(--vscode-editor-background);box-shadow:0 4px 14px #0006}.uml-lens svg{position:absolute;max-width:none}.uml-lens-zoom{position:absolute;right:22px;bottom:14px;z-index:1;padding:0 5px;border-radius:8px;font-size:11px;color:var(--vscode-foreground);background:var(--vscode-editor-background);opacity:.85}.bse-workspace{height:calc(100vh - 150px)}.bse-tree-pane,.bse-diagram-pane{height:100%}';document.head.append(style);
    const formulaStyle=document.createElement('style');formulaStyle.textContent='.bse-formula-pane{height:100%;overflow:auto}.formula-node{margin:5px 0}.formula-node summary{cursor:pointer}.formula-children{margin-left:18px;padding-left:10px;border-left:1px solid var(--vscode-panel-border)}.formula-leaf{margin:5px 0}.formula-expression{font-family:var(--vscode-editor-font-family);white-space:pre-wrap}.formula-node[open]>summary::marker{color:var(--vscode-focusBorder)}body.data-mode .data-technical{display:none}button.data-composed{display:inline!important;width:auto!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;color:var(--vscode-textLink-foreground)!important;cursor:pointer;font:inherit;text-decoration:underline;text-decoration-style:dotted}';document.head.append(formulaStyle);document.addEventListener('bse:mermaid-rendered',()=>requestAnimationFrame(()=>document.querySelectorAll('#mermaid-graph g.node.bse-expandable rect').forEach(rect=>{rect.style.setProperty('stroke','var(--vscode-focusBorder)','important');rect.style.setProperty('stroke-width','3px','important');rect.style.setProperty('stroke-dasharray','none','important');})));
    const modeToggle=document.createElement('div');modeToggle.setAttribute('role','tablist');modeToggle.setAttribute('aria-label','Value origin content');modeToggle.innerHTML='<button class="active" data-mode="code" role="tab" aria-selected="true">Code</button><button data-mode="data" role="tab" aria-selected="false">Data</button><button data-mode="formula" role="tab" aria-selected="false">Formula</button>';document.querySelector('.bse-view-toggle').append(modeToggle);
    const selectMode=mode=>{const data=mode==='data',formula=mode==='formula',diagram=document.querySelector('.bse-view-toggle [data-view].active')?.dataset.view==='diagram';document.body.classList.toggle('data-mode',data);document.body.classList.toggle('formula-mode',formula);formulaPane.hidden=!formula;treePane.hidden=formula||diagram;diagramPane.hidden=formula||!diagram;modeToggle.querySelectorAll('[data-mode]').forEach(button=>{const selected=button.dataset.mode===mode;button.classList.toggle('active',selected);button.setAttribute('aria-selected',selected);});if(!formula)rebuild();};modeToggle.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>selectMode(button.dataset.mode)));document.querySelectorAll('[data-mermaid-direction]').forEach(button=>button.addEventListener('click',()=>{direction=button.dataset.mermaidDirection;document.querySelectorAll('[data-mermaid-direction]').forEach(item=>item.classList.toggle('active',item===button));rebuild();requestAnimationFrame(()=>document.getElementById('mermaid-fit').click());}));const lensButton=document.getElementById('mermaid-lens');lensButton.addEventListener('click',()=>{lensEnabled=!lensEnabled;lensButton.classList.toggle('active',lensEnabled);lensButton.setAttribute('aria-pressed',String(lensEnabled));if(!lensEnabled&&lensElement)lensElement.style.display='none';});const zoomSlider=document.getElementById('mermaid-zoom'),zoomValue=document.getElementById('mermaid-zoom-value');const syncZoom=()=>{const value=Number((host.style.transform.match(/scale\\(([^)]+)\\)/)||[])[1]||1);zoomSlider.value=String(Math.round(value*100));zoomValue.value=Math.round(value*100)+'%';zoomValue.textContent=zoomValue.value;};zoomSlider.addEventListener('input',()=>{const value=Number(zoomSlider.value)/100;host.style.transform='scale('+value+')';host.style.marginRight=Math.max(0,(value-1)*host.offsetWidth)+'px';host.style.marginBottom=Math.max(0,(value-1)*host.offsetHeight)+'px';zoomValue.value=zoomSlider.value+'%';zoomValue.textContent=zoomValue.value;});document.getElementById('mermaid-fit').addEventListener('click',()=>setTimeout(syncZoom));document.addEventListener('bse:mermaid-rendered',()=>setTimeout(syncZoom));
    document.querySelectorAll('details.execution-node').forEach(node=>node.addEventListener('toggle',rebuild));document.addEventListener('bse:scenario',rebuild);document.addEventListener('bse:mermaid-ready',rebuild);let themeTimer;new MutationObserver(()=>{clearTimeout(themeTimer);themeTimer=setTimeout(()=>{if(!diagramPane.hidden)rebuild();},80);}).observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});
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
        const flowIndex = /^flow(\d+)$/.exec(message?.node || '');
        const n = flowIndex ? graph.executionFlow[Number(flowIndex[1])] : graph.nodes.find(n => message && n.id === message.node);
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
