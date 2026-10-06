"use strict";
// Calls share the scanner used by Calls/Value Origin; keep the whole boolean expression in one diamond.
const {callsIn}=require('./value-origin-model');
const {printable}=require('./value-origin-tokens');
function conditionLabel(tokens,owner,sanitize){
  const calls=callsIn(tokens,true);
  const external=call=>!!(call.owner||call.receiver)&&String(call.owner||call.receiver).toUpperCase()!==String(owner||'').toUpperCase()&&String(call.receiver).toUpperCase()!=='ME';
  const name=call=>(call.owner||call.receiver?(call.owner||call.receiver)+call.arrow:'')+call.method;
  const roots=calls.filter(call=>!calls.some(other=>other!==call&&other.tokens[0].offset<=call.tokens[0].offset&&other.tokens.at(-1).endOffset>call.tokens.at(-1).endOffset));
  const rendered=[],lines=[];let depth=0,between=false;
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i],root=roots.find(call=>call.tokens[0].offset===token.offset);
    if(root){
      const nested=calls.filter(call=>call!==root&&call.tokens[0].offset>=root.tokens[0].offset&&call.tokens.at(-1).endOffset<root.tokens.at(-1).endOffset);
      const summary=(external(root)?'↗ ':'')+name(root)+'( '+(nested.length?nested.map(call=>(external(call)?'↗ ':'')+name(call)+'( … )').join(', ')+', …':'…')+' )';
      rendered.push({value:summary});while(i+1<tokens.length&&tokens[i+1].offset<root.tokens.at(-1).endOffset)i++;continue;
    }
    if(token.value==='(')depth++;if(token.value===')')depth--;
    const value=String(token.value).toUpperCase();
    if(!depth&&token.kind!=='literal'){
      if(value==='BETWEEN')between=true;
      else if(value==='AND'&&between)between=false;
      else if(['AND','OR'].includes(value)){lines.push(sanitize(printable(rendered.splice(0)),Infinity));}
    }
    rendered.push(token);
  }
  if(rendered.length)lines.push(sanitize(printable(rendered),Infinity));
  return {label:lines.join('<br/>'),calls:calls.filter(external).map(call=>({name:name(call),owner:call.owner,receiver:call.receiver,method:call.method,line:call.tokens[0].line,endLine:call.tokens.at(-1).line}))};
}
module.exports={conditionLabel};
