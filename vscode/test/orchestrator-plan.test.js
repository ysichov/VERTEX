"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),router=require('../orchestrator-plan');
const tools=[{name:'read',description:'Read source',inputSchema:{type:'object'}},{name:'write',description:'Change source',inputSchema:{type:'object'}}];
test('One decision packet contains the task and one question for every tool; all selections are validated',()=>{
 const request=router.input('Explain source',{history:[]},tools);
 assert.equal(request.state.task,'Explain source');assert.equal(request.state.tools.length,2);
 assert.deepEqual(Object.keys(request.questions),['tool_0','tool_1','allow_write','allow_execution']);
 assert.match(request.questions.tool_1.instructions,/write/);
 assert.deepEqual(router.apply(tools,{tool_0:{type:'choice',choice:'include'},tool_1:{type:'choice',choice:'exclude'}}),[tools[0]]);
 assert.throws(()=>router.apply(tools,{tool_0:{type:'choice',choice:'include'}}),/write/);
 assert.throws(()=>router.input('x'.repeat(router.LIMIT),{},tools),/limit/);
 assert.throws(()=>router.input('task',{},[tools[0],tools[0]]),/Duplicate/);
});
test('Jev is called once and logs the exact selected tools and probabilities',async t=>{
 let calls=0,report,logged;
 t.mock.method(require('../review-jev'),'connection',async()=>({provider:'typesafe-api',model:'jev-latest',key:'test'}));
 t.mock.method(require('../ai-accounting'),'begin',(_v,_p,_m,operation)=>{assert.equal(operation,'Orchestrator tool selection');return {callbacks:{},decision:r=>logged=r,selection:r=>report=r,finish(){},fail(){}};});
 t.mock.method(require('../jev'),'evaluate',async(_p,_k,_m,state,questions)=>{calls++;assert.equal(state.task,'Explain source');assert.equal(Object.keys(questions).length,4);return {model:'jev-latest',answers:{allow_write:{type:'choice',choice:'no'},allow_execution:{type:'choice',choice:'no'},tool_0:{type:'choice',choice:'include',probabilities:{include:0.9,exclude:0.1}},tool_1:{type:'choice',choice:'exclude'}},usage:{input_tokens:20},elapsedMs:8};});
 const result=await router.select({},'Explain source',{},tools);
 assert.equal(calls,1);assert.deepEqual(result.tools,[tools[0]]);assert.deepEqual(report.selected,['read']);assert.equal(report.answers.tool_0.probabilities.include,0.9);assert.equal(logged.state.task,'Explain source');
});
test('Missing Jev configuration and malformed decisions fail without returning unfiltered tools',async t=>{
 t.mock.method(require('../review-jev'),'connection',async()=>null);
 await assert.rejects(router.select({},'task',{},tools),/Configure/);
});
test('The connection is checked before any candidate is gathered, and a supplied one is not re-resolved',async t=>{
 let resolved=0;
 t.mock.method(require('../review-jev'),'connection',async()=>{resolved++;return null;});
 await assert.rejects(router.connect({}),/Configure/);
 assert.equal(resolved,1);
 let calls=0;resolved=0;
 t.mock.method(require('../review-jev'),'connection',async()=>{resolved++;return {provider:'typesafe-api',model:'jev-latest',key:'test'};});
 t.mock.method(require('../ai-accounting'),'begin',()=>({callbacks:{},decision(){},selection(){},finish(){},fail(){}}));
 t.mock.method(require('../jev'),'evaluate',async()=>{calls++;return {model:'jev-latest',answers:{allow_write:{type:'choice',choice:'no'},allow_execution:{type:'choice',choice:'no'},tool_0:{type:'choice',choice:'include'},tool_1:{type:'choice',choice:'exclude'}},usage:{},elapsedMs:1};});
 const supplied={provider:'typesafe-api',model:'jev-latest',key:'test'};
 const result=await router.select({},'task',{},tools,{connection:supplied});
 assert.equal(calls,1);assert.deepEqual(result.tools,[tools[0]]);
 assert.equal(resolved,0,'select must not resolve the connection again when the caller supplied one');
});

test('Possible and uncertain exclusions preserve tools while confident unrelated tools are excluded',()=>{
 const list=[{name:'versions'},{name:'deps'},{name:'write'},{name:'query'}];
 const answers={tool_0:{type:'choice',choice:'include'},tool_1:{type:'choice',choice:'exclude',confidence:0.505},tool_2:{type:'choice',choice:'exclude',probabilities:{exclude:0.99}},tool_3:{type:'choice',choice:'maybe'}};
 assert.deepEqual(router.apply(list,answers).map(t=>t.name),['versions','deps','query']);
});
test('No-execution policy retains SQL and inspection actions but blocks checks, writes and hidden broad-tool actions',()=>{
 const permissions={write:false,execute:false};
 const broad={name:'SAPDiagnose',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{action:{enum:['object_state','atc','trace_start']}}}};
 const safe=router.restrict(broad,permissions);
 assert.deepEqual(safe.inputSchema.properties.action.enum,['object_state']);assert.ok(safe.inputSchema.required.includes('action'));
 assert.deepEqual(broad.inputSchema.properties.action.enum,['object_state','atc','trace_start']);
 assert.doesNotThrow(()=>router.assertAllowed(broad,{action:'object_state'},permissions));
 for(const args of [{action:'atc'},{action:'trace_start'},{}])assert.throws(()=>router.assertAllowed(broad,args,permissions),/not authorized/);
 assert.equal(router.restrict({name:'run_atc_check'},permissions),null);
 assert.equal(router.restrict({name:'run_abap_unit'},permissions),null);
 assert.equal(router.restrict({name:'SAPWrite',annotations:{readOnlyHint:false}},permissions),null);
 assert.ok(router.restrict({name:'run_sap_select',annotations:{readOnlyHint:true}},permissions));
 assert.throws(()=>router.assertAllowed({name:'SAPRead'},{type:'SYNTAX'},permissions),/syntax/);
});
test('Stages replace tool sets atomically and retain evidence and original permissions',async()=>{
 const schemas=[],calls=[],choices=[],permissions={write:false,execute:false};
 const candidates=[{name:'SAPTransport',inputSchema:{type:'object',properties:{action:{enum:['list','create']}}}},{name:'SAPContext'},{name:'run_atc_check'}];
 const session=router.createSession({vscode:{},task:'Investigate my changes; run nothing',context:{source:'initial'},tools:candidates,schemas,
  choose:async(_v,task,context,tools,options)=>{choices.push({task,context,options});return {tools:choices.length===1?[tools[0]]:[tools[1],tools[2]],permissions:choices.length===1?permissions:{write:true,execute:true},usage:{input_tokens:10}};}});
 await session.start();assert.deepEqual(schemas.map(t=>t.name),['SAPTransport',router.STEP,router.CALL]);
 await session.run('SAPTransport',{action:'list'},async(name,args)=>{calls.push(name);return {transport:'ALCK900799'};});
 const next=await session.run(router.STEP,{subtask:'Find dependencies of the selected class',evidence:'Transport ALCK900799 returned'},()=>assert.fail('control must not reach MCP'));
 assert.equal(next.stage,2);assert.deepEqual(next.tools.map(t=>t.name),['SAPContext']);assert.equal(choices.length,2);
 assert.deepEqual(choices[1].options.permissions,permissions);assert.equal(choices[1].options.originalTask,'Investigate my changes; run nothing');
 assert.match(choices[1].context.recent_tool_evidence[0].result,/ALCK900799/);
 await assert.rejects(session.run('SAPTransport',{action:'list'},async()=>{}),/unavailable/);
 await session.run(router.CALL,{name:'SAPContext',arguments:{action:'deps'}},async name=>calls.push(name));
 assert.deepEqual(calls,['SAPTransport','SAPContext']);
 await assert.rejects(session.run(router.CALL,{name:'run_atc_check',arguments:{}},async()=>{}),/unavailable/);
});
test('Failed stage selection preserves the previous set, and concurrent transitions or actions are refused',async()=>{
 const schemas=[];let release,calls=0;
 const session=router.createSession({vscode:{},task:'inspect',context:{},tools:[{name:'read'}],schemas,choose:async()=>{
   calls++;if(calls===1)return {tools:[{name:'read'}],permissions:{write:false,execute:false}};
   await new Promise(resolve=>release=resolve);throw Error('Jev unavailable');
 }});
 await session.start();const pending=session.run(router.STEP,{subtask:'dependencies',evidence:''},async()=>{});
 await assert.rejects(session.run('read',{},async()=>{}),/in progress/);
 await assert.rejects(session.run(router.STEP,{subtask:'other',evidence:''},async()=>{}),/Finish active/);
 release();await assert.rejects(pending,/Jev unavailable/);
 assert.deepEqual(schemas.map(t=>t.name),['read',router.STEP,router.CALL]);
 assert.equal(await session.run('read',{},async()=>42),42);
});
test('Repeated empty boundaries and excessive stages do not create unbounded decision loops',async()=>{
 let count=0;const session=router.createSession({vscode:{},task:'inspect',context:{},tools:[{name:'read'}],schemas:[],choose:async()=>{count++;return {tools:[],permissions:{write:false,execute:false}};}});
 await session.start();await assert.rejects(session.run(router.STEP,{subtask:'inspect',evidence:''},async()=>{}),/already selected/);
 for(let i=2;i<=8;i++)await session.run(router.STEP,{subtask:'stage '+i,evidence:''},async()=>{});
 await assert.rejects(session.run(router.STEP,{subtask:'stage 9',evidence:''},async()=>{}),/stage limit/);assert.equal(count,8);
});

test('Later decision packets keep the original authorization; logs explain blocked and uncertain tools',async t=>{
 const list=[{name:'SAPContext',annotations:{readOnlyHint:true}},{name:'run_atc_check',annotations:{readOnlyHint:true}}];let calls=0,report;
 t.mock.method(require('../ai-accounting'),'begin',()=>({callbacks:{},decision(){},selection:r=>report=r,finish(){},fail(){}}));
 t.mock.method(require('../jev'),'evaluate',async(_p,_k,_m,state,questions)=>{calls++;assert.equal(state.original_task,'Inspect only; run nothing');assert.equal(Object.hasOwn(questions,'allow_execution'),calls===1);return {model:'jev-latest',usage:{input_tokens:10},answers:{tool_0:{type:'choice',choice:'exclude',confidence:0.51},tool_1:{type:'choice',choice:'include'},...(calls===1?{allow_write:{type:'choice',choice:'no'},allow_execution:{type:'choice',choice:'no'}}:{})}};});
 const connection={provider:'typesafe-api',model:'jev-latest',key:'test'};
 const first=await router.select({},'Inspect only; run nothing',{},list,{connection});
 assert.deepEqual(first.tools.map(t=>t.name),['SAPContext']);assert.deepEqual(report.blocked,['run_atc_check']);assert.deepEqual(report.retained_uncertain,['SAPContext']);
 await router.select({},'Run ATC now',{},list,{connection,originalTask:'Inspect only; run nothing',permissions:first.permissions,stage:2});
 assert.equal(calls,2);assert.deepEqual(report.permissions,{write:false,execute:false});assert.equal(report.stage,2);assert.deepEqual(report.selected,['SAPContext']);
});
test('Stop during a later stage preserves the previous set and refuses late execution',async()=>{
 const controller=new AbortController();let calls=0,started;const ready=new Promise(resolve=>started=resolve),schemas=[];
 const session=router.createSession({vscode:{},task:'inspect',context:{},tools:[{name:'read'}],schemas,options:{signal:controller.signal},choose:async(_v,_t,_c,_tools,options)=>{if(++calls===1)return {tools:[{name:'read'}],permissions:{write:false,execute:false}};started();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
 await session.start();const pending=session.run(router.STEP,{subtask:'deps',evidence:''},async()=>{});await ready;controller.abort();await assert.rejects(pending,/cancelled/);
 assert.deepEqual(schemas.map(t=>t.name),['read',router.STEP,router.CALL]);await assert.rejects(session.run('read',{},async()=>{}),/stopped/);
});

test('Only selected function guidance is exposed; hidden names are removed from nested schema descriptions',()=>{
 const selected={name:'SAPRead',description:'Read source. For dependencies use SAPContext.',inputSchema:{type:'object',properties:{name:{type:'string',description:'Discover with SAPSearch first.'}}}};
 const result=router.expose([selected],[selected,{name:'SAPContext'},{name:'SAPSearch'}]);
 assert.doesNotMatch(JSON.stringify(result),/SAPContext|SAPSearch/);assert.equal(result[0].name,'SAPRead');
 assert.match(selected.description,/SAPContext/);assert.match(result[0].description,/request a new stage/);
});

function samplePlan(){return {goal:'Inspect changes',stages:[{id:1,task:'Find transports',operation:'discover',depends_on:[],completion_checks:['Dates verified']},{id:2,task:'Read source',operation:'read',depends_on:[1],completion_checks:['Object read']},{id:3,task:'Inspect independent system metadata',operation:'inspect',depends_on:[],completion_checks:['Metadata returned']}]};}
function plannedReport(id,answer='result'){return {answer,stage_id:id,stage_status:'complete',evidence:['Actual result'],remaining:[]};}
test('The stage plan must be JSON with ordered acyclic dependencies and narrow bounded stages',()=>{
 const plan=samplePlan();assert.deepEqual(router.parsePlan(JSON.stringify(plan)),plan);
 for(const invalid of ['Here are my stages',{}, {...plan,stages:[]},{...plan,stages:[{...plan.stages[0],depends_on:[1]}]},{...plan,stages:[{...plan.stages[0],id:2}]},{...plan,prose:'skip'}])assert.throws(()=>router.parsePlan(invalid),/JSON stage plan/);
 assert.deepEqual(router.stageSchema({type:'object',properties:{answer:{type:'string'}},required:['answer']},2).properties.stage_id.enum,[2]);
 assert.throws(()=>router.parseStage({answer:'finished'},plan.stages[0]),/Invalid structured/);
 assert.throws(()=>router.parseStage({...plannedReport(1),remaining:['Still need dates']},plan.stages[0]),/Invalid structured/);
});
test('The host executes declared stages and passes only dependency reports, never unrelated branches or tool history',async()=>{
 const starts=[],contexts=[],events=[];const session={start:async task=>starts.push(task),advance:async(task,summary)=>{starts.push(task);contexts.push(JSON.parse(summary));},snapshot:()=>[{tool:'DO_NOT_LEAK',result:'full old source'}]};
 const result=await router.runPlanned({plan:samplePlan(),session,onEvent:e=>events.push(e.kind),execute:async(stage,context)=>{if(stage.id===2)assert.deepEqual(context.previous_reports.map(r=>r.stage_id),[1]);if(stage.id===3)assert.deepEqual(context.previous_reports,[]);assert.deepEqual(context.recent_tool_evidence,[]);return {plan:plannedReport(stage.id,'result '+stage.id),usage:{input_tokens:10},model:'test'};}});
 assert.equal(starts.length,3);assert.deepEqual(contexts[1],[]);assert.equal(result.usage.input_tokens,30);assert.equal(result.plan.answer,'result 3');assert.equal(events.filter(e=>e==='stage_start').length,3);
});
test('Invalid or blocked stage reports never advance the host to another stage',async()=>{
 let starts=0;const session={start:async()=>{starts++;},advance:async()=>{starts++;},snapshot:()=>[]};
 await assert.rejects(router.runPlanned({plan:samplePlan(),session,execute:async()=>({plan:{answer:'trust me'}})}),/Invalid structured/);assert.equal(starts,1);
 starts=0;const result=await router.runPlanned({plan:samplePlan(),session,execute:async()=>({plan:{...plannedReport(1,'No date access'),stage_status:'blocked',remaining:['Need transport dates']}})});
 assert.equal(starts,1);assert.equal(result.unfinished.length,2);assert.match(result.plan.answer,/Read source/);
});
test('Compact Jev input omits full tool schemas and real decisions expose at most two permitted functions',async t=>{
 const catalog=Array.from({length:5},(_,i)=>({name:'read_'+i,description:'Read metadata '+i,inputSchema:{type:'object',properties:{value:{type:'string',description:'x'.repeat(8000)}}},annotations:{readOnlyHint:true}}));
 const request=router.input('Find transports',{},catalog);assert.doesNotMatch(JSON.stringify(request.state.tools),/inputSchema|xxxxxxxx/);assert.ok(JSON.stringify(request).length<6000);
 t.mock.method(require('../ai-accounting'),'begin',()=>({callbacks:{},decision(){},selection(){},finish(){},fail(){}}));
 t.mock.method(require('../jev'),'evaluate',async()=>({answers:{...Object.fromEntries(catalog.map((_,i)=>['tool_'+i,{type:'choice',choice:'include',probabilities:{include:1-i/10}}])),allow_write:{type:'choice',choice:'no'},allow_execution:{type:'choice',choice:'no'}},model:'jev-latest',usage:{},elapsedMs:1}));
 const result=await router.select({},'Find transports',{},catalog,{connection:{provider:'typesafe-api',model:'jev-latest',key:'test'}});assert.deepEqual(result.tools.map(t=>t.name),['read_0','read_1']);
});

test('SQL SELECT and source reading remain available without Jev questions; only one specialized function is added',async t=>{
 const catalog=[{name:'run_sap_select',annotations:{readOnlyHint:true}},{name:'read_sap_object',annotations:{readOnlyHint:true}},{name:'SAPTransport',inputSchema:{type:'object',properties:{action:{enum:['list','get','diff']}}}},{name:'SAPRead'}];
 const input=router.input('List transports',{},catalog);assert.ok(!input.questions.tool_0);assert.ok(!input.questions.tool_1);assert.ok(input.questions.tool_2);
 t.mock.method(require('../ai-accounting'),'begin',()=>({callbacks:{},decision(){},selection(){},finish(){},fail(){}}));
 t.mock.method(require('../jev'),'evaluate',async()=>({model:'jev-latest',usage:{},answers:{tool_2:{type:'choice',choice:'include',probabilities:{include:0.99}},tool_3:{type:'choice',choice:'maybe',probabilities:{maybe:0.8}},allow_write:{type:'choice',choice:'no'},allow_execution:{type:'choice',choice:'no'}}}));
 const result=await router.select({},'List transports',{},catalog,{connection:{provider:'typesafe-api',model:'jev-latest',key:'test'}});assert.deepEqual(result.tools.map(t=>t.name),['run_sap_select','read_sap_object','SAPTransport']);
});
test('Discovery stage exposes only transport listing; future-stage reads are refused before SAP',async()=>{
 const tool={name:'SAPTransport',inputSchema:{type:'object',properties:{action:{enum:['list','get','diff','history']}}}};const schemas=[];
 const session=router.createSession({vscode:{},task:'investigate',context:{},tools:[tool],schemas,options:{managed:true},choose:async()=>({tools:[tool],permissions:{write:false,execute:false}})});
 await session.start('Find transports',{id:1,operation:'discover'});assert.deepEqual(schemas[0].inputSchema.properties.action.enum,['list']);
 await assert.rejects(session.run('SAPTransport',{action:'get',id:'X'},async()=>assert.fail('must not execute')),/not authorized|another stage/);
 assert.equal(session.guard().calls,1);
});
test('Identical reads reuse actual results across stages, including concurrent calls, but failures never become cached evidence',async()=>{
 const tool={name:'read',annotations:{readOnlyHint:true},inputSchema:{type:'object'}};let backend=0;
 const session=router.createSession({vscode:{},task:'inspect',context:{},tools:[tool],schemas:[],options:{managed:true},choose:async()=>({tools:[tool],permissions:{write:false,execute:false}})});
 await session.start('read',{id:1,operation:'read'});
 const invoke=async()=>{backend++;await new Promise(r=>setTimeout(r,5));return {items:['actual'],truncated:true};};
 const values=await Promise.all([session.run('read',{a:1,b:2},invoke),session.run('read',{b:2,a:1},invoke)]);assert.equal(backend,1);assert.deepEqual(values[0],values[1]);
 await session.advance('reuse','',{id:2,operation:'read'});assert.equal(session.cached().length,1);
 assert.deepEqual(await session.run('read',{b:2,a:1},invoke),values[0]);assert.equal(backend,1);assert.equal(session.events()[0].kind,'cached_result');
 await session.run('read',{a:3},async()=> 'Unknown column BAD');assert.equal(session.cached().length,1);
});
test('Six actions stop backend work; three consecutive failures stop guessing and a false complete report becomes blocked',async()=>{
 const tool={name:'read',annotations:{readOnlyHint:true}},schemas=[];let backend=0,stops=0;
 const session=router.createSession({vscode:{},task:'inspect',context:{},tools:[tool],schemas,options:{managed:true,onLimit:()=>stops++},choose:async()=>({tools:[tool],permissions:{write:false,execute:false}})});
 await session.start('read',{id:1,operation:'read'});
 for(let i=0;i<6;i++)await session.run('read',{i},async()=>{backend++;return 'ok';});
 await assert.rejects(session.run('read',{i:7},async()=>backend++),/limit/);assert.equal(backend,6);assert.equal(stops,1);
 await session.advance('other','',{id:2,operation:'read'});
 for(let i=0;i<3;i++)await assert.rejects(session.run('read',{bad:i},async()=>{throw Error('invalid field');}),/invalid/);
 assert.ok(session.guard().reason);assert.equal(stops,2);
 const plan={goal:'inspect',stages:[{id:1,task:'read',operation:'read',depends_on:[],completion_checks:['read result']}]};
 const result=await router.runPlanned({plan,session:{start:async()=>{},guard:()=>({reason:'budget exhausted'}),cached:()=>[]},execute:async()=>({plan:plannedReport(1)})});assert.equal(result.stageReports[0].stage_status,'blocked');
});
test('Missing capability permits one recovery inside the same stage, not an unbounded new plan',async()=>{
 let runs=0,recoveries=0;const plan={goal:'dates',stages:[{id:1,task:'Verify dates',operation:'discover',depends_on:[],completion_checks:['Date confirmed']}]};
 const session={start:async()=>{},recover:async()=>{recoveries++;},cached:()=>[],guard:()=>({calls:1,reason:null})};
 const result=await router.runPlanned({plan,session,execute:async()=>({plan:++runs===1?{...plannedReport(1,'Missing SQL'),stage_status:'blocked',remaining:['Need a SQL reader']} : plannedReport(1,'Date verified')})});
 assert.equal(recoveries,1);assert.equal(runs,2);assert.equal(result.stageReports[0].stage_status,'complete');
 runs=0;recoveries=0;await router.runPlanned({plan,session,execute:async()=>{runs++;return {plan:{...plannedReport(1,'Still missing'),stage_status:'blocked',remaining:['Need date evidence']}};}});assert.equal(recoveries,1);assert.equal(runs,2);
});

test('Cached reads do not cross system scopes and writes invalidate prior evidence',async()=>{
 const read={name:'Read',annotations:{readOnlyHint:true}},write={name:'Write',annotations:{readOnlyHint:false}};let scope='ALC/100',reads=0;
 const session=router.createSession({vscode:{},task:'edit',context:{},tools:[read,write],schemas:[],options:{managed:true,cacheScope:()=>scope},choose:async()=>({tools:[read,write],permissions:{write:true,execute:true}})});
 await session.start('read',{id:1,operation:'read'});await session.run('Read',{path:'a'},async()=>++reads);await session.run('Read',{path:'a'},async()=>++reads);assert.equal(reads,1);
 scope='ALC/200';await session.run('Read',{path:'a'},async()=>++reads);assert.equal(reads,2);
 await session.advance('write','',{id:2,operation:'modify'});await session.run('Write',{path:'a'},async()=> 'changed');await session.run('Read',{path:'a'},async()=>++reads);assert.equal(reads,3);
});

test('Repeated cached reads also consume the stage budget instead of forming a token loop',async()=>{
 const tool={name:'Read',annotations:{readOnlyHint:true}};let backend=0;
 const session=router.createSession({vscode:{},task:'inspect',context:{},tools:[tool],schemas:[],options:{managed:true},choose:async()=>({tools:[tool],permissions:{write:false,execute:false}})});
 await session.start('read',{id:1,operation:'read'});for(let i=0;i<6;i++)await session.run('Read',{path:'same'},async()=>{backend++;return 'actual data';});
 await assert.rejects(session.run('Read',{path:'same'},async()=>backend++),/limit/);assert.equal(backend,1);assert.equal(session.guard().calls,6);
});

test('A read racing a write is not retained as reusable stale evidence',async()=>{
 const tools=[{name:'Read',annotations:{readOnlyHint:true}},{name:'Write',annotations:{readOnlyHint:false}}];let finish,reads=0;
 const session=router.createSession({vscode:{},task:'edit',context:{},tools,schemas:[],options:{managed:true},choose:async()=>({tools,permissions:{write:true,execute:true}})});
 await session.start('edit',{id:1,operation:'modify'});
 const reading=session.run('Read',{},async()=>{reads++;return new Promise(resolve=>finish=resolve);});
 await session.run('Write',{},async()=> 'changed');finish('old source');await reading;assert.equal(session.cached().length,0);
 await session.run('Read',{},async()=>{reads++;return 'new source';});assert.equal(reads,2);
});
test('A baseline-only stage reuses fixed permissions without sending an empty decision request',async t=>{
 t.mock.method(require('../jev'),'evaluate',async()=>assert.fail('No questions should be sent'));
 const tools=[{name:'run_sap_select',annotations:{readOnlyHint:true}},{name:'read_sap_object',annotations:{readOnlyHint:true}}];
 const result=await router.select({},'read',{},tools,{connection:{provider:'typesafe-api',model:'jev-latest',key:'test'},permissions:{write:false,execute:false}});assert.equal(result.baseline_only,true);assert.equal(result.tools.length,2);
});

test('The same Jev packet chooses mode and all needed tools; direct mode does not truncate a five-tool task',async t=>{
 const tools=Array.from({length:5},(_,i)=>({name:'read_'+i,annotations:{readOnlyHint:true},inputSchema:{type:'object'}}));let calls=0,logged;
 t.mock.method(require('../ai-accounting'),'begin',()=>({callbacks:{},decision(){},selection:r=>logged=r,finish(){},fail(){}}));
 t.mock.method(require('../jev'),'evaluate',async(_p,_k,_m,state,questions)=>{calls++;assert.ok(questions.execution_mode);assert.ok(questions.tool_4);assert.ok(state.tools[0].schema_characters);return {model:'jev-latest',usage:{input_tokens:10},answers:{execution_mode:{type:'choice',choice:'direct'},allow_write:{type:'choice',choice:'no'},allow_execution:{type:'choice',choice:'no'},...Object.fromEntries(tools.map((t,i)=>['tool_'+i,{type:'choice',choice:'include'}]))}};});
 const result=await router.select({},'Use the five needed capabilities',{},tools,{decideMode:true,connection:{provider:'typesafe-api',model:'jev-latest',key:'test'}});assert.equal(calls,1);assert.equal(result.executionMode,'direct');assert.equal(result.tools.length,5);assert.equal(logged.execution_mode,'direct');
 const schemas=[],session=router.createSession({vscode:{},task:'whole task',context:{},tools,schemas,options:{managed:true},choose:async()=>result});await session.start('whole task',{id:1,direct:true});assert.equal(schemas.length,5);assert.equal(session.guard().limit,32);
});
test('Uncertain staged mode defaults to direct; invalid mode does not execute',async t=>{
 const tools=[{name:'read'}];let choice='staged';
 t.mock.method(require('../ai-accounting'),'begin',()=>({callbacks:{},decision(){},selection(){},finish(){},fail(){}}));
 t.mock.method(require('../jev'),'evaluate',async()=>({model:'jev-latest',usage:{},answers:{execution_mode:{type:'choice',choice,confidence:0.55},tool_0:{type:'choice',choice:'include'},allow_write:{type:'choice',choice:'no'},allow_execution:{type:'choice',choice:'no'}}}));
 const options={decideMode:true,connection:{provider:'typesafe-api',model:'jev-latest',key:'test'}};assert.equal((await router.select({},'task',{},tools,options)).executionMode,'direct');choice='invented';await assert.rejects(router.select({},'task',{},tools,options),/invalid execution mode/);
});
test('Planner and stage output schemas have unique required fields at every nesting level',()=>{
 const visit=schema=>{if(!schema || typeof schema!=='object')return;if(schema.required)assert.equal(new Set(schema.required).size,schema.required.length);if(schema.properties && schema.additionalProperties===false)assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());for(const value of Object.values(schema))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);};
 visit(router.PLAN_SCHEMA);visit(router.stageSchema({type:'object',additionalProperties:false,properties:{answer:{type:'string'}},required:['answer']},1));
});

test('Task-wide selection honours explicit exclusion even at low confidence; maybe remains available',()=>{
 const tools=[{name:'read_1'},{name:'read_2'},{name:'read_3'}],answers={tool_0:{type:'choice',choice:'include'},tool_1:{type:'choice',choice:'exclude',confidence:0.55},tool_2:{type:'choice',choice:'maybe'}};
 assert.deepEqual(router.apply(tools,answers,{keepUncertain:false}).map(t=>t.name),['read_1','read_3']);
});
