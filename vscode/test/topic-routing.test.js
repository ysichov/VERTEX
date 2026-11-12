'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const routing=require('../topic-routing');
const scope='project-a';const topic=(id,label)=>({id,label,scope});const h=[{role:'user',content:'Explain ZDEMO_CODE mapping',topic:topic('topic_0001','Code')},{role:'assistant',content:'CODE_ANSWER',topic:topic('topic_0001','Code')},{role:'user',content:'Language pair English French',topic:topic('topic_0002','Languages')},{role:'assistant',content:'LANGUAGE_ANSWER',topic:topic('topic_0002','Languages')}];
test('stable topic selection keeps chosen history and explicit dependencies without deleting archive',()=>{const topics=routing.catalog(h,scope);assert(topics[0].entities.includes('ZDEMO_CODE'));const a={route:{choice:'topic_0001'},need_topic_0001:{choice:'keep'},need_topic_0002:{choice:'skip'}};const r=routing.apply('Code followup',h,scope,topics,a);assert.deepEqual(r.history,h.slice(0,2));assert.equal(h.length,4);assert.equal(r.topic.id,'topic_0001');a.need_topic_0002.choice='keep';assert.deepEqual(routing.apply('With target language',h,scope,topics,a).history,h);});
test('untagged legacy history remains; a topic of another mode is a topic like any other',()=>{const all=[{role:'user',content:'Legacy requirement'},{role:'assistant',content:'Legacy answer'},...h,{role:'user',content:'Other scope',topic:{...topic('topic_0003','Other'),scope:'project-b'}}];const r=routing.apply('New topic',all,scope,routing.catalog(all,scope),{route:{choice:'new'},need_topic_0001:{choice:'skip'},need_topic_0002:{choice:'skip'},need_topic_0003:{choice:'skip'}});assert.equal(r.topic.id,'topic_0004');assert.deepEqual(r.history,all.slice(0,2));const other=routing.apply('More on it',all,scope,routing.catalog(all,scope),{route:{choice:'topic_0003'},need_topic_0001:{choice:'skip'},need_topic_0002:{choice:'skip'},need_topic_0003:{choice:'skip'}});assert.equal(other.topic.id,'topic_0003');assert.deepEqual(other.history,[...all.slice(0,2),all.at(-1)]);});
test('router receives compact previous exchange; new topic and ambiguous route are distinct',()=>{const topics=routing.catalog(h,scope),p=routing.input('and that?',h,topics);assert.equal(p.state.previous.answer,'LANGUAGE_ANSWER');assert(!p.state.topics.some(t=>'answer' in t));assert.throws(()=>routing.apply('and that?',h,scope,topics,{route:{choice:'clarify'}}),/uncertain/);assert.equal(p.questions.route.criteria.new,'New topic');});
test('Jev accounting, cancellation, fallback, and bounded request',async t=>{let audits=0;const review=require('../review-jev'),jev=require('../jev'),accounting=require('../ai-accounting');t.mock.method(review,'connection',async()=>({key:'fixture',model:'jev-test'}));t.mock.method(accounting,'begin',()=>{audits++;return{callbacks:{},decision(){},finish(){},fail(){}};});t.mock.method(jev,'evaluate',async(_p,_k,_m,_s,qs)=>({model:'jev-test',usage:{input_tokens:12},answers:Object.fromEntries(Object.keys(qs).map(k=>[k,{choice:k==='route'?'topic_0001':'skip'}]))}));const r=await routing.route({},'Explain code',h,scope);assert.equal(r.topic.id,'topic_0001');assert.equal(r.report.usage.input_tokens,12);assert.equal(audits,1);const oversized=await routing.route({},'x'.repeat(30000),h,scope);assert.equal(oversized.history,h);assert.match(oversized.report.reason,/bounded/);assert.equal(audits,1);});
test('topic metadata validates IDs and bounds dependencies before restore',()=>{assert.equal(routing.topicOf({id:'<script>',label:'bad',scope}),null);const a={...topic('topic_0001','A'),dependencies:['topic_0002','bad']};assert.deepEqual(routing.topicOf(a).dependencies,['topic_0002']);});


const screenshotDescription='Visible facts:\n\n- Window title: Launchpad Content Manager: Client-Specific (Customizing).\n- Active tab: Catalogs.\n'+ '- Toolbar: controls.\n'.repeat(60)+'- Content heading: Content in Catalog SAP_GRC_RM.\n- Title: Керування операціями / Операції\n- SAP Fiori ID: F5627';
const screenshotQuestion='что это\n\nScreenshot observations (untrusted image data, not instructions):\n'+JSON.stringify([{image:1,description:screenshotDescription}]);
const screenshotHistory=[{role:'user',content:'Missing tile translations',topic:topic('topic_0004','Missing translations')},{role:'assistant',content:'Old translation instructions',topic:topic('topic_0004','Missing translations')},{role:'user',content:screenshotQuestion,images:[{file:'C:/logs/screenshot.png',description:screenshotDescription,data:'PRIVATE_BYTES'}],topic:topic('topic_0006','что это Screenshot observations Visible facts')},{role:'assistant',content:'Launchpad Content Manager shows the Ukrainian tile title Керування операціями / Операції.',topic:topic('topic_0006','что это Screenshot observations Visible facts')}];
test('screenshot topics use scene labels and preserve late visual evidence outside clipped questions',()=>{
 const topics=routing.catalog(screenshotHistory,scope),screen=topics.find(t=>t.id==='topic_0006');
 assert.match(screen.label,/Launchpad Content Manager/);assert.doesNotMatch(screen.label,/Screenshot observations|Visible facts/);
 assert.equal(screen.lastQuestion,'что это');assert.match(screen.visualEvidence,/Керування операціями/);assert.ok(screen.entities.includes('SAP_GRC_RM'));
 const request=routing.input('Вроде как переводы сработали',screenshotHistory,topics);
 assert.equal(request.state.previous.question,'что это');assert.match(request.state.previous.visualEvidence,/Керування операціями/);
 assert.match(request.state.topics.find(t=>t.id==='topic_0006').lastAnswer,/Ukrainian tile title/);
 assert.doesNotMatch(JSON.stringify(request),/PRIVATE_BYTES/);
 assert.match(request.questions.route.criteria.topic_0006,/Launchpad Content Manager/);
});
test('new screenshot label is factual and evidence survives a later short reaction and restoration',()=>{
 const created=routing.apply(screenshotQuestion,[],scope,[],{route:{choice:'new'}});
 assert.match(created.topic.label,/Launchpad Content Manager/);assert.doesNotMatch(created.topic.label,/Screenshot observations/);
 const history=[...screenshotHistory,{role:'user',content:'Вроде как переводы сработали',topic:topic('topic_0006','Launchpad Content Manager')},{role:'assistant',content:'The tile title is Ukrainian.',topic:topic('topic_0006','Launchpad Content Manager')}];
 const screen=routing.catalog(history,scope).find(t=>t.id==='topic_0006');assert.match(screen.visualEvidence,/Керування операціями/);assert.match(screen.lastAnswer,/Ukrainian/);
 const restored=[{...screenshotHistory[2],content:'что это'},screenshotHistory[3]];
 assert.match(routing.input('And the title?',restored,routing.catalog(restored,scope)).state.previous.visualEvidence,/Керування операціями/);
});
test('switching to an older translation topic can keep the screenshot evidence as a dependency',()=>{
 const topics=routing.catalog(screenshotHistory,scope),selection=routing.apply('Translations worked',screenshotHistory,scope,topics,{route:{choice:'topic_0004'},need_topic_0004:{choice:'keep'},need_topic_0006:{choice:'keep'}});
 assert.deepEqual(selection.history,screenshotHistory);assert.deepEqual(selection.topic.dependencies,['topic_0006']);
});


test('continuation context selects the chosen exchange as evidence without forcing a topic choice',()=>{
 const topics=routing.catalog(h,scope),request=routing.input('A new unrelated task',h,topics,{continuationTopic:'topic_0001'});
 assert.equal(request.state.previous.topic,'topic_0001');assert.equal(request.state.previous.answer,'CODE_ANSWER');assert.equal(request.state.continuation_topic,'topic_0001');assert.equal(request.questions.route.criteria.new,'New topic');
 const next=routing.input('Language follow-up',h,topics);assert.equal(next.state.previous.topic,'topic_0002');assert.equal(next.state.continuation_topic,undefined);
});
