"use strict";
const localAnalysis = require('./local-analysis');
const actions=[['navigator','Object Navigator'],['uml','UML diagram'],['metrics','Metrics'],['scheme','Logic view'],['calls','Calls diagram'],['diff','Diff']];
function register(vscode,context,sapCode,showTools){
 context.subscriptions.push(vscode.commands.registerCommand('vertex.tools.localPackage',async selected=>{
  try{
   const uri=selected?.resourceUri||selected?.uri||selected;
   const fs=require('fs'),path=require('path');
   let directory;
   if(uri?.scheme==='file')directory=fs.statSync(uri.fsPath).isDirectory()?uri:vscode.Uri.file(path.dirname(uri.fsPath));
   else {
    const active=vscode.window.activeTextEditor?.document?.uri;
    const defaultUri=active?.scheme==='file'?vscode.Uri.file(path.dirname(active.fsPath)):vscode.workspace.workspaceFolders?.[0]?.uri;
    const picked=await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,
      openLabel:'Analyze ABAP folder',defaultUri});
    if(!picked?.length)return;
    directory=picked[0];
   }
   if(directory.scheme!=='file')throw new Error('Select a local folder containing ABAP sources.');
   const local=await localAnalysis.createPackage(vscode,directory);
   return showTools({...require('./resources/object-tools').normalize({name:local.object.object_name,type:'DEVC',action:'uml'}),boundObject:true,localSession:local});
  }catch(error){vscode.window.showErrorMessage('VERTEX Tools: '+error.message);}
 }));
 for(const [action] of actions)context.subscriptions.push(vscode.commands.registerCommand('vertex.tools.'+action,async selected=>{
  try{
   let object=selected?.object_name?selected:selected?.object?.object_name?selected.object:null;
   let document;
   const uri=selected?.resourceUri||selected?.uri||(selected?.scheme?selected:null);
   if(!object){
    document=uri?await vscode.workspace.openTextDocument(uri):vscode.window.activeTextEditor?.document;
    object=document&&(sapCode.documentObject(document)||localAnalysis.sourceObject(document));
    if((!object?.object_name||!object?.object_type)&&document){
     const source=document.getText();
     const match=/^\s*(CLASS|INTERFACE|REPORT|PROGRAM)\s+([\w/]+)/im.exec(source);
     if(match)object={object_name:match[2],object_type:match[1]==='CLASS'?'CLAS':match[1]==='INTERFACE'?'INTF':'PROG'};
    }
   }
   if(!object?.object_name||!object?.object_type)throw new Error('Select an ABAP object or open its source first.');
   const local=localAnalysis.isLocalAbap(document)?localAnalysis.create(vscode,document,object):null;
   if(local&&action==='diff')throw new Error('Version history needs a SAP system; local files have no ADT versions.');
   // The UI route is named flow; calls is only the diagram's mode and command.
   const initial={name:String(object.object_name).toUpperCase(),type:String(object.object_type).toUpperCase(),action:action==='calls'?'flow':action};
   const editor=vscode.window.activeTextEditor;
   if(document&&editor?.document===document&&editor.selection&&['scheme','calls'].includes(action)){
    const lines=document.getText().split(/\r?\n/),at=editor.selection.active.line;
    const declaration=/^\s*(?:CLASS-)?METHODS\s+([\w~]+)/i.exec(lines[at]||'');
    let method=declaration&&declaration[1];
    if(!method)for(let i=at;i>=0;i--){
     if(/^\s*ENDMETHOD\b/i.test(lines[i]))break;
     const match=/^\s*METHOD\s+([\w~]+)/i.exec(lines[i]);if(match){method=match[1];break;}
    }
    if(method)initial.part=method.toUpperCase();
   }
   // Validate before opening a webview: invalid actions must produce an
   // error message, not abort its script and leave all controls blank.
   return showTools({...require('./resources/object-tools').normalize(initial),boundObject:true,
    ...(object.system_name?{systemName:object.system_name}:{}),
    // The editor it was opened from: its cursor and the lines the window opens belong to it, VERTEX tab or not.
    ...(document?.uri?{sourceUri:document.uri.toString()}:{}),
    ...(local?{localSession:local}:{}),
    ...(document&&editor?.document===document&&editor.selection?{cursorLine:editor.selection.active.line+1}:{})});
  }catch(error){vscode.window.showErrorMessage('VERTEX Tools: '+error.message);}
 }));
}
module.exports={register,actions};
