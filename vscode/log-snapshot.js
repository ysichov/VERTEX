"use strict";

const path = require("path");
const { randomBytes } = require("crypto");

function umlSource(data) {
  const names = new Map(), lines = ["classDiagram", "direction LR"];
  const label = value => String(value || "").replace(/[^A-Za-z0-9_/$~.-]/g, "_");
  const node = name => {
    if (!names.has(name)) {
      const id = "n" + names.size;
      names.set(name, id);
      lines.push('class ' + id + '["' + label(name) + '"]');
    }
    return names.get(name);
  };
  for (const item of data.nodes || []) {
    const id = node(item.name);
    if (item.kind === "interface") lines.push("<<interface>> " + id);
    for (const method of item.methods || []) lines.push(id + " : " + label(typeof method === "string" ? method : method.name).replace(/~/g, "_") + "()");
  }
  for (const edge of data.edges || []) {
    const arrow = { inheritance: "--|>", implementation: "..|>", dependency: "..>" }[edge.kind];
    if (arrow) lines.push(node(edge.source) + " " + arrow + " " + node(edge.target));
  }
  return lines.join("\n");
}

function open(vscode, snapshot) {
  if (!snapshot || !["uml", "metrics"].includes(snapshot.kind) || !snapshot.data || typeof snapshot.data !== "object") throw new Error("This log has no valid diagram or metrics snapshot.");
  const root = vscode.Uri.file(path.join(__dirname, "resources"));
  const panel = vscode.window.createWebviewPanel("vertex.logSnapshot", "VERTEX: Recorded " + (snapshot.kind === "uml" ? "UML" : "Metrics"),
    vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [root] });
  const asset = panel.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, "resources", "mermaid.min.js")));
  panel.webview.html = html(snapshot, asset.toString(), panel.webview.cspSource);
  return panel;
}

function html(snapshot, asset, cspSource) {
  const nonce = randomBytes(18).toString("hex");
  const json = JSON.stringify({ ...snapshot, diagram: snapshot.kind === "uml" ? umlSource(snapshot.data) : "" }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
<style>
body{margin:16px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}
h1{font-size:1.2em}.note{color:var(--vscode-descriptionForeground)}
#view{overflow:auto;margin-top:12px}svg{max-width:none!important}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:5px 8px;border:1px solid var(--vscode-panel-border)}
th{background:var(--vscode-editorWidget-background);font-weight:600}tfoot{font-weight:600}
#error{color:var(--vscode-errorForeground);white-space:pre-wrap}
</style></head><body><h1 id="title"></h1><div class="note">Snapshot of the context supplied to the assistant.</div><div id="error"></div><div id="view"></div>
${snapshot.kind === "uml" ? '<script nonce="' + nonce + '" src="' + asset + '"></script>' : ''}
<script nonce="${nonce}">
(function(){
  var snapshot=${json},view=document.getElementById("view"),sequence=0;
  document.getElementById("title").textContent="Recorded "+(snapshot.kind==="uml"?"UML":"metrics")+(snapshot.name?" — "+snapshot.name:"");
  function element(tag,text){var node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
  function render(){
    if(snapshot.kind==="metrics"){
      view.textContent="";var data=snapshot.data,columns=data.columns||[],table=element("table"),head=element("thead"),row=element("tr");
      columns.forEach(function(key){row.appendChild(element("th",key));});head.appendChild(row);table.appendChild(head);
      var body=element("tbody");(data.units||[]).forEach(function(unit){var line=element("tr");columns.forEach(function(key){var value=unit[key];line.appendChild(element("td",value==null?"":typeof value==="object"?JSON.stringify(value):String(value)));});body.appendChild(line);});table.appendChild(body);
      if(data.totals){var foot=element("tfoot"),total=element("tr");columns.forEach(function(key,i){total.appendChild(element("td",data.totals[key]===undefined?(i?"":"Total"):String(data.totals[key])));});foot.appendChild(total);table.appendChild(foot);}
      view.appendChild(table);if(data.truncated)view.appendChild(element("p","The recorded context contains only the rows originally supplied to the assistant."));return;
    }
    var style=getComputedStyle(document.body),value=function(name,fallback){return style.getPropertyValue(name).trim()||fallback;};
    var ink=style.color,ground=style.backgroundColor,surface=value("--vscode-editorWidget-background",ground),border=value("--vscode-panel-border",ink);
    mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"base",maxEdges:100000,maxTextSize:90000000,themeVariables:{background:ground,primaryColor:surface,primaryTextColor:ink,primaryBorderColor:border,secondaryColor:ground,tertiaryColor:surface,lineColor:ink,textColor:ink,classText:ink,edgeLabelBackground:ground,noteBkgColor:surface,noteTextColor:ink,noteBorderColor:border,fontFamily:style.fontFamily}});
    var generation=++sequence;mermaid.render("recordedUml"+generation,snapshot.diagram).then(function(result){
      if(generation!==sequence)return;view.innerHTML=result.svg;
      var svg=view.querySelector("svg"),box=svg&&svg.viewBox.baseVal;
      if(box){svg.style.width=box.width+"px";svg.style.height=box.height+"px";}
    }).catch(function(error){document.getElementById("error").textContent=error.message;});
  }
  if(snapshot.kind==="uml")new MutationObserver(render).observe(document.body,{attributes:true,attributeFilter:["class","style"]});
  render();
})();
</script></body></html>`;
}

module.exports = { open, html, umlSource };
