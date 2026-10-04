/* The flow of a path through code, as a graph for vertex-flow.js: one builder for every view that draws it. What differs
   between views is only where the rows come from - the analysis of a value, or the analysis from a breakpoint in the
   debugger - never how they are drawn. `sf` = {rows, sites, point, name, stopAt}. */
(function (root) {
"use strict";
function build(sf,mode){
  var sequence=[],stopped=false,rows=sf.rows,b=sf.point,nodes=[],edges=[],scopes={},order=[],sites={},called={},seq=0;
  rows.forEach(function(w){if(!scopes[w.scope]){scopes[w.scope]=[];order.push(w.scope);}scopes[w.scope].push(w);});
  (sf.sites||[]).forEach(function(c){var k=c.name+":"+c.line;sites[k]=(sites[k]||[]).concat(c.callees);});
  Object.keys(sites).forEach(function(k){sites[k].forEach(function(c){if(scopes[c])called[c]=true;});});
  var id=function(){return "f"+(seq++);},at=function(scope){var cut=scope.indexOf("→");return {klass:cut>=0?scope.slice(0,cut):scope,method:cut>=0?scope.slice(cut+1):"GLOBAL"};};
  // A node opens as Value origin opens its own: by the analysis's source and the line it counts in, not by the debugger's.
  var src=function(w){return w.source?"origin:"+w.source+"|"+(w.location||""):"";};
  // A class or a routine opens its METHOD (line 1 of its include, as Value origin opens a method), not the line of its first
  // statement: the two count differently, and the head is what the node stands for. A program's event has no head to open.
  var head=function(w){return String(w.type).toUpperCase()==="CLAS"?1:w.aceLine;};
  nodes.push({id:"bseroot",key:"root",text:sf.name,location:sf.name,owner:sf.name,source:b.url,line:b.line,stack:0,type:"program",bse:false});
  // The flow starts where the breakpoints are: the routines of that object no call reaches. What no call of the flow reaches
  // and is not one of them is left out and said (below) - drawn under the program it would say it is called from there.
  var entries=order.filter(function(x){return !called[x]&&at(x).klass===sf.name;});
  if(!entries.length)entries=order.filter(function(x){return !called[x];}).slice(0,1);
  if(!entries.length)entries=order.slice(0,1);
  var seen={},unit={},firstOf={},klassNode={},pairs={},stubs=[];
  // A path ends at a statement that stands on a checked breakpoint (sf.stopAt): that statement is the last one drawn, and what it calls is not.
  function atEnd(w){return !!(sf.stopAt&&String(w.name).toUpperCase()===sf.stopAt.name&&w.line===sf.stopAt.line);}
  // A class stands at the depth of the call that first reached it, as a routine and a statement do: the depth control counts calls.
  function classNode(klass,w,depth){
    if(!klassNode[klass]){klassNode[klass]={id:id(),key:"c|"+klass,text:klass,location:klass,owner:klass,source:src(w),line:head(w),aceLocation:w.location,stack:depth||1,type:"class",bse:false};nodes.push(klassNode[klass]);}
    return klassNode[klass];
  }
  // A routine the flow lists no statement of is still entered: the transition is drawn, as a block with nothing under it, so a call
  // is never lost for want of statements to show under it.
  function callee(c,parent,label,depth){
    if(scopes[c]){emit(c,parent,label,depth);return;}
    var n=at(c);if(stubs.indexOf(c)<0)stubs.push(c);
    if(mode==="classes"){
      var k=classNode(n.klass,{type:"CLAS",source:"",location:c.replace("→","->"),aceLine:1},depth),key=(parent.klass||"root")+">"+n.klass;
      if(parent.klass!==n.klass&&!pairs[key]){pairs[key]=true;edges.push({from:parent.klass?klassNode[parent.klass].id:"bseroot",to:k.id,label:label});}
      return;
    }
    if(!unit[c]){unit[c]={id:id(),key:"m|"+c,text:n.klass+"=>"+n.method,location:c,owner:n.klass,source:"",line:1,stack:depth,type:"method",bse:false};nodes.push(unit[c]);}
    edges.push({from:parent.id,to:unit[c].id,label:label});
  }
  // Execution order and the stack: a routine is drawn where it is called, its statements in order, and a call inside
  // them draws the routine it reaches under that statement, one level deeper.
  function emit(scope,parent,label,depth){
    if(stopped)return;
    var first=scopes[scope][0],n=at(scope),from=parent;
    if(mode==="classes"){
      var k=classNode(n.klass,first,depth);
      if(!seen[scope]){seen[scope]=true;
        if(parent.klass){var key=parent.klass+">"+n.klass;if(parent.klass!==n.klass&&!pairs[key]){pairs[key]=true;edges.push({from:klassNode[parent.klass].id,to:k.id,label:label});}}
        else if(!pairs["root>"+n.klass]){pairs["root>"+n.klass]=true;edges.push({from:"bseroot",to:k.id,label:""});}
        scopes[scope].forEach(function(w){if(stopped)return;if(atEnd(w)){stopped=true;return;}var callees=sites[w.name+":"+w.line]||[];
          callees.forEach(function(c){callee(c,{klass:n.klass},String(w.line),depth+1);});});}
      return;
    }
    // Statements read as the statement that calls a routine already names it: the routine's own statements hang under that
    // call, with no block of the routine between (a block for it is the entry's alone - the program's event the flow starts in).
    var container=parent;
    if(mode==="steps"&&parent.type==="operation"){
      if(seen[scope]){if(firstOf[scope])edges.push({from:parent.id,to:firstOf[scope],label:label});return;}
      seen[scope]=true;
    }else{
      if(!unit[scope]){
        unit[scope]={id:id(),key:"m|"+scope,text:n.klass===sf.name?n.method:n.klass+"=>"+n.method,location:scope,owner:n.klass,source:src(first),line:head(first),aceLocation:first.location,stack:depth,type:"method",bse:false};
        nodes.push(unit[scope]);}
      edges.push({from:parent.id,to:unit[scope].id,label:label});
      if(seen[scope])return;seen[scope]=true;
      container=unit[scope];
    }
    if(mode==="methods"){
      scopes[scope].forEach(function(w){if(stopped)return;if(atEnd(w)){stopped=true;return;}(sites[w.name+":"+w.line]||[]).forEach(function(c){callee(c,unit[scope],String(w.line),depth+1);});});
      return;
    }
    // ABAP blocks are hierarchy: a control statement is the parent of its body, ENDIF and ENDLOOP only close the level,
    // and WHEN / ELSE close the previous branch and own what follows.
    var blocks=[];
    scopes[scope].forEach(function(w){
      var word=(String(w.text).match(/^([A-Za-z-]+)/)||[])[1]||"";word=word.toUpperCase();
      if(stopped)return;
      if(/^END(IF|CASE|LOOP|DO|WHILE|SELECT)$/.test(word)){while(blocks.length&&blocks[blocks.length-1].branch)blocks.pop();blocks.pop();return;}
      if(stopped)return;
      sequence.push(w);
      var branch=/^(WHEN|ELSE|ELSEIF)$/.test(word);
      if(branch)while(blocks.length&&blocks[blocks.length-1].branch)blocks.pop();
      var node={id:id(),key:"o|"+w.name+":"+w.line,text:w.text.length>100?w.text.slice(0,97)+"…":w.text,location:scope,owner:n.klass,source:src(w),
        line:w.aceLine,aceLocation:w.location,stack:depth,type:"operation",bse:!!w.included,branch:branch};
      nodes.push(node);edges.push({from:blocks.length?blocks[blocks.length-1].id:container.id,to:node.id,label:String(w.line)});
      if(!blocks.length&&!firstOf[scope])firstOf[scope]=node.id;
      if(branch||/^(IF|CASE|LOOP|DO|WHILE|SELECT)$/.test(word))blocks.push({id:node.id,branch:branch});
      if(atEnd(w)){stopped=true;return;}
      (sites[w.name+":"+w.line]||[]).forEach(function(c){callee(c,node,String(w.line),depth+1);});
    });
  }
  entries.forEach(function(x){emit(x,mode==="classes"?{}:{id:"bseroot"},"",1);});
  var unreached=sf.stopAt?[]:order.filter(function(x){return !seen[x];}),said=[];
  var named=function(list){return list.slice(0,3).map(function(x){return x.replace("→","=>");}).join(", ")+(list.length>3?", …":"");};
  if(unreached.length)said.push("Not drawn: "+unreached.length+" routine"+(unreached.length===1?"":"s")+" of the flow that no call the analysis can follow reaches ("+named(unreached)+").");
  if(stubs.length)said.push("Called, with no statement of theirs in the flow: "+named(stubs)+".");
  var byId={};nodes.forEach(function(x){byId[x.id]=x;});
  rows.forEach(function(w){if(!w.included)return;var n=at(w.scope);
    if(klassNode[n.klass])klassNode[n.klass].bse=true;if(unit[w.scope])unit[w.scope].bse=true;});
  for(var again=true;again;){again=false;edges.forEach(function(e){var from=byId[e.from],to=byId[e.to];if(from&&to&&to.bse&&!from.bse){from.bse=true;again=true;}});}
  var idOf={},deepest=0;nodes.forEach(function(x){idOf[x.key]=x.id;if(x.stack>deepest)deepest=x.stack;});
  return {nodes:[],edges:[],formula:{nodes:[],edges:[]},bseFlow:{nodes:nodes,edges:edges},originTitle:"",maxStack:deepest,maxLevel:0,bseFlowHtml:"",sequence:sequence,ids:idOf,said:said};
}
var api={build:build};
if(typeof module!=="undefined"&&module.exports){module.exports=api;}else{root.vertexFlowGraph=api;}
})(typeof window!=="undefined"?window:this);
