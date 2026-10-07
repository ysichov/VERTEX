"use strict";

// Parse in a worker: loading the ABAP grammar must not block the extension host.
// The ace* field names below are the existing model's input contract, not SAP
// data. Every fact in this adapter is produced locally from ADT source text.
function parseSource(source) {
  const lint = require('@abaplint/core');
  const { assignment, variablePaths, buildIndex } = require('./value-origin-model');
  const kind = { CLAS: 'clas', INTF: 'intf' }[source.objectType] || 'prog';
  const registry = new lint.Registry().addFile(new lint.MemoryFile('vertex.' + kind + '.abap', source.text));
  registry.parse();
  const file = registry.getFirstObject()?.getABAPFiles()[0];
  if (!file) throw new Error('abaplint did not produce an ABAP source index.');
  const starts = [0];
  for (let i = 0; i < source.text.length; i++) if (source.text[i] === '\n') starts.push(i + 1);
  const warnings = [];
  const tokensOf = node => node.getTokens().filter(t => !['Comment', 'Pragma'].includes(t.constructor.name))
    .map(t => {
      const value = t.getStr(), offset = starts[t.getRow() - 1] + t.getCol() - 1;
      const literal = /^(StringToken|StringTemplate)/.test(t.constructor.name);
      return { value, kind: literal ? 'literal' : /^\d+(\.\d+)?$/.test(value) ? 'number'
        : /^(?:[A-Za-z_][\w\/]*|\/[A-Za-z_][\w\/]*|<\w+>)$/.test(value) ? 'word' : 'symbol',
        line: t.getRow(), offset, endOffset: offset + value.length };
    });
  const statements = [];
  for (const node of file.getStatements()) {
    const statementKind = node.get().constructor.name;
    if (['Comment', 'Empty'].includes(statementKind)) continue;
    const tokens = tokensOf(node).filter(t => !['.', ','].includes(t.value));
    // ABAP keywords containing '-' are single lexer tokens; the shared model
    // expects CLASS - METHODS / START - OF - SELECTION instead.
    const expanded = tokens.flatMap(t => t.kind !== 'literal' && /^[\w/]+(?:[-~][\w/]+)+$/.test(t.value)
      ? require('./value-origin-tokens').tokenize(t.value).map(p => ({ ...p, line: t.line,
        offset: t.offset + p.offset, endOffset: t.offset + p.endOffset })) : [t]);
    if (!expanded.length) continue;
    if (['Unknown', 'MacroCall', 'MacroContent', 'NativeSQL'].includes(statementKind)) {
      warnings.push(source.name + ':' + expanded[0].line + ': unsupported ' + statementKind);
    }
    const targets = node.findAllExpressions(lint.Expressions.Target).map(n => tokensOf(n));
    const parameterOffsets = new Set([lint.Expressions.ParameterS, lint.Expressions.ParameterT]
      .flatMap(type => node.findAllExpressions(type)).map(n => {
        const t = n.getFirstToken(); return starts[t.getRow() - 1] + t.getCol() - 1;
      }));
    // A chain element (WRITE: / a, b.) begins with the chain's keyword, so its first token is on the keyword's
    // line; the debugger stops on the line where the element's own part starts, after the colon.
    const colon = node.getColon(), colonAt = colon && starts[colon.getRow() - 1] + colon.getCol() - 1;
    const own = colon ? expanded.find(t => t.offset > colonAt) : null;
    statements.push({ tokens: expanded, offset: expanded[0].offset, line: expanded[0].line, stepLine: own ? own.line : expanded[0].line,
      text: node.concatTokens(), aceIndex: statements.length + 1, localTargets: targets,
      localParameterOffsets: [...parameterOffsets], parserKind: statementKind });
  }
  const indexed = { ...source, aceStatements: statements, aceFlowSteps: [] };
  const index = buildIndex([indexed]);
  for (const statement of statements) {
    const a = assignment(statement.tokens);
    const names = a ? [a.name] : statement.localTargets.map(ts => ts.map(t => t.value).join(''))
      .filter(name => /^(?:[A-Za-z_][\w]*|<\w+>)(?:-[\w]+)*$/.test(name)).map(name => name.toUpperCase());
    const operands = a ? a.expression : statement.tokens;
    const dependencies = [...new Set(variablePaths(operands)
      .filter(p => !statement.localParameterOffsets.includes(operands[p.from].offset)).map(p => p.name))];
    const procedure = index.procedures.find(p => p.body.some(s => s.aceIndex === statement.aceIndex));
    indexed.aceFlowSteps.push({ statement_index: statement.aceIndex, line: statement.line,
      eventname: procedure?.name || 'GLOBAL',
      calculated: [...new Set(names)].map(name => ({ name, class: procedure?.owner || source.objectName,
        eventname: procedure?.name || 'GLOBAL', line: statement.line })),
      composed: dependencies.map(name => ({ name })) });
    delete statement.localTargets;
    delete statement.localParameterOffsets;
  }
  return { source: indexed, warnings };
}

function createParser(cancelled = () => false) {
  const { Worker } = require('worker_threads');
  const worker = new Worker(__filename);
  let serial = 0;
  return {
    parse(source) {
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const finish = (error, result) => {
          clearInterval(poll); clearTimeout(timeout);
          worker.off('message', message); worker.off('error', failed); worker.off('exit', exited);
          error ? reject(error) : resolve(result);
        };
        const message = reply => { if (reply.id === id) finish(reply.error ? new Error(reply.error) : null, reply.result); };
        const failed = error => finish(error);
        const exited = code => finish(new Error('Local ABAP parser stopped (' + code + ').'));
        const poll = setInterval(() => { if (cancelled()) { finish(new Error('Value origin cancelled.')); void worker.terminate(); } }, 100);
        const timeout = setTimeout(() => { finish(new Error('Local ABAP parser exceeded its time limit.')); void worker.terminate(); }, 120000);
        worker.on('message', message); worker.once('error', failed); worker.once('exit', exited);
        worker.postMessage({ id, source });
      });
    },
    close: () => worker.terminate()
  };
}

const { isMainThread, parentPort } = require('worker_threads');
if (!isMainThread && parentPort) parentPort.on('message', ({ id, source }) => {
  try { parentPort.postMessage({ id, result: parseSource(source) }); }
  catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
module.exports = { parseSource, createParser };
