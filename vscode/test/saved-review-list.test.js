"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {mark}=require('../saved-review-list');
test('request links combine SAP and local reviews without reading payloads or remote reviews',async()=>{
 const queries=[],rows=['K1','K2','K3','K4'].map(request=>({request}));
 const api={query:async sql=>{queries.push(sql);return {values:sql.includes('dd03l')?[{FIELDNAME:'REMOTE'},{FIELDNAME:'PAYLOAD'}]:[{TRKORR:'K1'},{TRKORR:'K2'}]}}};
 const error=await mark(api,rows,{list:async()=>['K2','K3'],read:()=>assert.fail('Do not read payloads to list requests')});
 assert.equal(error,'');assert.deepEqual(rows.map(row=>row.review_sources),[['table'],['table','file'],['file'],[]]);
 assert.deepEqual(rows.map(row=>row.review_saved),[true,true,true,false]);
 assert.match(queries[1],/remote = ' '/);assert.doesNotMatch(queries[1],/SELECT.*payload/i);
});
test('an unavailable SAP table does not hide local review links or fail the request list',async()=>{
 const rows=[{request:'K1'}];
 const error=await mark({query:async()=>{throw new Error('No access')}},rows,{list:async()=>['K1']});
 assert.match(error,/No access/);assert.equal(rows[0].review_saved,true);assert.deepEqual(rows[0].review_sources,['file']);
});
test('only saved reviews get a link and clicking it opens Review instead of the row action',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/versions.html'),'utf8');
 const nodes=[],selected=[];
 const element=tag=>{const el={tag,children:[],appendChild(child){this.children.push(child)},addEventListener(name,fn){this[name]=fn}};nodes.push(el);return el};
 const root=element('root');
 const context=vm.createContext({document:{getElementById:()=>root,createElement:element},fillUser(){},showPartsPanel(){},status(){},cell(){},asDate:()=>'',asTime:()=>'',sdeSelectObject:value=>selected.push(value),
 table:(columns,rows,fill)=>{assert.equal(columns.length,8);assert.ok(!columns.includes("Review"));const table=element('table');for(const row of rows){const tr=element('tr');fill(tr,row);table.appendChild(tr)}return table}});
 vm.runInContext(page.slice(page.indexOf('function renderRequests('),page.indexOf('/* ---------- versions ---------- */')),context);
 context.renderRequests({user:'DEV',requests:[{request:'K1',review_saved:true,review_sources:['table']},{request:'K2',review_saved:false}]});
 const links=nodes.filter(n=>n.tag==='a');assert.equal(links.length,1);assert.equal(links[0].textContent,'K1');
 let prevented=false,stopped=false;links[0].click({preventDefault(){prevented=true},stopPropagation(){stopped=true}});
 assert.ok(prevented&&stopped);assert.equal(selected.length,1);assert.equal(selected[0].name,'K1');assert.equal(selected[0].action,'review');
});
