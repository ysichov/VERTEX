"use strict";
// Port of zcl_vx_ace_code_html=>analyze/build_scheme/ops_node/flush_pending.
// The parser supplies statements and calls; diagram rules remain those of ACE.
const {conditionLabel}=require('./scheme-condition');
const {procedureEnds,isProcedureEnd,blockEnds:closers,classifyStatement}=require('./abap-control');
const {callsIn}=require('./value-origin-model');
function label(value,limit=80) {
  let s=String(value||'').replace(/\s+/g,' ').trim().replace(/"/g,"'").replace(/\|/g,'/').replace(/</g,'');
  // The code is written as it is: only what ends a quoted Mermaid label (") or an edge label (|) is replaced. A < goes
  // in as U+E000, or Mermaid takes <fs> for a tag and drops it; the page puts it back, with the > & Mermaid escapes.
  return s.length>limit?s.slice(0,limit-3)+'...':s;
}
function analyze(p) {
  let source=p.source.aceStatements.filter(s=>s.offset>=p.start&&(p.unitType==='EVENT'?s.offset<p.end:s.offset<=p.end));
  const rootAt=source.findIndex(s=>Object.hasOwn(procedureEnds,String(s.tokens[0]?.value).toUpperCase()));
  if(rootAt>=0){source=source.slice(rootAt);const close=closers[String(source[0].tokens[0].value).toUpperCase()];const endAt=source.findIndex(s=>String(s.tokens[0]?.value).toUpperCase()===close);if(endAt>=0)source=source.slice(0,endAt+1);}
  const rows=source.map((s,i)=>{const flow=classifyStatement(s,callsIn);return {line:i+1,source_line:s.line,tokens:s.tokens,text:s.text,word:flow.word,kind:'P',depth:0,end:0,all:0,call:flow.hasCalls,flow};});
  const stack=[],blocks=[];
  for(const r of rows){
    const at=stack.findIndex(o=>o.closer===r.word);
    if(at>=0){const o=stack[at];blocks.push({open:o.line,close:r.line,word:o.word});stack.splice(0,at+1);}
    if(closers[r.word])stack.unshift({...r,closer:closers[r.word]});
  }
  for(const b of blocks){rows[b.open-1].kind='O';rows[b.close-1].kind='C';for(let i=b.open;i<b.close-1;i++)rows[i].depth++;}
  for(const r of rows){
    const owner=blocks.filter(b=>b.open<r.line&&b.close>r.line).sort((a,b)=>b.open-a.open)[0]?.word;
    if(r.kind==='P'&&((['ELSE','ELSEIF'].includes(r.word)&&owner==='IF')||(r.word==='WHEN'&&owner==='CASE')||(['CATCH','CLEANUP'].includes(r.word)&&owner==='TRY'))){r.kind='B';r.depth=Math.max(0,r.depth-1);}
  }
  for(const r of rows){
    if(['O','B'].includes(r.kind)){r.end=r.line;for(const next of rows.slice(r.line)){if(next.depth<=r.depth&&['B','C'].includes(next.kind))break;r.end=next.line;}}
    if(r.kind==='O')r.all=blocks.find(b=>b.open===r.line)?.close-1||r.line;
  }
  return rows;
}
function scheme(p,expandedText='',logicOnly=false) {
  const rows=analyze(p);
  const mm=[],edges=[],clicks=[],styles=[],subs=[],conds=[],nodeRanges={},clusterRanges={},conditionCalls={};
  let prev='',prevLine=0,pendingLabel='';
  const title=(p.owner?p.owner+'=>':'')+p.name;
  const root=rows.find(r=>r.kind==='O'&&Object.hasOwn(procedureEnds,r.word))?.line||0;
  const endRow=rows.find(r=>isProcedureEnd(r.word)),endId=endRow?'n'+endRow.line:'endproc';
  const external=r=>r.flow.logic;
  /* Where the routine is left: RETURN, LEAVE PROGRAM, and an EXIT that no loop encloses. The branch ends there, marked
     as an exit; a line from it across the whole diagram to ENDMETHOD said the same thing and only crossed the rest. */
  const exits=r=>r.word==='RETURN'||(r.word==='LEAVE'&&String(r.tokens[1]?.value).toUpperCase()==='PROGRAM')
    ||(r.word==='EXIT'&&!rows.some(b=>b.kind==='O'&&['LOOP','DO','WHILE','SELECT'].includes(b.word)&&b.line<r.line&&b.all>=r.line));
  const arrow=l=>l?' -->|"'+l+'"| ':' --> ';
  const connect=(a,b,l='')=>{if(a&&typeof a==='object'){connect(a.id,b,a.label);return;}if(a&&b)edges.push(a+arrow(l)+b);};
  const click=(id,action)=>clicks.push('click '+id+' "sapevent:'+action+'" _self');
  function ops(from,to,prior,edgeLabel){
    if(!prior||from<=0||to<=from+1)return prior;
    let chain=prior;
    function append(id,text,shape='round',klass=''){
      mm.push(id+(shape==='box'?'["':'("')+label(text)+(shape==='box'?'"]':'")'));
      connect(chain,id,chain===prior?edgeLabel:'');chain=id;
      if(klass)styles.push('class '+id+' '+klass);
    }
    for(const r of rows.filter(r=>r.line>from&&r.line<to&&r.kind==='P'&&!r.flow.declaration)){
      if(!label(r.text))continue;
      if(exits(r)){append('p'+r.line,r.text,'round','exitnode');click('p'+r.line,'acego_'+r.source_line+'_'+r.source_line);return '';}
      if(logicOnly&&!external(r))continue;
      append('p'+r.line,r.text,'round',r.call?'callnode':r.flow.sideEffect?'dbnode':'');
    }
    return chain;
  }
  if(!root&&label(title)){mm.push('start(["'+label(title)+'"])');prev='start';}
  for(const r of rows){
    while(conds.length&&conds[0].close===r.line){const c=conds.shift();const tail=ops(prevLine,r.line,prev,pendingLabel);c.tails.push(tail?{id:tail,label:tail===prev?pendingLabel:''}:null);pendingLabel='';const id='j'+r.line,live=c.tails.filter(Boolean),fallthrough=c.word==='IF'&&!c.hasElse;if(live.length||fallthrough){mm.push(id+'("'+label(r.text)+'")');live.forEach(t=>connect(t,id));if(fallthrough)connect(c.header,id,'false');prev=id;}else prev='';prevLine=r.line;}
    while(subs.length&&subs[0]<r.line){mm.push('end');subs.shift();}
    if(!['O','B','S'].includes(r.kind))continue;
    const id='n'+r.line,condition=['IF','ELSEIF'].includes(r.word)?conditionLabel(r.tokens,p.owner,label):null,text=condition?condition.label:label(r.line===root?title:r.text);
    if(condition){conditionCalls[id]=condition.calls;nodeRanges[id]=[r.source_line,r.tokens.at(-1)?.line||r.source_line];}
    let loop=r.kind==='O'&&r.all>r.line&&['LOOP','DO','WHILE','TRY'].includes(r.word);
    const inner=rows.some(x=>x.line>r.line&&x.line<=r.all&&['O','B','S'].includes(x.kind));
    if(loop&&r.word==='LOOP')clusterRanges['g'+r.line]=[r.source_line,rows[r.all]?.source_line||r.source_line];
    if(loop){prev=ops(prevLine,r.line,prev,pendingLabel);pendingLabel='';prevLine=r.line;}
    if(loop&&!prev)continue;
    if(loop&&inner){mm.push('subgraph g'+r.line+'["'+text+'"]','direction LR');if(r.word==='TRY'){styles.push('class g'+r.line+' tryblk');/* A CATCH is not the next step of the TRY body: it is entered from the TRY, and the body and every handler meet at ENDTRY. */conds.unshift({close:r.all+1,depth:r.depth,word:'TRY',header:prev,seen:false,tails:[]});}subs.unshift(r.all);continue;}
    if(loop){
      mm.push('subgraph g'+r.line+'["'+text+'"]','direction LR');let chain='',first='';
      for(const x of rows.filter(x=>x.line>r.line&&x.line<=r.all&&x.kind==='P'&&!x.flow.declaration)){if(!label(x.text)||logicOnly&&!external(x)&&!exits(x))continue;const xid='p'+x.line;mm.push(xid+'("'+label(x.text)+'")');connect(chain,xid);if(!first)first=xid;chain=xid;if(exits(x)){styles.push('class '+xid+' exitnode');chain='';break;}}
      mm.push('end');connect(prev,first,pendingLabel);pendingLabel='';if(first){prev=chain;prevLine=r.all;}continue;
    }
    const branch=conds[0];
    if(r.kind==='B'&&branch&&branch.depth===r.depth){const tail=ops(prevLine,r.line,prev,pendingLabel);
      if(branch.word==='CASE'&&!branch.seen){if(tail!==branch.header)branch.header=tail;}else if(tail&&(branch.word==='IF'||branch.word==='TRY'||tail!==branch.header))branch.tails.push({id:tail,label:tail===prev?pendingLabel:''});
      if(branch.word==='TRY'){mm.push(id+'("'+text+'")');connect(branch.header,id);click(id,'acego_'+r.source_line+'_'+r.source_line);branch.seen=true;pendingLabel='';prev=id;prevLine=r.line;continue;}
      if(branch.word==='IF'){
        if(r.word==='ELSEIF'){
          mm.push(id+'{"'+text+'"}');connect(branch.header,id,'false');click(id,'acego_'+r.source_line+'_'+r.source_line);
          branch.header=id;pendingLabel='true';
        }else{branch.hasElse=true;pendingLabel='false';}
        branch.seen=true;prev=branch.header;prevLine=r.line;continue;
      }
      branch.seen=true;pendingLabel=text;prev=branch.header;prevLine=r.line;continue;
    }
    if(!prev&&r.line!==root&&root)continue;
    const after=prev?ops(prevLine,r.line,prev,pendingLabel):'';
    if(prev&&!after){prev='';prevLine=r.line;continue;}
    const shape=['IF','CASE'].includes(r.word)?'{"'+text+'"}':['LOOP','DO','WHILE'].includes(r.word)?'[/"'+text+'"/]':Object.hasOwn(procedureEnds,r.word)?'[["'+text+'"]]':'("'+text+'")';
    mm.push(id+shape);
    click(id,'acego_'+r.source_line+'_'+(rows[Math.max(r.all,r.end,r.line)-1]?.source_line||r.source_line));
    if(prev){connect(after,id,after===prev?pendingLabel:'');pendingLabel='';}
    if(r.kind==='O'&&r.all>r.line&&['IF','CASE'].includes(r.word))conds.unshift({close:r.all+1,depth:r.depth,word:r.word,header:id,seen:false,tails:[]});
    prev=id;prevLine=r.line;if(r.word==='IF')pendingLabel='true';
  }
  while(subs.length){mm.push('end');subs.shift();}
  const last=rows.at(-1);if(last&&prev){const tail=ops(prevLine,endRow?last.line:last.line+1,prev,pendingLabel);if(endRow)connect(tail,endId);}
  if(endRow){mm.push(endId+'(["'+endRow.word+'"])');click(endId,'acego_'+endRow.source_line+'_'+endRow.source_line);}
  return {conditionCalls,clusterRanges,nodeRanges,nodeLines:Object.fromEntries(rows.flatMap(r=>['n','p','o'].map(prefix=>[prefix+r.line,r.source_line]))),mermaid:'flowchart LR\n'+[...mm,'classDef tryblk fill:#eaf6ea,stroke:#2e7d32,color:#000','classDef default color:#12369e','classDef callnode fill:#fbeeee,stroke:#800000,color:#800000','classDef dbnode fill:#e8f2f6,stroke:#1f6f8b,color:#0f5468',...styles,...edges,...clicks].join('\n'),steps:mm.length,line_from:rows[0]?.source_line||p.line,line_to:last?.source_line||p.line};
}
module.exports={scheme,analyze,label};
