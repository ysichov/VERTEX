/* The selection screen drawn as SAP lays it out, shared by VERTEX Smart Debugger and the program window: each page has this
   file put in at its SELECTION-SCREEN-UI mark, by tools-window.js and program-window.js. */
/* The selection screen as SAP lays it out: blocks with their frame and title, lines of several elements, comments,
   SKIP and ULINE, parameters, radio buttons, checkboxes and SELECT-OPTIONS, each named by its selection text when the
   program has one. What cannot be drawn is named, not left out quietly. */
var RANGE_OPTIONS=["EQ","NE","GT","GE","LT","LE","BT","NB","CP","NP"];
function screenText(text,texts){if(!text)return "";if(text.symbol)return texts.symbols&&texts.symbols[text.symbol]||"TEXT-"+text.symbol;
  if(text.literal!=null)return text.literal;return text.name||"";}
function readRange(range){var rows=[];range.querySelectorAll(".range-row").forEach(function(row){var f=function(n){var el=row.querySelector('[data-f="'+n+'"]');return el?el.value:"";};
  if(f("low")===""&&f("high")==="")return;rows.push({sign:f("sign"),option:f("option"),low:f("low"),high:f("high")});});return rows;}
function rangeRow(range,element,row){var line=document.createElement("div");line.className="range-row";
  var pick=function(name,values,value){var select=document.createElement("select");select.setAttribute("data-f",name);
    values.forEach(function(v){var o=document.createElement("option");o.value=v;o.textContent=v;select.appendChild(o);});select.value=value;return select;};
  var field=function(name,value){var input=document.createElement("input");input.type="text";input.setAttribute("data-f",name);input.value=value||"";return input;};
  line.append(pick("sign",["I","E"],row&&row.sign||"I"),pick("option",element.noIntervals?RANGE_OPTIONS.filter(function(o){return o!=="BT"&&o!=="NB";}):RANGE_OPTIONS,row&&row.option||"EQ"),field("low",row&&row.low));
  if(!element.noIntervals){var to=document.createElement("span");to.textContent=" to ";line.append(to,field("high",row&&row.high));}
  if(!element.noExtension){var remove=document.createElement("button");remove.textContent="\u00d7";remove.title="Remove this row";
    remove.onclick=function(){line.remove();};line.appendChild(remove);}
  range.insertBefore(line,range.querySelector(".range-add"));}
function drawScreen(box,screen,kept){var texts=screen.texts||{},parents=[box],label=function(name){return texts.selections&&texts.selections[name]||name;};
  if(texts.error){var warn=document.createElement("div");warn.className="screen-note";warn.textContent="Selection texts could not be read from SAP: "+texts.error+" - technical names are shown.";box.appendChild(warn);}
  var radios={};(screen.elements||[]).forEach(function(e){if(e.kind==="parameter"&&e.radio){(radios[e.radio]=radios[e.radio]||[]).push(e);}});
  var here=function(){return parents[parents.length-1];};
  (screen.elements||[]).forEach(function(e){
    if(e.hidden)return;
    if(e.kind==="block"){var block=document.createElement(e.frame?"fieldset":"div");block.className="screen-block";
      var title=screenText(e.title,texts);if(e.frame&&title){var legend=document.createElement("legend");legend.textContent=title;block.appendChild(legend);}
      here().appendChild(block);parents.push(block);return;}
    if(e.kind==="end-block"||e.kind==="end-line"){if(parents.length>1)parents.pop();return;}
    if(e.kind==="line"){var row=document.createElement("div");row.className="screen-line";here().appendChild(row);parents.push(row);return;}
    if(e.kind==="skip"){for(var i=0;i<(e.lines||1);i++)here().appendChild(document.createElement("br"));return;}
    if(e.kind==="uline"){here().appendChild(document.createElement("hr"));return;}
    if(e.kind==="comment"){var c=document.createElement("span");c.className="screen-comment";c.textContent=screenText(e.text,texts);here().appendChild(c);return;}
    if(e.kind==="note"){var n=document.createElement("div");n.className="screen-note";n.textContent="Not drawn here: "+e.text;here().appendChild(n);return;}
    var item=document.createElement("label");item.className="screen-item";
    var caption=document.createElement("span");caption.className="screen-label";caption.textContent=label(e.name)+(e.obligatory?" *":"");
    if(e.kind==="parameter"&&e.radio){var radio=document.createElement("input");radio.type="radio";radio.name=e.radio;radio.value=e.name;
      var was=kept["radio:"+e.radio],group=radios[e.radio],chosen=group.some(function(g){return g.name===was;})?was:((group.filter(function(g){return String(g.default).toUpperCase()==="X";})[0]||group[0]).name);
      radio.checked=e.name===chosen;item.append(radio,caption);here().appendChild(item);return;}
    if(e.kind==="parameter"&&e.checkbox){var check=document.createElement("input");check.type="checkbox";check.setAttribute("data-parameter",e.name);
      var keptBox=kept["p:"+e.name];check.checked=typeof keptBox==="boolean"?keptBox:String(e.default).toUpperCase()==="X";item.append(check,caption);here().appendChild(item);return;}
    if(e.kind==="parameter"){var input=document.createElement("input");input.type="text";input.setAttribute("data-parameter",e.name);
      if(e.obligatory)input.setAttribute("data-obligatory",label(e.name));
      if(e.length)input.maxLength=e.length+(e.decimals?2:0);
      var keptValue=kept["p:"+e.name];input.value=typeof keptValue==="string"?keptValue:(e.defaultName?"":e.default||"");
      // In a line of the screen a parameter has no text of its own: the line's COMMENT names it, as in SAP.
      if(e.defaultName)input.placeholder=e.default;if(here().className==="screen-line")item.append(input);else item.append(caption,input);here().appendChild(item);return;}
    if(e.kind==="select-option"){var range=document.createElement("div");range.className="screen-range";range.setAttribute("data-range",e.name);
      if(e.obligatory)range.setAttribute("data-obligatory",label(e.name));
      var head=document.createElement("div");head.className="screen-label";head.textContent=label(e.name)+(e.obligatory?" *":"");range.appendChild(head);
      var add=document.createElement("button");add.className="range-add";add.textContent="+ row";add.hidden=!!e.noExtension;
      add.onclick=function(){rangeRow(range,e,null);};range.appendChild(add);
      var rows=kept["r:"+e.name]||(e.default?[e.default]:[]);if(!rows.length)rows=[null];
      rows.slice(0,e.noExtension?1:rows.length).forEach(function(r){rangeRow(range,e,r);});here().appendChild(range);}
  });
}
/* The obligatory fields left empty, as SAP refuses to run with them. */
function missingObligatory(){var missing=[];document.querySelectorAll('#local-selection [data-obligatory]').forEach(function(el){
  var empty=el.hasAttribute("data-range")?!readRange(el).length:!String(el.value||"").trim();if(empty)missing.push(el.getAttribute("data-obligatory"));});return missing;}

/* A method's or a function module's screen: its parameters - a field, a structure's fields, a table as a grid - and its
   named variants. The page gives debug(command, args) for the variants and failed(error) to say what went wrong. */
var entryEditors=null,entryKey="",entryBlocked="";
/* A structure's fields as a grid, folded: closed at first, its summary saying how many fields there are and how many are filled.
   onChange(summary) is told the filled fields as NAME=value, for a table row's own summary. */
function structureEditor(p,onChange){
  var shape=p.shape,box=document.createElement("table");box.className="entry-grid";var parts={};
  var fold=document.createElement("details"),summary=document.createElement("summary");fold.className="entry-fold";fold.appendChild(summary);fold.appendChild(box);
  var filled=function(){return Object.keys(parts).map(function(k){var v=parts[k].read();return v===undefined||v===""?"":k+"="+(typeof v==="object"?"…":v);}).filter(Boolean);};
  var refresh=function(){var f=filled();summary.textContent=shape.fields.length+" fields"+(f.length?" · "+f.length+" filled":"");if(onChange)onChange(f);};
  shape.fields.forEach(function(f){var tr=document.createElement("tr"),th=document.createElement("th"),td=document.createElement("td");th.textContent=f.name;
    if(f.shape.kind==="table"){td.textContent="(a table - not entered here)";}else{parts[f.name]=entryEditor({name:f.name,shape:f.shape,optional:true},refresh);td.appendChild(parts[f.name].el);}
    tr.append(th,td);box.appendChild(tr);});
  box.addEventListener("input",refresh);refresh();
  return {el:fold,fold:fold,read:function(){var o={},any=false;Object.keys(parts).forEach(function(k){var v=parts[k].read();if(v!==undefined){o[k]=v;any=true;}});return any?o:(p.optional?undefined:{});},
    write:function(v){Object.keys(parts).forEach(function(k){parts[k].write(v&&v[k]);});refresh();}};
}
function referenceEditor(p){
  var shape=p.shape,wrap=document.createElement("span"),button=document.createElement("button"),dialog=document.createElement("dialog");
  var enabled=!!shape.createDefault&&!p.optional;
  wrap.className="entry-reference";button.type="button";button.textContent="▣";
  button.title="Open class variables of "+(shape.className||shape.type);button.setAttribute("aria-label",button.title);
  dialog.className="entry-reference-dialog";
  var title=document.createElement("h3");title.textContent=shape.className||shape.type;dialog.appendChild(title);
  var note=document.createElement("p");note.textContent=shape.createDefault
    ? "Default class instance. Runtime values appear in Variables after the run."
    : "This reference has no available default class constructor.";dialog.appendChild(note);
  if(p.optional&&shape.createDefault){var choice=document.createElement("label"),check=document.createElement("input");check.type="checkbox";
    choice.append(check,document.createTextNode(" Create default instance"));dialog.appendChild(choice);
    check.onchange=function(){enabled=check.checked;};}
  if(shape.attributes&&shape.attributes.length){var table=document.createElement("table"),head=document.createElement("tr");
    ["Variable","Type","Scope","Declared default"].forEach(function(s){var cell=document.createElement("th");cell.textContent=s;head.appendChild(cell);});table.appendChild(head);
    shape.attributes.forEach(function(a){var row=document.createElement("tr");[a.name,a.type,a.static?"Class":"Instance",a.initial||"Initial"].forEach(function(s){var cell=document.createElement("td");cell.textContent=s;row.appendChild(cell);});table.appendChild(row);});dialog.appendChild(table);
  }else{var empty=document.createElement("p");empty.textContent="No class variables in the saved source.";dialog.appendChild(empty);}
  var close=document.createElement("button");close.type="button";close.textContent="Close";close.onclick=function(){dialog.close();};dialog.appendChild(close);
  button.onclick=function(){dialog.showModal();};wrap.append(button,dialog);
  return {el:wrap,read:function(){return enabled?{create:true}:undefined;},write:function(v){enabled=!!shape.createDefault&&(!p.optional||!!v?.create);if(check)check.checked=enabled;}};
}
function entryEditor(p,onChange){
  var shape=p.shape||{kind:"simple"};
  if(shape.kind==="reference")return referenceEditor(p);
  if(shape.kind==="structure")return structureEditor(p,onChange);
  // A table of structures: its rows shown as a table; the row picked is entered below it as a structure, and a row is
  // duplicated to make the next one from it.
  if(shape.kind==="table"&&shape.row.kind==="structure"){
    var cols=shape.row.fields.filter(function(f){return f.shape.kind==="simple";}).map(function(f){return f.name;});
    var grid=document.createElement("table"),head=document.createElement("tr"),rowsOf=[],chosen=null;grid.className="entry-grid entry-table";
    ["#"].concat(cols,[""]).forEach(function(c){var th=document.createElement("th");th.textContent=c;head.appendChild(th);});grid.appendChild(head);
    var form=document.createElement("div");form.className="entry-row-form";
    var draw=function(){rowsOf.forEach(function(r,i){r.cells[0].textContent=String(i+1);var v=r.value||{};
      cols.forEach(function(c,k){r.cells[k+1].textContent=v[c]==null?"":String(v[c]);});r.tr.classList.toggle("chosen",r===chosen);});};
    var choose=function(row){chosen=row;form.textContent="";
      if(row){var title=document.createElement("div");title.className="entry-row-title";title.textContent="Row "+(rowsOf.indexOf(row)+1);
        var editor=structureEditor({name:p.name,shape:shape.row,optional:true},function(){if(editor){row.value=editor.read()||{};draw();}});
        editor.write(row.value);editor.fold.open=true;form.append(title,editor.el);}
      draw();};
    var addRow=function(v,after){
      var row={value:v?JSON.parse(JSON.stringify(v)):{},tr:document.createElement("tr"),cells:[]};
      for(var k=0;k<cols.length+1;k++){var td=document.createElement("td");row.cells.push(td);row.tr.appendChild(td);}
      var tools=document.createElement("td"),copy=document.createElement("button"),drop=document.createElement("button");tools.className="entry-row-tools";
      copy.textContent="Duplicate";copy.title="A copy of this row below it, to change";drop.textContent="×";drop.title="Remove the row";
      copy.onclick=function(e){e.preventDefault();e.stopPropagation();choose(addRow(row.value,row));};
      drop.onclick=function(e){e.preventDefault();e.stopPropagation();row.tr.remove();rowsOf=rowsOf.filter(function(r){return r!==row;});choose(chosen===row?null:chosen);};
      tools.append(copy,drop);row.tr.appendChild(tools);row.tr.onclick=function(){choose(row===chosen?null:row);};row.tr.style.cursor="pointer";
      if(after){after.tr.after(row.tr);rowsOf.splice(rowsOf.indexOf(after)+1,0,row);}else{grid.appendChild(row.tr);rowsOf.push(row);}
      return row;};
    var more=document.createElement("button");more.textContent="+ row";more.onclick=function(e){e.preventDefault();choose(addRow(null,null));};
    var wrapRows=document.createElement("div");wrapRows.append(grid,more,form);
    var filledOf=function(v){var o={},any=false;Object.keys(v||{}).forEach(function(k){if(v[k]!==""&&v[k]!==undefined){o[k]=v[k];any=true;}});return any?o:undefined;};
    return {el:wrapRows,read:function(){var values=rowsOf.map(function(r){return filledOf(r.value);}).filter(function(v){return v!==undefined;});
        return values.length?values:(p.optional?undefined:[]);},
      write:function(v){rowsOf.forEach(function(r){r.tr.remove();});rowsOf=[];(Array.isArray(v)?v:[]).forEach(function(one){addRow(one,null);});choose(null);}};
  }
  if(shape.kind==="table"){
    var wrap=document.createElement("div"),grid=document.createElement("table"),rows=[];grid.className="entry-grid";
    var cols=shape.row.kind==="structure"?shape.row.fields.filter(function(f){return f.shape.kind==="simple";}).map(function(f){return f.name;}):[""];
    var head=document.createElement("tr");cols.concat([""]).forEach(function(c){var th=document.createElement("th");th.textContent=c||(c===""&&cols[0]===""?"value":"");head.appendChild(th);});grid.appendChild(head);
    var add=function(v){var tr=document.createElement("tr"),cells={};
      cols.forEach(function(c){var td=document.createElement("td"),i=document.createElement("input");i.type="text";i.size=10;i.value=v==null?"":c?(v[c]==null?"":v[c]):v;cells[c]=i;td.appendChild(i);tr.appendChild(td);});
      var td=document.createElement("td"),x=document.createElement("button");x.textContent="×";x.title="Remove the row";x.onclick=function(e){e.preventDefault();tr.remove();rows=rows.filter(function(r){return r.tr!==tr;});};
      td.appendChild(x);tr.appendChild(td);grid.appendChild(tr);rows.push({tr:tr,cells:cells});};
    var more=document.createElement("button");more.textContent="+ row";more.onclick=function(e){e.preventDefault();add(null);};
    wrap.append(grid,more);
    return {el:wrap,read:function(){var list=rows.map(function(r){if(cols[0]==="")return r.cells[""].value;var o={},any=false;cols.forEach(function(c){if(r.cells[c].value!==""){o[c]=r.cells[c].value;any=true;}});return any?o:null;})
        .filter(function(v){return v!==null&&v!=="";});return list.length?list:(p.optional?undefined:[]);},
      write:function(v){rows.forEach(function(r){r.tr.remove();});rows=[];(Array.isArray(v)?v:[]).forEach(add);}};
  }
  var input=document.createElement("input");input.type="text";input.size=24;
  if(p.default)input.placeholder="DEFAULT "+p.default;
  return {el:input,read:function(){return input.value===""?(p.optional||p.default?undefined:""):input.value;},write:function(v){input.value=v==null?"":String(v);}};
}
function fillEntry(box,entry){
  entryEditors=null;entryBlocked="";
  // It cannot be called: the screen says why, and Execute runs nothing else in its place.
  if(entry.error){entryBlocked=entry.error;var e=document.createElement("p");e.className="entry-error";e.textContent=entry.error;box.appendChild(e);return;}
  var t=entry.target;entryKey=t.kind==="function"?t.name:t.object+"=>"+t.name;
  entryEditors={parameters:{},creation:{}};
  // The variants: a named set of the values, kept in VS Code.
  var bar=document.createElement("div");bar.className="entry-variants";
  var pick=document.createElement("select"),name=document.createElement("input"),save=document.createElement("button"),drop=document.createElement("button");
  name.type="text";name.placeholder="variant name";name.size=14;save.textContent="Save";drop.textContent="Delete";
  bar.append(document.createTextNode("Variant "),pick,name,save,drop);box.appendChild(bar);
  var listed={};
  var showVariants=function(all){listed=all||{};pick.textContent="";var none=document.createElement("option");none.value="";none.textContent="(none)";pick.appendChild(none);
    Object.keys(listed).sort().forEach(function(k){var o=document.createElement("option");o.value=k;o.textContent=k;pick.appendChild(o);});};
  debug("variants",{key:entryKey}).then(function(d){showVariants(d.variants);}).catch(failed);
  pick.onchange=function(){var v=listed[pick.value];if(!v)return;name.value=pick.value;
    Object.keys(entryEditors.creation).forEach(function(k){entryEditors.creation[k].write((v.creation||{})[k]);});
    Object.keys(entryEditors.parameters).forEach(function(k){entryEditors.parameters[k].write((v.parameters||{})[k]);});};
  save.onclick=function(e){e.preventDefault();debug("saveVariant",{key:entryKey,name:name.value,values:readEntry()}).then(function(d){showVariants(d.variants);pick.value=name.value.trim();}).catch(failed);};
  drop.onclick=function(e){e.preventDefault();if(!pick.value)return;debug("deleteVariant",{key:entryKey,name:pick.value}).then(function(d){showVariants(d.variants);name.value="";}).catch(failed);};
  var group=function(title,list,into){if(!list.length)return;var field=document.createElement("fieldset"),legend=document.createElement("legend");legend.textContent=title;field.appendChild(legend);
    list.forEach(function(p){var label=document.createElement("div"),head=document.createElement("div"),editor=entryEditor(p);
      head.textContent=p.name+(p.optional?" (optional)":"")+(p.shape&&p.shape.kind!=="simple"?" · "+p.shape.kind:p.shape&&p.shape.type?" · "+p.shape.type:"");
      label.className="entry-parameter-row";
      if(!p.shape||p.shape.kind==="simple")label.append(editor.el,head);else label.append(head,editor.el);
      field.appendChild(label);into[p.name]=editor;});box.appendChild(field);};
  group("Constructor of "+(t.object||""),entry.creation||[],entryEditors.creation);
  var ins=(entry.parameters||[]).filter(function(p){return ["importing","changing","tables"].indexOf(p.direction)>=0;});
  group((t.kind==="function"?"CALL FUNCTION '"+t.name+"'":t.object+(t.static?"=>":"->")+t.name)+" · importing, changing, tables",ins,entryEditors.parameters);
  var outs=(entry.parameters||[]).filter(function(p){return p.direction==="exporting"||p.direction==="returning";});
  var note=document.createElement("p");note.className="entry-note";
  note.textContent=(outs.length?"Results ("+outs.map(function(p){return p.name;}).join(", ")+") are written to Output and stand in Variables at the last stop. ":"")
    +"An optional parameter left empty is not passed; its DEFAULT applies.";
  box.appendChild(note);
}
function readEntry(){
  var out={parameters:{},creation:{}};if(!entryEditors)return out;
  ["parameters","creation"].forEach(function(part){Object.keys(entryEditors[part]).forEach(function(k){var v=entryEditors[part][k].read();if(v!==undefined)out[part][k]=v;});});
  return out;
}

/* The results of a method's or a function module's call, in the form local-entry.js writes them (VERTEX:S, VERTEX:T,
   VERTEX:R lines, parted by tabs), taken out of the list the program wrote: what is left, and the results - each
   parameter a value, a structure (its fields by their paths) or a table (its columns and rows). */
function splitResults(output){var text=[],results=[],byName={};
  String(output||"").split("\n").forEach(function(line){var at=line.indexOf("VERTEX:");
    if(at<0){text.push(line);return;}if(at>0)text.push(line.slice(0,at));
    var parts=line.slice(at+7).replace(/\r$/,"").split("\t"),kind=parts[0],path=parts[1]||"",top=path.split("-")[0];
    if(kind==="S"){var entry=byName[top];if(!entry){entry=byName[top]={name:top,kind:path===top?"value":"structure",value:"",fields:[]};results.push(entry);}
      if(path===top)entry.value=parts.slice(2).join("\t");else entry.fields.push({path:path.split("-").slice(1),value:parts.slice(2).join("\t")});}
    else if(kind==="T"){var table={name:path,kind:"table",count:Number(parts[2]||0),columns:parts.slice(3),rows:[]};byName[path]=table;results.push(table);}
    else if(kind==="R"&&byName[path])byName[path].rows.push(parts.slice(2));});
  while(text.length&&text[text.length-1]==="")text.pop();
  return {text:text.join("\n"),results:results};}
/* The results as plain text, for a list that cannot draw them: a value, a structure as an indented tree, a table as
   columns. */
function resultsText(results){var out=[];
  results.forEach(function(r){
    if(r.kind==="value")out.push(r.name+" = "+r.value);
    else if(r.kind==="structure"){out.push(r.name);var shown={};r.fields.forEach(function(f){
      f.path.forEach(function(part,i){var key=f.path.slice(0,i+1).join("-");if(i<f.path.length-1&&!shown[key]){shown[key]=true;out.push("  ".repeat(i+1)+part);}});
      out.push("  ".repeat(f.path.length)+f.path[f.path.length-1]+" = "+f.value);});}
    else{out.push(r.name+" ("+r.count+" rows)");var widths=r.columns.map(function(c,i){return Math.max(c.length,r.rows.reduce(function(w,row){return Math.max(w,String(row[i]||"").length);},0));});
      if(r.columns.length){out.push("  "+r.columns.map(function(c,i){return c.padEnd(widths[i]);}).join("  "));
        r.rows.forEach(function(row){out.push("  "+r.columns.map(function(c,i){return String(row[i]||"").padEnd(widths[i]);}).join("  "));});}}});
  return out.join("\n");}
/* The results drawn: a value as a line, a structure as a tree and a table as a grid, both opening and closing. */
function drawResults(box,results){box.textContent="";
  results.forEach(function(r){var head=document.createElement("div");head.className="result-name";
    if(r.kind==="value"){var name=document.createElement("span");name.textContent=r.name;var value=document.createElement("span");value.className="result-value";value.textContent=r.value;
      head.append(name,document.createTextNode(" = "),value);box.appendChild(head);return;}
    if(r.kind==="structure"){var tree=document.createElement("details");tree.open=true;tree.className="result-tree";var summary=document.createElement("summary");summary.textContent=r.name;tree.appendChild(summary);
      var nodes={"":tree};r.fields.forEach(function(f){var parentKey="";
        f.path.slice(0,-1).forEach(function(part){var key=parentKey?parentKey+"-"+part:part;
          if(!nodes[key]){var d=document.createElement("details");d.open=true;var s=document.createElement("summary");s.textContent=part;d.appendChild(s);nodes[parentKey].appendChild(d);nodes[key]=d;}
          parentKey=key;});
        var leaf=document.createElement("div");leaf.className="result-field";var n=document.createElement("span");n.textContent=f.path[f.path.length-1];
        var v=document.createElement("span");v.className="result-value";v.textContent=f.value;leaf.append(n,document.createTextNode(" = "),v);nodes[parentKey].appendChild(leaf);});
      box.appendChild(tree);return;}
    // A table opens and closes as a structure does; its heading names its rows.
    var fold=document.createElement("details");fold.open=true;fold.className="result-tree";var title=document.createElement("summary");
    title.textContent=r.name+" \u00b7 "+r.count+(r.count===1?" row":" rows");fold.appendChild(title);box.appendChild(fold);
    if(!r.columns.length)return;var grid=document.createElement("table");grid.className="result-grid";
    var tr=document.createElement("tr");r.columns.forEach(function(c){var th=document.createElement("th");th.textContent=c;tr.appendChild(th);});grid.appendChild(tr);
    r.rows.forEach(function(row){var line=document.createElement("tr");r.columns.forEach(function(c,i){var td=document.createElement("td");td.textContent=row[i]==null?"":row[i];line.appendChild(td);});grid.appendChild(line);});
    fold.appendChild(grid);});}
