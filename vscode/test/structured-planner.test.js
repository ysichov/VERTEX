"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),api=require('../openai-compatible'),planner=require('../orchestrator-plan'),control=require('../orchestrator-supervisor');
const plan={goal:'Compare fictional measurements',context:[],steps:[{id:1,action:'Read the records',tools:[],depends_on:[],success_criteria:['Both samples read'],on_failure:'Check access'}],recovery:[],completion_checks:['Check both sample IDs']};
test('Compatible planner sends a direct strict schema and returns the root object',async()=>{
 const result=await api.ask({assistant:'openai-api',apiKey:'fake',model:'test',instructions:'Plan',prompt:'task',schema:planner.PLAN_SCHEMA,structuredResult:true,maxRounds:1,tools:[],capabilities:{tools:false},
 request:async(_id,_key,_route,body)=>{
  assert.deepEqual(body.response_format.json_schema.schema,planner.PLAN_SCHEMA);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);assert.equal(body.response_format.json_schema.schema.properties.answer,undefined);
  return {choices:[{message:{content:JSON.stringify(plan)}}],usage:{prompt_tokens:5,completion_tokens:2}};
 }});assert.deepEqual(planner.parse(result.plan),plan);
});
test('Malformed planner JSON is a format error; explicit refusals are not',async()=>{
 const request=message=>async()=>({choices:[{message}],usage:{prompt_tokens:5,completion_tokens:2}});
 const options={assistant:'openai-api',apiKey:'fake',model:'test',instructions:'Plan',prompt:'task',schema:planner.PLAN_SCHEMA,structuredResult:true,maxRounds:1,tools:[]};
 await assert.rejects(api.ask({...options,request:request({content:'{"goal":"x","completion_checks":["proof"}'})}),e=>e.code==='STRUCTURED_FORMAT');
 await assert.rejects(api.ask({...options,request:request({content:null,refusal:'Cannot answer'})}),e=>e.code!=='STRUCTURED_FORMAT'&&/refused/.test(e.message));
});
test('Plan and verdict contracts reject string wrappers and extra fields',()=>{
 assert.equal(planner.PLAN_SCHEMA.additionalProperties,false);assert.deepEqual(planner.PLAN_SCHEMA.required,Object.keys(plan));
 assert.throws(()=>planner.parse({answer:JSON.stringify(plan)}),e=>e.code==='STRUCTURED_FORMAT');assert.throws(()=>planner.parse({...plan,navigation:null}),e=>e.code==='STRUCTURED_FORMAT');
 assert.deepEqual(control.parseVerdict({accept:true,feedback:''}),{accept:true,feedback:''});assert.throws(()=>control.parseVerdict({accept:true,feedback:'',answer:'nested'}),e=>e.code==='STRUCTURED_FORMAT');
});


test('Individual steps enforce order, dependencies, tool names and success criteria',()=>{
 const clone=()=>JSON.parse(JSON.stringify(plan));
 const unavailable=clone();unavailable.steps[0].tools=['invented'];assert.throws(()=>planner.parse(unavailable,['read_measurements']),/unavailable tool/);
 const cycle=clone();cycle.steps[0].depends_on=[1];assert.throws(()=>planner.parse(cycle),/dependencies/);
 const empty=clone();empty.steps[0].success_criteria=[];assert.throws(()=>planner.parse(empty),/structured step/);
 const prose=clone();prose.steps=['Just do it'];assert.throws(()=>planner.parse(prose),/structured step/);
 const schema=planner.schema([{name:'read_measurements'}]);assert.deepEqual(schema.properties.steps.items.properties.tools.items.enum,['read_measurements']);assert.equal(schema.properties.steps.items.additionalProperties,false);
});
