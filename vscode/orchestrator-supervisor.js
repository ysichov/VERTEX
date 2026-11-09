"use strict";
// Per-request, domain-independent recovery. No routine polling of the planning model.
const clip=(value,n=4000)=>{const text=typeof value==="string"?value:JSON.stringify(value)??"null";return text.length>n?text.slice(0,n)+" [truncated]":text;};
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function fatal(message){return Object.assign(new Error(message),{orchestratorFatal:true});}
function create({revise,review,isActive=()=>true,maxRecoveries=2}){
 const history=[],failedCalls=new Map(),errors=new Map();let epoch=0,recoveries=0,checks=0,stopped=null;
 const active=()=>{if(stopped)throw stopped;if(!isActive())throw fatal("Orchestrator request was stopped.");};
 const record=entry=>{history.push(entry);if(history.length>16)history.shift();};
 async function recover(reason){
  active();if(recoveries>=maxRecoveries)throw stopped=fatal("Orchestrator stopped an unresolved tool-error loop after "+recoveries+" recovery attempts. No verified final answer is available.");
  recoveries++;
  try{const guidance=await revise({reason,attempt:recoveries,history:history.slice()});active();errors.clear();return "\nOrchestrator recovery advice (not tool evidence):\n"+guidance;}
  catch(error){throw stopped=fatal("Orchestrator recovery failed: "+error.message);}
 }
 return {
  async run(name,args,execute){
   active();const key=name+":"+JSON.stringify(stable(args));
   if(failedCalls.get(key)===epoch){record({tool:name,args:clip(args),error:"Repeated failed call blocked before execution"});throw new Error("Repeated failed tool call was not executed."+await recover("The executor repeated the same failed operation without new successful evidence."));}
   let result;
   try{result=await execute();}
   catch(error){
    if(error.orchestratorFatal||!isActive())throw error;
    const message=String(error.message||error),signature=name+":"+message.split(/\r?\n/)[0];
    failedCalls.set(key,epoch);if(failedCalls.size>64)failedCalls.delete(failedCalls.keys().next().value);
    const count=(errors.get(signature)||0)+1;errors.set(signature,count);
    record({tool:name,args:clip(args),error:clip(message)});
    if(count>=2)throw new Error(message+await recover("The same tool error occurred twice, despite changes to the call."));
    throw error;
   }
   active();epoch++;record({tool:name,args:clip(args),result:clip(result)});return result;
  },
  async beforeAnswer(plan){
   active();if(!recoveries)return null;
   if(checks>=2)throw stopped=fatal("Orchestrator could not verify the revised answer. Execution stopped with unresolved requirements.");
   checks++;
   let verdict;try{verdict=await review({history:history.slice(),proposed_answer:plan});}catch(error){throw stopped=fatal("Orchestrator answer review failed: "+error.message);}
   active();return verdict.accept?null:"Orchestrator answer review: "+verdict.feedback+"\nContinue with the available tools when authorized. Do not present an unverified conclusion as completed work.";
  },
  get recoveries(){return recoveries;}
 };
}
const VERDICT_SCHEMA={type:"object",additionalProperties:false,required:["accept","feedback"],properties:{accept:{type:"boolean"},feedback:{type:"string"}}};
function parseVerdict(text){
 let value=text;if(typeof text==="string"){try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));}catch(_){throw Object.assign(new Error("Invalid answer-review JSON."),{code:"STRUCTURED_FORMAT"});}}
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!VERDICT_SCHEMA.required.includes(key))||typeof value.accept!=="boolean"||typeof value.feedback!=="string"||(!value.accept&&!value.feedback.trim()))throw Object.assign(new Error("Invalid answer-review verdict."),{code:"STRUCTURED_FORMAT"});
 return {accept:value.accept,feedback:clip(value.feedback,6000)};
}
module.exports={create,parseVerdict,VERDICT_SCHEMA};
