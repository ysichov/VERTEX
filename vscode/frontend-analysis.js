"use strict";
// Tools transport adapter. Every analysis fact comes from standard ADT source
// and the bundled parser; the /vertex paths are UI protocol names only.
const { buildIndex, assignment, customerObject } = require('./value-origin-model');
const callGraph = require('./call-graph');
const { createParser } = require('./value-origin-linter');
const upper = s => String(s || '').toUpperCase();
// Mermaid quoted labels accept arrows literally. HTML entities survive as
// visible text when htmlLabels is disabled; use Mermaid escapes if needed.
const quoted = s => String(s).replace(/["\r\n]/g, ' ').replace(/&/g, '#38;').replace(/</g, '#60;');
// Repository APIs are scoped to URL/client/user/system by code-workbench.
// Cache immutable parser results, not the mutable index/graph of a request.
const sourceCaches = new WeakMap();
const CACHE_TTL = 5 * 60 * 1000, CACHE_LIMIT = 100, CACHE_BYTES = 32 * 1024 * 1024;
function invalidate(api) { sourceCaches.delete(api); }
function cacheFor(api) {
  if (!sourceCaches.has(api)) sourceCaches.set(api, new Map());
  return sourceCaches.get(api);
}
function trimCache(cache) {
  let bytes = [...cache.values()].reduce((n,e)=>n+(e.bytes||0),0);
  for(const [key,e] of cache) {
    if(cache.size<=CACHE_LIMIT&&bytes<=CACHE_BYTES)break;
    if(e.completed){cache.delete(key);bytes-=e.bytes||0;}
  }
}
function declarations(sources) {
  const nodes = [], edges = [];
  for (const source of sources) {
    let owner, visibility = 'public';
    for (const s of source.aceStatements) {
      const t = s.tokens.map(t => upper(t.value)), raw = s.text;
      if (['CLASS', 'INTERFACE'].includes(t[0]) && t[1] !== '-' && !t.includes('IMPLEMENTATION')) {
        owner = { name: t[1], kind: t[0] === 'INTERFACE' ? 'interface' : 'class', methods: [] };
        nodes.push(owner); visibility = 'public';
        const at = t.indexOf('FROM');
        if (t.includes('INHERITING') && at >= 0) edges.push({ source: owner.name, target: t[at + 1], kind: 'inheritance' });
      }
      if (t[1] === 'SECTION') visibility = t[0].toLowerCase();
      if (owner && t[0] === 'INTERFACES') edges.push({ source: owner.name, target: t[1], kind: 'implementation', visibility });
      if (owner && (t[0] === 'METHODS' || t.slice(0, 3).join(' ') === 'CLASS - METHODS')) {
        const start = t[0] === 'METHODS' ? 1 : 3;
        const chunks = [[]];
        for (const token of t.slice(start)) { if (token === ',') chunks.push([]); else if (![':', '.'].includes(token)) chunks.at(-1).push(token); }
        for (const chunk of chunks) if (chunk.length) owner.methods.push({ name: chunk[0], visibility, is_static: start === 3 ? 'X' : '', signature: raw });
      }
      // ACE UML scans references only in attributes and method declarations.
      const declaration=t[0]==='DATA'||t[0]==='METHODS'||t.slice(0,3).join(' ')==='CLASS - DATA'||t.slice(0,3).join(' ')==='CLASS - METHODS';
      if (owner&&declaration) for (let i = 0; i < t.length - 2; i++) if (t[i] === 'REF' && t[i + 1] === 'TO' && t[i + 2]!==owner.name && t[i + 2]!=='OBJECT')
        edges.push({ source: owner.name, target: t[i + 2], kind: 'dependency' });
      if (['ENDCLASS', 'ENDINTERFACE'].includes(t[0])) owner = null;
    }
  }
  for(const node of nodes)node.methods=[...new Map(node.methods.map(m=>[m.name,m])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  return { nodes, edges: [...new Map(edges.map(e => [JSON.stringify(e), e])).values()] };
}
let metricKeywords;
function grammarKeywords() {
  if(metricKeywords)return metricKeywords;
  metricKeywords=new Set();
  const lint=require('@abaplint/core');
  // zcl_vx_ace_keywords walks both statement and expression matchers.
  for(const group of [lint.Statements,lint.Expressions])for(const Matcher of Object.values(group)){
    if(typeof Matcher!=='function'||typeof Matcher.prototype?.getMatcher!=='function')continue;
    for(const phrase of new Matcher().getMatcher().listKeywords()){
      metricKeywords.add(upper(phrase));
      for(const word of phrase.split(/\s+/))metricKeywords.add(upper(word));
    }
  }
  return metricKeywords;
}
function metric(p) {
  const body = p.source.aceStatements.filter(s=>s.offset>=p.start&&(p.unitType==='EVENT'?s.offset<p.end:s.offset<=p.end)), lines = p.source.text.split(/\r?\n/), first = p.line;
  const last = body.at(-1)?.tokens.at(-1)?.line || first;
  const text = lines.slice(first - 1, last), tokens = body.flatMap(s => s.tokens);
  const ops = [], operands = [];
  const words = grammarKeywords();
  tokens.forEach(t => (words.has(upper(t.value)) ? ops : operands).push(upper(t.value)));
  const n1 = ops.length, n2 = operands.length, big_n1 = new Set(ops).size, big_n2 = new Set(operands).size;
  const vocabulary = big_n1 + big_n2, prog_length = n1 + n2;
  const volume = vocabulary ? prog_length * Math.log2(vocabulary) : 0;
  const difficulty = big_n2 ? big_n1 / 2 * n2 / big_n2 : 0, effort = volume * difficulty;
  const cyclomatic = 1 + body.filter(s => ['IF','ELSEIF','WHEN','CATCH','LOOP','DO','WHILE','CHECK','AT','ON'].includes(upper(s.tokens[0]?.value))).length;
  const loc = text.length, cloc = text.filter(l => /^\s*(\*|")/.test(l)).length;
  return { include: p.source.name, unit_type: p.unitType || (p.owner ? 'METHOD' : 'EVENT'),
    unit_name: (p.owner ? p.owner + '=>' : '') + p.name, visibility: 'unknown', line_from: first, line_to: last,
    cyclomatic, loc, lloc: body.length, cloc, n1, n2, big_n1, big_n2, vocabulary, prog_length,
    volume, difficulty, effort, time_t: effort / 18, bugs: volume / 3000,
    mi: volume > 0 && loc > 0 ? 171 - 5.2 * Math.log(volume) - .23 * cyclomatic - 16.2 * Math.log(loc) : 0 };
}
// ACE Parts are routine/event boundaries, not the model's synthetic GLOBAL.
function analysisUnits(index) {
  const result=[];
  for(const p of index.procedures){
    if(p.name!=='GLOBAL'){
      const header=p.source.aceStatements.find(s=>s.offset===p.start);
      const type=upper(header?.tokens[0]?.value);
      result.push({...p,unitType:['METHOD','FORM','FUNCTION','MODULE'].includes(type)?type:(p.owner?'METHOD':'FORM')});
      continue;
    }
    if(['CLAS','INTF'].includes(p.source.objectType))continue;
    const statements=p.source.aceStatements;
    const events=statements.filter(s=>s.parserKind==='Get'||/^(?:LOAD-OF-PROGRAM|INITIALIZATION|START-OF-SELECTION|END-OF-SELECTION|TOP-OF-PAGE|END-OF-PAGE|AT\s+(?:SELECTION-SCREEN|LINE-SELECTION|USER-COMMAND|PF\d+))/i.test(s.text));
    const modules=[];
    for(let i=0;i<statements.length;i++)if(upper(statements[i].tokens[0]?.value)==='MODULE'){
      const first=statements[i],last=statements.slice(i+1).find(s=>upper(s.tokens[0]?.value)==='ENDMODULE');
      if(last){modules.push({start:first.offset,end:last.offset});result.push({...p,id:p.id+':'+first.offset,name:upper(first.tokens[1]?.value),unitType:'MODULE',line:first.line,start:first.offset,end:last.offset,body:p.body.filter(s=>s.offset>first.offset&&s.offset<last.offset)});}
    }
    for(let i=0;i<events.length;i++){
      const first=events[i],next=events[i+1]?.offset??p.end;
      const end=Math.min(next,...index.procedures.filter(q=>q.source===p.source&&q.name!=='GLOBAL'&&q.start>first.offset).map(q=>q.start),...modules.filter(q=>q.start>first.offset).map(q=>q.start));
      result.push({...p,id:p.id+':'+first.offset,name:upper(first.text.replace(/\.$/,'').trim()),unitType:'EVENT',line:first.line,start:first.offset,end,body:p.body.filter(s=>s.offset>=first.offset&&s.offset<end)});
    }
    if(!events.length&&!modules.length&&!index.procedures.some(q=>q.source===p.source&&q.name!=='GLOBAL')){
      const body=p.body.filter(s=>!['REPORT','PROGRAM'].includes(upper(s.tokens[0]?.value)));
      if(body.length)result.push({...p,name:'START-OF-SELECTION',unitType:'EVENT',line:body[0].line,start:body[0].offset,body});
    }
  }
  return result;
}
async function request(api, resource, progress, cancelled = () => false) {
  const check=()=>{if(cancelled())throw new Error('Analysis cancelled: a newer request replaced it.');};
  async function untilCancelled(promise){
    check();let poll;
    try{return await Promise.race([promise,new Promise((_,reject)=>{poll=setInterval(()=>{try{check();}catch(e){reject(e);}},50);})]);}
    finally{clearInterval(poll);}
  }
  const url = new URL(resource, 'https://sap.invalid');
  const match = /^\/sap\/bc\/adt\/vertex\/(metrics|class|package|flow)\/(.+)$/.exec(url.pathname);
  if (!match) return null;
  const [, service, encoded] = match;
  let name = upper(decodeURIComponent(encoded));
  let type = upper(url.searchParams.get('type') || (service === 'class' ? 'CLAS' : 'PROG')).split('/')[0];
  const pool = /^(.+?)=+CP$/.exec(name);
  const requestedDepth=Number(url.searchParams.get('depth'));
  const callDepth=Math.min(99,Math.max(1,Number.isFinite(requestedDepth)&&requestedDepth>0?Math.floor(requestedDepth):2));
  const callStart=upper(url.searchParams.get('unit')||url.searchParams.get('start'));
  const walkedCalls=[];
  const entries=available=>{
    let roots=available.filter(p=>p.source.objectName===name);
    if(callStart)return roots.filter(p=>upper((p.owner?p.owner+'=>':'')+p.name)===callStart||p.name===callStart);
    if(type==='CLAS')return roots.filter(p=>p.owner===name&&p.name==='CONSTRUCTOR');
    const events=roots.filter(p=>p.unitType==='EVENT');
    return type==='PROG'&&events.length?events:roots;
  };
  if (service === 'flow' && url.searchParams.get('mode') === 'statements' && pool) { name = pool[1]; type = 'CLAS'; }
  let parser;
  const read = api.analysisReader(), sources = [], warnings = [], cache=cacheFor(api);
  const started=Date.now();let phase='Reading '+name;
  const report=()=>{if(typeof progress==='function')progress(phase+' · '+sources.length+' sources · '+Math.floor((Date.now()-started)/1000)+' s');};
  const stage=text=>{check();phase=text;report();};
  report();const pulse=setInterval(report,2000);
  async function load(object_name, object_type) {
    const key=object_type+':'+object_name, existing=cache.get(key);
    if(existing&&(!existing.completed||Date.now()-existing.completed<CACHE_TTL)){
      stage('Reusing '+object_name+' (cached)');
      const loaded=structuredClone(await untilCancelled(existing.promise));
      sources.push(...loaded.sources);warnings.push(...loaded.warnings);
      cache.delete(key);cache.set(key,existing);return;
    }
    cache.delete(key);
    const entry={completed:0,bytes:0};
    // Start the work in a microtask so concurrent requests see the entry first.
    entry.promise=Promise.resolve().then(()=>readObject(object_name,object_type));
    cache.set(key,entry);
    try{
      const loaded=await untilCancelled(entry.promise);check();entry.completed=Date.now();
      entry.bytes=loaded.sources.reduce((n,s)=>n+Buffer.byteLength(s.text||'','utf8'),0);
      trimCache(cache);
      const copy=structuredClone(loaded);sources.push(...copy.sources);warnings.push(...copy.warnings);
    }catch(e){if(cache.get(key)===entry)cache.delete(key);throw e;}
  }
  async function readObject(object_name, object_type) {
    const loaded={sources:[],warnings:[]};
    stage('Reading '+object_name);
    let data;
    try { data = await read({ object_name, object_type }); }
    catch (e) {
      if (!/was not found/.test(e.message)) throw e;
      if (object_type === 'CLAS') data = await read({ object_name, object_type: 'INTF' });
      else if (object_type === 'PROG') {
        const source_url = '/sap/bc/adt/programs/includes/' + encodeURIComponent(object_name.toLowerCase()) + '/source/main';
        data = { object_name, object_type, source_url, source: await api.sourceAt(source_url), includes: [] };
      } else throw e;
    }
    async function part(data) {
      stage('Parsing '+data.object_name+(data.include&&data.include!=='main'?' / '+data.include:''));
      if(!parser)parser=createParser(cancelled);
      const result = await parser.parse({ id: data.source_url, name: data.object_name + (data.include && data.include !== 'main' ? '.' + data.include : ''), objectName: data.object_name,
        objectType: data.object_type, text: data.source });
      loaded.sources.push(result.source);loaded.warnings.push(...result.warnings);
    }
    await part(data);
    if (data.object_type === 'CLAS') for (const include of data.includes.filter(i => ['definitions','implementations','macros'].includes(i)))
      {stage('Reading '+object_name+' / '+include);await part(await read({ object_name, object_type: 'CLAS', include }));}
    return loaded;
  }
  try {
    if (service === 'package' || type === 'DEVC') {
      const objects = await api.packageObjects(name);
      for (const object of objects) await load(object.object_name, object.object_type);
    } else await load(name, type);
    if (service === 'flow' && url.searchParams.get('mode') === 'calls') {
      const seen = new Set(sources.map(s => s.objectName));
      const depth = callDepth;
      let currentIndex=buildIndex(sources),indexed=analysisUnits(currentIndex),executionCalls=callGraph.create(currentIndex,indexed);
      const refreshCalls=()=>{currentIndex=buildIndex(sources);indexed=analysisUnits(currentIndex);executionCalls=callGraph.create(currentIndex,indexed);};
      await callGraph.walk(entries(indexed),{
        maxDepth:depth,cancelled,
        onLevel:level=>stage('Resolving calls: level '+level+' / '+depth),
        calls:async(p,s,level)=>{
          check();
          const records=executionCalls.calls(p,s);
          for(const record of records){
            const c=record.call;
            for(const owner of record.owners)if(level+1<depth&&owner&&customerObject(owner)&&!seen.has(owner)){
              if(seen.size>=100){warnings.push('Call source closure limited to 100 objects.');}
              else{seen.add(owner);try{await load(owner,c.kind==='FORM'?'PROG':c.kind==='FUNCTION'?'FUNC':'CLAS');refreshCalls();}catch(e){check();warnings.push(owner+': '+e.message);}}
            }
            const refreshed=executionCalls.calls(p,s).find(r=>r.call.method===c.method&&r.call.owner===c.owner&&r.call.receiver===c.receiver&&r.call.kind===c.kind);
            record.targets=refreshed?.targets||record.targets;
            walkedCalls.push({caller:p.id,owner:record.owners[0]||'',receiver:c.receiver,method:c.method,kind:c.kind,targets:record.targets.map(q=>q.id),boundary:level+1===depth});
          }
          return records;
        }
      });
    }
    stage('Building '+service+' analysis');
    // Empty routines are real ACE units too (metrics and call leaves).
    if (service === 'flow' && url.searchParams.get('mode') === 'origin') return { sources, warnings };
    const index = buildIndex(sources), units = analysisUnits(index);
    const base = { object: name, program: name, type, engine: 'ADT + abaplint', warnings };
    if (service === 'class' || service === 'package') {
      const graph=declarations(sources);
      if(service==='class'){graph.nodes=graph.nodes.filter(n=>n.name===name);graph.edges=graph.edges.filter(e=>e.source===name);}
      return { ...base, ...graph };
    }
    if (service === 'metrics') {
      const rows = units.map(metric), totals = { units: rows.length };
      for (const key of ['cyclomatic','loc','lloc','cloc','volume','effort','time_t','bugs']) totals[key] = rows.reduce((sum, r) => sum + r[key], 0);
      totals.avg_cyclomatic = rows.length ? totals.cyclomatic / rows.length : 0;
      const definitions = declarations(sources);
      for (const row of rows) {
        const [owner, method] = row.unit_name.split('=>');
        const member = definitions.nodes.find(n => n.name === owner)?.methods.find(m => m.name === method);
        if (member) { row.visibility = member.visibility; row.is_static = member.is_static; }
        else if (method?.includes('~')) row.visibility = definitions.edges.find(e => e.kind === 'implementation' && e.source === owner && e.target === method.split('~')[0])?.visibility || 'public';
      }
      const objects = type === 'DEVC' ? [...new Set(sources.map(s => s.objectName))].map(object => {
        const unit_rows = rows.filter(r => r.unit_name.startsWith(object + '=>') || r.include === object);
        const cyclomatic = unit_rows.reduce((sum,r) => sum + r.cyclomatic, 0);
        return { object, object_type: sources.find(s => s.objectName === object).objectType, unit_rows, units: unit_rows.length,
          cyclomatic, avg_cyclomatic: unit_rows.length ? cyclomatic / unit_rows.length : 0, loc: unit_rows.reduce((sum,r) => sum + r.loc,0) };
      }) : undefined;
      return { ...base, units: rows, totals, ...(objects ? { objects } : {}), warnings: [...warnings, 'Experimental local metrics: lexical Halstead classification and unit boundaries may differ from ACE.'] };
    }
    const mode = url.searchParams.get('mode') || 'scheme';
    if (mode === 'statements') return { ...base, includes: sources.map(s => ({ include: s.objectType === 'CLAS' && s.name === s.objectName ? '$ADT_MAIN' : s.name, statements: s.aceStatements.map(st => {
      const kw = upper(st.text.match(/^([\w-]+)/)?.[1]);
      const calls = !!st.tokens.find(t => ['->','=>'].includes(t.value)) || /^(CALL|PERFORM|SUBMIT)$/.test(kw) || st.parserKind === 'CreateObject';
      const unsafe = ['Unknown','MacroCall','MacroContent','NativeSQL'].includes(st.parserKind);
      const target = /^(FORM|PERFORM)$/.test(kw) && !/[()]/.test(st.tokens[1]?.value || '') ? upper(st.tokens[1]?.value) : '';
      return { line: st.line, to: st.tokens.at(-1)?.line || st.line, kw, calls, coordinate: 'adt-source', source_url: s.id,
        kind: calls ? 'call' : unsafe || /^(IF|ELSE|ELSEIF|ENDIF|CASE|WHEN|ENDCASE|LOOP|ENDLOOP|DO|ENDDO|WHILE|ENDWHILE|CHECK|RETURN|TRY|CATCH|ENDTRY|SELECT|ENDSELECT|EXIT|CONTINUE|RAISE|LEAVE|STOP|AT|ENDAT|ON)$/.test(kw) ? 'flow' : !assignment(st.tokens) && /^(DATA|TYPES|CLASS|METHOD|METHODS|INTERFACE|PARAMETERS|PUBLIC|PRIVATE|PROTECTED|CONSTANTS|STATICS|FIELD-SYMBOLS)$/.test(kw) ? 'decl' : 'plain', target, owners: '', callees: '' };
    }) })) };
    const wanted = upper(url.searchParams.get('unit') || url.searchParams.get('start'));
    const chosen = wanted ? units.filter(p => upper((p.owner ? p.owner + '=>' : '') + p.name) === wanted || p.name === wanted) : units;
    if (wanted && !chosen.length) throw new Error('Routine not found: ' + wanted);
    if (mode === 'calls') {
      const nodes = [], edges = [], ids = new Map(), links=[];
      const all=url.searchParams.get('all')==='X';
      const style=p=>p.unitType==='METHOD'?(all&&['CONSTRUCTOR','CLASS_CONSTRUCTOR'].includes(p.name)?'constr':'method'):!all?'event':p.unitType==='FUNCTION'?'func':['FORM','MODULE'].includes(p.unitType)?'form':p.unitType==='ENHANCEMENT'?'enh':'event';
      const routineLabel=p=>!all?p.owner||p.source.objectName:p.owner?p.owner+'->'+p.name:p.unitType==='FUNCTION'?'FUNCTION:'+p.name:['FORM','MODULE'].includes(p.unitType)?p.unitType+' '+p.name:p.source.objectName+':'+p.name;
      const id = (label,kind='event') => { if (!ids.has(label)) { const value = 'c' + ids.size; ids.set(label, value); nodes.push(value + '("' + quoted(label) + '"):::'+kind); } return ids.get(label); };
      const link=(from,to,arrow,cost=1)=>{if(from!==to){links.push({from,to,cost,text:from+arrow+to});}};
      for (const c of walkedCalls) {
        check();const p=units.find(q=>q.id===c.caller);if(!p)continue;
        const label=routineLabel(p),owner=c.owner;
        const matches=c.targets.map(target=>units.find(q=>q.id===target)).filter(Boolean);
        // NEW also works without an explicit constructor. Keep source discovery
        // in the walker, but draw only executable constructor implementations.
        if(c.method==='CONSTRUCTOR'&&!matches.length)continue;
        const targets = matches.length ? matches.map(q=>({label:routineLabel(q),style:style(q)})) : [{label:c.kind==='FUNCTION'?(all?'FUNCTION:'+c.method:c.method):c.kind==='FORM'?(all?'FORM '+c.method:owner||p.source.objectName):all?(owner || '?[' + c.receiver + ']') + '->' + c.method:owner || '?['+c.receiver+']',style:c.kind==='FUNCTION'?(all?'func':'event'):c.kind==='FORM'?(all?'form':'event'):['CONSTRUCTOR','CLASS_CONSTRUCTOR'].includes(c.method)&&all?'constr':'method'}];
        for (const target of targets) link(id(label,style(p)),id(target.label,target.style),matches.length||c.boundary&&owner?' --> ':' -. unresolved .-> ');
      }
      // ACE starts with execution entries at level 1; it does not invent
      // a program node or an EVENT edge above those entries.
      const starts=entries(units);
      for(const p of starts)id(routineLabel(p),style(p));
      // Depth was enforced before reading targets. Recomputing it on the
      // aggregated Classes graph loses routine levels and can drop real calls.
      for(const e of links)edges.push(e.text);
      const palette=require('./resources/vertex-flow-graph').palette;
      const colors=Object.entries(palette).map(([kind,[fill,stroke]])=>'classDef '+kind+' fill:'+fill+',stroke:'+stroke);
      return { ...base, mode, depth:callDepth, steps: ids.size, mermaid: 'flowchart TD\n' + [...nodes, ...new Set(edges),...colors].join('\n') };
    }
    if (chosen.length !== 1) throw new Error('Pick one method to draw its logic diagram.');
    return { ...base, mode, unit: wanted || name, unit_type: chosen[0].unitType,
      ...require('./ace-scheme').scheme(chosen[0], url.searchParams.get('expand') || ''),
      logicMermaid:require('./ace-scheme').scheme(chosen[0], url.searchParams.get('expand') || '',true).mermaid };
  } finally { clearInterval(pulse);if(parser)await parser.close(); }
}
module.exports = { request, declarations, metric, analysisUnits, invalidate };
