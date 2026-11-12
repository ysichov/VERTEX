const test=require('node:test'),assert=require('node:assert/strict');const review=require('../code-review');
test('a Git review block has Open and clickable new-side line numbers; other reviews do not',()=>{
 const file={parts:review.hunks('a\nb\nc\n','a\nB\nc\nd\n'),before:'a\nb\nc\n',after:'a\nB\nc\nd\n'};
 const git=review.fileDiffHtml(file,false,true);
 assert.match(git,/data-action="open-code" data-line="\d+"/);assert.match(git,/class="number jump" data-line="2"/);
 const plain=review.fileDiffHtml(file,false,false);
 assert.doesNotMatch(plain,/open-code|number jump/);
 assert.doesNotMatch(review.fileDiffHtml({...file,after:''},false,true),/number jump/);
});
