// Build Mate — Winget shop-floor build timer.
// Plain JavaScript, no build step. Data is kept on the device and copied to Supabase when connected.
(function () {
'use strict';

// ---------- fixed data ----------
const STAGES = [
  {n:1, fn:'Fabrication', colour:'#00a3e0', name:'Fabricate', ref:0, tasks:['Main Frame (UK)','Prime (UK)','Outsourced — no internal time expected']},
  {n:2, fn:'Stores', colour:'#8c4799', name:'Pick Parts', ref:40, tasks:['Pick all components (excluding fixings)']},
  {n:3, fn:'Assembly', colour:'#e57200', name:'Sub-assemble Main Frame', ref:60, tasks:['Main Frame (UK)','Wheels','Towbar','Axle']},
  {n:4, fn:'Assembly', colour:'#e57200', name:'Sub-assemble Engine & Preparation', ref:60, tasks:['Engine & W/Loom (UK)','Engine Base Plate','Oil/Fuel']},
  {n:5, fn:'Assembly', colour:'#e57200', name:'Sub-assemble Trunnion', ref:120, tasks:['Trunnion (UK)','Tilt Wheel (INT)','Chain Sprocket','Brackets']},
  {n:6, fn:'Assembly', colour:'#e57200', name:'Sub-assemble Drum', ref:120, tasks:['Top Drum (INT)','Bottom Drum (INT)','Shaft (DC Assy) (INT)','Tophat (DC Assy) (INT)','Blades x2','Bonded/Fixed','Clamped/Spot Welded']},
  {n:7, fn:'Build', colour:'#009639', name:'Build up mixer', ref:60, tasks:['Fit all Sub-assemblies to mainframe','Engine (UK)','Trunnion (UK)','Drum (INT)','Pulley Alignment','Belt Tensioning']},
  {n:8, fn:'QC', colour:'#e11f1c', name:'Test / Inspection', ref:60, tasks:['Engine Start','Drum Run Speed','Water Tightness','Drum Backlash']},
  {n:9, fn:'QC', colour:'#e11f1c', name:'Paint', ref:240, tasks:['Engine Bagged','Wheels Bagged','Masked','Prime','Topcoat']},
  {n:10, fn:'QC', colour:'#e11f1c', name:'Finish', ref:35, tasks:['Pull Cord Plate','Engine Stop Switch','Engine Lids* (UK)','Engine Grills* (UK)','Decals','Battery']}
];
const MACHINES = [
  {name:'100T ES Diesel', hasRef:true},
  {name:'150T ES Diesel', hasRef:false},
  {name:'150TFT ES Diesel', hasRef:false},
  {name:'175T ES Diesel', hasRef:false},
  {name:'175TFT ES Diesel', hasRef:false}
];
const FITTERS = ['Alan Beardall','Andrew Thomond','Andrew Simpson','Clive Hope','Graham Hodge','Ian Carr','Ian Bradbury','Keagan Brindley','Neil Churchouse','Ryan Cave','Stuart Fildes'];
const FIXED_BUDGET_100T = 765; // 12h 45m
const QUICK_PICKS = 5;
const WO_MAX = 10;
const KEY = 'build-mate-live-v1';

// ---------- helpers ----------
const CFG = window.BUILD_MATE_CONFIG || {};
const configured = CFG.supabaseUrl && CFG.supabaseAnonKey && !/PASTE/i.test(CFG.supabaseUrl + CFG.supabaseAnonKey);
const sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl.trim(), CFG.supabaseAnonKey.trim()) : null;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const initials = n => (n || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const hm = mins => { const m = Math.round(mins); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const iso = ts => ts ? new Date(ts).toISOString() : null;
const ms = v => v ? new Date(v).getTime() : null;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const stageOf = n => STAGES.find(s => s.n === n);
const HOME_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>';
const BACK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// ---------- state ----------
const S = {
  screen:'signin', fitter:null, orders:[], activeId:null, stage:1, unit:1,
  wo:'', cust:'', machine:null, qty:1, mode:'batch', newNote:'', noteDraft:'',
  showReport:false, sendState:'idle', sendMsg:'', sync: sb ? 'saving' : 'local'
};
let outbox = [];
(function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); S.orders = d.orders || []; outbox = d.outbox || []; } catch (e) {}
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({orders:S.orders, outbox})); } catch (e) {} };
const cur = () => S.orders.find(o => o.id === S.activeId) || null;

// ---------- sync with Supabase ----------
const orderRow = o => ({id:o.id, wo:o.wo, customer:o.customer, machine:o.machine, has_ref:o.hasRef, qty:o.qty, mode:o.mode,
  complete:o.complete, done:o.done, finished_at:iso(o.finishedAt), active:o.active, created_at:iso(o.createdAt), updated_at:new Date().toISOString()});
const runRow = (r, o) => ({id:r.id, order_id:o.id, stage:r.stage, unit:r.unit, fitter:r.fitter, started_at:iso(r.start), stopped_at:iso(r.stop)});
const noteRow = (n, o) => ({id:n.id, order_id:o.id, text:n.text, fitter:n.fitter, created_at:iso(n.at)});

function queue(table, row) {
  if (table === 'orders') outbox = outbox.filter(x => !(x.t === 'orders' && x.row.id === row.id));
  outbox.push({t:table, row});
  save(); flush();
}
function setSync(v) { if (S.sync !== v) { S.sync = v; render(); } }

let flushing = false;
async function flush() {
  if (!sb) return setSync('local');
  if (flushing) return;
  if (!navigator.onLine) return setSync('offline');
  flushing = true;
  if (outbox.length) setSync('saving');
  try {
    // orders first so runs/notes always have a parent
    outbox.sort((a, b) => (a.t === 'orders' ? 0 : 1) - (b.t === 'orders' ? 0 : 1));
    while (outbox.length) {
      const it = outbox[0];
      const { error } = await sb.from(it.t).upsert(it.row);
      if (error) throw error;
      outbox.shift(); save();
    }
    setSync('saved');
  } catch (e) { console.warn('Sync failed', e); setSync('offline'); }
  flushing = false;
}

async function pull() {
  if (!sb || outbox.length || !navigator.onLine || flushing) return;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const o = await sb.from('orders').select('*').or('done.eq.false,updated_at.gte."' + since + '"');
  if (o.error) { console.warn(o.error); return setSync('offline'); }
  const ids = o.data.map(r => r.id);
  let runs = [], notes = [];
  if (ids.length) {
    const r = await sb.from('runs').select('*').in('order_id', ids);
    const n = await sb.from('notes').select('*').in('order_id', ids);
    if (r.error || n.error) return setSync('offline');
    runs = r.data; notes = n.data;
  }
  if (outbox.length) return; // something changed while loading — keep local
  S.orders = o.data.map(x => ({
    id:x.id, wo:x.wo, customer:x.customer, machine:x.machine, hasRef:x.has_ref, qty:x.qty, mode:x.mode,
    complete:x.complete || [], done:x.done, finishedAt:ms(x.finished_at), active:x.active, createdAt:ms(x.created_at),
    runs: runs.filter(r => r.order_id === x.id).map(r => ({id:r.id, stage:r.stage, unit:r.unit, fitter:r.fitter, start:ms(r.started_at), stop:ms(r.stopped_at)})),
    notes: notes.filter(n => n.order_id === x.id).map(n => ({id:n.id, text:n.text, fitter:n.fitter, at:ms(n.created_at)})).sort((a, b) => a.at - b.at)
  })).sort((a, b) => a.createdAt - b.createdAt);
  save(); S.sync = 'saved'; render();
}

window.addEventListener('online', () => { flush().then(pull); });
window.addEventListener('offline', () => setSync('offline'));

// ---------- maths ----------
function loggedMs(o, n, unit) {
  let t = o.runs.filter(r => r.stage === n && (unit == null || r.unit === unit)).reduce((a, r) => a + (r.stop - r.start), 0);
  if (o.active && o.active.stage === n && (unit == null || o.active.unit === unit)) t += Date.now() - o.active.start;
  return t;
}
function orderMs(o) { let t = o.runs.reduce((a, r) => a + (r.stop - r.start), 0); if (o.active) t += Date.now() - o.active.start; return t; }
function todayMs(o, n) {
  const now = Date.now();
  let t = o.runs.filter(r => (n == null || r.stage === n) && sameDay(r.start, now)).reduce((a, r) => a + (r.stop - r.start), 0);
  if (o.active && (n == null || o.active.stage === n)) t += now - o.active.start;
  return t;
}
const perUnit = o => o.mode === 'unit' && o.qty > 1;

// ---------- changes ----------
function touch(o) { queue('orders', orderRow(o)); save(); }
function stopActive(o) {
  if (!o.active) return;
  const r = {id:uid('r'), stage:o.active.stage, unit:o.active.unit, fitter:o.active.fitter, start:o.active.start, stop:Date.now()};
  o.runs.push(r); o.active = null;
  queue('runs', runRow(r, o));
}
function quickPicks() {
  const t = {};
  S.orders.forEach(o => { const k = (o.customer || '').trim(); if (!k) return; const x = t[k] || (t[k] = {name:k, n:0, last:0}); x.n++; x.last = Math.max(x.last, o.createdAt || 0); });
  return Object.values(t).sort((a, b) => b.n - a.n || b.last - a.last).slice(0, QUICK_PICKS).map(x => x.name);
}

const actions = {
  signin: d => { S.fitter = d.name; S.screen = 'board'; },
  home: () => { S.screen = 'signin'; S.fitter = null; S.activeId = null; S.showReport = false; },
  signout: () => actions.home(),
  board: () => { S.screen = 'board'; },
  stages: () => { S.screen = 'stages'; },
  back: () => { S.screen = (S.screen === 'timer' || S.screen === 'finish') ? 'stages' : 'board'; },
  new: () => Object.assign(S, {screen:'new', wo:'', cust:'', machine:null, qty:1, mode:'batch', newNote:''}),
  key: d => { const k = d.k; S.wo = k === 'C' ? '' : k === 'del' ? S.wo.slice(0, -1) : (S.wo.length < WO_MAX ? S.wo + k : S.wo); },
  pickcust: d => { S.cust = d.name; },
  machine: d => { S.machine = d.name; },
  qtyup: () => { S.qty = Math.min(20, S.qty + 1); },
  qtydown: () => { S.qty = Math.max(1, S.qty - 1); if (S.qty === 1) S.mode = 'batch'; },
  mode: d => { S.mode = d.m; },
  create: () => {
    if (!(S.wo && S.cust.trim() && S.machine)) return;
    const m = MACHINES.find(x => x.name === S.machine);
    const o = {id:uid('o'), wo:S.wo, customer:S.cust.trim(), machine:S.machine, hasRef:m.hasRef, qty:S.qty, mode:S.qty > 1 ? S.mode : 'batch',
      complete:[], done:false, finishedAt:null, active:null, createdAt:Date.now(), runs:[], notes:[]};
    S.orders.push(o); touch(o);
    if (S.newNote.trim()) { const n = {id:uid('n'), text:S.newNote.trim(), fitter:S.fitter, at:Date.now()}; o.notes.push(n); queue('notes', noteRow(n, o)); }
    Object.assign(S, {activeId:o.id, screen:'stages', unit:1});
  },
  open: d => Object.assign(S, {activeId:d.id, screen:'stages', unit:1, noteDraft:''}),
  unit: d => { S.unit = Number(d.n); },
  stage: d => { S.stage = Number(d.n); S.screen = 'timer'; },
  toggle: () => {
    const o = cur(); if (!o) return;
    const running = o.active && o.active.stage === S.stage && (!perUnit(o) || o.active.unit === S.unit);
    stopActive(o);
    if (!running) o.active = {stage:S.stage, unit:perUnit(o) ? S.unit : 1, fitter:S.fitter, start:Date.now()};
    touch(o);
  },
  complete: () => {
    const o = cur(); if (!o) return;
    const done = o.complete.includes(S.stage);
    if (o.active && o.active.stage === S.stage) stopActive(o);
    o.complete = done ? o.complete.filter(n => n !== S.stage) : o.complete.concat([S.stage]);
    touch(o);
    if (!done) S.screen = 'stages';
  },
  addnote: () => {
    const o = cur(); const t = S.noteDraft.trim(); if (!o || !t) return;
    const n = {id:uid('n'), text:t, fitter:S.fitter, at:Date.now()};
    o.notes.push(n); queue('notes', noteRow(n, o)); touch(o); S.noteDraft = '';
  },
  tofinish: () => { const o = cur(); if (o && o.complete.length === 10) S.screen = 'finish'; },
  finish: () => { const o = cur(); if (!o) return; stopActive(o); o.done = true; o.finishedAt = Date.now(); touch(o); S.screen = 'board'; },
  report: () => { S.showReport = true; S.sendState = 'idle'; S.sendMsg = ''; },
  closereport: () => { S.showReport = false; },
  send: async () => {
    if (!sb) { S.sendState = 'error'; S.sendMsg = 'Not connected to Supabase yet — add your keys to config.js.'; return; }
    S.sendState = 'sending'; S.sendMsg = 'Saving latest times…'; render();
    await flush();
    if (outbox.length) { S.sendState = 'error'; S.sendMsg = 'Couldn\u2019t reach the server. Check Wi-Fi and try again.'; return render(); }
    S.sendMsg = 'Building the spreadsheet and sending…'; render();
    try {
      const { data, error } = await sb.functions.invoke('daily-report', { body: { force: true } });
      if (error) throw error;
      S.sendState = 'sent';
      S.sendMsg = data && data.sent ? 'Sent to ' + (CFG.reportEmail || 'the Production Manager') + '.' : (data && data.skipped) || 'Done.';
    } catch (e) { console.warn(e); S.sendState = 'error'; S.sendMsg = 'Sending failed: ' + (e.message || e) + '. Check the daily-report function in Supabase.'; }
    render();
  }
};

// ---------- views ----------
function vTop() {
  const any = S.orders.find(o => o.active);
  const o = cur(); const inOrder = o && ['stages','timer','finish'].includes(S.screen);
  const sync = {local:['Device only',''], saved:['Saved',''], saving:['Saving…',''], offline:['Offline · will sync','off']}[S.sync];
  return `<header class="top">
    <div class="top-l">
      <button class="home" data-a="home" aria-label="Home">${HOME_ICON}<span>Home</span></button>
      <img class="logo" src="assets/winget-logo.png" alt="Winget">
      <div class="divider"></div>
      <div class="ctx"><div class="ctx-l">${esc(inOrder ? o.customer : 'Shop floor')}</div><div class="ctx-v">${esc(inOrder ? 'WO ' + o.wo + ' · ' + o.machine : 'No works order open')}</div></div>
    </div>
    <div class="top-r">
      <span class="sync ${sync[1]}">${sync[0]}</span>
      ${any ? `<div class="runpill"><span class="dot"></span><span class="rp-l">WO ${esc(any.wo)} · Stage ${any.active.stage}</span><span class="rp-c">${clock(Date.now() - any.active.start)}</span></div>` : ''}
      <button class="me" data-a="signout" title="Sign out"><span class="av">${esc(initials(S.fitter))}</span><span>${esc(S.fitter)}</span></button>
    </div>
  </header>`;
}

function vCrumbs() {
  const o = cur();
  const back = (S.screen === 'timer' || S.screen === 'finish') ? 'Back to stages' : 'Back to works orders';
  const c = [{l:'Works orders', a:'board'}];
  if (S.screen === 'new') c.push({l:'New works order'});
  if (o && ['stages','timer','finish'].includes(S.screen)) c.push({l:'WO ' + o.wo, a:'stages'});
  if (S.screen === 'timer') { const s = stageOf(S.stage); c.push({l:'Stage ' + s.n + ' · ' + s.name}); }
  if (S.screen === 'finish') c.push({l:'Finish job'});
  return `<div class="crumbs">
    <button class="back" data-a="back">${BACK_ICON}<span>${back}</span></button>
    <nav class="trail" aria-label="Breadcrumb">${c.map((x, i) => {
      const last = i === c.length - 1;
      return `${i ? '<span class="sep">›</span>' : ''}<button class="crumb ${last ? 'here' : ''}" ${last ? 'aria-current="page"' : `data-a="${x.a}"`}>${esc(x.l)}</button>`;
    }).join('')}</nav>
  </div>`;
}

function vSignin() {
  return `<div class="signin"><div class="shape"></div><div class="inner">
    <img class="logo" src="assets/winget-logo.png" alt="Winget">
    <h1>Build Mate</h1>
    <p>Your build, logged as you go. Tap your name to get started.</p>
    <div class="fitters">${FITTERS.map(n => `<button class="fitter" data-a="signin" data-name="${esc(n)}"><span class="av">${initials(n)}</span><span>${esc(n)}</span></button>`).join('')}</div>
  </div></div>`;
}

function vBoard() {
  const rank = o => o.active ? 0 : o.done ? 2 : 1;
  const list = S.orders.slice().sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
  const today = new Date().toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
  return `<div class="scroll" data-scroll="board"><div class="pad">
    <div class="board-head">
      <div><div class="today">Today · ${today}</div><h2 class="h2">Works orders</h2></div>
      <div class="btns"><button class="pill pill-o" data-a="report">End of day report</button><button class="pill pill-y" data-a="new">+ New works order</button></div>
    </div>
    ${list.length ? `<div class="cards">${list.map(o => {
      const st = o.done ? ['Finished','st-done'] : o.active ? ['Running','st-run'] : ['In progress','st-prog'];
      const line = [o.customer, o.machine, 'Qty ' + o.qty + (o.qty > 1 ? ' · ' + (o.mode === 'batch' ? 'batch timer' : 'per unit') : '')].join('  ·  ');
      const nn = o.notes.length;
      return `<button class="card" data-a="open" data-id="${o.id}">
        <div style="min-width:0"><div class="card-t"><span class="wo">WO ${esc(o.wo)}</span><span class="status ${st[1]}">${st[0]}</span></div>
        <div class="meta">${esc(line)}</div><div class="bar"><i style="width:${o.complete.length * 10}%"></i></div></div>
        <div class="card-r"><div class="big-t">${hm(orderMs(o) / 6e4)}</div><div class="small">${o.complete.length} of 10 stages</div>${nn ? `<div class="tiny">${nn} note${nn > 1 ? 's' : ''}</div>` : ''}</div>
      </button>`;
    }).join('')}</div>` : `<div class="empty">Nothing open. Start a works order to begin timing.</div>`}
  </div></div>`;
}

function vNew() {
  const picks = quickPicks();
  const ok = S.wo && S.cust.trim() && S.machine;
  const keys = ['1','2','3','4','5','6','7','8','9','C','0','del'];
  return `<div class="scroll" data-scroll="new"><div class="pad">
    <h2 class="h2">New works order</h2>
    <div class="newgrid">
      <div>
        <div class="lbl">Works order number <em>· up to ${WO_MAX} digits</em></div>
        <div class="wodisp"><span>${esc(S.wo) || '—'}</span><small>${S.wo.length} / ${WO_MAX}</small></div>
        <div class="keys">${keys.map(k => `<button class="key" data-a="key" data-k="${k}" ${k === 'del' ? 'aria-label="Delete"' : ''}>${k === 'del' ? '⌫' : k}</button>`).join('')}</div>
      </div>
      <div>
        <div class="lbl">Customer</div>
        <input class="field" id="f-cust" data-f="cust" value="${esc(S.cust)}" placeholder="Customer name" autocomplete="off">
        ${picks.length ? `<div class="tiny" style="margin-top:10px">Most used</div><div class="chips">${picks.map(c => `<button class="chip" data-a="pickcust" data-name="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        <div class="lbl sec">Machine to build</div>
        <div class="machines">${MACHINES.map(m => `<button class="opt ${S.machine === m.name ? 'on' : ''}" data-a="machine" data-name="${esc(m.name)}"><span>${esc(m.name)}</span><small>${m.hasRef ? 'Ref times' : 'No ref yet'}</small></button>`).join('')}</div>
        <div class="qtyrow sec">
          <div><div class="lbl">Quantity</div><div class="stepper"><button class="step" data-a="qtydown" aria-label="Less">−</button><div class="qty">${S.qty}</div><button class="step" data-a="qtyup" aria-label="More">+</button></div></div>
          ${S.qty > 1 ? `<div><div class="lbl">How do you want to time it?</div><div class="modes">
            <button class="opt ${S.mode === 'batch' ? 'on' : ''}" data-a="mode" data-m="batch">One timer for the batch</button>
            <button class="opt ${S.mode === 'unit' ? 'on' : ''}" data-a="mode" data-m="unit">Separate timer per unit</button></div></div>` : ''}
        </div>
        <div class="lbl sec">Notes <em>· optional</em></div>
        <textarea class="field" id="f-newnote" data-f="newNote" rows="2" placeholder="Anything the next person should know about this job">${esc(S.newNote)}</textarea>
        <button class="pill pill-y go" data-a="create" ${ok ? '' : 'disabled'}>Open works order</button>
      </div>
    </div>
  </div></div>`;
}

function vStages(o) {
  const pu = perUnit(o); const uf = pu ? S.unit : null;
  const remaining = 10 - o.complete.length;
  const hint = o.done ? 'Finished ' + hhmm(o.finishedAt) + ' · included in tonight\u2019s report'
    : remaining ? remaining + ' stage' + (remaining > 1 ? 's' : '') + ' still to complete. Stages can be done in any order.' : 'All 10 stages complete.';
  const notes = o.notes.slice().reverse();
  return `<div class="ohead">
      <div><div class="lbl">${esc([o.customer, o.machine, 'Qty ' + o.qty].join('  ·  '))}</div><div class="otitle">WO ${esc(o.wo)}</div></div>
      <div style="display:flex;align-items:center;gap:16px">
        ${pu ? `<div class="units"><span class="lbl">Unit</span>${Array.from({length:o.qty}, (_, i) => i + 1).map(n => `<button class="unit ${S.unit === n ? 'on' : ''}" data-a="unit" data-n="${n}">${n}</button>`).join('')}</div>` : ''}
        <div style="text-align:right"><div class="big-t" style="font-size:20px">${hm(orderMs(o) / 6e4)}</div><div class="small">Logged</div></div>
      </div>
    </div>
    <div class="scroll" data-scroll="stages"><div class="pad" style="padding-top:16px">
      <div class="stagelist">${STAGES.map(s => {
        const done = o.complete.includes(s.n);
        const run = o.active && o.active.stage === s.n && (!pu || o.active.unit === S.unit);
        const t = loggedMs(o, s.n, uf);
        const chip = run ? ['Running','run'] : done ? ['Complete','done'] : t > 0 ? ['In progress','prog'] : ['Not started',''];
        return `<button class="srow ${run ? 'run' : ''} ${done ? 'done' : ''}" style="border-left-color:${s.colour}" data-a="stage" data-n="${s.n}">
          <span class="snum">${s.n}</span>
          <span style="min-width:0"><span class="sfn" style="color:${s.colour}">${s.fn}</span><span class="sname">${esc(s.name)}</span></span>
          <span class="stime"><b>${t > 0 ? hm(t / 6e4) : '—'}</b><small>${o.hasRef ? 'ref ' + hm(s.ref) : 'no ref'}</small></span>
          <span class="schip ${chip[1]}">${chip[0]}</span>
        </button>`;
      }).join('')}</div>
      <div class="notes">
        <div class="notes-h"><b>Works order notes</b><span>${o.notes.length ? o.notes.length + (o.notes.length > 1 ? ' notes' : ' note') : 'None yet'}</span></div>
        ${notes.map(n => `<div class="note"><p>${esc(n.text)}</p><small>${esc(n.fitter)} · ${new Date(n.at).toLocaleDateString('en-GB', {day:'numeric', month:'short'})} ${hhmm(n.at)}</small></div>`).join('')}
        <div class="addnote"><textarea class="field" id="f-note" data-f="noteDraft" rows="2" placeholder="Add a note — parts on order, handover, anything useful">${esc(S.noteDraft)}</textarea>
        <button class="pill ${S.noteDraft.trim() ? 'pill-y' : ''}" data-a="addnote" ${S.noteDraft.trim() ? '' : 'disabled'}>Add note</button></div>
      </div>
    </div></div>
    <div class="foot"><p>${hint}</p><button class="pill pill-d" data-a="tofinish" ${remaining || o.done ? 'disabled' : ''}>Works order complete</button></div>`;
}

function vTimer(o) {
  const s = stageOf(S.stage); const pu = perUnit(o); const uf = pu ? S.unit : null;
  const run = o.active && o.active.stage === s.n && (!pu || o.active.unit === S.unit);
  const done = o.complete.includes(s.n);
  const t = loggedMs(o, s.n, uf);
  const runs = o.runs.filter(r => r.stage === s.n && (!pu || r.unit === S.unit));
  const ref = o.hasRef ? 'Reference ' + hm(s.ref) + '  ·  logged so far ' + hm(t / 6e4) : 'No reference time for this model  ·  logged so far ' + hm(t / 6e4);
  return `<div class="timer">
    <div class="tmain">
      <div class="tfn" style="color:${s.colour}"><i style="background:${s.colour}"></i>Stage ${s.n} · ${s.fn}</div>
      <h2 class="tname">${esc(s.name)}</h2>
      <div class="tsub">${esc('WO ' + o.wo + '  ·  ' + o.machine + (pu ? '  ·  Unit ' + S.unit + ' of ' + o.qty : ''))}</div>
      <div class="panel ${run ? 'run' : ''}">
        <div class="pl"><div class="lbl">${run ? 'Running now' : t > 0 ? 'Logged on this stage' : 'Not started'}</div>
        <div class="clock">${run ? clock(Date.now() - o.active.start) : clock(t)}</div><div class="ref">${ref}</div></div>
        <button class="ss" data-a="toggle">${run ? 'Stop' : 'Start'}</button>
      </div>
      <button class="complete ${done ? 're' : ''}" data-a="complete">${done ? 'Reopen stage' : 'Mark stage complete'}</button>
    </div>
    <div class="tside">
      <div class="tasks"><div class="lbl">Key tasks</div>${s.tasks.map(x => `<div class="task">${esc(x)}</div>`).join('')}</div>
      <div class="runs"><div class="runs-h"><span class="lbl">Runs</span><span>${runs.length + (run ? 1 : 0)} run${runs.length + (run ? 1 : 0) === 1 ? '' : 's'}</span></div>
        ${runs.map(r => `<div class="run"><span><b>${hhmm(r.start)} → ${hhmm(r.stop)}</b><small>${esc(r.fitter)}</small></span><strong>${hm((r.stop - r.start) / 6e4)}</strong></div>`).join('')}
        ${run ? `<div class="run live"><span><b>${hhmm(o.active.start)} → running</b><small>${esc(o.active.fitter)}</small></span><strong>${hm((Date.now() - o.active.start) / 6e4)}</strong></div>` : ''}
        ${!runs.length && !run ? '<div class="muted">No time logged on this stage yet.</div>' : ''}
      </div>
    </div>
  </div>`;
}

function vFinish(o) {
  const total = orderMs(o) / 6e4;
  const budget = o.hasRef ? FIXED_BUDGET_100T : null;
  const refTotal = o.hasRef ? STAGES.reduce((a, s) => a + s.ref, 0) : null;
  const line = budget == null ? 'No reference times exist for this model yet — this build becomes the first recorded set.'
    : (total >= budget ? '+' : '−') + hm(Math.abs(total - budget)) + ' against the fixed budget of ' + hm(budget) + '.';
  return `<div class="pad" style="padding-bottom:12px;flex:none"><h2 class="h2" style="font-size:26px">Finish job · WO ${esc(o.wo)}</h2><div class="meta" style="margin-top:6px">${esc([o.customer, o.machine, 'Qty ' + o.qty].join('  ·  '))}</div></div>
    <div class="scroll" data-scroll="finish"><div style="padding:0 26px 20px">
      <div class="tbl h"><span>#</span><span>Process stage</span><span class="r">Reference</span><span class="r">Logged</span></div>
      ${STAGES.map(s => `<div class="tbl"><span class="n">${s.n}</span><span>${esc(s.name)}</span><span class="r" style="color:var(--g3)">${o.hasRef ? hm(s.ref) : '—'}</span><span class="r" style="font-weight:700">${hm(loggedMs(o, s.n, null) / 6e4)}</span></div>`).join('')}
      <div class="tbl t"><span></span><span style="font:900 12px/1 var(--font);letter-spacing:.08em;text-transform:uppercase">Works order total</span><span class="r" style="color:var(--g3)">${refTotal == null ? '—' : hm(refTotal)}</span><span class="r" style="font-weight:900;font-size:16px">${hm(total)}</span></div>
      <div class="var">${line}</div>
      ${o.notes.length ? `<div class="nbox"><b>Notes</b>${o.notes.map(n => `<div>${esc(n.text)} <span>— ${esc(n.fitter)}</span></div>`).join('')}</div>` : ''}
    </div></div>
    <div class="foot"><p>Finishing stops any running timer and adds this job to tonight\u2019s report.</p><button class="pill pill-y" data-a="finish">Finish job</button></div>`;
}

function vReport() {
  const now = Date.now();
  const touched = S.orders.filter(o => o.active || o.runs.some(r => sameDay(r.start, now)) || o.notes.some(n => sameDay(n.at, now)) || (o.finishedAt && sameDay(o.finishedAt, now)));
  const btn = {idle:'Send now', sending:'Sending…', sent:'Sent', error:'Try again'}[S.sendState];
  return `<div class="modal"><div class="sheet">
    <div class="sheet-h"><div class="lbl">End of day · ${new Date().toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'})}</div><h3>Build times report</h3>
      <div class="meta">Sent automatically each weekday evening as an Excel file to ${esc(CFG.reportEmail || 'the Production Manager')}. This is today\u2019s preview.</div></div>
    <div class="sheet-b">
      ${touched.length ? touched.map(o => {
        const rows = STAGES.filter(s => todayMs(o, s.n) > 0);
        const tot = todayMs(o, null) / 6e4;
        return `<div style="display:flex;gap:10px;align-items:baseline;margin-bottom:9px"><b style="font:900 15px/1 var(--font)">WO ${esc(o.wo)}</b><span class="meta" style="font-size:12px">${esc([o.customer, o.machine, 'Qty ' + o.qty].join(' · '))}</span></div>
          ${o.notes.length ? `<div class="nbox" style="margin:0 0 9px;padding:9px 12px;font-size:12px">Notes: ${esc(o.notes.map(n => n.text).join('  ·  '))}</div>` : ''}
          <div class="rtbl">${rows.map(s => { const m = todayMs(o, s.n) / 6e4; return `<div class="rrow"><span style="color:var(--g3)">${s.n}</span><span style="color:var(--ink)">${esc(s.name)}</span><span class="r">${hm(m)}</span><span class="r" style="color:var(--g3)">${(m / 60).toFixed(2)}</span></div>`; }).join('')}
          <div class="rrow t"><span></span><span>Today total</span><span class="r">${hm(tot)}</span><span class="r" style="color:var(--g4)">${(tot / 60).toFixed(2)}</span></div></div>`;
      }).join('') : '<div class="empty">No time logged today yet.</div>'}
      <div class="tiny" style="line-height:1.5">The spreadsheet also shows totals to date per stage, every start and stop, and hours by function and fitter.</div>
    </div>
    <div class="sheet-f"><button class="pill pill-o" data-a="closereport">Close</button>
      <span class="msg ${S.sendState === 'error' ? 'err' : ''}" style="flex:1;text-align:right">${esc(S.sendMsg)}</span>
      <button class="pill ${S.sendState === 'sent' ? 'pill-d' : 'pill-y'}" data-a="send" ${S.sendState === 'sending' ? 'disabled' : ''}>${btn}</button></div>
  </div></div>`;
}

function view() {
  if (S.screen === 'signin') return `<div class="app">${vSignin()}</div>`;
  const o = cur();
  if (['stages','timer','finish'].includes(S.screen) && !o) S.screen = 'board';
  let body = '';
  if (S.screen === 'board') body = vBoard();
  if (S.screen === 'new') body = vNew();
  if (S.screen === 'stages') body = vStages(o);
  if (S.screen === 'timer') body = vTimer(o);
  if (S.screen === 'finish') body = vFinish(o);
  return `<div class="app">${vTop()}${S.screen !== 'board' ? vCrumbs() : ''}<main class="main">${body}</main>${S.showReport ? vReport() : ''}</div>`;
}

// ---------- render (keeps typing focus and scroll position) ----------
const root = document.getElementById('app');
function render() {
  const ae = document.activeElement;
  const fid = ae && ae.id && ae.id.startsWith('f-') ? ae.id : null;
  const sel = fid ? [ae.selectionStart, ae.selectionEnd] : null;
  const scrolls = {}; root.querySelectorAll('[data-scroll]').forEach(el => { scrolls[el.dataset.scroll] = el.scrollTop; });
  root.innerHTML = view();
  root.querySelectorAll('[data-scroll]').forEach(el => { if (scrolls[el.dataset.scroll]) el.scrollTop = scrolls[el.dataset.scroll]; });
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
}

root.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const prevScreen = S.screen;
  const r = actions[b.dataset.a] && actions[b.dataset.a](b.dataset);
  if (r && r.then) return;
  if (S.screen !== prevScreen) root.querySelectorAll('[data-scroll]').forEach(el => { el.scrollTop = 0; });
  render();
});
root.addEventListener('input', e => { const f = e.target.dataset.f; if (f) { S[f] = e.target.value; render(); } });

setInterval(() => { if (S.orders.some(o => o.active)) render(); }, 1000);
setInterval(() => { flush().then(pull); }, 60000);

render();
flush().then(pull);
})();
