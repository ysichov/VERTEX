/* The shared VS Code page speaks its existing contract; Eclipse owns SAP and the debugger. */
(function () {
  // A script error in the embedded browser is otherwise invisible: show it on the page.
  const shown = [];
  const report = text => {
    shown.push(text);
    const show = () => { const n = document.getElementById('notice'); if (n) { n.textContent = shown.join('\n'); n.classList.add('on'); } };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', show) : show();
  };
  window.addEventListener('error', e => report('Script error: ' + e.message + (e.lineno ? ' (line ' + e.lineno + ':' + e.colno + ')' : '')));
  window.addEventListener('unhandledrejection', e => report('Unhandled: ' + (e.reason && e.reason.message || e.reason)));
  const pending = new Map(); let serial = 0, result;
  const native = (command, args) => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, {resolve, reject});
    try { sdeNativeDebug(command, JSON.stringify(args || {}), id); }
    catch (error) { pending.delete(id); reject(error); }
  });
  window.vertexNativeReply = (id, value, error) => {
    const item = pending.get(id); if (!item) return; pending.delete(id);
    error ? item.reject(new Error(value)) : item.resolve(value);
  };
  const answer = promise => Promise.resolve(promise).then(value => {
    result = typeof value === 'string' ? value : JSON.stringify(value); sdeReady();
  }, error => { result = 'ERROR:' + error.message; sdeReady(); });
  window.sdeTake = () => { const value = result; result = null; return value; };
  window.sdeAsset = name => answer(native('asset', {name}));
  window.sdeSource = (name, type) => answer(vertexEclipseSource({object_name:name, object_type:type}));
  function sourceObject(url) {
    let m;
    if ((m = /\/oo\/(classes|interfaces)\/([^/]+)/i.exec(url))) return {name:decodeURIComponent(m[2]).toUpperCase(), type:m[1] === 'classes' ? 'CLAS' : 'INTF'};
    if ((m = /\/programs\/(programs|includes)\/([^/]+)/i.exec(url))) return {name:decodeURIComponent(m[2]).toUpperCase(), type:m[1] === 'programs' ? 'PROG' : 'INCL'};
    if ((m = /\/fmodules\/([^/]+)/i.exec(url))) return {name:decodeURIComponent(m[1]).toUpperCase(), type:'FUNC'};
    throw new Error('Cannot open this ADT source: ' + url);
  }
  window.sdeReveal = value => {
    try { const at = sourceObject(value.url || ''); sdeOpenToolSource(JSON.stringify({...at, line:value.line})); }
    catch (error) { notice(error.message); }
  };
  window.sdeCodeCursor = value => {
    sdeCursor(JSON.stringify({object_name:value.name, object_type:value.type, line:value.line}));
    const logic = document.getElementById('logic-tools-frame');
    if (logic && logic.contentWindow.sdeCodeCursor) logic.contentWindow.sdeCodeCursor(value);
  };
  function sessions(picture) {
    let select = document.getElementById('adt-debug-thread');
    if (!select) {
      select = document.createElement('select'); select.id = 'adt-debug-thread'; select.setAttribute('aria-label', 'ADT debug thread');
      document.querySelector('header').appendChild(select);
      select.onchange = () => native('session', {id:select.value}).then(vertexNativeEvent).catch(error => notice(error.message));
    }
    select.hidden = (picture.sessions || []).length < 2;
    select.replaceChildren(new Option('Select ADT debug thread', ''));
    (picture.sessions || []).forEach(s => select.add(new Option(s.name, s.id)));
    select.value = picture.selectedSession || '';
  }
  let loggedStop = '', knownDumps = null, lastPicture = null;
  const dumps = new Map();
  function withDumps(picture) {
    if (dumps.size) picture.ending = {program:'',note:'',dumped:Array.from(dumps.values()).map(d => ({...d,page:undefined,hasPage:!!d.page}))};
    return picture;
  }
  window.vertexNativeEvent = raw => {
    const picture = JSON.parse(raw); sessions(picture); sdeDebugEvent(raw);
    lastPicture = picture;
    const f = picture.stopped && picture.stopped.frames.find(f => f.current);
    if (f && !(typeof series !== 'undefined' && series)) sdeReveal(f);
    const point = picture.stopped && picture.breakpoints.find(b => b.id === picture.stopped.breakpoint && b.mode === 'log');
    if (point && !series && loggedStop !== picture.stopped.at) {
      loggedStop = picture.stopped.at;
      recordStop(picture);
      snapshot().then(() => chosenValue ? readChosenValue() : null)
        .then(() => debug('step',{kind:'continue'})).catch(failed);
    }
  };
  const request = (name, type, query) => vertexEclipseRequest('/sap/bc/adt/vertex/flow/' + encodeURIComponent(name) + '?type=' + encodeURIComponent(type) + '&' + query);
  async function logicTools(args) {
    const template = await native('asset', {name:'tools'});
    const bridge = `<script>
      window.vertexDebugHost=true;
      window.sdeAnalysisRead=(path,id)=>parent.vertexEclipseRead(path).then(value=>vertexAdtReply(id,value,false),error=>vertexAdtReply(id,error.message,true));
      window.sdeOpenToolSource=value=>parent.sdeOpenToolSource(value);
      window.sdeOpenEditor=(name,type)=>parent.sdeOpenEditor(name,type);
      window.sdeAsset=name=>parent.vertexDebugAsset(name).then(value=>{window.__result=value;sdeReady();});
      window.sdeTake=()=>{const value=window.__result;window.__result=null;return value;};
      window.sdeFrontendAnalysis=()=>true;
      window.sdeAbout=()=>{window.__result=JSON.stringify({services:[]});sdeReady();};
      window.sdeTitle=()=>{};
      window.sdeVertexContext=()=>{};
      window.sdeBrowse=url=>parent.sdeBrowse(url);
    <\/script>`;
    sdeLogicHtml(template.replace('/*INIT*/'+'null/*INIT*/', JSON.stringify({...args,action:'scheme',boundObject:true}).replace(/</g,'\\u003c')).replace('<script>',bridge+'<script>'));
    return {};
  }
  window.vertexDebugAsset = name => native('asset', {name});
  async function dumpFeed() {
    const [raw,user] = await Promise.all([vertexEclipseRead('/sap/bc/adt/runtime/dumps'),vertexEclipseRead('user:')]);
    const doc = new DOMParser().parseFromString(raw,'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('SAP returned an invalid dump feed.');
    return Array.from(doc.getElementsByTagNameNS('*','entry')).filter(e => {
      const author=e.getElementsByTagNameNS('*','author')[0]?.textContent.trim();return !author || author.toUpperCase()===user.toUpperCase();
    }).map(e => {
      const text=name=>e.getElementsByTagNameNS('*',name)[0]?.textContent || '';
      const page=text('summary'), plain=new DOMParser().parseFromString(page,'text/html').body.textContent;
      return {id:text('id'),error:Array.from(e.getElementsByTagNameNS('*','category')).map(c=>c.getAttribute('term')).join(' '),text:plain.slice(0,300),page,whyNoPlace:'The feed does not supply a verified source coordinate.'};
    });
  }
  async function command(name, args) {
    if (name === 'copy') { const error = sdeCopyText(args.text || ''); if (error) throw new Error(error); return {}; }
    if (name === 'source') return {url:args.url, source:await vertexEclipseRead(String(args.url).split('#')[0] + '?version=active')};
    if (name === 'setAt') {
      const source = await vertexEclipseSource({object_name:args.name, object_type:args.object_type});
      return JSON.parse(await native('set', {url:source.source_url,line:args.line}));
    }
    if (name === 'statements') return request(args.program, 'PROG', 'mode=statements');
    if (name === 'methods') {
      const meta = await vertexEclipseRead(String(args.url).replace(/\/source\/main.*$/, '/objectstructure')+'?version=active&withShortDescriptions=true');
      const xml = new DOMParser().parseFromString(meta, 'application/xml'), methods = {};
      for (const node of xml.getElementsByTagName('*')) {
        const attr = key => Array.from(node.attributes).find(a => a.localName === key)?.value;
        if (!/^(CLAS\/OM|INTF\/IO)/.test(attr('type') || '')) continue;
        const links=Array.from(node.children).filter(n=>n.localName==='link');
        const link=links.find(l=>/implementation/i.test(l.getAttribute('rel') || '') && /#start=\d+/.test(l.getAttribute('href') || ''))
          || links.find(l=>/\/source\/main#start=\d+/.test(l.getAttribute('href') || ''));
        const line=link && /#start=(\d+)/.exec(link.getAttribute('href'));
        if (line && attr('name')) methods[attr('name').toUpperCase()] = Number(line[1]);
      }
      return {url:args.url, methods};
    }
    if (name === 'logicTools') return logicTools(args);
    if (name === 'run') {
      try { knownDumps=new Set((await dumpFeed()).map(d=>d.id)); dumps.clear(); }
      catch (error) { knownDumps=null; notice('Cannot establish a dump baseline: '+error.message); }
    }
    if (name === 'checkdumps') {
      const feed=await dumpFeed();
      if (!knownDumps) { knownDumps=new Set(feed.map(d=>d.id)); throw new Error('Dump baseline established now. Check again after the next run.'); }
      const found=feed.filter(d=>!knownDumps.has(d.id));for(const d of found){knownDumps.add(d.id);dumps.set(d.id,d);}
      if(lastPicture)sdeDebugEvent(JSON.stringify(withDumps(lastPicture)));
      return {found};
    }
    if (name === 'dumppage') { const dump=dumps.get(args.id) || Array.from(dumps.values()).at(-1); return {id:dump?.id||'',page:dump?.page||''}; }
    const value = JSON.parse(await native(name, args));
    if (name === 'picture') { sessions(value);lastPicture=value;withDumps(value); }
    return value;
  }
  window.sdeDebug = (name, args) => answer(command(name, args || {}));
  window.sdeOrigin = async request => {
    try { const value = await vertexEclipseDebugAnalysis(request, progress => sdeOriginProgress({id:request.id,...progress})); if(value.reveal)sdeReveal(value.reveal);sdeOriginReady(JSON.stringify({id:request.id,answer:value})); }
    catch (error) { sdeOriginReady(JSON.stringify({id:request.id,error:error.message})); }
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#visual,#rec,#zonly,#fclasses,#fmethods,#initials,#globals,#locals,#params,[data-pane]').forEach(button => button.classList.add('vertex-toggle'));
    // A persisted view opened without an object still shows the existing session.
    if (!INITIAL || !INITIAL.name) refresh().catch(failed);
  });
})();
