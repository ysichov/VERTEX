"use strict";

const fs = require("fs");
const path = require("path");

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(segment) {
  const result = [];
  let value = 0, shift = 0;
  for (const letter of segment) {
    const digit = alphabet.indexOf(letter);
    if (digit < 0) throw new Error("Invalid source map mapping.");
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) shift += 5;
    else { result.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
  }
  return result;
}
function mappedLines(map) {
  let source = 0, original = 0;
  return map.mappings.split(";").map(line => {
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const fields = vlq(segment);
      if (fields.length >= 4) { source += fields[1]; original += fields[2]; return source === 0 ? original + 1 : 0; }
    }
    return 0;
  });
}
/* Each generated line's place: [source index, 1-based line], or null. A function group's module maps several
   sources - its includes and its modules - into one file. */
function mappedPlaces(map) {
  let source = 0, original = 0;
  return map.mappings.split(";").map(line => {
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const fields = vlq(segment);
      if (fields.length >= 4) { source += fields[1]; original += fields[2]; return [source, original + 1]; }
    }
    return null;
  });
}
const JS_KEYWORDS = new Set(("break case catch class const continue debugger default delete do else enum export extends false " +
  "finally for function if import in instanceof new null return super switch this throw true try typeof var void while with " +
  "yield let static implements interface package private protected public await").split(" "));
/* What a source contributes: its lines, the names whose values are recorded, its owner and the routine of each line. */
function sourceContext(sourceFile, source) {
  const original = source.split(/\r?\n/);
  const interfaceTexts = [...source.matchAll(/\bINTERFACES\s+([A-Za-z_]\w*)/gi)].map(match => {
    const file = path.join(path.dirname(sourceFile), match[1].toLowerCase() + ".intf.abap");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  });
  const signatures = [source, ...interfaceTexts].join("\n");
  const methodParameters = [...signatures.matchAll(/\bMETHODS\s+[\w~]+([^.]*?)\./gi)].flatMap(match =>
    [...match[1].matchAll(/\b(?:VALUE\s*\(\s*)?([A-Za-z_]\w*)\s*\)?\s+(?:TYPE|LIKE)\b/gi)].map(entry => entry[1].toLowerCase()));
  // A function module's parameters are in its group's XML; its Local Interface comment names them.
  const moduleParameters = [...source.matchAll(/^\*"\s+(?:REFERENCE|VALUE)\(\s*([A-Za-z_]\w*)\s*\)/gim)].map(match => match[1].toLowerCase());
  const names = [...new Set([
    ...[...source.matchAll(/\b(?:DATA|PARAMETERS)\s+([A-Za-z_]\w*)\b/gi)].map(match => match[1].toLowerCase()),
    ...[...source.matchAll(/\bDATA\s*\(\s*([A-Za-z_]\w*)\s*\)/gi)].map(match => match[1].toLowerCase()),
    ...methodParameters, ...moduleParameters
  ])];
  // A name read where it is not yet declared - DATA further down the routine - is a JavaScript let before its
  // initialisation, which even typeof cannot touch: each one is read on its own, and an unreadable one is undefined.
  // A name that is a JavaScript keyword cannot be written here at all.
  const values = names.filter(name => !JS_KEYWORDS.has(name)).map(name => `${JSON.stringify(name)}:globalThis.__vertexTrace.read(` +
    `(()=>{try{return ${name}}catch{return undefined}})())`).join(",");
  const owner = path.basename(sourceFile).split(".")[0].toUpperCase();
  let routine = owner;
  const routines = original.map(line => {
    const start = /^\s*(?:METHOD|FORM|FUNCTION)\s+([A-Za-z_\/]\w*(?:~[A-Za-z_]\w*)?)\b/i.exec(line);
    if (start) routine = start[1].toUpperCase();
    const current = routine;
    if (/^\s*(?:ENDMETHOD|ENDFORM|ENDFUNCTION)\b/i.test(line)) routine = owner;
    return current;
  });
  return { sourceFile, original, values, names, owner, routines };
}
/* sources: [{ index, file, text }] - the sources of the map to record, by their index in it. */
function instrumentSources(file, sources, live = false, interventions = [], matched = new Set()) {
  const map = JSON.parse(fs.readFileSync(file + ".map", "utf8"));
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const places = mappedPlaces(map);
  const contexts = new Map(sources.map(source => [source.index, sourceContext(source.file, source.text)]));
  const executable = line => line && !/^\s*(?:\*|"|REPORT\b|PROGRAM\b|FUNCTION-POOL\b|DATA\b(?!\s*\()|PARAMETERS\b|ENDDO\b|ENDMETHOD\b|ENDCLASS\b|ENDFUNCTION\b)/i.test(line);
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    const place = places[index], context = place && contexts.get(place[0]), at = place && place[1];
    if (context && executable(context.original[at - 1]) &&
        /^\s*(?:abap\.|[A-Za-z_]\w*\.|await\b|return\b|if\s*\(|for\s*\(|while\s*\(|throw\b)/.test(lines[index])) {
      // On the statement's own line: the generated lines keep their numbers, so a stack and the map still agree.
      const indent = /^\s*/.exec(lines[index])[0];
      const injections = interventions.filter(item => item.line === at &&
        path.basename(context.sourceFile).toUpperCase().split(".").includes(item.object_name));
      const prefix = injections.map(item => {
        if (!context.names.includes(item.name.toLowerCase())) throw new Error("Intervention variable " + item.name + " is not declared in " + item.object_name + ".");
        matched.add(item.id);
        const variable = item.name.toLowerCase();
        return `globalThis.__vertexTrace.inject(${JSON.stringify(item)},()=>${variable},value=>${variable}.set(value)); `;
      }).join("");
      output.push(`${indent}${prefix}${live ? "await " : ""}globalThis.__vertexTrace?.capture(${JSON.stringify(context.sourceFile)},${at},{${context.values}},` +
        `${JSON.stringify(context.owner)},${JSON.stringify(context.routines[at - 1])}); ` + lines[index].slice(indent.length));
      continue;
    }
    output.push(lines[index]);
  }
  fs.writeFileSync(file, output.join("\n"));
}
function instrument(file, sourceFile, source, live = false) {
  return instrumentSources(file, [{ index: 0, file: sourceFile, text: source }], live);
}
/* skip: sources not recorded - the program VERTEX writes to call a method or function module, so a run shows only
   the code it calls. */
function instrumentProject(outputRoot, live = false, skip = [], interventions = []) {
  let count = 0; const matched = new Set();
  function visit(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) { if (item.name !== "node_modules") visit(file); continue; }
      if (!item.name.endsWith(".mjs") || !fs.existsSync(file + ".map")) continue;
      const map = JSON.parse(fs.readFileSync(file + ".map", "utf8"));
      // Every ABAP source of the map: a function group's file holds its includes and modules together.
      const sources = (map.sources || []).map((name, index) => ({ index, file: path.resolve(path.dirname(file), name) }))
        .filter(source => /\.abap$/i.test(source.file) && fs.existsSync(source.file)
          && !skip.some(name => path.basename(source.file).toLowerCase() === name.toLowerCase())
          // SAP's own classes, from the bundled open-abap-core: run, never recorded or stepped into.
          && !source.file.toLowerCase().split(/[\\/]/).includes("open-abap-core"))
        .map(source => ({ ...source, text: fs.readFileSync(source.file, "utf8") }));
      if (!sources.length) continue;
      instrumentSources(file, sources, live, interventions, matched); count++;
    }
  }
  visit(outputRoot);
  for (const item of interventions) if (!matched.has(item.id)) throw new Error("Intervention target " + item.object_name + " line " + item.line + " was not found in executable transpiled code.");
  return count;
}
function traceBootstrap(outputRoot, entry, traceFile, live = false) {
  const wrapper = path.join(outputRoot, "vertex-local-trace.mjs");
  const relative = "./" + path.relative(outputRoot, entry).replaceAll("\\", "/");
  fs.writeFileSync(wrapper, `import fs from 'node:fs';\n` +
    (live ? `import readline from 'node:readline';\nlet resumeTrace;\n` +
      `readline.createInterface({input:process.stdin}).on('line',line=>{try{if(JSON.parse(line).vertexTrace==='resume'){const done=resumeTrace;resumeTrace=null;done?.();}}catch{}});\n` : "") +
    `const records=[]; const last=new Map();const injectionHits=new Map();const injections=[];\n` +
    `function safe(value){try {const seen=new WeakSet();const json=JSON.stringify(value,(_key,item)=>{\n` +
    ` if(typeof item==='bigint')return item.toString();\n` +
    ` if(item&&typeof item==='object'){if(seen.has(item))return '[circular]';seen.add(item);}\n` +
    ` return item;});return json===undefined?['undefined',undefined]:[json,JSON.parse(json)];}\n` +
    ` catch(error){return [String(value),String(value)];}}\n` +
    `globalThis.__vertexTrace={sql:[],inject(spec,get,set){const hit=(injectionHits.get(spec.id)||0)+1;injectionHits.set(spec.id,hit);\n` +
    ` if(hit!==spec.occurrence)return;const target=get();if(!target||typeof target.set!=='function')throw Error('Intervention '+spec.name+' cannot be set at '+spec.object_name+':'+spec.line);\n` +
    ` const before=this.read(target);set(spec.value);const after=this.read(target);injections.push({id:spec.id,name:spec.name,object_name:spec.object_name,line:spec.line,occurrence:hit,before,requested:spec.value,after});\n` +
    ` },read(value,depth=0){\n` +
    ` if(depth>5)return '[nested]';\n` +
    ` try{if(value&&typeof value.array==='function')return value.array().map(row=>this.read(row,depth+1));\n` +
    ` if(value&&typeof value.get==='function')return this.read(value.get(),depth+1);\n` +
    ` if(Array.isArray(value))return value.map(row=>this.read(row,depth+1));\n` +
    ` if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,this.read(v,depth+1)]));\n` +
    ` return value;}catch(error){return '[unavailable: '+error.message+']';}\n` +
    ` },${live ? "async " : ""}capture(file,line,values,owner,routine){const changed={};\n` +
    ` for(const [name,value] of Object.entries(values)){const [signature,plain]=safe(value);\n` +
    ` if(last.get(name)!==signature){changed[name]=plain;last.set(name,signature);}}\n` +
    ` const stack=String(new Error().stack||'').split('\\n').slice(2).map(frame=>{\n` +
    ` const found=/[\\\\/]([^\\\\/]+)\\.(?:prog|clas|intf|fugr)\\.mjs(?::\\d+)?/.exec(frame);\n` +
    ` if(!found)return null;const fn=/^\\s*at (?:async )?([^\\s(]+)\\s*\\(/.exec(frame);\n` +
    ` return {owner:found[1].toUpperCase(),unit:fn?fn[1].split('.').pop().replaceAll('$','~').toUpperCase():found[1].toUpperCase()};\n` +
    ` }).filter(Boolean).filter((item,index,list)=>index===0||item.owner!==list[index-1].owner||item.unit!==list[index-1].unit);\n` +
    // The SY fields statements set, as they stand before this one runs; and the SELECTs the statement before it ran.
    ` const sy={};try{const fields=globalThis.abap?.builtin?.sy?.get?.()||{};for(const name of ['subrc','tabix','index','dbcnt','fdpos']){\n` +
    ` if(!fields[name])continue;const [signature,plain]=safe(this.read(fields[name]));if(last.get('sy-'+name)!==signature){sy[name.toUpperCase()]=plain;last.set('sy-'+name,signature);}}}catch{}\n` +
    ` const record={file,line,owner,routine,stack:stack.length?stack:[{owner,unit:routine}],changed};\n` +
    ` if(injections.length)record.interventions=injections.splice(0);\n` +
    ` if(Object.keys(sy).length)record.sy=sy;if(this.sql.length)record.sql=this.sql.splice(0);records.push(record);\n` +
    (live ? ` process.stdout.write('VERTEX_TRACE_RECORD:'+JSON.stringify(record)+'\\n');await new Promise(resolve=>{resumeTrace=resolve;});` : "") +
    `}};\n` +
    // The SELECTs of the last statement have no next step: they go with the last one.
    `try { await import(${JSON.stringify(relative)}); } finally {\n` +
    ` const tail=globalThis.__vertexTrace.sql.splice(0);if(tail.length&&records.length){const at=records[records.length-1];at.sql=(at.sql||[]).concat(tail);` +
    (live ? `process.stdout.write('VERTEX_TRACE_TAIL:'+JSON.stringify(tail)+'\\n');` : "") + `}\n` +
    ` fs.writeFileSync(${JSON.stringify(traceFile)},JSON.stringify(records)); process.stdin.destroy(); }\n`);
  return wrapper;
}

/* A failed run as the ABAP it ran: the error's own line, then each place of its stack that the transpiler's maps lead
   back to an ABAP line - object, line and file, innermost first - the way ST22 names where a program stopped. null when
   no place of the text is ABAP's. */
function abapFailure(text) {
  const places = [], seen = new Set(), maps = new Map();
  for (const found of String(text || "").matchAll(/(?:file:\/\/\/)?((?:[A-Za-z]:|\/)[^\s:()'"]*?\.mjs):(\d+)/g)) {
    const file = path.resolve(decodeURI(found[1])), line = Number(found[2]);
    if (!maps.has(file)) {
      let map = null;
      try { const json = JSON.parse(fs.readFileSync(file + ".map", "utf8")); map = { json, places: mappedPlaces(json) }; }
      catch (_) { /* no map: not ABAP */ }
      maps.set(file, map);
    }
    const map = maps.get(file), place = map && map.places[line - 1];
    if (!place || !map.json.sources?.[place[0]]) continue;
    const source = path.resolve(path.dirname(file), map.json.sources[place[0]]);
    const key = source + ":" + place[1];
    if (seen.has(key)) continue;
    seen.add(key);
    // A function group's file names its part - the module or include - after .fugr.
    const parts = path.basename(source).split("."), object = parts[1] === "fugr" && parts[2] ? parts[2] : parts[0];
    places.push(object.toUpperCase().replace(/#/g, "/") + " line " + place[1] + " (" + path.basename(source) + ")");
  }
  if (!places.length) return null;
  const message = String(text).split(/\r?\n/).find(line => /^\s*(?:[A-Za-z]*Error|Exception)\b.*?:/.test(line))
    || String(text).split(/\r?\n/).find(line => line.trim()) || "The run failed.";
  return message.trim() + "\n" + places.map((place, index) => (index ? "  called from " : "  at ") + place).join("\n");
}

module.exports = { mappedPlaces, mappedLines, instrument, instrumentProject, traceBootstrap, abapFailure };
