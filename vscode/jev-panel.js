"use strict";
function buildQuestions(drafts) {
  if (!Array.isArray(drafts) || !drafts.length) throw new Error("Add a question.");
  const questions = {}, labels = {};
  for (const draft of drafts) {
    const instructions = String(draft.instructions || "").trim();
    if (!instructions) throw new Error("Enter the text of each question.");
    const q = {type:draft.type, instructions};
    const lines = Array.isArray(draft.criteriaEntries) ? draft.criteriaEntries.map(line=>String(line).trim()) : String(draft.criteriaText || "").split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(draft.type !== "noul" && lines.some(line=>!line))throw new Error("Fill in each answer option or scale level.");
    const choices = {};
    if (draft.type === "choice") {
      if(lines.length < 2 || lines.length > 255)throw new Error("Enter 2–255 answer options.");
      lines.forEach((line,index)=>{choices['option_'+(index+1)]=line;});q.criteria=choices;
    } else if(draft.type === "score") {
      if(lines.length < 2 || lines.length > 10)throw new Error("Enter 2–10 scale levels, lowest first.");
      q.criteria=lines;
    } else if(draft.type !== "noul") throw new Error("Select a question type.");
    questions[draft.id]=q;labels[draft.id]={instructions,type:draft.type,choices,levels:lines};
  }
  return {questions,labels};
}
const html = `<form id="jev-panel" hidden aria-label="Jev decision request">
<p class="note">Enter context and questions. Jev returns decisions and probabilities. Each Run is a separate request.</p>
<label for="jev-state">Context</label><div class="prompt-box"><button type="button" id="jev-expand-context" class="secondary" title="Expand the context field" aria-label="Expand the context field" aria-pressed="false">⤢</button><textarea id="jev-state" rows="12" aria-label="Context" placeholder="Paste the text you want to evaluate"></textarea></div>
<div id="jev-questions" aria-label="Questions"></div>
<button type="button" id="jev-add-question" class="secondary">Add question</button>
<div class="line"><button type="submit" id="jev-run">Run Jev</button><button type="button" id="jev-stop" class="secondary" hidden>Stop</button></div>
<p id="jev-status" class="note" role="status" aria-live="polite"></p>
<section id="jev-result" aria-label="Decision results" aria-live="polite"></section></form>`;
const css = `
#jev-panel[hidden]{display:none}
#jev-panel textarea{margin:4px 0 10px}
#jev-state{min-height:16em;max-height:65vh;overflow-y:auto;padding-right:34px;font-family:var(--vscode-editor-font-family,monospace)}
#jev-state.expanded{min-height:60vh;max-height:75vh}
#jev-expand-context{position:absolute;top:4px;right:4px;width:auto;margin:0;padding:0 6px;font-size:14px;line-height:20px;opacity:.75}
#jev-expand-context:hover{opacity:1}
.jev-question{border:1px solid var(--vscode-panel-border);border-radius:4px;margin:0 0 10px;padding:8px;min-width:0}
.jev-question .line{justify-content:space-between}
.jev-option{display:flex;align-items:center;gap:6px;margin:6px 0}
.jev-option label{flex:none;min-width:4.5em;opacity:.8}
.jev-option input{flex:1;min-width:0;box-sizing:border-box;padding:4px 8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);border-radius:4px;font:inherit}
.jev-option button{flex:none}
#jev-result{container-type:inline-size;container-name:jev-results}
#jev-result table{width:100%;border-collapse:collapse;table-layout:fixed}
#jev-result td,#jev-result th{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:break-word;white-space:pre-line;line-height:1.5}
#jev-result th{white-space:nowrap}
#jev-result th:first-child{width:40%}
#jev-result th:nth-child(2){width:16%}
#jev-result th:nth-child(3){width:15%}
#jev-result td::before{display:none}
@container jev-results (max-width:700px){
 #jev-result table{display:block}
 #jev-result .jev-result-head{display:none}
 #jev-result .jev-result-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;padding:12px;margin:0 0 12px;border:1px solid var(--vscode-panel-border);border-radius:4px}
 #jev-result td{display:block;min-width:0;padding:0;border:0}
 #jev-result td:first-child,#jev-result td:last-child{grid-column:1/-1}
 #jev-result td:first-child{font-weight:600}
 #jev-result td::before{display:block;content:attr(data-label);font-weight:normal;font-size:.9em;opacity:.75;margin-bottom:3px;white-space:normal}
}
body[data-decision="true"] #chat,body[data-decision="true"] #messages,body[data-decision="true"] #context-controls,body[data-decision="true"] #effort-select{display:none}
body[data-decision="true"] .dock{overflow-y:auto;max-height:100vh}
`;
const script = `
const buildJevQuestions=${buildQuestions.toString()};
let decisionRunning=false,jevNextQuestion=1,jevRestoredState=null;
let jevDrafts=[{id:'question_1',type:'noul',instructions:'Does this request need urgent attention?',criteriaText:''}];
let jevSubmittedLabels={};
function resetJevDraft(){
  jevRestoredState=null;jevSubmittedLabels={};jevNextQuestion=1;
  jevDrafts=[{id:'question_1',type:'noul',instructions:'',criteriaText:''}];
  document.getElementById('jev-state').value='';
  document.getElementById('jev-result').replaceChildren();
  document.getElementById('jev-status').textContent='';
  renderJevQuestions();
  if(document.body.dataset.decision==='true')document.getElementById('jev-state').focus();
}
function restoreJevDraft(input){
  const field=document.getElementById('jev-state');
  field.value=typeof input.state==='string'?input.state:JSON.stringify(input.state,null,2);
  jevRestoredState={text:field.value,value:input.state};
  jevDrafts=Object.entries(input.questions).map(([id,q])=>({id,type:q.type,instructions:q.instructions,criteriaText:q.type==='choice'?Object.values(q.criteria).join('\\n'):q.type==='score'?q.criteria.join('\\n'):''}));
  jevNextQuestion=Math.max(0,...jevDrafts.map(d=>Number(d.id.match(/^question_(\\d+)$/)?.[1])||0));
  renderJevQuestions();document.getElementById('jev-result').replaceChildren();
  document.getElementById('jev-status').textContent='Restored from Session Logs. Edit and Run Jev to create a new step.';
  field.focus();
}
document.getElementById('jev-expand-context').addEventListener('click',()=>{
  const field=document.getElementById('jev-state'),button=document.getElementById('jev-expand-context');
  const open=field.classList.toggle('expanded');button.setAttribute('aria-pressed',String(open));button.textContent=open?'⤡':'⤢';
  button.title=button.ariaLabel=open?'Shrink the context field':'Expand the context field';field.focus();
});
function renderJevQuestions(){
  const root=document.getElementById('jev-questions');root.replaceChildren();
  jevDrafts.forEach((draft,index)=>{
    const card=document.createElement('fieldset');card.className='jev-question';
    const legend=document.createElement('legend');legend.textContent='Question '+(index+1);card.appendChild(legend);
    const line=document.createElement('div');line.className='line';
    const type=document.createElement('select');type.setAttribute('aria-label','Question '+(index+1)+' type');
    [['noul','Yes / No'],['choice','Choose an option'],['score','Rate on a scale']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;type.appendChild(option);});type.value=draft.type;line.appendChild(type);
    const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Remove';remove.addEventListener('click',()=>{jevDrafts=jevDrafts.filter(q=>q.id!==draft.id);renderJevQuestions();});line.appendChild(remove);card.appendChild(line);
    const question=document.createElement('textarea');question.rows=2;question.value=draft.instructions;question.placeholder='What should Jev decide?';question.setAttribute('aria-label','Question '+(index+1));question.addEventListener('input',()=>{draft.instructions=question.value;});card.appendChild(question);
    const options=document.createElement('div');options.className='jev-options';
    const paint=()=>{
      options.replaceChildren();options.hidden=draft.type==='noul';if(options.hidden)return;
      if(!Array.isArray(draft.criteriaEntries)){draft.criteriaEntries=String(draft.criteriaText||'').split(/\\r?\\n/);if(draft.criteriaEntries.length<2)draft.criteriaEntries.push('');}
      const scale=draft.type==='score',limit=scale?10:255;
      const caption=document.createElement('p');caption.className='note';caption.textContent=scale?'Scale levels, lowest first. Use the arrows to change their order.':'Answer options. Each option is a separate category.';options.appendChild(caption);
      draft.criteriaEntries.forEach((value,i)=>{
        const row=document.createElement('div');row.className='jev-option';
        const label=document.createElement('label'),field=document.createElement('input');field.type='text';field.value=value;
        field.id='jev-option-'+draft.id+'-'+i;label.htmlFor=field.id;label.textContent=scale?'Level '+i:'Option '+(i+1);field.setAttribute('aria-label','Question '+(index+1)+' '+label.textContent);
        field.addEventListener('input',()=>{draft.criteriaEntries[i]=field.value;});row.append(label,field);
        const actions=row;
        const action=(text,title,disabled,run)=>{const button=document.createElement('button');button.type='button';button.className='secondary vertex-icon-button';button.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+text+'"/></svg>';button.title=title;button.setAttribute('aria-label',title);button.disabled=disabled;button.addEventListener('click',()=>{run();paint();});actions.appendChild(button);};
        action('M8 13V3M4 7l4-4 4 4','Move '+label.textContent+' up',i===0,()=>{[draft.criteriaEntries[i-1],draft.criteriaEntries[i]]=[draft.criteriaEntries[i],draft.criteriaEntries[i-1]];});
        action('M8 3v10M4 9l4 4 4-4','Move '+label.textContent+' down',i===draft.criteriaEntries.length-1,()=>{[draft.criteriaEntries[i+1],draft.criteriaEntries[i]]=[draft.criteriaEntries[i],draft.criteriaEntries[i+1]];});
        action('M4 4l8 8M12 4l-8 8','Remove '+label.textContent,draft.criteriaEntries.length<=2,()=>draft.criteriaEntries.splice(i,1));options.appendChild(row);
      });
      const add=document.createElement('button');add.type='button';add.className='secondary';add.textContent=scale?'Add level':'Add option';add.disabled=draft.criteriaEntries.length>=limit;
      add.addEventListener('click',()=>{draft.criteriaEntries.push('');paint();const fields=options.querySelectorAll('input');fields[fields.length-1]?.focus();});options.appendChild(add);
    };
    type.addEventListener('change',()=>{draft.type=type.value;paint();});paint();card.appendChild(options);root.appendChild(card);
  });
}
function drawDecisionMode(){
  const panel=document.getElementById('jev-panel');if(!panel)return;
  const provider=document.getElementById('provider-select').value;
  const model=modelCatalog.find(m=>m.id===document.getElementById('model-select').value);
  const decision=provider==='typesafe-api'||model?.modelKind==='decision';panel.hidden=!decision;document.body.dataset.decision=String(decision);
}
function setDecisionRunning(running){
  document.getElementById('new-conversation').disabled=running;
  decisionRunning=running;document.getElementById('jev-run').disabled=running;document.getElementById('jev-stop').hidden=!running;
  document.getElementById('provider-select').disabled=running;document.getElementById('model-select').disabled=running||!modelCatalog.length;document.getElementById('subprovider-select').disabled=running||!modelCatalog.length;
}
document.getElementById('jev-add-question').addEventListener('click',()=>{jevDrafts.push({id:'question_'+(++jevNextQuestion),type:'noul',instructions:'',criteriaText:''});renderJevQuestions();});
renderJevQuestions();
document.getElementById('jev-panel').addEventListener('submit',event=>{
  event.preventDefault();if(decisionRunning||chatRunning)return;const status=document.getElementById('jev-status');
  document.getElementById('jev-result').replaceChildren();jevSubmittedLabels={};
  try{
    const selectedModel=document.getElementById('model-select').value;
    if(!modelCatalog.some(m=>m.id===selectedModel))throw new Error('No Jev model is ready. Select an enabled Jev model in LLM Providers. No request was sent.');
    const state=document.getElementById('jev-state').value;if(!state.trim())throw new Error('Enter context.');
    const built=buildJevQuestions(jevDrafts);jevSubmittedLabels=built.labels;
    setDecisionRunning(true);status.textContent='Evaluating…';document.getElementById('jev-result').replaceChildren();
    api.postMessage({action:'decision',model:document.getElementById('model-select').value,state:jevRestoredState&&jevRestoredState.text===state?jevRestoredState.value:state,questions:built.questions});
  }catch(error){status.textContent=error.message;}
});
document.getElementById('jev-stop').addEventListener('click',()=>api.postMessage({action:'stopChat'}));
function showDecisionResult(result){
  const root=document.getElementById('jev-result');root.replaceChildren();const table=document.createElement('table'),head=document.createElement('tr');
  const columns=['Question','Answer','Confidence','Probabilities'];head.className='jev-result-head';
  columns.forEach(label=>{const th=document.createElement('th');th.textContent=label;th.setAttribute('scope','col');head.appendChild(th);});table.appendChild(head);
  const percent=v=>(Number(v)*100).toFixed(1).replace(/\\.0$/,'')+'%';
  for(const [name,answer] of Object.entries(result.answers||{})){
    const label=jevSubmittedLabels[name]||{},row=document.createElement('tr');row.className='jev-result-row';
    const optionLabel=key=>answer.type==='score'?(label.levels?.[Number(key)]||answer.legend?.[key]||key):(label.choices?.[key]||key);
    const value=answer.type==='noul'?(answer.noul>=0.5?'Yes':'No'):answer.type==='choice'?optionLabel(answer.choice):String(answer.score);
    const distribution=answer.type==='noul'?'Yes: '+percent(answer.noul)+' · No: '+percent(1-answer.noul):Object.entries(answer.probabilities||{}).map(([key,p])=>optionLabel(key)+': '+percent(p)).join('\\n');
    [label.instructions||name,value,answer.confidence==null?'—':percent(answer.confidence),distribution].forEach((text,index)=>{const cell=document.createElement('td');cell.setAttribute('data-label',columns[index]);cell.textContent=text;row.appendChild(cell);});table.appendChild(row);
  }root.appendChild(table);
  const usage=result.usage||{};document.getElementById('jev-status').textContent=result.model+' · '+result.elapsedMs+' ms · input '+(usage.input_tokens??'unknown')+' · output '+(usage.output_tokens??'unknown')+' · cost '+(usage.cost_usd!=null?'$'+usage.cost_usd:usage.cost!=null?'$'+usage.cost:usage.estimated_cost_usd!=null?'estimated $'+usage.estimated_cost_usd+' (input $'+usage.input_usd_per_million+'/1M; output free)':'not reported');
}
`;
module.exports = {html, css, script, buildQuestions};
