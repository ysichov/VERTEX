"use strict";

const { tokenize } = require('./value-origin-tokens');
const U = value => String(value || '').toUpperCase();
const words = new Set(('ABAP_TRUE ABAP_FALSE SPACE INITIAL AND OR NOT IS BOUND EQ NE GT GE LT LE ' +
  'IF ELSE ELSEIF ENDIF CASE WHEN OTHERS ENDCASE LOOP AT INTO ASSIGNING ENDLOOP DO ENDDO WHILE ENDWHILE TRY CATCH ENDTRY ' +
  'DATA FINAL CONSTANTS STATICS TYPE LIKE REF TO VALUE NEW CONV CAST COND SWITCH CORRESPONDING BASE ' +
  'IMPORTING EXPORTING CHANGING RECEIVING RETURNING OPTIONAL DEFAULT PREFERRED PARAMETER ' +
  'SELECT SINGLE FROM JOIN ON WHERE AS TABLE FIELDS ORDER BY UP DOWN ASCENDING DESCENDING ' +
  'REPORT START-OF-SELECTION WRITE CLEAR MOVE ADD SUBTRACT MULTIPLY DIVIDE COMPUTE ' +
  'CLASS INTERFACE ENDCLASS ENDINTERFACE DEFINITION IMPLEMENTATION PUBLIC PRIVATE PROTECTED SECTION ' +
  'METHOD METHODS CLASS-METHODS ENDMETHOD INTERFACES ENDSELECT CHECK RETURN EXIT CONTINUE ' +
  'FORM ENDFORM FUNCTION ENDFUNCTION CALL TRANSPORTING NO ROWS CLIENT SPECIFIED DISTINCT GROUP HAVING WHEN THEN ELSE PARAMETERS RADIOBUTTON DEFAULT').split(' '));
const modes = new Set(['IMPORTING', 'EXPORTING', 'CHANGING', 'RETURNING', 'RECEIVING']);
const cache = new Map();
const word = t => t && t.kind === 'word';
const variable = t => word(t) && !words.has(U(t.value));
const text = ts => ts.map(t => t.value).join(' ').split(' .').join('.').split('( ').join('(').split(' )').join(')');
const val = (ts, i) => U(ts[i]?.value);
const find = (ts, value, start = 0) => ts.findIndex((t, i) => i >= start && U(t.value) === value);
function close(ts, at) { if (at < 0) return -1; let depth = 0; for (let i = at; i < ts.length; i++) { if (ts[i].value === '(') depth++; if (ts[i].value === ')' && --depth === 0) return i; } return -1; }
function pathAt(ts, i) {
  if (!word(ts[i])) return null;
  let name = U(ts[i].value), end = i + 1;
  while (['-', '~'].includes(ts[end]?.value) && word(ts[end + 1]) && ts[end - 1].endOffset === ts[end].offset && ts[end].endOffset === ts[end + 1].offset) {
    name += ts[end].value + U(ts[end + 1].value); end += 2;
  }
  return { name, end };
}
function onlyPath(ts) { if (ts[0]?.value === '@') ts = ts.slice(1); const p = pathAt(ts, 0); return p && p.end === ts.length ? p.name : null; }
function refs(ts) {
  const result = new Set();
  for (let i = 0; i < ts.length; i++) {
    const p = pathAt(ts, i); if (!p) continue;
    if (variable(ts[i]) && !['TYPE', 'LIKE', 'AS', 'NEW', 'CONV', 'CAST'].includes(val(ts, i - 1)) && !['(', '=>', '~'].includes(ts[p.end]?.value)) result.add(p.name);
    i = p.end - 1;
  }
  return [...result];
}
function contains(base, target) { return target === base || target.startsWith(base + '-'); }
function assignment(ts) {
  let depth = 0, equal = -1;
  for (let i = 0; i < ts.length; i++) { if (ts[i].value === '(') depth++; if (ts[i].value === ')') depth--; if (!depth && ['=', '+=', '-=', '*=', '/='].includes(ts[i].value)) { equal = i; break; } }
  if (equal > 0 && !['IF', 'ELSEIF', 'CHECK', 'WHILE', 'SELECT', 'WHEN', 'LOOP'].includes(val(ts, 0))) {
    const start = ['DATA', 'FINAL'].includes(val(ts, 0)) ? 2 : val(ts, 0) === 'COMPUTE' ? 1 : 0;
    const p = pathAt(ts, start);
    if (p && (p.end === equal || (start === 2 && p.end === equal - 1))) return { name: p.name, expression: ts.slice(equal + 1), compound: ts[equal].value !== '=' };
  }
  if (val(ts, 0) === 'MOVE') { const to = find(ts, 'TO'), p = pathAt(ts, to + 1); if (p) return { name: p.name, expression: ts.slice(1, to) }; }
  if (['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE'].includes(val(ts, 0))) {
    const left = ['MULTIPLY', 'DIVIDE'].includes(val(ts, 0)), at = find(ts, left ? 'BY' : val(ts, 0) === 'ADD' ? 'TO' : 'FROM');
    const p = pathAt(ts, left ? 1 : at + 1); if (p) return { name: p.name, expression: left ? ts.slice(at + 1) : ts.slice(1, at), compound: true };
  }
  return null;
}
function callOf(ts) {
  if (val(ts, 0) === 'CALL' && val(ts, 1) === 'METHOD') ts = ts.slice(2);
  let receiver = '', owner = '', at = 0, arrow = '';
  if (val(ts, 0) === 'NEW' && word(ts[1]) && ts[2]?.value === '(') {
    owner = val(ts, 1); at = close(ts, 2) + 1;
    if (ts[at]?.value !== '->') return null;
    arrow = '->'; at++;
  } else {
    const p = pathAt(ts, 0);
    if (!p) return null;
    if (['->', '=>'].includes(ts[p.end]?.value)) { receiver = p.name; arrow = ts[p.end].value; at = p.end + 1; if (arrow === '=>') owner = receiver; }
  }
  const method = pathAt(ts, at);
  if (!method || words.has(method.name)) return null;
  const open = method.end;
  if (ts[open]?.value === '(' && close(ts, open) === ts.length - 1) return { receiver, owner, arrow, method: method.name, args: ts.slice(open + 1, -1) };
  return null;
}
function parameters(ts) {
  const result = []; let mode = '';
  for (let i = 0; i < ts.length; i++) {
    if (modes.has(val(ts, i))) { mode = val(ts, i); continue; }
    if (!mode) continue;
    let name;
    if (['VALUE', 'REFERENCE'].includes(val(ts, i)) && ts[i + 1]?.value === '(') { name = val(ts, i + 2); i = close(ts, i + 1); }
    else if (word(ts[i]) && ['TYPE', 'LIKE'].includes(val(ts, i + 1))) name = val(ts, i);
    if (name) result.push({ name, mode });
  }
  return result;
}
function parse(source) {
  if (source.aceStatements) return { tokens: source.aceStatements.flatMap(s => s.tokens), statements: source.aceStatements };
  const old = cache.get(source.id); if (old?.text === source.text) return old;
  const tokens = tokenize(source.text), statements = []; let part = [];
  for (const t of tokens) { if (t.kind === 'symbol' && t.value === '.') { if (part.length) statements.push({ tokens: part, line: part[0].line, offset: part[0].offset, text: source.text.slice(part[0].offset, t.endOffset) }); part = []; } else part.push(t); }
  const parsed = { text: source.text, tokens, statements };
  cache.set(source.id, parsed); if (cache.size > 128) cache.delete(cache.keys().next().value);
  return parsed;
}
function buildIndex(sources) {
  const procedures = [], signatures = new Map(), interfaces = new Map(), dependencies = new Map();
  for (const source of sources) {
    const global = { id: source.id + ':GLOBAL', name: 'GLOBAL', owner: '', source, body: [], start: 0, end: source.text.length + 1, line: 1 };
    procedures.push(global); let owner = ['CLAS', 'INTF'].includes(source.objectType) ? source.objectName : '', current = global, conditions = [];
    for (const raw of parse(source).statements) {
      const ts = raw.tokens, first = val(ts, 0), s = { ...raw, assignment: assignment(ts), call: callOf(ts) };
      if (['CLASS', 'INTERFACE'].includes(first) && ts[1]?.value !== '-') { owner = val(ts, 1); if (!interfaces.has(owner)) interfaces.set(owner, new Set()); }
      if (owner && !interfaces.has(owner)) interfaces.set(owner, new Set());
      if (first === 'INTERFACES') interfaces.get(owner)?.add(val(ts, 1));
      if (first === 'METHODS' || (first === 'CLASS' && ts[1]?.value === '-' && val(ts, 2) === 'METHODS')) {
        const start = first === 'METHODS' ? 1 : 3, p = pathAt(ts, start); if (p) signatures.set(owner + '~' + p.name, parameters(ts.slice(p.end)));
      }
      if (['METHOD', 'FORM', 'FUNCTION'].includes(first)) {
        const p = pathAt(ts, 1), unit = source.aceUnits?.find(u => u.index === s.aceIndex && U(u.eventtype) === first);
        current = { id: source.id + ':' + (unit?.class || owner) + ':' + p?.name, name: U(unit?.eventname || p?.name), owner: U(unit?.class || owner), source, body: [], start: s.offset, end: source.text.length + 1, line: s.line };
        procedures.push(current); conditions = []; continue;
      }
      if (['ENDMETHOD', 'ENDFORM', 'ENDFUNCTION'].includes(first)) { current.end = s.offset; current = global; conditions = []; continue; }
      if (['ENDIF', 'ENDCASE', 'ENDLOOP', 'ENDDO', 'ENDWHILE', 'ENDTRY'].includes(first)) conditions.pop();
      if (['ELSE', 'ELSEIF', 'WHEN', 'CATCH'].includes(first) && conditions.length) {
        const group = conditions[conditions.length - 1]; conditions[conditions.length - 1] = { ...group, branch: s };
      }
      s.conditions = conditions.slice(); current.body.push(s);
      if (['IF', 'CASE', 'LOOP', 'DO', 'WHILE', 'TRY'].includes(first)) conditions.push({ statement: s, branch: s, loop: ['LOOP', 'DO', 'WHILE'].includes(first) });
      if (['ENDCLASS', 'ENDINTERFACE'].includes(first)) owner = '';
      for (let i = 0; i < ts.length; i++) {
        if (val(ts, i) === 'NEW' && word(ts[i + 1])) dependencies.set(val(ts, i + 1), 'CLAS');
        if (word(ts[i]) && ts[i + 1]?.value === '=>') dependencies.set(val(ts, i), 'CLAS');
        if (val(ts, i) === 'INTERFACES' && word(ts[i + 1])) dependencies.set(val(ts, i + 1), 'INTF');
        if (val(ts, i) === 'TYPE' && val(ts, i + 1) === 'REF' && val(ts, i + 2) === 'TO' && word(ts[i + 3])) dependencies.set(val(ts, i + 3), 'CLAS');
      }
      for (const call of s.aceCalls || []) {
        if (call.class && !call.class.includes('(')) dependencies.set(U(call.class), 'CLAS');
        if (U(call.event) === 'FUNCTION' && call.name && !call.name.includes('(')) dependencies.set(U(call.name), 'FUNC');
      }
    }
    for (const param of source.aceParams || []) {
      const key = U(param.class) + '~' + U(param.name), params = signatures.get(key) || [];
      const mode = { I: 'IMPORTING', E: 'EXPORTING', C: 'CHANGING', R: 'RETURNING' }[param.type];
      if (mode && !params.some(p => p.name === U(param.param))) params.push({ name: U(param.param), mode, preferred: param.preferred === 'X' });
      signatures.set(key, params);
    }
  }
  const signature = p => signatures.get(p.owner + '~' + p.name) || (p.name.includes('~') ? signatures.get(p.name) : null) || [];
  return { procedures, signatures, interfaces, dependencies, signature };
}
function argumentsOf(call, p, s, inherited, signature) {
  const ts = call.args, result = { $context: (inherited.$context || '') + '/' + p.id + ':' + s.offset };
  let mode = 'EXPORTING', found = false;
  for (let i = 0; i < ts.length; i++) {
    if (modes.has(val(ts, i))) { mode = val(ts, i); continue; }
    if (!word(ts[i]) || ts[i + 1]?.value !== '=') continue;
    const name = val(ts, i); let end = i + 2, depth = 0;
    for (; end < ts.length; end++) {
      if (depth === 0 && (modes.has(val(ts, end)) || (end > i + 2 && word(ts[end]) && ts[end + 1]?.value === '='))) break;
      if (ts[end].value === '(') depth++; if (ts[end].value === ')') depth--;
    }
    result[name] = { actual: ts.slice(i + 2, end), p, s, inherited, mode }; found = true; i = end - 1;
  }
  if (!found && ts.length) { const formal = signature.find(x => x.preferred) || signature.find(x => x.mode === 'IMPORTING'); if (formal) result[formal.name] = { actual: ts, p, s, inherited, mode: 'EXPORTING' }; }
  const ace = (s.aceCalls || []).find(c => U(c.name).split('~').pop() === call.method.split('~').pop());
  for (const b of ace?.bindings || []) {
    if (!b.inner || !b.outer) continue;
    const name = U(b.inner), mode = { I: 'EXPORTING', E: 'IMPORTING', C: 'CHANGING' }[b.dir] || 'EXPORTING';
    if (result[name]) result[name].mode = mode;
    else result[name] = { actual: tokenize(b.outer), p, s, inherited, mode };
  }
  return result;
}
function resolver(index) {
  const resolving = new Set();
  function types(ts, p, before, bound, depth = 0) {
    if (depth > 15) return new Set();
    if (val(ts, 0) === 'NEW' && word(ts[1])) return new Set([val(ts, 1)]);
    const call = callOf(ts);
    if (call) {
      const result = new Set();
      for (const callee of resolve(call, p, before, bound, depth + 1)) {
        const ret = index.signature(callee).find(x => x.mode === 'RETURNING'); if (!ret) continue;
        const s = { offset: before, line: p.line }, b = argumentsOf(call, p, s, bound, index.signature(callee));
        for (const t of variableTypes(callee, ret.name, callee.end, b, depth + 1)) result.add(t);
      }
      return result;
    }
    const name = onlyPath(ts); return name ? variableTypes(p, name, before, bound, depth + 1) : new Set();
  }
  function variableTypes(p, name, before, bound, depth) {
    if (depth > 15) return new Set();
    const key = p.id + name + before; if (resolving.has(key)) return new Set(); resolving.add(key);
    const result = new Set();
    try {
      const b = bound[name]; if (b) for (const t of types(b.actual, b.p, b.s.offset, b.inherited, depth + 1)) result.add(t);
      for (const s of p.body) {
        if (s.offset >= before) break;
        if (s.assignment?.name === name) {
          if (!s.conditions.length) result.clear();
          for (const t of types(s.assignment.expression, p, s.offset, bound, depth + 1)) result.add(t);
        }
        if (val(s.tokens, 0) === 'DATA' && val(s.tokens, 1) === name && val(s.tokens, 2) === 'TYPE' && val(s.tokens, 3) === 'REF' && val(s.tokens, 4) === 'TO') result.add(val(s.tokens, 5));
      }
    } finally { resolving.delete(key); }
    return result;
  }
  function resolve(call, p, before, bound, depth = 0) {
    let owners = call.owner ? new Set([call.owner]) : (!call.receiver || call.receiver === 'ME') ? new Set([p.owner]) : variableTypes(p, call.receiver, before, bound, depth + 1);
    const statement = p.body.find(s => s.offset === before);
    const aceTargets = (statement?.aceCalls || []).filter(c => U(c.name).split('~').pop() === call.method.split('~').pop() && c.class).map(c => U(c.class));
    // Concrete ACE targets are authoritative. Interface targets are expanded
    // by the inferred concrete references and known implementors below.
    for (const owner of aceTargets) owners.add(owner);
    const result = [];
    for (const candidate of index.procedures) {
      const named = candidate.name === call.method || candidate.name.endsWith('~' + call.method);
      if (named && (owners.has(candidate.owner) || [...owners].some(owner => index.interfaces.get(candidate.owner)?.has(owner)))) result.push(candidate);
    }
    return result;
  }
  return resolve;
}

function analyze(sources, target, options = {}) {
  const index = buildIndex(sources), resolve = resolver(index), nodes = [], edges = [], seen = new Map(), calls = new Map();
  const limit = options.maxNodes || 1200; let truncated = false;
  const node = (kind, label, p, s, extra = {}) => {
    if (nodes.length >= limit) { truncated = true; return null; }
    const id = 'n' + nodes.length; nodes.push({ id, kind, text: label, source: p.source.id, line: s.line || p.line, ...extra }); return id;
  };
  const edge = (from, to, label) => { if (from && to && !edges.some(e => e.from === from && e.to === to && e.label === label)) edges.push({ from, to, label }); };
  function record(call, p, s, matches) {
    const key = p.id + ':' + s.offset + ':' + call.method;
    calls.set(key, { source: p.source.id, line: s.line, caller: p.owner ? p.owner + '->' + p.name : p.source.name || p.source.id,
      method: call.method, callees: matches.map(c => c.owner + '->' + c.name), possible: matches.length !== 1 });
  }
  function conditions(s, p, parent, bound, depth) {
    for (const c of s.conditions) {
      const n = node(c.loop ? 'loop' : 'condition', c.statement.text + (c.branch !== c.statement ? ' / ' + c.branch.text : ''), p, c.statement);
      edge(n, parent, c.loop ? 'possible iteration; order/count not evaluated' : 'execution condition');
      const ts = c.statement.tokens;
      if (val(ts, 0) === 'LOOP') {
        const at = find(ts, 'AT'), into = find(ts, 'INTO');
        expression(ts.slice(at + 1, into >= 0 ? into : ts.length), p, c.statement, n, bound, depth + 1);
        edge(node('boundary', 'Loop-carried values and database-dependent iteration order require runtime evidence.', p, c.statement), n, 'loop boundary');
      } else { for (const v of refs(ts.slice(1))) edge(trace(p, v, c.statement.offset, bound, depth + 1), n, 'condition input'); }
      if (c.branch !== c.statement) for (const v of refs(c.branch.tokens.slice(1))) edge(trace(p, v, c.branch.offset, bound, depth + 1), n, 'branch input');
    }
  }
  function trace(p, name, before, bound = {}, depth = 0) {
    if (depth > 60) { truncated = true; return node('boundary', 'Recursion limit: ' + name, p, { line: p.line }); }
    const key = p.id + ':' + name + ':' + before + ':' + (bound.$context || ''); if (seen.has(key)) return seen.get(key);
    const at = p.body.find(s => s.offset >= before) || { line: p.line };
    const root = node('value', name, p, at); seen.set(key, root); if (!root) return root;
    const candidates = [];
    for (const s of p.body) {
      if (s.offset >= before) break;
      const a = s.assignment, ts = s.tokens, into = find(ts, 'INTO');
      let candidate;
      if (a && contains(a.name, name)) candidate = { s, a, suffix: name.slice(a.name.length) };
      if (val(ts, 0) === 'CLEAR' && contains(pathAt(ts, 1)?.name || '?', name)) candidate = { s, clear: true };
      if (val(ts, 0) === 'SELECT' && into >= 0) {
        let start = into + 1; while (['@', 'TABLE', 'CORRESPONDING', 'FIELDS', 'OF'].includes(val(ts, start))) start++;
        if (val(ts, start) === 'DATA') start += 2;
        const selected = pathAt(ts, start); if (selected && contains(selected.name, name)) candidate = { s, sql: true };
      }
      if (s.call) {
        const matches = resolve(s.call, p, s.offset, bound), b = argumentsOf(s.call, p, s, bound, matches.length ? index.signature(matches[0]) : []);
        for (const [formal, binding] of Object.entries(b)) {
          if (!['CHANGING', 'IMPORTING', 'RECEIVING'].includes(binding?.mode)) continue;
          const actual = onlyPath(binding.actual); if (actual && contains(actual, name)) candidate = { s, call: s.call, matches, formal, suffix: name.slice(actual.length) };
        }
      }
      if (candidate) { if (!s.conditions.length) candidates.length = 0; candidates.push(candidate); }
    }
    if (!candidates.length || candidates.every(c => c.s.conditions.length)) {
      const formal = Object.keys(bound).find(k => !k.startsWith('$') && contains(k, name)), b = formal && bound[formal];
      const output = index.signature(p).find(param => param.mode === 'RETURNING' && contains(param.name, name));
      if (output) edge(node('literal', 'Initial RETURNING value: ' + name, p, { line: p.line }), root, 'unassigned return path');
      else if (b && b.mode !== 'IMPORTING') { const n = node('parameter', text(b.actual) + name.slice(formal.length) + ' → ' + name, b.p, b.s); edge(n, root, 'actual → formal'); expression(b.actual, b.p, b.s, n, b.inherited, depth + 1, name.slice(formal.length)); }
      else {
        const loop = p.body.find(s => s.offset < before && val(s.tokens, 0) === 'LOOP' && (() => { const i = find(s.tokens, 'INTO'), a = val(s.tokens, i + 1) === 'DATA' ? i + 3 : i + 1; return contains(pathAt(s.tokens, a)?.name || '?', name); })());
        if (loop) { const n = node('loop', loop.text, p, loop); edge(n, root, 'row from table'); const at = find(loop.tokens, 'AT'), into = find(loop.tokens, 'INTO'); expression(loop.tokens.slice(at + 1, into), p, loop, n, bound, depth + 1); }
        else {
          const declaration = [...p.body, ...index.procedures.filter(q => q.source.id === p.source.id && q.name === 'GLOBAL').flatMap(q => q.body)].find(s => {
            const first = val(s.tokens, 0), start = s.tokens[1]?.value === '(' ? 2 : 1;
            return ['PARAMETERS', 'DATA', 'STATICS', 'CONSTANTS'].includes(first) && contains(pathAt(s.tokens, start)?.name || '?', name);
          });
          edge(node(declaration ? 'input' : 'unknown', declaration ? declaration.text + ' (initial/input value)' : 'Unresolved input / caller / alias: ' + name, p, declaration || { line: p.line }), root, 'input');
        }
      }
    }
    for (const c of candidates) {
      const n = node(c.sql ? 'select' : c.call ? 'call' : 'calculation', c.s.text, p, c.s, { conditional: !!c.s.conditions.length });
      edge(n, root, c.s.conditions.length ? 'possible definition' : 'definition');
      conditions(c.s, p, n, bound, depth);
      if (c.clear) edge(node('literal', 'Initial value', p, c.s), n, 'CLEAR');
      if (c.a) { expression(c.a.expression, p, c.s, n, bound, depth + 1, c.suffix); if (c.a.compound) edge(trace(p, name, c.s.offset, bound, depth + 1), n, 'previous value'); }
      if (c.sql) {
        const ts = c.s.tokens, tables = []; for (let i = 0; i < ts.length; i++) if (['FROM', 'JOIN'].includes(val(ts, i))) tables.push(ts[i + 1]?.value);
        edge(node('database', 'Database rows: ' + tables.join(', ') + '; contents and sy-subrc require runtime evidence', p, c.s), n, 'data source');
        const into = find(ts, 'INTO'); for (let i = 0; i < ts.length; i++) if (ts[i].value === '@' && i !== into + 1) { const v = pathAt(ts, i + 1); if (v && !contains(v.name, name)) edge(trace(p, v.name, c.s.offset, bound, depth + 1), n, 'SQL input'); }
      }
      if (c.call) {
        record(c.call, p, c.s, c.matches);
        if (c.call.receiver && c.call.receiver !== 'ME' && c.call.arrow === '->') edge(trace(p, c.call.receiver, c.s.offset, bound, depth + 1), n, 'dispatch receiver');
        if (!c.matches.length) edge(node('unknown', 'Unresolved call: ' + c.s.text, p, c.s), n, 'call boundary');
        for (const callee of c.matches) {
          const b = argumentsOf(c.call, p, c.s, bound, index.signature(callee));
          const formal = c.formal;
          edge(trace(callee, formal + c.suffix, callee.end, b, depth + 1), n, (c.matches.length > 1 ? 'possible ' : '') + callee.owner + '->' + callee.name + ' / ' + formal);
        }
      }
    }
    return root;
  }
  function expression(ts, p, s, parent, bound, depth, suffix = '') {
    if (depth > 60 || !parent) { truncated = true; return; }
    const call = callOf(ts);
    if (call) {
      const matches = resolve(call, p, s.offset, bound); record(call, p, s, matches); let returned = false;
      if (call.receiver && call.receiver !== 'ME' && call.arrow === '->') edge(trace(p, call.receiver, s.offset, bound, depth + 1), parent, 'dispatch receiver');
      for (const callee of matches) {
        const formal = index.signature(callee).find(x => x.mode === 'RETURNING'); if (!formal) continue; returned = true;
        const n = node('call', callee.owner + '->' + callee.name + (matches.length > 1 ? ' (possible target)' : ''), p, s);
        edge(n, parent, 'return' + suffix);
        edge(trace(callee, formal.name + suffix, callee.end, argumentsOf(call, p, s, bound, index.signature(callee)), depth + 1), n, 'RETURNING ' + formal.name);
      }
      if (!returned) edge(node('unknown', 'Unresolved call: ' + text(ts), p, s), parent, 'call boundary');
      return;
    }
    const path = onlyPath(ts); if (path && !words.has(path)) { edge(trace(p, path + suffix, s.offset, bound, depth + 1), parent, 'operand'); return; }
    if (suffix && val(ts, 0) === 'VALUE') {
      const open = ts.findIndex(t => t.value === '('), end = close(ts, open), fields = argumentsOf({ args: ts.slice(open + 1, end) }, p, s, bound, []), component = suffix.slice(1).split('-')[0];
      if (fields[component]) { expression(fields[component].actual, p, s, parent, bound, depth + 1, suffix.slice(component.length + 1)); return; }
      if (find(ts, 'BASE') < 0) edge(node('literal', 'Initial value of ' + suffix, p, s), parent, 'omitted VALUE component');
      else edge(node('boundary', 'Structure constructor component unresolved: ' + suffix + ' in ' + text(ts), p, s), parent, 'constructor');
      return;
    }
    if (['CONV', 'CAST', 'COND', 'SWITCH'].includes(val(ts, 0))) { const open = ts.findIndex(t => t.value === '('); if (open >= 0 && close(ts, open) === ts.length - 1) { expression(ts.slice(open + 1, close(ts, open)), p, s, parent, bound, depth + 1, suffix); return; } }
    if (val(ts, 0) === 'NEW') { edge(node('literal', text(ts), p, s), parent, 'object construction'); return; }
    // Resolve nested calls in arithmetic without treating their formal names as variables.
    const remaining = [];
    for (let i = 0; i < ts.length; i++) {
      if (['CONV', 'CAST', 'COND', 'SWITCH'].includes(val(ts, i))) {
        const open = ts.findIndex((t, j) => j > i && t.value === '('), end = close(ts, open);
        if (open > i && end > open) { expression(ts.slice(i, end + 1), p, s, parent, bound, depth + 1); i = end; continue; }
      }
      let end = -1;
      for (let j = i; j < ts.length && j < i + 10; j++) if (ts[j].value === '(') { end = close(ts, j); break; }
      if (end >= i && callOf(ts.slice(i, end + 1))) { expression(ts.slice(i, end + 1), p, s, parent, bound, depth + 1); i = end; } else remaining.push(ts[i]);
    }
    const variables = refs(remaining);
    if (!variables.length) edge(node('literal', text(remaining), p, s), parent, 'constant');
    for (const v of variables) edge(trace(p, v, s.offset, bound, depth + 1), parent, 'operand');
    if (suffix) edge(node('boundary', 'Component projection not supported for this expression: ' + suffix, p, s), parent, 'projection boundary');
  }
  const source = sources.find(s => s.id === target.source); if (!source) throw new Error('Selected source is not present.');
  const parsed = parse(source), token = parsed.tokens.find(t => t.line >= target.line);
  const before = target.offset === undefined ? (token?.offset ?? source.text.length) : target.offset;
  const p = index.procedures.filter(p => p.source.id === source.id && p.start <= before && p.end >= before).sort((a, b) => b.start - a.start)[0];
  if (!p) throw new Error('No procedure at selected location.');
  const root = trace(p, U(target.variable), before);
  return { root, nodes, edges, calls: [...calls.values()], truncated, mode: 'static', notice: 'Backward source dependencies across calls. Possible dispatch targets and branches are alternatives; loop order, database contents and runtime values are not inferred.' };
}
function variableAt(source, offset) {
  // Editor hit testing only. The selected SAP source is parsed by ACE.
  const part = c => !!c && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || '_-/~<>'.includes(c));
  let start = offset, end = offset;
  while (start > 0 && part(source[start - 1])) start--;
  while (end < source.length && part(source[end])) end++;
  return start < end ? U(source.slice(start, end)) : null;
}
async function collectSources(initial, load, options = {}) {
  const sources = initial.slice(), warnings = [], visited = new Set(initial.flatMap(s => [U(s.name), U(s.objectName)])), limit = options.maxSources || 80;
  for (let cursor = 0; cursor < sources.length; cursor++) {
    if (options.cancelled?.()) throw new Error('Value origin cancelled.');
    const idx = buildIndex([sources[cursor]]);
    for (const [name, type] of idx.dependencies) {
      if (visited.has(name) || idx.interfaces.has(name) || name === 'ME' || name === 'OBJECT') continue;
      visited.add(name);
      if (sources.length >= limit) { warnings.push('Source limit reached: ' + name); continue; }
      try { const loaded = await load(name, type); for (const source of Array.isArray(loaded) ? loaded : [loaded]) { if (!sources.some(s => s.id === source.id)) sources.push(source); } options.progress?.(name); }
      catch (e) { warnings.push(name + ': ' + e.message); }
    }
  }
  return { sources, warnings };
}
module.exports = { analyze, buildIndex, collectSources, variableAt };
