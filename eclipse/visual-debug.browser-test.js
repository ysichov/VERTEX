'use strict';
// Browser-level contract test with simulated native replies. No SAP session is touched.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'target/visual-debug-qa');fs.mkdirSync(out,{recursive:true});
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const assets={controls:'resources/vertex-controls.css',flow:'resources/vertex-flow.js',flowGraph:'resources/vertex-flow-graph.js',abapControl:'resources/vertex-abap-control.js',lens:'resources/vertex-lens.js',mermaid:'resources/mermaid.min.js'};
const source='REPORT zvertex_debug_lab.\nDATA lv_result TYPE i.\nSTART-OF-SELECTION.\nlv_result = 1.\nlv_result = lv_result + 1.\nWRITE lv_result.';
const theme=read('eclipse/value-origin.html').match(/<style id="theme">[\s\S]*?<\/style>/)[0];
const url='/sap/bc/adt/programs/programs/zvertex_debug_lab/source/main';
const fixture=`
window.vertexEclipseRead=async()=>${JSON.stringify(source)};
window.vertexEclipseSource=async()=>({source_url:${JSON.stringify(url)},object_name:'ZVERTEX_DEBUG_LAB',object_type:'PROG',source:${JSON.stringify(source)}});
window.vertexEclipseRequest=async()=>({statements:[]});
window.vertexEclipseDebugAnalysis=async()=>({object_name:'ZVERTEX_DEBUG_LAB',name:'',globals:[],locals:[],params:[]});
window.sdeOpenToolSource=raw=>window.lastRevealed=JSON.parse(raw);
window.sdeCopyText=text=>{window.copied=text;return '';};
window.sdeNativeDebug=(command,args,id)=>window.nativeFixture(command,args).then(value=>vertexNativeReply(id,value,false),error=>vertexNativeReply(id,error.message,true));
`;
const html=read('vscode/pages/visual-debug.html').replace('/*INIT*/null/*INIT*/',JSON.stringify({name:'ZVERTEX_DEBUG_LAB',type:'PROG'}))
  .replace('</head>',theme+'<style>'+read('org.vertex.abap.ui/resources/vertex-controls.css')+'</style></head>')
  .replace('<body>','<body class="vertex-docked-debug">').replace('<script>','<script>'+fixture+read('eclipse/visual-debug-host.js')+'</script><script>');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  for(const colorScheme of ['light','dark']){
   const page=await browser.newPage({viewport:{width:900,height:950},colorScheme});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   let stop=1,line=4;
   const picture=()=>({system:'ALC',ended:0,listening:true,breakpoints:[{id:'bp1',name:'ZVERTEX_DEBUG_LAB',objectType:'PROG',url,line:6,mode:'stop',active:true}],
    stopped:{at:'stop '+stop,frames:[{n:0,label:'ZVERTEX_DEBUG_LAB:'+line+' EVENT START-OF-SELECTION',url,line,program:'ZVERTEX_DEBUG_LAB',include:'ZVERTEX_DEBUG_LAB',unit:'START-OF-SELECTION',unitType:'EVENT',current:true,system:false}]}});
   await page.exposeFunction('nativeFixture',async(command,raw)=>{
    const a=JSON.parse(raw);let value;
    if(command==='asset')return read('org.vertex.abap.ui/'+assets[a.name]);
    if(command==='picture')value=picture();
    else if(command==='scopes')value={groups:[{id:'@LOCALS',name:'Locals'}],sy:null};
    else if(command==='children')value={id:a.id,children:[{id:'LV_RESULT',name:'LV_RESULT',type:'I',meta:'simple',value:String(stop)}]};
    else if(command==='vars')value={variables:a.names.map(name=>({id:name,name,type:'I',meta:'simple',value:String(stop)}))};
    else if(command==='step'){stop++;line++;setTimeout(()=>page.evaluate(p=>vertexNativeEvent(JSON.stringify(p)),picture()).catch(()=>{}),10);value={};}
    else throw new Error('Unexpected native command '+command);
    return JSON.stringify(value);
   });
   await page.setContent(html);
   await page.waitForFunction(()=>document.getElementById('vars').textContent.includes('LV_RESULT'));
   await page.locator('[data-rec="values"]').click();
   await page.locator('#over').click();
   await page.waitForFunction(()=>flow.timeline.length===2 && document.getElementById('state').textContent.includes(':5'));
   await page.evaluate(()=>{chosenValue={name:'LV_RESULT'};return readChosenValue();});
   await page.locator('#over').click();
   await page.waitForFunction(()=>flow.timeline.length===3 && flow.timeline[2].watch?.read?.length);
   const saved=await page.evaluate(()=>JSON.stringify(flow.timeline));
   await page.locator('#fprev').click();
   await page.waitForFunction(()=>replayAt===1);
   assert.equal(await page.evaluate(()=>JSON.stringify(flow.timeline)),saved,'replay must not mutate the record');
   assert.equal(await page.evaluate(()=>window.lastRevealed.line),5,'player reveals the selected recorded source');
   await page.locator('#flast').click();
   await page.locator('[data-pane="bpsec"]').click();
   await page.screenshot({path:path.join(out,'visual-debug-'+colorScheme+'.png'),fullPage:true});
   assert.deepEqual(errors,[],colorScheme+' page must run without JavaScript errors');
   console.log(colorScheme+': native replies, steps, variables, recording, replay and source navigation passed');
   await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
