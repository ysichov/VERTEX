"use strict";
/* Running a method or a function module with the ABAP transpiler: what is under the cursor, its signature with the
   types the screen needs, and the program that calls it. The program is ABAP, so the transpiler types and converts the
   values as SAP would, and the run is a program run like any other - breakpoints, steps, the record. */

const fs = require("fs");
const path = require("path");

const DRIVER = "zvertex_run";
const lint = () => require("@abaplint/core");

/* The method or function module whose implementation holds the line (1-based), read from abaplint's statements. */
function targetAt(file, text, line) {
  const base = path.basename(file).toLowerCase();
  const clas = /^(.+)\.clas\.abap$/.exec(base), fugr = /^(.+)\.fugr\.[^.]+\.abap$/.exec(base);
  if (!clas && !fugr) return null;
  const abaplint = lint();
  const registry = new abaplint.Registry().addFile(new abaplint.MemoryFile(base, String(text || "")));
  registry.parse();
  const statements = registry.getFirstObject()?.getABAPFiles()[0]?.getStatements() || [];
  const open = clas ? abaplint.Statements.MethodImplementation : abaplint.Statements.FunctionModule;
  const close = clas ? abaplint.Statements.EndMethod : abaplint.Statements.EndFunction;
  let current = null;
  for (const statement of statements) {
    const from = statement.getStart().getRow(), to = statement.getEnd().getRow();
    if (statement.get() instanceof open) current = { from, name: statement.findDirectExpression(clas ? abaplint.Expressions.MethodName : abaplint.Expressions.Field)?.concatTokens()
      || statement.getTokens()[1]?.getStr() };
    if (statement.get() instanceof close && current) {
      if (line >= current.from && line <= to) {
        const name = String(current.name || "").toUpperCase();
        return clas ? { kind: "method", object: clas[1].toUpperCase(), name } : { kind: "function", group: fugr[1].toUpperCase(), name };
      }
      current = null;
    }
  }
  return null;
}

/* The registry of the run's sources, parsed. */
function registryOf(files, extra = []) {
  const abaplint = lint();
  const registry = new abaplint.Registry();
  for (const file of files) registry.addFile(new abaplint.MemoryFile(path.basename(file).toLowerCase(), fs.readFileSync(file, "utf8")));
  for (const file of extra) registry.addFile(new abaplint.MemoryFile(file.name, file.text));
  registry.parse();
  return registry;
}

/* The parameters of the target: name, direction (importing, exporting, changing, returning, tables), the type to
   declare it with, OPTIONAL and DEFAULT. A method also says whether it is static and the constructor's importing
   parameters for an instance. What cannot be called from outside, or declared, fails with the reason. */
function parametersOf(target, files) {
  const abaplint = lint();
  const registry = registryOf(files);
  if (target.kind === "function") {
    const group = registry.getObject("FUGR", target.group);
    if (!group) throw new Error("Function group " + target.group + " is not among the sources.");
    const module = group.getModules().find(m => m.getName().toUpperCase() === target.name);
    if (!module) throw new Error("Function module " + target.name + " is not in " + target.group + "'s XML.");
    return { target, parameters: module.getParameters().map(p => ({ name: p.name.toUpperCase(), direction: p.direction,
      // SAP declares this result generically. A standalone call needs a concrete receiving field; the module computes days as integers.
      declare: target.name === "FIMA_DAYS_BETWEEN_TWO_DATES" && p.name.toUpperCase() === "E_TAGE" && p.type === "ANY" ? "I"
        : p.direction === "tables" ? "STANDARD TABLE OF " + p.type + " WITH DEFAULT KEY" : p.type,
      optional: !!p.optional, default: p.defaultValue || "" })) };
  }
  const object = registry.getObject("CLAS", target.object);
  if (!object) throw new Error("Class " + target.object + " is not among the sources.");
  const run = new abaplint.SyntaxLogic(registry, object).run();
  const definition = findClass(run.spaghetti.getTop(), target.object);
  if (!definition) throw new Error("The class " + target.object + " could not be read: " + (run.issues[0]?.getMessage() || "no definition"));
  const methods = Array.from(definition.getMethodDefinitions().getAll());
  // An interface's method (METHOD zif_x~m) is defined in the interface: its signature is read there, and it is called
  // through the interface's name on the object, as ABAP writes it.
  const [face, own] = target.name.includes("~") ? target.name.split("~") : [null, target.name];
  let method;
  if (face) {
    // A global interface is an object of its own: its definition is in its own syntax run, not the class's.
    const own_object = registry.getObject("INTF", face);
    const facing = findDefinition(run.spaghetti.getTop(), "findInterfaceDefinition", face)
      || (own_object && findDefinition(new abaplint.SyntaxLogic(registry, own_object).run().spaghetti.getTop(), "findInterfaceDefinition", face));
    if (!facing) throw new Error("The interface " + face + " of " + target.object + " is not among the sources.");
    method = Array.from(facing.getMethodDefinitions().getAll()).find(m => m.getName().toUpperCase() === own);
    if (!method) throw new Error("Method " + own + " is not in the interface " + face + ".");
  } else method = methods.find(m => m.getName().toUpperCase() === own);
  if (!method) throw new Error("Method " + target.name + " is not in " + target.object + "'s definition.");
  // Any visibility: the transpiler does not check it, so a private or protected method - and a class whose
  // constructor is not public - is called from the program as a public one would be. SAP itself would refuse the call.
  const read = (definitionOf, direction) => {
    const parameters = definitionOf.getParameters(), defaults = name => parameters.getParameterDefault?.(name)?.concatTokens?.() || "";
    const list = { importing: parameters.getImporting(), exporting: parameters.getExporting(), changing: parameters.getChanging(),
      returning: parameters.getReturning() ? [parameters.getReturning()] : [] };
    const result = [];
    for (const kind of direction) for (const p of list[kind]) result.push({ name: p.getName().toUpperCase(), direction: kind,
      declare: declaration(p.getType(), p.getName()), optional: parameters.getOptional().map(n => n.toUpperCase()).includes(p.getName().toUpperCase()),
      default: defaults(p.getName()) });
    return result;
  };
  const constructor = !method.isStatic() ? methods.find(m => m.getName().toUpperCase() === "CONSTRUCTOR") : null;
  return { target: { ...target, static: method.isStatic() }, parameters: read(method, ["importing", "changing", "exporting", "returning"]),
    creation: constructor ? read(constructor, ["importing"]).map(p => ({ ...p, ctor: true })) : [] };
}
function findDefinition(scope, finder, name) {
  if (!scope) return null;
  const found = scope[finder]?.(name);
  if (found) return found;
  for (const child of scope.getChildren?.() || []) { const deeper = findDefinition(child, finder, name); if (deeper) return deeper; }
  return null;
}
const findClass = (scope, name) => findDefinition(scope, "findClassDefinition", name);
/* How the program declares a parameter: by the type's name where it has one, else elementary types as ABAP writes them. */
function declaration(type, name) {
  const abaplint = lint();
  // A reference is declared as one: REF TO the class or interface, REF TO the data type. It has no value to enter; as a
  // result it stands in Variables after the call.
  if (type instanceof abaplint.BasicTypes.ObjectReferenceType) return "REF TO " + type.getIdentifierName();
  if (type instanceof abaplint.BasicTypes.DataReference) return "REF TO " + declaration(type.getType(), name);
  if (type instanceof abaplint.BasicTypes.UnknownType) {
    throw new Error("The type of parameter " + String(name).toUpperCase() + " is not known: " + (type.getError?.() || type.toText?.() || "")
      + ". Its class, interface or DDIC object must be among the local sources.");
  }
  const qualified = type.getQualifiedName?.();
  if (qualified && !/^(?:ANY|DATA|CLIKE|CSEQUENCE|NUMERIC|SIMPLE|XSEQUENCE)$/i.test(qualified)) return qualified;
  if (type instanceof abaplint.BasicTypes.StructureType || type instanceof abaplint.BasicTypes.TableType || type.isGeneric?.()) {
    throw new Error("Parameter " + String(name).toUpperCase() + " has a type with no name (" + (type.toText?.() || type.constructor.name) + "): it cannot be declared for the call.");
  }
  return type.toABAP();
}

/* The screen's shape of each parameter, from the types the call program's variables get: a simple field, a structure's
   fields, a table's row. The program is checked by abaplint first; an error in it fails loudly. */
function screenOf(signature, files) {
  const abaplint = lint();
  const classSources = new Map(files.filter(file => /\.clas\.abap$/i.test(file)).map(file =>
    [path.basename(file).replace(/\.clas\.abap$/i, "").toUpperCase(), fs.readFileSync(file, "utf8")]));
  const source = driverSource(signature, {});
  const registry = registryOf(files, [{ name: DRIVER + ".prog.abap", text: source }]);
  const program = registry.getObject("PROG", DRIVER.toUpperCase());
  const run = new abaplint.SyntaxLogic(registry, program).run();
  const issue = run.issues.find(i => i.getSeverity?.() === abaplint.Severity.Error && /zvertex_run/i.test(i.getFilename()));
  if (issue) throw new Error("The call of " + label(signature.target) + " cannot be built: " + issue.getMessage());
  // The program's variables, wherever in the scopes they were declared.
  const scopes = [], walk = node => { scopes.push(node); (node.getChildren?.() || []).forEach(walk); };
  walk(run.spaghetti.getTop());
  const shape = name => {
    for (const scope of scopes) { const found = scope.findVariable(name); if (found && /zvertex_run/i.test(found.getFilename())) return describe(found.getType(), classSources); }
    throw new Error("The call program declares no variable " + name + ".");
  };
  const fields = list => list.map(p => ({ ...p, shape: shape(variable(p)) }));
  return { target: signature.target, parameters: fields(signature.parameters), creation: fields(signature.creation || []) };
}
function describe(type, classSources = new Map()) {
  const abaplint = lint();
  if (type instanceof abaplint.BasicTypes.ObjectReferenceType) {
    const className = String(type.getIdentifierName?.() || "").toUpperCase(), source = classSources.get(className) || "";
    const definition = source.match(new RegExp("CLASS\\s+" + className + "\\s+DEFINITION\\b([\\s\\S]*?)ENDCLASS\\.", "i"));
    const attributes = [...(definition?.[0] || "").matchAll(/^\s*(CLASS-DATA|DATA)\s+([A-Z][\w]*)\s+TYPE\s+([^\.\n]+)\./gmi)]
      .map(match => { const declared = match[3].trim(), value = /\s+VALUE\s+(.+)$/i.exec(declared);
        return { name: match[2].toUpperCase(), type: value ? declared.slice(0, value.index).trim() : declared,
          initial: value ? value[1].trim() : "Initial", static: /^CLASS-DATA$/i.test(match[1]) }; });
    return { kind: "reference", type: type.toText?.() || "", className, attributes,
      // This standalone simulation can create a class even when SAP access or abstract checks would reject it.
      // No constructor values are supplied by this default action.
      createDefault: !!definition };
  }
  if (type instanceof abaplint.BasicTypes.DataReference) return { kind: "reference", type: type.toText?.() || "" };
  if (type instanceof abaplint.BasicTypes.UnknownType) throw new Error("A type of the call is not known: " + (type.getError?.() || "") + ".");
  if (type instanceof abaplint.BasicTypes.StructureType) return { kind: "structure", fields: type.getComponents().map(c => ({ name: c.name.toUpperCase(), shape: describe(c.type, classSources) })) };
  if (type instanceof abaplint.BasicTypes.TableType) return { kind: "table", row: describe(type.getRowType(), classSources) };
  return { kind: "simple", type: type.toABAP ? type.toABAP() : "" };
}

const label = target => target.kind === "function" ? target.name : target.object + "=>" + target.name;
const variable = p => p.ctor ? ("c_" + p.name).slice(0, 30) : p.name;
const literal = value => "'" + String(value ?? "").replace(/'/g, "''") + "'";

/* The values given for a parameter, as assignments: a field, a structure's fields, a table's rows. A table inside a
   structure, or a structure inside a table's row field, is not entered on the screen and fails here. */
function assignments(target, shape, value, name, symbols) {
  if (value === undefined || value === null) return [];
  if (shape.kind === "reference") {
    if (value?.create && shape.createDefault) return [target + " = NEW " + shape.className.toLowerCase() + "( )."];
    throw new Error(name + " is a reference: this class cannot be initialized with a default constructor.");
  }
  if (shape.kind === "simple") return [target + " = " + literal(value) + "."];
  if (shape.kind === "structure") {
    const out = [];
    for (const field of shape.fields) {
      if (!(field.name in value)) continue;
      if (field.shape.kind === "table") throw new Error(name + "-" + field.name + " is a table inside a structure: it cannot be entered on the screen.");
      out.push(...assignments(target + "-" + field.name.toLowerCase(), field.shape, value[field.name], name + "-" + field.name, symbols));
    }
    return out;
  }
  if (!Array.isArray(value)) throw new Error(name + " is a table: its value must be a list of rows.");
  const out = [];
  for (const row of value) {
    // Declared at the top, not inline: the transpiler leaves an inline field symbol of a program undeclared.
    const symbol = "<zvx" + (++symbols.n) + ">";
    symbols.declared.push("FIELD-SYMBOLS " + symbol + " LIKE LINE OF " + target + ".");
    out.push("APPEND INITIAL LINE TO " + target + " ASSIGNING " + symbol + ".");
    if (shape.row.kind === "table") throw new Error(name + " has tables as rows: they cannot be entered on the screen.");
    out.push(...assignments(symbol, shape.row, row, name + "[]", symbols));
  }
  return out;
}

/* The results in a form of VERTEX's own, a line each, its parts parted by tabs, for the window to draw them: a simple
   value (VERTEX:S, its path - a structure's field as NAME-FIELD - and its value), a table's heading (VERTEX:T, its name,
   its row count and its columns) and each of its rows (VERTEX:R, its name and a value per column). A column is a simple
   field of the row; a field that is itself a structure or a table is left out. */
function written(target, name, shape, symbols) {
  if (shape.kind === "simple") return ["WRITE / |" + RESULT + "S\\t" + name + "\\t{ " + target + " }|."];
  if (shape.kind === "structure") return [].concat(...shape.fields.filter(f => f.shape.kind !== "reference")
    .map(f => written(target + "-" + f.name.toLowerCase(), name + "-" + f.name, f.shape, symbols)));
  if (shape.kind === "table") {
    const row = "<zvx" + (++symbols.n) + ">";
    symbols.declared.push("FIELD-SYMBOLS " + row + " LIKE LINE OF " + target + ".");
    const columns = shape.row.kind === "structure"
      ? shape.row.fields.filter(f => f.shape.kind === "simple").map(f => ({ title: f.name, value: row + "-" + f.name.toLowerCase() }))
      : shape.row.kind === "simple" ? [{ title: "VALUE", value: row }] : [];
    return ["WRITE / |" + RESULT + "T\\t" + name + "\\t{ lines( " + target + " ) }" + columns.map(c => "\\t" + c.title).join("") + "|."]
      .concat(columns.length ? ["LOOP AT " + target + " ASSIGNING " + row + ".",
        "  WRITE / |" + RESULT + "R\\t" + name + columns.map(c => "\\t{ " + c.value + " }").join("") + "|.", "ENDLOOP."] : []);
  }
  return [];
}
const RESULT = "VERTEX:";

/* The program that calls the target with the values given: every parameter a variable of its own name (a constructor's
   prefixed c_), a DEFAULT where nothing was given, the call, and a last statement to stop on with the results. An
   optional parameter is passed only when a value was given for it. */
function driverSource(signature, values) {
  const target = signature.target, given = values.parameters || {}, ctorGiven = values.creation || {};
  const ctor = (signature.creation || []).map(p => ({ ...p, ctor: true }));
  const lines = ["REPORT " + DRIVER + ".", "* Generated by VERTEX to run " + label(target) + " with the ABAP transpiler.", ""];
  for (const p of ctor.concat(signature.parameters)) lines.push("DATA " + variable(p) + " TYPE " + p.declare + ".");
  // The object declared too, for the same reason as the field symbols. An exception the call raises is not caught:
  // the run ends with it, as the program would.
  if (target.kind === "method" && !target.static) lines.push("DATA zvx_object TYPE REF TO " + target.object.toLowerCase() + ".");
  const declaredAt = lines.length;
  lines.push("", "START-OF-SELECTION.");
  const symbols = { n: 0, declared: [] };
  const fill = (list, valuesOf) => {
    for (const p of list) {
      if (p.direction === "exporting" || p.direction === "returning") continue;
      const value = valuesOf[p.name];
      if (value !== undefined) lines.push(...assignments(variable(p), p.shape || { kind: "simple" }, value, p.name, symbols));
      else if (p.shape?.kind === "reference" && !p.optional && p.shape.createDefault)
        lines.push(variable(p) + " = NEW " + p.shape.className.toLowerCase() + "( ).");
      else if (p.default) lines.push(variable(p) + " = " + p.default + ".");
    }
  };
  fill(ctor, ctorGiven);
  fill(signature.parameters, given);
  const passed = (list, valuesOf) => list.filter(p => !p.optional || valuesOf[p.name] !== undefined || p.default);
  const bind = (list, direction) => list.filter(p => p.direction === direction).map(p => p.name.toLowerCase() + " = " + variable(p));
  const part = (word, bound) => bound.length ? " " + word + " " + bound.join(" ") : "";
  const params = passed(signature.parameters.filter(p => ["importing", "changing", "tables"].includes(p.direction)), given)
    .concat(signature.parameters.filter(p => ["exporting", "returning"].includes(p.direction)));
  if (target.kind === "function") {
    lines.push("CALL FUNCTION " + literal(target.name) + part("EXPORTING", bind(params, "importing")) + part("IMPORTING", bind(params, "exporting"))
      + part("CHANGING", bind(params, "changing")) + part("TABLES", bind(params, "tables")) + ".");
  } else {
    const call = part("EXPORTING", bind(params, "importing")) + part("IMPORTING", bind(params, "exporting"))
      + part("CHANGING", bind(params, "changing")) + part("RECEIVING", bind(params, "returning"));
    if (target.static) lines.push(target.object.toLowerCase() + "=>" + target.name.toLowerCase() + "(" + call + " ).");
    else {
      const created = passed(ctor, ctorGiven);
      lines.push("zvx_object = NEW " + target.object.toLowerCase() + "(" + (created.length ? " " + created.map(p => p.name.toLowerCase() + " = " + variable(p)).join(" ") : "") + " ).");
      lines.push("zvx_object->" + target.name.toLowerCase() + "(" + call + " ).");
    }
  }
  // The results, written to Output: the program is not recorded, so this is where they are seen after the call - a
  // simple value, each simple field of a structure, and each row of a table, field by field. References are not.
  lines.push("* The call is over: its results are written.");
  for (const p of signature.parameters.filter(p => ["exporting", "changing", "returning"].includes(p.direction) && p.shape)) {
    lines.push(...written(variable(p), p.name, p.shape, symbols));
  }

  lines.splice(declaredAt, 0, ...symbols.declared);
  return lines.join("\n") + "\n";
}

module.exports = { DRIVER, targetAt, parametersOf, screenOf, driverSource, label };
