"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),api=require('../openai-compatible');
const schema={type:'object',additionalProperties:false,required:['goal'],properties:{goal:{type:'string'}}};
test('Compatible structured result sends a direct strict root schema without action tools',async()=>{
 const result=await api.ask({assistant:'openai-api',apiKey:'fake',model:'test',instructions:'Return result',prompt:'task',schema,structuredResult:true,maxRounds:1,tools:[],capabilities:{tools:false},
 request:async(_id,_key,_route,body)=>{assert.deepEqual(body.response_format.json_schema.schema,schema);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);return {choices:[{message:{content:'{"goal":"task"}'}}],usage:{prompt_tokens:5,completion_tokens:2}};}});
 assert.deepEqual(result.plan,{goal:'task'});
});
test('Malformed structured JSON is a format error; explicit refusals are not',async()=>{
 const request=message=>async()=>({choices:[{message}],usage:{prompt_tokens:5,completion_tokens:2}});
 const options={assistant:'openai-api',apiKey:'fake',model:'test',instructions:'Return result',prompt:'task',schema,structuredResult:true,maxRounds:1,tools:[]};
 await assert.rejects(api.ask({...options,request:request({content:'{"goal":"x"'})}),e=>e.code==='STRUCTURED_FORMAT');
 await assert.rejects(api.ask({...options,request:request({content:null,refusal:'Cannot answer'})}),e=>e.code!=='STRUCTURED_FORMAT'&&/refused/.test(e.message));
});
