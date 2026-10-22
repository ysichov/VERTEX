"use strict";
/* Object Navigator: the tree SE80's Repository Browser shows for a package or a class, built from ADT's own answers -
   the package's node structure and the class's object structure. Each entry that has source says where it opens:
   the object, and for a component its line in the main source. */

// What a package entry opens as in the editor: the types VERTEX reads as source.
const OPENS = { "CLAS/OC": "CLAS", "INTF/OI": "INTF", "PROG/P": "PROG", "PROG/I": "INCL", "FUGR/FF": "FUNC", "FUGR/I": "INCL" };
// The parts of a class or interface, under SE80's names. A part of another type keeps ADT's type as its heading.
const PARTS = { "CLAS/OT": "Types", "CLAS/OA": "Attributes", "CLAS/OM": "Methods", "CLAS/OE": "Events",
  "CLAS/OF": "Friends of", "INTF/IT": "Types",
  // A program's local class, as its outline names its parts.
  "PROG/PLM": "Methods", "PROG/PLA": "Attributes", "PROG/PLY": "Types", "PROG/PLE": "Events", "INTF/IA": "Attributes", "INTF/IO": "Methods", "INTF/IE": "Events" };
// SE80's names of the object types: ADT's node structure may leave a type's label empty.
const TYPE_LABELS = { "CLAS/OC": "Classes", "INTF/OI": "Interfaces", "PROG/P": "Programs", "PROG/I": "Includes",
  "FUGR/F": "Function Groups", "FUGR/FF": "Function Modules", "FUGR/I": "Includes", "TABL/DT": "Database Tables",
  "TABL/DS": "Structures", "DTEL/DE": "Data Elements", "DOMA/DD": "Domains", "TTYP/DA": "Table Types",
  "VIEW/DV": "Views", "SHLP/DH": "Search Helps", "ENQU/DL": "Lock Objects", "DDLS/DF": "Data Definitions",
  "MSAG/N": "Message Classes", "TRAN/T": "Transactions",
  // A program's parts, as SE80 names them; read off a live tree (ZABAPGIT).
  "PROG/PD": "Fields", "PROG/PE": "Events", "PROG/PU": "Subroutines", "PROG/PS": "Screens", "PROG/PC": "GUI Statuses",
  "PROG/PT": "Tables", "PROG/PL": "Local Classes", "PROG/PLM": "Methods", "PROG/PLA": "Attributes" };
// A local class's methods and attributes: the node structure lists them for the whole program at once, flat; a class
// unfolded reads its own from the program's object structure instead.
const LOCAL_PARTS = ["PROG/PLM", "PROG/PLA"];
const PART_ORDER = ["Inherited from", "Types", "Attributes", "Methods", "Events", "Friends of"];
// The class itself, which ADT lists among its components: the root of the tree already stands for it.
const SELF = "CLAS/OCX";

/* A package - or a function group, which ADT answers in the same shape: its subpackages, then its objects under ADT's categories and object types. */
function packageTree(data, source) {
  // The program or include the tree is of, when it is one: what its parts open in.
  const program = source && source.name, programType = source && source.type || "PROG";
  // A local class's methods and attributes come with it when it is unfolded. A node without a name is none.
  const nodes = (data.nodes || []).filter(n => n.OBJECT_NAME && !LOCAL_PARTS.includes(n.OBJECT_TYPE));
  const tree = [];
  const packages = nodes.filter(n => n.OBJECT_TYPE === "DEVC/K");
  if (packages.length) tree.push({ label: "Packages", children: packages.map(n => ({ label: n.OBJECT_NAME, description: n.DESCRIPTION || "",
    expand: { name: n.OBJECT_NAME, type: "DEVC" } })) });
  const types = data.objectTypes || [];
  // In a program, a subroutine opens the program at its FORM; the other parts have no statement to find by name.
  // An include a program names may not exist (INCLUDE ... IF FOUND): then its INCLUDE statement is opened instead.
  const opens = n => OPENS[n.OBJECT_TYPE] ? { name: n.OBJECT_NAME, type: OPENS[n.OBJECT_TYPE],
      ...(program && n.OBJECT_TYPE === "PROG/I" ? { declaredIn: { name: program, type: programType, include: n.OBJECT_NAME } } : {}) }
    : program && ["PROG/PU", "PROG/PLM"].includes(n.OBJECT_TYPE) ? { name: program, type: programType, method: n.OBJECT_NAME } : null;
  const entry = n => ({ label: n.OBJECT_NAME, description: n.DESCRIPTION || "",
    ...(opens(n) ? { open: opens(n) } : {}),
    ...(["CLAS/OC", "INTF/OI"].includes(n.OBJECT_TYPE) ? { expand: { name: n.OBJECT_NAME, type: OPENS[n.OBJECT_TYPE] } } : {}),
    ...(n.OBJECT_TYPE === "FUGR/F" ? { expand: { name: n.OBJECT_NAME, type: "FUGR" } } : {}),
    ...(program && n.OBJECT_TYPE === "PROG/PL" ? { expand: { name: program, type: programType, node: n.OBJECT_NAME },
      open: { name: program, type: programType, localClass: n.OBJECT_NAME } } : {}) });
  const placed = new Set(["DEVC/K"]);
  for (const category of data.categories || []) {
    const children = types.filter(t => t.CATEGORY_TAG === category.CATEGORY).map(t => {
      placed.add(t.OBJECT_TYPE);
      return { label: TYPE_LABELS[t.OBJECT_TYPE] || t.OBJECT_TYPE_LABEL || t.OBJECT_TYPE, children: nodes.filter(n => n.OBJECT_TYPE === t.OBJECT_TYPE).map(entry) };
    }).filter(t => t.children.length);
    if (children.length) tree.push({ label: category.CATEGORY_LABEL || category.CATEGORY, children });
  }
  // An object of a type ADT names in no category is still in the package: shown under its own type.
  // DEVC/... other than a subpackage are ADT's own folder entries, not objects; PROG/PX is the program itself,
  // which the root already is.
  const rest = [...new Set(nodes.map(n => n.OBJECT_TYPE).filter(t => !placed.has(t) && !/^DEVC\//.test(t) && t !== "PROG/PX"))];
  for (const t of rest) {
    const children = nodes.filter(n => n.OBJECT_TYPE === t).map(entry);
    if (children.length) tree.push({ label: TYPE_LABELS[t] || t, children });
  }
  return tree;
}

/* Where a component stands, from its ADT links: a method by its implementation, else its definition - in the main
   source, or in the include a program keeps it in (a local class implemented in an include). */
function position(component) {
  const links = component.links || [];
  const find = rel => links.find(l => String(l.rel || "").endsWith("/" + rel));
  const link = find("implementationIdentifier") || find("definitionIdentifier");
  const match = link && /^(.*?)#start=(\d+),(\d+)/.exec(String(link.href || ""));
  if (!match || !/(^|\/)source\/main$/.test(match[1])) return null;
  const include = /\/includes\/([^/]+)\/source\/main$/.exec(match[1]);
  return { line: Number(match[2]), include: include ? decodeURIComponent(include[1]).toUpperCase() : "" };
}

/* A class or interface: its superclass, then its components grouped as SE80 groups them, each opening at its line. */
function classTree(root, objectName, objectType, superClass, localClass) {
  const node = component => {
    const at = position(component), line = at && at.line;
    const children = classGroups(component.components || []);
    // A local class's method that comes without a line opens at its METHOD in that class's IMPLEMENTATION.
    // Any other part of it - an attribute, a type - at its declaration in the class's DEFINITION.
    const method = !line && localClass && ["PROG/PLM", "CLAS/OM"].includes(component["adtcore:type"]);
    const member = String(component["adtcore:name"]).toUpperCase();
    return { label: component["adtcore:name"], visibility: component.visibility || "",
      ...(line ? { open: at.include ? { name: at.include, type: "INCL", line } : { name: objectName, type: objectType, line } }
        : method ? { open: { name: objectName, type: objectType, method: member, localClass } }
        : localClass ? { open: { name: objectName, type: objectType, member, localClass } } : {}),
      ...(children.length ? { children } : {}) };
  };
  function classGroups(components) {
    const local = new Map();
    for (const component of components.filter(c => c["adtcore:type"] !== SELF)) {
      const label = PARTS[component["adtcore:type"]] || component["adtcore:type"];
      if (!local.has(label)) local.set(label, []);
      local.get(label).push(node(component));
    }
    const rank = label => { const at = PART_ORDER.indexOf(label); return at < 0 ? PART_ORDER.length : at; };
    return [...local.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([label, children]) => ({ label, children }));
  }
  const tree = classGroups(root.components || []);
  if (superClass) tree.unshift({ label: "Inherited from", children: [{ label: superClass,
    open: { name: superClass, type: "CLAS" }, expand: { name: superClass, type: "CLAS" } }] });
  return tree;
}

/* A transport request: its objects and its tasks' objects, once each, grouped by the object type E071 names. A class,
   an interface, a program or a function module opens; a method opens in its class at its METHOD statement. */
const E071_OPENS = { CLAS: "CLAS", INTF: "INTF", PROG: "PROG", FUNC: "FUNC" };
function requestTree(keys) {
  const byType = new Map(), seen = new Set();
  for (const k of keys) {
    const type = String(k.OBJECT), name = String(k.OBJ_NAME);
    if (seen.has(type + "|" + name)) continue;
    seen.add(type + "|" + name);
    if (!byType.has(type)) byType.set(type, []);
    let node = { label: name };
    if (type === "METH") {
      const owner = name.slice(0, 30).trim(), method = name.slice(30).trim();
      node = { label: owner + "=>" + method, open: { name: owner, type: "CLAS", method } };
    } else if (E071_OPENS[type]) node.open = { name, type: E071_OPENS[type] };
    if (type === "CLAS" || type === "INTF" || type === "FUGR") node.expand = { name, type };
    byType.get(type).push(node);
  }
  return [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, children]) => ({ label, children: children.sort((x, y) => x.label.localeCompare(y.label)) }));
}

/* A program's Parts - its events, subroutines and local methods - from the same node structure, in the shape the
   Tools window reads them in: what the diagrams need is a unit's name and kind. */
const UNIT_TYPES = { "PROG/PE": "EVENT", "PROG/PU": "FORM", "PROG/PLM": "METHOD" };
function programUnits(data) {
  return { units: (data.nodes || []).filter(n => n.OBJECT_NAME && UNIT_TYPES[n.OBJECT_TYPE])
    .map(n => ({ unit_name: n.OBJECT_NAME, unit_type: UNIT_TYPES[n.OBJECT_TYPE] })) };
}

/* A program read from local files, as SE80 would show it: its includes, events, local classes with their methods and its
   subroutines, from abaplint's parse of the program and its includes - parts: [{ name, statements }], the program
   first. Each entry opens in the file it is written in, at its line. */
const EVENTS = new Set(["LoadOfProgram", "Initialization", "AtSelectionScreen", "StartOfSelection", "EndOfSelection",
  "TopOfPage", "EndOfPage", "AtLineSelection", "AtUserCommand", "AtPF", "TopOfPageDuringLineSelection"]);
function localTree(parts) {
  const at = (part, s) => ({ name: part.name, type: "PROG", line: s.line });
  const label = s => String(s.text || "").replace(/\.\s*$/, "");
  const includes = [], events = [], forms = [], classes = new Map();
  for (const part of parts) {
    let implementing = null;
    for (const s of part.statements) {
      const kind = s.parserKind, second = String(s.tokens[1]?.value || "").toUpperCase();
      if (kind === "Include" && second) includes.push({ label: second, open: { name: second, type: "PROG" } });
      else if (EVENTS.has(kind)) events.push({ label: label(s), open: at(part, s) });
      else if (kind === "Form") forms.push({ label: second, open: at(part, s) });
      else if (kind === "ClassDefinition" || kind === "ClassImplementation") {
        if (!classes.has(second)) classes.set(second, { label: second, methods: [] });
        if (kind === "ClassDefinition") classes.get(second).open = at(part, s);
        implementing = kind === "ClassImplementation" ? classes.get(second) : null;
      } else if (kind === "EndClass") implementing = null;
      else if (kind === "MethodImplementation" && implementing) implementing.methods.push({ label: second, open: at(part, s) });
    }
  }
  const tree = [];
  if (includes.length) tree.push({ label: "Includes", children: includes });
  if (events.length) tree.push({ label: "Events", children: events });
  if (classes.size) tree.push({ label: "Local Classes", children: [...classes.values()].map(c => ({ label: c.label,
    ...(c.open ? { open: c.open } : {}), ...(c.methods.length ? { children: [{ label: "Methods", children: c.methods }] } : {}) })) });
  if (forms.length) tree.push({ label: "Subroutines", children: forms });
  return tree;
}

module.exports = { packageTree, programUnits, classTree, requestTree, localTree, position, OPENS };
