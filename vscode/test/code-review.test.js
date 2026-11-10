"use strict";
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { reviewHtml } = require('../code-review');

test('editor-only new files retain review actions but do not embed source or mode toggles',()=>{
 const r=require('../code-review'),file={id:'new',label:'large.json',path:'large.json',kind:'new',openInEditor:true,before:'',after:'PRIVATE_NEW_FILE',parts:r.hunks('','PRIVATE_NEW_FILE')};
 const html=r.filesReviewHtml([file],{readonly:{title:'Changes'}});
 assert.match(html,/data-editor="true"/);assert.match(html,/Open in editor/);assert.doesNotMatch(html,/PRIVATE_NEW_FILE|data-view="full"/);assert.match(html,/ASK AI/);
});

test('large Git previews are lazy, paginated and new files are shown without whole-file diff colour',async()=>{
 const review=require('../code-review'),after=Array.from({length:65000},(_,i)=>'unique_row_'+i).join('\n');
 const file={id:'large',path:'catalog.json',label:'catalog.json',kind:'new',before:'',after,parts:review.hunks('',after)};
 const shell=review.filesReviewHtml([file],{readonly:{title:'Large preview'}});assert.doesNotMatch(shell,/unique_row_100/);
 const page=review.fileDiffHtml(file,false,true,1);assert.equal((page.match(/<tr class=/g)||[]).length,1000);assert.match(page,/unique_row_1000</);assert.doesNotMatch(page,/unique_row_999</);assert.doesNotMatch(page,/<tr class="added"/);assert.match(page,/Page 2 \/ 65/);
 let response;await review.sendFileView({webview:{postMessage:m=>{response=m;}}},{file:'large',view:'compact',page:64},file,true);
 assert.equal(response.fileView.view,'compact');assert.equal(response.fileView.page,64);assert.match(response.fileView.html,/unique_row_64999</);assert.doesNotMatch(response.fileView.html,/unique_row_63999</);
});

test('large additions, deletions and unrelated replacements have bounded diff memory and exact results',()=>{
 const {hunks,reviewedSource}=require('../code-review');
 const large=Array.from({length:30000},(_,i)=>'row '+i).join('\n');
 for(const [before,after] of [['',large],[large,''],[large,large.replace(/row/g,'new row')]]){
  const parts=hunks(before,after);assert.equal(parts.length,1);assert.equal(reviewedSource(before,parts,[0]),after);assert.equal(reviewedSource(before,parts,[]),before);
 }
 const a='same\n'+large+'\ntail',b='same\n'+large.replace(/row/g,'new row')+'\ntail';
 const parts=hunks(a,b);assert.equal(parts[0].beforeFrom,1);assert.equal(parts[0].beforeTo,30001);assert.equal(reviewedSource(a,parts,[0]),b);
});
test('review escapes source and metadata, uses nonce CSP and emits valid script', () => {
  const hostile = '</script><img src=x onerror="alert(1)">';
  const html = reviewHtml([{ beforeFrom: 0, beforeTo: 1, afterFrom: 0, afterTo: 1,
    before: ['REPORT demo.'], after: [hostile] }], { before: 'REPORT demo.', after: hostile,
    objectName: hostile, objectType: 'PROG', system: hostile });
  assert.equal(html.includes(hostile), false);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /&lt;img/);
  assert.equal(html.includes('Add Comment'), false);
  assert.equal(html.includes('<textarea'), false);
  const scripts = [...html.matchAll(/<script nonce="([a-f0-9]+)">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][2]));
});
test('both editor actions are scoped to SAP files', () => {
  const { contributes } = require('../package.json');
  for (const id of ['vertex.saveAndActivate', 'vertex.reviewCodeChanges']) {
    assert.ok(contributes.commands.some(c => c.command === id));
    assert.ok(contributes.menus['editor/context'].some(c => c.command === id && c.when === 'resourceScheme == vertex-sap'));
  }
});

test('read-only Git preview folds files and bounds long display lines',()=>{
 const review=require('../code-review');const line='x'.repeat(10000);
 const html=review.filesReviewHtml([{id:'f1',path:'bundle.js',label:'bundle.js',kind:'new',after:line,parts:review.hunks('',line)}],{readonly:{title:'Changes'}});
 assert.match(html,/foldAll\(false\)/);assert.match(html,/content-visibility:auto/);
 assert.match(html,/long line shortened in preview/);assert.ok(!html.includes(line));
});

test('commit header preserves small charges, zero and unavailable prices',()=>{
 const review=require('../code-review'),vm=require('node:vm');const html=review.filesReviewHtml([{id:'f',path:'x',label:'x',kind:'new',parts:review.hunks('','x'),after:'x'}],{readonly:{title:'Changes',commit:true}});assert.match(html,/id="commit-generation"/);
 const fn=html.match(/function generationInfoText\(info\)\{[\s\S]*?\n \}/)[0],context={};vm.runInNewContext(fn,context);
 assert.match(context.generationInfoText({model:'ling',usage:{input_tokens:40964,output_tokens:461},cost_usd:0.00088929}),/\$0\.00088929/);assert.match(context.generationInfoText({model:'free',cost_usd:0}),/\$0(?: ·|$)/);assert.match(context.generationInfoText({model:'unknown',cost_usd:null}),/cost not reported/);
});

test('review tree nests folders and binary files have no text counters',()=>{
 const review=require('../code-review');const files=['README.md','INSTALL.md','docs/nested/index.html'].map((path,i)=>({id:'f'+i,path,label:path.split('/').at(-1),kind:'new',after:'x',parts:review.hunks('','x')}));
 files.push({id:'b',path:'docs/file.jar',label:'file.jar',binary:true,parts:[],after:''});
 const html=review.filesReviewHtml(files,{readonly:{title:'Changes',commit:true,refresh:true}});
 assert.ok(html.indexOf('id="askall"')<html.indexOf('id="commit-open"'));assert.ok(html.indexOf('id="commit-open"')<html.indexOf('id="push-open"'));
 assert.match(html,/<nav class="review-tree"/);assert.doesNotMatch(html,/<table class="ave groups"/);assert.match(html,/<summary>docs<\/summary>[\s\S]*?<summary>nested<\/summary>/);
 const row=html.match(/<div class="tree-file"><button[^>]*data-open="b"[\s\S]*?<\/div>/)[0];assert.match(row,/>Binary<\/span>/);assert.doesNotMatch(row,/tree-count/);
 assert.match(html,/function selectFile/);assert.match(html,/grid-template-columns:var\(--tree-width,minmax/);assert.match(html,/id="tree-split"/);assert.match(html,/border-radius:3px;color:white;cursor:pointer/);
 const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new (require('node:vm').Script)(script));
});

test('one-block files have one ASK AI bar; text counts include blocks and binary rows stay clean',()=>{
 const review=require('../code-review');const parts=review.hunks('old','new');
 const html=review.filesReviewHtml([{id:'f',path:'one.js',label:'one.js',parts,after:'new'}],{readonly:{title:'Changes'}});
 assert.equal((html.slice(html.indexOf('</style>')).split('<script')[0].match(/data-action="ask"/g)||[]).length,1);assert.doesNotMatch(html,/<header class="hunk-tools">|<span class="kind">/);assert.match(html,/1 block<\/span>/);
 assert.doesNotMatch(html.match(/<nav[\s\S]*?<\/nav>/)[0],/>Open<|tree-decision/);
 const before=Array.from({length:30},(_,i)=>'line '+i).join('\n'),lines=before.split('\n');lines[1]='changed first';lines[28]='changed last';const after=lines.join('\n'),many=review.hunks(before,after);assert.equal(many.length,2);
 const multi=review.filesReviewHtml([{id:'f',path:'many.js',label:'many.js',parts:many,after}],{readonly:{title:'Changes'}});
 assert.equal((multi.match(/<header class="hunk-tools">/g)||[]).length,2);assert.match(multi,/2 blocks<\/span>/);assert.doesNotMatch(multi,/<span class="kind">/);
 assert.deepEqual(review.askContext(parts,null,'new','local','one.js').blocks[0].before,['old']);
});

test('Compact is default, Full is lazy and preserves all unchanged file context',()=>{
 const review=require('../code-review'),lines=Array.from({length:40},(_,i)=>'unique-line-'+i),before=lines.join('\n');lines[20]='modified';const after=lines.join('\n'),file={id:'f',path:'a.js',label:'a.js',before,after,parts:review.hunks(before,after)};
 const compact=review.fileDiffHtml(file,false,true),full=review.fileDiffHtml(file,true,true);assert.doesNotMatch(compact,/unique-line-0</);assert.match(full,/unique-line-0</);assert.match(full,/unique-line-39</);assert.equal((full.match(/unique-line-15</g)||[]).length,1);
 const html=review.filesReviewHtml([file],{readonly:{title:'Review'}});assert.match(html,/data-view="compact" class="active"/);assert.match(html,/<div class="full-view" hidden><\/div>/);assert.match(html,/Total: 1 files/);assert.match(html,/.vertex-segment-toggle button/);assert.match(html,/.hunk-actions\{display:flex/);
 assert.ok(html.indexOf('class="file-name"')<html.indexOf('class="hunk-actions"'));
});
