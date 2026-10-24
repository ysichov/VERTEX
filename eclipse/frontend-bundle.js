'use strict';
const fs=require('node:fs'),path=require('node:path');
// GLOBALS: [[window name, entry file relative to root], ...] - each entry's exports put on the window under its name.
function build(root,globals){
 const modules=[],ids=new Map();
 function add(file){
 // vscode/abap-control.js finds the rules file with fs; a browser takes the rules file itself.
 if(file===path.join(root,'vscode','abap-control.js'))file=path.join(root,'org.vertex.abap.ui','resources','vertex-abap-control.js');
 if(ids.has(file))return ids.get(file);const id=modules.length;ids.set(file,id);modules.push('');let code=fs.readFileSync(file,'utf8');
 if(file.endsWith('value-origin-linter.js'))code=code.slice(0,code.indexOf('function createParser'))+`function createParser(){return {parse:async source=>parseSource(source),close:async()=>{}};} module.exports={parseSource,createParser};`;
 code=code.replace(/require\(['"]([^'"]+)['"]\)/g,(all,name)=>{let target;try{target=require.resolve(name,{paths:[path.dirname(file)]});}catch(e){throw new Error(file+': '+name);}if(!path.isAbsolute(target)){// Node's crypto, fs and path have no browser side: what needs them (a local file's function group XML) says so when used.
if(['crypto','fs','path'].includes(name))return '(new Proxy({}, {get:()=>()=>{throw new Error("Node '+name+' is unavailable in browser analysis");}}))';throw new Error('Browser cannot load '+name+' from '+file);}return '__vertexRequire('+add(target)+')';});
 modules[id]='function(module,exports,__vertexRequire){\nvar require=__vertexRequire;\n'+code+'\n}';return id;}
 const entries=globals.map(([name,file])=>[name,add(path.join(root,file))]);
 return `(function(){var process={env:{}};${fs.readFileSync(path.join(__dirname,'browser-buffer.js'),'utf8')}var modules=[${modules.join(',\n')}],cache={};function load(id){if(!cache[id]){var m={exports:{}};cache[id]=m;try{modules[id](m,m.exports,load);}catch(error){delete cache[id];throw error;}}return cache[id].exports;}${entries.map(([name,id])=>'window.'+name+'=load('+id+');').join('')}})();`;
}
function bundle(root){return build(root,[['vertexFrontend','vscode/frontend-analysis.js'],['vertexDebugAnalysis','eclipse/debug-analysis.js']]);}
// abaplint alone, for a page that runs analysis outside the worker (Value origin): call-graph asks it which calls are built-in.
function abaplint(root){return build(root,[['vertexAbaplint','vscode/node_modules/@abaplint/core/build/src/index.js']]);}
module.exports={bundle,abaplint};
