"use strict";
// Shared execution-call contract for Calls, Value Origin and Visual Debug.
// Loading and rendering are host adapters; enumeration/resolution/walk are shared.
const upper=s=>String(s||'').toUpperCase();
function create(index,units=index.procedures){
 const model=require('./value-origin-model'),resolve=model.resolver(index);
 function calls(p,s){
  const found=model.callsIn(s.tokens),t=s.tokens.map(t=>upper(t.value));
  let classic;
  if(t[0]==='PERFORM'&&/^[\w/]+$/.test(t[1]||'')){const at=t.indexOf('PROGRAM');classic={method:t[1],owner:at>=0?t[at+1]:'',receiver:'',kind:'FORM'};}
  else if(t[0]==='CALL'&&t[1]==='FUNCTION'&&/^'[^']+'$/.test(t[2]||''))classic={method:t[2].slice(1,-1),owner:'',receiver:'',kind:'FUNCTION'};
  else if(t[0]==='CALL'&&t[1]==='METHOD'&&!found.length){const at=t.findIndex(v=>v==='->'||v==='=>');if(at>1)classic={method:t[at+1],owner:t[at]==='=>'?t[at-1]:'',receiver:t[at-1],arrow:t[at]};else if(/^[\w~]+$/.test(t[2]||''))classic={method:t[2],owner:'',receiver:''};}
  if(classic)found.unshift(classic);
  return found.map(call=>{
   const kind=q=>q.unitType||upper(q.source.aceStatements?.find(s=>s.offset===q.start)?.tokens[0]?.value);
   const owners=call.kind==='FORM'?[call.owner||p.source.objectName]:call.kind==='FUNCTION'?[call.method]:resolve.owners(call,p,s.offset).filter(Boolean);
   const targets=call.kind==='FORM'?units.filter(q=>kind(q)==='FORM'&&q.name===call.method&&q.source.objectName===owners[0]):call.kind==='FUNCTION'?units.filter(q=>kind(q)==='FUNCTION'&&q.name===call.method):resolve(call,p,s.offset,{}).map(q=>units.find(u=>u.id===q.id)||q);
   return {call,owners,targets};
  });
 }
 return {calls};
}
async function walk(entries,options){
 const limit=options.maxDepth??Infinity,visited=new Set(),queue=entries.map(p=>({p,depth:1,entry:true}));
 for(let at=0;at<queue.length;at++){
  if(options.cancelled?.())throw new Error('Analysis cancelled.');
  const item=queue[at],{p,depth}=item;
  if(visited.has(p.id)||depth>=limit)continue;
  visited.add(p.id);options.onLevel?.(depth);
  for(const s of p.body){
   if(options.cancelled?.())throw new Error('Analysis cancelled.');
   if(item.entry&&options.range&&(s.line<options.range.from||s.line>options.range.to))continue;
   options.onStatement?.(p,s,item);
   const records=await options.calls(p,s,depth);
   for(const record of records){
    options.onCall?.(p,s,record,item);
    if(depth+1<limit)for(const target of record.targets)if(target.source.objectType!=='INTF')queue.push({p:target,depth:depth+1,entry:false});
   }
  }
 }
 return visited;
}
module.exports={create,walk};
