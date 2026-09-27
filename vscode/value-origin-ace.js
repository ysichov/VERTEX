"use strict";

// Transport adapter only: statement boundaries, positions, units, calls and
// bindings are supplied by ACE. Splitting a scan token such as DATA(X) exposes
// its punctuation to the expression slicer; it never rescans the source.
const { tokenize } = require('./value-origin-tokens');
function sourcesFromAce(payload, object, prefix) {
  if (payload?.schema_version !== 1 || !Array.isArray(payload.includes)) throw new Error('ACE origin index schema 1 is required. Update ZCL_VX_ADT_RES_FLOW in SAP.');
  return payload.includes.filter(inc => inc.statements?.length).map(inc => {
    const lines = inc.source || [], source = lines.join('\n'), starts = []; let offset = 0;
    for (const line of lines) { starts.push(offset); offset += line.length + 1; }
    const statements = inc.statements.map(s => {
      const tokens = s.tokens.flatMap(t => {
        const base = (starts[t.row - 1] || 0) + t.col;
        const pieces = t.str === '*' ? [{ kind: 'symbol', value: '*', offset: 0, endOffset: 1 }] : tokenize(t.str);
        return pieces.map(piece => ({ ...piece, line: t.row, offset: base + piece.offset, endOffset: base + piece.endOffset }));
      }).filter(t => !(t.kind === 'symbol' && t.value === '.'));
      const start = tokens[0]?.offset ?? starts[s.line - 1] ?? 0, end = tokens[tokens.length - 1]?.endOffset ?? start;
      return { tokens, line: s.line, offset: start, text: source.slice(start, end) + (source[end] === '.' ? '.' : ''), aceCalls: s.calls || [], aceIndex: s.idx };
    });
    const ownFlow = rows => rows.filter(row => String(row.include || '').toUpperCase() === inc.include.toUpperCase());
    const aceFlowSteps = ownFlow(payload.flow_steps || []);
    if (!aceFlowSteps.length) for (const change of ownFlow(payload.calculated || [])) aceFlowSteps.push({ ...change,
      calculated: [change], composed: ownFlow(payload.composed || []).filter(item => item.line === change.line) });
    return { id: prefix + '/' + encodeURIComponent(inc.include) + '.abap', name: inc.include.toUpperCase(),
      objectName: object.object_name.toUpperCase(), objectType: object.object_type, aceOwner: String(inc.class || '').toUpperCase(), aceOwnerType: inc.is_intf ? 'INTF' : 'CLAS', text: source,
      aceStatements: statements, aceParams: payload.params || [], aceUnits: (payload.units || []).filter(u => u.include.toUpperCase() === inc.include.toUpperCase()), aceRefs: payload.refs || [], aceClasses: payload.classes || [], aceImplementations: payload.implementations || [],
      aceCalculated: ownFlow(payload.calculated || []), aceComposed: ownFlow(payload.composed || []),
      aceFlowSteps };
  });
}
function locateTarget(sources, documentText, objectName, line, variable, column = 0) {
  const lines = documentText.split('\n'), normalized = value => value.split('\r').join('').trimEnd();
  const location = (s, row) => {
    const own = s.text.split('\n'), origin = lines[line - 1] || '', dest = own[row - 1] || '';
    const shift = (dest.length - dest.trimStart().length) - (origin.length - origin.trimStart().length);
    const position = own.slice(0, row - 1).reduce((n, l) => n + l.length + 1, 0) + Math.max(0, column + shift);
    const statement = s.aceStatements.filter(stmt => stmt.offset <= position).at(-1);
    return { source: s.id, line: row, variable, offset: statement?.offset ?? position };
  };
  const exact = sources.find(s => s.name === objectName.toUpperCase() && normalized(s.text) === normalized(documentText));
  if (exact) return location(exact, line);
  // ADT assembles class methods into one editor buffer; ACE keeps their CM
  // includes. Map a unique source context, never guess a duplicate line.
  const candidates = [];
  for (const source of sources) {
    const other = source.text.split('\n');
    for (let i = 0; i < other.length; i++) {
      if (normalized(other[i]).trim() !== normalized(lines[line - 1] || '').trim()) continue;
      let score = 1;
      for (let delta = 1; delta <= 4; delta++) for (const sign of [-1, 1]) {
        const a = lines[line - 1 + delta * sign], b = other[i + delta * sign];
        if (a !== undefined && b !== undefined && normalized(a).trim() === normalized(b).trim()) score++;
      }
      candidates.push({ ...location(source, i + 1), score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || (candidates[1] && candidates[1].score === candidates[0].score)) throw new Error('Cannot map this editor position uniquely to ACE source. Open the active method/include and select its variable again.');
  return candidates[0];
}
module.exports = { sourcesFromAce, locateTarget };
