'use strict';
const fs=require('node:fs'),path=require('node:path');
function bundle(root){
 const modules=[],ids=new Map();
 function add(file){if(ids.has(file))return ids.get(file);const id=modules.length;ids.set(file,id);modules.push('');let code=fs.readFileSync(file,'utf8');
 if(file.endsWith('value-origin-linter.js'))code=code.slice(0,code.indexOf('function createParser'))+`function createParser(){return {parse:async source=>parseSource(source),close:async()=>{}};} module.exports={parseSource,createParser};`;
 code=code.replace(/require\(['"]([^'"]+)['"]\)/g,(all,name)=>{let target;try{target=require.resolve(name,{paths:[path.dirname(file)]});}catch(e){throw new Error(file+': '+name);}if(!path.isAbsolute(target)){if(name==='crypto')return '(new Proxy({}, {get:()=>()=>{throw new Error("Node crypto is unavailable in browser analysis");}}))';throw new Error('Browser cannot load '+name+' from '+file);}return '__vertexRequire('+add(target)+')';});
 modules[id]='function(module,exports,__vertexRequire){\nvar require=__vertexRequire;\n'+code+'\n}';return id;}
 const entry=add(path.join(root,'vscode/frontend-analysis.js'));
 return `(function(){var process={env:{}};${fs.readFileSync(path.join(__dirname,'browser-buffer.js'),'utf8')}var modules=[${modules.join(',\n')}],cache={};function load(id){if(!cache[id]){var m={exports:{}};cache[id]=m;try{modules[id](m,m.exports,load);}catch(error){delete cache[id];throw error;}}return cache[id].exports;}window.vertexFrontend=load(${entry});})();`;
}
module.exports={bundle};
