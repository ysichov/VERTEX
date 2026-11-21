"use strict";
const path=require("path");

const normalize=value=>String(value||"").replace(/\\/g,"/").replace(/\/+/g,"/").toLowerCase();
function relativeFile(folder,file){
  const base=normalize(path.resolve(folder));
  const name=normalize(file);
  if(!name)return "";
  return name.startsWith(base+"/")?name.slice(base.length+1):name;
}
function matches(folder,relative,input){
  const target=normalize(relative),name=relativeFile(folder,input);
  return !!target&&(name===target||name.endsWith("/"+target));
}
function topicFor(prompt){
  const routing=prompt.details?.find(detail=>detail.routing)?.routing;
  if(routing?.status==="pruned"){
    const id=routing.answers?.route?.choice;
    const kept=routing.topics?.filter(topic=>routing.answers?.["need_"+topic.id]?.choice==="keep")||[];
    if(kept.length===1&&kept[0].id===id)return kept[0];
  }
  return prompt.topic?.id?prompt.topic:null;
}
function taskForFiles(report,folder,files){
  const wanted=[...new Set(files.map(file=>normalize(file)).filter(Boolean))];
  const sessions=(report?.sessions||[]).filter(session=>normalize(session.context?.folder)===normalize(folder));
  const evidence=[];
  for(const session of sessions)for(const prompt of session.prompts||[]){
    const topic=topicFor(prompt);
    if(!topic)continue;
    for(const detail of prompt.details||[]){
      if(detail.type!=="tool")continue;
      const input=detail.input||{};
      const touched=detail.name==="Review"?(input.files||[]).filter(file=>/^approved/i.test(file.decision||"")).map(file=>file.file)
        :["Edit","Write"].includes(detail.name)?[input.file_path]:[];
      for(const file of wanted)if(touched.some(name=>matches(folder,file,name)))
        evidence.push({file,session,prompt,time:Number(detail.time||prompt.time||0),topic});
    }
  }
  const latest=new Map();
  for(const item of evidence){
    const prior=latest.get(item.file)||[];
    if(!prior.length||item.time>prior[0].time)latest.set(item.file,[item]);
    else if(item.time===prior[0].time)prior.push(item);
  }
  const topics=new Map();
  for(const items of latest.values())for(const item of items)topics.set(item.session.conversation+":"+item.topic.id,item);
  // A follow-up such as "restore what the pull overwrote" depends on the earlier
  // task even when its final edit is tagged with only the follow-up topic.
  const pending=[...topics.values()];
  while(pending.length){
    const item=pending.pop(),related=sessions.filter(session=>session.conversation===item.session.conversation)
      .flatMap(session=>(session.prompts||[]).filter(prompt=>topicFor(prompt)?.id===item.topic.id));
    for(const id of new Set(related.flatMap(prompt=>topicFor(prompt)?.dependencies||[]))){
      const key=item.session.conversation+":"+id;
      if(topics.has(key))continue;
      const origin=sessions.filter(session=>session.conversation===item.session.conversation)
        .flatMap(session=>(session.prompts||[]).filter(prompt=>topicFor(prompt)?.id===id).map(prompt=>({session,prompt})))
        .sort((a,b)=>(b.prompt.time||0)-(a.prompt.time||0))[0];
      if(!origin)continue;
      const dependency={session:origin.session,topic:topicFor(origin.prompt),time:Number(origin.prompt.time||0)};
      topics.set(key,dependency);pending.push(dependency);
    }
  }
  const selected=[...topics.values()].sort((a,b)=>a.time-b.time);
  const sections=selected.map(item=>{
    const prompts=sessions.filter(session=>session.conversation===item.session.conversation)
      .flatMap(session=>(session.prompts||[]).filter(prompt=>prompt.operation==="Chat"&&topicFor(prompt)?.id===item.topic.id&&prompt.text&&prompt.text!=="[not logged]"))
      .sort((a,b)=>(a.time||0)-(b.time||0));
    const seen=new Set(),requests=prompts.filter(prompt=>{const key=prompt.key||prompt.time+":"+prompt.text;if(seen.has(key))return false;seen.add(key);return true;});
    return "Topic: "+item.topic.label+"\nUser requests (chronological):\n"+requests.map((prompt,index)=>(index+1)+". "+prompt.text).join("\n");
  });
  return sections.join("\n\n");
}
function fromLogs(vscode,folder,files){
  const root=vscode.workspace.getConfiguration("vertex.ai").get("logPath","");
  return taskForFiles(require("./log-report").readSessions(root),folder,files);
}
module.exports={taskForFiles,fromLogs};
