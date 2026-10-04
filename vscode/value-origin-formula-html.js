"use strict";
/* The Formula pane of the analysis as HTML, and the symbolic writing of an expression it uses: one drawing for Value origin
   and for the debugger's flow path. `sourceOf(node)` names the source a </> button opens - the analysis's own source id
   in Value origin, the debugger's "origin:<source>|<routine>" marker there. */
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
      if (names.calculated.has(key)) output += `<span class="data-calculated">${escape(name)}</span>`;
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
  const formulaHtml = (node, root = false) => {
    const children = node.children.map(child => formulaHtml(child)).join('');
    const caption = root
      ? `<span class="formula-expression">${escape(node.text)}</span><button class="location code-location" title="Open the selected value in source; Ctrl+Click opens beside" data-node="${escape(node.id)}" data-source="${escape(sourceOf(node))}" data-line="${node.line}">&lt;/&gt;</button>`
      : `<span class="formula-expression">${dataFormula({ text: node.text, calculated: [], composed: [] })}</span><button class="location code-location" title="Open this formula in source; Ctrl+Click opens beside" data-node="${escape(node.id)}" data-source="${escape(sourceOf(node))}" data-line="${node.line}">&lt;/&gt;</button>`;
    return children ? `<details class="formula-node" data-formula-node="${escape(node.id)}" data-level="${node.level}"${root ? ' open' : ''}><summary>${caption}</summary><div class="formula-children">${children}</div></details>` : `<div class="formula-leaf" data-formula-node="${escape(node.id)}" data-level="${node.level}">${caption}</div>`;
  };
  // What the loaded pipeline took out is said above the tree, never left out without a word.
  const pipelineNote = derivation.pipeline !== '' || derivation.skipped.length
    ? `<p class="edge">Ordered by the loaded pipeline${derivation.pipeline ? ' of scenario ' + escape(derivation.pipeline) : ''}${derivation.skipped.length ? '; not in it, so not run: ' + escape([...new Set(derivation.skipped)].join(', ')) : ''}.</p>` : '';
  const formulaView = derivation.tree ? pipelineNote + formulaHtml(derivation.tree, true) : '<p class="edge">No symbolic formula was resolved for this value.</p>';
  return '<p class="edge">Formula derivation — click a branch to expand its input formulas</p>' + formulaView;
}

// The derivation as the one expression it comes to (see oneFormula): the steps in the order they run, then where its
// named values come from.
function expressionPane(derivation, sourceOf = node => node.source) {
  const expression = derivation.expression;
  if (!expression) { return '<p class="edge">No symbolic formula was resolved for this value.</p>'; }
  const note = derivation.pipeline !== '' || derivation.skipped.length
    ? `<p class="edge">Ordered by the loaded pipeline${derivation.pipeline ? ' of scenario ' + escape(derivation.pipeline) : ''}${derivation.skipped.length ? '; not in it, so not run: ' + escape([...new Set(derivation.skipped)].join(', ')) : ''}.</p>` : '';
  // A value that comes from a table is a link to the statement that reads it; its class shows when the pointer rests on it.
  const known = new Map(expression.where.map(item => [item.name, item]));
  const names = [...known.keys()].sort((a, b) => b.length - a.length);
  const isName = character => /[A-Za-z0-9_\-\[\]\/]/.test(character || '');
  const link = item => `<button class="data-composed" title="${escape(item.full)} · ${escape(String(item.location).split('->')[0])} · ${escape(item.text)}" data-node="${escape(item.id)}" data-source="${escape(sourceOf(item))}" data-line="${item.line}">${escape(item.name)}</button>`;
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
  return `<p class="edge">Expression - the derivation written out, nothing simplified</p>${note}<p><code>${write(expression.text)}</code></p>`
    + (steps ? `<p class="edge">Values read more than once, from the last</p><ol class="expression-steps">${steps}</ol>` : '')
    + (where ? `<p class="edge">Where the values come from</p><ul class="expression-where">${where}</ul>` : '');
}

module.exports = { symbolic, formulaPane, expressionPane, escape };
