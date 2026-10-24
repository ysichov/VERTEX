"use strict";
/* The statements of an open ABAP document as abaplint parses them, kept per document version: folding and the
   block jumps (double-click, F12, Ctrl+click) read the same parse, so a jump after the editor has folded waits for
   nothing. The parse runs in value-origin-linter's worker. */
const cache = new Map();

function statementsOf(document) {
  const key = document.uri.toString(), known = cache.get(key);
  if (known && known.version === document.version && known.text === document.getText()) return known.statements;
  const text = document.getText();
  const statements = (async () => {
    const parser = require('./value-origin-linter').createParser();
    try {
      return (await parser.parse({ id: key, name: document.fileName || key, objectName: '',
        objectType: /\.clas\.|\/CLAS\//i.test(key) ? 'CLAS' : 'PROG', text })).source.aceStatements;
    } finally { await parser.close(); }
  })();
  cache.set(key, { version: document.version, text, statements });
  // A failed parse is not kept: the next request tries again and reports its own failure.
  statements.catch(() => { if (cache.get(key)?.statements === statements) cache.delete(key); });
  return statements;
}

function forget(document) { cache.delete(document.uri.toString()); }

module.exports = { statementsOf, forget };
