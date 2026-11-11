"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const protection=require('../context-protection');

test('named secret values and their copies are removed without changing live data',()=>{
  const secret='fixture-credential-123456';
  const input={earlier_copy:secret,vars:[{name:'I_APIKEY',type:'C(32)',value:secret},{NAME:'PASSWORD',VALUE:'different-password'}],source:'api credential '+secret,n:2};
  const output=protection.protect(input),serialized=JSON.stringify(output);
  assert.ok(!serialized.includes(secret));assert.ok(!serialized.includes('different-password'));
  assert.match(output.vars[0].value,/length=25 initial=false/);
  assert.equal(output.vars[0].type,'C(32)');assert.equal(output.n,2);
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

test('nested JSON tool text and labelled context blocks are protected before serialization',()=>{
  const key='nested-fixture-secret';
  const input={content:[{type:'text',text:JSON.stringify({variables:[{name:'PARAMS/I_APIKEY',value:key}],alias:key})}]};
  const output=protection.protect(input);assert.ok(!JSON.stringify(output).includes(key));
  assert.match(JSON.parse(output.content[0].text).variables[0].value,/REDACTED/);
  const context='Context:\n'+JSON.stringify({changed:{I_APIKEY:key},copied:key},null,2)+'\nAnother copy: '+key;
  assert.ok(!protection.create().text(context).includes(key));
  const ordinary='History:\n[\n  {"screenshots": 1}\n]';
  assert.equal(protection.create().text(ordinary),ordinary);
});

test('explicit credentials and private keys are hidden; ordinary code and IDs remain available',()=>{
  const raw='Authorization: Bearer abcdefghijkl1234\nI_APIKEY = "quoted-credential"\nPASSWORD=\'\'\n-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----';
  const output=protection.create().text(raw);
  for(const value of ['abcdefghijkl1234','quoted-credential','private-key-body'])assert.ok(!output.includes(value));
  assert.match(output,/initial=true/);
  const code='i_apikey = get_key( ).\ni_apikey = p_key.\nREAD TABLE rows INDEX 2.';
  assert.equal(protection.create().text(code),code);
  const escaped=protection.create().text('PASSWORD="first\\"second"\nI_APIKEY = \'first\'\'second\'.');
  assert.ok(!escaped.includes('second'));
  const headers=protection.create().text('https://example.invalid/?api_key=fixture%40password&mode=test\nCookie: session=private-cookie; refresh=another-private-cookie');
  assert.ok(!headers.includes('fixture%40password'));assert.ok(!headers.includes('private-cookie'));
  assert.ok(headers.includes('mode=test'));
  assert.ok(!protection.create().text('PASSWORD=literal-password.').includes('literal-password'));
});

test('project-specific field patterns extend built-in rules',()=>{
  try {
    protection.configure(['Z_PRIVATE_*']);
    const output=protection.protect({name:'z_private_customer',value:'custom-private-value'});
    assert.match(output.value,/REDACTED/);
    assert.match(protection.protect({I_APIKEY:'built-in-value'}).I_APIKEY,/REDACTED/);
  } finally {protection.configure([]);}
});

test('MCP model-facing responses are protected, including nested JSON text',async()=>{
  const mcp=require('../mcp');
  const result=await mcp.dispatch({}, {method:'tools/call',params:{name:'read_values',arguments:{}}}, {
    tools:[{name:'read_values'}],call:async()=>({content:[{type:'text',text:JSON.stringify({name:'I_APIKEY',value:'tool-private-value',copy:'tool-private-value'})}]})
  });
  assert.ok(!JSON.stringify(result).includes('tool-private-value'));
  assert.match(result.content[0].text,/REDACTED/);
});

test('checkpoint and conversation log files contain no captured credential value',()=>{
  const fs=require('fs'),os=require('os'),path=require('path'),history=require('../sap-debug-history'),logger=require('../session-log');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'vx-protected-files-'));
  const secret='persisted-fixture-secret';
  try {
    const record={format:1,session_id:'48647647-1234-4567-8901-123456789abc',meta:{name:'ZREP'},timeline:[{vars:[{name:'I_APIKEY',value:secret}],alias:secret}],sources:{'/src':'key='+secret}};
    const file=history.checkpoint(folder,record);
    assert.ok(!fs.readFileSync(file,'utf8').includes(secret));assert.equal(record.timeline[0].vars[0].value,secret);
    const log=logger.create(folder,'claude','protection',{questions:true,answers:true,request:true});
    log.user('I_APIKEY = "'+secret+'"');log.request({prompt:'Debug:\n'+JSON.stringify(record)});log.assistant({text:'Value was '+secret});
    assert.ok(!fs.readFileSync(log.file,'utf8').includes(secret));
    const legacy=path.join(folder,'legacy.vertex-debug.json');fs.writeFileSync(legacy,JSON.stringify(record));
    assert.ok(!JSON.stringify(history.load(legacy)).includes(secret),'legacy recordings are protected on read');
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
