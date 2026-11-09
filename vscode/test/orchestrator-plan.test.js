"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),planner=require('../orchestrator-plan');
test('Planner validates actionable advice and labels it as unverified context',()=>{
 const input={goal:'Compare two documents',context:['Supplied: two documents'],steps:[{id:1,action:'Read both sources',tools:['read'],depends_on:[],success_criteria:['Both sources returned'],on_failure:'Inspect missing access'}],recovery:['Inspect missing access'],completion_checks:['Cite both sources']};
 assert.deepEqual(planner.parse(JSON.stringify(input)),input);
 assert.match(planner.context(input),/advisory, not verified evidence/);
 assert.match(planner.INSTRUCTIONS,/do not assume SAP/);
 assert.throws(()=>planner.parse('{"goal":"fake","steps":[]}'),/invalid context/);
 const request={instructions:'rules',prompt:'historical and current context'};
 const prepared=JSON.parse(planner.prompt('task',request,[{name:'read',inputSchema:{type:'object'}}]));assert.equal(prepared.task,'task');assert.equal(prepared.available_tools[0].name,'read');
});
