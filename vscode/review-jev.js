"use strict";
const crypto = require("crypto");
let storage;
function configure(secrets) { storage = secrets; }
async function rememberSuccess(key,model) {
  if(!storage?.get||!storage?.store)return;
  const scope="vertex.modelChecks.typesafe-api."+crypto.createHash("sha256").update(key).digest("hex");
  let checks;try{checks=JSON.parse(await storage.get(scope)||"{}");}catch(_){checks={};}
  if(!checks||typeof checks!=="object"||Array.isArray(checks))checks={};
  Object.defineProperty(checks,model,{value:{available:true,reason:"",checkedAt:new Date().toISOString()},enumerable:true,configurable:true,writable:true});await storage.store(scope,JSON.stringify(checks));
}
// Keep the general Jev question set stable for other callers (for example Git
// triage). Code review uses its own two-question contract below.
const questions = {
  context: {type:"choice",instructions:"Is the supplied before/after diff and adjacent context sufficient to assess the local change? Missing requirements or dependencies can require more context.",criteria:{sufficient:"Enough context for a local assessment",insufficient:"Need more method, dependency or requirement context"}},
  completed: {type:"choice",instructions:"Does this diff implement the latest actionable user request? Read earlier linked requests as intent and constraints, including what a restoration must recover; earlier work already present outside this diff need not appear again. Answer yes when the visible change implements the latest request, partial when only part is implemented, no when it contradicts or omits it, and unclear when the request or supplied context cannot establish completion. If context is insufficient, prefer unclear to an unsupported no. Do not infer test or runtime results.",criteria:{yes:"Да",partial:"Частично",no:"Нет",unclear:"Неясно"}},
  autoapprove: {type:"choice",instructions:"If you were the automated reviewer, would you approve this change based on the supplied user requests and visible diff? Answer yes only when the requested outcome is visibly implemented and there is no visible defect or essential missing evidence. Answer no otherwise. This estimates an approval decision; it does not apply the change.",criteria:{yes:"Yes, auto-approve",no:"No, require human review"}}
};
const codeReviewQuestions = {
  implementation: {type:"noul",instructions:"Реализация в блоке <code> соответствует одной из задач из блока <requirements>?"},
  syntax: {type:"noul",instructions:"Есть синтаксические ошибки в блоке <code>?"}
};
function codePrompt(state) {
  const requirements=state.task.trim()||"Требования пользователя к этой ревью не связаны.";
  const code=state.blocks.map(block=>"File: "+(block.file||state.object||"")+"\n"+block.after.join("\n")).join("\n\n");
  return "<requirements>\n"+requirements+"\n</requirements>\n\n<code>\n"+code+"\n</code>";
}
function selection(vscode) {
  const own=vscode.workspace.getConfiguration("vertex.ai").get("decisionModel",null);
  return own && ["typesafe-api","gemini-api","opencode-api"].includes(own.provider) && typeof own.model === "string"
    ? {provider:own.provider,model:own.model} : {provider:"typesafe-api",model:"jev-latest"};
}
/* Only exhaustion and outage, never a rejected request: a malformed decision input or an
   invalid answer must fail where it happened, not be asked again of another model. */
const SUBSTITUTABLE=new RegExp("\\b(429|503|529)\\b|rate limit|rate-limit|quota|exhausted|resource_exhausted|overloaded|temporarily unavailable|service unavailable|timed out|timeout","i");
function substitutable(error) {
  return SUBSTITUTABLE.test(String(error && error.message || error || ""));
}
/* The preferred model is usually the free one, so exhaustion is worth waiting out rather than
   paying another provider: when it says how long, and that is within the cap, it gets a second turn.
   Reuses the retry-after shape openai-compatible already parses; no header means no wait. */
const WAIT_CAP_MS=60250;
function retryDelay(error) {
  const after=error && error.retryAfter;
  if (after !== undefined && Number.isFinite(Number(after))) return Number(after)*1000;
  if (after && Number.isFinite(Date.parse(after))) return Date.parse(after)-Date.now();
  const hint=new RegExp("retry(?: again)?(?: in| after)\\s+(\\d+(?:\\.\\d+)?)\\s*(m?s|seconds?|minutes?)?","i")
    .exec(String(error && error.message || ""));
  if (!hint) return 0;
  const value=Number(hint[1]), unit=(hint[2]||"s").toLowerCase();
  return unit === "ms" ? value : unit.startsWith("m") && unit !== "ms" ? value*60000 : value*1000;
}
function sleep(ms, options) {
  return new Promise((resolve,reject) => {
    const timer=setTimeout(resolve,ms);
    options.signal?.addEventListener?.("abort",()=>{clearTimeout(timer);reject(new Error("Decision stopped."));},{once:true});
  });
}
/* Decision requests are paced by the same per-model budget as every other model; the budget itself
   is entered in LLM Providers beside the model. Kept here as thin wrappers so the decision call
   sites do not each have to name the provider and model twice. */
const budgets=require("./model-budget");
function estimateTokens(state, questions) { return budgets.estimateTokens({state, questions}); }
function substitutable(error) { return budgets.retryable(error); }
function retryDelay(error) { return budgets.retryDelay(error); }
function budget(vscode, connection) { return budgets.budget(vscode, connection.provider, connection.model); }
function callBudget(vscode, connection) { return budgets.callBudget(vscode, connection.provider, connection.model); }
async function paced(vscode, connection, size, run, options={}) {
  return budgets.paced(vscode, connection.provider, connection.model, size, run, options);
}
function correct(connection, estimated, actual) { return budgets.correct(connection.provider, connection.model, estimated, actual); }
function selectedProvider(vscode) { return selection(vscode).provider; }
function enabled(vscode) { return require("./model-config").isOn(vscode,selectedProvider(vscode)); }
async function connection(vscode) {
  const {provider,model}=selection(vscode);
  if (!storage?.get || !enabled(vscode)) return null;
  const {key}=await require("./key-profiles").getActiveKey(storage,provider);
  if (!key) return null;
  const config=require("./model-config").read(vscode,provider);
  if (config.enabled && !config.enabled.includes(model)) return null;
  const valid=provider === "typesafe-api" ? new RegExp("^jev[-\\w.]*$").test(model)
    : provider === "gemini-api" ? model.replace(new RegExp("^models/"), "") === "gemini-decision-1" : require("./opencode-models").isDecision(model);
  return valid?{provider,key,model}:null;
}
function validateContext(context,allowLarge=false) {
  if (!context || !Array.isArray(context.blocks) || !context.blocks.length) throw new Error("No current text diff blocks are available for ASK Jev.");
  const blocks=context.blocks.map(block=>{
    for(const field of ["before","after","context_before","context_after"]){if(!Array.isArray(block[field])||block[field].some(line=>typeof line!=="string"))throw new Error("Invalid review block context.");}
    return {file:String(block.file||context.object||""),block:block.block,unit:block.unit,line:block.line,before:block.before,after:block.after,context_before:block.context_before,context_after:block.context_after};
  });
  const scope=context.scope==="review"||context.scope==="file"?context.scope:"block";
  if(scope==="block"&&blocks.length!==1)throw new Error("Select one current diff block for ASK Jev.");
  const state={object:String(context.object||""),object_type:String(context.object_type||""),scope,
    review_target:context.primaryFile?"Assess primary file "+context.primaryFile+"; other files are supplemental context":scope==="review"?"All supplied text changes in this review":scope==="file"?"All supplied text changes in this file":"Only the selected diff block",
    primary_file:String(context.primaryFile||""),
    task:String(context.task||""),blocks,
    note:"Adjacent lines are context. This review does not run tests or verify runtime behavior."};
  if(scope==="block")state.block=blocks[0];
  if(!allowLarge&&JSON.stringify(state).length>90000)throw new Error("Review context is too large for one Jev decision. Assess a file or block instead.");
  return state;
}
async function assess(vscode,context,options={}) {
  const state=validateContext(context,true);
  const files=[...new Set(state.blocks.map(block=>block.file))];
  if(!options.single&&(JSON.stringify(state).length>90000||state.scope==="review"&&files.length>1)){
    if(state.scope==="block")throw new Error("This block is too large for one Jev decision.");
    const parts=[];
    for(const file of files){
      let current=[];
      for(const block of state.blocks.filter(block=>block.file===file)){
        const next=[...current,block];
        if(JSON.stringify({...state,blocks:next}).length>80000&&current.length){parts.push({file,blocks:current});current=[block];}
        else current=next;
        if(JSON.stringify({...state,blocks:current}).length>90000)throw new Error("One diff block is too large for Jev. Open the file and narrow the review.");
      }
      if(current.length)parts.push({file,blocks:current});
    }
    const results=[];
    for(const part of parts){
      if(options.signal?.aborted)throw new Error("Decision stopped.");
      let result=await assess(vscode,{...context,scope:"file",object:part.file,blocks:part.blocks},options);
      results.push({file:part.file,result});
    }
    const grouped=new Map();
    for(const item of results){if(!grouped.has(item.file))grouped.set(item.file,[]);grouped.get(item.file).push(item.result);}
    const rows=[];
    for(const [file,fileResults] of grouped)for(const id of Object.keys(codeReviewQuestions)){
      const values=fileResults.map(result=>result.answers[id].noul);
      const probability=id==="implementation"?Math.min(...values):Math.max(...values);
      rows.push({label:file+" · "+codeReviewQuestions[id].instructions,answer:probability>=0.5?"Yes":"No",probability:Math.max(probability,1-probability)});
    }
    return {model:results[0].result.model,elapsedMs:results.reduce((sum,item)=>sum+item.result.elapsedMs,0),usage:results.reduce((sum,item)=>({input_tokens:sum.input_tokens+(item.result.usage?.input_tokens||0),output_tokens:sum.output_tokens+(item.result.usage?.output_tokens||0)}),{input_tokens:0,output_tokens:0}),scope:state.scope,taskProvided:Boolean(state.task),rows,parts:parts.length,files:files.length};
  }
  const connected=await connection(vscode);
  if(!connected)throw new Error("Configure the selected decision provider and its active API key in LLM Providers first.");
  const promptState=codePrompt(state);
  const audit=require("./ai-accounting").begin(vscode,connected.provider || "typesafe-api",connected.model,"Review "+state.scope+" with Jev");
  audit.decision?.({provider:connected.provider || "typesafe-api",model:connected.model,state:promptState,questions:codeReviewQuestions});
  options.onPrompt?.({provider:connected.provider || "typesafe-api",model:connected.model,state:promptState,questions:codeReviewQuestions});
  try{
    const result=await require("./jev").evaluate(connected.provider || "typesafe-api",connected.key,connected.model,promptState,codeReviewQuestions,{...audit.callbacks,signal:options.signal});
    audit.finish(result);
    return {model:result.model,elapsedMs:result.elapsedMs,usage:result.usage,scope:state.scope,taskProvided:Boolean(state.task),answers:result.answers,
      rows:Object.entries(codeReviewQuestions).map(([id,q])=>({label:q.instructions,answer:result.answers[id].noul>=0.5?"Yes":"No",probability:Math.max(result.answers[id].noul,1-result.answers[id].noul)}))};
  }catch(error){audit.fail(error);throw error;}
}
function bind(vscode,panel,resolve) {
  let disposed=false;const jobs=new Map(),reviewPrompts=new Map();
  const post=message=>{if(!disposed)return panel.webview.postMessage(message);};
  const sync=async()=>{try{await post({jevAvailability:!!await connection(vscode)});}catch(_){await post({jevAvailability:false});}};
  const receive=panel.webview.onDidReceiveMessage(async message=>{
    if(message?.action==="jevReady"){await sync();return;}
    if(message?.action==="testJevPrompt"){
      const run=[...reviewPrompts.values()].find(run=>run.id===message.id);
      const prompt=run?.prompts[message.index];
      if(prompt)try{await vscode.commands.executeCommand("vertex.continueDecision",{...prompt,fromReview:true});}
      catch(error){vscode.window.showErrorMessage(error.message);}
      return;
    }
    if(message?.action!=="askJev")return;
    const id=String(message.id||""),slot=JSON.stringify([message.scope||"block",message.file||"",message.hunk]);
    if(!id||id.length>200)return;
    if(jobs.has(slot)){await post({jevReview:{id,error:"This review target is already being assessed."}});return;}
    const controller=new AbortController();jobs.set(slot,controller);
    try{
      const context=await resolve(message);
      validateContext(context,true);
      const fingerprint=JSON.stringify(context);
      await post({jevReview:{id,status:"Assessing this "+(message.scope||"block")+"…"}});
      const prompts=[];
      const result=await assess(vscode,context,{signal:controller.signal,onPrompt:prompt=>prompts.push(prompt)});
      if(controller.signal.aborted)return;
      const current=await resolve(message);
      if(JSON.stringify(current)!==fingerprint)throw new Error("This diff changed. Run ASK Jev on its current version.");
      reviewPrompts.set(slot,{id,prompts});
      await post({jevReview:{id,result,prompts}});
    }catch(error){if(!controller.signal.aborted){await post({jevReview:{id,error:error.message}});await sync();}}
    finally{jobs.delete(slot);}
  });
  const keyChange=storage?.onDidChange?.(()=>{void sync();});
  const configChange=vscode.workspace?.onDidChangeConfiguration?.(event=>{if(!event?.affectsConfiguration||event.affectsConfiguration("vertex.ai.modelConfig"))void sync();});
  panel.onDidDispose(()=>{disposed=true;jobs.forEach(job=>job.abort());receive?.dispose?.();keyChange?.dispose?.();configChange?.dispose?.();});
}
function bridge(host) {
  let serial=0,status=null,requested=false;const listeners=new Set(),pending=new Map();
  window.sdeJevReview=(context,callback)=>{
    if(!context){listeners.add(callback);if(status!==null)callback({available:status});if(!requested){requested=true;host.postMessage({action:"jevReady"});}return ()=>listeners.delete(callback);}
    const id="tools-jev-"+(++serial);pending.set(id,callback);
    host.postMessage({action:"askJev",id,file:context.object_key||context.object||"",hunk:context.blocks?.[0]?.block,context});
  };
  window.addEventListener("message",event=>{
    if(typeof event.data?.jevAvailability==="boolean"){status=event.data.jevAvailability;listeners.forEach(callback=>callback({available:status}));}
    const update=event.data?.jevReview,callback=update&&pending.get(update.id);if(!callback)return;
    callback(update);if(!update.status)pending.delete(update.id);
  });
}
module.exports={selection,substitutable,retryDelay,budget,callBudget,estimateTokens,correct,paced,selectedProvider,enabled,configure,connection,rememberSuccess,questions,codeReviewQuestions,assess,bind,bridge};
