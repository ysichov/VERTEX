"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const number=value=>value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))?Number(value):null;
function normalize(usage={}) {
 const cacheRead=number(usage.cache_read_input_tokens??usage.prompt_tokens_details?.cached_tokens??usage.cached_input_tokens)||0,cacheWrite=number(usage.cache_creation_input_tokens)||0;
 return {input:usage.prompt_tokens!=null?Math.max(0,(number(usage.prompt_tokens)||0)-cacheRead-cacheWrite):Math.max(0,(number(usage.input_tokens)||0)-(usage.cached_input_tokens!=null?cacheRead:0)),output:number(usage.output_tokens??usage.completion_tokens)||0,cacheRead,cacheWrite,cost:number(usage.cost_usd??usage.gateway_cost??usage.cost)};
}
function readUsage(root){
 root=require("./session-log").resolveRoot(root);
 const folder=root?path.join(root,"claude_compatible"):"",records=new Map();
 if(!folder||!fs.existsSync(folder))return {configured:!!root,folder,rows:[],errors:[]};
 const errors=[];
 for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  if(!entry.isFile()||!entry.name.endsWith(".jsonl"))continue;
  const provider=entry.name.replace(/_\d{8}_\d{6}(?:_[0-9a-f]+)?\.jsonl$/i,"");
  let text;try{text=fs.readFileSync(path.join(folder,entry.name),"utf8");}catch(error){errors.push(entry.name+": "+error.message);continue;}
  const seen=new Set();let pending=null,sequence=0,hadResponses=false,pendingNative=false;const turnResponses=new Set();
  for(const line of text.split(/\r?\n/)){
   if(!line.trim())continue;let record;try{record=JSON.parse(line);}catch(_){continue;}
   const time=Date.parse(record.timestamp||""),operation=record.vertex_operation||"Chat";
   if(record.type==="user"&&typeof record.message?.content==="string"){hadResponses=false;pendingNative=false;pending=null;turnResponses.clear();}
   if(record.type==="vertex_provider_response"&&(record.scope==="network_retry"||record.scope==="request_error"&&(!hadResponses||record.response?.model_step>turnResponses.size))){
    const r=record.response||{},source=record.provider||provider,key=source+":"+entry.name+":failure:"+(++sequence);
    records.set(key,{id:key,provider:source,model:r.model||"Unknown model",time:Number.isFinite(time)?time:null,operation,input:0,output:0,cacheRead:0,cacheWrite:0,cost:null});pending=key;continue;
   }
   if(record.type==="vertex_provider_response"&&record.scope==="cli_run"){
    if(hadResponses){pendingNative=true;continue;}
    const r=record.response||{},source=record.provider||provider,models=r.modelUsage&&typeof r.modelUsage==="object"?Object.entries(r.modelUsage):[];
    if(models.length){
     for(const [model,u] of models){const key=source+":"+entry.name+":cli:"+(++sequence);records.set(key,{id:key,provider:source,model,time:Number.isFinite(time)?time:null,operation,...normalize({input_tokens:u.inputTokens,output_tokens:u.outputTokens,cache_read_input_tokens:u.cacheReadInputTokens,cache_creation_input_tokens:u.cacheCreationInputTokens}),cost:source==="codemie"?number(u.costUSD):null});}
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
   records.set(key,{id:key,provider:previous?.provider||provider,operation:previous?.operation||operation,model:message.model||previous?.model||"Unknown model",time:previous?.time??(Number.isFinite(time)?time:null),...usage,cost:usage.cost??previous?.cost??null});pending=null;
  }
 }
 return {configured:true,folder,rows:[...records.values()],errors};
}
function aggregate(rows,filter={}){
 const day=value=>{const d=new Date(value),p=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());};
 const empty=()=>({calls:0,input:0,output:0,cacheRead:0,cacheWrite:0,cost:0,known:0,missing:0});
 const add=(into,row)=>{into.calls++;for(const key of ["input","output","cacheRead","cacheWrite"])into[key]+=row[key]||0;if(row.cost===null||row.cost===undefined){into.missing++;}else{into.cost+=row.cost;into.known++;}};
 const total=empty(),providers=new Map(),models=new Map(),activities=new Map();
 for(const row of rows){const date=row.time==null?"":day(row.time);if(filter.from&&(!date||date<filter.from)||filter.to&&(!date||date>filter.to)||filter.provider&&row.provider!==filter.provider||filter.operation&&(row.operation||"Chat")!==filter.operation)continue;
  const activity=row.operation||"Chat";if(!activities.has(activity))activities.set(activity,{provider:activity,...empty()});add(activities.get(activity),row);
  add(total,row);if(!providers.has(row.provider))providers.set(row.provider,{provider:row.provider,...empty()});add(providers.get(row.provider),row);
  const key=JSON.stringify([row.provider,row.model]);if(!models.has(key))models.set(key,{provider:row.provider,model:row.model,...empty()});add(models.get(key),row);
 }
 return {total,activities:[...activities.values()].sort((a,b)=>a.provider.localeCompare(b.provider)),providers:[...providers.values()].sort((a,b)=>a.provider.localeCompare(b.provider)),models:[...models.values()].sort((a,b)=>a.provider.localeCompare(b.provider)||b.cost-a.cost||a.model.localeCompare(b.model))};
}
let panel;
function open(vscode){
 if(panel){panel.reveal(vscode.ViewColumn.Beside,false);return panel;}
 panel=vscode.window.createWebviewPanel("vertex.usageReport","VERTEX: Usage & Cost",vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
 const nonce=crypto.randomBytes(16).toString("hex");panel.webview.html=html(nonce);
 const refresh=()=>{try{panel?.webview.postMessage({data:readUsage(vscode.workspace.getConfiguration("vertex.ai").get("logPath",""))});}catch(error){panel?.webview.postMessage({error:error.message});}};
 panel.webview.onDidReceiveMessage(async message=>{if(message?.action==="ready"||message?.action==="refresh")refresh();if(message?.action==="chooseFolder"){await require("./model-config").chooseLogFolder(vscode);refresh();}if(message?.action==="logs")await vscode.commands.executeCommand("vertex.showLogs");});panel.onDidDispose(()=>{panel=undefined;});return panel;
}
function register(vscode,context){context.subscriptions.push(vscode.commands.registerCommand("vertex.showUsage",()=>open(vscode)));}
function html(nonce){return String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'nonce-${nonce}';script-src 'nonce-${nonce}';"><style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}h1{font-size:20px}h2{font-size:16px;margin-top:22px}.bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.bar label{display:flex;align-items:center;gap:5px}input,select{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:3px 6px}input[type=text]{width:110px}button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-button-border,transparent);padding:3px 10px;cursor:pointer;font:inherit}button:hover{background:var(--vscode-button-secondaryHoverBackground)}.muted{color:var(--vscode-descriptionForeground)}#error{color:var(--vscode-errorForeground)}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{text-align:right;padding:7px 10px;border-bottom:1px solid var(--vscode-panel-border);white-space:nowrap}th{background:var(--vscode-editorWidget-background);position:sticky;top:0}th:first-child,td:first-child{text-align:left}td.model{text-align:left}#total{padding:12px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border)}
</style></head><body><h1>Usage &amp; Cost</h1><div class="bar"><button id="refresh">Refresh</button><button id="folder">Choose Folder…</button><button id="logs">Session Logs</button></div><p id="source" class="muted"></p><div class="bar"><label>From <input type="text" id="from" placeholder="dd-mm-yyyy" maxlength="10"></label><label>To <input type="text" id="to" placeholder="dd-mm-yyyy" maxlength="10"></label><label>Month <input type="month" id="month"></label><label>Provider <select id="provider"><option value="">All providers</option></select></label><label>Activity <select id="operation"><option value="">All activities</option></select></label><button id="today">Today</button><button id="all">All dates</button></div><p id="error" role="alert"></p><div id="total"></div><p class="muted">Recorded usage from local logs. USD totals include reported costs and Anthropic token costs calculated at published list prices; missing costs are shown separately. Subscription estimates are excluded.</p><h2>By activity</h2><div id="activities" class="scroll"></div><h2>By provider</h2><div id="providers" class="scroll"></div><h2>By model</h2><div id="models" class="scroll"></div><script nonce="${nonce}">
const api=acquireVsCodeApi(),$=id=>document.getElementById(id);let rows=[];
const aggregate=${aggregate.toString()};
const n=value=>Number(value||0).toLocaleString(),money=row=>row.known?'$'+row.cost.toLocaleString('en-US',{maximumSignificantDigits:21,useGrouping:false})+(row.missing?' (partial)':''):'—';
const iso=input=>{const value=input.value.trim();if(!value)return '';const m=/^(\d{2})-(\d{2})-(\d{4})$/.exec(value);if(!m)return null;const date=m[3]+'-'+m[2]+'-'+m[1],parsed=new Date(date+'T00:00:00Z');return !isNaN(parsed)&&parsed.toISOString().slice(0,10)===date?date:null;};
const display=value=>value.slice(8,10)+'-'+value.slice(5,7)+'-'+value.slice(0,4);
function table(target,data,model,firstLabel='Provider'){target.replaceChildren();const t=document.createElement('table'),head=document.createElement('tr');const labels=[firstLabel,...(model?['Model']:[]),'Records','Input','Output','Cache read','Cache write','Recorded USD','Missing cost'];labels.forEach(label=>{const th=document.createElement('th');th.textContent=label;head.appendChild(th);});t.appendChild(head);data.forEach(row=>{const tr=document.createElement('tr');[row.provider,...(model?[row.model]:[]),n(row.calls),n(row.input),n(row.output),n(row.cacheRead),n(row.cacheWrite),money(row),n(row.missing)].forEach((value,i)=>{const td=document.createElement('td');td.textContent=value;if(model&&i===1)td.className='model';tr.appendChild(td);});t.appendChild(tr);});target.appendChild(t);}
function render(){const from=iso($('from')),to=iso($('to'));if(from===null||to===null||from&&to&&from>to){$('error').textContent='Enter a valid period as dd-mm-yyyy.';return;}$('error').textContent='';const result=aggregate(rows,{from,to,provider:$('provider').value,operation:$('operation').value}),t=result.total;$('total').textContent='Total: '+n(t.input+t.output+t.cacheRead+t.cacheWrite)+' tokens · in '+n(t.input)+' · out '+n(t.output)+' · cache read '+n(t.cacheRead)+' · cache write '+n(t.cacheWrite)+' · '+money(t)+' · missing cost: '+n(t.missing);table($('activities'),result.activities,false,'Activity');table($('providers'),result.providers,false);table($('models'),result.models,true);}
['from','to','provider','operation'].forEach(id=>$(id).addEventListener('input',()=>{if(id!=='provider'&&id!=='operation')$('month').value='';render();}));$('month').onchange=()=>{if($('month').value){const [y,m]=$('month').value.split('-');$('from').value='01-'+m+'-'+y;$('to').value=new Date(Date.UTC(Number(y),Number(m),0)).getUTCDate()+'-'+m+'-'+y;}render();};$('all').onclick=()=>{$('from').value='';$('to').value='';$('month').value='';render();};$('today').onclick=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0'),date=p(d.getDate())+'-'+p(d.getMonth()+1)+'-'+d.getFullYear();$('from').value=date;$('to').value=date;$('month').value='';render();};$('refresh').onclick=()=>api.postMessage({action:'refresh'});$('folder').onclick=()=>api.postMessage({action:'chooseFolder'});$('logs').onclick=()=>api.postMessage({action:'logs'});
window.addEventListener('message',event=>{const m=event.data||{};if(m.error){$('error').textContent=m.error;return;}if(m.data){rows=m.data.rows||[];$('source').textContent=m.data.configured?rows.length+' usage records in '+m.data.folder:'Choose the AI log folder to view recorded usage.';const selected=$('provider').value;$('provider').replaceChildren(new Option('All providers',''));[...new Set(rows.map(row=>row.provider))].sort().forEach(provider=>$('provider').add(new Option(provider,provider)));$('provider').value=selected;const selectedOperation=$('operation').value;$('operation').replaceChildren(new Option('All activities',''));[...new Set(rows.map(row=>row.operation||'Chat'))].sort().forEach(value=>$('operation').add(new Option(value,value)));$('operation').value=selectedOperation;render();if(m.data.errors?.length)$('error').textContent=m.data.errors.join('\n');}});api.postMessage({action:'ready'});
</script></body></html>`;}
module.exports={readUsage,aggregate,normalize,open,register,html};
