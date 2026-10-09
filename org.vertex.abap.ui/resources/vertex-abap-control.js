// Wrapped so that, inlined in a page as a classic script, it leaves no global names (a page declares its own api).
(function () {
"use strict";
// Shared statement rules for the logic diagram and execution FLOW.
const procedureEnds=Object.freeze({METHOD:'ENDMETHOD',FORM:'ENDFORM',FUNCTION:'ENDFUNCTION',MODULE:'ENDMODULE'});
const endings=new Set(Object.values(procedureEnds));
const isProcedureEnd=word=>endings.has(String(word||'').toUpperCase());
const blockEnds=Object.freeze({IF:'ENDIF',CASE:'ENDCASE',LOOP:'ENDLOOP',DO:'ENDDO',WHILE:'ENDWHILE',TRY:'ENDTRY',...procedureEnds,SELECT:'ENDSELECT',AT:'ENDAT',PROVIDE:'ENDPROVIDE'});
const declarations=new Set('REPORT PROGRAM FUNCTION-POOL TYPE-POOL TYPE-POOLS TYPES DATA FINAL CLASS-DATA CONSTANTS STATICS FIELD-SYMBOLS PARAMETERS SELECT-OPTIONS SELECTION-SCREEN TABLES RANGES INCLUDE METHODS CLASS-METHODS INTERFACES ALIASES EVENTS DEFINE END-OF-DEFINITION NODES INFOTYPES'.split(' '));
const containers=new Set(['CLASS','ENDCLASS','INTERFACE','ENDINTERFACE']);
const sideEffects=new Set('SELECT INSERT UPDATE MODIFY DELETE COMMIT ROLLBACK OPEN FETCH CLOSE AUTHORITY-CHECK EXPORT IMPORT SET'.split(' '));
const loops=new Set(['LOOP','DO','WHILE']);
const transfers=new Set(['RETURN','EXIT','CONTINUE','CHECK','RAISE','STOP','LEAVE']);
const eventPattern=/^(LOAD-OF-PROGRAM|INITIALIZATION|START-OF-SELECTION|END-OF-SELECTION|TOP-OF-PAGE(?:\s+DURING\s+LINE-SELECTION)?|END-OF-PAGE|AT\s+SELECTION-SCREEN(?:\s+OUTPUT|\s+ON\s+[\w-]+(?:\s+[\w-]+)?)?|AT\s+LINE-SELECTION|AT\s+USER-COMMAND|AT\s+PF\d+)\s*\.$/i;
function classifyStatement(statement,scanCalls){
  const tokens=statement.tokens||[],text=String(statement.text||'').trim(),word=(text.match(/^([\w-]+)/)?.[1]||tokens[0]?.value||'').toUpperCase();
  const inline=['DATA','FINAL'].includes(word)&&tokens[1]?.value==='(';
  const declaration=declarations.has(word)&&!inline;
  const calls=scanCalls?scanCalls(tokens):[];
  const hasCalls=calls.length>0||['CALL','PERFORM','SUBMIT'].includes(word)||(!scanCalls&&(/\bNEW\s+/i.test(text)||/[\w/~]+\s*(?:->|=>)\s*[\w/~]+\s*\(/.test(text)||/^[\w/~]+\s*\(/.test(text)));
  const event=eventPattern.exec(text)?.[1]?.toUpperCase().replace(/\s+/g,' ')||'';
  return {word,declaration,container:containers.has(word),procedureStart:Object.hasOwn(procedureEnds,word),procedureEnd:isProcedureEnd(word),event,hasCalls,sideEffect:sideEffects.has(word),loop:loops.has(word),logic:hasCalls||transfers.has(word)||Object.hasOwn(blockEnds,word)||Object.values(blockEnds).includes(word)||['ELSE','ELSEIF','WHEN','CATCH','CLEANUP'].includes(word)};
}
// Statement nodes may be absent after Logic filtering. Boundaries still come from all source rows.
function executionEdges(rows){
  const edges=[],pairs=new Map(),stack=[],branches=new Map();
  const word=row=>row.control?.word||classifyStatement(row).word;
  rows.forEach((row,i)=>{const w=word(row);if(Object.hasOwn(blockEnds,w)&&!Object.hasOwn(procedureEnds,w)){stack.push(i);branches.set(i,[]);return;}if(stack.length&&['ELSE','ELSEIF','WHEN','CATCH','CLEANUP'].includes(w)){branches.get(stack.at(-1)).push(i);return;}const closing=stack.findLastIndex(at=>blockEnds[word(rows[at])]===w);if(closing>=0){pairs.set(i,stack[closing]);stack.splice(closing);}});
  const end=rows.find(row=>isProcedureEnd(word(row))&&row.nodeId)?.nodeId||'';
  const connect=(from,to,label='')=>{if(from&&to&&from!==to)edges.push({from,to,label});};
  function range(from,to,next,loop){
    for(let i=to-1;i>=from;i--){const row=rows[i],w=word(row),id=row.nodeId;
      if(pairs.has(i)){
        const start=pairs.get(i),open=rows[start],header=open.nodeId,kind=word(open),join=id||next;
        connect(id,next);
        if(['LOOP','DO','WHILE','SELECT','PROVIDE'].includes(kind)){
          const body=range(start+1,i,header||join,{entry:header,exit:join});
          connect(header,body,'true');connect(header,join,'false');next=header||body;
        }else if(kind==='IF'){
          const cuts=[start,...branches.get(start),i];let failure=join;
          for(let b=cuts.length-2;b>=0;b--){const at=cuts[b],branch=rows[at],entry=range(at+1,cuts[b+1],join,loop);
            if(word(branch)==='ELSE'){connect(branch.nodeId,entry);failure=branch.nodeId||entry;}
            else {connect(branch.nodeId,entry,'true');connect(branch.nodeId,failure,'false');failure=branch.nodeId||entry;}
          }next=failure;
        }else if(kind==='CASE'){
          const cuts=[...branches.get(start),i];let other=false;
          for(let b=0;b<cuts.length-1;b++){const branch=rows[cuts[b]],entry=range(cuts[b]+1,cuts[b+1],join,loop);connect(header,branch.nodeId||entry,branch.text);connect(branch.nodeId,entry);if(/WHEN\s+OTHERS/i.test(branch.text))other=true;}
          if(!other)connect(header,join,'other');next=header||join;
        }else{
          const cuts=[start,...branches.get(start),i];for(let b=0;b<cuts.length-1;b++){const at=cuts[b],entry=range(at+1,cuts[b+1],join,loop);if(at===start)connect(header,entry);else{connect(header,rows[at].nodeId||entry,word(rows[at]));connect(rows[at].nodeId,entry);}}next=header||join;
        }i=start;continue;
      }
      if(!id)continue;
      if(['RETURN','STOP'].includes(w))connect(id,end);
      else if(w==='EXIT')connect(id,loop?.exit||end);
      else if(w==='CONTINUE')connect(id,loop?.entry||end);
      else if(w==='CHECK'){connect(id,next,'true');connect(id,loop?.exit||end,'false');}
      else connect(id,next);
      next=id;
    }return next;
  }
  const entry=range(0,rows.length,'',null);return {entry,edges};
}
const api={procedureEnds,isProcedureEnd,blockEnds,classifyStatement,executionEdges};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.vertexAbapControl=api;
})();
