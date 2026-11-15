"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const output=require("../command-output");
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),"vertex-output-test-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
test("short command output stays complete inline and creates no file",t=>{
 const directory=fixture(t),capture=output.collect({directory});capture.write("stdout","hello\n");capture.write("stderr","warning\n");
 const result=capture.finish();assert.equal(result.stdout,"hello\n");assert.equal(result.stderr,"warning\n");assert.equal(result.output_truncated,false);assert.equal(result.output_file,undefined);assert.deepEqual(fs.readdirSync(directory),[]);
});
test("large output preserves prefix, middle and suffix on disk with a bounded model preview",async t=>{
 const directory=fixture(t),capture=output.collect({directory});
 const chunks=["PREFIX\n","界".repeat(5000)+"\n","error: early failure\n","x\n".repeat(1600000),"Verified result\nSUFFIX\n"];
 for(const chunk of chunks)capture.write("stdout",chunk);
 const result=capture.finish();assert.equal(result.output_truncated,true);assert.equal(fs.readFileSync(result.output_file,"utf8"),chunks.join(""));
 assert.ok(Buffer.byteLength(JSON.stringify(result))<24000);assert.ok(result.highlights.includes("error: early failure"));assert.match(result.stdout,/SUFFIX/);
 const first=await output.readPage(result.output_file,1,1);assert.equal(first.text,"1: PREFIX");assert.equal(first.next_offset,2);
 assert.match((await output.readPage(result.output_file,3,1)).text,/early failure/);
 const next=output.collect({directory});assert.equal(output.owns(result.output_file),true);next.write("stdout","small");assert.ok(fs.existsSync(result.output_file));
});
test("log persistence errors are explicit and do not discard the command preview",t=>{
 const directory=fixture(t),file=path.join(directory,"not-a-directory");fs.writeFileSync(file,"x");
 const capture=output.collect({directory:file});capture.write("stderr","error!".repeat(2000));
 const result=capture.finish();assert.ok(result.log_error);assert.equal(result.output_file,undefined);assert.match(result.stderr,/error!/);
});
