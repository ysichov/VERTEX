"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const protection=require('../context-protection');

// Only structured data is protected: a field or a debugger variable named like a credential has its value hidden.
// Code, diffs and other text go as written - a key written into code is the code's problem, not VERTEX's.

test('named secret values are hidden without changing live data; other fields stay',()=>{
  const secret='fixture-credential-123456';
  const input={earlier_copy:secret,vars:[{name:'I_APIKEY',type:'C(32)',value:secret},{NAME:'PASSWORD',VALUE:'different-password'}],source:'api credential '+secret,n:2};
  const output=protection.protect(input);
  assert.match(output.vars[0].value,/length=25 initial=false/);
  assert.match(output.vars[1].VALUE,/REDACTED/);
  assert.equal(output.vars[0].type,'C(32)');assert.equal(output.n,2);
  assert.equal(output.source,'api credential '+secret,'text is not searched for copies');
  assert.equal(output.earlier_copy,secret,'a field with an ordinary name keeps its value');
  assert.equal(input.vars[0].value,secret);
  assert.deepEqual(protection.protect(output),output,'already protected data stays stable');
});

test('empty and short secrets keep presence metadata without masking unrelated counters',()=>{
  const p=protection.create();
  const output=p.protect({I_APIKEY:'',PASSWORD:'2',counter:'2',KEY:'business-key',API_KEY_LENGTH:32});
  assert.match(output.I_APIKEY,/length=0 initial=true/);
  assert.match(output.PASSWORD,/length=1 initial=false/);
  assert.equal(output.counter,'2');assert.equal(output.KEY,'business-key');assert.equal(output.API_KEY_LENGTH,32);
});

test('secret identity permits equality comparisons without persisting raw values',()=>{
  const p=protection.create();
  const first=p.protect({name:'I_APIKEY',value:'first-fixture-key'}).value;
  assert.equal(p.protect({name:'I_APIKEY',value:'first-fixture-key'}).value,first);
  assert.notEqual(p.protect({name:'I_APIKEY',value:'second-fixture-key'}).value,first);
});

test('debugger variables inside JSON text and labelled context blocks are protected',()=>{
  const key='nested-fixture-secret';
  const input={content:[{type:'text',text:JSON.stringify({variables:[{name:'PARAMS/I_APIKEY',value:key}]})}]};
  const output=protection.protect(input);assert.ok(!JSON.stringify(output).includes(key));
  assert.match(JSON.parse(output.content[0].text).variables[0].value,/REDACTED/);
  const context='Context:\n'+JSON.stringify({changed:{I_APIKEY:key}},null,2);
  assert.ok(!protection.create().text(context).includes(key));
  const ordinary='History:\n[\n  {"screenshots": 1}\n]';
  assert.equal(protection.create().text(ordinary),ordinary);
});

test('code and other text go exactly as written',()=>{
  for(const code of [
    "headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body\nif(response.ok)return response;\ninput.password='';",
    'Authorization: Bearer abcdefghijkl1234\nI_APIKEY = "quoted-credential"\nPASSWORD=literal-password.',
    'symbol = |{ CONV i( ls_index-index ) }|.\ni_apikey = get_key( ).',
    'value eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U end'])
    assert.equal(protection.create().text(code),code);
});

test('credential-like variable names of the debugger are hidden',()=>{
  for(const name of ['LV_TOKEN','LV_AUTH','GV_AUTH_HEADER','LV_ACCESS_KEY','LV_SUBSCRIPTION_KEY','I_APIKEY'])
    assert.match(protection.create().protect({name,value:'Abc123def456ghi789jkl012mno345pq'}).value,/^\[REDACTED secret-/,name);
  assert.equal(protection.create().protect({name:'LV_AUTHOR',value:'SYCHOV'}).value,'SYCHOV','a name that only starts like AUTH is not one');
});

test('project-specific field patterns extend built-in rules',()=>{
  try {
    protection.configure(['Z_PRIVATE_*']);
    const output=protection.protect({name:'z_private_customer',value:'custom-private-value'});
    assert.match(output.value,/REDACTED/);
    assert.match(protection.protect({I_APIKEY:'built-in-value'}).I_APIKEY,/REDACTED/);
  } finally {protection.configure([]);}
});

test('MCP model-facing responses hide named debugger values, including nested JSON text',async()=>{
  const mcp=require('../mcp');
  const result=await mcp.dispatch({}, {method:'tools/call',params:{name:'read_values',arguments:{}}}, {
    tools:[{name:'read_values'}],call:async()=>({content:[{type:'text',text:JSON.stringify({name:'I_APIKEY',value:'tool-private-value'})}]})
  });
  assert.ok(!JSON.stringify(result).includes('tool-private-value'));
  assert.match(result.content[0].text,/REDACTED/);
});

test('checkpoint and conversation log files contain no captured debugger credential',()=>{
  const fs=require('fs'),os=require('os'),path=require('path'),history=require('../sap-debug-history'),logger=require('../session-log');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vx-protected-files-'));
  const secret='persisted-fixture-secret';
  try {
    const record={format:1,session_id:'48647647-1234-4567-8901-123456789abc',meta:{name:'ZREP'},timeline:[{vars:[{name:'I_APIKEY',value:secret}]}],sources:{}};
    const file=history.checkpoint(folder,record);
    assert.ok(!fs.readFileSync(file,'utf8').includes(secret));assert.equal(record.timeline[0].vars[0].value,secret);
    const log=logger.create(folder,'claude','protection',{questions:true,answers:true,request:true});
    log.request({prompt:'Debug:\n'+JSON.stringify(record)});
    assert.ok(!fs.readFileSync(log.file,'utf8').includes(secret));
    const legacy=path.join(folder,'legacy.vertex-debug.json');fs.writeFileSync(legacy,JSON.stringify(record));
    assert.ok(!JSON.stringify(history.load(legacy)).includes(secret),'legacy recordings are protected on read');
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
