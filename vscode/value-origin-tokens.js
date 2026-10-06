"use strict";
// Token punctuation adapter and local test-fixture scanner. SAP statement boundaries come from ACE.
const letter = c => !!c && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '/');
const digit = c => !!c && c >= '0' && c <= '9';
const wordPart = c => letter(c) || digit(c);

function tokenize(source) {
  const tokens = []; let pos = 0, line = 1, lineStart = true;
  const put = (kind, value, atLine) => tokens.push({ kind, value, line: atLine, offset: pos - value.length, endOffset: pos });
  while (pos < source.length) {
    const c = source[pos];
    if (c === '\r') { pos++; continue; }
    if (c === '\n') { line++; lineStart = true; pos++; continue; }
    if (c === ' ' || c === '\t') { pos++; continue; }
    if (c === '"' || (c === '*' && lineStart)) { while (pos < source.length && source[pos] !== '\n') pos++; continue; }
    lineStart = false;
    if (c === "'" || c.charCodeAt(0) === 96 || c === '|') {
      const quote = c, atLine = line; let value = c; pos++;
      while (pos < source.length) {
        const next = source[pos++]; value += next;
        if (next === '\n') line++;
        if (next === quote) { if (source[pos] === quote) value += source[pos++]; else break; }
      }
      put('literal', value, atLine); continue;
    }
    if ((letter(c) && (c !== '/' || letter(source[pos + 1]))) || (c === '<' && letter(source[pos + 1]))) {
      const atLine = line; let value = c; pos++;
      if (c === '<') { while (pos < source.length && source[pos] !== '>') value += source[pos++]; if (source[pos] === '>') value += source[pos++]; }
      else while (wordPart(source[pos])) value += source[pos++];
      put('word', value, atLine); continue;
    }
    if (digit(c)) {
      const atLine = line; let value = c; pos++;
      while (digit(source[pos])) value += source[pos++];
      if (source[pos] === '.' && digit(source[pos + 1])) { value += source[pos++]; while (digit(source[pos])) value += source[pos++]; }
      put('number', value, atLine); continue;
    }
    const pair = source.slice(pos, pos + 2);
    if (['->', '=>', '<=', '>=', '<>', '+=', '-=', '*=', '/='].includes(pair)) { pos += 2; put('symbol', pair, line); continue; }
    pos++; put('symbol', c, line);
  }
  return tokens;
}
function printable(tokens) {
  let text = '';
  for (const token of tokens) {
    const noSpaceBefore = ['.', ',', ')', ']', '}'].includes(token.value);
    const noSpaceAfter = text.endsWith('(') || text.endsWith('[') || text.endsWith('{');
    text += !text || noSpaceBefore || noSpaceAfter ? token.value : ' ' + token.value;
  }
  return text;
}
function statement(tokens) { return { tokens, line: tokens[0] ? tokens[0].line : 1, end: tokens.length ? tokens[tokens.length - 1].line : 1, text: printable(tokens) }; }
function statements(source) { const result = [], tokens = tokenize(source); let current = []; for (const token of tokens) { current.push(token); if (token.kind === 'symbol' && token.value === '.') { result.push(statement(current)); current = []; } } if (current.length) result.push(statement(current)); return result; }

module.exports = { tokenize, statements, printable };
