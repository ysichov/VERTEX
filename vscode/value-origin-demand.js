"use strict";
const { analyze, buildIndex, customerObject } = require('./value-origin-model');
const { tokenize } = require('./value-origin-tokens');
const callGraph = require('./call-graph');
const up = value => String(value || '').toUpperCase();

function objectsIn(tokens) {
  const found = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const at = up(tokens[i].value);
    if (at === 'NEW' && tokens[i + 1]?.kind === 'word') found.set(up(tokens[i + 1].value), 'CLAS');
    if (tokens[i].kind === 'word' && tokens[i + 1]?.value === '=>') found.set(at, 'CLAS');
    if (at === 'INTERFACES' && tokens[i + 1]) found.set(up(tokens[i + 1].value), 'INTF');
    if (at === 'REF' && up(tokens[i + 1]?.value) === 'TO' && tokens[i + 2]?.kind === 'word') found.set(up(tokens[i + 2].value), 'CLAS');
  }
  return found;
}

// Resolve the current slice, then fetch only objects named by reached source
// statements or the signatures needed to resolve their calls. Re-run until
// loading new code no longer reveals dependencies. Full FLOW consequently
// describes the loaded closure; it is not a promise to fetch the whole system.
async function collectDemandSources(initial, target, load, loadPart, options = {}) {
  const sources = initial.slice(), warnings = [], skipped = new Set();
  const visited = new Set(sources.map(s => up(s.objectName))), parts = new Set(sources.map(s => s.id));
  const limit = options.maxSources || 240;
  for (;;) {
    if (options.cancelled?.()) throw new Error('Value origin cancelled.');
    const index = buildIndex(sources), graph = analyze(sources, target);
    const requested = new Map(), neededParts = new Map();
    const reached = new Map();
    if (target.declarationTypes) {
      // Inline DATA(result) = receiver->method(...) needs the method's
      // RETURNING signature even without a selected value/backward slice.
      const own = sources.find(s => s.id === target.source);
      for (const statement of own?.aceStatements || [])
        for (const [name, type] of objectsIn(statement.tokens)) requested.set(name, type);
      for (const site of graph.callSites.filter(site => site.source === target.source)) {
        for (const called of site.callees) {
          const procedure = index.procedures.find(p => p.owner === called.owner && p.name === called.name);
          if (!procedure) continue;
          for (const param of index.signature(procedure))
            for (const [name, type] of objectsIn(tokenize(param.type || ''))) requested.set(name, type);
        }
      }
    }
    // A breakpoint-to-breakpoint path has no selected value, so a backward
    // slice cannot discover its callees. Walk calls from the requested entry
    // range instead, then read dependencies in those reached routine bodies.
    if (target.flowPath) {
      const entry = index.procedures.filter(p => p.source.id === target.source &&
        p.body.some(s => s.line >= target.flowRange.from && s.line <= target.flowRange.to));
      const executionCalls=callGraph.create(index);
      await callGraph.walk(entry,{range:target.flowRange,maxDepth:options.maxDepth,cancelled:options.cancelled,
        calls:(p,s)=>executionCalls.calls(p,s),
        onStatement:(p,s)=>{
        if (!reached.has(p.source.id)) reached.set(p.source.id, new Set());
          reached.get(p.source.id).add(s.line);
          for (const [name, type] of objectsIn(s.tokens)) requested.set(name, type);
        }
      });
    }
    for (const node of graph.nodes) {
      if (!reached.has(node.source)) reached.set(node.source, new Set());
      reached.get(node.source).add(node.line);
      for (const [name, type] of objectsIn(tokenize(node.text || ''))) requested.set(name, type);
    }
    for (const source of sources) {
      const lines = reached.get(source.id);
      if (!lines) continue;
      const statements = source.aceStatements || [];
      for (const statement of statements) {
        const tokens = statement.tokens, first = up(tokens[0]?.value);
        if (lines.has(statement.line) || first === 'INTERFACES') {
          for (const [name, type] of objectsIn(tokens)) requested.set(name, type);
        }
        if (source.objectType === 'CLAS' && lines.has(statement.line) && ['Unknown', 'MacroCall', 'MacroContent'].includes(statement.parserKind)) neededParts.set(source.objectName, 'macros');
      }
      for (const procedure of index.procedures.filter(p => p.source.id === source.id &&
        graph.nodes.some(n => n.source === source.id && n.location === (p.owner ? p.owner + '->' + p.name : source.objectName)))) {
        for (const param of index.signature(procedure)) for (const [name, type] of objectsIn(tokenize(param.type || ''))) requested.set(name, type);
        if (source.objectType === 'CLAS' && procedure.body.some(statement => ['Unknown', 'MacroCall', 'MacroContent'].includes(statement.parserKind))) neededParts.set(source.objectName, 'macros');
      }
      // A local call with no implementation can live in class local includes.
      const missingLocal = [...requested.keys()].some(name => /^(LCL_|LIF_)/.test(name) &&
        !index.procedures.some(p => p.owner === name && p.name !== 'GLOBAL'));
      const unresolvedLocal = graph.nodes.some(n => n.source === source.id && n.kind === 'unknown' && /^Unresolved call:/.test(n.text) &&
        !/(?:->|=>)/.test(n.text));
      if (source.objectType === 'CLAS' && (missingLocal || unresolvedLocal)) {
        const have = sources.filter(s => s.objectName === source.objectName).map(s => s.include || 'main');
        neededParts.set(source.objectName, have.includes('definitions') ? 'implementations' : 'definitions');
      }
    }
    let added = false;
    for (const [name, type] of requested) {
      if (visited.has(name) || index.procedures.some(p => p.owner === name)) continue;
      if (!customerObject(name)) { skipped.add(name); continue; }
      visited.add(name);
      if (sources.length >= limit) { warnings.push('Source limit reached: ' + name); continue; }
      try {
        const loaded = await load(name, type);
        for (const source of loaded) if (!parts.has(source.id)) { sources.push(source); parts.add(source.id); added = true; }
      } catch (error) {
        if (options.cancelled?.()) throw error;
        warnings.push(name + ': ' + error.message);
      }
    }
    for (const [name, include] of neededParts) {
      if (sources.length >= limit) { warnings.push('Source limit reached: ' + name + '.' + include); continue; }
      const key = name + ':' + include;
      if (parts.has(key)) continue;
      parts.add(key);
      try {
        const loaded = await loadPart(name, include);
        for (const source of loaded) if (!parts.has(source.id)) { sources.push(source); parts.add(source.id); added = true; }
      } catch (error) {
        if (options.cancelled?.()) throw error;
        warnings.push(key + ': ' + error.message);
      }
    }
    if (!added) return { sources, warnings, skipped: [...skipped] };
  }
}
module.exports = { collectDemandSources };
