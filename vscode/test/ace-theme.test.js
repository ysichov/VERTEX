"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('ACE diagram colours adapt to both editor palettes and preserve distinct type hues',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../../org.vertex.abap.ui/resources/metrics.html'),'utf8');
 let background='#ffffff',foreground='#111111';
 const context=vm.createContext({document:{body:{}},getComputedStyle:()=>({getPropertyValue:key=>key==='--vscode-editor-background'?background:key==='--vscode-editor-foreground'?foreground:''})});
 vm.runInContext(page.match(/<script>([\s\S]*?)<\/script>/)[1].split('/* ---------- wiring ---------- */')[0],context);
 assert.equal(context.darkPage(),false);assert.equal(context.schemeTheme().primaryTextColor,foreground);
 background='#1e1e1e';foreground='#d4d4d4';
 assert.equal(context.darkPage(),true);assert.equal(context.schemeTheme().primaryTextColor,foreground);
 const original='classDef event fill:#FFE0B2,stroke:#E65100\nclassDef method fill:#BBDEFB,stroke:#1565C0\nclassDef form fill:#EEEEEE,stroke:#616161\nclassDef constr fill:#E1BEE7,stroke:#6A1B9A\nclassDef enh fill:#FCE4EC,stroke:#AD1457\nclassDef func fill:#C8E6C9,stroke:#2E7D32';
 const dark=context.darkened(original);
 const fills=[...dark.matchAll(/fill:(#[\da-f]+)/gi)].map(m=>m[1]);
 assert.equal(new Set(fills).size,6);
 for(const fill of fills){const c=context.channels(fill);assert.ok(.299*c[0]+.587*c[1]+.114*c[2]<128);}
 assert.ok(dark.includes('color:'+foreground));
});
