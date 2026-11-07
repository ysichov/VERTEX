"use strict";
const path=require("node:path"),fs=require("node:fs");
const reviews=new Map();
function register(panel,files){reviews.set(panel,files);return ()=>reviews.delete(panel);}
function normalize(value){return String(value).replace(/\\/g,"/").replace(/^\.\//,"");}
function references(text,aliases){
  // Match only names known to the host, including extensionless project files.
  const normalize=value=>String(value).replace(/\\/g,"/").replace(/^\.\//,"");
  if(aliases.has(normalize(text)))return [{start:0,end:text.length,reference:text}];
  const matches=[];const pattern=/(?:[A-Za-z]:[\\/])?[\p{L}\p{N}_@.-]+(?:[\\/][\p{L}\p{N}_@.-]+)*/gu;
  for(const match of text.matchAll(pattern)){
    let name=match[0],end=match.index+name.length;
    if(!aliases.has(normalize(name))&&/[.,]$/.test(name)){name=name.slice(0,-1);end--;}
    if(aliases.has(normalize(name)))matches.push({start:match.index,end,reference:name});
  }
  return matches;
}
function reviewEntries(){return [...reviews].reverse().flatMap(([panel,get])=>get().map(file=>({...file,panel})));}
async function files(vscode){
  const entries=reviewEntries().map(({path:filename,relative})=>({path:filename,relative}));
  if(vscode.workspace.findFiles&&vscode.RelativePattern){
    for(const folder of vscode.workspace.workspaceFolders||[]){
      if(folder.uri.scheme!=="file")continue;
      const uris=await vscode.workspace.findFiles(new vscode.RelativePattern(folder,"**/*"),"**/{.git,node_modules,target,dist,build,.next,vendor}/**",6000);
      for(const uri of uris)if(uri.scheme==="file")entries.push({path:uri.fsPath,relative:path.relative(folder.uri.fsPath,uri.fsPath)});
    }
  }
  return entries;
}
async function catalog(vscode){
  const aliases=new Set();for(const entry of await files(vscode))for(const name of [entry.path,entry.relative,path.basename(entry.path)])if(name)aliases.add(normalize(name));
  return [...aliases];
}
function matches(entry,reference){const name=normalize(reference);return [entry.path,entry.relative,path.basename(entry.path)].some(value=>normalize(value)===name);}
async function choose(vscode,entries){
  const unique=[...new Map(entries.map(entry=>[entry.path,entry])).values()];
  if(unique.length<=1)return unique[0];
  const picked=await vscode.window.showQuickPick(unique.map(entry=>({label:entry.relative||path.basename(entry.path),description:entry.path,entry})),{placeHolder:"Choose the referenced file"});return picked?.entry;
}
async function open(vscode,reference){
  if(typeof reference!=="string"||reference.length>4096||reference.includes("\0"))throw new Error("Invalid file reference.");
  const reviewed=reviewEntries().filter(entry=>matches(entry,reference));
  const active=reviewed.filter(entry=>entry.panel.active),visible=reviewed.filter(entry=>entry.panel.visible);
  const selected=await choose(vscode,active.length?active:visible.length?visible:reviewed);
  if(selected){selected.panel.reveal(undefined,false);await selected.panel.webview.postMessage({action:"selectFile",file:selected.id});return "review";}
  if(reviewed.length)return; // A disambiguation was cancelled.
  const candidates=(await files(vscode)).filter(entry=>matches(entry,reference));
  const selectedFile=await choose(vscode,candidates);
  if(!selectedFile){if(candidates.length)return;throw new Error("The referenced file is not available in the open project.");}
  const filename=fs.realpathSync(selectedFile.path);
  const allowed=(vscode.workspace.workspaceFolders||[]).some(folder=>{if(folder.uri.scheme!=="file")return false;const relative=path.relative(fs.realpathSync(folder.uri.fsPath),filename);return relative!==".."&&!relative.startsWith(".."+path.sep)&&!path.isAbsolute(relative)&&!relative.split(path.sep).includes(".git");});
  if(!allowed||!fs.statSync(filename).isFile())throw new Error("The referenced file is outside the open project.");
  await vscode.commands.executeCommand("vscode.open",vscode.Uri.file(filename));return "file";
}
module.exports={register,catalog,references,open};
