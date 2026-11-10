(function(){
'use strict';

/* ---------- nastavenie ---------- */
const CFG = window.HO_CONFIG || {};
const API = String(CFG.apiUrl || '').trim();
const TEAM_NAME = String(CFG.teamName || '').trim() || 'Tím';
const POLL_MS = Math.max(20, Number(CFG.pollSeconds) || 60) * 1000;
// apiUrl začínajúce lomkou (napr. /api/data) = kalendár za prihlásením na Verceli; kľúč drží server.
const PROXY = API.charAt(0) === '/';

const ST = {
  o:  {label:'Kancelária',        short:''},
  ho: {label:'Home office',       short:'HO'},
  dov:{label:'Dovolenka / voľno', short:'Dov'},
  nem:{label:'Choroba / lekár',   short:'Chor'},
  sc: {label:'Služobná cesta',    short:'Cesta'}
};
const BRUSHES = ['o','ho','dov','nem','sc'];
const GROUP_ORDER = ['o','ho','sc','dov','nem'];
const GROUP_LABEL = {o:'v kancelárii', ho:'na home office', sc:'na služobnej ceste', dov:'dovolenka / voľno', nem:'choroba / lekár'};
const MON = ['január','február','marec','apríl','máj','jún','júl','august','september','október','november','december'];
const MON_G = ['januára','februára','marca','apríla','mája','júna','júla','augusta','septembra','októbra','novembra','decembra'];
const WD = ['nedeľa','pondelok','utorok','streda','štvrtok','piatok','sobota'];
const WDS = ['Ne','Po','Ut','St','Št','Pi','So'];
const HFIX = {'01-01':'Nový rok','05-01':'Sviatok práce','05-08':'Deň víťazstva','07-05':'Cyril a Metod','07-06':'Majster Ján Hus','09-28':'Deň českej štátnosti','10-28':'Vznik samostatného Československa','11-17':'Deň boja za slobodu a demokraciu','12-24':'Štedrý deň','12-25':'1. sviatok vianočný','12-26':'2. sviatok vianočný'};
const MSG_NOT_CONFIGURED = 'Na serveri chýba tímový kľúč. V Apps Scripte spusti funkciu vytvorTimovyKluc.';
const MSG_OFFLINE = 'Server neodpovedá, skúšam znova. Zobrazené dáta môžu byť neaktuálne.';
const MSG_PROXY = {
  proxy_not_configured: 'Vo Verceli chýba premenná GAS_URL alebo GAS_KEY.',
  proxy_key_mismatch: 'GAS_KEY vo Verceli nesedí s kľúčom v Apps Scripte.'
};

/* ---------- pomocné funkcie ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2,'0');
const ymOf = d => d.getFullYear() + '-' + pad(d.getMonth()+1);
const ddOf = d => pad(d.getDate());
const addDays = (d,n) => new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);
const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const isWknd = d => d.getDay()===0 || d.getDay()===6;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cssEsc = v => (window.CSS && CSS.escape) ? CSS.escape(v) : v;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function easter(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const mo=Math.floor((h+l-7*m+114)/31), da=((h+l-7*m+114)%31)+1;
  return new Date(y, mo-1, da);
}
const holCache = {};
function hols(y){
  if(!holCache[y]){
    const m = Object.assign({}, HFIX), e = easter(y), gf = addDays(e,-2), em = addDays(e,1);
    m[pad(gf.getMonth()+1)+'-'+pad(gf.getDate())] = 'Veľký piatok';
    m[pad(em.getMonth()+1)+'-'+pad(em.getDate())] = 'Veľkonočný pondelok';
    holCache[y] = m;
  }
  return holCache[y];
}
const holName = d => hols(d.getFullYear())[pad(d.getMonth()+1)+'-'+pad(d.getDate())] || '';
function isoWeek(d){
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil(((t - y0)/86400000 + 1)/7);
}
function workdays(ym){
  const [y,m] = ym.split('-').map(Number), out = [];
  for(let d = new Date(y,m-1,1); d.getMonth()===m-1; d = addDays(d,1)) if(!isWknd(d)) out.push(d);
  return out;
}
function stepWork(d, dir){ let x = d; do { x = addDays(x, dir); } while(isWknd(x)); return x; }
function shiftYm(ym, n){ const [y,m] = ym.split('-').map(Number); return ymOf(new Date(y, m-1+n, 1)); }
function deepMerge(a, b){
  if(!isObj(b)) return a;
  for(const k of Object.keys(b)){
    if(isObj(b[k]) && isObj(a[k])) deepMerge(a[k], b[k]);
    else a[k] = isObj(b[k]) ? deepMerge({}, b[k]) : b[k];
  }
  return a;
}
const lsGet = k => { try { return localStorage.getItem('hoTabula.'+k); } catch(e){ return null; } };
const lsSet = (k,v) => { try { localStorage.setItem('hoTabula.'+k, v); } catch(e){} };

/* ---------- tímový kľúč: z odkazu ?kluc=… alebo z pamäte prehliadača ---------- */
function readKey(){
  let k = '';
  try {
    const u = new URL(location.href);
    k = (u.searchParams.get('kluc') || '').trim();
    if(k){
      lsSet('kluc', k);
      u.searchParams.delete('kluc');
      history.replaceState(null, '', u.toString());
    }
  } catch(e){}
  return k || lsGet('kluc') || '';
}
let KEY = PROXY ? '' : readKey();
function goLogin(){
  const back = location.pathname + location.search;
  location.href = '/login' + (back && back !== '/' ? '?next=' + encodeURIComponent(back) : '');
}

const now = new Date();
const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const START = isWknd(TODAY) ? stepWork(TODAY, 1) : TODAY;

const S = {
  mode: 'loading',          // loading | live | local | nokey
  team: [], teamLoaded: false,
  months: {},
  ym: ymOf(START), sel: START,
  brush: ST[lsGet('brush')] ? lsGet('brush') : 'ho',
  me: lsGet('me') || '',
  slow: false, err: '', errKind: '', keyBad: false
};
const drafts = {}, noteTimers = {};
const writers = new Map();
let seq = 0;

function ensureMonth(ym){
  if(!S.months[ym]) S.months[ym] = {people:{}, notes:{d:{}}, seen: S.mode==='local'};
  return S.months[ym];
}
function cleanStatuses(d){
  const out = {};
  if(isObj(d)) for(const k of Object.keys(d)){ const v = d[k]; if(/^\d\d$/.test(k) && (v==='' || (ST[v] && v!=='o'))) out[k] = v; }
  return out;
}
function cleanNotes(d){
  const out = {};
  if(isObj(d)) for(const k of Object.keys(d)){ if(/^\d\d$/.test(k) && typeof d[k]==='string') out[k] = d[k].slice(0,200); }
  return out;
}
function cleanTeam(list){
  if(!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(m => isObj(m) && typeof m.id==='string' && /^[A-Za-z0-9_\-.~:@+]{1,60}$/.test(m.id) && typeof m.name==='string' && !seen.has(m.id) && seen.add(m.id))
             .map(m => ({id:m.id, name:m.name.slice(0,40), active:m.active!==false}));
}
function statusOf(ym, id, dd){
  const m = S.months[ym], p = m && m.people[id], v = p && p.d[dd];
  return (v && ST[v]) ? v : 'o';
}
function noteOf(ym, dd){
  const k = ym+'/'+dd;
  if(k in drafts) return drafts[k];
  const m = S.months[ym], v = m && m.notes.d[dd];
  return typeof v==='string' ? v : '';
}
function visibleMembers(ym){
  const m = S.months[ym];
  return S.team.filter(t => t.active || (m && m.people[t.id] && m.people[t.id].exists));
}
const canEdit = () => S.mode==='live' || S.mode==='local';

/* ---------- komunikácia so serverom (Google Apps Script) ---------- */
async function call(action, payload){
  let res;
  try {
    // Telo ako obyčajný text: prehliadač tak neposiela predbežný CORS dopyt, ktorý Apps Script nevie obslúžiť.
    const req = Object.assign({action}, PROXY ? {} : {key:KEY}, payload || {});
    res = await fetch(API, {method:'POST', redirect:'follow', credentials:'same-origin', body: JSON.stringify(req)});
  } catch(e){ throw {code:'network'}; }
  if(res.status === 401 && PROXY){ goLogin(); throw {code:'login_required'}; }
  if(!res.ok) throw {code:'network'};
  let j;
  try { j = await res.json(); } catch(e){ throw {code:'network'}; }
  if(!j || !j.ok) throw {code:(j && j.error) || 'server_error', message:(j && j.message) || ''};
  return j.data;
}
function applyTeam(t){
  S.team = cleanTeam(t && t.members);
  const o = overlayFor('team/config');
  if(o && Array.isArray(o.members)) S.team = cleanTeam(o.members);
  S.teamLoaded = true;
}
function applyMonth(ym, data){
  const m = ensureMonth(ym), people = {};
  if(data && isObj(data.people)) for(const id of Object.keys(data.people)) people[id] = {exists:true, d:cleanStatuses(data.people[id])};
  m.people = people;
  m.notes = {d:cleanNotes(data && data.notes)};
  m.seen = true;
  applyOverlays(ym);
}

let pollT = 0, syncing = false, syncAgain = false;
function schedulePoll(){
  clearTimeout(pollT);
  pollT = setTimeout(() => { if(document.visibilityState === 'hidden') schedulePoll(); else sync(); }, POLL_MS);
}
async function sync(){
  if(!API || S.mode==='local' || S.mode==='nokey') return;
  if(syncing){ syncAgain = true; return; }
  syncing = true;
  const ym = S.ym, s0 = seq;
  const slowT = setTimeout(() => { S.slow = true; renderSync(); }, 10000);
  try {
    const data = await call('sync', {ym});
    if(S.mode==='loading') S.mode = 'live';
    if(seq === s0){ applyTeam(data && data.team); applyMonth(ym, data && data.month); }
    else syncAgain = true;
    S.slow = false;
    if(S.errKind==='load'){ S.err = ''; S.errKind = ''; }
  } catch(e){
    onLoadError(e);
  } finally {
    clearTimeout(slowT);
    syncing = false;
    scheduleRender();
    if(syncAgain && S.mode!=='nokey'){ syncAgain = false; sync(); }
    else schedulePoll();
  }
}
function onLoadError(e){
  const code = e && e.code;
  if(code==='login_required') return;
  if(MSG_PROXY[code]){ S.err = MSG_PROXY[code]; S.errKind = 'config'; return; }
  if(code==='unauthorized'){ toKeyMode(true); return; }
  if(code==='not_configured'){ S.err = MSG_NOT_CONFIGURED; S.errKind = 'config'; return; }
  S.err = MSG_OFFLINE; S.errKind = 'load';
}
function toKeyMode(bad){
  S.mode = 'nokey'; S.keyBad = !!bad;
  KEY = ''; lsSet('kluc', '');
  writers.forEach(w => { clearTimeout(w.timer); w.pending = null; });
  S.err = ''; S.errKind = '';
  scheduleRender();
}
function saveKey(){
  const inp = $('#keyInput');
  const k = inp ? inp.value.trim() : '';
  if(!k){ if(inp) inp.focus(); return; }
  KEY = k; lsSet('kluc', k);
  S.mode = 'loading'; S.keyBad = false;
  renderAll();
  sync();
}

/* ---------- zápisy ---------- */
function queueWrite(path, patch, delay){
  let w = writers.get(path);
  if(!w){ w = {pending:null, inflight:null, timer:0, retries:0}; writers.set(path, w); }
  w.pending = deepMerge(w.pending || {}, patch);
  seq++;
  clearTimeout(w.timer);
  w.timer = setTimeout(() => { w.timer = 0; flush(path); }, delay == null ? 450 : delay);
  renderSync();
}
function flushAll(){ for(const p of writers.keys()) flush(p); }
async function flush(path){
  const w = writers.get(path);
  if(!w || w.inflight || !w.pending) return;
  clearTimeout(w.timer); w.timer = 0;
  const patch = w.pending; w.pending = null; w.inflight = patch;
  renderSync();
  try {
    await persist(path, patch);
    w.retries = 0;
    if(S.errKind==='save'){ S.err = ''; S.errKind = ''; }
  } catch(e){
    onWriteError(e, path, patch, w);
  } finally {
    w.inflight = null;
    seq++;
    if(w.pending && !w.timer) flush(path);
    scheduleRender();
  }
}
async function persist(path, patch){
  if(S.mode==='local'){ saveLocal(); return; }
  let mm;
  if(path==='team/config'){
    applyTeam(await call('setTeam', {members: patch.members || []}));
    return;
  }
  if((mm = path.match(/^months\/(\d{4}-\d{2})\/people\/(.+)$/))){
    const ym = mm[1], id = mm[2], d = isObj(patch.d) ? patch.d : {};
    const changes = Object.keys(d).map(dd => ({id, dd, s:d[dd]}));
    applyMonth(ym, await call('setCells', {ym, changes}));
    return;
  }
  if((mm = path.match(/^notes\/(\d{4}-\d{2})$/))){
    const ym = mm[1], d = isObj(patch.d) ? patch.d : {};
    const changes = Object.keys(d).map(dd => ({dd, text:d[dd]}));
    applyMonth(ym, await call('setNotes', {ym, changes}));
  }
}
function onWriteError(e, path, patch, w){
  const code = e && e.code;
  if(code==='login_required') return;
  if(MSG_PROXY[code]){ S.err = MSG_PROXY[code]; S.errKind = 'config'; return; }
  if(code==='unauthorized'){ toKeyMode(true); return; }
  if(code==='not_configured'){ S.err = MSG_NOT_CONFIGURED; S.errKind = 'config'; return; }
  if(code==='bad_request'){ toast('Server túto zmenu odmietol.'); return; }
  if(w.retries < 3){
    w.retries++;
    w.pending = deepMerge(deepMerge({}, patch), w.pending || {});
    w.timer = setTimeout(() => { w.timer = 0; flush(path); }, 1500 * w.retries + Math.random()*1000);
  } else {
    w.retries = 0;
    S.err = 'Zmeny sa nepodarilo uložiť. Skontroluj pripojenie a skús to znova.'; S.errKind = 'save';
  }
}
function overlayFor(path){
  const w = writers.get(path); if(!w) return null;
  let o = null;
  if(w.inflight) o = deepMerge({}, w.inflight);
  if(w.pending) o = deepMerge(o || {}, w.pending);
  return o;
}
function applyOverlays(ym){
  const m = ensureMonth(ym), pre = 'months/'+ym+'/people/';
  for(const path of writers.keys()){
    if(path.indexOf(pre)===0){
      const o = overlayFor(path), id = path.slice(pre.length);
      if(o && isObj(o.d)){ const p = m.people[id] || (m.people[id] = {exists:false, d:{}}); Object.assign(p.d, o.d); }
    }
  }
  const on = overlayFor('notes/'+ym);
  if(on && isObj(on.d)) Object.assign(m.notes.d, on.d);
}

/* ---------- režim bez servera (len tento prehliadač) ---------- */
function startLocal(){
  S.mode = 'local';
  let data = null;
  try { data = JSON.parse(lsGet('data') || 'null'); } catch(e){}
  if(data && Array.isArray(data.team)) S.team = cleanTeam(data.team);
  if(data && isObj(data.months)){
    for(const ym of Object.keys(data.months)){
      if(!/^\d{4}-\d{2}$/.test(ym)) continue;
      const src = data.months[ym], m = ensureMonth(ym);
      if(isObj(src.people)) for(const id of Object.keys(src.people)) m.people[id] = {exists:true, d:cleanStatuses(src.people[id])};
      m.notes = {d:cleanNotes(src.notes)};
    }
  }
  for(const ym of Object.keys(S.months)) S.months[ym].seen = true;
  S.teamLoaded = true;
  renderAll();
}
function saveLocal(){
  const months = {};
  for(const ym of Object.keys(S.months)){
    const m = S.months[ym], people = {};
    for(const id of Object.keys(m.people)) people[id] = m.people[id].d;
    months[ym] = {people, notes:m.notes.d};
  }
  lsSet('data', JSON.stringify({team:S.team, months}));
}

/* ---------- vykresľovanie ---------- */
let rq = 0, drag = null, needRender = false;
function scheduleRender(){
  if(drag){ needRender = true; return; }
  if(rq) return;
  rq = requestAnimationFrame(() => { rq = 0; renderAll(); });
}
function renderAll(opts){
  const ae = document.activeElement;
  const fk = ae && ae.dataset ? ae.dataset.fk : null;
  let s0 = null, s1 = null;
  if(ae && ae.classList && (ae.classList.contains('note') || ae.id==='keyInput')){ s0 = ae.selectionStart; s1 = ae.selectionEnd; }
  const keyVal = ae && ae.id==='keyInput' ? ae.value : null;
  const wrap = $('#gridWrap'), sl = wrap.scrollLeft, st = wrap.scrollTop;
  renderSync(); renderBoard(); renderToolbar(); renderGrid();
  if(opts && opts.resetScroll){ wrap.scrollTop = 0; } else { wrap.scrollLeft = sl; wrap.scrollTop = st; }
  if(fk){
    const el = document.querySelector('[data-fk="'+cssEsc(fk)+'"]');
    if(el && el !== document.activeElement){
      if(keyVal !== null) el.value = keyVal;
      el.focus({preventScroll:true});
      if(s0 !== null && el.setSelectionRange){ try { el.setSelectionRange(s0, s1); } catch(e){} }
    }
  }
}
function renderSync(){
  const el = $('#sync');
  let busy = false;
  for(const w of writers.values()) if(w.pending || w.inflight){ busy = true; break; }
  let t, cls = '';
  if(S.mode==='nokey'){ t = 'Chýba tímový kľúč'; cls = 'key'; }
  else if(S.err){ t = S.err; cls = 'err'; }
  else if(S.mode==='loading'){ t = 'Pripájam sa…'; cls = 'busy'; }
  else if(busy){ t = 'Ukladám…'; cls = 'busy'; }
  else if(S.slow){ t = 'Server odpovedá pomaly, dáta môžu byť neaktuálne'; cls = 'err'; }
  else if(S.mode==='local'){ t = 'Ukladá sa len v tomto prehliadači'; cls = 'local'; }
  else t = 'Uložené pre celý tím';
  if(el.textContent !== t) el.textContent = t;
  el.className = 'sync ' + cls;
}
function renderBoard(){
  const d = S.sel, ym = ymOf(d), dd = ddOf(d);
  $('#bWd').textContent = WD[d.getDay()];
  $('#bDt').innerHTML = d.getDate() + '. ' + MON_G[d.getMonth()] + ' ' + d.getFullYear() + (sameDay(d, TODAY) ? '<span class="tag">dnes</span>' : '');
  const box = $('#groups'), note = $('#bNote'), hol = holName(d), m = S.months[ym];
  const nv = noteOf(ym, dd).trim();
  note.hidden = !nv || !!hol;
  note.textContent = nv ? 'Poznámka: ' + nv : '';
  if(S.mode==='nokey'){ box.innerHTML = '<p class="muted">Na zobrazenie kalendára zadaj tímový kľúč v tabuľke nižšie.</p>'; return; }
  if(!S.teamLoaded || !m || !m.seen){ box.innerHTML = '<p class="muted">Načítavam tím…</p>'; return; }
  if(hol){ box.innerHTML = '<p class="hol-msg">Štátny sviatok: ' + esc(hol) + '</p>'; return; }
  const mem = visibleMembers(ym);
  if(!mem.length){ box.innerHTML = '<p class="muted">V tíme zatiaľ nikto nie je. Pridaj kolegov cez Upraviť tím.</p>'; return; }
  const groups = {o:[], ho:[], sc:[], dov:[], nem:[]};
  mem.forEach(x => groups[statusOf(ym, x.id, dd)].push(x));
  let h = '';
  GROUP_ORDER.forEach(s => {
    const list = groups[s];
    if(!list.length && s!=='o' && s!=='ho') return;
    h += '<div class="group s-'+s+'"><div class="g-label"><span class="n">'+list.length+'</span><span class="t">'+GROUP_LABEL[s]+'</span></div>';
    h += list.length
      ? '<ul class="magnets">' + list.map(x => '<li class="magnet s-'+s+(x.id===S.me?' me':'')+'">'+esc(x.name)+'</li>').join('') + '</ul>'
      : '<p class="none">nikto</p>';
    h += '</div>';
  });
  box.innerHTML = h;
}
const HINT = 'Vyber hore, čo chceš označiť, a klikni do políčka. Druhým klikom ho vrátiš na „Kancelária“. Na počítači môžeš myšou ťahať cez viac dní naraz, šípkami sa pohybuješ po tabuľke. Klikom na dátum zobrazíš daný deň hore.';
let meSig = '';
function renderToolbar(){
  const [y, mo] = S.ym.split('-').map(Number);
  $('#monthTitle').textContent = cap(MON[mo-1]) + ' ' + y;
  $('#brushes').hidden = S.mode==='nokey';
  document.querySelector('.tools').hidden = S.mode==='nokey';
  $('#hint').hidden = S.mode==='nokey';
  $('#teamBtn').hidden = !canEdit();
  $('#hint').textContent = S.mode==='local'
    ? HINT + ' Kalendár zatiaľ nie je pripojený na server, zmeny vidíš len ty v tomto prehliadači.'
    : HINT;
  document.querySelectorAll('.brush').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.brush===S.brush)));
  const act = S.team.filter(t => t.active);
  const sig = act.map(t => t.id+':'+t.name).join('|');
  const sel = $('#me');
  if(sig !== meSig){
    meSig = sig;
    sel.innerHTML = '<option value="">vyber sa</option>' + act.map(t => '<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');
  }
  sel.value = act.some(t => t.id===S.me) ? S.me : '';
}
const countHtml = (office, total) => '<b>'+office+'</b><span>/'+total+'</span>';
const cellInner = s => s==='o' ? '<span class="dot" aria-hidden="true"></span>' : '<span class="pill" aria-hidden="true">'+ST[s].short+'</span>';
function renderGrid(){
  const ym = S.ym, grid = $('#grid'), m = S.months[ym];
  if(S.mode==='nokey'){
    grid.innerHTML = '<tbody><tr><td class="grid-msg"><div class="key-panel">'
      + '<h3>Zadaj tímový kľúč</h3>'
      + '<p>Kľúč je súčasťou odkazu, ktorý ti poslal správca kalendára (časť za <span class="nw">„?kluc=“</span>). Prehliadač si ho potom zapamätá.</p>'
      + (S.keyBad ? '<p class="err-text">Tento kľúč nesedí. Skontroluj ho alebo si vypýtaj nový odkaz.</p>' : '')
      + '<div class="add-row"><input id="keyInput" data-fk="key" type="text" autocomplete="off" spellcheck="false" placeholder="Tímový kľúč" aria-label="Tímový kľúč"><button class="btn primary" data-save-key>Pokračovať</button></div>'
      + '</div></td></tr></tbody>';
    return;
  }
  if(!S.teamLoaded || !m || !m.seen){
    grid.innerHTML = '<tbody><tr><td class="grid-msg">' + (S.err ? esc(S.err) : 'Načítavam tabuľku…') + '</td></tr></tbody>';
    return;
  }
  const mem = visibleMembers(ym);
  if(!mem.length){
    grid.innerHTML = '<tbody><tr><td class="grid-msg"><p>V tíme zatiaľ nikto nie je.</p>' + (canEdit() ? '<button class="btn" data-open-team>Pridať kolegov</button>' : '') + '</td></tr></tbody>';
    return;
  }
  const days = workdays(ym), cols = mem.length;
  let h = '<thead><tr><th class="c-date" scope="col">Deň</th>';
  mem.forEach(x => {
    h += '<th scope="col" class="c-m'+(x.id===S.me?' me':'')+(x.active?'':' arch')+'" title="'+esc(x.name)+(x.active?'':' (skrytý člen)')+'">'+esc(x.name)+'</th>';
  });
  h += '<th scope="col" class="c-count">V kanc.</th><th scope="col" class="c-note">Poznámka</th></tr></thead><tbody>';
  let lastWk = -1, r = 0;
  days.forEach(d => {
    const wk = isoWeek(d), dd = ddOf(d), hol = holName(d);
    if(wk !== lastWk){ h += '<tr class="wk"><th class="c-date" scope="rowgroup">'+wk+'. týždeň</th><td colspan="'+(cols+2)+'"></td></tr>'; lastWk = wk; }
    const isSel = sameDay(d, S.sel), cls = ['day'];
    if(sameDay(d, TODAY)) cls.push('today');
    if(isSel) cls.push('sel');
    if(d < TODAY) cls.push('past');
    const dateLbl = d.getDate()+'. '+(d.getMonth()+1)+'.';
    h += '<tr class="'+cls.join(' ')+'" data-dd="'+dd+'">';
    h += '<th class="c-date" scope="row"><button class="date-btn" data-pick="'+dd+'" data-fk="d-'+dd+'" aria-pressed="'+isSel+'" aria-label="Zobraziť '+WD[d.getDay()]+' '+dateLbl+'"><span class="w">'+WDS[d.getDay()]+'</span><span class="n">'+d.getDate()+'.</span></button></th>';
    if(hol){
      h += '<td class="hol-cell" colspan="'+cols+'">'+esc(hol)+'</td><td class="c-count"></td><td class="c-note"></td></tr>';
      return;
    }
    let office = 0;
    mem.forEach((x, ci) => {
      const s = statusOf(ym, x.id, dd);
      if(s==='o') office++;
      const base = x.name+', '+dateLbl;
      h += '<td class="c-m'+(x.id===S.me?' me':'')+'"><button class="cell s-'+s+'" data-m="'+esc(x.id)+'" data-dd="'+dd+'" data-r="'+r+'" data-c="'+ci+'" data-fk="c-'+dd+'-'+esc(x.id)+'" data-label="'+esc(base)+'" aria-label="'+esc(base+': '+ST[s].label)+'">'+cellInner(s)+'</button></td>';
    });
    const nv = noteOf(ym, dd);
    h += '<td class="c-count'+(office===0?' zero':'')+'">'+countHtml(office, cols)+'</td>';
    h += '<td class="c-note"><input class="note" type="text" maxlength="200" data-dd="'+dd+'" data-fk="n-'+dd+'" value="'+esc(nv)+'" title="'+esc(nv)+'" placeholder="Pridať poznámku" aria-label="Poznámka '+dateLbl+'"></td></tr>';
    r++;
  });
  h += '</tbody><tfoot><tr><th class="c-date" scope="row">HO dní</th>';
  mem.forEach(x => { h += '<td class="c-m'+(x.id===S.me?' me':'')+'" data-foot="'+esc(x.id)+'">'+footHtml(ym, x.id)+'</td>'; });
  h += '<td class="c-count"></td><td class="c-note"></td></tr></tfoot>';
  grid.innerHTML = h;
}
function footHtml(ym, id){
  let n = 0;
  workdays(ym).forEach(d => { if(!holName(d) && statusOf(ym, id, ddOf(d))==='ho') n++; });
  return n ? '<b>'+n+'</b>' : '0';
}

/* ---------- ovládanie tabuľky ---------- */
function setCell(cell, val){
  const ym = S.ym, id = cell.dataset.m, dd = cell.dataset.dd;
  if(statusOf(ym, id, dd) === val) return;
  const m = ensureMonth(ym);
  const p = m.people[id] || (m.people[id] = {exists:false, d:{}});
  p.d[dd] = val==='o' ? '' : val;
  queueWrite('months/'+ym+'/people/'+id, {d:{[dd]: p.d[dd]}});
  cell.className = 'cell s-'+val;
  void cell.offsetWidth;
  cell.classList.add('just');
  cell.innerHTML = cellInner(val);
  cell.setAttribute('aria-label', cell.dataset.label + ': ' + ST[val].label);
  const tr = cell.closest('tr');
  if(tr){
    const cells = tr.querySelectorAll('.cell');
    let office = 0;
    cells.forEach(c => { if(statusOf(ym, c.dataset.m, dd)==='o') office++; });
    const cc = tr.querySelector('.c-count');
    if(cc){ cc.innerHTML = countHtml(office, cells.length); cc.classList.toggle('zero', office===0); }
  }
  const f = document.querySelector('[data-foot="'+cssEsc(id)+'"]');
  if(f) f.innerHTML = footHtml(ym, id);
  if(ymOf(S.sel)===ym && ddOf(S.sel)===dd) renderBoard();
}
function targetVal(cell){
  const cur = statusOf(S.ym, cell.dataset.m, cell.dataset.dd);
  return (S.brush==='o' || cur===S.brush) ? 'o' : S.brush;
}
let skipClick = false;
const grid = $('#grid');
grid.addEventListener('pointerdown', e => {
  const cell = e.target.closest('.cell');
  if(!cell || e.pointerType!=='mouse' || e.button!==0) return;
  e.preventDefault();
  cell.focus({preventScroll:true});
  skipClick = true;
  if(!canEdit()){ waitNotice(); return; }
  drag = {val:targetVal(cell), done:new Set()};
  drag.done.add(cell.dataset.m+'/'+cell.dataset.dd);
  setCell(cell, drag.val);
});
grid.addEventListener('pointerover', e => {
  if(!drag) return;
  const cell = e.target.closest('.cell');
  if(!cell) return;
  const k = cell.dataset.m+'/'+cell.dataset.dd;
  if(drag.done.has(k)) return;
  drag.done.add(k);
  setCell(cell, drag.val);
});
function endDrag(){
  setTimeout(() => { skipClick = false; }, 0);
  if(!drag) return;
  drag = null;
  if(needRender){ needRender = false; scheduleRender(); }
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
grid.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]');
  if(pick){ selectDay(pick.dataset.pick); return; }
  if(e.target.closest('[data-open-team]')){ openTeam(); return; }
  if(e.target.closest('[data-save-key]')){ saveKey(); return; }
  if(skipClick){ skipClick = false; return; }
  const cell = e.target.closest('.cell');
  if(!cell) return;
  if(!canEdit()){ waitNotice(); return; }
  setCell(cell, targetVal(cell));
});
grid.addEventListener('keydown', e => {
  if(e.target.id==='keyInput'){
    if(e.key==='Enter'){ e.preventDefault(); saveKey(); }
    return;
  }
  if(e.target.classList.contains('note')){
    if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); }
    return;
  }
  const cell = e.target.closest('.cell');
  if(!cell) return;
  let r = +cell.dataset.r, c = +cell.dataset.c;
  if(e.key==='ArrowRight') c++; else if(e.key==='ArrowLeft') c--;
  else if(e.key==='ArrowDown') r++; else if(e.key==='ArrowUp') r--;
  else return;
  const t = grid.querySelector('.cell[data-r="'+r+'"][data-c="'+c+'"]');
  if(t){ e.preventDefault(); t.focus(); }
});
grid.addEventListener('input', e => {
  const inp = e.target.closest('.note');
  if(!inp) return;
  const ym = S.ym, dd = inp.dataset.dd, k = ym+'/'+dd;
  drafts[k] = inp.value;
  clearTimeout(noteTimers[k]);
  noteTimers[k] = setTimeout(() => commitNote(ym, dd), 900);
});
grid.addEventListener('focusout', e => {
  const inp = e.target.closest && e.target.closest('.note');
  if(inp) commitNote(S.ym, inp.dataset.dd);
});
function commitNote(ym, dd){
  const k = ym+'/'+dd;
  clearTimeout(noteTimers[k]);
  if(!(k in drafts)) return;
  const raw = drafts[k].slice(0,200), v = raw.trim() ? raw : '';
  delete drafts[k];
  const n = ensureMonth(ym).notes;
  if((n.d[dd] || '') === v) return;
  if(!canEdit()){ waitNotice(); scheduleRender(); return; }
  n.d[dd] = v;
  queueWrite('notes/'+ym, {d:{[dd]: v}}, 200);
  if(ymOf(S.sel)===ym && ddOf(S.sel)===dd) renderBoard();
}
function commitAllNotes(){ Object.keys(drafts).forEach(k => { const [ym, dd] = k.split('/'); commitNote(ym, dd); }); }

function goTo(date){
  commitAllNotes();
  const ym = ymOf(date), changed = ym !== S.ym;
  S.sel = date; S.ym = ym;
  ensureMonth(ym);
  renderAll({resetScroll: changed});
  if(changed) sync();
}
function selectDay(dd){
  const [y, m] = S.ym.split('-').map(Number);
  S.sel = new Date(y, m-1, +dd);
  renderBoard();
  document.querySelectorAll('#grid tr.day').forEach(tr => {
    const on = tr.dataset.dd === dd;
    tr.classList.toggle('sel', on);
    const b = tr.querySelector('.date-btn'); if(b) b.setAttribute('aria-pressed', String(on));
  });
}
function firstSel(ym){
  const days = workdays(ym);
  if(ymOf(TODAY)===ym){ const f = days.find(d => d >= TODAY); return f || days[days.length-1]; }
  return days[0];
}
$('#prevDay').addEventListener('click', () => goTo(stepWork(S.sel, -1)));
$('#nextDay').addEventListener('click', () => goTo(stepWork(S.sel, 1)));
$('#todayBtn').addEventListener('click', () => goTo(START));
$('#prevMonth').addEventListener('click', () => goTo(firstSel(shiftYm(S.ym, -1))));
$('#nextMonth').addEventListener('click', () => goTo(firstSel(shiftYm(S.ym, 1))));

const brushes = $('#brushes');
BRUSHES.forEach(b => {
  const btn = document.createElement('button');
  btn.className = 'brush s-'+b;
  btn.dataset.brush = b;
  btn.textContent = ST[b].label;
  btn.setAttribute('aria-pressed', String(b===S.brush));
  btn.addEventListener('click', () => { S.brush = b; lsSet('brush', b); renderToolbar(); });
  brushes.appendChild(btn);
});
$('#me').addEventListener('change', e => { S.me = e.target.value; lsSet('me', S.me); renderAll(); });

let toastT = 0;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4200);
}
function waitNotice(){
  toast(S.mode==='nokey' ? 'Najprv zadaj tímový kľúč.' : 'Chvíľu strpenia, kalendár sa ešte načítava.');
}

/* ---------- úprava tímu ---------- */
const dlg = $('#teamDlg');
let draft = [];
function slug(name){
  const s = name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30) || 'kolega';
  const taken = new Set(draft.map(m => m.id).concat(S.team.map(m => m.id)));
  let id = s, i = 2;
  while(taken.has(id)) id = s + '-' + (i++);
  return id;
}
function openTeam(){
  if(!canEdit()){ waitNotice(); return; }
  draft = S.team.map(m => Object.assign({}, m));
  renderTeam();
  if(typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open','');
}
function renderTeam(focusSel){
  const act = draft.filter(m => m.active), arch = draft.filter(m => !m.active);
  $('#teamActive').innerHTML = act.length ? act.map((m, i) =>
    '<li><input type="text" maxlength="40" value="'+esc(m.name)+'" data-name="'+esc(m.id)+'" aria-label="Meno"><button class="btn small icon" data-up="'+esc(m.id)+'" aria-label="Posunúť vyššie"'+(i===0?' disabled':'')+'>↑</button><button class="btn small icon" data-down="'+esc(m.id)+'" aria-label="Posunúť nižšie"'+(i===act.length-1?' disabled':'')+'>↓</button><button class="btn small" data-hide="'+esc(m.id)+'">Skryť</button></li>'
  ).join('') : '<li class="muted">Zatiaľ nikto. Pridaj prvého kolegu nižšie.</li>';
  $('#archWrap').hidden = !arch.length;
  $('#teamArch').innerHTML = arch.map(m => '<li><span class="nm">'+esc(m.name)+'</span><button class="btn small" data-show="'+esc(m.id)+'">Vrátiť do tímu</button></li>').join('');
  if(focusSel){ const el = dlg.querySelector(focusSel); if(el && !el.disabled) el.focus(); }
}
function moveMember(id, dir){
  const idx = draft.findIndex(m => m.id===id);
  let j = idx + dir;
  while(j >= 0 && j < draft.length && !draft[j].active) j += dir;
  if(idx < 0 || j < 0 || j >= draft.length) return;
  const t = draft[idx]; draft[idx] = draft[j]; draft[j] = t;
}
dlg.addEventListener('input', e => {
  const id = e.target.dataset && e.target.dataset.name;
  if(id){ const m = draft.find(x => x.id===id); if(m) m.name = e.target.value.slice(0,40); }
});
dlg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if(!b) return;
  if(b.dataset.up){ moveMember(b.dataset.up, -1); renderTeam('[data-up="'+cssEsc(b.dataset.up)+'"]'); }
  else if(b.dataset.down){ moveMember(b.dataset.down, 1); renderTeam('[data-down="'+cssEsc(b.dataset.down)+'"]'); }
  else if(b.dataset.hide){ const m = draft.find(x => x.id===b.dataset.hide); if(m) m.active = false; renderTeam('#newName'); }
  else if(b.dataset.show){ const m = draft.find(x => x.id===b.dataset.show); if(m) m.active = true; renderTeam('#newName'); }
});
function addMember(){
  const inp = $('#newName'), name = inp.value.trim().slice(0,40);
  if(!name){ inp.focus(); return; }
  draft.push({id:slug(name), name, active:true});
  inp.value = '';
  renderTeam('#newName');
}
$('#addMember').addEventListener('click', addMember);
$('#newName').addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); addMember(); } });
$('#cancelTeam').addEventListener('click', () => dlg.close());
$('#saveTeam').addEventListener('click', () => {
  if($('#newName').value.trim()) addMember();
  const clean = draft.map(m => ({id:m.id, name:(m.name.trim() || 'Bez mena').slice(0,40), active:m.active}));
  S.team = clean;
  S.teamLoaded = true;
  queueWrite('team/config', {members:clean}, 0);
  if(S.me && !clean.some(m => m.id===S.me && m.active)){ S.me = ''; lsSet('me', ''); }
  dlg.close();
  toast('Tím je uložený.');
  renderAll();
});
$('#teamBtn').addEventListener('click', openTeam);

document.addEventListener('visibilitychange', () => {
  if(document.visibilityState==='hidden'){ commitAllNotes(); flushAll(); }
  else sync();
});
window.addEventListener('pagehide', () => { commitAllNotes(); flushAll(); });
window.addEventListener('online', () => sync());

/* ---------- štart ---------- */
$('#brand').textContent = TEAM_NAME + ': kancelária a home office';
if(PROXY && $('#logout')) $('#logout').hidden = false;
document.title = TEAM_NAME + ': kancelária a home office';
ensureMonth(S.ym);
if(!API) startLocal();
else if(!KEY && !PROXY){ S.mode = 'nokey'; renderAll(); }
else { renderAll(); sync(); }
})();
