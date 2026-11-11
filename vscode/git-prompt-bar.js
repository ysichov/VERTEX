"use strict";
/* The prompt bar of a read-only Git review (commit or uncommitted changes): which prompt ASK AI and Copy prompt use,
   the requirements of a business review, Jev triage (shown only while Jev is connected), and the Prompts… dialog
   that edits the user prompt files - the same dialog as SAP transport review (versions.html showPromptEditor). */

const KINDS = [["git-review", "Technical review"], ["git-business", "Business review"], ["git-docs", "Documentation"],
  ["git-tests", "Test plan"], ["git-release", "Release notes"]];
const EDITOR_KINDS = KINDS.concat([["git-commit", "Commit message"], ["git-pr", "Pull request description"]]);

const CSS = `.prompt-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 12px}
.prompt-bar label.jev-sort{display:inline-flex;align-items:center;gap:4px;font-size:12px}
.prompt-requirements{display:flex;flex-direction:column;gap:4px;margin:0 0 12px;font-size:12px}
.prompt-requirements textarea{box-sizing:border-box;width:100%;min-height:80px;resize:vertical;padding:6px 8px;color:var(--vscode-input-foreground,var(--fg));background:var(--vscode-input-background,var(--bg));border:1px solid var(--vscode-input-border,var(--border));font:12px/1.5 var(--vscode-font-family,sans-serif)}
.prompt-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--bg) 55%,transparent)}
.prompt-editor{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:min(850px,100%);max-height:90vh;padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--vscode-editorWidget-background,var(--bg));color:var(--fg);box-shadow:0 8px 28px color-mix(in srgb,var(--fg) 25%,transparent)}
.prompt-editor .actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.prompt-editor .source{color:var(--muted);overflow-wrap:anywhere}
.prompt-editor select{align-self:flex-start;padding:2px 6px;color:var(--vscode-input-foreground,var(--fg));background:var(--vscode-input-background,var(--bg));border:1px solid var(--border);font:inherit}
.prompt-editor textarea{box-sizing:border-box;width:100%;min-height:260px;flex:1 1 auto;resize:vertical;padding:8px;color:var(--vscode-input-foreground,var(--fg));background:var(--vscode-input-background,var(--bg));border:1px solid var(--vscode-input-border,var(--border));font:12px/1.5 var(--vscode-editor-font-family,monospace)}`;

function html(escape) {
  return `<div class="prompt-bar" id="prompt-bar"><span class="vertex-segment-toggle" role="group" aria-label="Prompt for ASK AI and Copy prompt">${KINDS.map(([id, label], i) =>
    `<button type="button" data-kind="${id}"${i ? "" : ' class="active"'} aria-pressed="${i ? "false" : "true"}">${escape(label)}</button>`).join("")}</span>`
    + `<label class="jev-sort" hidden title="Before sending, Jev assesses every block: the most significant go first, formatting-only ones last; for a business review it also points at the blocks that likely implement each requirement. One Jev request per block."><input type="checkbox" id="prompt-jev"> Sort blocks with Jev</label>`
    + `<button type="button" id="prompt-copy" class="neutral" title="Copy the selected prompt with every block of this review, to paste into any chat">Copy prompt</button>`
    + `<button type="button" id="prompt-edit" class="neutral" title="View and edit the user prompt files">Prompts…</button></div>`
    + `<label class="prompt-requirements" id="prompt-requirements" hidden>Requirements (one per line)<textarea id="prompt-requirements-text" spellcheck="false" placeholder="Paste the business requirements here"></textarea></label>`;
}

const SCRIPT = `(()=>{const bar=document.getElementById('prompt-bar');if(!bar)return;
const EDITOR_KINDS=${JSON.stringify(EDITOR_KINDS)};
const state=Object.assign({kind:'git-review',requirements:'',jev:false},(api.getState()||{}).prompt||{});
let jevOn=false,waiter=null;
const keep=()=>api.setState({...(api.getState()||{}),prompt:state});
const req=document.getElementById('prompt-requirements'),reqText=document.getElementById('prompt-requirements-text'),jevBox=document.getElementById('prompt-jev'),jevLabel=bar.querySelector('.jev-sort');
const paint=()=>{bar.querySelectorAll('[data-kind]').forEach(b=>{const on=b.dataset.kind===state.kind;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});req.hidden=state.kind!=='git-business';jevLabel.hidden=!jevOn;jevBox.checked=state.jev;};
reqText.value=state.requirements;paint();
bar.addEventListener('click',e=>{const b=e.target.closest('[data-kind]');if(!b)return;state.kind=b.dataset.kind;keep();paint();});
reqText.addEventListener('input',()=>{state.requirements=reqText.value;keep();});
jevBox.addEventListener('change',()=>{state.jev=jevBox.checked;keep();});
window.promptOptions=()=>({kind:state.kind,requirements:state.requirements,jev:jevOn&&state.jev});
document.getElementById('prompt-copy').onclick=()=>api.postMessage({action:'copyPrompt',...window.promptOptions()});
const fileRequest=(kind,operation,text)=>new Promise((resolve,reject)=>{waiter={resolve,reject};api.postMessage({action:'promptFile',kind,operation,text:text||''});});
window.addEventListener('message',e=>{const m=e.data||{};
 if(typeof m.jevAvailability==='boolean'){jevOn=m.jevAvailability;paint();}
 if(m.promptFile&&waiter){const w=waiter;waiter=null;m.promptFile.error?w.reject(new Error(m.promptFile.error)):w.resolve(m.promptFile);}
 if(m.promptStatus)operationStatus(document.getElementById('status'),m.promptStatus.text,m.promptStatus.state||'info');});
document.getElementById('prompt-edit').onclick=()=>{
 const old=document.getElementById('prompt-editor-overlay');if(old)old.remove();
 const overlay=document.createElement('div');overlay.id='prompt-editor-overlay';overlay.className='prompt-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
 const card=document.createElement('div');card.className='prompt-editor';overlay.appendChild(card);
 const title=document.createElement('strong');title.textContent='Prompt files';card.appendChild(title);
 const select=document.createElement('select');select.setAttribute('aria-label','Prompt type');
 EDITOR_KINDS.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;select.appendChild(o);});select.value=state.kind;card.appendChild(select);
 const source=document.createElement('div');source.className='source';card.appendChild(source);
 const area=document.createElement('textarea');area.setAttribute('aria-label','Prompt text');area.spellcheck=false;card.appendChild(area);
 const actions=document.createElement('div');actions.className='actions';card.appendChild(actions);
 const button=(text,cls)=>{const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;actions.appendChild(b);return b;};
 const save=button('Save user file','save'),reset=button('Use built-in','neutral'),close=button('Close','neutral');
 const update=()=>fileRequest(select.value,'read').then(a=>{area.value=a.text;source.textContent=(a.exists?'User file: ':'Built-in prompt · user file: ')+(a.path||'unavailable');},err=>{source.textContent=err.message;});
 select.onchange=update;
 save.onclick=()=>fileRequest(select.value,'save',area.value).then(update,err=>{source.textContent=err.message;});
 reset.onclick=()=>fileRequest(select.value,'reset').then(update,err=>{source.textContent=err.message;});
 close.onclick=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
 document.body.appendChild(overlay);update();area.focus();};
})();`;

/** The host's answer to the dialog: the user file, or the built-in text when there is none. */
async function promptFileAnswer(message, home) {
  const kind = String(message?.kind || ""), operation = String(message?.operation || "");
  if (!EDITOR_KINDS.some(([id]) => id === kind)) throw new Error("Unknown prompt kind.");
  const file = await require("./prompt-files").promptFile(kind, operation, message?.text, home);
  if (file.exists) return file;
  const commit = require("./git-commit");
  const text = kind === "git-commit" ? commit.COMMIT_INSTRUCTION : kind === "git-pr" ? commit.PR_INSTRUCTION : require("./git-prompts").BUILT_IN[kind];
  return { ...file, text };
}

module.exports = { KINDS, EDITOR_KINDS, CSS, html, SCRIPT, promptFileAnswer };
