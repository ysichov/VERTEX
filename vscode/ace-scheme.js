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
function scheme(p,expandedText='',logicOnly=false,maxDepth=0) {
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
  /* Every node standing for one line of code leads to it - a plain operation, CONTINUE, ENDIF - unless it already has its own click. */
  const lineOf=id=>rows[Number(id.slice(1))-1]?.source_line;
  const toCode=id=>{if(!clicks.some(c=>c.startsWith('click '+id+' '))&&lineOf(id))click(id,'acego_'+lineOf(id)+'_'+lineOf(id));};
  /* Logic only: the operations it leaves out between two shown steps stand as one block saying how many, opened
     by a click (its first line goes into EXPANDED); the page sends a click on an opened operation to its source. */
  const opened=new Set(String(expandedText||'').split(',').filter(Boolean).map(Number));
  /* Depth (folds): a block whose inside lies deeper than maxDepth keeps its opening and its closing statement, and what is
     inside is one node saying how many operations it hides, opened in place by a click like a folded run of operations
     (the opening's line goes into EXPANDED). 0 draws every level. */
  const collapsed=new Map(),shown=x=>{x.kind='P';x.flow={...x.flow,logic:true,declaration:false};};
  for(const {open,inner,count} of folds(rows,maxDepth,opened)){
    for(const x of inner){x.kind='X';x.hidden=true;}
    // The block becomes three plain steps: its opening, the fold, its closing statement.
    shown(open);const end=rows[open.all];if(end&&end.line===open.all+1){end.hidden=true;shown(end);}
    if(inner.length){const fold=inner[0];fold.text='('+count+(count===1?' operation':' operations')+' hidden)';shown(fold);collapsed.set(fold.line,open.line);}
  }
  function folded(run,emit){
    if(!run.length)return;
    const first=run[0].line;
    if(opened.has(first)){run.forEach(x=>{emit('p'+x.line,x.text,x.call?'callnode':x.flow.sideEffect?'dbnode':'');click('p'+x.line,'aceexp_'+first);});return;}
    // One operation folded would take a box anyway: it is shown as itself, and only two or more fold.
    if(run.length===1){const x=run[0];emit('p'+x.line,x.text,x.call?'callnode':x.flow.sideEffect?'dbnode':'');return;}
    emit('o'+first,run.length+' operations','foldnode');click('o'+first,'aceexp_'+first);
  }
  function ops(from,to,prior,edgeLabel){
    lastExit='';
    if(!prior||from<=0||to<=from+1)return prior;
    let chain=prior;
    function append(id,text,shape='round',klass=''){
      mm.push(id+(shape==='box'?'["':'("')+label(text)+(shape==='box'?'"]':'")'));
      connect(chain,id,chain===prior?edgeLabel:'');chain=id;
      if(klass)styles.push('class '+id+' '+klass);
    }
    let run=[];
    const flush=()=>{folded(run,(id,text,klass)=>append(id,text,'round',klass));run=[];};
    for(const r of rows.filter(r=>r.line>from&&r.line<to&&r.kind==='P'&&!r.flow.declaration)){
      if(!label(r.text))continue;
      if(exits(r)){flush();append('p'+r.line,r.text,'round','exitnode');click('p'+r.line,'acego_'+r.source_line+'_'+r.source_line);lastExit='p'+r.line;return '';}
      if(logicOnly&&!external(r)){run.push(r);continue;}
      flush();
      append('p'+r.line,r.text,'round',r.call?'callnode':r.flow.sideEffect?'dbnode':'');
    }
    flush();
    return chain;
  }
  let lastExit='';
  if(!root&&label(title)){mm.push('start(["'+label(title)+'"])');prev='start';}
  for(const r of rows){
    while(conds.length&&conds[0].close===r.line){const c=conds.shift();const tail=ops(prevLine,r.line,prev,pendingLabel);c.tails.push(tail?{id:tail,label:tail===prev?pendingLabel:''}:null);if(c.word==='IF'&&!tail&&lastExit)c.exitTails.push(lastExit);pendingLabel='';const id='j'+r.line,live=c.tails.filter(Boolean),fallthrough=c.word==='IF'&&!c.hasElse;if(live.length||fallthrough||c.exitTails.length){mm.push(id+'("'+label(r.text)+'")');live.forEach(t=>connect(t,id));/* Draw the structural ENDIF after every branch so the following diagram stays centred; RETURN still ends execution. */c.exitTails.forEach(exit=>connect(exit,id));if(fallthrough)connect(c.header,id,'false');prev=live.length||fallthrough?id:'';}else prev='';prevLine=r.line;}
    while(subs.length&&subs[0]<r.line){mm.push('end');subs.shift();}
    if(!['O','B','S'].includes(r.kind))continue;
    const id='n'+r.line,condition=['IF','ELSEIF'].includes(r.word)?conditionLabel(r.tokens,p.owner,label):null,text=condition?condition.label:label(r.line===root?title:r.text);
    if(condition){conditionCalls[id]=condition.calls;nodeRanges[id]=[r.source_line,r.tokens.at(-1)?.line||r.source_line];}
    let loop=r.kind==='O'&&r.all>r.line&&['LOOP','DO','WHILE','TRY'].includes(r.word);
    const inner=rows.some(x=>x.line>r.line&&x.line<=r.all&&['O','B','S'].includes(x.kind));
    if(loop&&r.word==='LOOP')clusterRanges['g'+r.line]=[r.source_line,rows[r.all]?.source_line||r.source_line];
    if(loop){prev=ops(prevLine,r.line,prev,pendingLabel);pendingLabel='';prevLine=r.line;}
    if(loop&&!prev)continue;
    if(loop&&inner){mm.push('subgraph g'+r.line+'["'+text+'"]','direction LR');if(r.word==='TRY'){styles.push('class g'+r.line+' tryblk');/* A CATCH is not the next step of the TRY body: it is entered from the TRY, and the body and every handler meet at ENDTRY. */conds.unshift({close:r.all+1,depth:r.depth,word:'TRY',header:prev,seen:false,tails:[],exitTails:[]});}subs.unshift(r.all);continue;}
    if(loop){
      mm.push('subgraph g'+r.line+'["'+text+'"]','direction LR');let chain='',first='';
      let run=[];
      const put=(xid,text,klass)=>{mm.push(xid+'("'+label(text)+'")');connect(chain,xid);if(!first)first=xid;chain=xid;if(klass)styles.push('class '+xid+' '+klass);};
      const flush=()=>{folded(run,put);run=[];};
      for(const x of rows.filter(x=>x.line>r.line&&x.line<=r.all&&x.kind==='P'&&!x.flow.declaration)){if(!label(x.text))continue;if(logicOnly&&!external(x)&&!exits(x)){run.push(x);continue;}flush();put('p'+x.line,x.text,'');if(exits(x)){styles.push('class p'+x.line+' exitnode');chain='';break;}}
      flush();
      mm.push('end');connect(prev,first,pendingLabel);pendingLabel='';if(first){prev=chain;prevLine=r.all;}continue;
    }
    const branch=conds[0];
    if(r.kind==='B'&&branch&&branch.depth===r.depth){const tail=ops(prevLine,r.line,prev,pendingLabel);if(branch.word==='IF'&&!tail&&lastExit)branch.exitTails.push(lastExit);
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
    if(r.kind==='O'&&r.all>r.line&&['IF','CASE'].includes(r.word))conds.unshift({close:r.all+1,depth:r.depth,word:r.word,header:id,seen:false,tails:[],exitTails:[]});
    prev=id;prevLine=r.line;if(r.word==='IF')pendingLabel='true';
  }
  while(subs.length){mm.push('end');subs.shift();}
  const last=rows.at(-1);if(last&&prev){const tail=ops(prevLine,endRow?last.line:last.line+1,prev,pendingLabel);if(endRow)connect(tail,endId);}
  if(endRow){mm.push(endId+'(["'+endRow.word+'"])');click(endId,'acego_'+endRow.source_line+'_'+endRow.source_line);}
  collapsed.forEach((block,line)=>{if(mm.some(m=>m.startsWith('p'+line+'('))){styles.push('class p'+line+' foldnode');click('p'+line,'aceexp_'+block);}});
  // Last, so a node's own click (an exit, an opened operation's aceexp) stays the one it has.
  mm.forEach(line=>{const id=line.split('(')[0];if(/^[pj]\d+$/.test(id))toCode(id);});
  return {conditionCalls,clusterRanges,nodeRanges,nodeLines:Object.fromEntries(rows.flatMap(r=>['n','p','o','j'].map(prefix=>[prefix+r.line,r.source_line]))),mermaid:'flowchart LR\n'+[...mm,'classDef tryblk fill:#eaf6ea,stroke:#2e7d32,color:#000','classDef default color:#12369e','classDef callnode fill:#fbeeee,stroke:#800000,color:#800000','classDef dbnode fill:#e8f2f6,stroke:#1f6f8b,color:#0f5468','classDef foldnode stroke-dasharray:4 3',...styles,...edges,...clicks].join('\n'),steps:mm.length,line_from:rows[0]?.source_line||p.line,line_to:last?.source_line||p.line};
}
/* The blocks Depth folds, outermost first, none inside another. Depth counts the levels inside the routine that are shown:
   1 the statements right in it (an IF and its ENDIF, not its inside), 2 the inside of those blocks too, and so on - so a
   block folds when its inside would be deeper than maxDepth. Each: { open, inner (rows up to its closing one), count }. */
function folds(rows,maxDepth,opened){
  if(!(maxDepth>0))return [];
  const root=rows.some(r=>r.kind==='O'&&Object.hasOwn(procedureEnds,r.word));
  const result=[],taken=new Set(),levelOf=r=>r.depth-(root?1:0)+1;
  for(const r of rows){
    if(r.kind!=='O'||Object.hasOwn(procedureEnds,r.word)||taken.has(r.line)||levelOf(r)<maxDepth||opened.has(r.line))continue;
    const inner=rows.filter(x=>x.line>r.line&&x.line<=r.all);
    inner.forEach(x=>taken.add(x.line));
    result.push({open:r,inner,count:inner.filter(x=>!['C','B'].includes(x.kind)).length});
  }
  return result;
}
/* Logic's Code view: the routine's source lines as they are written, with the same depth folding as the diagram - a block
   nested deeper than maxDepth keeps its opening and closing statement, and the lines between are one fold that says how
   many operations it hides, opened by its key (the opening's row, as EXPANDED names it). Items: { line, text } or
   { fold, count, line, to } (the hidden lines). */
function codeView(p,expandedText='',maxDepth=0){
  const rows=analyze(p),opened=new Set(String(expandedText||'').split(',').filter(Boolean).map(Number));
  const lastLine=r=>r.tokens.at(-1)?.line||r.source_line;
  const text=String(p.source.text||'').split(/\r?\n/),first=rows[0]?.source_line||1,last=rows.length?lastLine(rows.at(-1)):first;
  // A fold runs to the line before the block's closing statement: a comment there is inside the block and hidden with it.
  const ranges=folds(rows,maxDepth,opened).map(({open,inner,count})=>{const close=rows[open.all];
    return {from:lastLine(open)+1,to:close&&close.line===open.all+1?close.source_line-1:(inner.length?Math.max(...inner.map(lastLine)):lastLine(open)),fold:open.line,count};}).filter(f=>f.to>=f.from&&f.count>0);
  /* Opened a step at a time: a block that Depth folds and the reader opened shows its branches - WHEN, ELSEIF, ELSE,
     CATCH, CLEANUP - each with its own inside folded, opened in turn. The inside before the first branch is keyed by
     the opening's row negated, a branch's by its row. A block without branches opens to its inside at once. */
  // closes: the line that opened a block or a branch, and the keys that fold it again (a double-click on it).
  const closes=new Map();
  if(maxDepth>0){
    const routine=rows.some(r=>r.kind==='O'&&Object.hasOwn(procedureEnds,r.word)),levelOf=r=>r.depth-(routine?1:0)+1;
    for(const r of rows){
      if(r.kind!=='O'||Object.hasOwn(procedureEnds,r.word)||levelOf(r)<maxDepth||!opened.has(r.line))continue;
      closes.set(r.source_line,[r.line,-r.line]);
      const heads=[r,...rows.filter(x=>x.kind==='B'&&x.depth===r.depth&&x.line>r.line&&x.line<=r.all)];
      heads.slice(1).forEach(head=>{if(opened.has(head.line))closes.set(head.source_line,[head.line]);});
      if(heads.length<2)continue;
      const close=rows[r.all];
      heads.forEach((head,at)=>{
        const key=at?head.line:-r.line,next=heads[at+1];
        if(opened.has(key))return;
        const from=lastLine(head)+1,to=(next?next.source_line:close&&close.line===r.all+1?close.source_line:last+1)-1;
        const end=next?next.line:r.all+1,count=rows.filter(x=>x.line>head.line&&x.line<end&&!['C','B'].includes(x.kind)).length;
        // Nothing but comments inside: shown as they are, a fold of no operations would only hide them.
        if(to>=from&&count>0)ranges.push({from,to,fold:key,count});
      });
    }
  }
  // The parser's colouring of the tokens (value-origin-linter lexColors), by line: a line becomes its pieces, each a
  // stretch of text and the kind of token it is, '' for what is left plain.
  const painted=new Map();
  for(const c of p.source.lexColors||[])if(c.line>=first&&c.line<=last){if(!painted.has(c.line))painted.set(c.line,[]);painted.get(c.line).push(c);}
  const parts=(line,marks)=>{const out=[];let at=0;
    for(const m of [...marks].sort((a,b)=>a.col-b.col)){if(m.col<at)continue;if(m.col>at)out.push({t:line.slice(at,m.col),k:''});out.push({t:line.slice(m.col,m.col+m.len),k:m.kind});at=m.col+m.len;}
    if(at<line.length)out.push({t:line.slice(at),k:''});return out;};
  const items=[];
  for(let n=first;n<=last;n++){
    const fold=ranges.find(f=>f.from===n);
    if(fold){items.push({fold:fold.fold,count:fold.count,line:n,to:fold.to});n=fold.to;continue;}
    items.push({line:n,text:text[n-1]??'',...(painted.has(n)?{parts:parts(text[n-1]??'',painted.get(n))}:{}),...(closes.has(n)?{closes:closes.get(n)}:{})});
  }
  return items;
}
module.exports={scheme,analyze,label,codeView};
