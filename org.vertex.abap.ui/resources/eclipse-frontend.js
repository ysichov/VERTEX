/* Eclipse host adapter. SAP reads stay in the project's ADT session. */
if(typeof sdeAnalysisRead==='function'){
 const pending=new Map();let serial=0;
 const read=path=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});sdeAnalysisRead(path,id);});
 window.vertexAdtReply=(id,value,error)=>{const item=pending.get(id);if(!item)return;pending.delete(id);error?item.reject(new Error(value)):item.resolve(value);};
 const xml=text=>{const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('ADT returned invalid object metadata.');return doc;};
 const attr=(el,name)=>{const a=Array.from(el.attributes||[]).find(a=>a.localName===name);return a&&a.value;};
 const help=document.createElement('details');help.innerHTML='<summary>ADT analysis help</summary><p>UML, metrics, Parts, Calls and Logic are calculated locally with abaplint from active ADT source. Select a routine in Parts or move the editor cursor. Eclipse follows editor selection; viewport scroll synchronization is not available. Value Origin also uses local ADT analysis. Versions and Review use their existing backend services.</p>';const notice=document.getElementById('notice');if(notice)notice.after(help);
 const objects=new Map();
 async function source(args){
  const key=args.object_type+':'+args.object_name;
  if(!objects.has(key))objects.set(key,read('object:'+key).then(JSON.parse).catch(error=>{objects.delete(key);throw error;}));
  const object=await objects.get(key),doc=xml(object.xml),elements=Array.from(doc.getElementsByTagName('*'));
  const include=args.include||'main',parts=elements.filter(e=>attr(e,'includeType'));
  const part=parts.find(e=>attr(e,'includeType')===include);
  const raw=(part&&attr(part,'sourceUri'))||(include==='main'&&elements.map(e=>attr(e,'sourceUri')).find(Boolean));
  if(!raw)throw new Error('SAP did not expose source for '+key+' / '+include);
  const uri=new URL(raw,'https://sap.invalid'+object.uri+'/');
  if(uri.origin!=='https://sap.invalid'||!uri.pathname.startsWith('/sap/bc/adt/'))throw new Error('Invalid ADT source URI.');
  return {object_name:args.object_name,object_type:args.object_type,include,source_url:uri.pathname,source:await read(uri.pathname+'?version=active'),includes:parts.map(e=>attr(e,'includeType'))};
 }
 // ADT's data preview: its XML read into rows of raw strings by column name, as abap-adt-api reads it in VS Code.
 // A refusal names a clause, not the statement, so the statement goes with it.
 async function preview(sql,rows){
  let text;try{text=await read('query:'+rows+':'+sql);}catch(error){throw new Error(error.message+'
SQL: '+sql);}
  const doc=xml(text),columns=Array.from(doc.getElementsByTagName('*')).filter(e=>e.localName==='columns');
  const fields=columns.map(c=>{const meta=Array.from(c.children).find(e=>e.localName==='metadata');const set=Array.from(c.children).find(e=>e.localName==='dataSet');
   return {name:attr(meta,'name'),values:set?Array.from(set.children).filter(e=>e.localName==='data').map(e=>e.textContent):[]};});
  const length=Math.max(0,...fields.map(f=>f.values.length));
  return {columns:fields.map(f=>({name:f.name})),values:Array.from({length},(_,i)=>Object.fromEntries(fields.map(f=>[f.name,f.values[i]])))};
 }
 const bundle=/*FRONTEND_BUNDLE*/;
 const worker=new Worker(URL.createObjectURL(new Blob(['var window=self;\n',bundle,`\nconst pending=new Map();let serial=0;const host=(op,args)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});postMessage({host:id,op,args});});const api={analysisReader:()=>args=>host('source',args),sourceAt:path=>host('read',path),packageObjects:name=>host('package',name),query:(sql,rows)=>host('query',{sql,rows}),language:()=>host('language')};onmessage=async({data})=>{if(data.reply){const p=pending.get(data.reply);pending.delete(data.reply);if(p)data.error?p.reject(new Error(data.error)):p.resolve(data.value);return;}try{const value=await vertexFrontend.request(api,data.path,text=>postMessage({progress:data.id,text}));postMessage({id:data.id,value});}catch(e){postMessage({id:data.id,error:e.message});}};`],{type:'text/javascript'})));
 const requests=new Map();let requestId=0;
 worker.onmessage=async({data})=>{
  if(data.host){try{let value;if(data.op==='source')value=await source(data.args);else if(data.op==='read')value=await read(data.args);else if(data.op==='query')value=await preview(data.args.sql,data.args.rows);else if(data.op==='language')value=await read('language:');else{const doc=xml(await read('package:'+data.args));value=Array.from(doc.getElementsByTagName('item')).map(el=>({object_name:el.getElementsByTagName('OBJECT_NAME')[0]?.textContent,object_type:el.getElementsByTagName('OBJECT_TYPE')[0]?.textContent.split('/')[0]})).filter(o=>['CLAS','INTF'].includes(o.object_type));if(value.length>100)throw new Error('Package contains more than 100 classes/interfaces; select a smaller package.');}worker.postMessage({reply:data.host,value});}catch(e){worker.postMessage({reply:data.host,error:e.message});}return;}
  const item=requests.get(data.id||data.progress);if(!item)return;if(data.progress){item.progress(data.text);return;}requests.delete(data.id);data.error?item.reject(new Error(data.error)):item.resolve(data.value);
 };
 worker.onerror=event=>{for(const item of requests.values())item.reject(new Error(event.message||'ABAP analysis worker stopped.'));requests.clear();};
 window.sdeFrontendAnalysis=()=>true;
 window.vertexEclipseRequest=(path,progress)=>new Promise((resolve,reject)=>{const id=++requestId;requests.set(id,{resolve,reject,progress});worker.postMessage({id,path});});
 addEventListener('unload',()=>worker.terminate());
}
