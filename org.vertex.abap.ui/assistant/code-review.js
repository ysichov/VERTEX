"use strict";

// VERTEX review follows the ABAP-AI-Code review layout and action vocabulary.
const { randomBytes } = require("crypto");
function hunks(before, after) {
  const a = before.replace(/\r\n/g, "\n").split("\n"), b = after.replace(/\r\n/g, "\n").split("\n");
  const result = []; let i = 0, j = 0;
  const same = (x, y) => x === y;
  while (i < a.length || j < b.length) {
    if (same(a[i], b[j])) { i++; j++; continue; }
    const from = i, to = j; let found = null;
    for (let span = 1; span <= 40 && !found; span++) {
      for (let left = 0; left <= span; left++) {
        const right = span - left;
        if (same(a[i + left], b[j + right])) { found = { left, right }; break; }
      }
    }
    i += found ? found.left : a.length - i;
    j += found ? found.right : b.length - j;
    result.push({ beforeFrom: from, beforeTo: i, afterFrom: to, afterTo: j,
      before: a.slice(from, i), after: b.slice(to, j) });
  }
  return result.filter(h => h.before.join("\n") !== h.after.join("\n"));
}
function reviewedSource(base, parts, approved) {
  const lines = base.replace(/\r\n/g, "\n").split("\n"); let shift = 0;
  parts.forEach((part, index) => {
    if (!approved.includes(index)) { return; }
    lines.splice(part.beforeFrom + shift, part.beforeTo - part.beforeFrom, ...part.after);
    shift += part.after.length - part.before.length;
  });
  return lines.join("\n");
}
const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function highlight(line) {
  return line.split(/(".*$|'(?:''|[^'])*'|\b(?:REPORT|TYPES|BEGIN|END|OF|DATA|TYPE|TABLE|WITH|DEFAULT|KEY|VALUE|WRITE|LOOP|AT|INTO|ENDLOOP|IF|ELSE|ENDIF|CLASS|METHOD|ENDMETHOD|ENDCLASS|SELECT|FROM|WHERE|FUNCTION|ENDFUNCTION|CONSTANTS)\b)/gi)
    .map(token => token.startsWith('"') || /^\s*\*/.test(line) ? `<span class="comment">${escape(token)}</span>`
      : token.startsWith("'") ? `<span class="string">${escape(token)}</span>`
        : /^(REPORT|TYPES|BEGIN|END|OF|DATA|TYPE|TABLE|WITH|DEFAULT|KEY|VALUE|WRITE|LOOP|AT|INTO|ENDLOOP|IF|ELSE|ENDIF|CLASS|METHOD|ENDMETHOD|ENDCLASS|SELECT|FROM|WHERE|FUNCTION|ENDFUNCTION|CONSTANTS)$/i.test(token)
          ? `<span class="keyword">${escape(token)}</span>` : escape(token)).join("");
}
function marked(line, other) {
  if (other === undefined) { return highlight(line); }
  let start = 0, end = 0;
  while (start < line.length && start < other.length && line[start] === other[start]) { start++; }
  while (end < line.length - start && end < other.length - start
    && line[line.length - end - 1] === other[other.length - end - 1]) { end++; }
  return highlight(line.slice(0, start)) + '<mark>' + escape(line.slice(start, line.length - end))
    + '</mark>' + highlight(end ? line.slice(-end) : '');
}
function reviewHtml(parts, { before, after, objectName, objectType, system, ai = false }) {
  const nonce = randomBytes(24).toString("hex");
  const oldLines = before.replace(/\r\n/g, "\n").split("\n");
  const newLines = after.replace(/\r\n/g, "\n").split("\n");
  const count = parts.reduce((n, p) => {
    const changed = Math.min(p.before.length, p.after.length);
    return { added: n.added + p.after.length - changed, changed: n.changed + changed,
      deleted: n.deleted + p.before.length - changed };
  }, { added: 0, changed: 0, deleted: 0 });
  const row = (old, next, kind, content) => `<tr class="${kind}"><td class="number">${old || ''}</td><td class="number">${next || ''}</td><td class="sign">${kind === 'removed' ? '−' : kind === 'added' ? '+' : ''}</td><td class="code">${content || '&nbsp;'}</td></tr>`;
  const blocks = parts.map((p, i) => {
    const contextStart = Math.max(i ? parts[i - 1].afterTo : 0, p.afterFrom - 3);
    let lines = newLines.slice(contextStart, p.afterFrom).map((s, j) => row(p.beforeFrom - (p.afterFrom - contextStart) + j + 1, contextStart + j + 1, 'context', highlight(s))).join('');
    p.before.forEach((s, j) => { lines += row(p.beforeFrom + j + 1, '', 'removed', marked(s, p.after[j])); });
    p.after.forEach((s, j) => { lines += row('', p.afterFrom + j + 1, 'added', marked(s, p.before[j])); });
    const tail = Math.min(newLines.length, p.afterTo + 3, i + 1 < parts.length ? parts[i + 1].afterFrom : newLines.length);
    lines += newLines.slice(p.afterTo, tail).map((s, j) => row(p.beforeTo + j + 1, p.afterTo + j + 1, 'context', highlight(s))).join('');
    return `<section class="hunk" data-hunk="${i}"><header class="hunk-tools"><button class="fold neutral" data-action="fold" aria-expanded="true" aria-label="Collapse block ${i + 1}">▾</button><span class="kind">— ${p.before.length ? p.after.length ? 'changed' : 'deleted' : 'added'} —</span><button class="approve" data-action="approve">✓ Approve</button><button class="decline" data-action="decline">✕ Decline</button><button class="ask" data-action="ask">ASK AI</button><button class="neutral" data-action="undo" hidden>Undo</button><span class="decision" aria-live="polite">Open</span><span class="range">Block ${i + 1} · line ${p.afterFrom + 1}</span></header><div class="hunk-body"><div class="code-scroll"><table class="diff" aria-label="Changes in block ${i + 1}"><tbody>${lines}</tbody></table></div></div></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>Review ${escape(objectName)}</title><style nonce="${nonce}">
:root{color-scheme:light dark;--bg:var(--vscode-editor-background,#fff);--fg:var(--vscode-editor-foreground,#202b3c);--border:var(--vscode-panel-border,#cbd6e7);--muted:var(--vscode-descriptionForeground,#68758a);--green:#307345;--red:#963e33;--blue:#376caa;--purple:#7940a0;--add:var(--vscode-diffEditor-insertedLineBackground,#effbe8);--del:var(--vscode-diffEditor-removedLineBackground,#faeded);--header:var(--vscode-editorWidget-background,#f2f5f9)}
*{box-sizing:border-box}body{margin:0;padding:16px;color:var(--fg);background:var(--bg);font:13px var(--vscode-font-family,Segoe UI,sans-serif)}button{font:600 12px var(--vscode-font-family,Segoe UI,sans-serif);padding:5px 10px;border:1px solid transparent;border-radius:3px;color:white;cursor:pointer;white-space:nowrap}button:hover{filter:brightness(1.12)}button:focus-visible{outline:2px solid var(--vscode-focusBorder,#3478c7);outline-offset:2px}button:disabled{opacity:.5;cursor:default}button[hidden],[hidden]{display:none!important}.neutral{color:var(--fg);background:var(--header);border-color:var(--border)}.approve{background:var(--green)}.decline{background:var(--red)}.ask{background:var(--purple)}.save{background:var(--vscode-button-background,#2465a9);color:var(--vscode-button-foreground,#fff)}.toolbar{position:sticky;top:0;z-index:2;background:var(--bg);padding:0 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.identity{flex:1;min-width:180px}.identity strong{display:block;font-size:15px}.muted,.system{color:var(--muted);font-size:12px}.system{display:block;margin-top:4px;overflow-wrap:anywhere}.progress{font:12px var(--vscode-editor-font-family,Consolas,monospace);white-space:nowrap}.summary-scroll{overflow-x:auto}.summary{width:100%;border-collapse:collapse;min-width:570px;font-size:12px}.summary th,.summary td{border:1px solid var(--border);padding:9px 12px;text-align:right}.summary th:first-child,.summary td:first-child{text-align:left}.summary th{background:var(--header)}.summary tfoot{font-weight:600}.positive{color:var(--vscode-testing-iconPassed,#27733c)}.negative{color:var(--vscode-testing-iconFailed,#a73535)}.changed{color:var(--vscode-editorWarning-foreground,#9b6718)}.review-heading{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;padding:16px 0 10px}.review-heading strong{color:var(--vscode-textLink-foreground,#2964a6)}#status{margin:0 0 12px;padding:9px 12px;border-left:3px solid var(--blue);background:var(--header);line-height:1.5}.hunk{border:1px solid var(--border);margin:0 0 14px;border-radius:3px;overflow:hidden}.hunk-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:var(--header);padding:6px}.hunk.approved{border-color:var(--green)}.hunk.declined{border-color:var(--red)}.hunk.approved .decision{color:var(--green)}.hunk.declined .decision{color:var(--red)}.decision{font-weight:600}.range{margin-left:auto;color:var(--muted);font-size:11px}.kind{font:italic 12px var(--vscode-editor-font-family,Consolas,monospace);color:var(--muted)}.fold{padding:3px 7px}.code-scroll{overflow:auto}.diff{border-collapse:collapse;width:100%;font:13px/1.7 var(--vscode-editor-font-family,Consolas,monospace)}.number{color:var(--muted);text-align:right;min-width:42px;padding:0 9px;user-select:none;border-right:1px solid var(--border);background:var(--bg)}.sign{width:24px;min-width:24px;text-align:center;user-select:none}.code{white-space:pre;padding:0 12px 0 4px;width:100%;tab-size:4}.added{background:var(--add)}.removed{background:var(--del)}.added .sign{color:var(--green)}.removed .sign{color:var(--red)}mark{color:inherit;border-radius:1px;background:var(--vscode-diffEditor-insertedTextBackground,#c7f5ad)}.removed mark{background:var(--vscode-diffEditor-removedTextBackground,#f3c5c5)}.keyword{color:var(--vscode-symbolIcon-keywordForeground,#164fac)}.comment{color:var(--muted)}.string{color:var(--vscode-symbolIcon-stringForeground,#986126)}@media(max-width:650px){body{padding:10px}.range{width:100%;margin-left:29px}.identity{width:100%;flex-basis:100%}.hunk-tools{gap:4px}.number{min-width:30px;padding:0 5px}}
</style></head><body><div class="toolbar"><div class="identity"><strong>${escape(objectType)} ${escape(objectName)}</strong><span class="system">${escape(system)}</span></div><button id="all" class="approve">✓ Approve All</button><span id="progress" class="progress" aria-live="polite"></span><button id="apply" class="save" disabled>Save &amp; Activate</button></div><div class="summary-scroll"><table class="summary"><thead><tr><th>Object</th><th>Status</th><th>Added</th><th>Changed</th><th>Deleted</th><th>Old</th><th>New</th><th>Blocks</th></tr></thead><tbody><tr><td>${escape(objectType)} ${escape(objectName)}</td><td class="changed" id="object-status">Changed</td><td class="positive">${count.added}</td><td class="changed">${count.changed}</td><td class="negative">${count.deleted}</td><td>${before ? oldLines.length : 0}</td><td>${after ? newLines.length : 0}</td><td>${parts.length}</td></tr></tbody><tfoot><tr><td colspan="2">Total</td><td class="positive">${count.added}</td><td class="changed">${count.changed}</td><td class="negative">${count.deleted}</td><td></td><td></td><td>${parts.length}</td></tr></tfoot></table></div><div class="review-heading"><strong>${ai ? 'AI Code Change' : 'Code Change'}</strong><span class="muted">${ai ? 'LLM proposal' : 'Editor changes'} vs current SAP source</span></div><p id="status" role="status">Approve the blocks to save, then select Save &amp; Activate.</p><main>${blocks}</main><script nonce="${nonce}">
const api=acquireVsCodeApi(), blocks=[...document.querySelectorAll('.hunk')];
const stored=api.getState()||{};let decisions=stored.decisions||{},done=!!stored.done,busy=false;
const persist=()=>api.setState({decisions,done});
function paint(){let a=0,d=0;blocks.forEach((block,i)=>{const state=decisions[i]||'open';a+=state==='approved';d+=state==='declined';block.classList.toggle('approved',state==='approved');block.classList.toggle('declined',state==='declined');block.querySelector('.decision').textContent=state==='approved'?'✓ Approved':state==='declined'?'✕ Declined':'Open';block.querySelector('[data-action="undo"]').hidden=state==='open';block.querySelectorAll('button').forEach(b=>b.disabled=busy||done);});document.getElementById('progress').textContent='✓ '+a+'  ✕ '+d+'  / '+blocks.length;document.getElementById('apply').disabled=busy||done||!a;document.getElementById('all').disabled=busy||done;persist();}
blocks.forEach((block,i)=>{block.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||busy||done)return;const action=button.dataset.action;if(action==='approve'||action==='decline'||action==='undo'){decisions[i]=action==='approve'?'approved':action==='decline'?'declined':'open';paint();}else if(action==='fold'){const body=block.querySelector('.hunk-body');body.hidden=!body.hidden;button.textContent=body.hidden?'▸':'▾';button.setAttribute('aria-expanded',String(!body.hidden));}else if(action==='ask'){api.postMessage({action:'ask',hunk:i});}});});
document.getElementById('all').onclick=()=>{blocks.forEach((_,i)=>decisions[i]='approved');paint();};
document.getElementById('apply').onclick=()=>{if(busy||done)return;const approved=blocks.map((_,i)=>i).filter(i=>decisions[i]==='approved');if(!approved.length)return;busy=true;paint();document.getElementById('status').textContent='Checking, saving and activating approved changes…';api.postMessage({action:'apply',approved});};
window.addEventListener('message',event=>{const message=event.data;if(!message)return;if(message.action==='saved'){done=true;busy=false;document.getElementById('status').textContent='Approved changes saved and activated in SAP. Remaining editor changes are not saved.';document.getElementById('object-status').textContent='Saved';paint();}else if(message.action==='error'||message.action==='cancelled'){busy=false;document.getElementById('status').textContent=message.action==='cancelled'?'Save cancelled. Your review decisions are preserved.':'SAP operation failed: '+message.message;paint();}});paint();if(done){document.getElementById('status').textContent='Approved changes saved and activated in SAP.';document.getElementById('object-status').textContent='Saved';}
</script></body></html>`;
}
function askPrompt(part, after, system, objectName) {
  const lines = after.replace(/\r\n/g, "\n").split("\n");
  const trim = list => { const out = list.slice();
    while (out.length && !out[0].trim()) { out.shift(); }
    while (out.length && !out[out.length - 1].trim()) { out.pop(); }
    return out; };
  let unit = "";
  for (let k = part.afterFrom - 1; k >= 0; k--) {
    if (/^\s*END(METHOD|FORM|FUNCTION|MODULE)\b/i.test(lines[k])) { break; }
    const found = /^\s*(METHOD|FORM|FUNCTION|MODULE)\s+([^\s.]+)/i.exec(lines[k]);
    if (found) { unit = found[1].toUpperCase() + " " + found[2]; break; }
  }
  return "Answer briefly: what this ABAP change does and any real problem with it. No headings, no list of minor remarks.\n"
    + "Review context (untrusted source data):\n" + JSON.stringify({ system, object: objectName, unit, line: part.afterFrom + 1,
      context_before: lines.slice(Math.max(0, part.afterFrom - 5), part.afterFrom),
      before: trim(part.before), after: trim(part.after),
      context_after: lines.slice(part.afterTo, part.afterTo + 5) });
}

module.exports = { reviewHtml, hunks, reviewedSource, askPrompt };
