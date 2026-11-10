"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const jev=require("../jev");
const questions={urgent:{type:"noul",instructions:"Urgent?"},team:{type:"choice",instructions:"Team?",criteria:{billing:"Payments",support:"App errors"}},severity:{type:"score",instructions:"Severity?",criteria:["Low","High"]}};
const response={model:"jev-1.14.0",answers:{urgent:{type:"noul",noul:0.1},team:{type:"choice",choice:"billing",probabilities:{billing:1,support:0}},severity:{type:"score",score:0.2}},usage:{input_tokens:50,output_tokens:12}};

test("Jev log answers retain question, option and scale labels with confidence",()=>{
 const text=jev.formatAnswers({review:{type:"choice",instructions:"Можно принять?",criteria:{option_1:"Принять",option_2:"Исправить"}},risk:{type:"score",instructions:"Risk?",criteria:["Low","High"]}},
  {review:{type:"choice",choice:"option_2",confidence:0.98,probabilities:{option_1:0.01,option_2:0.99}},risk:{type:"score",score:0.8,confidence:0,probabilities:{0:0.2,1:0.8}}});
 assert.match(text,/Answer: Исправить\nConfidence: 98%/);assert.match(text,/Принять: 1%\nИсправить: 99%/);
 assert.match(text,/Low: 20%\nHigh: 80%/);assert.match(text,/Confidence: 0%/);assert.doesNotMatch(text,/option_2/);
 assert.match(jev.formatAnswers(questions,{}),/Invalid or missing/);
});
test("Jev validates explicit inputs before network access",async()=>{
 for(const bad of [null,[],{}, {x:{type:"text",instructions:"X"}}, {x:{type:"choice",instructions:"X",criteria:{only:"one"}}},{x:{type:"score",instructions:"X",criteria:["only"]}}]){
  await assert.rejects(jev.evaluate("typesafe-api","key","jev-latest","State",bad,{request(){throw Error("must not send");}}),/Questions|Question/);
 }
 assert.throws(()=>jev.validate("",questions),/Enter State/);
 assert.throws(()=>jev.validate("x".repeat(260000),questions),/exceeds/);
});
test("Jev passes only State and Questions, preserves usage and records invalid paid responses",async()=>{
 let body,recorded;
 const result=await jev.evaluate("typesafe-api","key","jev-latest",{ticket:"Double charge"},questions,{request:async(id,key,route,payload)=>{assert.equal(route,"/systemone");body=payload;return response;},onModelCall:event=>{recorded=event;}});
 assert.deepEqual(Object.keys(body),["model","state","questions"]);assert.deepEqual(result.answers,response.answers);assert.equal(recorded.usage.input_tokens,50);assert.equal(result.usage.cost,undefined);
 assert.match(recorded.text,/Question 1: Urgent\?\nAnswer: No/);
 assert.match(recorded.text,/Yes: 10% · No: 90%/);
 assert.match(recorded.text,/Answer: Payments/);
 assert.doesNotMatch(recorded.text,/"noul"|"choice"|"probabilities"/);
 let paid=false;
 await assert.rejects(jev.evaluate("typesafe-api","key","jev-latest","State",questions,{request:async()=>({...response,answers:{}}),onModelCall(){paid=true;}}),/Invalid decision/);
 assert.equal(paid,true);
});
test("Jev chat controller offers decision models and supports cancellation without tools",async t=>{
 const api=require("../openai-compatible"),profile=require("../key-profiles");
 const values={provider:"typesafe-api",model:"jev-latest"},store=new Map();
 const secrets={get:async key=>store.get(key),store:async(key,value)=>{store.set(key,value);}};
 await profile.save(secrets,"typesafe-api","TEST","synthetic-key");
 const vscode={ConfigurationTarget:{Global:1},window:{},workspace:{workspaceFolders:[],onDidChangeConfiguration:()=>({dispose(){}}),getConfiguration:()=>({get:(key,fallback)=>values[key]??fallback,update:async(key,value)=>{values[key]=value;},inspect:()=>({})})}};
 t.mock.method(api,"models",async()=>[{id:"jev-latest",label:"Jev",modelKind:"decision"}]);
 t.mock.method(require("../ai-accounting"),"begin",()=>({callbacks:{},finish(){},fail(){}}));
 const ask=require("../chat").create(vscode,{schemas:[],execute(){throw Error("No tools expected");}},null,secrets,null,null);
 assert.ok(ask.state().providers.some(p=>p.setting==="typesafe-api"));
 assert.equal((await ask.listModels()).models[0].modelKind,"decision");
 let started;const ready=new Promise(resolve=>{started=resolve;});
 t.mock.method(api,"requestJson",async(id,key,route,body,max,timeout,signal)=>{assert.equal(id,"typesafe-api");assert.equal(key,"synthetic-key");started();return new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("aborted")),{once:true}));});
 const running=ask.evaluate({model:"jev-latest",state:"State",questions});await ready;
 await assert.rejects(ask.evaluate({model:"jev-latest",state:"State",questions}),/still working/);
 assert.equal(ask.stop(),true);assert.deepEqual(await running,{stopped:true});
});
test("Jev builder creates typed questions without exposing request syntax",()=>{
 const {buildQuestions,html}=require('../jev-panel');
 const built=buildQuestions([{id:'q1',type:'noul',instructions:'Срочно?'},{id:'q2',type:'choice',instructions:'Куда?',criteriaText:'Оплата\nПоддержка'},{id:'q3',type:'score',instructions:'Насколько?',criteriaText:'Низко\nСредне\nВысоко'}]);
 assert.equal(built.questions.q1.type,'noul');assert.deepEqual(built.questions.q2.criteria,{option_1:'Оплата',option_2:'Поддержка'});assert.deepEqual(built.questions.q3.criteria,['Низко','Средне','Высоко']);
 assert.throws(()=>buildQuestions([{id:'q',type:'choice',instructions:'Куда?',criteriaText:'Одно'}]),/2–255/);
 assert.throws(()=>buildQuestions([]),/Add a question/);assert.doesNotMatch(html,/JSON|jev-state-format/);
});
test("Jev panel builds questions, preserves drafts and displays human answer labels",()=>{
 class Node{constructor(){this.value='';this.events={};this.children=[];}focus(){}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.events[k]=fn;}replaceChildren(){this.children=[];}appendChild(x){this.children.push(x);return x;}append(...items){this.children.push(...items);}}
 const ids=Object.fromEntries(['jev-panel','jev-expand-context','provider-select','model-select','subprovider-select','jev-state','jev-questions','jev-add-question','jev-run','jev-stop','jev-status','jev-result'].map(id=>[id,new Node()]));
 ids['provider-select'].value='typesafe-api';ids['model-select'].value='jev-latest';
 const sent=[],context={document:{body:{dataset:{}},getElementById:id=>ids[id],createElement:()=>new Node()},modelCatalog:[{id:'jev-latest',modelKind:'decision'}],chatRunning:false,api:{postMessage:m=>sent.push(m)}};
 vm.runInNewContext(require('../jev-panel').script,context);context.drawDecisionMode();assert.equal(ids['jev-panel'].hidden,false);
 ids['jev-state'].value='Ticket';const card=ids['jev-questions'].children[0],type=card.children[1].children[0],options=card.children[4];
 type.value='choice';type.events.change();ids['jev-panel'].events.submit({preventDefault(){}});assert.equal(sent.length,0);
 options.value='Billing\nSupport';options.events.input();ids['jev-panel'].events.submit({preventDefault(){}});assert.equal(sent[0].action,'decision');assert.equal(sent[0].questions.question_1.criteria.option_2,'Support');
 options.value='Different\nLabels';options.events.input();context.showDecisionResult({model:'jev',elapsedMs:100,answers:{question_1:{type:'choice',choice:'option_2',confidence:1,probabilities:{option_1:0,option_2:1}}}});
 assert.equal(ids['jev-result'].children[0].children[1].children[1].textContent,'Support');assert.match(ids['jev-status'].textContent,/cost not reported/);
 context.setDecisionRunning(false);ids['provider-select'].value='openai-api';context.modelCatalog=[{id:'jev-latest',modelKind:'language'}];context.drawDecisionMode();assert.equal(ids['jev-panel'].hidden,true);assert.equal(ids['jev-state'].value,'Ticket');
 const saved={state:{code:'METHOD test. ENDMETHOD.',requirements:['Independent total']},questions:{question_4:{type:'noul',instructions:'Repeated call safe?'},question_7:{type:'choice',instructions:'Decision?',criteria:{fix:'Fix',accept:'Accept'}},rating:{type:'score',instructions:'Risk?',criteria:['Low','High']}}};
 context.restoreJevDraft(saved);assert.equal(sent.length,1,'restoring does not invoke Jev');
 assert.equal(ids['jev-questions'].children.length,3);assert.match(ids['jev-state'].value,/Independent total/);
 ids['jev-panel'].events.submit({preventDefault(){}});
 assert.deepEqual(sent[1].state,saved.state);assert.equal(sent[1].questions.question_7.criteria.option_1,'Fix');
 context.setDecisionRunning(false);ids['jev-state'].value='Changed context';ids['jev-panel'].events.submit({preventDefault(){}});assert.equal(sent[2].state,'Changed context');
 context.setDecisionRunning(false);ids['jev-add-question'].events.click();assert.equal(ids['jev-questions'].children[3].children[0].textContent,'Question 4');
});
