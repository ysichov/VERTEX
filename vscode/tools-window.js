"use strict";
const fs = require("fs"), path = require("path");
function html(pages, initial) {
  const read = name => fs.readFileSync(path.join(pages, name), "utf8");
  const bundle = {};
  // The magnifier every diagram has is one file; a page that draws diagrams marks where it goes.
  const lens = read("vertex-lens.js");
  for (const name of ["chat", "metrics", "versions", "table"]) bundle[name] = read(name + ".html").replace("/*VERTEX_LENS*/", () => lens)
    .replace("</head>", () => "<style>" + read("vertex-controls.css") + "</style></head>");
  return read("tools.html")
    .replace("/*INIT*/null/*INIT*/", () => JSON.stringify(initial || null).replace(/</g, "\\u003c"))
    .replace("/*OBJECT_MODEL*/", () => read("object-tools.js"))
    .replace("/*TOOL_ROUTES*/", () => read("tool-routes.js"))
    .replace("/*BUNDLE*/{}", () => JSON.stringify(bundle).replace(/</g, "\\u003c"));
}
// The docked panel deliberately contains only the debugger page.  Its source
// stays in the normal VS Code editor next to it; unlike Tools it has no object
// picker, chat or duplicate source tab.
function debugHtml(initial) {
  const controls = fs.readFileSync(path.join(__dirname, "resources", "vertex-controls.css"), "utf8");
  const bridge = `<script>
    const host=acquireVsCodeApi();let pending;
    window.sdeTake=()=>{const value=pending;pending=null;return value;};
    window.sdeDebug=(command,args)=>host.postMessage({call:"debug",args:[command,JSON.stringify(args||{})]});
    window.sdeSource=(name,type)=>host.postMessage({call:"source",args:[name,type]});
    window.sdeAsset=name=>host.postMessage({call:"asset",args:[name]});
    window.sdeReveal=frame=>host.postMessage({call:"reveal",args:[JSON.stringify(frame||{})]});
    window.sdeOrigin=request=>host.postMessage({call:"origin",args:[JSON.stringify(request||{})]});
    window.sdeDebugContext=payload=>host.postMessage({call:"debugContext",args:[String(payload||"null")]});
    window.addEventListener("message",event=>{
      const logic=document.getElementById("logic-tools-frame");
      if(event.data.vertexLogicRequest&&logic&&event.source===logic.contentWindow){host.postMessage({call:"inlineLogic",payload:event.data.vertexLogicRequest});return;}
      if(event.data.type==="inlineLogicHtml"){if(typeof sdeLogicHtml==="function")sdeLogicHtml(event.data.payload);return;}
      if(event.data.type==="inlineLogicReply"){if(logic)logic.contentWindow.postMessage(event.data.payload,"*");return;}
      if(event.data.type==="result"){pending=event.data.payload;sdeReady();}
      if(event.data.type==="debug")sdeDebugEvent(event.data.payload);
      if(event.data.type==="origin")sdeOriginReady(event.data.payload);
      if(event.data.type==="originProgress")sdeOriginProgress(event.data.payload);
      if(event.data.type==="cursor"&&typeof sdeCursor==="function")sdeCursor(event.data.payload);
    });
    document.addEventListener("DOMContentLoaded",()=>document.querySelectorAll(
      "#visual,#rec,#zonly,#fclasses,#fmethods,#initials,#globals,#locals,#params,[data-pane]"
    ).forEach(button=>button.classList.add("vertex-toggle")));
  <\/script>`;
  return fs.readFileSync(path.join(__dirname, "pages", "visual-debug.html"), "utf8")
    .replace("</head>", "<style>" + controls + "</style></head>")
    .replace("/*INIT*/null/*INIT*/", () => JSON.stringify(initial || null).replace(/</g, "\\u003c"))
    .replace("<body>", "<body class=\"vertex-docked-debug\">")
    .replace("<script>", bridge + "<script>");
}
function allowed(resource, body) {
  if (typeof resource !== "string" || /[\\#]/.test(resource) || /\.\.|%2e|%5c/i.test(resource)) return false;
  return body != null
    ? /^\/sap\/bc\/adt\/vertex\/review\/[^?]+(?:\?.*)?$/.test(resource)
    : /^\/sap\/bc\/adt\/vertex\/(about|requests|(?:table|join|metrics|flow|class|package|versions|review)\/[^?]+)(?:\?.*)?$/.test(resource)
      // The object field's mask search: ADT's quick search, read only.
      || /^\/sap\/bc\/adt\/repository\/informationsystem\/search\?operation=quickSearch&maxResults=\d{1,3}&objectType=[A-Z]{4}%2F[A-Z]{1,2}&query=[A-Z0-9_%*+$]{1,80}$/.test(resource);
}
/* What the Visual Debug page may ask of the debugger - no more: it reads,
   sets breakpoints, steps and starts a run, as the debug_* tools do. */
async function debugCommand(dbg, command, a, fetchVertex) {
  switch (command) {
    // ACE's statement map of a program, for stepping without the stack.
    case "statements": {
      if (!/^[A-Za-z0-9_/$=]+$/.test(String(a.program || ""))) { throw new Error("A program name is needed for the statement map."); }
      const raw = await fetchVertex("/sap/bc/adt/vertex/flow/" + encodeURIComponent(String(a.program).toUpperCase()) + "?mode=statements&type=PROG");
      if (typeof raw === "string" && raw.indexOf("ERROR:") === 0) { throw new Error(raw.slice(6)); }
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }
    case "picture": return dbg.picture();
    case "source": return { url: a.url, source: await dbg.source(a.url) };
    case "methods": return { url: a.url, methods: await dbg.classMethods(a.url, { fresh: true }) };
    case "set": {
      const bp = await dbg.setBreakpointAt({ url: a.url, line: a.line, condition: a.condition, mode: a.mode, take_over: a.take_over === true });
      return { id: bp.id };
    }
    // A point by the object's name, for places the window did not read as a
    // source: the analysis names them that way.
    case "setAt": {
      const made = await dbg.setBreakpoint({ object_type: a.object_type, name: a.name, line: a.line });
      return { id: made.id };
    }
    case "clear": await dbg.clearBreakpoints(a.id); return {};
    case "activate": await dbg.activateBreakpoints(a.id, a.active !== false); return {};
    case "step": return (await dbg.advance(a.kind, a.quick === true, a.expect)) || {};
    case "vars": return { variables: await dbg.variables(a.names) };
    case "frame": await dbg.frame(a.n); return {};
    case "scopes": return dbg.scopes(a.sy !== false);
    case "children": return { id: a.id, children: await dbg.children(a.id) };
    case "rows": return dbg.tableRows(a.id, a.from, a.to);
    case "value": return dbg.read(a.name, 1, 5);
    case "run": return { url: await dbg.run(a.program, a.test) };
    case "opendump": return { url: await dbg.openDump() };
    case "dumppage": return dbg.dumpPage(String(a.id || ""));
    case "checkdumps": return dbg.checkDumps();
    case "stop": await dbg.stop(); return {};
    case "detach": await dbg.detach(); return {};
    case "terminate": await dbg.terminate(); return {};
    case "settle": return { settled: await dbg.settle() };
    case "runTo": return dbg.runTo(a.url, a.lines || a.line);
  }
  throw new Error("Visual Debug has no command " + command + ".");
}
function open(vscode, context, deps, initial) {
  // The window keeps the system that was active when it opened: another one
  // chosen later is for the windows opened after. The tab names it.
  const opened = deps.active();
  const system = opened.error ? "" : opened.system.name;
  const pin = work => deps.pin ? deps.pin(system, work) : work();
  const panel = deps.panel || vscode.window.createWebviewPanel("vertex.tools", initial?.boundObject ? initial.name + " · VERTEX Tools" : system ? "VERTEX " + system : "VERTEX Tools", // Run Select opens SelecTor beside the code it came from.
    initial?.boundObject || initial?.selectorPlan ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  const ask = deps.chat();
  const bridge = `<script>
    const host = ${deps.panel ? '({postMessage:message=>parent.postMessage({vertexLogicRequest:message},"*")})' : 'acquireVsCodeApi()'}; let pending;
    // The embedded chat may offer the direct Anthropic provider in VS Code.
    // Eclipse hosts the same HTML but deliberately does not define this flag.
    window.sdeAnthropicApi=()=>true;
    window.sdeFrontendAnalysis=()=>true;
    window.sdeCancelWorkspace=()=>host.postMessage({call:"cancelWorkspace",args:[]});
    window.sdeTake=()=>{const r=pending;pending=null;return r;};
    for(const call of ["workspace","asset","models","ask","browse","openToolSource","requestSearch","vertexContext","aiProvider","aiModel","aiConfig"]){
      window["sde"+call[0].toUpperCase()+call.slice(1)]=(...args)=>{
        if(call==="vertexContext")try{
          const state=JSON.parse(args[0]||"{}"),object=state.workspace;
          if(object&&object.name&&object.type){
            const value=JSON.stringify({webviewSection:"vertex-object",object_name:object.name,object_type:object.type});
            document.body.setAttribute("data-vscode-context",value);
            document.querySelectorAll("iframe").forEach(frame=>{try{frame.contentDocument.body.setAttribute("data-vscode-context",value);}catch(error){}});
          }
        }catch(error){}
        host.postMessage({call,args});
      };
    }
    window.addEventListener("message",e=>{
      if(e.data.type==="result"){pending=e.data.payload;sdeReady();}
      if(e.data.type==="codeFocus"&&typeof sdeCodeFocus==="function")sdeCodeFocus();
      if(e.data.type==="codeCursor"&&typeof sdeCodeCursor==="function")sdeCodeCursor(e.data.payload);
      if(e.data.type==="progress"&&typeof sdeWorkspaceProgress==="function")sdeWorkspaceProgress(e.data.path,e.data.payload);
      if(e.data.type==="assistant")sdeAssistant(e.data.payload);
      if(e.data.type==="requestSearch"){
        const child=document.getElementById("result").contentWindow;
        if(child&&typeof child.sdeDeliver==="function")child.sdeDeliver(e.data.payload);
      }
    });
  <\/script>`;
  panel.webview.html = html(deps.pages, initial).replace("<script>", bridge + "<script>");
  // The chat here offers what the VERTEX panel does: its provider, the models
  // Config models switched on, and the chosen one - one setting for both.
  let chatWho = "";
  const postModels = async () => {
    let answer;
    try {
      const list = await ask.listModels();
      answer = { call: "models", assistant: chatWho, models: list.models,
                 shared: { provider: ask.state().provider, providers: ask.state().providers, model: list.model } };
    } catch (e) { answer = { call: "models", assistant: chatWho, error: e.message }; }
    await panel.webview.postMessage({ type: "assistant", payload: JSON.stringify(answer) });
  };
  const changes = vscode.workspace.onDidChangeConfiguration(event => {
    if (chatWho && event.affectsConfiguration("vertex.ai")) { void postModels(); }
  });
  // What the assistant is told about the open Tools window ends with the window: a closed class is not in the context.
  let cursorTimer,scrollTimer,sourceNavigationUntil=0;
  const cursorChanges=initial?.boundObject&&vscode.window.onDidChangeTextEditorSelection?vscode.window.onDidChangeTextEditorSelection(event=>{
    clearTimeout(cursorTimer);
    if(Date.now()<sourceNavigationUntil)return;
    cursorTimer=setTimeout(()=>{
      if(Date.now()<sourceNavigationUntil)return;
      const object=deps.documentObject(event.textEditor.document),selection=event.selections[0];
      if(object&&selection)void panel.webview.postMessage({type:'codeCursor',payload:{name:object.object_name,type:object.object_type,line:selection.start.line+1,endLine:selection.end.line+1,userFocus:event.kind!=null}});
    },80);
  }):null;
  const scrollChanges=initial?.boundObject&&vscode.window.onDidChangeTextEditorVisibleRanges?vscode.window.onDidChangeTextEditorVisibleRanges(event=>{
    clearTimeout(scrollTimer);
    if(Date.now()<sourceNavigationUntil)return;
    scrollTimer=setTimeout(()=>{
      if(Date.now()<sourceNavigationUntil)return;
      const object=deps.documentObject(event.textEditor.document),ranges=event.visibleRanges;
      if(!object||!ranges.length)return;
      const range=ranges[0],line=range.start.line+Math.floor((range.end.line-range.start.line)/3)+1;
      void panel.webview.postMessage({type:'codeCursor',payload:{name:object.object_name,type:object.object_type,line,endLine:line,scrollOnly:true,userFocus:event.textEditor===vscode.window.activeTextEditor}});
    },100);
  }):null;
  const focusChanges=initial?.boundObject&&vscode.window.onDidChangeActiveTextEditor?vscode.window.onDidChangeActiveTextEditor(editor=>{
   if(editor&&Date.now()>=sourceNavigationUntil)void panel.webview.postMessage({type:'codeFocus'});
  }):null;
  let reported = false, analysisJob;
  panel.onDidDispose(() => { if(analysisJob)analysisJob.cancelled=true;clearTimeout(cursorTimer);clearTimeout(scrollTimer);if(scrollChanges)scrollChanges.dispose();if(focusChanges)focusChanges.dispose();if(cursorChanges)cursorChanges.dispose();changes.dispose(); if (reported) { deps.setContext(null); } });
  panel.webview.onDidReceiveMessage(message => pin(async () => {
    const args = message.args || [];
    try {
      if(message.call==="debug"&&args[0]==="logicTools"){
        const selected=JSON.parse(String(args[1]||"{}"));
        await vscode.commands.executeCommand("vertex.tools",{...selected,action:"scheme",boundObject:true});
        await panel.webview.postMessage({type:"result",payload:"{}"});return;
      }
      if(message.call === "openToolSource") { sourceNavigationUntil=Date.now()+700; await deps.openToolSource(JSON.parse(String(args[0]||"{}"))); return; }
      if(message.call === "browse") {
        if(/^https?:\/\//i.test(String(args[0]))) await vscode.env.openExternal(vscode.Uri.parse(args[0]));
        return;
      }
      if(message.call === "requestSearch") {
        const user=String(args[0]||"").trim().toUpperCase();
        let resource="/sap/bc/adt/vertex/requests";
        if(user) resource+="?user="+encodeURIComponent(user);
        if(args[1]) resource+=(user?"&":"?")+"released=true";
        const payload=await deps.fetch(context,resource);
        await panel.webview.postMessage({type:"requestSearch",payload}); return;
      }
      if(message.call === "origin") {
        // The same analysis the editor command runs, asked for by object and
        // variable: the window needs the places a value can be changed.
        const payload=JSON.stringify(await deps.originPoints(JSON.parse(String(args[0]||"{}"))));
        await panel.webview.postMessage({type:"result",payload}); return;
      }
      if(message.call === "vertexContext") {
        // tools.html sends the state as JSON text (Eclipse's bridge takes
        // strings only); an object is accepted as well.
        let state=args[0];
        if(typeof state==="string"){try{state=JSON.parse(state);}catch(e){state=null;}}
        if(!state||typeof state!=="object")state={};
        if(initial?.boundObject&&state.workspace?.name)panel.title=state.workspace.name+" · VERTEX Tools";
        reported=true;
        deps.setContext({system,workspace:state.workspace||initial||null,vertex_view:state.vertex_view||null,
          selected_fragment:state.selected_fragment||null});
        return;
      }
      if(message.call === "models") { chatWho=String(args[0]||""); await postModels(); return; }
      if(message.call === "aiProvider") { await ask.setProvider(args[0]); await postModels(); return; }
      if(message.call === "aiModel") { await ask.setModel(args[0]); return; }
      if(message.call === "aiConfig") { ask.configModels(); return; }
      if(message.call === "ask") {
        // The provider and model are the VERTEX panel's, shared by every window.
        const result = await ask(args[2], {model:args[1],state:JSON.parse(args[3]||"{}")});
        await panel.webview.postMessage({type:"assistant",payload:JSON.stringify({call:"ask",
          plan:{answer:result.answer,navigation:result.navigation||null},model:result.model,usage:result.usage,
          direct:result.direct,choices:result.choices||[]})}); return;
      }
      let payload;
      if(message.call === "cancelWorkspace") {if(analysisJob)analysisJob.cancelled=true;return;}
      if(message.call === "asset") payload=deps.asset(args[0]);
      else if(message.call === "workspace" && args[0] === "project") {
        const selected=deps.active();payload=selected.error?"ERROR:"+selected.error:selected.system.name;
      } else if(message.call === "workspace" && allowed(args[0],args[1])) {
        const job={cancelled:false};analysisJob=job;
        payload=await deps.fetch(context,args[0],args[1]==null?undefined:String(args[1]),text=>{
          if(!job.cancelled)void panel.webview.postMessage({type:"progress",path:args[0],payload:text});
        },()=>job.cancelled);
        if(analysisJob===job)analysisJob=null;
      } else throw new Error("Unsupported VERTEX request.");
      await panel.webview.postMessage({type:"result",payload});
    } catch(error) {
      const ai=message.call==="ask"||message.call==="models";
      await panel.webview.postMessage({type:ai?"assistant":"result",payload:ai?
        JSON.stringify({call:message.call,assistant:args[0],error:error.message}):"ERROR:"+error.message});
    }
  }), undefined, context.subscriptions);
  return panel;
}
module.exports={open,html,debugHtml,allowed,debugCommand};
