"use strict";
/* Formula and Expression of a value from a recorded run, not from the analysis. The record holds the values at every stop,
   taken before the statement there ran; so where a value differs from the stop before, the statement of that earlier stop
   is the one that changed it. That statement is read with abaplint: what it writes is its target, what it reads are the
   field chains of its sources, and each of those is derived the same way, back through the record. The result has the
   shape of the analysis's formula - nodes and edges for the diagram, a tree for the panes - so the view draws either. */

const { escape } = require("./value-origin-formula-html");

const upper = value => String(value || "").toUpperCase();
const signature = value => value === undefined ? undefined : JSON.stringify(value);
// A value as the formula writes it: a table by its rows, an object reference as an object, a structure briefly - the
// formula is about the numbers, and a whole instance would not fit a diagram.
const shown = value => {
  if (value === undefined) return "";
  // A packed number keeps its decimals as zeros (1200.000): the formula writes it without them.
  if (value === null || typeof value !== "object") return /^\s*-?\d+\.\d*\s*$/.test(String(value)) ? String(value).trim().replace(/\.?0+$/, "") : String(value);
  if (Array.isArray(value)) return value.length + " rows";
  if ("INTERNAL_ID" in value || "me" in value) return "object";
  const text = JSON.stringify(value);
  return text.length > 80 ? Object.keys(value).length + " fields" : text;
};

// The statements of one source, by abaplint; a source that cannot be parsed has none, and says so.
function parsedSource(text, url) {
  const lint = require("@abaplint/core");
  const kind = /\.clas\.abap$|\/oo\/classes\//i.test(url) ? "clas" : /\.intf\.abap$|\/oo\/interfaces\//i.test(url) ? "intf" : "prog";
  const registry = new lint.Registry().addFile(new lint.MemoryFile("vertex." + kind + ".abap", String(text || "")));
  registry.parse();
  const file = registry.getFirstObject()?.getABAPFiles()[0];
  return file ? file.getStatements() : [];
}

// What a statement writes and what it reads, from abaplint's expressions: a target and the field chains of its sources.
function statementAt(statements, line) {
  const lint = require("@abaplint/core");
  const covering = statements.filter(node => node.getStart().getRow() <= line && node.getEnd().getRow() >= line
    && !["Comment", "Empty"].includes(node.get().constructor.name));
  const node = covering.find(item => item.getStart().getRow() === line) || covering[0];
  if (!node) return null;
  // An inline declaration's target is the field it declares: DATA(lv_x) writes LV_X.
  const targets = node.findAllExpressionsRecursive(lint.Expressions.Target).map(item => {
    const inline = item.findFirstExpression(lint.Expressions.InlineData);
    const field = inline && inline.findFirstExpression(lint.Expressions.TargetField);
    return upper((field || item).concatTokens());
  });
  // What is read is told from what is written by place, not by name: in x = x + y the x on the right is read.
  const at = token => token.getRow() + ":" + token.getCol();
  const inTargets = new Set(node.findAllExpressionsRecursive(lint.Expressions.Target).flatMap(item => item.getTokens().map(at)));
  const reads = [];
  for (const chain of node.findAllExpressionsRecursive(lint.Expressions.FieldChain)) {
    const name = upper(chain.concatTokens());
    if (!inTargets.has(at(chain.getFirstToken())) && !reads.includes(name)) reads.push(name);
  }
  // The right-hand side as pieces: text, and the field chains in it, so the expression can put each one's own
  // derivation in its place. A statement with no source - LOOP, WRITE - has none.
  const source = node.findDirectExpression(lint.Expressions.Source);
  const rhs = source ? pieces(source, lint) : null;
  // A call's parameters and what it passes them: CHANGING cs_context = ls_context binds CS_CONTEXT to LS_CONTEXT.
  const bindings = {};
  for (const kind of [lint.Expressions.ParameterS, lint.Expressions.ParameterT]) {
    for (const parameter of node.findAllExpressionsRecursive(kind)) {
      const formal = parameter.findDirectExpression(lint.Expressions.ParameterName);
      const actual = parameter.findDirectExpression(lint.Expressions.Source) || parameter.findDirectExpression(lint.Expressions.Target);
      if (formal && actual) bindings[upper(formal.concatTokens())] = upper(actual.concatTokens());
    }
  }
  return { text: node.concatTokens(), targets, reads, rhs, bindings, line: node.getStart().getRow() };
}
function pieces(expression, lint) {
  const out = [];
  const visit = item => {
    if (item instanceof lint.Nodes.ExpressionNode && item.get() instanceof lint.Expressions.FieldChain) { out.push({ chain: upper(item.concatTokens()) }); return; }
    // CONV changes a type, not what the value is computed from: as in the analysis's formula, only what it converts.
    if (item instanceof lint.Nodes.ExpressionNode && item.get() instanceof lint.Expressions.Source && upper(item.getFirstToken().getStr()) === "CONV") {
      const inner = item.findDirectExpression(lint.Expressions.ConvBody)?.findDirectExpression(lint.Expressions.Source);
      if (inner) { visit(inner); return; }
    }
    if (item instanceof lint.Nodes.TokenNode || item instanceof lint.Nodes.TokenNodeRegex) { out.push({ text: item.getFirstToken().getStr() }); return; }
    item.getChildren().forEach(visit);
  };
  visit(expression);
  return out;
}

/* request: { variable, at, steps: [{ url, line, location, values: { NAME: value } }], sources: { url: text } }
   values are the whole set at that stop, before its statement ran. */
function build(request) {
  const steps = Array.isArray(request?.steps) ? request.steps : [];
  const variable = upper(request?.variable);
  if (!variable) throw new Error("Choose a value in Variables first.");
  if (!steps.length) throw new Error("Nothing is recorded yet.");
  const at = Math.min(steps.length - 1, Number.isInteger(request.at) ? request.at : steps.length - 1);
  const parsed = new Map();
  const statementsOf = url => {
    if (!parsed.has(url)) parsed.set(url, request.sources && request.sources[url] != null ? parsedSource(request.sources[url], url) : null);
    return parsed.get(url);
  };
  // A name may be a component: LS_RESULT-AMOUNT is AMOUNT of LS_RESULT, read from the structure the record kept.
  const valueAt = (name, index) => {
    const values = steps[index]?.values || {};
    const parts = upper(name).split("-");
    let value = values[parts[0]];
    for (const part of parts.slice(1)) {
      if (value === null || typeof value !== "object") return undefined;
      const key = Object.keys(value).find(item => upper(item) === part);
      value = key === undefined ? undefined : value[key];
    }
    return value;
  };
  // A record of steps alone - no values - still says which statements ran: a value is then derived from the last of
  // them that wrote it, and shown without values.
  const hasValues = steps.some(step => step.values && Object.keys(step.values).length);
  const statementOfStep = index => {
    const step = steps[index], statements = step && statementsOf(step.url);
    return statements ? statementAt(statements, step.line) : null;
  };
  const writes = (index, name) => {
    const statement = statementOfStep(index), base = upper(name).split("-")[0];
    return !!statement && statement.targets.some(target => target === upper(name) || target === base || upper(name).startsWith(target + "-"));
  };
  const known = name => hasValues ? steps.some((_, index) => valueAt(name, index) !== undefined)
    : steps.some((_, index) => writes(index, name));
  const nodes = [], edges = [], said = [];
  let count = 0, maxLevel = 0;
  // The last change of a value at or before a stop: the stop whose statement made it, or none - the value came from
  // before the record, or from code the record did not stop in.
  // A change seen on coming back from a call was made by the call: the statement is the last stop at the depth the
  // change is seen at, not the deeper stop just before it.
  const depthOf = index => Number(steps[index]?.depth) || 0;
  // A name the call at the stop before passes in: one of its parameters.
  const entered = (name, index) => { const statement = statementOfStep(index - 1); return !!statement && !!statement.bindings[upper(name).split("-")[0]]; };
  const changeOf = (name, upto) => {
    if (!hasValues) {
      for (let index = upto - 1; index >= 0; index--) if (writes(index, name)) return { made: index, seen: index + 1 };
      return null;
    }
    const own = depthOf(upto);
    for (let index = upto; index >= 1; index--) {
      // Back to where this routine was entered with no change on the way: the value is what the call passed in. Said
      // even when it equals the value before - a transpiler record keeps every routine's names in one set.
      if (depthOf(index) === own && depthOf(index - 1) < own && name.split("-")[0] !== "" ) {
        if (signature(valueAt(name, index)) === signature(valueAt(name, index - 1)) && !entered(name, index)) continue;
        return { made: index - 1, seen: index };
      }
      if (signature(valueAt(name, index)) === signature(valueAt(name, index - 1))) continue;
      let made = index - 1;
      // Stops the record read no values at only carry the value from before: the change was made after the last stop
      // that was read, by the last statement since then that writes the name, else by that stop's own statement.
      if (steps[made].read === false) {
        let last = made;
        while (last > 0 && steps[last].read === false) last--;
        made = last;
        for (let between = index - 1; between > last; between--) if (depthOf(between) === depthOf(index) && writes(between, name)) { made = between; break; }
      }
      if (depthOf(made) > depthOf(index)) while (made > 0 && depthOf(made) > depthOf(index)) made--;
      // The value is there from the stop after the statement that made it, though the record may first read it later.
      const after = made + 1;
      // SAP stops on the calling line again when the call returns, before the assignment: that stop is no statement of
      // its own, the call is the stop before the routine was entered. The value is the same at both - in a loop, an
      // earlier pass of the same line has the value of that pass.
      let entry = made - 1;
      while (entry > 0 && depthOf(entry) > depthOf(made)) entry--;
      if (entry < made - 1 && depthOf(entry) === depthOf(made) && steps[entry].url === steps[made].url && steps[entry].line === steps[made].line
        && signature(valueAt(name, entry)) === signature(valueAt(name, made))) made = entry;
      return { made, seen: index, after };
    }
    return null;
  };
  /* The value a call gave back, as the routine had it. The record is taken before each statement, so the routine's
     last statement never shows its result inside the call: the routine's name for the value is found by the statement
     that last wrote the same component within the call, and is derived from that statement. A value with no component
     is matched by value at the routine's last stop. */
  const returnedBy = (name, seen, made) => {
    const component = upper(name).split("-").slice(1).join("-");
    // The routine's stops: from the call to the first stop back at its depth (SAP's return stop on the calling line).
    let end = made + 1;
    while (end < steps.length && depthOf(end) > depthOf(made)) end++;
    const inside = end - 1;
    if (component) {
      for (let index = end - 1; index > made; index--) {
        if (depthOf(index) !== depthOf(made) + 1) continue;
        // The component itself, or the whole structure that holds it (rs_result = ls_context, CHANGING cs_context = ...).
        const targets = statementOfStep(index)?.targets || [];
        const target = targets.find(item => item.endsWith("-" + component)) || targets.find(item => !item.includes("-") && !item.includes("("));
        if (target) return { name: target.endsWith("-" + component) ? target : target + "-" + component, made: index };
      }
    }
    if (!hasValues) return null;
    const wanted = signature(valueAt(name, seen)), parts = upper(name).split("-");
    if (wanted === undefined) return null;
    const names = Object.keys(steps[inside]?.values || {}).filter(key => key !== parts[0]);
    const same = names.map(key => component ? key + "-" + component : key)
      .filter(candidate => signature(valueAt(candidate, inside)) === wanted && changeOf(candidate, inside));
    const found = same[0] && changeOf(same[0], inside);
    return found ? { name: same[0], made: found.made } : null;
  };
  // forced: the stop whose statement made the value, and the value it made, when the caller already knows them.
  const derive = (name, upto, level, walked, forced = null) => {
    const id = "rf" + count++;
    const value = valueAt(name, Math.min(upto, steps.length - 1));
    maxLevel = Math.max(maxLevel, level);
    const found = forced ? { made: forced.made, seen: forced.made + 1 } : changeOf(name, Math.min(upto, steps.length - 1));
    // The guard is the name at a stop, not the name: x = x + y reads the x of an earlier stop, which is derived too.
    const change = found && !walked.has(name + "@" + found.made) ? found : null;
    if (!change) {
      const node = { id, level, of: name, value: shown(value), text: name, outside: true, source: "", line: 0, location: "", children: [] };
      return node;
    }
    const made = change.made, step = steps[made];
    const statements = statementsOf(step.url);
    const statement = statements ? statementAt(statements, step.line) : null;
    if (!statements && !said.includes(step.url)) said.push(step.url);
    const node = { id, level, of: name, value: forced ? forced.value : shown(valueAt(name, change.seen)), before: shown(valueAt(name, change.made)),
      text: statement ? statement.text : "line " + step.line, rhs: statement ? statement.rhs : null, source: step.url, line: step.line, location: step.location || "",
      stop: made, seen: forced ? made + 1 : change.after || change.seen, children: [] };
    // Set on entering a call: a parameter, given by the call's arguments. In the expression it stays a name.
    if (hasValues && !forced && depthOf(change.seen) > depthOf(made)) { node.parameter = true; node.rhs = null; node.text = "parameter of " + node.text; }
    const path = new Set(walked).add(name + "@" + made);
    // Changed by a call: the value came back from the routine it ran. The record's last stop inside that call holds it
    // under the routine's own name - the same component of its returning structure, else the variable that had it.
    const called = hasValues ? change.seen - 1 > made : depthOf(made + 1) > depthOf(made) && !node.parameter;
    const returned = called ? returnedBy(name, change.seen, made) : null;
    if (returned) { const child = derive(returned.name, returned.made, level + 1, path, { made: returned.made, value: node.value }); child.returned = true; node.children.push(child); }
    // A parameter set on entering the call came from the argument the call passed it, in the caller.
    const component = upper(name).split("-").slice(1).join("-"), base = upper(name).split("-")[0];
    if (node.parameter && statement && statement.bindings[base]) {
      const actual = statement.bindings[base], carried = component && !actual.includes("-") ? actual + "-" + component : actual;
      const child = derive(carried, made, level + 1, path); child.passed = true; node.children.push(child);
      return node;
    }
    // A whole structure copied (rs_result = ls_context) carries the component the value is: LS_CONTEXT-AMOUNT is read.
    const whole = component && statement && statement.targets.includes(base);
    for (const read of statement ? statement.reads : []) {
      const carried = whole && !read.includes("-") && !read.includes("(") ? read + "-" + component : read;
      if (!known(carried)) continue;
      node.children.push(derive(carried, made, level + 1, path));
    }
    return node;
  };
  // The formula is the one the whole record gives; at an earlier stop the part computed by then has its values, a
  // statement still to run has none.
  const tree = derive(variable, steps.length - 1, 0, new Set());
  // A value is there from the stop it is seen at - a call's result only once the call returns.
  const mark = node => { if (node.seen !== undefined && node.seen > at) node.pending = true; node.children.forEach(mark); };
  mark(tree);
  // What the tree shows: a node that leads to the same code as its only child says nothing the child does not - the
  // parameter a call passed, over that call - and gives way to it. Expression is written from the whole tree.
  const sameCode = (a, b) => !!a.source && a.source === b.source && a.line === b.line;
  // So does a parameter whose code - the call that passed it - is already shown above it.
  const shownTree = (node, level = 0, above = []) => {
    let kept = node;
    while (kept.children.length === 1 && (sameCode(kept, kept.children[0]) || kept.parameter && above.some(item => sameCode(item, kept)))) kept = kept.children[0];
    const path = above.concat(kept);
    return { ...kept, level, children: kept.children.map(child => shownTree(child, level + 1, path)) };
  };
  const display = shownTree(tree);
  maxLevel = 0;
  const walk = node => {
    maxLevel = Math.max(maxLevel, node.level);
    // A diagram node says it briefly; the whole statement is in the tree and behind the link.
    const brief = text => String(text).length > 100 ? String(text).slice(0, 97) + "…" : String(text);
    nodes.push({ id: node.id, level: node.level, text: brief(node.text), label: hasValues ? node.of + " = " + (node.pending ? "not computed yet" : node.value === "" ? "(empty)" : node.value) + (node.outside ? "" : "  ·  " + brief(node.text)) : brief(node.text),
      dataText: brief(node.text), location: node.location || node.source, source: node.source, line: node.line, stack: 0, variables: [] });
    node.children.forEach(child => { edges.push({ from: node.id, to: child.id, label: child.of }); walk(child); });
  };
  walk(display);
  return { formula: { nodes, edges, maxLevel }, tree, hasValues, panes: { formula: formulaPane(display, said, hasValues), expression: expressionPane(tree, hasValues) } };
}

const where = node => node.outside ? "not changed in the record" : (String(node.location || "").split("->")[0] || node.source) + ":" + node.line + " · stop " + (node.stop + 1);
// Every name of the formula and of the tree is the link to the statement that set its value; with no statement in
// the record it is plain text.
const link = (node, label) => node && node.source ? `<button class="data-composed" title="Open the statement that set it: ${escape(where(node))}" data-node="${escape(node.id)}" data-source="${escape(node.source)}" data-line="${node.line}">${label}</button>` : label;

function formulaPane(tree, said, hasValues = true) {
  const html = (node, root) => {
    const caption = `<span class="formula-expression">${link(node, "<b>" + escape(node.of) + "</b>")}${hasValues ? " " + equals(node) + " " + (node.pending ? "not computed yet" : escape(node.value)) : ""}</span>`
      + (node.outside ? ` <span class="edge">${escape(hasValues ? where(node) : "not written in the record")}</span>` : ` <code>${escape(node.text)}</code> <span class="edge">${escape(where(node))}${hasValues && node.before !== undefined ? " · before this assignment: " + (node.before === "" ? "empty" : escape(node.before)) : ""}</span>`);
    const children = node.children.map(child => html(child, false)).join("");
    return children ? `<details class="formula-node" data-formula-node="${escape(node.id)}" data-level="${node.level}"${root ? " open" : ""}><summary>${caption}</summary><div class="formula-children">${children}</div></details>`
      : `<div class="formula-leaf" data-formula-node="${escape(node.id)}" data-level="${node.level}">${caption}</div>`;
  };
  const missing = said.length ? `<p class="edge">No source for ${escape(said.join(", "))}: its statements are shown by line.</p>` : "";
  return `<p class="edge">From the run - each value, the statement that set it, and what that statement read${hasValues ? ", with the values the record holds" : "; recorded without values (Rec steps)"}</p>${missing}` + html(tree, true);
}

// The derivation written out as one expression, as the analysis's Expression is: the right-hand side of the statement
// that made the value, each value it read replaced by its own right-hand side, as far as the record goes. Under it the
// statements in the order they ran, and the values it started from.
// A name of the formula with the value the record holds for it, in brackets; the view hides the values with
// With values off.
// The = of an assignment: green once it has run at the stop shown, red while it is still to run.
const equals = node => `<span class="${node && node.pending ? "rf-pending" : "rf-assigned"}">=</span>`;
const named = (name, value, hasValues, node) => link(node, escape(name.toLowerCase())) + (hasValues && value !== undefined && !(node && node.pending) ? `<span class="rf-value"> (${escape(value === "" ? "empty" : value)})</span>` : "");
const tail = name => upper(name).split("-").slice(1).join("-");
/* The derivation written out as one expression, the one way the run went: the right-hand side of the statement that
   made the value, each value it read replaced by its own right-hand side, as far as the record goes. A value a call
   changed is written as the routine computed it - the child that carries the same component (LS_RESULT-AMOUNT,
   then the routine's CS_CONTEXT-AMOUNT), or the value it returned. HTML, with the values of the names left in it. */
function expressionText(node, hasValues, seen = new Set()) {
  if (node.outside || seen.has(node.id)) return named(node.of, node.value, hasValues, node);
  const path = new Set(seen).add(node.id);
  const reads = new Set((node.rhs || []).filter(piece => piece.chain).map(piece => piece.chain));
  const carrier = node.children.find(item => (item.returned || item.passed) && !item.outside)
    || (tail(node.of) && node.children.find(item => !item.outside && !reads.has(item.of) && tail(item.of) === tail(node.of)));
  if (carrier) return expressionText(carrier, hasValues, path);
  if (!node.rhs) return named(node.of, node.value, hasValues, node);
  return node.rhs.map(piece => {
    if (!piece.chain) return escape(piece.text);
    const child = node.children.find(item => item.of === piece.chain);
    // A read value is written out as far as the record goes - through a parameter to the argument the call passed.
    if (!child || child.outside || !child.rhs && !child.children.some(item => (item.returned || item.passed) && !item.outside)) return named(piece.chain, child && child.value, hasValues, child);
    const inner = expressionText(child, hasValues, path);
    return inner.includes(" ") ? "( " + inner + " )" : inner;
  }).join(" ");
}
// The formula first, then what its names stand for, then the statements in the order they ran.
function expressionPane(tree, hasValues = true) {
  const changes = [];
  const collect = node => { if (!node.outside && !changes.some(item => item.stop === node.stop && item.of === node.of)) changes.push(node); node.children.forEach(collect); };
  collect(tree);
  changes.sort((a, b) => a.stop - b.stop);
  const inputs = [];
  const leaves = node => { if (node.outside && !inputs.some(item => item.of === node.of)) inputs.push(node); node.children.forEach(leaves); };
  leaves(tree);
  if (tree.outside) return `<p class="edge">${escape(tree.of)} was not ${hasValues ? "changed" : "written"} in the record.</p>`;
  const steps = changes.map(node => `<li><code>${named(node.of, node.value, hasValues, node)} ${equals(node)} ${node.rhs ? expressionText({ ...node, children: [] }, false) : escape(node.text)}</code> <span class="edge">${escape(where(node))}</span></li>`).join("");
  const given = inputs.map(node => hasValues ? `<li><code>${escape(node.of.toLowerCase())} = ${escape(node.value === "" ? "(empty)" : node.value)}</code> <span class="edge">${escape(where(node))}</span></li>`
    : `<li><code>${escape(node.of.toLowerCase())}</code> <span class="edge">not written in the record</span></li>`).join("");
  return `<p><code>${named(tree.of, tree.value, hasValues, tree)} ${equals(tree)} ${expressionText(tree, hasValues)}</code></p>${hasValues ? `<p class="edge">${tree.pending ? "Not computed yet at this stop" : "= " + escape(tree.value)}</p>` : ""}`
    + (given ? `<p class="edge">Where the values come from</p><ul class="expression-where">${given}</ul>` : "")
    + (steps ? `<p class="edge">The statements, in the order they ran</p><ol class="expression-steps">${steps}</ol>` : "");
}

module.exports = { build, statementAt, parsedSource };
