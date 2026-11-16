"use strict";
// Replay a saved Jev decision input without copying conversation text into the repo.
// node vscode/test/context-dedup-replay.js <jev-audit.jsonl> [--oracle]
const fs=require("node:fs"),dedup=require("../context-dedup");
const serialize=require("../topic-routing").serialize;
const file=process.argv[2];
if(!file)throw Error("Pass a Jev audit JSONL file");
const records=fs.readFileSync(file,"utf8").trim().split(/\r?\n/).map(JSON.parse);
const decision=records.find(record=>record.type==="vertex_decision")?.input;
if(!decision?.state?.exchanges)throw Error("No duplicate-audit decision in this log");
const exchanges=decision.state.exchanges;
const topicId=exchanges.at(-1).topicId;
const history=exchanges.flatMap(exchange=>[
  {role:"user",content:exchange.question,topic:{id:exchange.topicId}},
  {role:"assistant",content:exchange.answer,topic:{id:exchange.topicId},
    ...(Number.isSafeInteger(exchange.iterations)?{execution:{iterations:exchange.iterations}}:{})}
]);
const prepared=dedup.request(history,topicId,decision.state.currentQuestion);
if(!prepared)throw Error("Replay input was not accepted");
const originalAnswers=records.find(record=>record.type==="vertex_provider_response")?.response?.answers||{};
const originalReplaced=Object.values(originalAnswers).filter(answer=>/^by_\d+$/.test(answer?.choice||"")&&answer.confidence>=.8).length;
console.log(JSON.stringify({exchanges:exchanges.length,candidates:prepared.candidates.length,
  previousHighConfidenceReplacements:originalReplaced,newBinaryQuestions:Object.keys(prepared.questions).length},null,2));
if(process.argv.includes("--recorded")){
  const keys=Object.keys(decision.questions),answerText=records.find(record=>record.type==="assistant")?.message?.content?.[0]?.text||"";
  const parts=answerText.split(/\n\n(?=Question \d+:)/),answers={};
  if(parts.length!==keys.length)throw Error("Recorded answer count does not match questions");
  keys.forEach((key,index)=>{const yes=/Yes: (\d+)%/.exec(parts[index]);if(!yes)throw Error("Missing Yes probability for "+key);
    answers[key]={type:"noul",noul:Number(yes[1])/100};});
  const result=dedup.apply(history,prepared,answers);
  console.log(JSON.stringify({recordedRepresentative:result.representative,recordedVerified:result.verifiedCandidates,
    recordedDropped:result.dropped.map(item=>item.exchange),recordedRetained:exchanges.length-result.dropped.length,
    estimatedTokensSaved:Math.round((serialize(history).length-serialize(result.history).length)/4)},null,2));
  if(process.argv.includes("--assert-vsix")){
    const retained=exchanges.map(exchange=>exchange.id).filter(id=>!result.dropped.some(item=>item.exchange===id));
    if(retained.join(",")!=="1,2,4,25")throw Error("Expected review, fix, version change and one successful build; got "+retained);
    console.log("PASS: one successful VSIX build remains; distinct requirements remain");
  }
}
if(process.argv.includes("--oracle")){
  // Human labels for the saved repeated VSIX-build case. This checks the
  // selection pipeline, not Jev's ability to produce these answers live.
  const replaced=new Set([3,8,9,11,12,13,14,15,16,17,18,19,20,21]);
  const answers={};
  for(const exchange of prepared.candidates){
    if(exchange.complete)answers["success_"+exchange.id]={type:"noul",noul:exchange.id===22?.99:.01,confidence:.99};
    answers["duplicate_"+exchange.id]={type:"noul",noul:replaced.has(exchange.id)?.99:.01,confidence:.99};
  }
  const result=dedup.apply(history,prepared,answers);
  const dropped=result.dropped.map(item=>item.exchange);
  if(dropped.join(",")!==[...replaced].join(","))throw Error("Oracle replay mismatch: "+dropped);
  const buildGroup=[3,8,9,11,12,13,14,15,16,17,18,19,20,21,22];
  const retainedBuild=buildGroup.filter(id=>!dropped.includes(id));
  if(retainedBuild.join(",")!=="22")throw Error("More than one build result survived: "+retainedBuild);
  console.log(JSON.stringify({oracleDropped:dropped,retainedExchanges:exchanges.length-dropped.length,retainedBuild},null,2));
}
if(process.argv.includes("--live")){
  const key=process.env.VERTEX_JEV_KEY;
  if(!key)throw Error("Set VERTEX_JEV_KEY for a live Jev replay; the key is never printed or logged");
  require("../jev").evaluate("typesafe-api",key,"jev-latest",prepared.state,prepared.questions).then(result=>{
    const selected=dedup.apply(history,prepared,result.answers);
    const dropped=selected.dropped.map(item=>item.exchange);
    const buildGroup=[3,8,9,11,12,13,14,15,16,17,18,19,20,21,22];
    const retainedBuild=buildGroup.filter(id=>!dropped.includes(id));
    const unrelatedDropped=dropped.filter(id=>!buildGroup.includes(id));
    console.log(JSON.stringify({liveDropped:dropped,retainedBuild,unrelatedDropped,retainedExchanges:exchanges.length-dropped.length,
      inputTokens:result.usage?.input_tokens,estimatedCostUsd:result.usage?.estimated_cost_usd},null,2));
    if(retainedBuild.join(",")!=="22" || unrelatedDropped.length){
      console.error("Replay target not met: retain build exchange 22 only and preserve unrelated exchanges");
      process.exitCode=1;
    }
  }).catch(error=>{console.error("Live replay failed: "+error.message);process.exitCode=1;});
}
