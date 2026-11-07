'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const history=require('../git-history');
function fixture(){
 let html,receive,close;
 history.open({ViewColumn:{Beside:2},window:{createWebviewPanel(){return {webview:{set html(v){html=v;},onDidReceiveMessage(){},postMessage(){}},onDidDispose(fn){close=fn;}}}}},'.');
 class Element{
  constructor(){this.value='';this.textContent='';this.children=[];this.events={};}
  replaceChildren(...items){this.children=items;}
  appendChild(item){this.children.push(item);}
  add(item){this.children.push(item);}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(){}
  querySelector(){return body;}
 }
 const body=new Element(),table=new Element(),ids=Object.fromEntries(['from','to','month','author','error','folder','filters'].map(k=>[k,new Element()]));
 vm.runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1],{document:{getElementById:id=>ids[id],querySelector:()=>table,createElement:()=>new Element()},window:{addEventListener(name,fn){receive=fn;}},setTimeout:()=>0,clearTimeout(){},acquireVsCodeApi:()=>({postMessage(){}}),Option:function(text,value){this.text=text;this.value=value;}});
 receive({data:{folder:'.',commits:[{short:'c',date:'2024-03-01T00:00:00+02:00'},{short:'b',date:'2024-02-29T23:59:59-08:00'},{short:'a',date:'2024-02-01T00:00:00Z'}]}});
 close();return {ids,body,receive};
}
test('history numbers, inclusive dates, leap month and validation',()=>{
 const {ids,body}=fixture();
 assert.deepEqual(body.children.slice(1).map(r=>r.children[0].textContent),[3,2,1]);
 assert.equal(body.children[1].children[2].textContent,'01-03-2024 00:00:00');
 ids.month.value='2024-02';ids.month.events.change();
 assert.equal(ids.to.value,'29-02-2024');
 assert.deepEqual(body.children.slice(1).map(r=>r.children[0].textContent),[2,1]);
 ids.from.value='29-02-2024';ids.from.events.input();assert.equal(body.children.length,2);
 ids.from.value='31-02-2024';ids.from.events.input();assert.match(ids.error.textContent,/dd-mm-yyyy/);
 ids.from.value='02-03-2024';ids.from.events.input();assert.match(ids.error.textContent,/on or before/);
 ids.month.value='';ids.month.events.change();assert.equal(body.children.length,4);
});


test('working diff includes staged, unstaged, deleted and untracked files within the folder', async t => {
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'vertex-history-'));
 t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:folder,windowsHide:true});
 git('init');git('config','user.email','test@example.test');git('config','user.name','Test');
 await fs.mkdir(path.join(folder,'sub'));
 for(const file of ['sub/staged','sub/unstaged','sub/deleted','outside'])await fs.writeFile(path.join(folder,file),'old');
 git('add','.');git('commit','-m','initial','-m','First paragraph.\n\nSecond paragraph: <tag> & text.');
 const commits=await history.readCommits(folder);
 assert.equal(commits[0].subject,'initial');
 assert.equal(commits[0].description,'First paragraph.\n\nSecond paragraph: <tag> & text.');
 await fs.writeFile(path.join(folder,'sub/staged'),'staged');git('add','sub/staged');
 await fs.writeFile(path.join(folder,'sub/unstaged'),'working');
 await fs.unlink(path.join(folder,'sub/deleted'));
 await fs.writeFile(path.join(folder,'sub/new file'),'new');
 await fs.writeFile(path.join(folder,'sub/empty'),'');
 await fs.writeFile(path.join(folder,'outside'),'exclude');
 const changes=await history.readWorkingChanges(path.join(folder,'sub'));
 assert.deepEqual(changes.map(c=>c.file).sort(),['deleted','empty','new file','staged','unstaged']);
 assert.equal(changes.find(c=>c.file==='staged').before,'old');
 assert.equal(changes.find(c=>c.file==='staged').after,'staged');
 assert.equal(changes.find(c=>c.file==='deleted').status,'D');
 assert.equal(changes.find(c=>c.file==='new file').status,'A');
 let dispose,viewChange;
 const panel={visible:true,active:true,webview:{html:'',onDidReceiveMessage(){}},
   onDidDispose(fn){dispose=fn;},onDidChangeViewState(fn){viewChange=fn;}};
 const vscode={ViewColumn:{Active:1},window:{createWebviewPanel(){return panel;}}};
 await history.openCommit(vscode,path.join(folder,'sub'),{working:true});
 const snapshot=history.reviewContext();
 assert.equal(snapshot.title,'Uncommitted changes');
 assert.match(snapshot.text,/staged/);assert.match(snapshot.text,/old/);assert.match(snapshot.text,/deleted/);
 await fs.writeFile(path.join(folder,'sub/staged'),'NEW_DISK_CONTENT');
 assert.equal(history.reviewContext().text,snapshot.text,'the context stays the rendered snapshot');
 panel.visible=false;viewChange({webviewPanel:panel});assert.equal(history.reviewContext(),null);
 panel.visible=true;viewChange({webviewPanel:panel});assert.equal(history.reviewContext(),snapshot);
 dispose();assert.equal(history.reviewContext(),null);

});


test('Git review context marks truncation, includes deleted text and excludes binaries',()=>{
 const snapshot=history.reviewSnapshot([
  {file:'removed.js',status:'D',before:'removed content',after:''},
  {file:'image.png',status:'M',binary:true,before:'',after:''}
 ],'Commit abc','folder');
 assert.match(snapshot.text,/removed content/);assert.doesNotMatch(snapshot.text,/image.png|Binary file/);assert.equal(snapshot.file_count,1);
 const limited=history.reviewSnapshot([{file:'big.js',status:'M',before:'x',after:'y'.repeat(500)}],'Changes','folder',200);
 assert.equal(limited.truncated,true);assert.ok(limited.text.length<=200);assert.match(limited.text,/truncated/);
});


test('only commits with descriptions have a fold icon; expansion survives filtering',()=>{
 const {ids,body,receive}=fixture();
 receive({data:{folder:'.',commits:[{hash:'a',short:'a',date:'2024-03-01',subject:'Title',description:'First paragraph.\n\n<tag> & text.'},
 {hash:'b',short:'b',date:'2024-02-01',subject:'No description',description:''}]}});
 const cell=body.children[1].children[4],fold=cell.children[0],description=cell.children[2];
 assert.equal(fold.textContent,'▸');assert.equal(description.hidden,true);
 assert.equal(description.textContent,'First paragraph.\n\n<tag> & text.');
 assert.equal(body.children[2].children[4].children.length,0);
 fold.onclick();assert.equal(description.hidden,false);assert.equal(fold.textContent,'▾');
 ids.from.value='01-03-2024';ids.from.events.input();
 assert.equal(body.children[1].children[4].children[2].hidden,false);
 body.children[1].children[4].children[0].onclick();assert.equal(body.children[1].children[4].children[2].hidden,true);
});

test('history loads ten latest details and retrieves older commits only for a period',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'vertex-ten-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:folder,windowsHide:true});
 git('init');git('config','user.email','test@example.test');git('config','user.name','Test');
 for(let i=1;i<=12;i++){await fs.writeFile(path.join(folder,'file'),String(i));git('add','.');git('commit','--author='+(i===12?'Other':'Test')+' <test@example.test>','-m','Commit '+i,'--date=2025-01-'+String(i).padStart(2,'0')+'T12:00:00Z');}
 const latest=await history.readCommits(folder);assert.equal(latest.length,10);assert.equal(latest[0].number,12);assert.equal(latest[9].number,3);assert.deepEqual(latest.months,['2025-01']);
 const older=await history.readCommits(folder,{from:'2025-01-01',to:'2025-01-02'});assert.equal(older.length,2);assert.deepEqual(older.map(c=>c.number),[2,1]);assert.equal(older[1].subject,'Commit 1');
 const filtered=await history.readCommits(folder,{author:'Other'});assert.equal(filtered.length,1);assert.equal(filtered[0].number,12);assert.equal(filtered[0].author,'Other');assert.deepEqual(filtered.authors,['Other','Test']);
 const combined=await history.readCommits(folder,{author:'Other',from:'2025-01-01',to:'2025-01-02'});assert.equal(combined.length,0);
});

test('uncommitted refresh updates the same panel and clears obsolete review context',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vertex-refresh-'));let close,receive,html,panels=0;
 t.after(()=>{close?.();fs.rmSync(folder,{recursive:true,force:true});});
 const git=(...args)=>execFileSync('git',args,{cwd:folder,windowsHide:true});
 git('init');git('config','user.name','Test');git('config','user.email','test@example.test');
 fs.writeFileSync(path.join(folder,'a.txt'),'base');git('add','.');git('commit','-m','base');fs.writeFileSync(path.join(folder,'a.txt'),'first');
 const vscode={ViewColumn:{Active:1},window:{createWebviewPanel(){panels++;return {webview:{set html(v){html=v;},onDidReceiveMessage(fn){receive=fn;},postMessage(){}},onDidDispose(fn){close=fn;},onDidChangeViewState(){}};}}};
 await history.openCommit(vscode,folder,{working:true});assert.match(html,/id="review-refresh"/);assert.match(html,/first/);
 fs.writeFileSync(path.join(folder,'a.txt'),'second');await receive({action:'refresh'});assert.match(html,/second/);assert.equal(panels,1);
 git('checkout','--','a.txt');await receive({action:'refresh'});assert.match(html,/0 files/);assert.doesNotMatch(html,/id="commit-open"/);assert.match(html,/id="review-refresh"/);
});
