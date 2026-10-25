"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const page=fs.readFileSync(path.join(__dirname,"../../org.vertex.abap.ui/resources/metrics.html"),"utf8");
const source=page.slice(page.indexOf("function visiblePackageMetricRows("),page.indexOf("function setMetricMapZoom("))+
 page.slice(page.indexOf("function metricMapRisk("),page.indexOf("function updateMetricView("));

test("Metrics map shows names and values and opens the selected method",()=>{
 const element=tag=>({tag,children:[],style:{},dataset:{},clientWidth:560,textContent:"",
  append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},prepend(child){this.children.unshift(child);},
  replaceChildren(...children){this.children=children;},addEventListener(event,handler){this[event]=handler;}});
 const root=element("root"),legend=element("legend"),opened=[];
 const context=vm.createContext({document:{getElementById:id=>id==="root"?root:legend,createElement:element},
  window:{},units:[{unit_name:"ZCL_AVE_POPUP=>ADD_CR_DIAG",cyclomatic:4,loc:7},{unit_name:"ZCL_AVE_POPUP=>ADD_CR_TIMING",cyclomatic:2,loc:34}],
  metricMapKey:"cyclomatic",packageMetrics:null,threeRenderer:null,chosenKey:"",partKeyOf:name=>name.split("=>").pop(),
  metricMapZoom:1,
  cellValue:unit=>unit.unit_name.split("=>").pop(),classMetrics:()=>true,rounded:value=>value,
  publishContext:()=>{},markMetricRow:()=>{},openMetricSource:unit=>opened.push(unit.unit_name),
  sdePartShown:()=>{}});
 vm.runInContext(source,context);
 vm.runInContext(page.slice(page.indexOf("function setMetricMapZoom("),page.indexOf("function requestThree(")),context);
 assert.equal(context.metricMapRisk("cyclomatic",4,[4,20,38]),0);
 assert.equal(context.metricMapRisk("cyclomatic",20,[4,20,38]),1);
 assert.equal(context.metricMapRisk("cyclomatic",38,[4,20,38]),2);
 assert.equal(context.metricMapRisk("mi",114.34,[114.34,65.65,15.62]),0);
 assert.equal(context.metricMapRisk("mi",15.62,[114.34,65.65,15.62]),3);
 context.renderMetricMap();
 const tiles=root.children.filter(child=>child.tag==="button");
 assert.equal(tiles.length,2);
 assert.deepEqual(tiles.map(tile=>tile.children.map(child=>child.textContent)),[["ADD_CR_DIAG","4"],["ADD_CR_TIMING","2"]]);
 assert.ok(Math.abs(Number(tiles[0].dataset.area)/Number(tiles[1].dataset.area)-2)<.001,"CC 4 must occupy twice the area of CC 2");
 tiles[1].click();
 assert.deepEqual(opened,[],"single click selects without opening source");
 assert.equal(context.chosenKey,"ADD_CR_TIMING");
 tiles[1].dblclick();
 assert.deepEqual(opened,["ZCL_AVE_POPUP=>ADD_CR_TIMING"]);
 context.setMetricMapZoom(2);
 assert.equal(root.style.zoom,"2","Zoom must scale the existing map without changing tile areas");
 assert.equal(root.style.fontSize,"6px","Text must keep its 12 px screen size at 200% map scale");
 context.metricMapKey="loc";context.renderMetricMap();
 const locTiles=root.children.filter(child=>child.tag==="button");
 assert.ok(Number(locTiles[1].dataset.area)>Number(locTiles[0].dataset.area),"Selecting LOC must resize the tiles");
});

test("Visual zoom reveals tile details without enlarging text",()=>{
 const flags={},properties={},tile={dataset:{baseWidth:"50",baseHeight:"30"},classList:{toggle(name,on){flags[name]=on;}}};
 const root={style:{setProperty(name,value){properties[name]=value;}},querySelectorAll:()=>[tile]};
 const context=vm.createContext({metricMapZoom:1});vm.runInContext(source,context);
 context.applyMetricMapScale(root);
 assert.equal(flags.compact,true);assert.equal(flags.micro,false);
 context.metricMapZoom=3;context.applyMetricMapScale(root);
 assert.equal(flags.compact,false,"method name appears when its tile grows");
 assert.equal(3*parseFloat(root.style.fontSize),12);
 assert.equal(3*parseFloat(properties["--map-frame-width"]),2);
 assert.equal(3*parseFloat(properties["--map-line-width"]),1,"ordinary borders stay thin while zooming");
 context.metricMapZoom=.4;context.applyMetricMapScale(root);
 assert.equal(flags.micro,true,"tiny tiles show colour without unreadable text");
 assert.equal(.4*parseFloat(root.style.fontSize),12);
});

test("package Visual nests methods and forms within area-scaled objects",()=>{
 const element=tag=>({tag,children:[],style:{},dataset:{},clientWidth:560,textContent:"",
  append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},prepend(child){this.children.unshift(child);},
  replaceChildren(...children){this.children=children;},addEventListener(event,handler){this[event]=handler;}});
 const root=element("root"),legend=element("legend"),block={dataset:{object:"ZREP"},open:false,scrollIntoView(){}},shownTotals=[];
 const context=vm.createContext({document:{getElementById:id=>id==="root"?root:legend,createElement:element,querySelectorAll:()=>[block]},
  window:{},units:[],packageMetrics:{object:"ZPACK",objects:[
   {object:"ZCL_A",object_type:"CLAS",unit_rows:[{unit_name:"ZCL_A=>RUN",cyclomatic:2,loc:7}],units:1,cyclomatic:2,avg_cyclomatic:2,loc:7},
   {object:"ZREP",object_type:"PROG",unit_rows:[{unit_name:"FORM BUILD",cyclomatic:2,loc:10},{unit_name:"FORM OUTPUT",cyclomatic:6,loc:30}],units:2,cyclomatic:8,avg_cyclomatic:4,loc:40},
   {object:"ZDEMO",object_type:"PROG",unit_rows:[{unit_name:"START-OF-SELECTION",cyclomatic:1,loc:64}],units:1,cyclomatic:1,avg_cyclomatic:1,loc:64}]},
  metricMapKey:"loc",metricMapZoom:1,threeRenderer:null,chosenKey:"",rounded:value=>value,
  metricMapTypes:{CLAS:true,PROG:true,INTF:true},metricMapExcluded:new Set(),totals:{loc:111,cyclomatic:11},renderTotals:value=>shownTotals.push(value),
  unitTotal:rows=>({cyclomatic:rows.reduce((n,r)=>n+r.cyclomatic,0),loc:rows.reduce((n,r)=>n+r.loc,0)}),
  partKeyOf:name=>name,cellValue:row=>row.unit_name,loadedType:"CLAS",publishContext:()=>{},updateMetricView:()=>{},openMetricSource:(row,ctx)=>opened.push([row.unit_name,ctx.type])});
 const opened=[];
 vm.runInContext(source,context);
 context.renderMetricMap();
 const objects=root.children.filter(child=>child.className==="metric-map-object");
 const packageHead=root.children.find(child=>child.className==="metric-map-package-head");
 assert.deepEqual(packageHead.children.map(child=>child.textContent),["ZPACK · LOC","111"]);
 assert.deepEqual(objects.map(object=>object.dataset.type),["CLAS","PROG","PROG"]);
 assert.deepEqual(objects.map(object=>object.children[0].children[0].textContent),["ZCL_A","ZREP","ZDEMO"]);
 assert.ok(Number(objects[1].dataset.area)>Number(objects[0].dataset.area));
 const forms=objects[1].children.slice(1);
 assert.deepEqual(forms.map(tile=>tile.children[0].textContent),["FORM BUILD","FORM OUTPUT"]);
 assert.ok(Number(forms[1].dataset.area)>Number(forms[0].dataset.area));
 assert.equal(objects[2].children[1].dataset.risk,"3","a lone LOC 64 unit must rank against the whole package");
 assert.equal(objects[0].children[1].dataset.risk,"0","LOC 7 must keep the same rank in every object");
 forms[1].click();assert.deepEqual(opened,[]);
 forms[1].dblclick();assert.deepEqual(opened,[["FORM OUTPUT","PROG"]]);
 objects[1].children[0].click();
 assert.equal(context.metricView,"table");
 assert.equal(block.open,true);
 context.metricMapTypes.PROG=false;context.renderMetricMap();
 assert.deepEqual(root.children.filter(child=>child.className==="metric-map-object").map(object=>object.dataset.key),["ZCL_A"],"type filter hides all programs");
 assert.deepEqual(root.children.find(child=>child.className==="metric-map-package-head").children.map(child=>child.textContent),["Visible · ZPACK · LOC","7"]);
 assert.equal(shownTotals.at(-1).loc,7,"package summary follows visible objects");
 context.metricMapTypes.PROG=true;context.metricMapExcluded.add("ZREP");context.renderMetricMap();
 assert.deepEqual(root.children.filter(child=>child.className==="metric-map-object").map(object=>object.dataset.key),["ZCL_A","ZDEMO"],"object filter hides one object");
 assert.equal(shownTotals.at(-1).loc,71,"package summary follows object exclusion");
 context.metricMapExcluded.add("ZCL_A");context.metricMapExcluded.add("ZDEMO");context.renderMetricMap();
 assert.equal(root.textContent,"No objects selected.");
 assert.equal(shownTotals.at(-1).loc,0,"empty filter clears the summary");
});

test("package Visual object list excludes one object and can search names",()=>{
 const element=tag=>({tag,children:[],dataset:{},textContent:"",checked:false,
  append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);},replaceChildren(...children){this.children=children;},
  setAttribute(){},addEventListener(event,handler){this[event]=handler;}});
 const summary=element("summary"),search=element("input"),list=element("div"),types=["CLAS","PROG","INTF"].map(type=>({...element("input"),dataset:{metricType:type}}));search.value="";
 const context=vm.createContext({packageMetrics:{objects:[{object:"ZCL_A",object_type:"CLAS",unit_rows:[]},{object:"ZREP",object_type:"PROG",unit_rows:[]}]},
  metricMapTypes:{CLAS:true,PROG:true,INTF:true},metricMapExcluded:new Set(),metricView:"table",unitTotal:()=>({}),
  document:{getElementById:id=>({"metric-map-filter-summary":summary,"metric-map-filter-search":search,"metric-map-filter-objects":list})[id],querySelectorAll:()=>types,createElement:element}});
 vm.runInContext(source,context);
 context.updateMetricMapFilter();
 assert.equal(summary.textContent,"Objects 2/2");
 assert.equal(list.children.length,2);
 list.children[1].children[0].checked=false;list.children[1].children[0].change();
 assert.equal(summary.textContent,"Objects 1/2");
 assert.ok(context.metricMapExcluded.has("ZREP"));
 search.value="ZREP";context.updateMetricMapFilter();
 assert.equal(list.children.length,1);
 assert.equal(list.children[0].children[1].textContent,"ZREP · PROG");
});

test("package indicator selector and totals omit derived counts and averages",()=>{
 const element=tag=>({tag,children:[],textContent:"",appendChild(child){this.children.push(child);},replaceChildren(...children){this.children=children;}});
 const totals=element("div"),select=element("select");
 const context=vm.createContext({packageMetrics:{objects:[]},metricMapKey:"avg_cyclomatic",mode:"metrics",COLUMNS:[],rounded:value=>value,
  document:{getElementById:id=>id==="totals"?totals:select,createElement:element,createTextNode:text=>({textContent:text})}});
 vm.runInContext(page.slice(page.indexOf("var OBJECT_COLUMNS ="),page.indexOf("var units =")),context);
 vm.runInContext(page.slice(page.indexOf("function renderTotals("),page.indexOf("function sorted(")),context);
 vm.runInContext(page.slice(page.indexOf("function refreshMetricMapChoices("),page.indexOf("function updateMetricView(")),context);
 context.refreshMetricMapChoices();
 context.renderTotals({units:5,cyclomatic:8,avg_cyclomatic:1.6,loc:30,lloc:20,cloc:0,volume:10,effort:10,time_t:1,bugs:0});
 assert.equal(context.metricMapKey,"cyclomatic");
 assert.ok(!select.children.some(option=>["units","avg_cyclomatic"].includes(option.value)));
 assert.ok(!totals.children.some(item=>/units|avg CC/.test(item.children[0].textContent)));
});

test("Visual Fit scales the whole map to the pane without changing its layout",()=>{
 const root={className:"metric-map",style:{width:"600px",height:"1200px"}},list={clientWidth:600,clientHeight:600,scrollTop:80,scrollLeft:20};
 const input={value:"100"},output={textContent:"100%"};
 const frames=[];
 const context=vm.createContext({metricMapZoom:1,metricMapZoomFrame:0,performance:{now:()=>0},
  requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},cancelAnimationFrame:()=>{},
  document:{getElementById:id=>({root,list,"metric-map-zoom-input":input,"metric-map-zoom-value":output})[id]}});
 vm.runInContext(source,context);
 vm.runInContext(page.slice(page.indexOf("function setMetricMapZoom("),page.indexOf("function requestThree(")),context);
 context.fitMetricMap();
 frames.shift()(110);
 assert.ok(context.metricMapZoom<1&&context.metricMapZoom>584/1200,"Fit animates through an intermediate scale");
 frames.shift()(220);
 assert.ok(Math.abs(context.metricMapZoom-584/1200)<.001);
 assert.equal(root.style.width,"600px");assert.equal(root.style.height,"1200px");
 assert.equal(list.scrollTop,0);assert.equal(list.scrollLeft,0);
 assert.equal(output.textContent,"49%");
});

test("Visual and UML use the same Ctrl-wheel zoom direction",()=>{
 const context=vm.createContext({});
 vm.runInContext(page.slice(page.indexOf("function zoomFactorForWheel("),page.indexOf("function visiblePackageMetricRows(")),context);
 assert.ok(context.zoomFactorForWheel(-1)>1);
 assert.ok(context.zoomFactorForWheel(1)<1);
 assert.match(page,/setZoom\(zoom\*zoomFactorForWheel\(e\.deltaY\)\)/);
 assert.match(page,/setMetricMapZoom\(metricMapZoom\*zoomFactorForWheel\(event\.deltaY\)\)/);
});
