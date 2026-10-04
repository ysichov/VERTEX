"use strict";
/* The derivation of a value as formulas: the one algorithm behind the Formula view of Value origin and of the debugger's
   analysis. It reads the analysis graph (nodes, edges, root, flowBounds) and gives the formula graph - one node per
   definition, with the level it is first reached at - and the tree of the derivation, a definition under every
   branch that reads it. How the tree is drawn is the view's own. */

// How deep a routine stands in the calls from the entry program.
function scopeStacks(graph) {
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
  const maxStack = Math.max(0, ...scopeDepth.values());
  return { stackOfScope, maxStack };
}

/* CONV and CAST change the type of a value, not what it is computed from: they are left out of a formula, and the brackets
   round the converted expression stay only where they hold more than one operand. Returns the indexes of tokens to drop. */
function conversions(tokens) {
  const { variablePaths } = require('./value-origin-model');
  const dropped = [];
  for (let i = 0; i < tokens.length; i++) {
    const word = String(tokens[i].value).toUpperCase();
    if (word !== 'CONV' && word !== 'CAST') { continue; }
    const open = tokens.findIndex((token, j) => j > i && j <= i + 3 && token.value === '(');
    if (open < 0) { continue; }
    let depth = 0, close = -1;
    for (let j = open; j < tokens.length; j++) { if (tokens[j].value === '(') depth++; if (tokens[j].value === ')' && --depth === 0) { close = j; break; } }
    if (close < 0) { continue; }
    const inner = tokens.slice(open + 1, close), paths = variablePaths(inner);
    const simple = inner.length === 1 || (paths.length === 1 && paths[0].from === 0 && paths[0].to === inner.length);
    for (let j = i; j < open; j++) { dropped.push(j); }
    if (simple) { dropped.push(open, close); }
  }
  return dropped;
}
// A statement's text without its conversions.
function withoutConversions(text) {
  const tokens = require('./value-origin-tokens').tokenize(text), dropped = conversions(tokens);
  if (!dropped.length) { return text; }
  let out = '', at = 0;
  for (const index of dropped) { out += text.slice(at, tokens[index].offset); at = tokens[index].endOffset; }
  return (out + text.slice(at)).split(/\s+/).join(' ').trim();
}

function formula(graph) {
  const { stackOfScope } = scopeStacks(graph);
  const bseById = new Map((graph.nodes || []).map(node => [node.id, node]));
  const canonical = value => String(value || '').toUpperCase().replace(/\s+/g, '');
  const formulaGraph = { nodes: [], edges: [] };
  // A formula node is read as an expression, not as the statement it came from.
  // An assignment already reads as one; a SELECT is reduced to what it takes
  // and where from, because its projection is not part of the derivation.
  const formulaLabel = value => {
    const flat = String(value || '').replace(/\s+/g, ' ').trim();
    if (!/^SELECT\b/i.test(flat)) return withoutConversions(flat);
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
  let maxLevel = 0;
  const expanded = new Set();
  // Each definition of a value, with the derivation of what it reads under it. The guard is the path walked to here, not
  // every value ever seen: a variable read by two branches expands under both.
  const formulaSteps = (valueId, depth, parentId, edgeLabel, walked, whole = false) => {
    if (!valueId || walked.has(valueId) || depth > 40) return [];
    const path = new Set(walked).add(valueId);
    const definitions = formulaDefinitions(valueId);
    if (definitions.length && !whole) maxLevel = Math.max(maxLevel, depth + 1);
    return definitions.map(definition => {
      if (whole) {
        const inputs = formulaInputs(definition.id);
        return { id: definition.id, level: depth + 1, text: formulaLabel(definition.text), raw: definition.text, location: definition.location || '', of: edgeLabel, source: definition.source, line: definition.line,
          children: inputs.flatMap(input => formulaSteps(input.id, depth + 1, definition.id, input.text, path, true)) };
      }
      const known = formulaGraph.nodes.find(node => node.id === definition.id);
      if (known) { if ((known.level ?? 0) > depth + 1) known.level = depth + 1; }
      else {
        const formulaVariables = new Set([...formulaInputs(definition.id).map(node => canonical(node.text)), ...(graph.edges || []).filter(edge => edge.from === definition.id).map(edge => bseById.get(edge.to)).filter(node => node?.kind === 'value').map(node => canonical(node.text))]);
        formulaGraph.nodes.push({ ...definition, location: definition.location || definition.source, dataText: definition.text, label: formulaLabel(definition.text), stack: stackOfScope(definition.location), level: depth + 1, variables: [...formulaVariables] });
      }
      if (parentId && !formulaGraph.edges.some(edge => edge.from === parentId && edge.to === definition.id)) {
        formulaGraph.edges.push({ from: parentId, to: definition.id, label: edgeLabel });
      }
      // A definition is derived once, where it is first met; met again it is not drawn again (the graph keeps the edge to it).
      const key = [definition.source, definition.line, canonical(definition.text), formulaInputs(definition.id).map(input => canonical(input.text)).sort().join(',')].join('|');
      if (expanded.has(key)) return null;
      expanded.add(key);
      const children = formulaInputs(definition.id).flatMap(input => [formulaSteps(input.id, depth + 1, definition.id, input.text, path)]).flat();
      return { id: definition.id, level: depth + 1, text: formulaLabel(definition.text), raw: definition.text, location: definition.location || '', of: edgeLabel, source: definition.source, line: definition.line, children };
    }).filter(Boolean);
  };
  // A derivation has one top: the value that was asked about. Its definitions are its branches, however many of them there
  // are - several tops would read as several unrelated formulas.
  const id = 'formularoot', value = bseById.get(graph.root);
  const source = value?.source || graph.selectedSource, line = value?.line || graph.selectedLine || 0;
  const branches = formulaSteps(graph.root, 0, id, graph.selectedVariable || '', new Set());
  let tree = null;
  if (branches.length) {
    formulaGraph.nodes.unshift({ id, location: value?.location || graph.selectedProgram || graph.selectedSource,
      text: graph.selectedVariable || '?', label: graph.selectedVariable || '?', dataText: graph.selectedVariable || '?',
      source, line, stack: 0, level: 0, variables: [] });
    tree = { id, level: 0, text: graph.selectedVariable || '?', location: '', of: '', source, line, children: branches };
  }
  // The whole derivation, with no definition left out for having been met before: the one formula it comes to.
  let expression = null;
  if (tree) {
    const whole = { id, text: tree.text, of: '', location: '', children: formulaSteps(graph.root, 0, id, graph.selectedVariable || '', new Set(), true) };
    if (graph.pipeline && Array.isArray(graph.pipeline.steps)) { sequence(whole, graph.pipeline.steps); }
    expression = oneFormula(whole); if (process.env.DUMP) { const d = (n, k) => { console.log(" ".repeat(k * 2) + n.of + " <= " + String(n.location).split("->")[0] + " | " + String(n.text).slice(0, 60)); n.children.forEach(c => d(c, k + 1)); }; d(whole, 0); }
  }
  // The steps of a loaded pipeline put the definitions that the loop over it makes into the order they run in.
  if (tree && graph.pipeline && Array.isArray(graph.pipeline.steps)) {
    const skipped = sequence(tree, graph.pipeline.steps);
    const depths = new Map(), edges = [];
    const walk = (node, depth) => {
      node.level = depth; if (!depths.has(node.id) || depths.get(node.id) > depth) { depths.set(node.id, depth); }
      node.children.forEach(child => { edges.push({ from: node.id, to: child.id, label: child.of }); walk(child, depth + 1); });
    };
    walk(tree, 0);
    formulaGraph.nodes = formulaGraph.nodes.filter(node => depths.has(node.id)).map(node => ({ ...node, level: depths.get(node.id) }));
    formulaGraph.edges = edges;
    maxLevel = Math.max(0, ...depths.values());
    return { nodes: formulaGraph.nodes, edges: formulaGraph.edges, maxLevel, tree, expression, skipped, pipeline: graph.pipeline.scenario || '' };
  }
  return { nodes: formulaGraph.nodes, edges: formulaGraph.edges, maxLevel, tree, expression, skipped: [], pipeline: '' };
}

/* Definitions of one value that are the same step of different classes (every modifier's APPLY) are run by a loop over data:
   their order is the pipeline's. In that order each reads what the one before left, so it stands under the one after it,
   and the definitions made before the loop stand under the first. A class that is not in the pipeline is not run; it is
   removed and named. Returns the names removed. */
function sequence(tree, steps) {
  const upper = value => String(value || '').toUpperCase();
  const canonical = value => upper(value).split(' ').join('');
  const order = new Map(steps.map(step => [upper(step.modifier_class), Number(step.step_no)]));
  const classOf = node => upper(node.location).split('->')[0], methodOf = node => upper(node.location).split('->')[1] || '';
  const skipped = [];
  const visit = node => {
    const groups = new Map();
    node.children.forEach(child => { if (!groups.has(child.of)) groups.set(child.of, []); groups.get(child.of).push(child); });
    for (const members of groups.values()) {
      if (members.length < 2) { continue; }
      const methods = new Set(members.filter(member => order.has(classOf(member))).map(methodOf));
      if (!methods.size) { continue; }
      const stepped = members.filter(member => methods.has(methodOf(member)));
      const run = stepped.filter(member => order.has(classOf(member))).sort((a, b) => order.get(classOf(a)) - order.get(classOf(b)));
      skipped.push(...stepped.filter(member => !order.has(classOf(member))).map(classOf));
      let before = members.filter(member => !stepped.includes(member));
      // What a step reads of the value it updates is what the step before left: the model's own reading of it (a definition
      // from outside the loop, found by a name) gives way to that.
      for (const member of run) {
        before.forEach(previous => { previous.previous = true; });
        member.children = member.children.filter(child => !(child.of && canonical(child.of) === canonical(member.of))).concat(before);
        before = [member];
      }
      const at = node.children.indexOf(members[0]);
      node.children = node.children.filter(child => !members.includes(child));
      node.children.splice(at, 0, ...before);
    }
    node.children.forEach(visit);
  };
  visit(tree);
  return skipped;
}

/* The derivation as one expression, by substitution alone: each definition `x = expression` stands in place of x wherever
   its parent reads it, in brackets; no algebra is done. What is not an assignment (a SELECT, a call) stays a named value
   and is listed under the formula as `where`. Several definitions of one value are given as {a | b}. */
function oneFormula(tree) {
  const { tokenize } = require('./value-origin-tokens');
  const { assignment, variablePaths } = require('./value-origin-model');
  const canonical = value => String(value || '').toUpperCase().split(' ').join('');
  const where = new Map(), steps = [], named = new Map(), counts = new Map();
  // A value that comes from a table is named by what it is; where two different ones share a name, by the class too.
  const origins = new Map();
  const shortName = of => String(of).split('-').pop();
  const collect = node => {
    const all = tokenize(node.raw || ''), a = assignment(all.length && all[all.length - 1].value === '.' ? all.slice(0, -1) : all);
    if (!a || !a.expression.length) { const set = origins.get(shortName(node.of)) || new Set(); set.add(node.source + ':' + node.line); origins.set(shortName(node.of), set); }
    node.children.forEach(collect);
  };
  collect(tree);
  // Written by the name of the value itself (WEIGHT_KG, not CS_CONTEXT-WEIGHT_KG); its class and its statement are one click away.
  // Two different values of one name are told apart by their class.
  const label = node => (origins.get(shortName(node.of)).size > 1 ? shortName(node.of) + '[' + (String(node.location).split('->')[0] || 'program') + ']' : shortName(node.of));
  const plain = text => text.split(/\s+/).join(' ').trim();
  const inBrackets = text => (text.includes(' ') ? '(' + text + ')' : text);
  const subscript = number => String(number).split('').map(digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)]).join('');
  // A value that every statement of a step reads is computed once, under a name of its own - substituted in place it would
  // be written out again at each reading, and the formula would grow with every step.
  const step = (node, context) => {
    if (named.has(node)) { return named.get(node); }
    const all = tokenize(node.raw), a = assignment(all.length && all[all.length - 1].value === '.' ? all.slice(0, -1) : all);
    const text = body(node, context), existing = steps.find(item => item.text === text && item.variable === (a ? canonical(a.name) : node.of));
    if (existing) { named.set(node, existing.name); return existing.name; }
    const key = a ? canonical(a.name) : node.of, number = (counts.get(key) || 0) + 1;
    counts.set(key, number);
    const name = (a ? a.name : node.of) + subscript(number);
    steps.push({ name, text, variable: key });
    named.set(node, name);
    return name;
  };
  const define = (definitions, name, context, asStep = false) => {
    if (!definitions.length) { return name; }
    const parts = [...new Set(definitions.map(definition => (asStep ? step(definition, context) : body(definition, context))))];
    return parts.length === 1 ? parts[0] : '{' + parts.join(' | ') + '}';
  };
  function body(node, context) {
    const all = tokenize(node.raw), ts = all.length && all[all.length - 1].value === '.' ? all.slice(0, -1) : all;
    const a = assignment(ts);
    if (!a || !a.expression.length) { const name = label(node); where.set(name, { text: selectOf(node.raw, node.of) || node.text, id: node.id, source: node.source, line: node.line, location: node.location, full: node.of }); return name; }
    // A step that has the value before it as a child: its own statements all read that, wherever they stand under it.
    const previous = node.children.filter(child => child.previous);
    if (previous.length) { context = { name: canonical(a.name), kids: previous }; }
    const text = node.raw, first = a.expression[0].offset, last = a.expression[a.expression.length - 1].endOffset;
    const edits = conversions(a.expression).map(index => ({ from: a.expression[index].offset, to: a.expression[index].endOffset, rep: '' }));
    for (const path of variablePaths(a.expression)) {
      const reads = canonical(path.name), reading = context && reads === context.name;
      const kids = reading ? context.kids : node.children.filter(child => canonical(child.of) === reads && !child.previous);
      if (!kids.length) { continue; }
      edits.push({ from: a.expression[path.from].offset, to: a.expression[path.to - 1].endOffset, rep: inBrackets(define(kids, path.name, context, reading)) });
    }
    edits.sort((x, y) => x.from - y.from);
    let out = '', at = first;
    for (const edit of edits) { out += text.slice(at, edit.from) + edit.rep; at = edit.to; }
    out += text.slice(at, last);
    if (a.compound) {
      const operator = ts.find(token => ['+=', '-=', '*=', '/='].includes(token.value)).value[0];
      const reading = context && canonical(a.name) === context.name;
      const before = define(reading ? context.kids : node.children.filter(child => canonical(child.of) === canonical(a.name)), a.name, context, reading);
      out = inBrackets(before) + ' ' + operator + ' (' + plain(out) + ')';
    }
    return plain(out);
  }
  if (!tree.children.length) { return null; }
  const top = { name: '', text: define(tree.children, tree.text, null, true) };
  const items = steps.map(item => ({ name: item.name, text: item.text }));
  const isDigit = character => character >= '₀' && character <= '₉';
  const positions = (text, name) => { const found = []; for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) { if (!isDigit(text[at + name.length] || '')) { found.push(at); } } return found; };
  // A step that adds or takes off a share of the value before it is that value times one plus or minus the share: it then
  // reads the value before it once.
  for (const item of items) {
    for (const before of items) {
      for (const sign of ['+', '-']) {
        const head = before.name + ' ' + sign + ' (' + before.name + ' * ';
        if (item.text.startsWith(head) && item.text.endsWith(')')) { item.text = before.name + ' * (1 ' + sign + ' ' + item.text.slice(head.length, -1) + ')'; }
      }
    }
  }
  // What is read once is written where it is read; what is read more than once stays a step.
  for (let again = true; again;) {
    again = false;
    for (let i = items.length - 1; i >= 0 && !again; i--) {
      const it = items[i], holders = [top, ...items.filter(other => other !== it)].filter(holder => positions(holder.text, it.name).length);
      const total = holders.reduce((sum, holder) => sum + positions(holder.text, it.name).length, 0);
      if (total !== 1) { continue; }
      const holder = holders[0], at = positions(holder.text, it.name)[0];
      holder.text = holder.text.slice(0, at) + (holder === top && top.text === it.name ? it.text : inBrackets(it.text)) + holder.text.slice(at + it.name.length);
      items.splice(i, 1); again = true;
    }
  }
  return { text: tree.text + ' = ' + top.text, steps: items, where: [...where].map(([name, found]) => ({ name, ...found })) };
}

/* The SELECT that reads a value, reduced to what concerns it: the field the value is, the table, and the conditions - not
   the other fields it happens to fetch with it. Null where the statement is not a SELECT, or does not name the field. */
function selectOf(raw, of) {
  const { tokenize } = require('./value-origin-tokens');
  const tokens = tokenize(raw || ''), upper = value => String(value).toUpperCase();
  if (!tokens.length || upper(tokens[0].value) !== 'SELECT' && !(tokens[0].value === '@' && upper(tokens[1] && tokens[1].value) === 'SELECT')) {
    const at = tokens.findIndex(token => upper(token.value) === 'SELECT');
    if (at < 0) { return null; }
    tokens.splice(0, at);
  }
  const from = tokens.findIndex(token => upper(token.value) === 'FROM');
  if (from < 0) { return null; }
  let start = 1;
  while (['SINGLE', 'DISTINCT'].includes(upper(tokens[start] && tokens[start].value))) { start++; }
  // The fields: separated by commas outside brackets; a field is known by its alias, else by its last name.
  const fields = []; let current = [], depth = 0;
  for (const token of tokens.slice(start, from)) {
    if (token.value === '(') depth++; if (token.value === ')') depth--;
    if (token.value === ',' && !depth) { fields.push(current); current = []; } else { current.push(token); }
  }
  if (current.length) { fields.push(current); }
  const nameOf = field => { const words = field.filter(token => token.kind === 'word'); return upper(words.length ? words[words.length - 1].value : ''); };
  const want = upper(String(of).split('-').pop());
  // One field fetched is the value, whatever it is called here.
  const field = fields.find(item => nameOf(item) === want) || (fields.length === 1 ? fields[0] : null);
  if (!field) { return null; }
  const stops = ['WHERE', 'INTO', 'ORDER', 'GROUP', 'HAVING', 'UP', 'FOR'];
  let end = tokens.findIndex((token, index) => index > from && stops.includes(upper(token.value)));
  const table = tokens.slice(from + 1, end < 0 ? tokens.length : end).filter(token => token.value !== '.');
  const whereAt = tokens.findIndex((token, index) => index > from && upper(token.value) === 'WHERE');
  let condition = [];
  if (whereAt >= 0) {
    const after = tokens.findIndex((token, index) => index > whereAt && ['INTO', 'ORDER', 'GROUP', 'HAVING', 'UP', 'FOR'].includes(upper(token.value)));
    condition = tokens.slice(whereAt + 1, after < 0 ? tokens.length : after).filter(token => token.value !== '.');
  }
  const written = list => (list.length ? raw.slice(list[0].offset, list[list.length - 1].endOffset).split(/\s+/).join(' ') : '');
  return 'SELECT ' + written(field) + ' FROM ' + written(table) + (condition.length ? ' WHERE ' + written(condition) : '') + '.';
}

module.exports = { selectOf, formula, scopeStacks, sequence, oneFormula };
