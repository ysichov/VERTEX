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
  // A packed number keeps its decimals as zeros (1200.000): the formula writes it without them. SAP may write the
  // decimals after a comma (8370,648, the user's decimal format) while a table's value has a point: one point for all.
  if (value === null || typeof value !== "object") return /^\s*-?\d+[.,]\d*\s*$/.test(String(value)) ? String(value).trim().replace(",", ".").replace(/\.?0+$/, "") : String(value);
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
    // CONV changes a type, not what the value is computed from: as in the analysis's formula, only what it converts -
    // bracketed when it is more than one operand - and then the rest of the source after it (CONV t( a ) / b).
    if (item instanceof lint.Nodes.ExpressionNode && item.get() instanceof lint.Expressions.Source && upper(item.getFirstToken().getStr()) === "CONV") {
      const children = item.getChildren(), body = children.findIndex(child => child.get && child.get() instanceof lint.Expressions.ConvBody);
      const inner = body >= 0 ? children[body].findDirectExpression(lint.Expressions.Source) : null;
      if (inner) {
        const single = inner.getChildren().length === 1;
        if (!single) out.push({ text: "(" });
        visit(inner);
        if (!single) out.push({ text: ")" });
        children.slice(body + 2).forEach(visit);
        return;
      }
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
      // An assignment can compute the same value (notably zero). It still has a derivation. A call that passes the name
      // on (CHANGING cs_context = ls_context) and gives it back unchanged is not one: the value was made before it, and
      // taking the call for it cut the chain at a modifier that changed nothing.
      if (signature(valueAt(name, index)) === signature(valueAt(name, index - 1))) {
        const statement = statementOfStep(index - 1);
        if (writes(index - 1, name) && !(statement && Object.keys(statement.bindings || {}).length)) return { made: index - 1, seen: index };
        continue;
      }
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
      stop: made, seen: forced ? made + 1 : change.after || change.seen, subrc: step.subrc, children: [] };
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
// The link carries the stop the statement ran at too, so a click shows the step as well as the code.
const link = (node, label) => node && node.source ? `<button class="data-composed" title="${node.readHere ? "Read here before it was set" : "Open the statement that set it"}: ${escape(where(node))}" data-node="${escape(node.id)}" data-source="${escape(node.source)}" data-line="${node.line}"${Number.isInteger(node.stop) ? ` data-stop="${node.stop}"` : ""}>${label}</button>` : label;

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

// Expression from the record: the statement that made the value, with the values it read; when the value was built up
// in one variable step after step, the same as one product; under it, after where, what each value read that was
// itself computed stands for, as far as the record goes; then the values it started from and the statements in the
// order they ran.
// A name of the formula with the value the record holds for it, in brackets - four decimals at most, the whole value
// on hover; the view hides the values with With values off.
// The = of an assignment: green once it has run at the stop shown, red while it is still to run.
const equals = node => `<span class="${node && node.pending ? "rf-pending" : "rf-assigned"}">=</span>`;
// Colour only literal source fragments; linked variable names keep their own styling.
const sourceText = text => {
  const input = String(text), token = /'(?:''|[^'])*'|\b(?:SELECT|SINGLE|FROM|WHERE|INTO|CORRESPONDING|FIELDS|OF|TABLE|DATA|NEW|VALUE|CONV|WHEN|THEN|ELSE|IF|ENDIF|CASE|ENDCASE|COND|CHANGING|EXPORTING|IMPORTING|RETURNING|abap_true|abap_false)\b|\b\d+(?:[.,]\d+)?\b/ig;
  let html = "", offset = 0, match;
  while ((match = token.exec(input))) {
    html += escape(input.slice(offset, match.index));
    const kind = match[0].startsWith("'") ? "string" : /^\d/.test(match[0]) ? "number" : "keyword";
    html += `<span class="rf-${kind}">${escape(match[0])}</span>`;
    offset = token.lastIndex;
  }
  return html + escape(input.slice(offset));
};
const rounded = text => {
  if (!/^-?\d+\.\d+$/.test(text)) return text;
  const number = Number(text), short = Math.abs(number) >= 1 ? number.toFixed(4) : number.toPrecision(4);
  return /e/.test(short) ? short : short.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};
const valueSpan = value => {
  const text = value === "" ? "empty" : String(value), short = rounded(text);
  return `<span class="rf-value"${short === text ? "" : ` title="${escape(text)}"`}> (${escape(short)})</span>`;
};
/* A value a SELECT left empty is red, with why: it found nothing (sy-subrc not 0, the value stayed as it was), or it
   found a row whose field is empty or 0. The record keeps SY-SUBRC read after each SELECT; without it only the empty
   value is known. */
const emptyFromSelect = (node, value) => {
  if (!node || node.outside || !/^SELECT\b/i.test(String(node.text || ""))) return "";
  const subrc = node.subrc == null ? "" : String(node.subrc).trim();
  if (subrc !== "" && Number(subrc) !== 0) return "SELECT found nothing (sy-subrc " + subrc + "): the value stayed as it was";
  if (!/^(?:0+(?:[.,]0*)?)?$/.test(String(value == null ? "" : value).trim())) return "";
  return subrc === "" ? "SELECT gave an empty value" : "SELECT found a row whose field is empty (sy-subrc 0)";
};
/* A value read empty that the run sets later - tax_amount (0) read by the discount, the tax set after it - was read
   before it was set: red, with the stop that sets it. WRITTEN_LATER: name -> first stop that writes it, for the pane
   being drawn. */
let writtenLater = null;
// The statement that sets NODE's name later in the run: by its name, or - a structure handed on through a parameter,
// cs_context-tax_amount read as the caller's ls_context-tax_amount - by its component.
const laterOf = node => !writtenLater || !node ? null : writtenLater.get(upper(node.of)) || (tail(node.of) ? writtenLater.get("~" + tail(node.of)) : null) || null;
/* Read before it was set: the value read is empty (0, initial) and a statement of the run sets the name to something
   after the value read was made - never changed in the record, or made empty along with its structure
   (DATA(ls_context) = get_shipment( ) fills the structure, leaving tax_amount 0), the tax computed later. */
const isEmpty = value => /^(?:0+(?:[.,]0*)?)?$/.test(String(value == null ? "" : value).trim());
const readBeforeSet = (node, value) => {
  if (!node || !isEmpty(value)) return "";
  const later = laterOf(node);
  if (!later || later === node || isEmpty(later.value) || (!node.outside && !(later.stop > node.stop))) return "";
  return "Read before it was set: the run sets " + later.of.toLowerCase() + " later, at stop " + (later.stop + 1);
};
// A name read before it was set goes to where too: what it was then, and the statement that set it later. Its link
// leads to the statement that read it - no statement set the value it read, and that read is where it went wrong.
const readHere = at => Object.assign(Object.create(at), { readHere: true });
const early = (piece, child) => !!child && !compound(child) && !!readBeforeSet(made(child), child.value);
// READ: the value's own node when the link leads elsewhere (to the statement that read it).
const named = (name, value, hasValues, node, mark = "", read = null) => {
  const own = read || node, label = link(node, escape(name.toLowerCase()) + mark), why = readBeforeSet(own, value) || emptyFromSelect(own, value);
  const shown = hasValues && value !== undefined && !(node && node.pending) ? valueSpan(value) : "";
  // The name and its value red together: the value is what was wrong.
  return why ? `<span class="rf-empty" title="${escape(why)}">${label}${shown}</span>` : label + shown;
};
const tail = name => upper(name).split("-").slice(1).join("-");
/* A value a call changed is made where the routine computed it - the child that carries the same component
   (LS_RESULT-AMOUNT, then the routine's CS_CONTEXT-AMOUNT), the value it returned, or the argument a parameter was
   given. MADE follows those to the statement that computed the value; a name links there, so it carries no place. */
const plainText = html => html.replace(/<span class="rf-value"[^>]*>[^<]*<\/span>/g, "").replace(/<[^>]*>/g, "").trim();
const carrierOf = node => {
  const reads = new Set((node.rhs || []).filter(piece => piece.chain).map(piece => piece.chain));
  return node.children.find(item => (item.returned || item.passed) && !item.outside)
    || (tail(node.of) && node.children.find(item => !item.outside && !reads.has(item.of) && tail(item.of) === tail(node.of)));
};
const made = node => {
  const seen = new Set();
  let at = node;
  for (let next; !at.outside && !seen.has(at.id) && (next = carrierOf(at)); at = next) seen.add(at.id);
  return at;
};
// One value: the name the statement that made it wrote, at that stop.
const keyOf = node => { const at = made(node); return at.of + "@" + at.stop; };
const readIn = (at, chain) => at.children.find(item => item.of === chain);
/* One step of the derivation: the right-hand side of the statement that made the value, each name with the value it
   read - not written out further. NAMES receives the names read that were computed themselves from several terms,
   which where opens. */
function stepText(node, hasValues, names = [], num = null) {
  const at = made(node), mark = (name, item) => num ? num.mark(name, item, at) : "";
  if (at.outside || !at.rhs) return named(at.of, at.value, hasValues, at, mark(at.of, at));
  return at.rhs.map(piece => {
    if (!piece.chain) return sourceText(piece.text);
    const child = readIn(at, piece.chain);
    if (child && !child.outside && compound(child)) names.push({ name: piece.chain, node: child });
    const soon = early(piece, child);
    if (soon) names.push({ name: piece.chain, node: child, early: true, reader: at });
    return named(piece.chain, child && child.value, hasValues, soon ? readHere(at) : child && made(child), mark(piece.chain, child), soon ? made(child) : null);
  }).join(" ");
}
const compound = node => { const at = made(node); return !at.outside && !!at.rhs && plainText(stepText(at, false)).includes(" "); };
/* What the computed names of a step stand for, level by level. The first level is the names of the formula, in its
   order and side by side - amount4 and tax_amount2 of amount4 + tax_amount2. A line that reads computed names of its
   own opens them one level down, under an arrow, folded: the next level of the explanation is a click away and does
   not come between two names of the line above. A value is opened at the first level it is read on, and once. */
function decoding(names, hasValues, done, num) {
  const roots = [], queue = names.map(item => ({ ...item, into: roots }));
  while (queue.length) {
    const entry = queue.shift(), key = entry.early ? "early:" + keyOf(entry.node) : keyOf(entry.node);
    if (done.has(key)) continue;
    done.add(key);
    entry.at = made(entry.node);
    entry.parts = [];
    // Read before it was set: no statement made it; under it, the statement that set it later in the run.
    if (entry.early) {
      const later = laterOf(entry.at);
      entry.text = `<span class="edge">${escape(readBeforeSet(entry.at, entry.node.value))}${later && done.has(keyOf(later)) ? " (above)" : ""}</span>`;
      entry.into.push(entry);
      if (later) queue.push({ name: entry.name, node: later, into: entry.parts });
      continue;
    }
    const inner = [];
    entry.text = stepText(entry.at, hasValues, inner, num);
    entry.into.push(entry);
    inner.forEach(item => queue.push({ ...item, into: entry.parts }));
  }
  const list = entries => !entries.length ? "" : `<ul class="expression-decode">${entries.map(entry => {
    const name = entry.early && entry.reader ? named(entry.name, entry.node.value, hasValues, readHere(entry.reader), num.mark(entry.name, entry.node, entry.reader), entry.at)
      : named(entry.name, entry.node.value, hasValues, entry.at, num.mark(entry.name, entry.node, entry.reader || entry.at));
    const line = entry.early ? `<code>${name}</code> ${entry.text}` : `<code>${name} ${equals(entry.at)} ${entry.text}</code>`;
    return entry.parts.length ? `<li class="more"><details><summary>${line}</summary>${list(entry.parts)}</details></li>` : `<li>${line}</li>`;
  }).join("")}</ul>`;
  return list(roots);
}
/* A name read with several values in one Expression - amount = amount + amount * x, step after step - is numbered by
   the order the values were made, the first with a subscript 1. A value is the statement that made it; a value the
   record never saw change comes before them all. A component - cs_context-amount - belongs to a structure handed on
   from routine to routine and is one variable wherever it is read; a plain name - lv_percent - is each routine's own,
   so two routines' are two variables and are not numbered as one. MARK leaves a place after the name, READER being
   the statement that reads it; FILL numbers it once every value is known. */
const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
const routineOf = node => String(node && node.location || "").split("->")[0];
function numbering() {
  const marks = [], versions = new Map();
  return {
    mark(name, node, reader) {
      if (!node) return "";
      const at = made(node), lower = String(name).toLowerCase();
      const group = lower.includes("-") ? lower : lower + "|" + routineOf(at.outside ? reader : at);
      const key = at.outside ? "given" : keyOf(at);
      if (!versions.has(group)) versions.set(group, new Map());
      versions.get(group).set(key, at.outside ? -1 : at.stop);
      marks.push({ group, key });
      return "\u0001" + (marks.length - 1) + "\u0002";
    },
    fill(html) {
      return html.replace(/\u0001(\d+)\u0002/g, (all, index) => {
        const { group, key } = marks[Number(index)];
        const order = [...versions.get(group)].sort((a, b) => a[1] - b[1]).map(([version]) => version);
        return order.length > 1 ? String(order.indexOf(key) + 1).split("").map(digit => SUBSCRIPT[digit]).join("") : "";
      });
    }
  };
}
/* The value built up in one variable step after step, written as one product. Each step is read as linear in the
   value before it, k * A + c, from + - * / of names, numbers and brackets, a computed name read through its own step
   when it depends on A (fuel_amount = amount * lv_percent); the steps are then put one into the next, factored, never
   multiplied out. A step that reads anything else, or multiplies A by itself, gives no product, and the line says so.
   The product has a where of its own, under it: the computed names it reads - the first value, the fuel percent -
   explained as the formula's are, so the two can be told apart and checked one against the other. */
const term = (factors, neg = false) => ({ neg, factors });
const termHtml = item => !item.factors.length ? "1" : item.factors.map((factor, index) => (index ? (factor.div ? " / " : " × ") : factor.div ? "1 / " : "") + factor.html).join("");
const sumHtml = sum => !sum.length ? "0" : sum.map((item, index) => (index ? (item.neg ? " − " : " + ") : item.neg ? "− " : "") + termHtml(item)).join("");
const negated = sum => sum.map(item => term(item.factors, !item.neg));
const times = (x, y) => x.flatMap(a => y.map(b => term(a.factors.concat(b.factors), a.neg !== b.neg)));
const over = (x, y) => y.length === 1 ? x.map(a => term(a.factors.concat(y[0].factors.map(factor => ({ ...factor, div: !factor.div }))), a.neg !== y[0].neg))
  : x.map(a => term(a.factors.concat([{ html: "( " + sumHtml(y) + " )", div: true }]), a.neg));
const linear = {
  add: (a, b) => ({ k: a.k.concat(b.k), c: a.c.concat(b.c) }),
  sub: (a, b) => ({ k: a.k.concat(negated(b.k)), c: a.c.concat(negated(b.c)) }),
  mul: (a, b) => {
    if (a.k.length && b.k.length) throw new Error("it multiplies the value by itself");
    return b.k.length ? { k: times(b.k, a.c), c: times(a.c, b.c) } : { k: times(a.k, b.c), c: times(a.c, b.c) };
  },
  div: (a, b) => {
    if (b.k.length) throw new Error("it divides by the value");
    if (!b.c.length) throw new Error("it divides by nothing");
    return { k: over(a.k, b.c), c: over(a.c, b.c) };
  }
};
function linearIn(at, read) {
  const tokens = [];
  at.rhs.forEach(piece => piece.chain ? tokens.push(piece) : String(piece.text).split(/\s+/).filter(Boolean).forEach(text => tokens.push({ text })));
  let index = 0;
  const peek = () => tokens[index] && tokens[index].text, next = () => tokens[index++];
  const sum = () => { let value = product(); while (peek() === "+" || peek() === "-") { const op = next().text, right = product(); value = op === "+" ? linear.add(value, right) : linear.sub(value, right); } return value; };
  const product = () => { let value = factor(); while (peek() === "*" || peek() === "/") { const op = next().text, right = factor(); value = op === "*" ? linear.mul(value, right) : linear.div(value, right); } return value; };
  const factor = () => {
    const token = next();
    if (!token) throw new Error("it ends early");
    if (token.chain) return read(token.chain);
    if (token.text === "-") { const value = factor(); return { k: negated(value.k), c: negated(value.c) }; }
    if (token.text === "(") { const value = sum(); if (peek() !== ")") throw new Error("a bracket is not closed"); next(); return value; }
    const number = /^'?(-?\d+(?:\.\d+)?)'?$/.exec(token.text);
    if (number) return { k: [], c: [term([{ html: escape(number[1]) }])] };
    throw new Error("it reads " + token.text);
  };
  const value = sum();
  if (index < tokens.length) throw new Error("it reads " + (tokens[index].text || tokens[index].chain.toLowerCase()));
  return value;
}
const depends = (node, key, seen = new Set()) => {
  const at = made(node), own = keyOf(node);
  if (own === key) return true;
  if (at.outside || !at.rhs || seen.has(own)) return false;
  seen.add(own);
  return at.rhs.some(piece => { const child = piece.chain && readIn(at, piece.chain); return !!child && depends(child, key, seen); });
};
function productForm(tree, hasValues, num, names) {
  const steps = [], seen = new Set();
  for (let at = made(tree); at.rhs && !seen.has(keyOf(at));) {
    seen.add(keyOf(at));
    const piece = at.rhs.find(item => item.chain && upper(item.chain) === upper(at.of)), before = piece && readIn(at, piece.chain);
    if (!before) break;
    steps.unshift({ at, before, name: piece.chain });
    if (made(before).outside) break;
    at = made(before);
  }
  if (steps.length < 2) return "";
  const first = steps[0];
  const explain = (name, node) => { if (node && !node.outside && compound(node)) names.push({ name, node }); };
  explain(first.name, first.before);
  let text = named(first.name, first.before.value, hasValues, made(first.before), num.mark(first.name, first.before, first.at));
  for (const { at, before, name } of steps) {
    const key = keyOf(before);
    const read = (step, path) => chain => {
      const child = readIn(step, chain);
      if (child && keyOf(child) === key) return { k: [term([])], c: [] };
      if (child && !path.has(keyOf(child)) && depends(child, key)) return linearIn(made(child), read(made(child), new Set(path).add(keyOf(child))));
      explain(chain, child);
      return { k: [], c: [term([{ html: named(chain, child && child.value, hasValues, child && made(child), num.mark(chain, child, step)) }])] };
    };
    let form;
    try { form = linearIn(at, read(at, new Set([keyOf(at)]))); }
    catch (error) { return `<p class="edge">No product: ${escape(at.text)} is not a sum or product of ${escape(name.toLowerCase())} - ${escape(error.message)}.</p>`; }
    if (!form.k.length) return `<p class="edge">No product: ${escape(at.text)} does not keep ${escape(name.toLowerCase())}.</p>`;
    const unit = form.k.length === 1 && !form.k[0].neg && !form.k[0].factors.length;
    const by = unit ? "" : form.k.length === 1 && !form.k[0].neg ? " × " + termHtml(form.k[0]) : " × ( " + sumHtml(form.k) + " )";
    text = form.c.length ? `( ${text}${by}${form.c.map(item => (item.neg ? " − " : " + ") + termHtml(item)).join("")} )` : text + by;
  }
  return `<p class="edge">the same as one rule: the first value and the rates, the sums in between folded in</p><p><code>${named(tree.of, tree.value, hasValues, tree, num.mark(tree.of, tree))} ${equals(tree)} ${text}</code></p>`;
}
/* The same as one line, behind Optimized: each value read written out into the formula by its own statement, as far
   as the record goes, a value written out once named by its value the next time it is read - so that amount = amount +
   amount * x does not double the whole line at every step. A plain value (one name, a literal) is written again. */
function inlineText(node, hasValues, num, names = [], seen = new Set(), written = new Set()) {
  const at = made(node);
  if (node.outside || seen.has(node.id) || written.has(keyOf(node))) {
    if (!node.outside && compound(node)) names.push({ name: node.of, node });
    return named(node.of, node.value, hasValues, at, num.mark(node.of, node, at));
  }
  const path = new Set(seen).add(node.id);
  if (!at.rhs) return named(at.of, at.value, hasValues, at, num.mark(at.of, at, at));
  const text = at.rhs.map(piece => {
    if (!piece.chain) return sourceText(piece.text);
    const child = readIn(at, piece.chain);
    if (!child || made(child).outside || !made(child).rhs || written.has(keyOf(child))) {
      if (child && !made(child).outside && compound(child)) names.push({ name: piece.chain, node: child });
      const soon = early(piece, child);
      if (soon) names.push({ name: piece.chain, node: child, early: true, reader: at });
      return named(piece.chain, child && child.value, hasValues, soon ? readHere(at) : child && made(child), num.mark(piece.chain, child, at), soon ? made(child) : null);
    }
    const inner = inlineText(child, hasValues, num, names, path, written);
    return plainText(inner).includes(" ") ? "( " + inner + " )" : inner;
  }).join(" ");
  if (plainText(text).includes(" ")) written.add(keyOf(node));
  return text;
}
// The formula first and its where right under it, then the product, the result, the values it started from and the
// statements in the order they ran.
function expressionPane(tree, hasValues = true) {
  const changes = [];
  const collect = node => { if (!node.outside && !changes.some(item => item.stop === node.stop && item.of === node.of)) changes.push(node); node.children.forEach(collect); };
  collect(tree);
  changes.sort((a, b) => a.stop - b.stop);
  const inputs = [];
  const leaves = node => { if (node.outside && !inputs.some(item => item.of === node.of)) inputs.push(node); node.children.forEach(leaves); };
  leaves(tree);
  if (tree.outside) return `<p class="edge">${escape(tree.of)} was not ${hasValues ? "changed" : "written"} in the record.</p>`;
  const steps = changes.map(node => `<li><code>${named(node.of, node.value, hasValues, node)} ${equals(node)} ${node.rhs ? stepText({ ...node, children: [] }, false) : sourceText(node.text)}</code> <span class="edge">${escape(where(node))}</span></li>`).join("");
  const given = inputs.map(node => hasValues ? `<li><code>${escape(node.of.toLowerCase())} = ${escape(node.value === "" ? "(empty)" : node.value)}</code> <span class="edge">${escape(where(node))}</span></li>`
    : `<li><code>${escape(node.of.toLowerCase())}</code> <span class="edge">not written in the record</span></li>`).join("");
  // The formula is the last step alone; what its computed names stand for is opened under it, level by level.
  // What the run writes, by name, for readBeforeSet: the first stop of each.
  writtenLater = new Map();
  // Only a write of a value counts: a structure filled with the field empty does not set it.
  changes.filter(node => !isEmpty(node.value)).forEach(node => [upper(node.of), tail(node.of) ? "~" + tail(node.of) : ""].filter(Boolean).forEach(key => {
    if (!writtenLater.has(key) || writtenLater.get(key).stop > node.stop) writtenLater.set(key, node);
  }));
  const num = numbering(), names = [], head = named(tree.of, tree.value, hasValues, tree, num.mark(tree.of, tree));
  const top = stepText(tree, hasValues, names, num), productNames = [], product = productForm(tree, hasValues, num, productNames);
  const decoded = decoding(names, hasValues, new Set([keyOf(tree)]), num);
  // The product's own where opens what it reads afresh: it explains another formula, not the one above.
  const productDecoded = decoding(productNames, hasValues, new Set([keyOf(tree)]), num);
  const total = tree.value === undefined ? "" : String(tree.value), short = rounded(total);
  const result = hasValues ? `<p class="edge"${short === total ? "" : ` title="${escape(total)}"`}>${tree.pending ? "Not computed yet at this stop" : "= " + escape(short)}</p>` : "";
  // Two views of one value, one shown at a time by the page's Optimized toggle: the formula, its where and its rule,
  // or the whole derivation as one line.
  const inlineNames = [], inline = inlineText(tree, hasValues, num, inlineNames);
  const inlineDecoded = decoding(inlineNames, hasValues, new Set([keyOf(tree)]), num);
  return num.fill(`<div class="rf-step"><p><code>${head} ${equals(tree)} ${top}</code></p>` + (decoded ? `<p class="edge">where</p>${decoded}` : "") + product
    + (productDecoded ? `<p class="edge">where</p>${productDecoded}` : "") + result + "</div>"
    + `<div class="rf-inline"><p><code>${head} ${equals(tree)} ${inline}</code></p>`
    + (inlineDecoded ? `<p class="edge">where</p>${inlineDecoded}` : "") + result + `</div>`)
    + (given ? `<p class="edge">Where the values come from</p><ul class="expression-where">${given}</ul>` : "")
    + (steps ? `<p class="edge">The statements, in the order they ran</p><ol class="expression-steps">${steps}</ol>` : "");
}

module.exports = { build, statementAt, parsedSource };
