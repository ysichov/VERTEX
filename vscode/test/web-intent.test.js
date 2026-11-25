"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{decide}=require("../web-intent");

test("Web intent stays off without a configured Jev decision model",async()=>{
 const vscode={workspace:{getConfiguration:()=>({get:()=>null})}};
 assert.deepEqual(await decide(vscode,"Какие курсы ПриватБанка?"),{web:false,status:"unavailable"});
});
