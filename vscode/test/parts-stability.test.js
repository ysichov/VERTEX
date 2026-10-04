const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.VERTEX_PAGES || path.join(__dirname, '../../org.vertex.abap.ui/resources');
function functions(page, names, context) {
  const text = fs.readFileSync(path.join(root, page + '.html'), 'utf8');
  for (const name of names) {
    const start = text.indexOf('function ' + name + '(');
    const end = text.indexOf('\n}', start) + 2;
    vm.runInContext(text.slice(start, end), context);
  }
}
test('Diff and Versions selection updates existing rows without rebuilding Parts', () => {
  const parts = [{name:'A',part_type:'METH',unit:'A'}, {name:'B',part_type:'METH',unit:'B'}];
  const rows = parts.map(part => ({part, element:{selected:false, classList:{toggle(key, value){rows.find(r=>r.part===part).element.selected=value;}}}}));
  let requests = 0;
  const ctx = vm.createContext({INITIAL:{action:'diff'}, partRows:rows, current:null, versions:[],
    renderParts(){throw Error('Parts must not be rebuilt on selection');}, status(){}, note(){}, showDiffPrev(){}, versionNote(){}, flags(){return '';},
    objectName:()=> 'ZCL_TEST', objectType:()=> 'CLAS', sdeLoad(){requests++;}});
  functions('versions', ['isCurrent','updatePartSelection','loadVersions'],ctx);
  ctx.loadVersions(parts[0]);
  assert.equal(rows[0].element.selected,true);
  ctx.loadVersions(parts[1],true);
  assert.equal(rows[0].element.selected,false);
  assert.equal(rows[1].element.selected,true);
  assert.equal(ctx.partRows,rows);
  assert.equal(ctx.autoDiff,false);
  assert.equal(requests,2);
});
