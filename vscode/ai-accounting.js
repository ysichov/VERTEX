"use strict";
const logs=require("./session-log"),crypto=require("crypto");
const checks=new Map();
function begin(vscode,provider,model,operation="Model check"){
 const config=vscode.workspace.getConfiguration("vertex.ai"),root=logs.resolveRoot(config.get("logPath",""));
 const key=JSON.stringify([root,provider,operation]);
 let log;
 if(operation==="Model check"){
  if(!checks.has(key)||!checks.get(key)?.file||!require("fs").existsSync(checks.get(key).file))checks.set(key,logs.create(root,provider,logs.stamp(new Date())+"_"+crypto.randomBytes(3).toString("hex"),logs.fromConfig(config),operation));
  log=checks.get(key);
 }else log=logs.create(root,provider,logs.stamp(new Date())+"_"+crypto.randomBytes(3).toString("hex"),logs.fromConfig(config),operation);
 log?.user(operation+": "+model);
 let calls=0,last,hadResponses=false;
 const callbacks={
  onProviderResponse:event=>{if(event.scope==="model_response")hadResponses=true;last=event.response;log?.providerResponse({...event,provider,response:{...event.response,model:event.response?.model||model}});},
  onModelCall:event=>{calls++;log?.assistant({...event,model:event.model||model});}
 };
 return {callbacks,
  finish(result){if(!calls&&!hadResponses){const usage=result?.usage||last?.usage||(last?.modelUsage?Object.values(last.modelUsage).reduce((u,m)=>({input_tokens:u.input_tokens+(m.inputTokens||0),output_tokens:u.output_tokens+(m.outputTokens||0),cache_read_input_tokens:u.cache_read_input_tokens+(m.cacheReadInputTokens||0),cache_creation_input_tokens:u.cache_creation_input_tokens+(m.cacheCreationInputTokens||0)}),{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}):{});log?.assistant({model:result?.model||model,usage:{...usage,...(provider==="codemie"&&Number.isFinite(result?.cost)?{cost_usd:result.cost}:{})},text:result?.plan?.answer||"OK"});}},
  fail(error){log?.providerResponse({provider,scope:"request_error",response:{model,is_error:true,error:error.message,code:error.code,status:error.status,operation}});if(!calls&&!hadResponses)log?.assistant({model,usage:{cost_usd:null},text:"Request failed: "+error.message});}
 };
}
module.exports={begin};
