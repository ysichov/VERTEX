'use strict';
// Adapter only: parsing, source closure, BSE, FLOW and formulas are the VS Code modules.
const {parseSource} = require('../vscode/value-origin-linter');
const origin = require('../vscode/value-origin');
const points = require('../vscode/value-origin-points');
const {collect} = require('../vscode/value-origin-pipeline');
const {formula} = require('../vscode/value-origin-formula');
const panes = require('../vscode/value-origin-formula-html');
let lastSources = [];
const upper = value => String(value || '').toUpperCase();

async function request(api, request, progress = () => {}) {
  if (request.open) {
    const source = lastSources.find(s => s.id === request.open.source);
    if (!source) throw new Error('Run the analysis again: this source is no longer in its result.');
    return {reveal:{url:source.id, line:request.open.line}};
  }
  const args = request.variables || request, name = upper(args.object_name), type = upper(args.object_type || 'PROG');
  if (!name) throw new Error('An ABAP object is required.');
  const reader = api.analysisReader(), loaded = new Map(), warnings = [];
  let steps = 0;
  async function load(name, type, include = 'main') {
    const key = upper(type) + ':' + upper(name) + ':' + include;
    if (loaded.has(key)) return loaded.get(key);
    progress({stage:'Reading source',object:name,sources:loaded.size,steps});
    let data;
    try { data = await reader({object_name:upper(name),object_type:upper(type),include}); }
    catch (error) {
      if (type !== 'CLAS') throw error;
      data = await reader({object_name:upper(name),object_type:'INTF',include});
    }
    const parsed = parseSource({id:data.source_url,name:upper(name),objectName:upper(name),objectType:data.object_type,include,text:data.source});
    const sources = [parsed.source]; loaded.set(key, sources); warnings.push(...parsed.warnings);
    steps += parsed.source.aceStatements.length;
    progress({stage:'Sources parsed',object:name,sources:loaded.size,steps});
    return sources;
  }
  const initial = await load(name, type), source = initial[0], lines = source.text.split(/\r?\n/);
  const variable = upper(args.variable), bounded = Number.isInteger(args.from);
  const line = request.variables ? 1 : (variable ? points.lastUse(source.text, variable) : 0) || Number(args.line) || 1;
  const column = points.columnOf(lines[line - 1] || '', variable);
  const position = lines.slice(0, line - 1).reduce((n, row) => n + row.length + 1, 0) + column;
  const target = {source:source.id,line,column,offset:source.aceStatements.filter(s => s.offset <= position).at(-1)?.offset ?? position,
    variable, declarationTypes:!!request.variables, flowPath:bounded && !variable};
  if (bounded) {
    target.flowRange = {from:args.from,to:Number.isInteger(args.to) ? args.to : lines.length};
    target.flowBounds = {source:source.id,...target.flowRange};
  }
  const closure = await collect(initial,target,{load,loadPart:(name,include) => load(name,'CLAS',include),progress:name => progress({stage:'Reading source',object:name,sources:loaded.size,steps})});
  const graph = origin.analyze(closure.sources,target); warnings.push(...closure.warnings);
  if (request.variables) {
    const declarations = graph.declarations || [], own = declarations.filter(d => d.source === source.id);
    const focus = args.routine ? declarations.find(d => upper(d.owner) + '->' + upper(d.name) === upper(args.routine))
      : own.find(d => d.name !== 'GLOBAL' && args.line >= d.first && args.line <= d.last);
    const global = own.find(d => d.name === 'GLOBAL');
    return {object_name:name,object_type:type,line:args.line || null,scope:focus ? upper(focus.owner) + '->' + upper(focus.name) : '',name:focus?.name || '',
      params:focus?.params || [],locals:focus?.locals || [],globals:!focus || args.globals ? global?.locals || [] : null,warnings};
  }
  lastSources = closure.sources;
  const found = points.pointsOf(graph,closure.sources), flow = points.pathRows(graph,closure.sources), sites = points.siteRows(graph,closure.sources);
  const derived = formula(graph), link = node => 'origin:' + node.source + '|' + (node.location || '');
  return {variable,points:found,flow,sites,formula:{nodes:derived.nodes,edges:derived.edges,maxLevel:derived.maxLevel},
    panes:{formula:panes.formulaPane(graph,derived,link),expression:panes.expressionPane(derived,link)},
    bounds:bounded ? target.flowRange : null,read:{sources:closure.sources.length,nodes:graph.nodes.length,flow_rows:flow.length,places:found.length},
    analysisLog:JSON.stringify({engine:'ADT + abaplint',request:args,target,warnings,sourceClosure:closure.sources.map(s => ({id:s.id,name:s.name})),nodes:graph.nodes,edges:graph.edges,FLOW:{rows:flow,sites},Formula:derived},null,2)};
}
module.exports = {request};
