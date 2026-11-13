const test = require('node:test'), assert = require('node:assert/strict');
const {priceUsage} = require('../anthropic-pricing');
test('Anthropic standard prices, cache TTL and Haiku prompt threshold', () => {
 assert.equal(priceUsage('claude-haiku-5-5',{input_tokens:14741,output_tokens:383}).cost_usd,0.0016656);
 assert.equal(priceUsage('claude-haiku-5-5',{input_tokens:100000,output_tokens:10}).cost_usd,0.010005);
 assert.equal(priceUsage('claude-haiku-5-5',{input_tokens:100000,output_tokens:10,cache_read_input_tokens:1}).cost_usd,0.05002505);
 assert.equal(priceUsage('claude-sonnet-5-5',{input_tokens:100,output_tokens:10,cache_read_input_tokens:100,cache_creation_input_tokens:100,cache_creation:{ephemeral_1h_input_tokens:40}}).cost_usd,0.00062);
 assert.equal(priceUsage('unknown',{input_tokens:1,output_tokens:1}).cost_usd,undefined);
 assert.equal(priceUsage('claude-haiku-5-5',{input_tokens:1,output_tokens:1,cost_usd:0}).cost_usd,0);
});
test('Anthropic model callback, total, log reader and chat panel carry the same price',async t=>{
 const https=require('node:https'),{EventEmitter}=require('node:events');let call;
 t.mock.method(https,'request',(_options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>{const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>{};callback(res);res.emit('data',JSON.stringify({model:'claude-haiku-5-5',content:[{type:'text',text:'answer'}],usage:{input_tokens:14741,output_tokens:383}}));res.emit('end');};return req;});
 const result=await require('../anthropic').ask({apiKey:'fake',model:'claude-haiku-5-5',prompt:'task',instructions:'rules',textOnly:true,onModelCall:e=>call=e});
 assert.equal(call.usage.cost_usd,0.0016656);assert.equal(result.usage.cost_usd,call.usage.cost_usd);
 assert.match(require('../sidebar').usageLine(result),/\$0\.0016656/);
 const rows=[{type:'user',message:{content:'question'}},{type:'assistant',message:{id:'a',model:result.model,usage:{input_tokens:14741,output_tokens:383},content:[]}}];
 const session=require('../log-report').parseSession(rows.map(x=>JSON.stringify({timestamp:"2026-11-13T14:12:49Z",...x})).join('\n'),'anthropic-api_20261113_161236_2c0396.jsonl');
 assert.equal(session.usage.cost,0.0016656);assert.equal(session.prompts[0].usage.cost,0.0016656);
});


test('Anthropic screenshot recognition sends the image pixels in native image blocks', async t => {
 const https=require('node:https'),{EventEmitter}=require('node:events');let body;
 const image={media_type:'image/png',data:Buffer.alloc(130000,1).toString('base64')};
 t.mock.method(https,'request',(_options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=payload=>{body=JSON.parse(payload);const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>{};callback(res);res.emit('data',JSON.stringify({content:[{type:'text',text:'visible UI'}],usage:{input_tokens:10,output_tokens:2}}));res.emit('end');};return req;});
 await require('../anthropic').ask({apiKey:'fake',model:'claude-haiku-5-5',prompt:'Recognize screenshot',instructions:'Describe only the image',textOnly:true,images:[image]});
 assert.deepEqual(body.messages[0].content,[{type:'text',text:'Recognize screenshot'},{type:'image',source:{type:'base64',media_type:'image/png',data:image.data}}]);
 assert.equal(body.tools,undefined);
});
