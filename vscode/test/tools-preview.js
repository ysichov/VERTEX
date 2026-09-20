"use strict";
// Local fixture for browser QA; no SAP credentials or requests.
const http = require("http"), path = require("path"), fs = require("fs");
const pages = path.resolve(__dirname, "../../org.vertex.abap.ui/resources");
const html = require("../tools-window").html(pages, null);
const graph = {object:"ZAPP",nodes:[
  {name:"ZCL_ORDER",kind:"class",methods:[{name:"SAVE",visibility:"public"},{name:"CHECK",visibility:"private"}]},
  {name:"ZIF_ORDER",kind:"interface",methods:[{name:"SAVE",visibility:"public"}]}
],edges:[{source:"ZCL_ORDER",target:"ZIF_ORDER",kind:"implementation"}]};
const bridge = `<script>
let pending;
function sdeTake(){return pending;}
function sdeWorkspace(path,body){
 fetch("/mock?path="+encodeURIComponent(path)).then(r=>r.text()).then(v=>{pending=v;sdeReady();});
}
function sdeAsset(){fetch("/mermaid.js").then(r=>r.text()).then(v=>{pending=v;sdeReady();});}
function sdeModels(id){setTimeout(()=>sdeAssistant(JSON.stringify({call:"models",assistant:id,models:[{id:"fixture",label:"Fixture"}]})),0);}
function sdeAsk(){setTimeout(()=>sdeAssistant(JSON.stringify({call:"ask",plan:{answer:"Opening package UML.",navigation:{type:"DEVC",name:"ZAPP",action:"uml"}}})),0);}
function sdeBrowse(){}
<\/script>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost");
  if(url.pathname==="/mermaid.js"){res.setHeader("Content-Type","text/javascript");res.end(fs.readFileSync(path.join(pages,"mermaid.min.js")));return;}
  if(url.pathname==="/mock"){
    const p=url.searchParams.get("path");
    let data;
    if(p==="project"){res.end("Local fixture");return;}
    if(p.endsWith("/about"))data={services:["metrics","flow","class","package","table","join","versions","review","prepare","requests"].map(name=>({name,active:true})),backends:[]};
    else if(p.includes("/package/")||p.includes("/class/"))data=graph;
    else if(p.includes("/versions/"))data={object:"ZCL_ORDER",parts:[]};
    else if(p.includes("/review/")){res.end("ERROR:No saved review for this request.");return;}
    else if(p.includes("/table/"))data={table:"SFLIGHT",fields:[],rows:[]};
    else data={object:"ZCL_ORDER",type:"clas",program:"ZCL_ORDER",units:[],totals:{}};
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify(data));return;
  }
  res.setHeader("Content-Type","text/html");res.end(html.replace("<script>",bridge+"<script>"));
});
server.listen(38791,"127.0.0.1",()=>console.log("Fixture: http://127.0.0.1:38791"));
