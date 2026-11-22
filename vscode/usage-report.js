"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const fileUsageCache=new Map();
function dateKey(time){const d=new Date(time),p=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());}
function fileNameDate(name){const m=/_(\d{4})(\d{2})(\d{2})_\d{6}(?:_[\w.-]+)?\.jsonl$/i.exec(name);return m?m[1]+"-"+m[2]+"-"+m[3]:"";}
function inRange(name,stat,filter={},currentNames){
 const valid=value=>typeof value==="string"&&/^\d{4}-\d\d-\d\d$/.test(value)?value:"",from=valid(filter.from),to=valid(filter.to);
 if(!from&&!to)return true;
 const today=dateKey(Date.now());if(currentNames?.has(name)&&(!from||today>=from)&&(!to||today<=to))return true;
 const named=fileNameDate(name);if(named)return(!from||named>=from)&&(!to||named<=to);
 const dates=[stat?dateKey(stat.mtimeMs):""];
 return dates.some(date=>date&&(!from||date>=from)&&(!to||date<=to));
}
function placeKey(context){if(!context)return"";if(context.mode==="zero")return"zero";if(context.mode==="both")return"both:"+context.folder+"|"+context.system+(context.client?"/"+context.client:"");return context.mode==="folder"?"folder:"+context.folder:context.mode==="sap"?"sap:"+context.system+(context.client?"/"+context.client:""):"";}
const number=value=>value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))?Number(value):null;
function costKind(operation,provider,model) {
 return provider==="typesafe-api"||/\bJev\b/i.test(operation||"")||/^(?:jev-|gemini-decision)/i.test(model||"")?"jev":"model";
}
// Native CodeMie exposes list-price estimates, not the service's project spending.
function cliEstimates(provider, response = {}) {
 if(provider!=="codemie")return [];
 const valid=v=>number(v)!==null&&number(v)>=0;
 const models=Object.entries(response.modelUsage||{}),total=number(response.total_cost_usd);
 const listed=models.filter(([,u])=>valid(u.costUSD)).map(([model,u])=>({model,canonicalModel:u.canonicalModel||model.replace(/\[1m\]$/, ""),cost:Number(u.costUSD)}));
 if(valid(total)&&(!listed.length||listed.length!==models.length||Math.abs(listed.reduce((s,r)=>s+r.cost,0)-total)>1e-8))return [{model:"CLI run (all models)",cost:total,unallocated:true}];
 return listed;
}
function normalize(usage={}) {
 const estimated=number(usage.cost_usd??usage.gateway_cost??usage.cost)===null&&number(usage.estimated_cost_usd)!==null;
 const cacheRead=number(usage.cache_read_input_tokens??usage.prompt_tokens_details?.cached_tokens??usage.cached_input_tokens)||0,cacheWrite=number(usage.cache_creation_input_tokens)||0;
 return {input:usage.prompt_tokens!=null?Math.max(0,(number(usage.prompt_tokens)||0)-cacheRead-cacheWrite):Math.max(0,(number(usage.input_tokens??usage.total_input_tokens)||0)-(usage.cached_input_tokens!=null?cacheRead:0)),output:number(usage.output_tokens??usage.completion_tokens??usage.total_output_tokens)||0,cacheRead,cacheWrite,cost:number(usage.cost_usd??usage.gateway_cost??usage.cost??usage.estimated_cost_usd),...(estimated?{estimated:true}:{})};
}
function readUsage(root,filter={}){
 root=require("./session-log").resolveRoot(root);
 const folder=root?path.join(root,"claude_compatible"):"";
 if(!folder||!fs.existsSync(folder))return {configured:!!root,folder,rows:[],errors:[]};
 const cacheKey=path.resolve(folder),cached=fileUsageCache.get(cacheKey)||new Map(),liveFiles=new Set(),rows=new Map(),errors=[];
 const currentNames=new Set(require("./session-log").currentFiles(root).map(file=>path.basename(file))),requestedPlace=typeof filter.placeKey==="string"?filter.placeKey:"";
 for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  if(!entry.isFile()||!entry.name.endsWith(".jsonl"))continue;
  liveFiles.add(entry.name);if(fileNameDate(entry.name)&&!inRange(entry.name,null,filter,currentNames))continue;const file=path.join(folder,entry.name);let stat;
  try{stat=fs.statSync(file);}catch(error){if(error.code!=="ENOENT")errors.push(entry.name+": "+error.message);continue;}
  if(!inRange(entry.name,stat,filter,currentNames))continue;
  const signature=stat.size+":"+stat.mtimeMs+":"+stat.ctimeMs;let item=cached.get(entry.name);
  if(!item||item.signature!==signature)item={signature,context:require("./session-log").readHeader(file)?.vertex_context||null,rows:null};
  const key=placeKey(item.context);
  if(requestedPlace&&(requestedPlace==="none"?!!key:key!==requestedPlace)){cached.set(entry.name,item);continue;}
  if(!item.rows){try{item.rows=parseUsage([{name:entry.name,text:fs.readFileSync(file,"utf8")}]);cached.set(entry.name,item);}catch(error){errors.push(entry.name+": "+error.message);continue;}}
  for(const row of item.rows)rows.set(row.id,row);
 }
 for(const name of cached.keys())if(!liveFiles.has(name))cached.delete(name);fileUsageCache.set(cacheKey,cached);
 return {configured:true,folder,rows:[...rows.values()],errors};
}
// Both hosts read their own files, then use the same accounting and deduplication.
function parseUsage(files){
 const records=new Map();
 for(const entry of files){
  const provider=entry.name.replace(/_\d{8}_\d{6}(?:_[0-9a-f]+)?\.jsonl$/i,"");
  const text=entry.text;
  const seen=new Set();let pending=null,sequence=0,hadResponses=false,pendingNative=false,pendingEstimate=false;const turnResponses=new Set();
  for(const line of text.split(/\r?\n/)){
   if(!line.trim())continue;let record;try{record=JSON.parse(line);}catch(_){continue;}
   const time=Date.parse(record.timestamp||""),operation=record.vertex_operation||"Chat";
   if(record.type==="user"&&typeof record.message?.content==="string"){hadResponses=false;pendingNative=false;pendingEstimate=false;pending=null;turnResponses.clear();}
   if(record.type==="vertex_provider_response"&&(record.scope==="network_retry"||record.scope==="request_error"&&(!hadResponses||record.response?.model_step>turnResponses.size))){
    const r=record.response||{},source=record.provider||provider,key=source+":"+entry.name+":failure:"+(++sequence);
    records.set(key,{id:key,provider:source,model:r.model||"Unknown model",time:Number.isFinite(time)?time:null,operation,input:0,output:0,cacheRead:0,cacheWrite:0,cost:null});pending=key;continue;
   }
   if(record.type==="vertex_provider_response"&&record.scope==="cli_run"){
    if(hadResponses){
     const estimates=cliEstimates(record.provider||provider,record.response);
     const turn=[...turnResponses].map(key=>records.get(key)).filter(Boolean);
     for(const estimate of estimates){
      const held=estimate.unallocated?turn:turn.filter(row=>row.model===estimate.model||row.model===estimate.canonicalModel);
      if(!held.length||held.some(row=>row.cost!=null&&!row.estimated))continue;
      for(const row of held){row.cost=null;row.costCovered=true;delete row.estimated;}
      if(estimate.unallocated){const key=provider+":"+entry.name+":estimate:"+(++sequence);records.set(key,{id:key,provider:record.provider||provider,model:estimate.model,time:Number.isFinite(time)?time:null,operation,input:0,output:0,cacheRead:0,cacheWrite:0,cost:estimate.cost,estimated:true,costOnly:true});}
      else {held[0].cost=estimate.cost;held[0].estimated=true;delete held[0].costCovered;}
     }
     turnResponses.clear();pendingNative=true;continue;
    }
    const r=record.response||{},source=record.provider||provider,models=r.modelUsage&&typeof r.modelUsage==="object"?Object.entries(r.modelUsage):[];
    const unallocated=cliEstimates(source,r).find(row=>row.unallocated);
    if(unallocated){const key=source+":"+entry.name+":estimate:"+(++sequence);records.set(key,{id:key,provider:source,model:unallocated.model,time:Number.isFinite(time)?time:null,operation,input:0,output:0,cacheRead:0,cacheWrite:0,cost:unallocated.cost,estimated:true,costOnly:true});pendingEstimate=true;}
    if(models.length){
     for(const [model,u] of models){const key=source+":"+entry.name+":cli:"+(++sequence);records.set(key,{id:key,provider:source,model,time:Number.isFinite(time)?time:null,operation,...normalize({input_tokens:u.inputTokens,output_tokens:u.outputTokens,cache_read_input_tokens:u.cacheReadInputTokens,cache_creation_input_tokens:u.cacheCreationInputTokens}),cost:unallocated?null:source==="codemie"?number(u.costUSD):null,...(unallocated?{costCovered:true}:source==="codemie"&&number(u.costUSD)!==null?{estimated:true}:{})});}
     pendingNative=true;
    }continue;
   }
   if(record.type==="vertex_provider_response"&&record.scope==="model_response"){
    hadResponses=true;
    const r=record.response||{},source=record.provider||provider,id=r.id||entry.name+":provider:"+(++sequence),key=source+":"+id;
    const previous=records.get(key),usage=normalize(source==="anthropic-api"?require("./anthropic-pricing").priceUsage(r.model,r.usage):r.usage);
    records.set(key,{id:key,provider:source,operation,model:r.model||previous?.model||"Unknown model",time:Number.isFinite(time)?time:previous?.time,...usage,cost:usage.cost??previous?.cost??null});
    turnResponses.add(key);pending=key;continue;
   }
   if(record.type!=="assistant"||!record.message?.usage)continue;
   if(pendingNative){pendingNative=false;continue;}
   const message=record.message;if(message.id&&seen.has(message.id))continue;if(message.id)seen.add(message.id);
   const known=message.usage.generation_id?provider+":"+message.usage.generation_id:null;
   const matching=pending&&records.get(pending)?.model===message.model?pending:null;
   const key=known&&records.has(known)?known:matching||provider+":"+entry.name+":"+(message.id||++sequence);
   const previous=records.get(key),usage=normalize(provider==="anthropic-api"?require("./anthropic-pricing").priceUsage(message.model,message.usage):message.usage);
   if(previous&&!usage.input&&!usage.output&&!usage.cacheRead&&!usage.cacheWrite)for(const field of ["input","output","cacheRead","cacheWrite"])usage[field]=previous[field];
   records.set(key,{id:key,provider:previous?.provider||provider,operation:previous?.operation||operation,model:message.model||previous?.model||"Unknown model",time:previous?.time??(Number.isFinite(time)?time:null),...usage,cost:usage.cost??previous?.cost??null,...((usage.cost!=null?usage.estimated:previous?.estimated)?{estimated:true}:{}),...((previous?.costCovered||pendingEstimate)&&usage.cost==null?{costCovered:true}:{})});pending=null;pendingEstimate=false;
  }
 }
 return [...records.values()].map(row=>({...row,costKind:costKind(row.operation,row.provider,row.model)}));
}
function aggregate(rows,filter={}){
 const day=value=>{const d=new Date(value),p=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());};
 const empty=()=>({calls:0,input:0,output:0,cacheRead:0,cacheWrite:0,cost:0,known:0,missing:0,estimated:0});
 const add=(into,row)=>{if(!row.costOnly)into.calls++;for(const key of ["input","output","cacheRead","cacheWrite"])into[key]+=row[key]||0;if(row.cost===null||row.cost===undefined){if(!row.costCovered)into.missing++;}else{into.cost+=row.cost;into.known++;if(row.estimated)into.estimated++;}};
 const total=empty(),costs={model:empty(),jev:empty()},providers=new Map(),models=new Map(),activities=new Map(),activitiesByKind={model:new Map(),jev:new Map()};
 for(const row of rows){const date=row.time==null?"":day(row.time);if(filter.from&&(!date||date<filter.from)||filter.to&&(!date||date>filter.to)||filter.provider&&row.provider!==filter.provider||filter.operation&&(row.operation||"Chat")!==filter.operation)continue;
  const activity=row.operation||"Chat",kind=row.costKind||costKind(row.operation,row.provider,row.model);if(!activities.has(activity))activities.set(activity,{provider:activity,...empty()});add(activities.get(activity),row);
  const kindActivities=activitiesByKind[kind];if(!kindActivities.has(activity))kindActivities.set(activity,{provider:activity,...empty()});add(kindActivities.get(activity),row);
  add(total,row);add(costs[kind],row);if(!providers.has(row.provider))providers.set(row.provider,{provider:row.provider,...empty()});add(providers.get(row.provider),row);
  const key=JSON.stringify([row.provider,row.model]);if(!models.has(key))models.set(key,{provider:row.provider,model:row.model,...empty()});add(models.get(key),row);
 }
 return {total,costs,activities:[...activities.values()].sort((a,b)=>a.provider.localeCompare(b.provider)),activitiesByKind:{model:[...activitiesByKind.model.values()].sort((a,b)=>a.provider.localeCompare(b.provider)),jev:[...activitiesByKind.jev.values()].sort((a,b)=>a.provider.localeCompare(b.provider))},providers:[...providers.values()].sort((a,b)=>a.provider.localeCompare(b.provider)),models:[...models.values()].sort((a,b)=>a.provider.localeCompare(b.provider)||b.cost-a.cost||a.model.localeCompare(b.model))};
}
function open(vscode){return vscode.commands.executeCommand("vertex.showLogs");}
function register(vscode,context){context.subscriptions.push(vscode.commands.registerCommand("vertex.showUsage",()=>open(vscode)));}
// The same report renderer is used by the unified page in both hosts.
function renderUsage(root,rows,range,aggregate){
 const selected=root.usageFilters||(root.usageFilters={provider:"",operation:""});
 root.replaceChildren();
 const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const number=value=>Number(value||0).toLocaleString();
 const money=row=>row.known?(row.estimated?"≈ $":"$")+row.cost.toLocaleString("en-US",{maximumFractionDigits:6,useGrouping:false})+(row.missing?" (partial)":""):"—";
 const bar=make("div");bar.className="list-tools";
 for(const [key,label,all] of [["provider","Provider","All providers"],["operation","Activity","All activities"]]){
  const wrapper=make("label",label+" "),select=make("select");select.className="log-context";
  const option=(text,value)=>{const item=make("option",text);item.value=value;select.appendChild(item);};option(all,"");
  [...new Set(rows.map(row=>key==="operation"?row.operation||"Chat":row.provider))].sort().forEach(value=>option(value,value));
  select.value=selected[key];if(select.value!==selected[key])selected[key]="";
  select.onchange=()=>{selected[key]=select.value;renderUsage(root,rows,range,aggregate);};wrapper.appendChild(select);bar.appendChild(wrapper);
 }
 root.appendChild(bar);
 const result=aggregate(rows,{...range,...selected}),total=result.total;
 const totals=make("div");totals.className="totals";
 for(const [label,part] of [["LLM",result.costs.model],["Jev",result.costs.jev]])totals.appendChild(make("div",label+": "+number(part.input+part.output+part.cacheRead+part.cacheWrite)+" tokens · "+money(part)+" · missing cost: "+number(part.missing)));
 root.appendChild(totals);
 const note=make("p","Recorded usage from local logs. ≈ marks estimates from CodeMie CLI or Jev, not the service bill or project budget spending. Claude subscription estimates are excluded.");note.className="muted";root.appendChild(note);
 for(const [title,data,model,subtotal] of [["LLM activities",result.activitiesByKind.model,false,result.costs.model],["Jev activities",result.activitiesByKind.jev,false,result.costs.jev],["By provider",result.providers,false,total],["By model",result.models,true,total]]){
  root.appendChild(make("h2",title));const scroll=make("div"),table=make("table"),head=make("tr");scroll.className="table-scroll";
  const sorts=root.usageSort||(root.usageSort={}),sort=sorts[title]||null;
   const cols=[[title.endsWith("activities")?"Activity":"Provider",r=>r.provider],...(model?[["Model",r=>r.model]]:[]),["Records",r=>r.calls],["Input",r=>r.input],["Output",r=>r.output],["Cache read",r=>r.cacheRead],["Cache write",r=>r.cacheWrite],["Recorded USD",r=>r.known?r.cost:-1],["Missing cost",r=>r.missing]];
   cols.forEach(([label],index)=>{const active=sort&&sort.index===index,th=make("th",label+(active?(sort.desc?" ▼":" ▲"):""));th.style.cursor="pointer";th.tabIndex=0;th.title="Sort by "+label;th.setAttribute("aria-sort",active?(sort.desc?"descending":"ascending"):"none");
    const toggle=()=>{sorts[title]={index,desc:active?!sort.desc:index>=(model?2:1)};renderUsage(root,rows,range,aggregate);};
    th.onclick=toggle;th.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();toggle();}};head.appendChild(th);});table.appendChild(head);
   const shown=sort?[...data].sort((a,b)=>{const x=cols[sort.index][1](a),y=cols[sort.index][1](b),d=typeof x==="string"?x.localeCompare(String(y||"")):x-y;return sort.desc?-d:d;}):data;
  for(const row of shown){const tr=make("tr");[row.provider,...(model?[row.model]:[]),number(row.calls),number(row.input),number(row.output),number(row.cacheRead),number(row.cacheWrite),money(row),number(row.missing)].forEach((value,index)=>{const cell=make("td",value);if(index>=(model?2:1))cell.className="num";tr.appendChild(cell);});table.appendChild(tr);}
  const foot=make("tfoot"),totalRow=make("tr");totalRow.style.fontWeight="700";["Total",...(model?[""]:[]),number(subtotal.calls),number(subtotal.input),number(subtotal.output),number(subtotal.cacheRead),number(subtotal.cacheWrite),money(subtotal),number(subtotal.missing)].forEach((value,index)=>{const cell=make("td",value);if(index>=(model?2:1))cell.className="num";totalRow.appendChild(cell);});foot.appendChild(totalRow);table.appendChild(foot);scroll.appendChild(table);root.appendChild(scroll);
 }
}
function browserEngine(){return "window.vertexUsage={aggregate:"+aggregate.toString()+",renderUsage:"+renderUsage.toString()+"};const costKind="+costKind.toString()+";";}
function html(nonce){
 const shared=fs.readFileSync(path.join(__dirname,"resources","log-report.html"),"utf8");
 const dateScript=shared.match(/<script id="vertex-date-range"[^>]*>([\s\S]*?)<\/script>/)[1];
 const dateMarkup=shared.slice(shared.indexOf('<div id="date-range"'),shared.indexOf('<div id="date-error"')).trim().replace('class="list-tools"','class="bar"');
 return String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'nonce-${nonce}';script-src 'nonce-${nonce}';"><style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}h1{font-size:20px}h2{font-size:16px;margin-top:22px}.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.bar label{display:flex;align-items:center;gap:5px}input,select{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:3px 6px}input[type=text]{width:110px}button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-button-border,transparent);padding:3px 10px;cursor:pointer;font:inherit}button:hover{background:var(--vscode-button-secondaryHoverBackground)}.muted{color:var(--vscode-descriptionForeground)}#error{color:var(--vscode-errorForeground)}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:right;padding:7px 10px;border-bottom:1px solid var(--vscode-panel-border);white-space:nowrap}th{background:var(--vscode-editorWidget-background);position:sticky;top:0}th:first-child,td:first-child{text-align:left}td.model{text-align:left}#total{padding:12px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border)}
</style></head><body><h1>Usage &amp; Cost</h1><div class="bar"><button id="refresh">Refresh</button><button id="folder">Choose Folder…</button><button id="logs">Session Logs</button></div><p id="source" class="muted"></p><div class="bar"><label>Provider <select id="provider"><option value="">All providers</option></select></label><label>Activity <select id="operation"><option value="">All activities</option></select></label></div>${dateMarkup}<p id="error" role="alert"></p><div id="total"></div><p class="muted">Recorded usage from local logs. USD totals include reported costs and Anthropic token costs calculated at published list prices; missing costs are shown separately. CodeMie CLI and Jev estimates are marked ≈; these are not the service bill or project budget spending. Claude subscription estimates are excluded.</p><h2>LLM activities</h2><div id="activities" class="scroll"></div><h2>Jev activities</h2><div id="jev-activities" class="scroll"></div><h2>By provider</h2><div id="providers" class="scroll"></div><h2>By model</h2><div id="models" class="scroll"></div><script nonce="${nonce}">
const api=acquireVsCodeApi(),$=id=>document.getElementById(id);let rows=[];
const costKind=${costKind.toString()};
const aggregate=${aggregate.toString()};
const n=value=>Number(value||0).toLocaleString(),money=row=>row.known?(row.estimated?'≈ $':'$')+row.cost.toLocaleString('en-US',{maximumFractionDigits:6,useGrouping:false})+(row.missing?' (partial)':''):'—';
const iso=input=>input.value;
${dateScript}
const sorts={};
function table(target,data,model,firstLabel='Provider',totalRow){target.replaceChildren();const t=document.createElement('table'),head=document.createElement('tr'),sort=sorts[target.id]||null;const cols=[[firstLabel,r=>r.provider],...(model?[['Model',r=>r.model]]:[]),['Records',r=>r.calls],['Input',r=>r.input],['Output',r=>r.output],['Cache read',r=>r.cacheRead],['Cache write',r=>r.cacheWrite],['Recorded USD',r=>r.known?r.cost:-1],['Missing cost',r=>r.missing]];cols.forEach(([label],index)=>{const active=sort&&sort.index===index,th=document.createElement('th');th.textContent=label+(active?(sort.desc?' ▼':' ▲'):'');th.style.cursor='pointer';th.tabIndex=0;th.title='Sort by '+label;th.setAttribute('aria-sort',active?(sort.desc?'descending':'ascending'):'none');const toggle=()=>{sorts[target.id]={index,desc:active?!sort.desc:index>=(model?2:1)};render();};th.onclick=toggle;th.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}};head.appendChild(th);});t.appendChild(head);const shown=sort?[...data].sort((a,b)=>{const x=cols[sort.index][1](a),y=cols[sort.index][1](b),d=typeof x==='string'?x.localeCompare(String(y||'')):x-y;return sort.desc?-d:d;}):data;shown.forEach(row=>{const tr=document.createElement('tr');[row.provider,...(model?[row.model]:[]),n(row.calls),n(row.input),n(row.output),n(row.cacheRead),n(row.cacheWrite),money(row),n(row.missing)].forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(model&&i===1)td.className='model';tr.appendChild(td);});t.appendChild(tr);});const foot=document.createElement('tfoot'),tr=document.createElement('tr');tr.style.fontWeight='700';['Total',...(model?['']:[]),n(totalRow.calls),n(totalRow.input),n(totalRow.output),n(totalRow.cacheRead),n(totalRow.cacheWrite),money(totalRow),n(totalRow.missing)].forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(model&&i===1)td.className='model';tr.appendChild(td);});foot.appendChild(tr);t.appendChild(foot);target.appendChild(t);}
function render(){const from=iso($('from')),to=iso($('to'));if(from===null||to===null||from&&to&&from>to){$('error').textContent='From date must be on or before To date.';return;}$('error').textContent='';const result=aggregate(rows,{from,to,provider:$('provider').value,operation:$('operation').value}),t=result.total;$('total').replaceChildren();for(const [label,part] of [['LLM',result.costs.model],['Jev',result.costs.jev]]){const line=document.createElement('div');line.textContent=label+': '+n(part.input+part.output+part.cacheRead+part.cacheWrite)+' tokens · in '+n(part.input)+' · out '+n(part.output)+' · cache read '+n(part.cacheRead)+' · cache write '+n(part.cacheWrite)+' · '+money(part)+' · missing cost: '+n(part.missing);$('total').appendChild(line);}table($('activities'),result.activitiesByKind.model,false,'Activity',result.costs.model);table($('jev-activities'),result.activitiesByKind.jev,false,'Activity',result.costs.jev);table($('providers'),result.providers,false,'Provider',t);table($('models'),result.models,true,'Provider',t);}
vertexDateRange($('date-range'),render);['provider','operation'].forEach(id=>$(id).addEventListener('input',render));$('refresh').onclick=()=>api.postMessage({action:'refresh'});$('folder').onclick=()=>api.postMessage({action:'chooseFolder'});$('logs').onclick=()=>api.postMessage({action:'logs'});
window.addEventListener('message',event=>{const m=event.data||{};if(m.error){$('error').textContent=m.error;return;}if(m.data){rows=m.data.rows||[];$('source').textContent=m.data.configured?rows.length+' usage records in '+m.data.folder:'Choose the AI log folder to view recorded usage.';const selected=$('provider').value;$('provider').replaceChildren(new Option('All providers',''));[...new Set(rows.map(row=>row.provider))].sort().forEach(provider=>$('provider').add(new Option(provider,provider)));$('provider').value=selected;const selectedOperation=$('operation').value;$('operation').replaceChildren(new Option('All activities',''));[...new Set(rows.map(row=>row.operation||'Chat'))].sort().forEach(value=>$('operation').add(new Option(value,value)));$('operation').value=selectedOperation;render();if(m.data.errors?.length)$('error').textContent=m.data.errors.join('\n');}});api.postMessage({action:'ready'});
</script></body></html>`;}
module.exports={parseUsage,renderUsage,browserEngine,costKind,cliEstimates,readUsage,aggregate,normalize,open,register,html};
