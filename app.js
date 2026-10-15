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
const FIXED_BUDGET_100T = 765; // 12h 45m
const QUICK_PICKS = 5;
const WO_MAX = 10;
const KEY = 'build-mate-live-v1';
const ACT_KEY = 'build-mate-live-activity';
const FITTERS_KEY = 'build-mate-fitters';
const IDLE_MS = 8 * 60 * 60 * 1000; // auto-lock after 8 hours with no taps

// ---------- helpers ----------
const CFG = window.BUILD_MATE_CONFIG || {};
const configured = CFG.supabaseUrl && CFG.supabaseAnonKey && !/PASTE/i.test(CFG.supabaseUrl + CFG.supabaseAnonKey);
const sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl.trim(), CFG.supabaseAnonKey.trim(), {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const initials = n => (n || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const hm = mins => { const m = Math.round(mins); return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const iso = ts => ts ? new Date(ts).toISOString() : null;
const ms = v => v ? new Date(v).getTime() : null;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const TZ = 'Europe/London';
function londonParts(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
  return p;
}
function ukCloseAt(startMs) {
  let t = Number(startMs) || Date.now();
  let p = londonParts(t);
  for (let i = 0; i < 4 && (p.weekday === 'Sat' || p.weekday === 'Sun'); i++) {
    t -= 864e5; p = londonParts(t);
  }
  const y = +p.year, m = +p.month, d = +p.day;
  let guess = Date.UTC(y, m - 1, d, 16, 0, 0);
  for (let i = 0; i < 6; i++) {
    const g = londonParts(guess);
    const got = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute);
    const next = guess + (Date.UTC(y, m - 1, d, 17, 0) - got);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}
function shopClosed(ms) {
  ms = ms == null ? Date.now() : ms;
  const p = londonParts(ms);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return true;
  return ms >= ukCloseAt(ms);
}
function applyCloseOfDay() {
  let n = 0;
  S.orders.forEach(o => {
    if (!o.active) return;
    if (Date.now() < ukCloseAt(woActiveStart(o.active))) return;
    stopActive(o); touch(o); n++;
  });
  return n;
}
const stageOf = n => STAGES.find(s => s.n === n);
const HOME_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>';
const BACK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// ---------- state ----------
const S = {
  screen:'signin', unlocked:false, handover:false, admin:false, menu:false, userId:null, fitter:null, picked:null, fitters:[], fittersError:'',
  teamList:[], teamId:null, teamName:'', teamEmail:'', teamPass:'', teamAdmin:false, teamMsg:'', teamErr:'', teamBusy:false, teamForm:false,
  adminTab:'users', intList:[], intForm:false, intId:null, intFrom:'', intTo:'', intSecret:'', intTestTo:'',
  woList:[], woFilter:'shop', woQ:'', woSel:{}, woConfirm:null, woSend:'idle',
  orders:[], activeId:null, stage:1, unit:1,
  wo:'', cust:'', machine:null, qty:1, mode:'batch', newNote:'', noteDraft:'',
  pass:'', unlockError:'', unlockBusy:false,
  showReport:false, sendState:'idle', sendMsg:'', sync: sb ? 'saving' : 'local'
};
let outbox = [];
(function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); S.orders = d.orders || []; outbox = d.outbox || []; } catch (e) {}
  try {
    S.fitters = (JSON.parse(localStorage.getItem(FITTERS_KEY) || '[]') || []).map(f => ({id:f.id, full_name:f.full_name}));
  } catch (e) { S.fitters = []; }
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({orders:S.orders, outbox})); } catch (e) {} };
const cur = () => S.orders.find(o => o.id === S.activeId) || null;

// ---------- sync with Supabase ----------
const orderRow = o => ({id:o.id, wo:o.wo, customer:o.customer, machine:o.machine, has_ref:o.hasRef, qty:o.qty, mode:o.mode,
  complete:o.complete, done:o.done, archived:!!o.archived, finished_at:iso(o.finishedAt), active:o.active, created_at:iso(o.createdAt), updated_at:new Date().toISOString()});
const runRow = (r, o) => ({id:r.id, order_id:o.id, stage:r.stage, unit:r.unit, fitter:r.fitter, started_at:iso(r.start), stopped_at:iso(r.stop)});
const noteRow = (n, o) => ({id:n.id, order_id:o.id, text:n.text, fitter:n.fitter, created_at:iso(n.at)});

function lastActivity() { try { return Number(localStorage.getItem(ACT_KEY) || 0); } catch (e) { return 0; } }
function touchActivity() { if (!S.unlocked) return; try { localStorage.setItem(ACT_KEY, String(Date.now())); } catch (e) {} }
function isIdle() { const t = lastActivity(); return !t || (Date.now() - t > IDLE_MS); }

function displayName(user) {
  if (!user) return '';
  const m = user.user_metadata || {};
  return m.full_name || m.name || (S.picked && S.picked.full_name) || '';
}

function goLocked() {
  S.unlocked = false; S.handover = false; S.admin = false; S.menu = false; S.userId = null; S.fitter = null; S.picked = null; S.screen = 'signin'; S.activeId = null;
  S.showReport = false; S.pass = ''; S.unlockBusy = false; S.unlockError = '';
  S.teamList = []; S.teamId = null; S.teamForm = false; S.teamName = ''; S.teamEmail = ''; S.teamPass = ''; S.teamAdmin = false; S.teamMsg = ''; S.teamErr = '';
  S.adminTab = 'users'; S.intList = []; S.intForm = false; S.intId = null; S.intFrom = ''; S.intTo = ''; S.intSecret = ''; S.intTestTo = '';
  S.woList = []; S.woFilter = 'shop'; S.woQ = ''; S.woSel = {}; S.woConfirm = null; S.woSend = 'idle';
}

async function loadAdminFlag(user) {
  S.admin = false; S.userId = user && user.id || null;
  if (!sb || !user) return;
  const { data, error } = await sb.from('fitters').select('admin, full_name').eq('id', user.id).maybeSingle();
  if (error) { console.warn(error); return; }
  if (data) {
    S.admin = !!data.admin;
    if (data.full_name) S.fitter = data.full_name;
  }
}

async function teamCall(body) {
  if (!sb || !S.admin) return;
  S.teamBusy = true; S.teamErr = ''; S.teamMsg = ''; render();
  try {
    const { data, error } = await sb.functions.invoke('manage-team', { body });
    S.teamBusy = false;
    const payload = data && typeof data === 'object' ? data : {};
    if (payload.error) { S.teamErr = payload.error; return render(); }
    if (error) {
      let detail = error.message || String(error);
      try {
        const ctx = error.context;
        if (ctx && typeof ctx.json === 'function') {
          const j = await ctx.json();
          if (j && j.error) detail = j.error;
        }
      } catch { /* keep message */ }
      throw new Error(detail);
    }
    if (payload.fitters) S.teamList = payload.fitters;
    if (payload.integrations) S.intList = payload.integrations;
    if (payload.orders) {
      S.woList = payload.orders;
      if (body.action === 'order_delete' || body.action === 'order_archive') {
        const gone = body.id;
        delete S.woSel[gone];
        S.woConfirm = null;
        S.orders = S.orders.filter(o => o.id !== gone);
        if (S.activeId === gone) { S.activeId = null; }
        save();
      }
      if (body.action === 'order_restore' || body.action === 'order_archive' || body.action === 'order_delete') await pull();
    }
    if (payload.message) S.teamMsg = payload.message;
    if (body.action === 'create' || body.action === 'update') Object.assign(S, { teamForm:false, teamId:null, teamName:'', teamEmail:'', teamPass:'', teamAdmin:false });
    if (body.action === 'password') { S.teamPass = ''; S.teamMsg = S.teamMsg || 'Passphrase updated.'; }
    if (body.action === 'integrations_save') Object.assign(S, { intForm:false, intSecret:'' });
    const act = String(body.action || '');
    if (!act.startsWith('integrations') && !act.startsWith('order')) await loadFitters();
  } catch (e) {
    S.teamBusy = false;
    S.teamErr = (e && e.message) || String(e);
  }
  render();
}

async function loadFitters() {
  if (!sb) { S.fittersError = 'Add your Supabase keys to config.js first.'; return; }
  const { data, error } = await sb.from('fitter_directory').select('id, full_name').order('full_name');
  if (error) {
    S.fittersError = S.fitters.length ? '' : 'Could not load the team list. Check Wi-Fi, then add people in Supabase → Authentication → Users.';
    console.warn(error);
    return;
  }
  S.fitters = data || [];
  S.fittersError = '';
  try { localStorage.setItem(FITTERS_KEY, JSON.stringify(S.fitters)); } catch (e) {}
}

async function lockShop() {
  applyCloseOfDay();
  const wait = Date.now();
  while (flushing && Date.now() - wait < 8000) await new Promise(r => setTimeout(r, 30));
  await flush();
  goLocked();
  if (sb) { try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {} }
  render();
}

async function checkIdle() {
  if (!S.unlocked && !S.handover) return;
  if (isIdle()) await lockShop();
}

function queue(table, row) {
  if (table === 'orders') outbox = outbox.filter(x => !(x.t === 'orders' && x.row.id === row.id));
  outbox.push({t:table, row});
  save(); flush();
}
function setSync(v) { if (S.sync !== v) { S.sync = v; render(); } }

let flushing = false;
async function flush() {
  if (!sb) return setSync('local');
  if (!S.unlocked && !S.handover) return;
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
  if (!sb || (!S.unlocked && !S.handover) || outbox.length || !navigator.onLine || flushing) return;
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const o = await sb.from('orders').select('*').eq('archived', false).or('done.eq.false,updated_at.gte."' + since + '"');
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
    complete:x.complete || [], done:x.done, archived:!!x.archived, finishedAt:ms(x.finished_at), active:x.active, createdAt:ms(x.created_at),
    runs: runs.filter(r => r.order_id === x.id).map(r => ({id:r.id, stage:r.stage, unit:r.unit, fitter:r.fitter, start:ms(r.started_at), stop:ms(r.stopped_at)})),
    notes: notes.filter(n => n.order_id === x.id).map(n => ({id:n.id, text:n.text, fitter:n.fitter, at:ms(n.created_at)})).sort((a, b) => a.at - b.at)
  })).sort((a, b) => a.createdAt - b.createdAt);
  applyCloseOfDay();
  save(); S.sync = 'saved'; render();
}

window.addEventListener('online', () => { loadFitters().then(() => { if (!S.unlocked) render(); flush().then(pull); }); });
window.addEventListener('offline', () => setSync('offline'));

// ---------- maths ----------
function loggedMs(o, n, unit) {
  let t = o.runs.filter(r => r.stage === n && (unit == null || r.unit === unit)).reduce((a, r) => a + (r.stop - r.start), 0);
  if (o.active && o.active.stage === n && (unit == null || o.active.unit === unit)) t += Date.now() - o.active.start;
  return t;
}
function orderMs(o) { let t = o.runs.reduce((a, r) => a + (r.stop - r.start), 0); if (o.active) t += Date.now() - o.active.start; return t; }
function mineLive() {
  const me = String(S.fitter || '').trim().toLowerCase();
  if (!me) return null;
  return S.orders.find(o => o.active && String(o.active.fitter || '').trim().toLowerCase() === me) || null;
}
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
  const start = woActiveStart(o.active);
  const close = ukCloseAt(start);
  let stop = Date.now();
  if (stop > close) stop = close;
  const r = {id:uid('r'), stage:o.active.stage, unit:o.active.unit, fitter:o.active.fitter, start, stop};
  o.active = null;
  if (!start || stop <= start) return;
  o.runs.push(r); queue('runs', runRow(r, o));
}
function quickPicks() {
  const t = {};
  S.orders.forEach(o => { const k = (o.customer || '').trim(); if (!k) return; const x = t[k] || (t[k] = {name:k, n:0, last:0}); x.n++; x.last = Math.max(x.last, o.createdAt || 0); });
  return Object.values(t).sort((a, b) => b.n - a.n || b.last - a.last).slice(0, QUICK_PICKS).map(x => x.name);
}

const actions = {
  pick: d => {
    const f = S.fitters.find(x => x.id === d.id);
    if (!f) return;
    S.picked = f; S.pass = ''; S.unlockError = '';
    if (S.handover && S.userId === f.id && !isIdle()) {
      S.handover = false; S.unlocked = true; S.screen = 'board'; S.fitter = f.full_name || S.fitter;
      touchActivity();
      flush().then(pull);
      return;
    }
    if (S.userId && f.id !== S.userId && sb) {
      return (async () => {
        try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
        S.handover = false; S.unlocked = false; S.admin = false; S.userId = null; S.fitter = null;
        S.picked = f; S.screen = 'unlock';
        render();
      })();
    }
    S.screen = 'unlock';
  },
  cancelunlock: () => { S.picked = null; S.pass = ''; S.unlockError = ''; S.screen = 'signin'; },
  unlock: async () => {
    S.unlockError = '';
    const pickedId = S.picked && S.picked.id;
    const box = document.getElementById('f-pass');
    const pass = ((box && box.value) || S.pass || '').trim();
    S.pass = pass;
    if (!sb) { S.unlockError = 'Add your Supabase keys to config.js first.'; return render(); }
    if (!pickedId) { S.unlockError = 'Pick your name first.'; S.screen = 'signin'; return render(); }
    if (!pass) { S.unlockError = 'Enter your passphrase.'; return render(); }
    if (!navigator.onLine) { S.unlockError = 'This tablet needs Wi-Fi to sign in.'; return render(); }
    S.unlockBusy = true; render();
    const lookedUp = await sb.rpc('fitter_email_for_login', { p_id: pickedId });
    const email = lookedUp.data;
    if (lookedUp.error || !email) {
      S.unlockBusy = false;
      S.unlockError = 'Could not match that name. Back to the list and try again.';
      return render();
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    S.unlockBusy = false;
    if (error) {
      S.unlockError = 'That passphrase did not match. Try again.';
      return render();
    }
    S.pass = ''; S.unlockError = ''; S.unlocked = true; S.handover = false;
    S.fitter = displayName(data && data.user) || (S.picked && S.picked.full_name);
    await loadAdminFlag(data && data.user);
    S.screen = 'board';
    touchActivity();
    render();
    flush().then(pull);
  },
  home: () => {
    applyCloseOfDay();
    S.handover = true; S.unlocked = false; S.menu = false; S.showReport = false;
    S.screen = 'signin'; S.picked = null; S.activeId = null;
  },
  signout: () => { lockShop(); },
  togglemenu: () => { if (!S.admin) return actions.signout(); S.menu = !S.menu; },
  admin: () => {
    if (!S.admin) return;
    S.menu = false; S.screen = 'admin'; S.adminTab = 'users'; S.teamForm = false; S.teamId = null; S.teamErr = ''; S.teamMsg = '';
    S.intForm = false; S.intSecret = '';
    return teamCall({ action: 'list' });
  },
  admintab: d => {
    if (!S.admin) return;
    S.adminTab = d.tab || 'users'; S.teamForm = false; S.intForm = false; S.teamErr = ''; S.teamMsg = ''; S.woConfirm = null; S.woSend = 'idle';
    if (S.adminTab === 'settings') return teamCall({ action: 'integrations_list' });
    if (S.adminTab === 'users') return teamCall({ action: 'list' });
    if (S.adminTab === 'orders') return teamCall({ action: 'orders_list' });
  },
  intedit: d => {
    const row = S.intList.find(x => x.id === d.id); if (!row) return;
    const cfg = row.config || {};
    Object.assign(S, { intForm:true, intId:row.id, intFrom:cfg.from || '', intTo:cfg.to || '', intSecret:'', intTestTo:cfg.to || '', teamErr:'', teamMsg:'' });
  },
  intcancel: () => Object.assign(S, { intForm:false, intId:null, intFrom:'', intTo:'', intSecret:'', intTestTo:'' }),
  intsave: () => {
    if (S.teamBusy || !S.intId) return;
    return teamCall({ action:'integrations_save', id:S.intId, secret:S.intSecret, config:{ from:S.intFrom, to:S.intTo } });
  },
  wofilter: d => { S.woFilter = d.f || 'shop'; S.woConfirm = null; },
  wotoggle: d => {
    if (!d.id) return;
    if (S.woSel[d.id]) delete S.woSel[d.id]; else S.woSel[d.id] = true;
  },
  woselall: () => {
    const rows = woVisible();
    const allOn = rows.length && rows.every(r => S.woSel[r.id]);
    if (allOn) rows.forEach(r => delete S.woSel[r.id]);
    else rows.forEach(r => { S.woSel[r.id] = true; });
  },
  woarchive: d => { if (S.teamBusy) return; S.woConfirm = null; return teamCall({ action: 'order_archive', id: d.id }); },
  worestore: d => { if (S.teamBusy) return; S.woConfirm = null; return teamCall({ action: 'order_restore', id: d.id }); },
  wodelete: d => {
    if (S.teamBusy || !d.id) return;
    if (S.woConfirm !== d.id) { S.woConfirm = d.id; S.teamErr = ''; S.teamMsg = ''; return; }
    S.woConfirm = null;
    return teamCall({ action: 'order_delete', id: d.id });
  },
  wocanceldel: () => { S.woConfirm = null; },
  wototal: async () => {
    const ids = Object.keys(S.woSel).filter(id => S.woSel[id]);
    if (!ids.length) { S.teamErr = 'Tick one or more works orders, then Email total report.'; S.teamMsg = ''; return render(); }
    if (!S.admin || !sb) return;
    S.teamBusy = true; S.woSend = 'sending'; S.teamErr = ''; S.teamMsg = 'Building the spreadsheet and sending…'; render();
    try {
      const { data, error } = await sb.functions.invoke('daily-report', { body: { force: true, ids } });
      S.teamBusy = false; S.woSend = 'idle';
      const payload = data && typeof data === 'object' ? data : {};
      if (payload.error) { S.teamErr = payload.error; S.teamMsg = ''; return render(); }
      if (error) {
        let detail = error.message || String(error);
        try {
          const ctx = error.context;
          if (ctx && typeof ctx.json === 'function') {
            const j = await ctx.json();
            if (j && j.error) detail = j.error;
          }
        } catch { /* keep */ }
        S.teamErr = detail; S.teamMsg = ''; return render();
      }
      S.teamMsg = payload.sent ? 'Total report sent to ' + (payload.to || CFG.reportEmail) + '.' : payload.skipped || 'Done.';
    } catch (e) {
      S.teamBusy = false; S.woSend = 'idle';
      S.teamErr = (e && e.message) || String(e); S.teamMsg = '';
    }
    render();
  },
  inttest: () => {
    if (S.teamBusy || !S.intId) return;
    const to = (S.intTestTo || '').trim();
    if (!to || to.indexOf('@') < 0) { S.teamErr = 'Enter a test email address.'; S.teamMsg = ''; return render(); }
    return teamCall({ action:'integrations_test', id:S.intId, secret:S.intSecret, from:S.intFrom, test_to:to });
  },
  teamnew: () => Object.assign(S, { teamForm:true, teamId:null, teamName:'', teamEmail:'', teamPass:'', teamAdmin:false, teamErr:'', teamMsg:'' }),
  teamcancel: () => Object.assign(S, { teamForm:false, teamId:null, teamName:'', teamEmail:'', teamPass:'', teamAdmin:false, teamErr:'', teamMsg:'' }),
  teamedit: d => {
    const f = S.teamList.find(x => x.id === d.id); if (!f) return;
    Object.assign(S, { teamForm:true, teamId:f.id, teamName:f.full_name, teamEmail:f.email, teamPass:'', teamAdmin:!!f.admin, teamErr:'', teamMsg:'' });
  },
  teamadmin: () => { S.teamAdmin = !S.teamAdmin; },
  teamsave: () => {
    if (S.teamBusy) return;
    if (S.teamId) return teamCall({ action:'update', id:S.teamId, full_name:S.teamName, admin:S.teamAdmin });
    return teamCall({ action:'create', full_name:S.teamName, email:S.teamEmail, password:S.teamPass, admin:S.teamAdmin });
  },
  teampass: () => { if (S.teamBusy || !S.teamId) return; return teamCall({ action:'password', id:S.teamId, password:S.teamPass }); },
  teamarchive: d => { if (S.teamBusy) return; return teamCall({ action:'archive', id:d.id }); },
  teamrestore: d => { if (S.teamBusy) return; return teamCall({ action:'restore', id:d.id }); },
  teamtoggleadmin: d => {
    const f = S.teamList.find(x => x.id === d.id); if (!f || S.teamBusy) return;
    return teamCall({ action:'update', id:f.id, full_name:f.full_name, admin:!f.admin });
  },
  board: () => { S.menu = false; S.screen = 'board'; },
  stages: () => { S.screen = 'stages'; },
  back: () => { S.screen = (S.screen === 'admin' || S.screen === 'team') ? 'board' : (S.screen === 'timer' || S.screen === 'finish') ? 'stages' : 'board'; },
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
      complete:[], done:false, archived:false, finishedAt:null, active:null, createdAt:Date.now(), runs:[], notes:[]};
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
    if (!running && !shopClosed()) o.active = {stage:S.stage, unit:perUnit(o) ? S.unit : 1, fitter:S.fitter, start:Date.now()};
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
    if (!S.admin) { S.sendState = 'error'; S.sendMsg = 'Only an admin can send the report.'; return render(); }
    if (!sb) { S.sendState = 'error'; S.sendMsg = 'Not connected to Supabase yet — add your keys to config.js.'; return; }
    S.sendState = 'sending'; S.sendMsg = 'Saving latest times…'; render();
    await flush();
    if (outbox.length) { S.sendState = 'error'; S.sendMsg = 'Couldn\u2019t reach the server. Check Wi-Fi and try again.'; return render(); }
    S.sendMsg = 'Building the spreadsheet and sending…'; render();
    try {
      const { data, error } = await sb.functions.invoke('daily-report', { body: { force: true } });
      const payload = data && typeof data === 'object' ? data : {};
      if (payload.error) { S.sendState = 'error'; S.sendMsg = payload.error; return render(); }
      if (error) {
        let detail = error.message || String(error);
        try {
          const ctx = error.context;
          if (ctx && typeof ctx.json === 'function') {
            const j = await ctx.json();
            if (j && j.error) detail = j.error;
          }
        } catch { /* keep message */ }
        S.sendState = 'error'; S.sendMsg = detail; return render();
      }
      S.sendState = 'sent';
      S.sendMsg = payload.sent ? 'Sent to ' + (payload.to || CFG.reportEmail || 'the Production Manager') + '.' : payload.skipped || 'Done.';
    } catch (e) { console.warn(e); S.sendState = 'error'; S.sendMsg = 'Sending failed: ' + (e.message || e); }
    render();
  }
};

// ---------- views ----------
function vTop() {
  const live = mineLive();
  const o = cur();
  const inOrder = o && ['stages','timer','finish'].includes(S.screen);
  const stg = live && live.active ? stageOf(live.active.stage) : null;
  const stageLine = live && live.active ? 'Stage ' + live.active.stage + (stg ? ' · ' + stg.name : '') : '';
  const sync = {local:['Device only',''], saved:['Saved',''], saving:['Saving…',''], offline:['Offline · will sync','off']}[S.sync];
  let pill;
  if (live) {
    pill = `<button class="runpill" data-a="open" data-id="${esc(live.id)}" title="Open this works order">
      <span class="dot"></span>
      <span class="rp-txt"><span class="rp-k">Live job</span><span class="rp-l">WO ${esc(live.wo)}${live.machine ? ' · ' + esc(live.machine) : ''}</span><span class="rp-s">${esc(stageLine)}</span></span>
      <span class="rp-time"><span class="rp-c">${hm(orderMs(live) / 6e4)}</span><span class="rp-k">Total WO time</span></span>
    </button>`;
  } else if (inOrder) {
    pill = `<button class="runpill idle" data-a="open" data-id="${esc(o.id)}" title="Open this works order">
      <span class="dot"></span>
      <span class="rp-txt"><span class="rp-k">Start a task</span><span class="rp-l">WO ${esc(o.wo)}${o.machine ? ' · ' + esc(o.machine) : ''}</span><span class="rp-s">No Tasks are running</span></span>
      <span class="rp-time"><span class="rp-c">${hm(orderMs(o) / 6e4)}</span><span class="rp-k">Total WO time</span></span>
    </button>`;
  } else {
    pill = `<button class="runpill idle" data-a="board" title="Open the works order list">
      <span class="dot"></span>
      <span class="rp-txt"><span class="rp-k">No timer running</span><span class="rp-l">Open a works order</span></span>
    </button>`;
  }
  return `<header class="top">
    <div class="top-l">
      <button class="home" data-a="home" aria-label="Home">${HOME_ICON}<span>Home</span></button>
      <img class="logo" src="assets/winget-logo.png" alt="Winget">
    </div>
    ${pill}
    <div class="top-r">
      <span class="sync ${sync[1]}">${sync[0]}</span>
      <div class="me-wrap">
        <button class="me" data-a="togglemenu" title="${S.admin ? 'Account' : 'Sign out'}"><span class="av">${esc(initials(S.fitter))}</span><span>${esc(S.fitter)}</span>${S.admin ? '<span class="admin-chip">Admin</span>' : ''}</button>
        ${S.admin && S.menu ? `<div class="me-menu">
          <button data-a="admin">Admin</button>
          <button data-a="signout">Sign out</button>
        </div>` : ''}
      </div>
    </div>
  </header>`;
}

function vCrumbs() {
  const o = cur();
  const back = (S.screen === 'timer' || S.screen === 'finish') ? 'Back to stages' : 'Back to works orders';
  const c = [{l:'Works orders', a:'board'}];
  if (S.screen === 'new') c.push({l:'New works order'});
  if (S.screen === 'admin') c.push({l:'Admin'});
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

function vUnlock() {
  const who = S.picked ? S.picked.full_name : 'your account';
  return `<div class="signin"><div class="shape"></div><div class="inner">
    <img class="logo" src="assets/winget-logo.png" alt="Winget">
    <h1>Build Mate</h1>
    <p>Hi ${esc(who)}. Enter your passphrase to continue.</p>
    <form class="unlock">
      <label class="lbl" for="f-pass">Passphrase</label>
      <input class="field pass" id="f-pass" data-f="pass" type="password" value="${esc(S.pass)}" placeholder="Passphrase" autocomplete="current-password" ${S.unlockBusy ? 'disabled' : ''}>
      ${S.unlockError ? `<div class="unlock-err">${esc(S.unlockError)}</div>` : ''}
      <button class="pill pill-y go" type="submit" ${S.unlockBusy ? 'disabled' : ''}>${S.unlockBusy ? 'Checking…' : 'Unlock'}</button>
    </form>
    <button class="lock-link" type="button" data-a="cancelunlock">Back to names</button>
  </div></div>`;
}

function vSignin() {
  const list = S.fitters.length
    ? `<div class="fitters">${S.fitters.map(f => `<button class="fitter" data-a="pick" data-id="${esc(f.id)}"><span class="av">${esc(initials(f.full_name))}</span><span>${esc(f.full_name)}</span></button>`).join('')}</div>`
    : `<div class="fitters-empty">${esc(S.fittersError || 'No fitters yet. Add people in Supabase → Authentication → Users.')}</div>`;
  return `<div class="signin"><div class="shape"></div><div class="inner">
    <img class="logo" src="assets/winget-logo.png" alt="Winget">
    <h1>Build Mate</h1>
    <p>Your build, logged as you go. Tap your name, then enter your passphrase.</p>
    ${list}
  </div></div>`;
}

function vAdmin() {
  if (!S.admin) return '<div class="pad"><div class="empty">You need admin permission to open this page.</div></div>';
  const tab = S.adminTab || 'users';
  const tabs = `<div class="admin-tabs" role="tablist">
      <button class="atab users ${tab === 'users' ? 'on' : ''}" data-a="admintab" data-tab="users" role="tab" aria-selected="${tab === 'users'}">Users</button>
      <button class="atab settings ${tab === 'settings' ? 'on' : ''}" data-a="admintab" data-tab="settings" role="tab" aria-selected="${tab === 'settings'}">Settings</button>
      <button class="atab later ${tab === 'orders' ? 'on' : ''}" data-a="admintab" data-tab="orders" role="tab" aria-selected="${tab === 'orders'}">Works orders</button>
    </div>`;
  if (tab === 'settings') return vAdminSettings(tabs);
  if (tab === 'orders') return vAdminOrders(tabs);
  const editing = !!S.teamId;
  const rows = S.teamList.slice().sort((a, b) => Number(b.active) - Number(a.active) || String(a.full_name).localeCompare(String(b.full_name)));
  return `<div class="scroll" data-scroll="admin"><div class="pad">
    ${tabs}
    <div class="board-head">
      <div><h2 class="h2">Users</h2><div class="meta" style="margin-top:8px">People who can sign in to Build Mate. Archived people stay in this table but not on the shop sign-in screen.</div></div>
      <button class="pill pill-y" data-a="teamnew">+ Add person</button>
    </div>
    ${S.teamForm ? `<div class="admin-form">
      <div class="lbl">${editing ? 'Edit person' : 'New person'}</div>
      <div class="admin-fields">
        <input class="field" id="f-teamname" data-f="teamName" value="${esc(S.teamName)}" placeholder="Full name" autocomplete="off">
        <input class="field" id="f-teamemail" data-f="teamEmail" value="${esc(S.teamEmail)}" placeholder="Email" autocomplete="off" ${editing ? 'disabled' : ''}>
        <input class="field" id="f-teampass" data-f="teamPass" type="password" value="${esc(S.teamPass)}" placeholder="${editing ? 'New passphrase (optional)' : 'Passphrase (min 8 characters)'}" autocomplete="new-password">
        <button class="opt ${S.teamAdmin ? 'on' : ''}" data-a="teamadmin" ${editing && S.teamId === S.userId ? 'disabled' : ''}><span>Admin</span><small>${S.teamAdmin ? 'Can open Admin' : 'Shop floor only'}</small></button>
      </div>
      <div class="btns" style="margin-top:14px">
        <button class="pill pill-y" data-a="teamsave" ${S.teamBusy ? 'disabled' : ''}>${editing ? 'Save' : 'Add person'}</button>
        ${editing ? `<button class="pill pill-o" data-a="teampass" ${S.teamBusy ? 'disabled' : ''}>Reset passphrase</button>` : ''}
        <button class="pill pill-o" data-a="teamcancel">Cancel</button>
      </div>
    </div>` : ''}
    ${S.teamErr ? `<div class="unlock-err" style="margin:0 0 14px">${esc(S.teamErr)}</div>` : ''}
    ${S.teamMsg ? `<div class="meta" style="margin:0 0 14px;color:var(--green)">${esc(S.teamMsg)}</div>` : ''}
    ${rows.length ? `<div class="atbl">
      <div class="atbl-h"><span>Name</span><span>Email</span><span>Status</span><span>Admin</span><span>Actions</span></div>
      ${rows.map(f => {
        const self = f.id === S.userId;
        return `<div class="atbl-r ${f.active ? '' : 'off'}">
          <span><b>${esc(f.full_name)}</b></span>
          <span>${esc(f.email)}</span>
          <span>${f.active ? 'Active' : 'Archived'}</span>
          <span>${f.admin ? 'Yes' : 'No'}</span>
          <span class="atbl-a">
            <button class="pill pill-o atbl-b" data-a="teamedit" data-id="${esc(f.id)}">Edit</button>
            ${f.active
              ? `<button class="pill pill-o atbl-b" data-a="teamarchive" data-id="${esc(f.id)}" ${self || S.teamBusy ? 'disabled' : ''}>Archive</button>`
              : `<button class="pill pill-o atbl-b" data-a="teamrestore" data-id="${esc(f.id)}" ${S.teamBusy ? 'disabled' : ''}>Restore</button>`}
            <button class="pill pill-o atbl-b" data-a="teamtoggleadmin" data-id="${esc(f.id)}" ${self || S.teamBusy ? 'disabled' : ''}>${f.admin ? 'Remove admin' : 'Make admin'}</button>
          </span>
        </div>`;
      }).join('')}
    </div>` : `<div class="empty">${S.teamBusy ? 'Loading…' : 'No people yet. Add the first person.'}</div>`}
  </div></div>`;
}

function vAdminSettings(tabs) {
  const rows = S.intList || [];
  return `<div class="scroll" data-scroll="admin"><div class="pad">
    ${tabs}
    <div class="board-head">
      <div><h2 class="h2">Settings</h2><div class="meta" style="margin-top:8px">Shared integrations for every tablet. The API key is stored in the database and is never shown again after save.</div></div>
    </div>
    ${S.intForm ? `<div class="admin-form">
      <div class="lbl">Resend email</div>
      <div class="admin-fields">
        <input class="field" id="f-intfrom" data-f="intFrom" value="${esc(S.intFrom)}" placeholder="From (e.g. Build Mate &lt;onboarding@resend.dev&gt;)" autocomplete="off">
        <input class="field" id="f-intto" data-f="intTo" value="${esc(S.intTo)}" placeholder="To (report inbox)" autocomplete="off">
        <input class="field" id="f-intsecret" data-f="intSecret" type="password" value="${esc(S.intSecret)}" placeholder="API key (leave blank to keep the current key)" autocomplete="off" style="grid-column:1/-1">
      </div>
      <div class="btns" style="margin-top:14px">
        <button class="pill pill-y" data-a="intsave" ${S.teamBusy ? 'disabled' : ''}>Save</button>
        <button class="pill pill-o" data-a="intcancel">Cancel</button>
      </div>
      <div class="admin-test">
        <div class="lbl">Send a test email</div>
        <input class="field" id="f-inttestto" data-f="intTestTo" value="${esc(S.intTestTo)}" placeholder="Test email address" autocomplete="off" style="margin-top:8px">
        <div class="admin-test-preview">
          <div><b>Subject:</b> Build Mate — Resend test</div>
          <div><b>Body:</b> This is a test from Build Mate Admin → Settings. If you received this, the Resend API key is working.</div>
        </div>
        <div class="btns" style="margin-top:12px">
          <button class="pill pill-o" data-a="inttest" ${S.teamBusy ? 'disabled' : ''}>${S.teamBusy ? 'Testing…' : 'Send test'}</button>
        </div>
      </div>
    </div>` : ''}
    ${S.teamErr ? `<div class="unlock-err" style="margin:0 0 14px;white-space:pre-wrap">${esc(S.teamErr)}</div>` : ''}
    ${S.teamMsg ? `<div class="meta" style="margin:0 0 14px;color:var(--green)">${esc(S.teamMsg)}</div>` : ''}
    ${rows.length ? `<div class="atbl int">
      <div class="atbl-h"><span>Integration</span><span>Status</span><span>From</span><span>To</span><span>Actions</span></div>
      ${rows.map(r => {
        const cfg = r.config || {};
        const status = r.has_secret ? ('Connected' + (r.secret_hint ? ' · ••••' + esc(r.secret_hint) : '')) : 'Not connected';
        return `<div class="atbl-r">
          <span><b>${esc(r.label || r.id)}</b></span>
          <span>${status}</span>
          <span>${esc(cfg.from || '—')}</span>
          <span>${esc(cfg.to || '—')}</span>
          <span class="atbl-a"><button class="pill pill-o atbl-b" data-a="intedit" data-id="${esc(r.id)}">Edit</button></span>
        </div>`;
      }).join('')}
    </div>` : `<div class="empty">${S.teamBusy ? 'Loading…' : 'No integrations yet.'}</div>`}
  </div></div>`;
}

function woActiveStart(a) {
  if (!a || a.start == null) return 0;
  return typeof a.start === 'number' ? a.start : new Date(a.start).getTime();
}
function woLoggedMs(r) {
  const local = S.orders.find(o => o.id === r.id);
  if (local) return orderMs(local);
  let t = Number(r.logged_ms) || 0;
  if (r.active) { const s = woActiveStart(r.active); if (s) t += Date.now() - s; }
  return t;
}
function woStages(r) {
  const local = S.orders.find(o => o.id === r.id);
  const c = (local && local.complete) || r.complete || [];
  return Array.isArray(c) ? c.length : 0;
}
function woLiveJobs() {
  const seen = {};
  const out = [];
  (S.woList || []).forEach(r => {
    const local = S.orders.find(o => o.id === r.id);
    const active = (local && local.active) || r.active;
    if (!active) return;
    seen[r.id] = true;
    out.push(Object.assign({}, r, { active, complete: (local && local.complete) || r.complete }));
  });
  S.orders.forEach(o => {
    if (!o.active || o.archived || seen[o.id]) return;
    out.push({ id:o.id, wo:o.wo, customer:o.customer, machine:o.machine, qty:o.qty, active:o.active, complete:o.complete, logged_ms:0 });
  });
  return out;
}

function woVisible() {
  const q = (S.woQ || '').trim().toLowerCase();
  const archived = S.woFilter === 'archived';
  return (S.woList || []).filter(r => {
    if (!!r.archived !== archived) return false;
    if (!q) return true;
    return [r.wo, r.customer, r.machine].join(' ').toLowerCase().indexOf(q) >= 0;
  });
}

function vAdminOrders(tabs) {
  const rows = woVisible();
  const live = woLiveJobs();
  const nSel = Object.keys(S.woSel).filter(id => S.woSel[id]).length;
  const selRows = (S.woList || []).filter(r => S.woSel[r.id]);
  const selMs = selRows.reduce((a, r) => a + woLoggedMs(r), 0);
  const allOn = rows.length && rows.every(r => S.woSel[r.id]);
  return `<div class="scroll" data-scroll="admin"><div class="pad">
    ${tabs}
    <div class="board-head">
      <div>
        <h2 class="h2">Works orders</h2>
        <div class="meta" style="margin-top:8px">Archive hides a job from the shop list. Delete removes it and its times. Tick rows to email a to-date total report.</div>
      </div>
      <div class="btns">
        <button class="pill pill-y" data-a="wototal" ${S.teamBusy || S.woSend === 'sending' ? 'disabled' : ''}>${S.woSend === 'sending' ? 'Sending…' : 'Email total report' + (nSel ? ' (' + nSel + ')' : '')}</button>
      </div>
    </div>
    <div class="live-now">
      <div class="lbl">Live now</div>
      ${live.length ? `<div class="live-cards">${live.map(r => {
        const stg = stageOf(r.active.stage);
        const done = woStages(r);
        const pct = Math.round(done * 10);
        return `<div class="live-card">
          <div class="live-top"><span class="wo">WO ${esc(r.wo)}</span><span class="status st-run">Running</span></div>
          <div class="meta">${esc(r.customer || '—')} · ${esc(r.machine || '—')}</div>
          <div class="live-who">On now: ${esc(r.active.fitter || '—')} · Stage ${r.active.stage}${stg ? ' · ' + esc(stg.name) : ''}</div>
          <div class="live-time-lbl">Total WO time</div>
          <div class="live-time">${hm(woLoggedMs(r) / 6e4)}</div>
          <div class="small">${pct}% complete · ${done} of 10 stages</div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>`;
      }).join('')}</div>` : `<div class="live-empty">No timers running.</div>`}
    </div>
    ${nSel ? `<div class="meta" style="margin:0 0 12px">Selected: ${nSel} job${nSel === 1 ? '' : 's'} · ${hm(selMs / 6e4)}</div>` : ''}
    <div class="btns" style="margin-bottom:14px">
      <button class="opt ${S.woFilter === 'shop' ? 'on' : ''}" data-a="wofilter" data-f="shop"><span>On shop</span></button>
      <button class="opt ${S.woFilter === 'archived' ? 'on' : ''}" data-a="wofilter" data-f="archived"><span>Archived</span></button>
    </div>
    <input class="field" id="f-woq" data-f="woQ" value="${esc(S.woQ)}" placeholder="Search WO, customer, machine" autocomplete="off" style="margin-bottom:14px">
    ${S.teamErr ? `<div class="unlock-err" style="margin:0 0 14px;white-space:pre-wrap">${esc(S.teamErr)}</div>` : ''}
    ${S.teamMsg ? `<div class="meta" style="margin:0 0 14px;color:var(--green)">${esc(S.teamMsg)}</div>` : ''}
    ${rows.length ? `<div class="atbl wo">
      <div class="atbl-h"><span><button class="pill pill-o atbl-b" data-a="woselall">${allOn ? 'Clear' : 'Select'}</button></span><span>Works order</span><span>Customer</span><span>Machine</span><span>Qty</span><span>Time</span><span>Progress</span><span>Status</span><span>Actions</span></div>
      ${rows.map(r => {
        const local = S.orders.find(o => o.id === r.id);
        const running = !!(local && local.active) || !!r.active;
        const st = r.archived ? 'Archived' : running ? 'Timer running' : r.done ? 'Finished' : 'In progress';
        const on = !!S.woSel[r.id];
        const confirm = S.woConfirm === r.id;
        const done = woStages(r);
        return `<div class="atbl-r ${r.archived ? 'off' : ''}">
          <span><button class="opt ${on ? 'on' : ''}" data-a="wotoggle" data-id="${esc(r.id)}" ${S.teamBusy ? 'disabled' : ''}><span>${on ? 'Selected' : 'Select'}</span></button></span>
          <span><b>WO ${esc(r.wo)}</b></span>
          <span>${esc(r.customer || '—')}</span>
          <span>${esc(r.machine || '—')}</span>
          <span>${r.qty || 1}</span>
          <span>${hm(woLoggedMs(r) / 6e4)}</span>
          <span>${done} of 10 · ${done * 10}%</span>
          <span>${st}</span>
          <span class="atbl-a">
            ${confirm ? `<span class="meta" style="flex:1 1 100%">Delete WO ${esc(r.wo)}? This cannot be undone.</span>
              <button class="pill pill-y atbl-b" data-a="wodelete" data-id="${esc(r.id)}" ${S.teamBusy ? 'disabled' : ''}>Delete forever</button>
              <button class="pill pill-o atbl-b" data-a="wocanceldel">Cancel</button>`
            : `${r.archived
                ? `<button class="pill pill-o atbl-b" data-a="worestore" data-id="${esc(r.id)}" ${S.teamBusy || running ? 'disabled' : ''}>Restore</button>`
                : `<button class="pill pill-o atbl-b" data-a="woarchive" data-id="${esc(r.id)}" ${S.teamBusy || running ? 'disabled' : ''}>Archive</button>`}
              <button class="pill pill-o atbl-b" data-a="wodelete" data-id="${esc(r.id)}" ${S.teamBusy || running ? 'disabled' : ''}>Delete</button>`}
          </span>
        </div>`;
      }).join('')}
    </div>` : `<div class="empty">${S.teamBusy ? 'Loading…' : (S.woFilter === 'archived' ? 'No archived works orders.' : 'No works orders on the shop list.')}</div>`}
  </div></div>`;
}

function vBoard() {
  const rank = o => o.active ? 0 : o.done ? 2 : 1;
  const list = S.orders.filter(o => !o.archived).slice().sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
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
      <span class="msg ${S.sendState === 'error' ? 'err' : ''}" style="flex:1;text-align:right;white-space:pre-wrap">${esc(S.sendMsg)}</span>
      ${S.admin ? `<button class="pill ${S.sendState === 'sent' ? 'pill-d' : 'pill-y'}" data-a="send" ${S.sendState === 'sending' ? 'disabled' : ''}>${btn}</button>` : ''}</div>
  </div></div>`;
}

function view() {
  if (!S.unlocked && S.screen === 'unlock' && S.picked) return `<div class="app">${vUnlock()}</div>`;
  if (!S.unlocked) return `<div class="app">${vSignin()}</div>`;
  if (S.screen === 'signin' || S.screen === 'unlock') S.screen = 'board';
  const o = cur();
  if (['stages','timer','finish'].includes(S.screen) && !o) S.screen = 'board';
  let body = '';
  if (S.screen === 'board') body = vBoard();
  if (S.screen === 'admin') body = S.admin ? vAdmin() : (S.screen = 'board', vBoard());
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
  else if (!S.unlocked && S.screen === 'unlock') { const el = document.getElementById('f-pass'); if (el) el.focus(); }
}

root.addEventListener('click', e => {
  const inMenu = e.target.closest('.me-wrap');
  const b = e.target.closest('[data-a]');
  const closeMenu = !inMenu && S.menu;
  if (closeMenu) S.menu = false;
  if (!b || b.disabled) { if (closeMenu) render(); return; }
  e.preventDefault();
  touchActivity();
  const prevScreen = S.screen;
  const r = actions[b.dataset.a] && actions[b.dataset.a](b.dataset);
  if (r && r.then) return;
  if (S.screen !== prevScreen) root.querySelectorAll('[data-scroll]').forEach(el => { el.scrollTop = 0; });
  render();
});
root.addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f) return;
  S[f] = e.target.value;
  if (f === 'pass' || f === 'teamPass' || f === 'intSecret' || f === 'intTestTo') { S.unlockError = ''; return; }
  render();
});
root.addEventListener('submit', e => { e.preventDefault(); if (S.screen === 'unlock') actions.unlock(); });
root.addEventListener('keydown', e => { touchActivity(); });

setInterval(() => {
  if (S.unlocked || S.handover) {
    if (applyCloseOfDay()) flush();
  }
  if (!S.unlocked) return;
  const liveShop = S.orders.some(o => o.active);
  const liveAdmin = S.screen === 'admin' && S.adminTab === 'orders' && ((S.woList || []).some(r => r.active) || S.orders.some(o => o.active));
  if (liveShop || liveAdmin) render();
}, 1000);
setInterval(() => { if (S.unlocked || S.handover) flush().then(pull); }, 60000);
setInterval(checkIdle, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIdle(); });

async function restoreUser(user) {
  if (!user || S.unlocked || S.handover) return;
  S.unlocked = true;
  S.fitter = displayName(user);
  if (!S.fitter) {
    const row = S.fitters.find(f => f.id === user.id);
    S.fitter = row ? row.full_name : (user.email || 'Fitter');
  }
  await loadAdminFlag(user);
  S.screen = 'board';
  touchActivity();
  applyCloseOfDay();
  render();
  flush().then(pull);
}

async function boot() {
  render();
  await loadFitters();
  applyCloseOfDay();
  if (!sb) { S.fittersError = 'Add your Supabase keys to config.js first.'; return render(); }
  if (isIdle()) {
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
    return render();
  }
  sb.auth.onAuthStateChange((_event, session) => {
    const user = session && session.user;
    if (user) restoreUser(user);
  });
  const { data } = await sb.auth.getSession();
  const user = data && data.session && data.session.user;
  if (user) await restoreUser(user);
  else render();
}

boot();
})();
