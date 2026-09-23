"use strict";
const fs = require("fs"), path = require("path");
function html(pages, initial) {
  const read = name => fs.readFileSync(path.join(pages, name), "utf8");
  const bundle = {};
  for (const name of ["chat", "metrics", "versions", "table", "source"]) bundle[name] = read(name + ".html");
  return read("tools.html")
    .replace("/*INIT*/null/*INIT*/", () => JSON.stringify(initial || null).replace(/</g, "\\u003c"))
    .replace("/*OBJECT_MODEL*/", () => read("object-tools.js"))
    .replace("/*TOOL_ROUTES*/", () => read("tool-routes.js"))
    .replace("/*BUNDLE*/{}", () => JSON.stringify(bundle).replace(/</g, "\\u003c"));
}
function allowed(resource, body) {
  if (typeof resource !== "string" || /[\\#]/.test(resource) || /\.\.|%2e|%5c/i.test(resource)) return false;
  return body != null
    ? /^\/sap\/bc\/adt\/vertex\/(review|prepare)\/[^?]+(?:\?.*)?$/.test(resource)
    : /^\/sap\/bc\/adt\/vertex\/(about|requests|(?:table|join|metrics|flow|class|package|versions|review|prepare)\/[^?]+)(?:\?.*)?$/.test(resource);
}
function open(vscode, context, deps, initial) {
  // The window keeps the system that was active when it opened: another one
  // chosen later is for the windows opened after. The tab names it.
  const opened = deps.active();
  const system = opened.error ? "" : opened.system.name;
  const pin = work => deps.pin ? deps.pin(system, work) : work();
  const panel = vscode.window.createWebviewPanel("vertex.tools", system ? "VERTEX " + system : "VERTEX Tools", vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  const ask = deps.chat();
  const bridge = `<script>
    const host = acquireVsCodeApi(); let pending;
    // The embedded chat may offer the direct Anthropic provider in VS Code.
    // Eclipse hosts the same HTML but deliberately does not define this flag.
    window.sdeAnthropicApi=()=>true;
    window.sdeTake=()=>{const r=pending;pending=null;return r;};
    for(const call of ["workspace","asset","models","ask","browse","requestSearch","source","vertexContext","aiProvider","aiModel","aiConfig"]){
      window["sde"+call[0].toUpperCase()+call.slice(1)]=(...args)=>host.postMessage({call,args});
    }
    window.addEventListener("message",e=>{
      if(e.data.type==="result"){pending=e.data.payload;sdeReady();}
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
  panel.onDidDispose(() => changes.dispose());
  panel.webview.onDidReceiveMessage(message => pin(async () => {
    const args = message.args || [];
    try {
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
      if(message.call === "source") {
        if(!["PROG","CLAS","FUNC"].includes(args[1])) throw new Error("Unsupported source type.");
        const payload=JSON.stringify(await deps.source({object_name:args[0],object_type:args[1]}));
        await panel.webview.postMessage({type:"result",payload}); return;
      }
      if(message.call === "vertexContext") {
        // tools.html sends the state as JSON text (Eclipse's bridge takes
        // strings only); an object is accepted as well.
        let state=args[0];
        if(typeof state==="string"){try{state=JSON.parse(state);}catch(e){state=null;}}
        if(!state||typeof state!=="object")state={};
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
          plan:{answer:result.answer,navigation:result.navigation||null},model:result.model,usage:result.usage})}); return;
      }
      let payload;
      if(message.call === "asset") payload=deps.asset(args[0]);
      else if(message.call === "workspace" && args[0] === "project") {
        const selected=deps.active();payload=selected.error?"ERROR:"+selected.error:selected.system.name;
      } else if(message.call === "workspace" && allowed(args[0],args[1])) {
        payload=await deps.fetch(context,args[0],args[1]==null?undefined:String(args[1]));
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
module.exports={open,html,allowed};
