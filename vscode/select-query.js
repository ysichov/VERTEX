"use strict";

// Run Select: the SELECT under the cursor, made runnable by ADT's freestyle data preview.
// abaplint parses the statement; nothing here reads ABAP text with patterns. What the program would supply at run time
// is not known here, so: INTO, FOR ALL ENTRIES and UP TO leave the statement (UP TO becomes the row count), and a WHERE
// condition that reads a program value is dropped - it becomes TRUE. Inside AND that widens the result; an OR containing
// it collapses whole and is reported as dropped; under NOT it would narrow the result, so the statement is refused.
// Any other clause that reads a program value, and anything dynamic, is refused too: the statement is run as written
// or not at all.

const DEFAULT_ROWS = 100;

function prepare(text, offset) {
  const lint = require("@abaplint/core");
  const E = lint.Expressions;
  const registry = new lint.Registry().addFile(new lint.MemoryFile("vertex.prog.abap", text));
  registry.parse();
  const file = registry.getFirstObject()?.getABAPFiles()[0];
  if (!file) { throw new Error("abaplint did not parse this source."); }
  const starts = [0];
  for (let i = 0; i < text.length; i++) { if (text[i] === "\n") { starts.push(i + 1); } }
  const at = token => starts[token.getRow() - 1] + token.getCol() - 1;
  const statement = file.getStatements().find(node => {
    const kind = node.get().constructor.name;
    if (kind === "Comment" || kind === "Empty") { return false; }
    const last = node.getLastToken();
    return at(node.getFirstToken()) <= offset && offset <= at(last) + last.getStr().length;
  });
  if (!statement) { throw new Error("There is no ABAP statement at the cursor. Place it on a SELECT."); }
  const select = statement.findFirstExpression(E.Select);
  if (!select || statement.getFirstToken().getStr().toUpperCase() !== "SELECT") {
    throw new Error("The statement at the cursor is not a SELECT (abaplint reads it as " + statement.get().constructor.name + ").");
  }
  if (select.findFirstExpression(E.Dynamic)) {
    throw new Error("The SELECT has a dynamic part - its table, fields or condition are made at run time and are not known here.");
  }
  const kind = node => node.get().constructor.name;
  const hostValue = node => !!node.findFirstExpression(E.FieldChain);
  const dropped = [];
  let rows = DEFAULT_ROWS;
  const parts = [];

  // SQLCond is flat: operands (SQLCompare, or SQLCond between brackets) joined by AND / OR / NOT tokens.
  const condition = node => {
    const items = node.getChildren().filter(child => {
      const word = child.getFirstToken().getStr();
      return !(child instanceof lint.Nodes.TokenNode && (word === "(" || word === ")"));
    });
    let i = 0;
    const word = () => items[i] instanceof lint.Nodes.TokenNode ? items[i].getFirstToken().getStr().toUpperCase() : "";
    const operand = () => {
      if (word() === "NOT") { i++; return { not: operand() }; }
      const item = items[i++];
      if (!item) { throw new Error("abaplint returned an incomplete WHERE condition."); }
      return kind(item) === "SQLCond" ? condition(item) : { leaf: item };
    };
    const and = () => { const list = [operand()]; while (word() === "AND") { i++; list.push(operand()); } return list.length > 1 ? { and: list } : list[0]; };
    const list = [and()];
    while (word() === "OR") { i++; list.push(and()); }
    return list.length > 1 ? { or: list } : list[0];
  };
  const source = tree => tree.leaf ? tree.leaf.concatTokens()
    : tree.not ? "NOT " + bracket(tree.not)
    : (tree.and || tree.or).map(bracket).join(tree.and ? " AND " : " OR ");
  const bracket = tree => tree.leaf || tree.not ? source(tree) : "( " + source(tree) + " )";
  const unknown = tree => tree.leaf ? hostValue(tree.leaf) : tree.not ? unknown(tree.not) : (tree.and || tree.or).some(unknown);
  // The condition with every unknown comparison as TRUE: null is TRUE.
  const known = tree => {
    if (!unknown(tree)) { return tree; }
    if (tree.leaf) { dropped.push(source(tree)); return null; }
    if (tree.not) {
      throw new Error("NOT " + bracket(tree.not) + " reads a program value. Dropping it would narrow the result rather than widen it, so the SELECT is not run.");
    }
    if (tree.or) { dropped.push(source(tree)); return null; }
    const kept = tree.and.map(known).filter(Boolean);
    return kept.length === 0 ? null : kept.length === 1 ? kept[0] : { and: kept };
  };

  // SelecTor takes the SELECT when it can say the same thing; otherwise the reason is kept for the plain window.
  let selector = null, notSelector = "";
  try { selector = toSelector(lint, select, condition); } catch (reason) { notSelector = reason.message; }
  const line = statement.getFirstToken().getRow();
  try {
    return Object.assign(runnable(), { selector, notSelector, line });
  } catch (error) {
    // A statement SelecTor holds is opened there even when it could not run as written: an unknown value under NOT
    // is one empty line of the selection, which restricts nothing until it is filled.
    if (selector) { return { selector, notSelector, line, dropped: [] }; }
    throw error;
  }

  function runnable() {
  const children = select.getChildren();
  for (let i = 0; i < children.length; i++) {
    const child = children[i], name = kind(child);
    if (child instanceof lint.Nodes.TokenNode) {
      const word = child.getFirstToken().getStr().toUpperCase();
      if (word === "SINGLE") { rows = 1; continue; }
      if (word === "WHERE") {
        const kept = known(condition(children[++i]));
        if (kept) { parts.push("WHERE " + source(kept)); }
        continue;
      }
      parts.push(child.concatTokens());
      continue;
    }
    if (/^SQLInto/.test(name) || name === "SQLForAllEntries") { continue; }
    if (name === "SQLUpTo") {
      const count = child.findFirstExpression(E.Integer);
      if (count && !hostValue(child)) { rows = Number(count.concatTokens()); }
      else { dropped.push(child.concatTokens()); }
      continue;
    }
    if (hostValue(child)) {
      throw new Error("\"" + child.concatTokens() + "\" reads a program value; only WHERE conditions can be left out, so the SELECT is not run.");
    }
    // The list of an old-style SELECT has no commas; the freestyle preview takes the strict syntax.
    if (name === "SQLFieldList" || name === "SQLFieldListLoop") {
      const fields = child.getChildren().filter(item => !(item instanceof lint.Nodes.TokenNode && item.getFirstToken().getStr() === ","));
      parts.push(fields.map(item => item.concatTokens()).join(", "));
      continue;
    }
    parts.push(child.concatTokens());
  }
  return { sql: parts.join(" "), rows, dropped };
  }
}

const OPERATORS = { "=": "EQ", EQ: "EQ", "<>": "NE", "><": "NE", NE: "NE", ">": "GT", GT: "GT", ">=": "GE", GE: "GE", "<": "LT", LT: "LT", "<=": "LE", LE: "LE" };

// The SELECT as SelecTor's state: one table, its WHERE as select-option lines. Throws, with the reason, what SelecTor
// cannot say. A program value becomes a line with no value, which restricts nothing until the reader fills it in.
function toSelector(lint, select, condition) {
  const E = lint.Expressions, kind = node => node.get().constructor.name;
  const words = node => node instanceof lint.Nodes.TokenNode ? node.getFirstToken().getStr().toUpperCase() : "";
  const body = select.findDirectExpression(E.SQLFrom)?.findDirectExpression(E.SQLFromBody);
  const head = body && body.findDirectExpression(E.SQLFromSource);
  if (!head) { throw new Error("it does not read from database tables."); }
  const source = node => {
    const table = node.findDirectExpression(E.DatabaseTable), as = node.findDirectExpression(E.SQLAsName);
    if (!table) { throw new Error("it reads from something other than a database table."); }
    return { table: table.concatTokens().toUpperCase(), name: (as || table).concatTokens().toLowerCase() };
  };
  // A join becomes SelecTor's: the first table is the base, t0, and each joined one is t1, t2... in the order written,
  // as SelecTor's join resource hands its aliases out. Its type and ON come along; the resource refuses a table the
  // dictionary does not offer, which the caller asks before opening.
  const base = source(head), aliases = new Map([[base.name, "t0"]]), joins = [];
  body.findDirectExpressions(E.SQLJoin).forEach((join, index) => {
    const kinds = join.getChildren().map(words).filter(Boolean);
    if (kinds.includes("RIGHT") || kinds.includes("CROSS")) { throw new Error("it uses a " + kinds.join(" ").split(" ON")[0] + ", and SelecTor joins INNER or LEFT OUTER."); }
    const inner = join.findDirectExpression(E.SQLJoinSource)?.findDirectExpression(E.SQLFromSource);
    if (!inner || inner.findDirectExpression(E.SQLJoin)) { throw new Error("it nests joins, which SelecTor builds one after another."); }
    const joined = source(inner), alias = "t" + (index + 1);
    aliases.set(joined.name, alias);
    joins.push({ table: joined.table, alias: alias.toUpperCase(), type: kinds.includes("LEFT") ? "LEFT OUTER" : "INNER", cond: join.findDirectExpression(E.SQLCond) });
  });
  const aliasOf = name => {
    const alias = aliases.get(name.toLowerCase());
    if (!alias) { throw new Error(name + " is not a table of the FROM."); }
    return alias;
  };
  // Tokens, not text: abaplint gives alias~field as one token, and its alias is renamed to SelecTor's.
  const renamed = node => node.getTokens().map(token => {
    const text = token.getStr(), at = text.indexOf("~");
    return at > 0 && !/^['`]/.test(text) ? aliasOf(text.slice(0, at)) + text.slice(at).toLowerCase() : text;
  }).join(" ");
  const on = {}, jtypes = {};
  for (const join of joins) {
    if (!join.cond || join.cond.findFirstExpression(E.FieldChain)) { throw new Error("the ON of " + join.table + " reads a program value."); }
    on[join.alias] = renamed(join.cond);
    jtypes[join.alias] = join.type;
  }
  const fieldOf = node => {
    const text = node.concatTokens(), at = text.indexOf("~");
    if (!joins.length) { return text.slice(at + 1).toLowerCase(); }
    if (at < 0) { throw new Error(text.toUpperCase() + " does not say which table of the join it is in."); }
    return { alias: aliasOf(text.slice(0, at)), field: text.slice(at + 1).toLowerCase() };
  };
  for (const child of select.getChildren()) {
    const name = kind(child), word = words(child);
    if (name === "SQLHaving") { throw new Error("it filters groups with HAVING, which SelecTor's pivot does not."); }
    if (name === "SQLUnion") { throw new Error("it combines SELECTs with UNION, which SelecTor does not."); }
    if (word === "DISTINCT") { throw new Error("it reads DISTINCT rows, which SelecTor does not."); }
  }
  const filters = [];
  const where = select.getChildren().findIndex(child => words(child) === "WHERE");
  if (where >= 0) {
    // Lines of one field are ORed by SelecTor, so a field's including lines must come from one OR or one IN.
    const including = new Map();
    const take = (lines, field) => {
      if (lines.some(line => line.sign === "I")) {
        if (including.has(field)) { throw new Error("it puts two including conditions on " + field.toUpperCase() + " with AND, and SelecTor ORs a field's lines."); }
        including.set(field, true);
      }
      filters.push(...lines);
    };
    const group = tree => {
      if (tree.leaf || tree.not) { const lines = leaf(tree); take(lines, lines[0].field); return; }
      if (tree.and) { tree.and.forEach(group); return; }
      const lines = tree.or.flatMap(branch => {
        if (!(branch.leaf || branch.not)) { throw new Error("it nests AND inside OR, which select-options cannot say."); }
        return leaf(branch);
      });
      if (new Set(lines.map(line => line.field)).size > 1) { throw new Error("it ORs conditions on different fields, which select-options cannot say."); }
      if (lines.some(line => line.sign === "E")) { throw new Error("it ORs an excluding condition, which select-options cannot say."); }
      // A program value inside an OR stands for any value: an empty line would narrow the OR to the known values.
      if (lines.some(line => line.unknown)) { throw new Error("an OR on " + lines[0].field.toUpperCase() + " holds a program value."); }
      take(lines, lines[0].field);
    };
    group(condition(select.getChildren()[where + 1]));
  }
  const lines = filters.map(({ unknown, ...line }) => line);
  // GROUP BY or an aggregate: SelecTor's pivot - the grouped fields are its rows, the aggregates its measures.
  const grouping = select.findDirectExpression(E.SQLGroupBy);
  const list0 = select.findDirectExpression(E.SQLFieldList) || select.findDirectExpression(E.SQLFieldListLoop);
  if (grouping || (list0 && list0.findFirstExpression(E.SQLAggregation))) {
    const keyOf = node => { const at = fieldOf(node); return typeof at === "string" ? "t0~" + at : at.alias + "~" + at.field; };
    const nameIn = node => node.findDirectExpression(E.SQLAliasField) || node.findDirectExpression(E.SQLFieldName);
    const rows = grouping ? grouping.findDirectExpressions(E.SQLField).map(field => {
      const name = nameIn(field);
      if (!name || field.getChildren().length > 1) { throw new Error("it groups by an expression, which SelecTor's pivot does not."); }
      return keyOf(name);
    }) : [];
    if (!list0 || list0.concatTokens().includes("~*") || list0.concatTokens() === "*") { throw new Error("it groups with a star in its field list."); }
    const vals = [];
    for (const field of list0.findDirectExpressions(E.SQLField)) {
      const aggregation = field.findDirectExpression(E.SQLAggregation);
      if (!aggregation) {
        const name = nameIn(field);
        if (!name || !rows.includes(keyOf(name))) { throw new Error("\"" + field.concatTokens() + "\" is neither grouped nor aggregated."); }
        continue;
      }
      const agg = words(aggregation.getChildren()[0]), input = aggregation.findDirectExpression(E.SQLFunctionInput);
      if (!["COUNT", "SUM", "MIN", "MAX", "AVG"].includes(agg)) { throw new Error(agg + " is not an aggregate SelecTor's pivot has."); }
      if (aggregation.getChildren().some(child => words(child) === "DISTINCT")) { throw new Error("it aggregates DISTINCT values, which SelecTor's pivot does not."); }
      if (!input) {
        if (agg !== "COUNT") { throw new Error("\"" + aggregation.concatTokens() + "\" has no field."); }
        vals.push({ key: "*", agg });
        continue;
      }
      const name = nameIn(input);
      if (!name || input.getChildren().length > 1) { throw new Error("\"" + aggregation.concatTokens() + "\" aggregates an expression, which SelecTor's pivot does not."); }
      vals.push({ key: keyOf(name), agg });
    }
    return { table: base.table, join: joins.map(join => join.table), jtypes, on, fields: [], filters: lines,
             pivot: { rows, cols: [], vals } };
  }
  // The SELECT list: SelecTor's field keys, alias~field, in a join; the columns to show of one table. A star is all.
  const list = select.findDirectExpression(E.SQLFieldList) || select.findDirectExpression(E.SQLFieldListLoop);
  const fields = !list || list.concatTokens().includes("*") ? []
    : list.findAllExpressions(E.SQLField).map(field => {
      const name = field.findFirstExpression(E.SQLAliasField) || field.findFirstExpression(E.SQLFieldName);
      if (!name) { throw new Error("its field list holds more than fields."); }
      const at = fieldOf(name);
      return typeof at === "string" ? at : at.alias + "~" + at.field;
    });
  if (!joins.length) { return { table: base.table, filters: lines, columns: fields }; }
  return { table: base.table, join: joins.map(join => join.table), jtypes, on, fields, filters: lines };

  // One comparison as select-option lines: field op value, BETWEEN, LIKE, IN; NOT makes them excluding.
  function leaf(tree) {
    let negated = false;
    while (tree.not) { negated = !negated; tree = tree.not; }
    if (!tree.leaf) { throw new Error("it puts NOT before a group of conditions."); }
    const node = tree.leaf, parts = node.getChildren(), text = node.concatTokens();
    const first = parts[0];
    if (!first || !["SQLFieldName", "SQLAliasField"].includes(kind(first))) { throw new Error("\"" + text + "\" does not start with a field."); }
    // SelecTor names a column of the base table by its field, one of a joined table T1_FIELD.
    const at = fieldOf(first);
    const field = typeof at === "string" ? at : at.alias === "t0" ? at.field : at.alias + "_" + at.field;
    let rest = parts.slice(1);
    if (words(rest[0]) === "NOT") { negated = !negated; rest = rest.slice(1); }
    const sign = negated ? "E" : "I";
    const value = source => {
      if (source.findFirstExpression(lint.Expressions.FieldChain)) { return null; }
      const constant = source.findFirstExpression(lint.Expressions.Constant);
      if (!constant || constant.concatTokens() !== source.concatTokens().replace(/^@\s*/, "")) { throw new Error("\"" + text + "\" compares with something other than a value."); }
      const raw = constant.concatTokens();
      return /^['`]/.test(raw) ? raw.slice(1, -1).replace(/''/g, "'").replace(/``/g, "`") : raw;
    };
    const line = (option, low, high = "") => low === null || high === null
      ? { field, sign, option, low: "", high: "", unknown: true } : { field, sign, option, low, high };
    if (kind(rest[0]) === "SQLCompareOperator") {
      const option = OPERATORS[rest[0].concatTokens().toUpperCase()];
      if (!option || !rest[1]) { throw new Error("\"" + text + "\" uses an operator select-options do not have."); }
      return [line(option, value(rest[1]))];
    }
    if (words(rest[0]) === "BETWEEN") { return [line("BT", value(rest[1]), value(rest[3]))]; }
    if (words(rest[0]) === "LIKE") {
      const pattern = value(rest[1]);
      return [line("CP", pattern === null ? null : pattern.replace(/%/g, "*").replace(/_/g, "+"))];
    }
    if (kind(rest[0]) === "SQLIn") {
      const sources = rest[0].getChildren().filter(child => /^SQLSource/.test(kind(child)));
      return sources.map(source => line("EQ", value(source)));
    }
    throw new Error("\"" + text + "\" is a condition select-options cannot say.");
  }
}

module.exports = { prepare, DEFAULT_ROWS };
