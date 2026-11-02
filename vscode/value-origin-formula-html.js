"use strict";
/* The Formula pane of the analysis as HTML, and the symbolic writing of an expression it uses: one drawing for Value origin
   and for the debugger's flow path. `sourceOf(node)` names the source a </> button opens - the analysis's own source id
   in Value origin, the debugger's "origin:<source>|<routine>" marker there. */
const { escapeHtml: escape } = require('./html-escape');

function symbolic(graph) {
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
      if (step.colors?.has(key)) output += `<span style="color:var(--vscode-charts-${step.colors.get(key)},currentColor)">${escape(name)}</span>`;
      else if (names.calculated.has(key)) output += `<span class="data-calculated">${escape(name)}</span>`;
      else if (names.composed.has(key)) output += definition ? `<button class="data-composed" title="Open the definition of ${escape(name)}" data-node="${escape(definition.id)}" data-source="${escape(definition.source)}" data-line="${definition.line}">${escape(name)}</button>` : `<span class="data-composed">${escape(name)}</span>`;
      else output += syntaxCode(name);
      offset = match.index + name.length;
    }
    return output + syntaxCode(text.slice(offset));
  };
  const dataFormula = step => symbolicExpression(step, true);
  const codeFormula = step => symbolicExpression(step, true);
  return { bseById, canonical, stripData, dataNames, dataText, syntaxCode, symbolicExpression, dataFormula, codeFormula };
}

function formulaPane(graph, derivation, sourceOf = node => node.source) {
  const { dataFormula } = symbolic(graph);
  const colors = new Map(), palette = ['blue', 'orange', 'green', 'purple', 'yellow', 'red'];
  const register = node => {
    const key = String(node.of || '').toUpperCase();
    if (key && !colors.has(key)) colors.set(key, palette[colors.size % palette.length]);
    node.children.forEach(register);
  };
  if (derivation.tree) register(derivation.tree);
  const formulaHtml = (node, root = false) => {
    const children = node.children.map(child => formulaHtml(child)).join('');
    // The formula itself is the link to its statement; no separate </> beside it.
    const text = root ? escape(node.text) : dataFormula({ text: node.text, calculated: [], composed: [], colors });
    // A recorded run marks what it made of each definition: ran, not run, a SELECT that found nothing.
    const run = node.run ? node.run.state : '', said = run === 'not-run' ? ' - not run in this run' : run === 'empty' ? ' - SELECT found nothing (sy-subrc ' + node.run.subrc + ')' : run === 'ran' ? ' - ran' : '';
    const caption = `<button class="data-composed${run ? ' vx-' + run : ''}" title="${root ? 'Open the selected value in source' : 'Open this formula in source'}${escape(said)}; Ctrl+Click opens beside" data-node="${escape(node.id)}" data-source="${escape(sourceOf(node))}" data-line="${node.line}"><span class="formula-expression">${text}</span></button>`;
    return children ? `<details class="formula-node" data-formula-node="${escape(node.id)}" data-level="${node.level}"${root ? ' open' : ''}><summary>${caption}</summary><div class="formula-children">${children}</div></details>` : `<div class="formula-leaf" data-formula-node="${escape(node.id)}" data-level="${node.level}">${caption}</div>`;
  };
  // What the loaded pipeline took out is said above the tree, never left out without a word.
  const pipelineNote = derivation.byRun || derivation.pipeline !== '' || derivation.skipped.length
    ? `<p class="edge">${derivation.byRun ? 'In the order the run executed them' : 'Ordered by the loaded pipeline'}${derivation.pipeline ? ' of scenario ' + escape(derivation.pipeline) : ''}${derivation.skipped.length ? '; not in it, so not run: ' + escape([...new Set(derivation.skipped)].join(', ')) : ''}.</p>` : '';
  const formulaView = derivation.tree ? pipelineNote + formulaHtml(derivation.tree, true) : '<p class="edge">No symbolic formula was resolved for this value.</p>';
  return '<p class="edge">Formula derivation — click a branch to expand its input formulas</p>' + formulaView;
}

// Keep the full symbolic expression intact, but give every alternative and nested group its own line.
function layoutAlternatives(text) {
  let out = '', depth = 0, quoted = false;
  const indent = () => '  '.repeat(depth);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") {
      out += char;
      if (quoted && text[i + 1] === "'") out += text[++i];
      else quoted = !quoted;
    } else if (!quoted && char === '{') {
      depth++; out += '{\n' + indent();
    } else if (!quoted && char === '}' && depth) {
      depth--; out = out.trimEnd() + '\n' + indent() + '}';
    } else if (!quoted && depth && text.startsWith(' | ', i)) {
      out = out.trimEnd() + '\n' + indent() + '| ';
      i += 2;
    } else out += char;
  }
  return out;
}

// The derivation as the one expression it comes to (see oneFormula): the steps in the order they run, then where its
// named values come from.
function expressionPane(derivation, sourceOf = node => node.source) {
  const expression = derivation.expression;
  if (!expression) { return '<p class="edge">No symbolic formula was resolved for this value.</p>'; }
  const note = derivation.byRun || derivation.pipeline !== '' || derivation.skipped.length
    ? `<p class="edge">${derivation.byRun ? 'In the order the run executed them' : 'Ordered by the loaded pipeline'}${derivation.pipeline ? ' of scenario ' + escape(derivation.pipeline) : ''}${derivation.skipped.length ? '; not in it, so not run: ' + escape([...new Set(derivation.skipped)].join(', ')) : ''}.</p>` : '';
  // A value that comes from a table is a link to the statement that reads it; its class shows when the pointer rests on it.
  const known = new Map(expression.where.map(item => [item.name, item]));
  const names = [...known.keys()].sort((a, b) => b.length - a.length);
  const isName = character => /[A-Za-z0-9_\-\[\]\/]/.test(character || '');
  const link = item => `<button class="data-composed" title="${escape(item.full)} · ${escape(String(item.location).split('->')[0])} · ${escape(item.text)}" data-node="${escape(item.id)}" data-source="${escape(sourceOf(item))}" data-line="${item.line}" data-full="${escape(item.full)}" data-location="${escape(item.location)}">${escape(item.name)}</button>`;
  const write = text => {
    let out = '', at = 0;
    while (at < text.length) {
      const name = isName(text[at - 1]) ? null : names.find(candidate => text.startsWith(candidate, at) && !isName(text[at + candidate.length]));
      if (name) { out += link(known.get(name)); at += name.length; } else { out += escape(text[at]); at++; }
    }
    return out;
  };
  const steps = expression.steps.slice().reverse().map(step => `<li><code>${escape(step.name)} = ${write(step.text)}</code></li>`).join('');
  const where = expression.where.map(item => `<li><code>${link(item)}</code> &larr; <code>${escape(item.text)}</code> <span class="edge">${escape(String(item.location).split('->')[0])}</span></li>`).join('');
  const whole = `<p class="edge">Expression - the derivation written out, nothing simplified</p>${note}<p><code>${write(layoutAlternatives(expression.text))}</code></p>`
    + (steps ? `<p class="edge">Values read more than once, from the last</p><ol class="expression-steps">${steps}</ol>` : '')
    + (where ? `<p class="edge">Where the values come from</p><ul class="expression-where">${where}</ul>` : '');
  if (!expression.optimized) { return whole; }
  return `<div class="vx-analysis-whole">${whole}</div><div class="vx-analysis-optimized">${optimizedPane(expression.optimized, note, link, sourceOf)}</div>`;
}

/* The derivation optimized: the formula reads its values by their names, and under where each name is what its statement
   makes of the names it reads. The first level is the names of the formula, in its order; a line that reads names of its
   own opens them one level down, folded, as the record's Optimized reading does. A name is opened once, where it is
   first read. */
function optimizedPane(optimized, note, link, sourceOf) {
  const steps = new Map(optimized.steps.map(step => [step.name, step]));
  const sourceLink = (step, label) => `<button class="data-composed" title="Open this definition in source; Ctrl+Click opens beside" data-node="${escape(step.id)}" data-source="${escape(sourceOf(step))}" data-line="${step.line}">${label}</button>`;
  const known = new Map([...optimized.where.map(item => [item.name, link(item)]),
    ...optimized.steps.map(step => [step.name, `<button class="data-composed" title="${escape(String(step.location).split('->')[0])} · line ${step.line}" data-node="${escape(step.id)}" data-source="${escape(sourceOf(step))}" data-line="${step.line}" data-full="${escape(step.full)}" data-location="${escape(step.location)}">${escape(step.name)}</button>`])]);
  const names = [...known.keys()].sort((a, b) => b.length - a.length);
  const isName = character => /[A-Za-z0-9_\-\[\]\/₀-₉]/.test(character || '');
  const found = text => {
    const out = [];
    for (let at = 0; at < text.length;) {
      const name = isName(text[at - 1]) ? null : names.find(candidate => text.startsWith(candidate, at) && !isName(text[at + candidate.length]));
      if (name) { out.push({ at, name }); at += name.length; } else { at++; }
    }
    return out;
  };
  const write = text => {
    let out = '', at = 0;
    for (const item of found(text)) {
      if (item.at < at) continue;
      out += escape(text.slice(at, item.at)) + known.get(item.name);
      at = item.at + item.name.length;
      const step = steps.get(item.name);
      if (step && text.startsWith(' otherwise', at)) {
        out += ' ' + sourceLink(step, 'otherwise');
        at += ' otherwise'.length;
      }
    }
    return out + escape(text.slice(at));
  };
  const reads = text => [...new Set(found(text).map(item => item.name).filter(name => steps.has(name)))];
  const done = new Set(), roots = [], queue = reads(optimized.text).map(name => ({ name, into: roots }));
  while (queue.length) {
    const entry = queue.shift();
    if (done.has(entry.name)) { continue; }
    done.add(entry.name);
    entry.parts = [];
    entry.into.push(entry);
    reads(steps.get(entry.name).text).forEach(name => queue.push({ name, into: entry.parts }));
  }
  const list = entries => !entries.length ? '' : `<ul class="expression-decode">${entries.map(entry => {
    const line = `<code>${known.get(entry.name)} = ${write(steps.get(entry.name).text)}</code>`;
    return entry.parts.length ? `<li class="more"><details><summary>${line}</summary>${list(entry.parts)}</details></li>` : `<li>${line}</li>`;
  }).join('')}</ul>`;
  const where = optimized.where.map(item => `<li><code>${link(item)}</code> &larr; <code>${escape(item.text)}</code> <span class="edge">${escape(String(item.location).split('->')[0])}</span></li>`).join('');
  const alternatives = /^(.+?) = \{([^{}]+)\}$/.exec(optimized.text);
  const alternativesView = alternatives ? `<p class="edge">Statically possible definitions of <code>${escape(alternatives[1])}</code>; the executed path is known only after a run.</p><ol class="expression-alternatives">${alternatives[2].split(' | ').map(part => {
    const match = /^(.*?)(?: when (.+)| otherwise)$/.exec(part);
    if (!match) return `<li><code>${write(part)}</code></li>`;
    const value = match[1], condition = match[2];
    const step = steps.get(value);
    const owner = step && String(step.location || '').split('->')[0];
    const change = step && /^([\w\[\]₀-₉-]+) ([+-]) (.+)$/.exec(step.text);
    const calculation = change ? `<div class="expression-change">input: <code>${write(change[1])}</code> · change: <code>${escape(change[2])} ${write(change[3])}</code> · result: <code>${write(value)}</code></div>`
      : step ? `<div class="expression-change">result: <code>${write(value)} = ${write(step.text)}</code></div>` : '';
    const details = `${calculation}${step ? `<div class="edge">source: ${sourceLink(step, escape(owner || 'Open code'))}</div>` : ''}`;
    const heading = `<code>${write(value)}</code>${owner ? ` <span class="edge">· ${escape(owner)}</span>` : ''}`;
    return condition ? `<li>${heading}<span class="edge">when ${escape(condition)}</span>${details}</li>`
      : `<li><details><summary>${heading} <span class="edge">· condition not identified</span></summary>${details}<div class="edge">${step ? sourceLink(step, 'otherwise') : 'otherwise'}: no branch guard is known for this definition.</div></details></li>`;
  }).join('')}</ol>` : `<p><code>${write(optimized.text)}</code></p>`;
  return `<p class="edge">Expression - optimized: each value by its name, opened under where</p>${note}${alternativesView}`
    + (roots.length ? `<p class="edge">where</p>${list(roots)}` : '')
    + (where ? `<p class="edge">Where the values come from</p><ul class="expression-where">${where}</ul>` : '');
}

module.exports = { symbolic, formulaPane, expressionPane, layoutAlternatives, escape };
