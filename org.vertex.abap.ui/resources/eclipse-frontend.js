/* Eclipse host adapter. SAP reads stay in the project's ADT session. */
if(typeof sdeAnalysisRead==='function'){
 const pending=new Map();let serial=0;
 const read=path=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});sdeAnalysisRead(path,id);});
 window.vertexAdtReply=(id,value,error)=>{const item=pending.get(id);if(!item)return;pending.delete(id);error?item.reject(new Error(value)):item.resolve(value);};
 const xml=text=>{const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('ADT returned invalid object metadata.');return doc;};
 const attr=(el,name)=>{const a=Array.from(el.attributes||[]).find(a=>a.localName===name);return a&&a.value;};
 const help=document.createElement('details');help.innerHTML='<summary>ADT analysis help</summary><p>UML, metrics, Parts, Calls and Logic are calculated locally with abaplint from active ADT source. Select a routine in Parts or move the editor cursor. Eclipse follows editor selection; viewport scroll synchronization is not available. Value Origin also uses local ADT analysis. Versions, the review of a request and finding requests read ADT the same way; saving a review and acting on it still go through the ABAP of VERTEX.</p>';const notice=document.getElementById('notice');if(notice)notice.after(help);
 if(window.vertexDebugHost)help.remove();
 window.vertexEclipseRead=read;
 window.vertexEclipseSource=source;
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
  // At most 200 characters a line, broken at blanks outside literals: the data preview refuses a longer line.
  const words=String(sql).match(/(?:'(?:[^']|'')*'|`(?:[^`]|``)*`|[^\s'`])+/g)||[],lines=[];
  words.forEach(w=>{const at=lines.length-1;if(at>=0&&lines[at].length+1+w.length<=200)lines[at]+=' '+w;else lines.push(w);});
  let text;try{text=await read('query:'+rows+':'+lines.join('\r\n'));}catch(error){throw new Error(error.message+'\nSQL: '+sql);}
  const doc=xml(text),columns=Array.from(doc.getElementsByTagName('*')).filter(e=>e.localName==='columns');
  const fields=columns.map(c=>{const meta=Array.from(c.children).find(e=>e.localName==='metadata');const set=Array.from(c.children).find(e=>e.localName==='dataSet');
   return {name:attr(meta,'name'),values:set?Array.from(set.children).filter(e=>e.localName==='data').map(e=>e.textContent):[]};});
  const length=Math.max(0,...fields.map(f=>f.values.length));
  return {columns:fields.map(f=>({name:f.name})),values:Array.from({length},(_,i)=>Object.fromEntries(fields.map(f=>[f.name,f.values[i]])))};
 }
 // ADT's revision feed of an object or one of a class's includes, as abap-adt-api reads it in VS Code: the versions
 // link of the object (or of the include) in its metadata, then the feed's entries - number, time, author, title,
 // transport and the address of the source. Parsed here: the worker has no DOMParser.
 const VERSIONS='http://www.sap.com/adt/relations/versions',TRANSPORT='application/vnd.sap.adt.transportrequests.v1+xml';
 const child=(el,name)=>Array.from(el.children||[]).filter(e=>e.localName===name);
 async function revisions(args){
  const meta=xml(await read(args.url)),root=meta.documentElement;
  const includes=Array.from(root.getElementsByTagName('*')).filter(e=>e.localName==='include'&&attr(e,'includeType'));
  const owner=includes.length?includes.find(e=>attr(e,'includeType')===(args.include||'main')):root;
  const link=owner&&child(owner,'link').find(l=>attr(l,'rel')===VERSIONS);
  if(!link)throw new Error('SAP keeps no version feed for '+args.url+'.');
  // abap-adt-api's followUrl: "./x" stands beside the object (a table's link is ./<name>/source/main/versions), any
  // other link inside it. Resolved as a browser resolves it, the table's name came twice and SAP answered 404.
  const href=String(attr(link,'href')||''),object=String(args.url).replace(/\/$/,'');
  const followed=/^\.\//.test(href)?object.replace(/[^\/]*$/,'')+href.slice(2):object+'/'+href.replace(/^\//,'');
  const feedUrl=new URL(followed,'https://sap.invalid/');
  if(feedUrl.origin!=='https://sap.invalid'||!feedUrl.pathname.startsWith('/sap/bc/adt/'))throw new Error('Invalid ADT version feed URI.');
  const feed=xml(await read(feedUrl.pathname+feedUrl.search));
  return Array.from(feed.getElementsByTagName('*')).filter(e=>e.localName==='entry').map(entry=>{
   const text=name=>{const n=child(entry,name)[0];return n?n.textContent:'';};
   const content=child(entry,'content')[0],uri=content?attr(content,'src')||'':'';
   const author=child(entry,'author')[0],authorName=author?(child(author,'name')[0]||{}).textContent||'':'';
   const transport=child(entry,'link').find(l=>attr(l,'type')===TRANSPORT);
   return {id:(/\/(\d{5})\/content$/.exec(uri)||[])[1]||'',uri,time:text('updated'),author:authorName,title:text('title'),transport:transport?attr(transport,'name')||'':''};
  });
 }
 // Two versions compared by Eclipse's own Text Compare (Java's LineDiff): one character per line of the result, the
 // texts put back here. A count that does not add up is a broken answer, not a diff.
 const compare=args=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});
  sdeAnalysisDiff(args.old.join('\n'),args.old.length,args.fresh.join('\n'),args.fresh.length,args.ignore?'X':'',id);}).then(shape=>{
  const ops=[];let o=0,n=0;
  for(const c of String(shape)){if(c==='=')ops.push({op:'=',text:args.fresh[n++]}),o++;else if(c==='-')ops.push({op:'-',text:args.old[o++]});else if(c==='+')ops.push({op:'+',text:args.fresh[n++]});else throw new Error('Eclipse returned an unreadable diff.');}
  if(o!==args.old.length||n!==args.fresh.length)throw new Error('Eclipse returned a diff that does not cover both versions.');
  return ops;});
 // Writing a review: to its file, or to SAP through VERTEX's store resource. Whether that resource is there comes
 // from the about answer; a system without VERTEX's ABAP answers 404, which is a plain no.
 const save=(kind,target,body)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});sdeAnalysisWrite(kind,target,body,id);});
 async function canStore(){try{return (JSON.parse(await read('/sap/bc/adt/vertex/about')).services||[]).some(s=>s.name==='store'&&s.active==='X');}catch(error){return false;}}
 // SAP's where-used at a place in a source, as abap-adt-api asks it in VS Code: the referencing objects, their
 // snippets, and - for a place inside a class's method - where that method starts in the source. Lines from 1.
 const RIS='http://www.sap.com/adt/ris/usageReferences';
 const risBody=inner=>'<?xml version="1.0" encoding="UTF-8"?><usagereferences:'+inner+' xmlns:usagereferences="'+RIS+'">';
 const hashParts=uri=>{const out={};String(uri).split('#')[1]?.split(';').forEach(p=>{const [k,v]=p.split('=');if(k==='start'||k==='end'){const [l,c]=v.split(',');out[k]={line:Number(l)||0,column:Number(c)||0};}else if(k==='type'||k==='name')out[k]=decodeURIComponent(v);});return out;};
 async function whereUsed(args){
  const at=args.uri+(args.line&&args.column!=null?'#start='+args.line+','+args.column:'');
  const refs=xml(await save('adtpost','/sap/bc/adt/repository/informationsystem/usageReferences?uri='+encodeURIComponent(at),risBody('usageReferenceRequest')+'<usagereferences:affectedObjects/></usagereferences:usageReferenceRequest>'));
  const ids=Array.from(refs.getElementsByTagName('*')).filter(e=>e.localName==='referencedObject').map(e=>attr(e,'objectIdentifier')||'').filter(Boolean);
  if(!ids.length)return [];
  const snippets=xml(await save('adtpost','/sap/bc/adt/repository/informationsystem/usageSnippets',risBody('usageSnippetRequest')+'<usagereferences:objectIdentifiers>'
   +ids.map(id=>'<usagereferences:objectIdentifier optional="false">'+id.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</usagereferences:objectIdentifier>').join('')
   +'</usagereferences:objectIdentifiers><usagereferences:affectedObjects/></usagereferences:usageSnippetRequest>'));
  const places=[],fragments=new Map();
  for(const object of Array.from(snippets.getElementsByTagName('*')).filter(e=>e.localName==='codeSnippetObject')){
   const objectId=(Array.from(object.children).find(e=>e.localName==='objectIdentifier')||{}).textContent||'';
   for(const snippet of Array.from(object.getElementsByTagName('*')).filter(e=>e.localName==='codeSnippet')){
    const raw=attr(snippet,'uri')||'',h=hashParts(raw),start=h.start||{line:0,column:0};let uri=raw.split('#')[0].split('?')[0],line=start.line;
    if(h.type&&h.name){const key=uri+'|'+h.type+'|'+h.name;
     if(!fragments.has(key)){const answer=await read('/sap/bc/adt/urifragmentmappings?uri='+encodeURIComponent(uri+'#type='+h.type+';name='+h.name));
      const m=/([^#]*)#start=(\d+),(\d+)/.exec(answer);if(!m)throw new Error('SAP could not place '+h.name+' in '+uri+'.');fragments.set(key,{uri:m[1],line:Number(m[2])});}
     const f=fragments.get(key);uri=f.uri;line=f.line+start.line-1;}
    places.push({object:objectId,uri,line,column:start.column});
   }
  }
  return places;
 }
 const bundle=/*FRONTEND_BUNDLE*/;
 const worker=new Worker(URL.createObjectURL(new Blob(['var window=self;\n',bundle,`\nconst pending=new Map();let serial=0;const host=(op,args)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});postMessage({host:id,op,args});});const api={analysisReader:()=>args=>host('source',args),sourceAt:path=>host('read',path),packageObjects:name=>host('package',name),query:(sql,rows)=>host('query',{sql,rows}),language:()=>host('language'),revisions:(url,include)=>host('revisions',{url,include}),revisionSource:uri=>host('read',String(uri).split('?')[0]),currentSource:(url,include)=>host('read',url+(include&&include!=='main'?'/includes/'+include:'/source/main')+'?version=active'),user:()=>host('user'),diffLines:(old,fresh,ignore)=>host('diff',{old,fresh,ignore}),storeReview:(t,r,e,body)=>host('store',{path:'/sap/bc/adt/vertex/store/'+encodeURIComponent(t)+'?remote='+encodeURIComponent(r||'')+'&expect='+encodeURIComponent(e||''),body}),whereUsed:(uri,line,column)=>host('whereused',{uri,line,column}),askBreakpoint:points=>host('askbp',points),reviewIo:async()=>{const s=await host('reviewio'),can=await host('canstore'),name=(t,r)=>t+(r?'__'+r:'');return {mode:can?s.wanted:'file',wanted:s.wanted,canStore:can,where:(t,r)=>s.dir+'/'+name(t,r).split('/').join('_')+'.json',read:async(t,r)=>(await host('fileread',name(t,r)))||null,write:(t,r,text)=>host('filewrite',{name:name(t,r),text})};}};onmessage=async({data})=>{if(data.reply){const p=pending.get(data.reply);pending.delete(data.reply);if(p)data.error?p.reject(new Error(data.error)):p.resolve(data.value);return;}try{const value=data.debug?await vertexDebugAnalysis.request(api,data.debug,text=>postMessage({progress:data.id,text})):data.body!=null?await vertexFrontend.write(api,data.path,data.body):await vertexFrontend.request(api,data.path,text=>postMessage({progress:data.id,text}));postMessage({id:data.id,value});}catch(e){postMessage({id:data.id,error:e.message});}};`],{type:'text/javascript'})));
 const requests=new Map();let requestId=0;
 worker.onmessage=async({data})=>{
  if(data.host){try{let value;if(data.op==='source')value=await source(data.args);else if(data.op==='read')value=await read(data.args);else if(data.op==='query')value=await preview(data.args.sql,data.args.rows);else if(data.op==='language')value=await read('language:');else if(data.op==='user')value=await read('user:');else if(data.op==='revisions')value=await revisions(data.args);else if(data.op==='diff')value=await compare(data.args);else if(data.op==='whereused')value=await whereUsed(data.args);else if(data.op==='askbp'){if(typeof window.vertexAskBreakpoint!=='function')throw new Error('This window cannot ask about a breakpoint.');value=await window.vertexAskBreakpoint(data.args);}else if(data.op==='reviewio')value=JSON.parse(await read('reviewio:'));else if(data.op==='canstore')value=await canStore();else if(data.op==='fileread')value=await read('reviewfile:'+data.args);else if(data.op==='filewrite')value=await save('file',data.args.name,data.args.text);else if(data.op==='store')value=await save('store',data.args.path,data.args.body);else{const doc=xml(await read('package:'+data.args));value=Array.from(doc.getElementsByTagName('item')).map(el=>({object_name:el.getElementsByTagName('OBJECT_NAME')[0]?.textContent,object_type:el.getElementsByTagName('OBJECT_TYPE')[0]?.textContent.split('/')[0]})).filter(o=>['CLAS','INTF'].includes(o.object_type));if(value.length>100)throw new Error('Package contains more than 100 classes/interfaces; select a smaller package.');}worker.postMessage({reply:data.host,value});}catch(e){worker.postMessage({reply:data.host,error:e.message});}return;}
  const item=requests.get(data.id||data.progress);if(!item)return;if(data.progress){if(item.progress)item.progress(data.text);return;}requests.delete(data.id);data.error?item.reject(new Error(data.error)):item.resolve(data.value);
 };
 worker.onerror=event=>{for(const item of requests.values())item.reject(new Error(event.message||'ABAP analysis worker stopped.'));requests.clear();};
 window.sdeFrontendAnalysis=()=>true;
 window.vertexEclipseRequest=(path,progress,body)=>new Promise((resolve,reject)=>{const id=++requestId;requests.set(id,{resolve,reject,progress});worker.postMessage({id,path,body:body==null?null:String(body)});});
 window.vertexEclipseDebugAnalysis=(debug,progress)=>new Promise((resolve,reject)=>{const id=++requestId;requests.set(id,{resolve,reject,progress});worker.postMessage({id,debug});});
 addEventListener('unload',()=>worker.terminate());
}
