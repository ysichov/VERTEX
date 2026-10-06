"use strict";
// Match the production view adapter: analysis plus its source-backed flow.
const model=require('../value-origin');
const {pathRows,siteRows}=require('../value-origin-points');
function analyze(sources,target){
 const named=sources.map(s=>({...s,name:s.name||s.id,objectName:s.objectName||String(s.id).split('.')[0].toUpperCase(),objectType:s.objectType||(/\.prog\./i.test(s.id)||s.id==='demo'?'PROG':'CLAS')}));
 const graph=model.analyze(named,target);
 graph.codeFlow={rows:pathRows(graph,named),sites:siteRows(graph,named)};
 return graph;
}
module.exports={analyze};
