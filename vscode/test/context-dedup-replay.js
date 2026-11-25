"use strict";
// Replay a relevance audit without copying conversation text into the repo.
// node vscode/test/context-dedup-replay.js <jev-audit.jsonl> [--recorded|--live]
const fs=require("node:fs"),dedup=require("../context-dedup");
const file=process.argv[2];
if(!file)throw Error("Pass a Jev audit JSONL file");
const records=fs.readFileSync(file,"utf8").trim().split(/\r?\n/).map(JSON.parse);
const decision=records.find(record=>record.type==="vertex_decision")?.input;
const entries=Object.entries(decision?.questions||{}).filter(([key])=>/^relevant_\d+$/.test(key));
if(!entries.length)throw Error("No relevance-audit decision in this log; old duplicate audits cannot be replayed as relevance decisions");
const topic={id:"topic_0001"};
const history=entries.flatMap(([,question])=>{
  const pair=JSON.parse(question.instructions);
  return [{role:"user",content:pair.question,topic},{role:"assistant",content:pair.answer,topic}];
});
const prepared=dedup.request(history,topic.id,decision.state.currentQuestion);
if(!prepared)throw Error("Replay input was not accepted");
const show=result=>console.log(JSON.stringify({dropped:result.dropped.map(item=>entries[item.exchange-1][0]),retained:entries.length-result.dropped.length},null,2));
console.log(JSON.stringify({exchanges:entries.length,questions:Object.keys(prepared.questions).length},null,2));
if(process.argv.includes("--recorded")){
  const keys=Object.keys(decision.questions),text=records.find(record=>record.type==="assistant")?.message?.content?.[0]?.text||"";
  const parts=text.split(/\n\n(?=Question \d+: |Estimated cost: )/),answers={};
  entries.forEach(([key],index)=>{
    const match=/Yes: (\d+)%/.exec(parts[keys.indexOf(key)]||"");
    if(!match)throw Error("Missing recorded Yes probability for "+key);
    if(Number(match[1])===20)throw Error("Rounded probability at the threshold cannot reproduce the original outcome for "+key);
    answers["relevant_"+(index+1)]={type:"noul",noul:Number(match[1])/100};
  });
  show(dedup.apply(history,prepared,answers));
}
if(process.argv.includes("--live")){
  const key=process.env.VERTEX_JEV_KEY;
  if(!key)throw Error("Set VERTEX_JEV_KEY for a live Jev replay; the key is never printed or logged");
  require("../jev").evaluate("typesafe-api",key,"jev-latest",prepared.state,prepared.questions).then(result=>{
    show(dedup.apply(history,prepared,result.answers));
    console.log(JSON.stringify({inputTokens:result.usage?.input_tokens,estimatedCostUsd:result.usage?.estimated_cost_usd}));
  }).catch(error=>{console.error("Live replay failed: "+error.message);process.exitCode=1;});
}
