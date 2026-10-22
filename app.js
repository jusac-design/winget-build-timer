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
  {name:'100T ES Diesel'},
  {name:'150T ES Diesel'},
  {name:'150TFT ES Diesel'},
  {name:'175T ES Diesel'},
  {name:'175TFT ES Diesel'}
];
const QUICK_PICKS = 5;
const WO_MAX = 10;
const KEY = 'build-mate-live-v1';
const ACT_KEY = 'build-mate-live-activity';
const FITTERS_KEY = 'build-mate-fitters';
const PROCESS_KEY = 'build-mate-process';
const FNS = [
  {fn:'Fabrication', colour:'#00a3e0'},
  {fn:'Stores', colour:'#8c4799'},
  {fn:'Assembly', colour:'#e57200'},
  {fn:'Build', colour:'#009639'},
  {fn:'QC', colour:'#e11f1c'}
];
const FN_SWATCHES = ['#00a3e0', '#8c4799', '#e57200', '#009639', '#e11f1c', '#f5b800', '#373a36', '#046a82'];
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
const hms = ms => { const s = Math.max(0, Math.floor(Number(ms) / 1000)); return Math.floor(s / 3600) + 'h ' + String(Math.floor(s / 60) % 60).padStart(2, '0') + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const localInput = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const fromLocal = v => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
const iso = ts => ts ? new Date(ts).toISOString() : null;
const ms = v => v ? new Date(v).getTime() : null;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const TZ = 'Europe/London';
function londonParts(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
  return p;
}
function londonAt(y, m, d, hour, minute) {
  let guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  for (let i = 0; i < 6; i++) {
    const g = londonParts(guess);
    const got = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute, +(g.second || 0));
    const next = guess + (Date.UTC(y, m - 1, d, hour, minute, 0) - got);
    if (next === guess) return guess;
    guess = next;
  }
  return guess;
}
function ukCloseAt(startMs) {
  let t = Number(startMs) || Date.now();
  let p = londonParts(t);
  for (let i = 0; i < 4 && (p.weekday === 'Sat' || p.weekday === 'Sun'); i++) {
    t -= 864e5; p = londonParts(t);
  }
  return londonAt(+p.year, +p.month, +p.day, 16, 30);
}
// Weekday shop breaks. Keep these in step with the daily-report and manage-team functions.
const BREAKS = [
  {key:'morning', name:'Morning break', sh:9, sm:30, eh:9, em:45},
  {key:'lunch', name:'Lunch', sh:12, sm:30, eh:13, em:0},
  {key:'afternoon', name:'Afternoon break', sh:15, sm:0, eh:15, em:15}
];
function spanCount(start, stop) {
  start = Number(start) || 0;
  stop = Number(stop) || 0;
  const elapsed = Math.max(0, stop - start);
  if (stop <= start) return {elapsed:0, counted:0, breaks:[]};
  const acc = {};
  const p0 = londonParts(start);
  let y = +p0.year, mo = +p0.month, d = +p0.day;
  for (let i = 0; i < 21; i++) {
    if (londonAt(y, mo, d, 0, 0) >= stop) break;
    const day = londonParts(londonAt(y, mo, d, 12, 0));
    if (day.weekday !== 'Sat' && day.weekday !== 'Sun') {
      BREAKS.forEach(b => {
        const a = Math.max(start, londonAt(y, mo, d, b.sh, b.sm));
        const z = Math.min(stop, londonAt(y, mo, d, b.eh, b.em));
        if (z > a) acc[b.key] = (acc[b.key] || 0) + (z - a);
      });
    }
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate();
  }
  const breaks = BREAKS.filter(b => acc[b.key]).map(b => ({key:b.key, name:b.name, ms:acc[b.key]}));
  const deducted = breaks.reduce((s, b) => s + b.ms, 0);
  return {elapsed, counted:Math.max(0, elapsed - deducted), breaks};
}
function shopClosed(ms) {
  ms = ms == null ? Date.now() : ms;
  const p = londonParts(ms);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return true;
  return ms >= ukCloseAt(ms);
}
function greetingKind(ms) {
  ms = ms == null ? Date.now() : ms;
  const p = londonParts(ms);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return null;
  const secs = (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second || 0);
  if (secs >= 6 * 3600 && secs < 6 * 3600 + 3) return 'morning';
  if (secs >= 17 * 3600 && secs < 17 * 3600 + 3) return 'night';
  return null;
}
function applyCloseOfDay() {
  let n = 0;
  S.orders.forEach(o => {
    if (!o.active) return;
    const start = woActiveStart(o.active);
    const close = ukCloseAt(start);
    if (!start || start >= close || Date.now() < close) return;
    stopActive(o); touch(o); n++;
  });
  return n;
}
const HOME_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>';
const BACK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

// ---------- state ----------
const S = {
  screen:'signin', unlocked:false, handover:false, admin:false, supervisor:false, menu:false, userId:null, fitter:null, picked:null, fitters:[], fittersError:'',
  teamList:[], teamId:null, teamName:'', teamEmail:'', teamPass:'', teamRate:'', teamRole:'user', teamMsg:'', teamErr:'', teamBusy:false, teamForm:false,
  rates:{}, runEdit:null, runStart:'', runStop:'', runErr:'', runDelete:null,
  adminTab:'orders', intList:[], intForm:false, intId:null, intFrom:'', intTo:'', intSecret:'', intTestTo:'',
  woList:[], woFilter:'shop', woQ:'', woSel:{}, woConfirm:null, woSend:'idle',
  boardFilter:'all', boardSort:'activity',
  stages:[], machineStages:[], machines:[], functions:[], processReady:false, procMachine:MACHINES[0].name, procBusy:false, procErr:'', procMsg:'',
  machineForm:false, machineEdit:null, machineName:'', machineConfirm:null,
  stageForm:false, stageEdit:null, stageName:'', stageFn:'Assembly', stageTasks:'',
  fnForm:false, fnEdit:null, fnName:'', fnPick:'#00a3e0', fnConfirm:null,
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
  try {
    const p = JSON.parse(localStorage.getItem(PROCESS_KEY) || '{}');
    if (p.stages && p.stages.length) { S.stages = p.stages; S.machineStages = p.machineStages || []; S.machines = p.machines || []; S.functions = p.functions || []; S.processReady = true; }
  } catch (e) {}
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({orders:S.orders, outbox})); } catch (e) {} };
const cur = () => S.orders.find(o => o.id === S.activeId) || null;

function functionList() {
  if (S.functions && S.functions.length) return S.functions.slice().sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name)));
  return FNS.map((f, i) => ({name:f.fn, colour:f.colour, position:i + 1}));
}
function fnColour(fn) {
  const list = functionList();
  return (list.find(f => f.name === fn) || list[0] || {colour:'#373a36'}).colour;
}
function defaultFn() {
  const list = functionList();
  return list.some(f => f.name === 'Assembly') ? 'Assembly' : (list[0] ? list[0].name : '');
}
function asStage(row) {
  let tasks = row.tasks || [];
  if (typeof tasks === 'string') { try { tasks = JSON.parse(tasks); } catch (e) { tasks = []; } }
  return {n:Number(row.n), fn:row.fn, colour:row.colour || fnColour(row.fn), name:row.name, tasks:Array.isArray(tasks) ? tasks : [], retired:!!row.retired};
}
function catalog() {
  return (S.processReady && S.stages.length) ? S.stages : STAGES.map(s => Object.assign({}, s, {retired:false}));
}
function stageOf(n) { return catalog().find(s => s.n === Number(n)) || null; }
function processStages(machine) {
  if (!S.processReady) {
    const useRef = machine === '100T ES Diesel';
    return STAGES.map(s => Object.assign({}, s, {retired:false, ref: useRef ? s.ref : null, extra:false}));
  }
  return S.machineStages.filter(r => r.machine === machine).slice().sort((a, b) => a.position - b.position).map(r => {
    const s = stageOf(r.stage);
    if (!s || s.retired) return null;
    return Object.assign({}, s, {ref: r.ref_minutes == null || r.ref_minutes === '' ? null : Number(r.ref_minutes), extra:false});
  }).filter(Boolean);
}
function orderStages(o) {
  const proc = processStages(o && o.machine);
  const have = {};
  proc.forEach(s => { have[s.n] = true; });
  const used = {};
  if (o) {
    (o.runs || []).forEach(r => { used[r.stage] = true; });
    (o.complete || []).forEach(n => { used[n] = true; });
    if (o.active) used[o.active.stage] = true;
  }
  const extra = Object.keys(used).map(Number).filter(n => !have[n]).map(n => {
    const s = stageOf(n);
    return s ? Object.assign({}, s, {ref:null, extra:true}) : null;
  }).filter(Boolean).sort((a, b) => a.n - b.n);
  return proc.concat(extra);
}
function stageProgress(o) {
  const proc = processStages(o && o.machine);
  const complete = (o && o.complete) || [];
  const done = proc.filter(s => complete.includes(s.n)).length;
  const total = proc.length;
  return {done, total, pct: total ? Math.round(done * 100 / total) : 0};
}
function machineList() {
  if (S.machines && S.machines.length) return S.machines.slice().sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name)));
  return MACHINES.map((m, i) => ({name:m.name, position:i + 1}));
}
function refText(mins) { return mins == null ? 'no ref' : 'ref ' + hm(mins); }
async function loadProcess() {
  if (!sb || (!S.unlocked && !S.handover)) return;
  const st = await sb.from('stages').select('n,fn,colour,name,tasks,retired').order('n');
  const ms = await sb.from('machine_stages').select('machine,stage,position,ref_minutes');
  const mac = await sb.from('machines').select('name,position').order('position');
  const fn = await sb.from('stage_functions').select('name,colour,position').order('position');
  if (st.error || ms.error || mac.error || fn.error) { console.warn(st.error || ms.error || mac.error || fn.error); return; }
  S.stages = (st.data || []).map(asStage);
  S.machineStages = ms.data || [];
  S.machines = mac.data || [];
  S.functions = fn.data || [];
  S.processReady = S.stages.length > 0;
  try { localStorage.setItem(PROCESS_KEY, JSON.stringify({stages:S.stages, machineStages:S.machineStages, machines:S.machines, functions:S.functions})); } catch (e) {}
}

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

function isOffice() { return !!(S.admin || S.supervisor); }
function personRole(f) { return f.admin ? 'Admin' : f.supervisor ? 'Supervisor' : 'User'; }

function goLocked() {
  S.unlocked = false; S.handover = false; S.admin = false; S.supervisor = false; S.menu = false; S.userId = null; S.fitter = null; S.picked = null; S.screen = 'signin'; S.activeId = null;
  S.showReport = false; S.pass = ''; S.unlockBusy = false; S.unlockError = '';
  S.teamList = []; S.teamId = null; S.teamForm = false; S.teamName = ''; S.teamEmail = ''; S.teamPass = ''; S.teamRate = ''; S.teamRole = 'user'; S.teamMsg = ''; S.teamErr = '';
  S.rates = {}; S.runEdit = null; S.runStart = ''; S.runStop = ''; S.runErr = ''; S.runDelete = null;
  S.adminTab = 'orders'; S.intList = []; S.intForm = false; S.intId = null; S.intFrom = ''; S.intTo = ''; S.intSecret = ''; S.intTestTo = '';
  S.woList = []; S.woFilter = 'shop'; S.woQ = ''; S.woSel = {}; S.woConfirm = null; S.woSend = 'idle';
  S.boardFilter = 'all'; S.boardSort = 'activity';
}

async function loadAdminFlag(user) {
  S.admin = false; S.supervisor = false; S.userId = user && user.id || null;
  if (!sb || !user) return;
  let { data, error } = await sb.from('fitters').select('admin, supervisor, full_name').eq('id', user.id).maybeSingle();
  if (error) {
    const retry = await sb.from('fitters').select('admin, full_name').eq('id', user.id).maybeSingle();
    data = retry.data; error = retry.error;
  }
  if (error) { console.warn(error); return; }
  if (data) {
    S.admin = !!data.admin;
    S.supervisor = !S.admin && !!data.supervisor;
    if (data.full_name) S.fitter = data.full_name;
  }
}

async function teamCall(body) {
  if (!sb || !isOffice()) return;
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
    if (body.action === 'create' || body.action === 'update') {
      if (body.action === 'update' && body.id === S.userId && body.full_name) S.fitter = String(body.full_name).trim();
      Object.assign(S, { teamForm:false, teamId:null, teamName:'', teamEmail:'', teamPass:'', teamRate:'', teamRole:'user' });
    }
    if (body.action === 'password') { S.teamPass = ''; S.teamMsg = S.teamMsg || 'Passphrase updated. They can sign in with it now.'; }
    if (body.action === 'update' && body.password) S.teamMsg = 'Saved. They can sign in with the new passphrase.';
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
  outbox = outbox.filter(x => !(x.t === table && ((x.row && x.row.id === row.id) || (x.op === 'delete' && x.id === row.id))));
  outbox.push({t:table, row});
  save(); flush();
}
function queueDelete(table, id) {
  outbox = outbox.filter(x => !(x.t === table && ((x.row && x.row.id === id) || (x.op === 'delete' && x.id === id))));
  outbox.push({t:table, op:'delete', id});
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
      const q = it.op === 'delete' ? sb.from(it.t).delete().eq('id', it.id) : sb.from(it.t).upsert(it.row);
      const { error } = await q;
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
  let rateMap = {};
  if (isOffice()) {
    const fr = await sb.from('fitter_rates').select('fitter_id, hourly_rate');
    if (!fr.error) {
      S.rates = {};
      (fr.data || []).forEach(row => { S.rates[row.fitter_id] = row.hourly_rate == null ? null : Number(row.hourly_rate); });
    }
    const runIds = runs.map(r => r.id);
    if (runIds.length) {
      const rr = await sb.from('run_rates').select('run_id, hourly_rate').in('run_id', runIds);
      if (!rr.error) (rr.data || []).forEach(row => { rateMap[row.run_id] = row.hourly_rate == null ? null : Number(row.hourly_rate); });
    }
  }
  if (outbox.length) return; // something changed while loading — keep local
  S.orders = o.data.map(x => ({
    id:x.id, wo:x.wo, customer:x.customer, machine:x.machine, hasRef:x.has_ref, qty:x.qty, mode:x.mode,
    complete:x.complete || [], done:x.done, archived:!!x.archived, finishedAt:ms(x.finished_at), active:x.active, createdAt:ms(x.created_at),
    runs: runs.filter(r => r.order_id === x.id).map(r => ({id:r.id, stage:r.stage, unit:r.unit, fitter:r.fitter, start:ms(r.started_at), stop:ms(r.stopped_at), rate:Object.prototype.hasOwnProperty.call(rateMap, r.id) ? rateMap[r.id] : null})),
    notes: notes.filter(n => n.order_id === x.id).map(n => ({id:n.id, text:n.text, fitter:n.fitter, at:ms(n.created_at)})).sort((a, b) => a.at - b.at)
  })).sort((a, b) => a.createdAt - b.createdAt);
  await loadProcess();
  applyCloseOfDay();
  save(); S.sync = 'saved'; render();
}

window.addEventListener('online', () => { loadFitters().then(() => { if (!S.unlocked) render(); flush().then(pull); }); });
window.addEventListener('offline', () => setSync('offline'));

// ---------- maths ----------
const hmShort = mins => { const m = Math.max(0, Math.round(mins)); return m < 60 ? m + 'm' : hm(m); };
const gbp = n => '£' + (Math.round(n * 100) / 100).toFixed(2);
function rateForName(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const f = (S.teamList || []).find(x => String(x.full_name || '').trim().toLowerCase() === key)
    || (S.fitters || []).find(x => String(x.full_name || '').trim().toLowerCase() === key);
  if (!f || S.rates[f.id] == null || S.rates[f.id] === '') return null;
  const n = Number(S.rates[f.id]);
  return Number.isFinite(n) ? n : null;
}
function collectRanges(o, n, unit, todayOnly) {
  const now = Date.now();
  const ranges = [];
  (o.runs || []).forEach(r => {
    if (n != null && r.stage !== n) return;
    if (unit != null && r.unit !== unit) return;
    if (todayOnly && !sameDay(r.start, now)) return;
    ranges.push({start:r.start, stop:r.stop, rate:r.rate == null ? null : r.rate});
  });
  if (o.active && (n == null || o.active.stage === n) && (unit == null || o.active.unit === unit)) {
    const start = woActiveStart(o.active);
    if (start && (!todayOnly || sameDay(start, now))) ranges.push({start, stop:now, rate:rateForName(o.active.fitter)});
  }
  return ranges;
}
function tallyRanges(ranges) {
  let elapsed = 0, counted = 0, cost = 0, known = 0, missing = 0;
  const acc = {};
  ranges.forEach(r => {
    const p = spanCount(r.start, r.stop);
    elapsed += p.elapsed; counted += p.counted;
    p.breaks.forEach(b => { acc[b.key] = (acc[b.key] || 0) + b.ms; });
    if (p.counted > 0) {
      if (r.rate == null || r.rate === '') missing++;
      else { known++; cost += (p.counted / 36e5) * Number(r.rate); }
    }
  });
  const breaks = BREAKS.filter(b => acc[b.key]).map(b => ({key:b.key, name:b.name, ms:acc[b.key]}));
  return {elapsed, counted, breaks, cost, known, missing};
}
function breakText(t) {
  if (!t || !t.breaks.length) return '';
  return t.breaks.map(b => b.name + ' −' + hmShort(b.ms / 6e4)).join(' · ');
}
function costText(t) {
  if (!isOffice() || !t || (!t.known && !t.missing)) return '';
  if (!t.known) return 'No rate';
  if (t.missing) return gbp(t.cost) + ' · No rate on some time';
  return gbp(t.cost);
}
function loggedMs(o, n, unit) { return tallyRanges(collectRanges(o, n, unit, false)).counted; }
function orderMs(o) { return tallyRanges(collectRanges(o, null, null, false)).counted; }
function mineLive() {
  const me = String(S.fitter || '').trim().toLowerCase();
  if (!me) return null;
  return S.orders.find(o => o.active && String(o.active.fitter || '').trim().toLowerCase() === me) || null;
}
function todayMs(o, n) { return tallyRanges(collectRanges(o, n, null, true)).counted; }
const perUnit = o => o.mode === 'unit' && o.qty > 1;

// ---------- changes ----------
function touch(o) { queue('orders', orderRow(o)); save(); }
function stopActive(o) {
  if (!o.active) return;
  const start = woActiveStart(o.active);
  const close = ukCloseAt(start);
  let stop = Date.now();
  if (start && start < close && stop > close) stop = close;
  const r = {id:uid('r'), stage:o.active.stage, unit:o.active.unit, fitter:o.active.fitter, start, stop, rate:rateForName(o.active.fitter)};
  o.active = null;
  if (!start || stop <= start) return;
  o.runs.push(r); queue('runs', runRow(r, o));
}
function quickPicks() {
  const t = {};
  S.orders.forEach(o => { const k = (o.customer || '').trim(); if (!k) return; const x = t[k] || (t[k] = {name:k, n:0, last:0}); x.n++; x.last = Math.max(x.last, o.createdAt || 0); });
  return Object.values(t).sort((a, b) => b.n - a.n || b.last - a.last).slice(0, QUICK_PICKS).map(x => x.name);
}

async function writeProcess(run) {
  if (!S.admin || !sb) { S.procErr = 'Sign in as an admin to change the process.'; return render(); }
  if (S.procBusy) return;
  S.procBusy = true; S.procErr = ''; S.procMsg = '';
  render();
  try { await run(); await loadProcess(); }
  catch (e) { S.procErr = (e && e.message) || 'Could not save that change.'; }
  S.procBusy = false;
  render();
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
      loadProcess();
      return;
    }
    if (S.userId && f.id !== S.userId && sb) {
      return (async () => {
        try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
        S.handover = false; S.unlocked = false; S.admin = false; S.supervisor = false; S.userId = null; S.fitter = null;
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
    loadProcess().then(() => { if (S.unlocked) render(); });
    flush().then(pull);
  },
  home: () => lockShop(),
  signout: () => { lockShop(); },
  togglemenu: () => { if (!isOffice()) return actions.signout(); S.menu = !S.menu; },
  admin: () => {
    if (!isOffice()) return;
    S.menu = false; S.screen = 'admin'; S.adminTab = 'orders'; S.teamForm = false; S.teamId = null; S.teamErr = ''; S.teamMsg = '';
    S.intForm = false; S.intSecret = '';
    return teamCall({ action: 'orders_list' });
  },
  admintab: d => {
    if (!isOffice()) return;
    let tab = d.tab || 'orders';
    if ((tab === 'settings' || tab === 'stages' || tab === 'machines' || tab === 'functions') && !S.admin) tab = 'orders';
    S.adminTab = tab; S.teamForm = false; S.intForm = false; S.teamErr = ''; S.teamMsg = ''; S.woConfirm = null; S.woSend = 'idle';
    S.stageForm = false; S.fnForm = false; S.fnConfirm = null; S.procErr = ''; S.procMsg = '';
    if (S.adminTab === 'settings') return teamCall({ action: 'integrations_list' });
    if (S.adminTab === 'stages' || S.adminTab === 'machines' || S.adminTab === 'functions') return loadProcess().then(render);
    if (S.adminTab === 'users') return teamCall({ action: 'list' });
    if (S.adminTab === 'orders') return teamCall({ action: 'orders_list' });
  },
  intedit: d => {
    if (!S.admin) return;
    const row = S.intList.find(x => x.id === d.id); if (!row) return;
    const cfg = row.config || {};
    Object.assign(S, { intForm:true, intId:row.id, intFrom:cfg.from || '', intTo:cfg.to || '', intSecret:'', intTestTo:cfg.to || '', teamErr:'', teamMsg:'' });
  },
  intcancel: () => Object.assign(S, { intForm:false, intId:null, intFrom:'', intTo:'', intSecret:'', intTestTo:'' }),
  intsave: () => {
    if (!S.admin || S.teamBusy || !S.intId) return;
    return teamCall({ action:'integrations_save', id:S.intId, secret:S.intSecret, config:{ from:S.intFrom, to:S.intTo } });
  },
  fnnew: () => {
    if (!S.admin) return;
    Object.assign(S, {fnForm:true, fnEdit:null, fnName:'', fnPick:'#00a3e0', fnConfirm:null, procErr:'', procMsg:''});
  },
  fnedit: d => {
    if (!S.admin) return;
    const f = functionList().find(x => x.name === d.name); if (!f) return;
    Object.assign(S, {fnForm:true, fnEdit:f.name, fnName:f.name, fnPick:f.colour, fnConfirm:null, procErr:'', procMsg:''});
  },
  fncancel: () => { S.fnForm = false; S.fnEdit = null; S.fnName = ''; S.fnConfirm = null; },
  fnpick: d => {
    const colour = String(d.colour || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(colour)) S.fnPick = colour;
  },
  fnsave: () => {
    if (!S.admin) return;
    const name = String(S.fnName || '').trim();
    const colour = String(S.fnPick || '').trim().toLowerCase();
    if (!name) { S.procErr = 'Enter a function name.'; S.procMsg = ''; return render(); }
    if (!/^#[0-9a-f]{6}$/.test(colour)) { S.procErr = 'Pick a colour for this function.'; S.procMsg = ''; return render(); }
    if (functionList().some(f => f.name.toLowerCase() === name.toLowerCase() && f.name !== S.fnEdit)) {
      S.procErr = 'A function with that name already exists.'; S.procMsg = ''; return render();
    }
    const from = S.fnEdit;
    return writeProcess(async () => {
      const saved = await sb.rpc('save_stage_function', {p_from:from, p_name:name, p_colour:colour});
      if (saved.error) throw saved.error;
      if (S.stageFn === from) S.stageFn = name;
      S.fnForm = false; S.fnEdit = null; S.fnName = ''; S.fnConfirm = null;
      S.procMsg = from ? 'Function saved. Stages that use it now show this name and colour.' : 'Function added. Choose it when you add or edit a stage.';
    });
  },
  fndelete: d => {
    if (!S.admin) return;
    const name = d.name;
    if (!functionList().some(f => f.name === name)) return;
    if (S.fnConfirm !== name) { S.fnConfirm = name; S.procErr = ''; S.procMsg = ''; return; }
    return writeProcess(async () => {
      S.fnConfirm = null;
      const del = await sb.rpc('delete_stage_function', {p_name:name});
      if (del.error) throw del.error;
      if (S.fnEdit === name) { S.fnForm = false; S.fnEdit = null; }
      S.procMsg = 'Function deleted.';
    });
  },
  fnmove: d => {
    if (!S.admin) return;
    const dir = Number(d.dir);
    const name = d.name;
    return writeProcess(async () => {
      const rows = functionList();
      const i = rows.findIndex(r => r.name === name);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return;
      const next = rows.slice();
      const moved = next.splice(i, 1)[0];
      next.splice(j, 0, moved);
      for (let k = 0; k < next.length; k++) {
        if (Number(next[k].position) === k + 1) continue;
        const upd = await sb.from('stage_functions').update({position:k + 1, updated_at:new Date().toISOString()}).eq('name', next[k].name);
        if (upd.error) throw upd.error;
      }
    });
  },
  stagenew: () => {
    if (!S.admin) return;
    Object.assign(S, {stageForm:true, stageEdit:null, stageName:'', stageFn:defaultFn(), stageTasks:'', procErr:'', procMsg:''});
  },
  stageedit: d => {
    if (!S.admin) return;
    const s = stageOf(d.n); if (!s) return;
    Object.assign(S, {stageForm:true, stageEdit:s.n, stageName:s.name, stageFn:s.fn, stageTasks:(s.tasks || []).join('\n'), procErr:'', procMsg:''});
  },
  stagecancel: () => { S.stageForm = false; S.stageEdit = null; },
  stagefn: d => { if (functionList().some(f => f.name === d.fn)) S.stageFn = d.fn; },
  stagesave: () => {
    if (!S.admin) return;
    const name = String(S.stageName || '').trim();
    if (!name) { S.procErr = 'Enter a stage name.'; S.procMsg = ''; return render(); }
    const fn = functionList().some(f => f.name === S.stageFn) ? S.stageFn : defaultFn();
    if (!fn) { S.procErr = 'Add a function before adding a stage.'; S.procMsg = ''; return render(); }
    const tasks = String(S.stageTasks || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const row = {fn, colour:fnColour(fn), name, tasks, updated_at:new Date().toISOString()};
    return writeProcess(async () => {
      if (S.stageEdit) {
        const upd = await sb.from('stages').update(row).eq('n', S.stageEdit);
        if (upd.error) throw upd.error;
        S.procMsg = 'Stage saved.';
      } else {
        const n = catalog().reduce((m, s) => Math.max(m, Number(s.n) || 0), 0) + 1;
        const ins = await sb.from('stages').insert(Object.assign({n, retired:false}, row));
        if (ins.error) throw ins.error;
        S.procMsg = 'Stage added. Tick it on each machine that should use it.';
      }
      S.stageForm = false; S.stageEdit = null;
    });
  },
  stageretire: d => {
    if (!S.admin) return;
    const n = Number(d.n);
    return writeProcess(async () => {
      const runs = await sb.from('runs').select('id', {count:'exact', head:true}).eq('stage', n);
      if (runs.error) throw runs.error;
      const orders = await sb.from('orders').select('id').contains('complete', [n]);
      if (orders.error) throw orders.error;
      const live = S.orders.some(o => (o.active && o.active.stage === n) || (o.runs || []).some(r => r.stage === n) || (o.complete || []).includes(n));
      const used = (runs.count || 0) > 0 || (orders.data || []).length > 0 || live;
      const gone = await sb.from('machine_stages').delete().eq('stage', n);
      if (gone.error) throw gone.error;
      if (used) {
        const upd = await sb.from('stages').update({retired:true, updated_at:new Date().toISOString()}).eq('n', n);
        if (upd.error) throw upd.error;
        S.procMsg = 'Retired. Jobs that already used it still show it. It is off every machine.';
      } else {
        const del = await sb.from('stages').delete().eq('n', n);
        if (del.error) throw del.error;
        S.procMsg = 'Stage deleted.';
      }
    });
  },
  stagerestore: d => {
    if (!S.admin) return;
    const n = Number(d.n);
    return writeProcess(async () => {
      const upd = await sb.from('stages').update({retired:false, updated_at:new Date().toISOString()}).eq('n', n);
      if (upd.error) throw upd.error;
      S.procMsg = 'Stage restored. Tick it on a machine to show it on the shop floor.';
    });
  },
  procmachine: d => { if (machineList().some(m => m.name === d.name)) { S.procMachine = d.name; S.procErr = ''; S.procMsg = ''; S.machineConfirm = null; S.machineForm = false; } },
  machinenew: () => {
    if (!S.admin) return;
    Object.assign(S, {machineForm:true, machineEdit:null, machineName:'', machineConfirm:null, procErr:'', procMsg:''});
  },
  machineedit: () => {
    if (!S.admin) return;
    const name = S.procMachine;
    if (!machineList().some(m => m.name === name)) return;
    Object.assign(S, {machineForm:true, machineEdit:name, machineName:name, machineConfirm:null, procErr:'', procMsg:''});
  },
  machinecancel: () => { S.machineForm = false; S.machineEdit = null; S.machineName = ''; },
  machinesave: () => {
    if (!S.admin) return;
    const name = String(S.machineName || '').trim();
    if (!name) { S.procErr = 'Enter a machine name.'; S.procMsg = ''; return render(); }
    if (machineList().some(m => m.name.toLowerCase() === name.toLowerCase() && m.name !== S.machineEdit)) {
      S.procErr = 'A machine with that name already exists.'; S.procMsg = ''; return render();
    }
    const from = S.machineEdit;
    return writeProcess(async () => {
      if (from) {
        const renamed = await sb.rpc('rename_machine', {p_from:from, p_to:name});
        if (renamed.error) throw renamed.error;
        S.orders.forEach(o => { if (o.machine === from) o.machine = name; });
        (S.woList || []).forEach(r => { if (r.machine === from) r.machine = name; });
        if (S.procMachine === from) S.procMachine = name;
        if (S.machine === from) S.machine = name;
        save();
        S.procMsg = 'Machine renamed. Existing works orders use the new name.';
      } else {
        const pos = machineList().reduce((m, x) => Math.max(m, Number(x.position) || 0), 0) + 1;
        const ins = await sb.from('machines').insert({name, position:pos});
        if (ins.error) throw ins.error;
        S.procMachine = name;
        S.procMsg = 'Machine added. Tick the stages it uses.';
      }
      S.machineForm = false; S.machineEdit = null; S.machineName = '';
    });
  },
  machinedelete: () => {
    if (!S.admin) return;
    const name = S.procMachine;
    if (!name) return;
    if (S.machineConfirm !== name) { S.machineConfirm = name; S.procErr = ''; S.procMsg = ''; return; }
    return writeProcess(async () => {
      const del = await sb.rpc('delete_machine', {p_name:name});
      if (del.error) throw del.error;
      S.machineConfirm = null;
      S.procMachine = '';
      S.procMsg = 'Machine deleted.';
    });
  },
  proctick: d => {
    if (!S.admin) return;
    const n = Number(d.n);
    const on = S.machineStages.some(r => r.machine === S.procMachine && Number(r.stage) === n);
    return on ? actions.procremove(d) : actions.procadd(d);
  },
  procadd: d => {
    if (!S.admin) return;
    const n = Number(d.n);
    const s = stageOf(n);
    if (!s || s.retired) return;
    return writeProcess(async () => {
      const rows = S.machineStages.filter(r => r.machine === S.procMachine);
      if (rows.some(r => r.stage === n)) return;
      const pos = rows.reduce((m, r) => Math.max(m, Number(r.position) || 0), 0) + 1;
      const ins = await sb.from('machine_stages').insert({machine:S.procMachine, stage:n, position:pos, ref_minutes:null});
      if (ins.error) throw ins.error;
      S.procMsg = 'Added to ' + S.procMachine + '.';
    });
  },
  procremove: d => {
    if (!S.admin) return;
    const n = Number(d.n);
    return writeProcess(async () => {
      const del = await sb.from('machine_stages').delete().eq('machine', S.procMachine).eq('stage', n);
      if (del.error) throw del.error;
      S.procMsg = 'Removed from this machine. Jobs that already logged it still show it.';
    });
  },
  procmove: d => {
    if (!S.admin) return;
    const dir = Number(d.dir);
    const n = Number(d.n);
    return writeProcess(async () => {
      const rows = S.machineStages.filter(r => r.machine === S.procMachine).slice().sort((a, b) => a.position - b.position);
      const i = rows.findIndex(r => r.stage === n);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return;
      const a = rows[i], b = rows[j];
      const u1 = await sb.from('machine_stages').update({position:b.position}).eq('machine', S.procMachine).eq('stage', a.stage);
      if (u1.error) throw u1.error;
      const u2 = await sb.from('machine_stages').update({position:a.position}).eq('machine', S.procMachine).eq('stage', b.stage);
      if (u2.error) throw u2.error;
    });
  },
  procref: d => {
    if (!S.admin) return;
    const raw = String(d.value == null ? '' : d.value).trim();
    let ref = null;
    if (raw !== '') {
      if (!/^\d+$/.test(raw)) { S.procErr = 'Reference time is whole minutes, or leave the box blank.'; S.procMsg = ''; return render(); }
      ref = Number(raw);
    }
    const n = Number(d.n);
    return writeProcess(async () => {
      const upd = await sb.from('machine_stages').update({ref_minutes:ref}).eq('machine', S.procMachine).eq('stage', n);
      if (upd.error) throw upd.error;
      S.procMsg = ref == null ? 'Reference cleared.' : 'Reference saved.';
    });
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
    if (!S.admin || S.teamBusy || !d.id) return;
    if (S.woConfirm !== d.id) { S.woConfirm = d.id; S.teamErr = ''; S.teamMsg = ''; return; }
    S.woConfirm = null;
    return teamCall({ action: 'order_delete', id: d.id });
  },
  wocanceldel: () => { S.woConfirm = null; },
  wototal: async () => {
    const ids = Object.keys(S.woSel).filter(id => S.woSel[id]);
    if (!ids.length) { S.teamErr = 'Tick one or more works orders, then Email total report.'; S.teamMsg = ''; return render(); }
    if (!isOffice() || !sb) return;
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
    if (!S.admin || S.teamBusy || !S.intId) return;
    const to = (S.intTestTo || '').trim();
    if (!to || to.indexOf('@') < 0) { S.teamErr = 'Enter a test email address.'; S.teamMsg = ''; return render(); }
    return teamCall({ action:'integrations_test', id:S.intId, secret:S.intSecret, from:S.intFrom, test_to:to });
  },
  teamnew: () => Object.assign(S, { teamForm:true, teamId:null, teamName:'', teamEmail:'', teamPass:'', teamRate:'', teamRole:'user', teamErr:'', teamMsg:'' }),
  teamcancel: () => Object.assign(S, { teamForm:false, teamId:null, teamName:'', teamEmail:'', teamPass:'', teamRate:'', teamRole:'user', teamErr:'', teamMsg:'' }),
  teamedit: d => {
    const f = S.teamList.find(x => x.id === d.id); if (!f) return;
    if (!S.admin && (f.admin || f.supervisor) && f.id !== S.userId) return;
    const rate = f.hourly_rate == null || f.hourly_rate === '' ? '' : String(f.hourly_rate);
    Object.assign(S, { teamForm:true, teamId:f.id, teamName:f.full_name, teamEmail:f.email, teamPass:'', teamRate:rate, teamRole: f.admin ? 'admin' : f.supervisor ? 'supervisor' : 'user', teamErr:'', teamMsg:'' });
  },
  teamrole: d => {
    if (!S.admin || (S.teamId && S.teamId === S.userId)) return;
    const role = d.role || d.r;
    S.teamRole = role === 'admin' || role === 'supervisor' ? role : 'user';
  },
  teamsetrole: d => {
    if (!S.admin || S.teamBusy) return;
    const f = S.teamList.find(x => x.id === d.id); if (!f || f.id === S.userId) return;
    const role = d.role || d.r;
    return teamCall({ action:'update', id:f.id, full_name:f.full_name, admin: role === 'admin', supervisor: role === 'supervisor' });
  },
  teamsave: () => {
    if (S.teamBusy) return;
    const passBox = document.getElementById('f-teampass');
    if (passBox) S.teamPass = passBox.value;
    const password = String(S.teamPass || '').trim();
    S.teamPass = password;
    const admin = S.admin && S.teamRole === 'admin';
    const supervisor = S.admin && S.teamRole === 'supervisor';
    if (S.teamId) {
      if (password && password.length < 8) { S.teamErr = 'A new passphrase needs at least 8 characters, or leave it blank to keep the current one.'; S.teamMsg = ''; return render(); }
      return teamCall(Object.assign({ action:'update', id:S.teamId, full_name:S.teamName, admin, supervisor }, password ? { password } : {}, S.admin ? { hourly_rate:String(S.teamRate || '').trim() } : {}));
    }
    return teamCall(Object.assign({ action:'create', full_name:S.teamName, email:S.teamEmail, password, admin, supervisor }, S.admin ? { hourly_rate:String(S.teamRate || '').trim() } : {}));
  },
  teampass: () => {
    if (S.teamBusy || !S.teamId) return;
    const box = document.getElementById('f-teampass');
    const password = ((box && box.value) || S.teamPass || '').trim();
    S.teamPass = password;
    if (password.length < 8) { S.teamErr = 'Enter a passphrase of at least 8 characters, then press Reset passphrase.'; S.teamMsg = ''; return render(); }
    return teamCall({ action:'password', id:S.teamId, password });
  },
  teamarchive: d => { if (S.teamBusy) return; return teamCall({ action:'archive', id:d.id }); },
  teamrestore: d => { if (S.teamBusy) return; return teamCall({ action:'restore', id:d.id }); },
  board: () => { S.menu = false; S.screen = 'board'; },
  stages: () => { S.screen = 'stages'; },
  back: () => { S.screen = (S.screen === 'admin' || S.screen === 'team') ? 'board' : (S.screen === 'timer' || S.screen === 'finish') ? 'stages' : 'board'; },
  new: () => { if (!isOffice()) return; Object.assign(S, {screen:'new', wo:'', cust:'', machine:null, qty:1, mode:'batch', newNote:''}); },
  key: d => { const k = d.k; S.wo = k === 'C' ? '' : k === 'del' ? S.wo.slice(0, -1) : (S.wo.length < WO_MAX ? S.wo + k : S.wo); },
  pickcust: d => { S.cust = d.name; },
  machine: d => { S.machine = d.name; },
  qtyup: () => { S.qty = Math.min(20, S.qty + 1); },
  qtydown: () => { S.qty = Math.max(1, S.qty - 1); if (S.qty === 1) S.mode = 'batch'; },
  mode: d => { S.mode = d.m; },
  create: () => {
    if (!isOffice()) return;
    if (!(S.wo && S.cust.trim() && S.machine)) return;
    const hasRef = processStages(S.machine).some(s => s.ref != null);
    const o = {id:uid('o'), wo:S.wo, customer:S.cust.trim(), machine:S.machine, hasRef:hasRef, qty:S.qty, mode:S.qty > 1 ? S.mode : 'batch',
      complete:[], done:false, archived:false, finishedAt:null, active:null, createdAt:Date.now(), runs:[], notes:[]};
    S.orders.push(o); touch(o);
    if (S.newNote.trim()) { const n = {id:uid('n'), text:S.newNote.trim(), fitter:S.fitter, at:Date.now()}; o.notes.push(n); queue('notes', noteRow(n, o)); }
    Object.assign(S, {activeId:o.id, screen:'stages', unit:1});
  },
  open: d => Object.assign(S, {activeId:d.id, screen:'stages', unit:1, noteDraft:''}),
  unit: d => { S.unit = Number(d.n); },
  stage: d => { S.stage = Number(d.n); S.screen = 'timer'; S.runEdit = null; S.runDelete = null; S.runErr = ''; },
  stagetoggle: d => {
    const o = cur(); if (!o) return;
    const n = Number(d.n);
    const unit = perUnit(o) ? S.unit : 1;
    const running = o.active && o.active.stage === n && (!perUnit(o) || o.active.unit === unit);
    const listed = orderStages(o).find(s => s.n === n);
    if (listed && listed.extra && !running) return;
    stopActive(o);
    if (!running) o.active = {stage:n, unit, fitter:S.fitter, start:Date.now()};
    touch(o);
  },
  runadd: () => {
    if (!isOffice()) return;
    S.runEdit = 'new'; S.runErr = ''; S.runDelete = null;
    S.runStart = localInput(Date.now() - 3600000);
    S.runStop = localInput(Date.now());
  },
  runedit: d => {
    if (!isOffice()) return;
    const o = cur(); const r = o && o.runs.find(x => x.id === d.id); if (!r) return;
    S.runEdit = r.id; S.runErr = ''; S.runDelete = null;
    S.runStart = localInput(r.start); S.runStop = localInput(r.stop);
  },
  runcancel: () => { S.runEdit = null; S.runErr = ''; },
  runsave: () => {
    if (!isOffice()) return;
    const o = cur(); if (!o) return;
    const start = fromLocal(S.runStart), stop = fromLocal(S.runStop);
    if (!start || !stop || stop <= start) { S.runErr = 'Stop must be after start.'; return; }
    if (S.runEdit === 'new') {
      const r = {id:uid('r'), stage:S.stage, unit:perUnit(o) ? S.unit : 1, fitter:S.fitter, start, stop, rate:rateForName(S.fitter)};
      o.runs.push(r); queue('runs', runRow(r, o));
    } else {
      const r = o.runs.find(x => x.id === S.runEdit); if (!r) return;
      r.start = start; r.stop = stop;
      queue('runs', runRow(r, o));
    }
    S.runEdit = null; S.runErr = '';
    touch(o);
  },
  rundelete: d => {
    if (!isOffice()) return;
    const o = cur(); if (!o) return;
    if (S.runDelete !== d.id) { S.runDelete = d.id; return; }
    o.runs = o.runs.filter(r => r.id !== d.id);
    queueDelete('runs', d.id);
    if (S.runEdit === d.id) S.runEdit = null;
    S.runDelete = null;
    touch(o);
  },
  toggle: () => {
    const o = cur(); if (!o) return;
    const running = o.active && o.active.stage === S.stage && (!perUnit(o) || o.active.unit === S.unit);
    const listed = orderStages(o).find(s => s.n === S.stage);
    if (listed && listed.extra && !running) return;
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
  tofinish: () => { const o = cur(); if (!o) return; const prog = stageProgress(o); if (prog.done === prog.total) S.screen = 'finish'; },
  finish: () => { const o = cur(); if (!o) return; stopActive(o); o.done = true; o.finishedAt = Date.now(); touch(o); S.screen = 'board'; },
  report: () => { if (!isOffice()) return; S.showReport = true; S.sendState = 'idle'; S.sendMsg = ''; },
  closereport: () => { S.showReport = false; },
  send: async () => {
    if (!isOffice()) { S.sendState = 'error'; S.sendMsg = 'Only a supervisor or admin can send the report.'; return render(); }
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
  const greet = !live ? greetingKind() : null;
  const who = (S.fitter || '').trim();
  if (live) {
    pill = `<button class="runpill" data-a="open" data-id="${esc(live.id)}" title="Open this works order">
      <span class="dot"></span>
      <span class="rp-txt"><span class="rp-k">Live job</span><span class="rp-l">WO ${esc(live.wo)}${live.machine ? ' · ' + esc(live.machine) : ''}</span><span class="rp-s">${esc(stageLine)}</span></span>
      <span class="rp-time"><span class="rp-c">${hms(orderMs(live))}</span><span class="rp-k">Total WO time</span></span>
    </button>`;
  } else if (greet && who) {
    const open = inOrder
      ? `data-a="open" data-id="${esc(o.id)}" title="Open this works order"`
      : `data-a="board" title="Open the works order list"`;
    pill = greet === 'morning'
      ? `<button class="runpill greet" ${open}><span class="rp-txt"><span class="rp-k">Hello</span><span class="rp-l">${esc(who)}</span></span></button>`
      : `<button class="runpill greet" ${open}><span class="rp-txt"><span class="rp-k">Goodnight</span><span class="rp-l">Thank you ${esc(who)}</span></span></button>`;
  } else if (inOrder) {
    pill = `<button class="runpill idle" data-a="open" data-id="${esc(o.id)}" title="Open this works order">
      <span class="dot"></span>
      <span class="rp-txt"><span class="rp-k">Start a task</span><span class="rp-l">WO ${esc(o.wo)}${o.machine ? ' · ' + esc(o.machine) : ''}</span><span class="rp-s">No Tasks are running</span></span>
      <span class="rp-time"><span class="rp-c">${hms(orderMs(o))}</span><span class="rp-k">Total WO time</span></span>
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
        <button class="me" data-a="togglemenu" title="${isOffice() ? 'Account' : 'Sign out'}"><span class="av">${esc(initials(S.fitter))}</span><span>${esc(S.fitter)}</span>${S.admin ? '<span class="admin-chip">Admin</span>' : S.supervisor ? '<span class="admin-chip">Supervisor</span>' : ''}</button>
        ${isOffice() && S.menu ? `<div class="me-menu">
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
  if (S.screen === 'timer') { const s = stageOf(S.stage); c.push({l: s ? 'Stage ' + s.n + ' · ' + s.name : 'Stage'}); }
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
  if (!isOffice()) return '<div class="pad"><div class="empty">You need supervisor or admin permission to open this page.</div></div>';
  const tab = (!S.admin && (S.adminTab === 'settings' || S.adminTab === 'stages' || S.adminTab === 'machines' || S.adminTab === 'functions')) ? 'orders' : (S.adminTab || 'orders');
  const tabs = `<div class="admin-tabs" role="tablist">
      <button class="atab later ${tab === 'orders' ? 'on' : ''}" data-a="admintab" data-tab="orders" role="tab" aria-selected="${tab === 'orders'}">WO live view</button>
      <button class="atab users ${tab === 'users' ? 'on' : ''}" data-a="admintab" data-tab="users" role="tab" aria-selected="${tab === 'users'}">Users</button>
      ${S.admin ? `<button class="atab fns ${tab === 'functions' ? 'on' : ''}" data-a="admintab" data-tab="functions" role="tab" aria-selected="${tab === 'functions'}">Functions</button>
      <button class="atab stages ${tab === 'stages' ? 'on' : ''}" data-a="admintab" data-tab="stages" role="tab" aria-selected="${tab === 'stages'}">Stages</button>
      <button class="atab mach ${tab === 'machines' ? 'on' : ''}" data-a="admintab" data-tab="machines" role="tab" aria-selected="${tab === 'machines'}">Machines</button>
      <button class="atab settings ${tab === 'settings' ? 'on' : ''}" data-a="admintab" data-tab="settings" role="tab" aria-selected="${tab === 'settings'}">Settings</button>` : ''}
    </div>`;
  if (tab === 'settings') return vAdminSettings(tabs);
  if (tab === 'functions') return vAdminFunctions(tabs);
  if (tab === 'stages') return vAdminStages(tabs);
  if (tab === 'machines') return vAdminMachines(tabs);
  if (tab === 'orders') return vAdminOrders(tabs);
  const editing = !!S.teamId;
  const rows = S.teamList.slice().sort((a, b) => Number(b.active) - Number(a.active) || String(a.full_name).localeCompare(String(b.full_name)));
  const roleLocked = editing && S.teamId === S.userId;
  const roleBtns = S.admin ? `<div class="lbl" style="margin-top:14px">Role</div>
      <div class="admin-fields">
        <button class="opt ${S.teamRole === 'user' ? 'on' : ''}" data-a="teamrole" data-role="user" ${roleLocked ? 'disabled' : ''}><span>User</span><small>Shop floor only</small></button>
        <button class="opt ${S.teamRole === 'supervisor' ? 'on' : ''}" data-a="teamrole" data-role="supervisor" ${roleLocked ? 'disabled' : ''}><span>Supervisor</span><small>Live now, users, archive WOs</small></button>
        <button class="opt ${S.teamRole === 'admin' ? 'on' : ''}" data-a="teamrole" data-role="admin" ${roleLocked ? 'disabled' : ''}><span>Admin</span><small>Functions, stages, machines, settings</small></button>
      </div>${roleLocked ? '<div class="meta" style="margin-top:8px">You cannot change your own role.</div>' : ''}` : '';
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
        ${S.admin
          ? `<input class="field" id="f-teamrate" data-f="teamRate" value="${esc(S.teamRate)}" placeholder="Hourly rate £ (optional)" inputmode="decimal" autocomplete="off">`
          : `<div class="meta" style="align-self:center">Hourly rate ${S.teamRate === '' ? 'not set' : esc(gbp(Number(S.teamRate) || 0))}. Only an admin can change it.</div>`}
      </div>
      ${roleBtns}
      <div class="btns" style="margin-top:14px">
        <button class="pill pill-y" data-a="teamsave" ${S.teamBusy ? 'disabled' : ''}>${editing ? 'Save' : 'Add person'}</button>
        ${editing ? `<button class="pill pill-o" data-a="teampass" ${S.teamBusy ? 'disabled' : ''}>Reset passphrase</button>` : ''}
        <button class="pill pill-o" data-a="teamcancel">Cancel</button>
      </div>
    </div>` : ''}
    ${S.teamErr ? `<div class="unlock-err" style="margin:0 0 14px">${esc(S.teamErr)}</div>` : ''}
    ${S.teamMsg ? `<div class="meta" style="margin:0 0 14px;color:var(--green)">${esc(S.teamMsg)}</div>` : ''}
    ${rows.length ? `<div class="atbl">
      <div class="atbl-h"><span>Name</span><span>Email</span><span>Status</span><span>Role</span><span>Rate</span><span>Actions</span></div>
      ${rows.map(f => {
        const self = f.id === S.userId;
        const locked = !S.admin && (f.admin || f.supervisor) && !self;
        return `<div class="atbl-r ${f.active ? '' : 'off'}">
          <span><b>${esc(f.full_name)}</b></span>
          <span>${esc(f.email)}</span>
          <span>${f.active ? 'Active' : 'Archived'}</span>
          <span>${personRole(f)}</span>
          <span>${f.hourly_rate == null || f.hourly_rate === '' ? '—' : gbp(Number(f.hourly_rate))}</span>
          <span class="atbl-a">
            <button class="pill pill-o atbl-b" data-a="teamedit" data-id="${esc(f.id)}" ${locked ? 'disabled' : ''}>Edit</button>
            ${f.active
              ? `<button class="pill pill-o atbl-b" data-a="teamarchive" data-id="${esc(f.id)}" ${self || S.teamBusy || locked ? 'disabled' : ''}>Archive</button>`
              : `<button class="pill pill-o atbl-b" data-a="teamrestore" data-id="${esc(f.id)}" ${S.teamBusy || locked ? 'disabled' : ''}>Restore</button>`}
            ${S.admin && !self ? (f.supervisor
              ? `<button class="pill pill-o atbl-b" data-a="teamsetrole" data-id="${esc(f.id)}" data-role="user" ${S.teamBusy ? 'disabled' : ''}>Remove supervisor</button>`
              : f.admin
                ? `<button class="pill pill-o atbl-b" data-a="teamsetrole" data-id="${esc(f.id)}" data-role="user" ${S.teamBusy ? 'disabled' : ''}>Remove admin</button>`
                : `<button class="pill pill-o atbl-b" data-a="teamsetrole" data-id="${esc(f.id)}" data-role="supervisor" ${S.teamBusy ? 'disabled' : ''}>Make supervisor</button>
                   <button class="pill pill-o atbl-b" data-a="teamsetrole" data-id="${esc(f.id)}" data-role="admin" ${S.teamBusy ? 'disabled' : ''}>Make admin</button>`)
            : ''}
          </span>
        </div>`;
      }).join('')}
    </div>` : `<div class="empty">${S.teamBusy ? 'Loading…' : 'No people yet. Add the first person.'}</div>`}
  </div></div>`;
}

function procNote() {
  return `${S.procErr ? `<div class="unlock-err" style="margin:0 0 14px">${esc(S.procErr)}</div>` : ''}${S.procMsg ? `<div class="meta" style="margin:0 0 14px;color:var(--green)">${esc(S.procMsg)}</div>` : ''}`;
}

function vAdminFunctions(tabs) {
  const rows = functionList();
  const swatches = FN_SWATCHES.slice();
  if (S.fnPick && swatches.indexOf(S.fnPick) < 0) swatches.push(S.fnPick);
  return `<div class="scroll" data-scroll="admin"><div class="pad">
    ${tabs}
    <div class="board-head">
      <div><h2 class="h2">Functions</h2><div class="meta" style="margin-top:8px">Functions group the stages and set their colour. Renaming or recolouring updates every stage that uses that function. A function that is still on a stage cannot be deleted.</div></div>
      <button class="pill pill-y" data-a="fnnew" ${S.procBusy ? 'disabled' : ''}>+ Add function</button>
    </div>
    ${S.fnForm ? `<div class="admin-form">
      <div class="lbl">${S.fnEdit ? 'Edit function' : 'New function'}</div>
      <input class="field" id="f-fnname" data-f="fnName" value="${esc(S.fnName)}" placeholder="Function name" autocomplete="off">
      <div class="lbl" style="margin-top:14px">Colour</div>
      <div class="fn-colours">
        ${swatches.map(c => `<button type="button" class="fn-swatch ${S.fnPick === c ? 'on' : ''}" data-a="fnpick" data-colour="${c}" style="background:${c}" aria-label="${c}" ${S.procBusy ? 'disabled' : ''}></button>`).join('')}
        <input class="fn-colour-input" id="f-fncolour" data-f="fnPick" type="color" value="${esc(S.fnPick)}" aria-label="Custom colour" ${S.procBusy ? 'disabled' : ''}>
      </div>
      <div class="btns" style="margin-top:14px">
        <button class="pill pill-y" data-a="fnsave" ${S.procBusy ? 'disabled' : ''}>${S.fnEdit ? 'Save function' : 'Add function'}</button>
        <button class="pill pill-o" data-a="fncancel">Cancel</button>
      </div>
    </div>` : ''}
    ${procNote()}
    ${rows.length ? `<div class="atbl fns">
      <div class="atbl-h"><span></span><span>Function</span><span>Stages</span><span>Actions</span></div>
      ${rows.map((f, i) => {
        const used = catalog().filter(s => s.fn === f.name).length;
        return `<div class="atbl-r">
          <span><span class="fn-dot" style="background:${esc(f.colour)}"></span></span>
          <span style="color:${esc(f.colour)}"><b>${esc(f.name)}</b></span>
          <span>${used}</span>
          <span class="atbl-a">
            <button class="pill pill-o atbl-b" data-a="fnedit" data-name="${esc(f.name)}" ${S.procBusy ? 'disabled' : ''}>Edit</button>
            <button class="pill pill-o atbl-b" data-a="fnmove" data-name="${esc(f.name)}" data-dir="-1" ${i === 0 || S.procBusy ? 'disabled' : ''}>Up</button>
            <button class="pill pill-o atbl-b" data-a="fnmove" data-name="${esc(f.name)}" data-dir="1" ${i === rows.length - 1 || S.procBusy ? 'disabled' : ''}>Down</button>
            <button class="pill pill-o atbl-b" data-a="fndelete" data-name="${esc(f.name)}" ${S.procBusy ? 'disabled' : ''}>${S.fnConfirm === f.name ? 'Confirm delete' : 'Delete'}</button>
          </span>
        </div>`;
      }).join('')}
    </div>` : '<div class="empty">No functions yet. Add the first one.</div>'}
  </div></div>`;
}

function vAdminStages(tabs) {
  const rows = catalog().slice().sort((a, b) => a.n - b.n);
  return `<div class="scroll" data-scroll="admin"><div class="pad">
    ${tabs}
    <div class="board-head">
      <div><h2 class="h2">Stages</h2><div class="meta" style="margin-top:8px">The master list. A stage appears on the shop floor only after you add it to a machine. Its colour comes from the function you choose.</div></div>
      <button class="pill pill-y" data-a="stagenew" ${S.procBusy ? 'disabled' : ''}>+ Add stage</button>
    </div>
    ${S.stageForm ? `<div class="admin-form">
      <div class="lbl">${S.stageEdit ? 'Edit stage ' + S.stageEdit : 'New stage'}</div>
      <div class="admin-fields">
        <input class="field" id="f-stagename" data-f="stageName" value="${esc(S.stageName)}" placeholder="Stage name" autocomplete="off">
        <textarea class="field" id="f-stagetasks" data-f="stageTasks" placeholder="Key tasks, one per line" rows="4">${esc(S.stageTasks)}</textarea>
      </div>
      <div class="lbl" style="margin-top:14px">Function</div>
      <div class="chips">${functionList().map(f => `<button class="chip ${S.stageFn === f.name ? 'on' : ''}" data-a="stagefn" data-fn="${esc(f.name)}" style="border-color:${f.colour}"><span style="color:${f.colour}">${esc(f.name)}</span></button>`).join('') || '<span class="meta">Add a function first.</span>'}</div>
      <div class="btns" style="margin-top:14px">
        <button class="pill pill-y" data-a="stagesave" ${S.procBusy ? 'disabled' : ''}>${S.stageEdit ? 'Save stage' : 'Add stage'}</button>
        <button class="pill pill-o" data-a="stagecancel">Cancel</button>
      </div>
    </div>` : ''}
    ${procNote()}
    ${rows.length ? `<div class="atbl stages">
      <div class="atbl-h"><span>#</span><span>Stage</span><span>Function</span><span>Tasks</span><span>Status</span><span>Actions</span></div>
      ${rows.map(s => `<div class="atbl-r ${s.retired ? 'off' : ''}">
        <span>${s.n}</span>
        <span><b>${esc(s.name)}</b></span>
        <span style="color:${s.colour}">${esc(s.fn)}</span>
        <span>${(s.tasks || []).length ? esc(s.tasks.join(' · ')) : '—'}</span>
        <span>${s.retired ? 'Retired' : 'Active'}</span>
        <span class="atbl-a">
          <button class="pill pill-o atbl-b" data-a="stageedit" data-n="${s.n}" ${S.procBusy ? 'disabled' : ''}>Edit</button>
          ${s.retired
            ? `<button class="pill pill-o atbl-b" data-a="stagerestore" data-n="${s.n}" ${S.procBusy ? 'disabled' : ''}>Restore</button>`
            : `<button class="pill pill-o atbl-b" data-a="stageretire" data-n="${s.n}" ${S.procBusy ? 'disabled' : ''}>Delete</button>`}
        </span>
      </div>`).join('')}
    </div>` : '<div class="empty">No stages yet.</div>'}
  </div></div>`;
}

function vAdminMachines(tabs) {
  const list = machineList();
  const machine = list.some(m => m.name === S.procMachine) ? S.procMachine : (list[0] ? list[0].name : '');
  if (machine && machine !== S.procMachine) S.procMachine = machine;
  const on = machine ? processStages(machine) : [];
  const onIds = {};
  on.forEach(s => { onIds[s.n] = true; });
  const off = catalog().filter(s => !s.retired && !onIds[s.n]).sort((a, b) => a.n - b.n);
  return `<div class="scroll" data-scroll="admin"><div class="pad">
    ${tabs}
    <div class="board-head">
      <div><h2 class="h2">Machines</h2><div class="meta" style="margin-top:8px">Add a machine, rename it, or delete it when no works order uses it. Tick the stages it uses. Ticked stages run in the order shown. Blank reference means no reference.</div></div>
      <button class="pill pill-y" data-a="machinenew" ${S.procBusy ? 'disabled' : ''}>+ Add machine</button>
    </div>
    ${S.machineForm ? `<div class="admin-form">
      <div class="lbl">${S.machineEdit ? 'Rename machine' : 'New machine'}</div>
      <input class="field" id="f-machinename" data-f="machineName" value="${esc(S.machineName)}" placeholder="Machine name" autocomplete="off">
      <div class="btns" style="margin-top:14px">
        <button class="pill pill-y" data-a="machinesave" ${S.procBusy ? 'disabled' : ''}>${S.machineEdit ? 'Save name' : 'Add machine'}</button>
        <button class="pill pill-o" data-a="machinecancel">Cancel</button>
      </div>
    </div>` : ''}
    ${procNote()}
    <div class="chips" style="margin-bottom:12px">${list.map(m => `<button class="chip ${machine === m.name ? 'on' : ''}" data-a="procmachine" data-name="${esc(m.name)}">${esc(m.name)}</button>`).join('')}</div>
    ${machine ? `<div class="btns" style="margin-bottom:16px">
      <button class="pill pill-o" data-a="machineedit" ${S.procBusy ? 'disabled' : ''}>Edit name</button>
      <button class="pill pill-o" data-a="machinedelete" ${S.procBusy ? 'disabled' : ''}>${S.machineConfirm === machine ? 'Confirm delete' : 'Delete machine'}</button>
    </div>
    <div class="lbl">Stages for ${esc(machine)}</div>
    ${(() => {
      const rows = on.map(s => Object.assign({on:true}, s)).concat(off.map(s => Object.assign({on:false, ref:null}, s)));
      if (!rows.length) return '<div class="empty">No stages yet. Add them on the Stages tab.</div>';
      return rows.map(s => {
        const at = s.on ? on.findIndex(x => x.n === s.n) : -1;
        return `<div class="proc-row ${s.on ? '' : 'proc-off'}">
          <label class="tick"><input type="checkbox" data-a="proctick" data-n="${s.n}" ${s.on ? 'checked' : ''} ${S.procBusy ? 'disabled' : ''} aria-label="${s.on ? 'Included' : 'Not included'}"></label>
          <span class="snum">${s.n}</span>
          <span><span class="sfn" style="color:${s.colour}">${esc(s.fn)}</span><span class="sname">${esc(s.name)}</span></span>
          ${s.on ? `<label class="proc-ref">Reference min
            <input class="field" id="f-ref-${s.n}" data-ref="${s.n}" inputmode="numeric" value="${s.ref == null ? '' : s.ref}" placeholder="No ref" autocomplete="off" ${S.procBusy ? 'disabled' : ''}>
          </label>
          <span class="atbl-a">
            <button class="pill pill-o atbl-b" data-a="procmove" data-n="${s.n}" data-dir="-1" ${at === 0 || S.procBusy ? 'disabled' : ''}>Up</button>
            <button class="pill pill-o atbl-b" data-a="procmove" data-n="${s.n}" data-dir="1" ${at === on.length - 1 || S.procBusy ? 'disabled' : ''}>Down</button>
          </span>` : '<span></span><span></span>'}
        </div>`;
      }).join('');
    })()}` : '<div class="empty">No machines yet. Add the first one.</div>'}
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
  if (r.active) { const s = woActiveStart(r.active); if (s) t += spanCount(s, Date.now()).counted; }
  return t;
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

function vLiveNow() {
  const live = woLiveJobs();
  return `<div class="live-now">
      <div class="lbl">Live now</div>
      ${live.length ? `<div class="live-cards">${live.map(r => {
        const stg = stageOf(r.active.stage);
        const prog = stageProgress(r);
        return `<button type="button" class="live-card" data-a="open" data-id="${esc(r.id)}">
          <div class="live-top"><span class="wo">WO ${esc(r.wo)}</span><span class="status st-run">Running</span></div>
          <div class="meta">${esc(r.customer || '—')} · ${esc(r.machine || '—')}</div>
          <div class="live-who">On now: ${esc(r.active.fitter || '—')} · Stage ${r.active.stage}${stg ? ' · ' + esc(stg.name) : ''}</div>
          <div class="live-time-lbl">Total WO time</div>
          <div class="live-time">${hm(woLoggedMs(r) / 6e4)}</div>
          <div class="small">${prog.pct}% complete · ${prog.done} of ${prog.total} stages</div>
          <div class="bar"><i style="width:${prog.pct}%"></i></div>
        </button>`;
      }).join('')}</div>` : `<div class="live-empty">No timers running.</div>`}
    </div>`;
}

function vAdminOrders(tabs) {
  const rows = woVisible();
  const nSel = Object.keys(S.woSel).filter(id => S.woSel[id]).length;
  const selRows = (S.woList || []).filter(r => S.woSel[r.id]);
  const selMs = selRows.reduce((a, r) => a + woLoggedMs(r), 0);
  const allOn = rows.length && rows.every(r => S.woSel[r.id]);
  return `<div class="scroll" data-scroll="admin"><div class="pad">
    ${tabs}
    <div class="board-head">
      <div>
        <h2 class="h2">Works orders</h2>
        <div class="meta" style="margin-top:8px">${S.admin ? 'Archive hides a job from the shop list. Delete removes it and its times. Tick rows to email a to-date total report.' : 'All running jobs and the shop works order list. Archive hides a job from the shop. Tick rows to email a to-date total report.'}</div>
      </div>
      <div class="btns">
        <button class="pill pill-y" data-a="wototal" ${S.teamBusy || S.woSend === 'sending' ? 'disabled' : ''}>${S.woSend === 'sending' ? 'Sending…' : 'Email total report' + (nSel ? ' (' + nSel + ')' : '')}</button>
      </div>
    </div>
    ${vLiveNow()}
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
        const st = r.archived ? 'Archived' : running ? 'Timer running' : r.done ? 'Finished' : 'Paused';
        const on = !!S.woSel[r.id];
        const confirm = S.woConfirm === r.id;
        const prog = stageProgress(Object.assign({}, r, { machine: (local && local.machine) || r.machine, complete: (local && local.complete) || r.complete || [] }));
        return `<div class="atbl-r ${r.archived ? 'off' : ''}">
          <span><button class="opt ${on ? 'on' : ''}" data-a="wotoggle" data-id="${esc(r.id)}" ${S.teamBusy ? 'disabled' : ''}><span>${on ? 'Selected' : 'Select'}</span></button></span>
          <span><b>WO ${esc(r.wo)}</b></span>
          <span>${esc(r.customer || '—')}</span>
          <span>${esc(r.machine || '—')}</span>
          <span>${r.qty || 1}</span>
          <span>${hm(woLoggedMs(r) / 6e4)}</span>
          <span>${prog.done} of ${prog.total} · ${prog.pct}%</span>
          <span>${st}</span>
          <span class="atbl-a">
            ${confirm && S.admin ? `<span class="meta" style="flex:1 1 100%">Delete WO ${esc(r.wo)}? This cannot be undone.</span>
              <button class="pill pill-y atbl-b" data-a="wodelete" data-id="${esc(r.id)}" ${S.teamBusy ? 'disabled' : ''}>Delete forever</button>
              <button class="pill pill-o atbl-b" data-a="wocanceldel">Cancel</button>`
            : `${r.archived
                ? `<button class="pill pill-o atbl-b" data-a="worestore" data-id="${esc(r.id)}" ${S.teamBusy || running ? 'disabled' : ''}>Restore</button>`
                : `<button class="pill pill-o atbl-b" data-a="woarchive" data-id="${esc(r.id)}" ${S.teamBusy || running ? 'disabled' : ''}>Archive</button>`}
              ${S.admin ? `<button class="pill pill-o atbl-b" data-a="wodelete" data-id="${esc(r.id)}" ${S.teamBusy || running ? 'disabled' : ''}>Delete</button>` : ''}`}
          </span>
        </div>`;
      }).join('')}
    </div>` : `<div class="empty">${S.teamBusy ? 'Loading…' : (S.woFilter === 'archived' ? 'No archived works orders.' : 'No works orders on the shop list.')}</div>`}
  </div></div>`;
}

function orderActivity(o) {
  let t = o.createdAt || 0;
  if (o.finishedAt) t = Math.max(t, o.finishedAt);
  (o.runs || []).forEach(r => { if (r.start) t = Math.max(t, r.start); if (r.stop) t = Math.max(t, r.stop); });
  (o.notes || []).forEach(n => { if (n.at) t = Math.max(t, n.at); });
  if (o.active) t = Math.max(t, woActiveStart(o.active) || t);
  return t;
}
function cmpWo(a, b) {
  return String(a.wo || '').localeCompare(String(b.wo || ''), 'en', {numeric:true, sensitivity:'base'});
}
function cmpBoard(a, b) {
  const live = o => o.active ? 0 : 1;
  if (live(a) !== live(b)) return live(a) - live(b);
  if (S.boardSort === 'wo') return cmpWo(a, b);
  if (S.boardSort === 'customer') return String(a.customer || '').localeCompare(String(b.customer || ''), 'en', {sensitivity:'base'}) || cmpWo(a, b);
  if (S.boardSort === 'machine') return String(a.machine || '').localeCompare(String(b.machine || ''), 'en', {sensitivity:'base'}) || cmpWo(a, b);
  return orderActivity(b) - orderActivity(a) || (b.createdAt || 0) - (a.createdAt || 0);
}
function vBoard() {
  const shop = S.orders.filter(o => !o.archived);
  const list = shop.filter(o => {
    if (S.boardFilter === 'running') return !!o.active;
    if (S.boardFilter === 'paused') return !o.done && !o.active;
    if (S.boardFilter === 'finished') return !!o.done;
    return true;
  }).sort(cmpBoard);
  const today = new Date().toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
  const opt = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
  return `<div class="scroll" data-scroll="board"><div class="pad">
    <div class="board-head">
      <div><div class="today">Today · ${today}</div><h2 class="h2">Works orders</h2></div>
      ${isOffice() ? `<div class="btns"><button class="pill pill-o" data-a="report">End of day report</button><button class="pill pill-y" data-a="new">+ New works order</button></div>` : ''}
    </div>
    <div class="board-tools">
      <label class="board-tool">Filter
        <select id="f-boardfilter" data-f="boardFilter">
          ${opt('all', 'All', S.boardFilter)}
          ${opt('running', 'Running', S.boardFilter)}
          ${opt('paused', 'Paused', S.boardFilter)}
          ${opt('finished', 'Finished', S.boardFilter)}
        </select>
      </label>
      <label class="board-tool">Sort by
        <select id="f-boardsort" data-f="boardSort">
          ${opt('activity', 'Recent activity', S.boardSort)}
          ${opt('wo', 'Works order', S.boardSort)}
          ${opt('customer', 'Customer', S.boardSort)}
          ${opt('machine', 'Machine', S.boardSort)}
        </select>
      </label>
    </div>
    ${list.length ? `<div class="cards">${list.map(o => {
      const st = o.done ? ['Finished','st-done'] : o.active ? ['Running','st-run'] : ['Paused','st-prog'];
      const line = [o.customer, o.machine, 'Qty ' + o.qty + (o.qty > 1 ? ' · ' + (o.mode === 'batch' ? 'batch timer' : 'per unit') : '')].join('  ·  ');
      const nn = o.notes.length;
      const prog = stageProgress(o);
      return `<button class="card" data-a="open" data-id="${o.id}">
        <div style="min-width:0"><div class="card-t"><span class="wo">WO ${esc(o.wo)}</span><span class="status ${st[1]}">${st[0]}</span></div>
        <div class="meta">${esc(line)}</div><div class="bar"><i style="width:${prog.pct}%"></i></div></div>
        <div class="card-r"><div class="big-t">${hm(orderMs(o) / 6e4)}</div><div class="small">${prog.done} of ${prog.total} stages</div>${nn ? `<div class="tiny">${nn} note${nn > 1 ? 's' : ''}</div>` : ''}</div>
      </button>`;
    }).join('')}</div>` : `<div class="empty">${shop.length ? 'No works orders match this filter.' : 'Nothing open. Start a works order to begin timing.'}</div>`}
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
        <div class="machines">${machineList().map(m => {
          const has = processStages(m.name).some(s => s.ref != null);
          return `<button class="opt ${S.machine === m.name ? 'on' : ''}" data-a="machine" data-name="${esc(m.name)}"><span>${esc(m.name)}</span><small>${has ? 'Ref times' : 'No ref yet'}</small></button>`;
        }).join('')}</div>
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
  const prog = stageProgress(o);
  const remaining = prog.total - prog.done;
  const hint = o.done ? 'Finished ' + hhmm(o.finishedAt) + ' · included in tonight\u2019s report'
    : remaining ? remaining + ' stage' + (remaining > 1 ? 's' : '') + ' still to complete. Stages can be done in any order.' : 'All ' + prog.total + ' stages complete.';
  const notes = o.notes.slice().reverse();
  const orderTally = tallyRanges(collectRanges(o, null, null, false));
  const orderBreak = breakText(orderTally);
  const orderCost = costText(orderTally);
  return `<div class="ohead">
      <div><div class="lbl">${esc([o.customer, o.machine, 'Qty ' + o.qty].join('  ·  '))}</div><div class="otitle">WO ${esc(o.wo)}</div></div>
      <div style="display:flex;align-items:center;gap:16px">
        ${pu ? `<div class="units"><span class="lbl">Unit</span>${Array.from({length:o.qty}, (_, i) => i + 1).map(n => `<button class="unit ${S.unit === n ? 'on' : ''}" data-a="unit" data-n="${n}">${n}</button>`).join('')}</div>` : ''}
        <div style="text-align:right"><div class="big-t" style="font-size:20px">${hm(orderTally.counted / 6e4)}</div><div class="small">Counted</div>${orderBreak ? `<div class="brk">${esc(orderBreak)}</div>` : ''}${orderCost ? `<div class="cost">${esc(orderCost)}</div>` : ''}</div>
      </div>
    </div>
    <div class="scroll" data-scroll="stages"><div class="pad" style="padding-top:16px">
      <div class="stagelist">${orderStages(o).map(s => {
        const done = o.complete.includes(s.n);
        const run = o.active && o.active.stage === s.n && (!pu || o.active.unit === S.unit);
        const tally = tallyRanges(collectRanges(o, s.n, uf, false));
        const t = tally.counted;
        const brk = breakText(tally);
        const cost = costText(tally);
        const chip = run ? ['Running','run'] : done ? ['Complete','done'] : t > 0 ? ['Paused','prog'] : ['Not started',''];
        const liveCounted = run ? spanCount(woActiveStart(o.active), Date.now()).counted : 0;
        return `<div class="srow ${run ? 'run' : ''} ${done ? 'done' : ''} ${s.extra ? 'extra' : ''}" style="border-left-color:${s.colour}">
          <button class="sopen" data-a="stage" data-n="${s.n}">
            <span class="snum">${s.n}</span>
            <span style="min-width:0"><span class="sfn" style="color:${s.colour}">${s.fn}</span><span class="sname">${esc(s.name)}</span>${s.extra ? '<span class="sextra">Not on this machine</span>' : ''}</span>
            <span class="stime"><b>${t > 0 ? hm(t / 6e4) : '—'}</b><small>${refText(s.ref)}</small>${brk ? `<small class="brk">${esc(brk)}</small>` : ''}${cost ? `<small class="cost">${esc(cost)}</small>` : ''}</span>
            <span class="schip ${chip[1]}">${chip[0]}</span>
          </button>
          ${s.extra && !run ? '' : `<button class="sgo ${run ? 'on' : ''}" data-a="stagetoggle" data-n="${s.n}">${run ? 'Stop<small>' + clock(liveCounted) + '</small>' : 'Start'}</button>`}
        </div>`;
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
  const s = orderStages(o).find(x => x.n === S.stage) || stageOf(S.stage);
  if (!s) return '<div class="pad"><div class="empty">This stage is no longer on the list.</div></div>';
  const pu = perUnit(o); const uf = pu ? S.unit : null;
  const run = o.active && o.active.stage === s.n && (!pu || o.active.unit === S.unit);
  const done = o.complete.includes(s.n);
  const tally = tallyRanges(collectRanges(o, s.n, uf, false));
  const t = tally.counted;
  const liveStart = run ? woActiveStart(o.active) : 0;
  const liveSpan = run ? spanCount(liveStart, Date.now()) : null;
  const runs = o.runs.filter(r => r.stage === s.n && (!pu || r.unit === S.unit));
  const ref = s.ref == null ? 'No reference time for this stage  ·  counted so far ' + hm(t / 6e4) : 'Reference ' + hm(s.ref) + '  ·  counted so far ' + hm(t / 6e4);
  const overtime = shopClosed() ? ' Overtime after 4:30pm still logs until you press Stop.' : '';
  const brk = breakText(tally);
  const cost = costText(tally);
  const editing = isOffice() && S.runEdit && (S.runEdit === 'new' || runs.some(r => r.id === S.runEdit));
  const runCost = r => {
    if (!isOffice()) return '';
    const p = spanCount(r.start, r.stop);
    if (p.counted <= 0) return '';
    if (r.rate == null) return 'No rate';
    return gbp((p.counted / 36e5) * Number(r.rate));
  };
  return `<div class="timer">
    <div class="tmain">
      <div class="tfn" style="color:${s.colour}"><i style="background:${s.colour}"></i>Stage ${s.n} · ${s.fn}</div>
      <h2 class="tname">${esc(s.name)}</h2>
      <div class="tsub">${esc('WO ' + o.wo + '  ·  ' + o.machine + (pu ? '  ·  Unit ' + S.unit + ' of ' + o.qty : ''))}</div>
      <div class="panel ${run ? 'run' : ''}">
        <div class="pl"><div class="lbl">${run ? 'Running now' : t > 0 ? 'Counted on this stage' : 'Not started'}</div>
        <div class="clock">${run ? clock(Date.now() - liveStart) : clock(t)}</div>
        <div class="ref">${ref}${overtime}</div>
        ${run ? `<div class="counted">Counted ${hm(liveSpan.counted / 6e4)} on this run</div>` : ''}
        ${brk ? `<div class="brk">${esc(brk)}</div>` : ''}
        ${cost ? `<div class="cost">${esc(cost)}</div>` : ''}
        </div>
      </div>
      <button class="complete ${done ? 're' : ''}" data-a="complete">${done ? 'Reopen stage' : 'Mark stage complete'}</button>
    </div>
    <div class="tside">
      <button class="ss ${run ? 'on' : ''}" data-a="toggle" ${s.extra && !run ? 'disabled' : ''}>${s.extra && !run ? 'Not on this machine' : run ? 'Stop' : 'Start'}</button>
      <div class="tasks"><div class="lbl">Key tasks</div>${(s.tasks || []).map(x => `<div class="task">${esc(x)}</div>`).join('')}</div>
      <div class="runs"><div class="runs-h"><span class="lbl">Runs</span><span>${runs.length + (run ? 1 : 0)} run${runs.length + (run ? 1 : 0) === 1 ? '' : 's'}</span></div>
        ${isOffice() ? `<div class="run-tools"><button class="pill pill-o atbl-b" data-a="runadd">Add time</button></div>` : ''}
        ${editing ? `<div class="run-form">
          <div class="lbl">${S.runEdit === 'new' ? 'Add time' : 'Edit time'}</div>
          <label class="tiny" for="f-runstart">Start</label>
          <input class="field" id="f-runstart" data-f="runStart" type="datetime-local" value="${esc(S.runStart)}">
          <label class="tiny" for="f-runstop">Stop</label>
          <input class="field" id="f-runstop" data-f="runStop" type="datetime-local" value="${esc(S.runStop)}">
          ${S.runErr ? `<div class="unlock-err">${esc(S.runErr)}</div>` : ''}
          <div class="btns" style="margin-top:10px">
            <button class="pill pill-y atbl-b" data-a="runsave">Save</button>
            <button class="pill pill-o atbl-b" data-a="runcancel">Cancel</button>
          </div>
        </div>` : ''}
        ${runs.map(r => {
          const p = spanCount(r.start, r.stop);
          const line = breakText(p);
          const pounds = runCost(r);
          return `<div class="run"><span><b>${hhmm(r.start)} → ${hhmm(r.stop)}</b><small>${esc(r.fitter)}</small>${line ? `<small class="brk">${esc(line)}</small>` : ''}${pounds ? `<small class="cost">${esc(pounds)}</small>` : ''}</span><strong>${hm(p.counted / 6e4)}</strong>
            ${isOffice() ? `<span class="run-a"><button class="pill pill-o atbl-b" data-a="runedit" data-id="${esc(r.id)}">Edit</button><button class="pill pill-o atbl-b" data-a="rundelete" data-id="${esc(r.id)}">${S.runDelete === r.id ? 'Confirm delete' : 'Delete'}</button></span>` : ''}
          </div>`;
        }).join('')}
        ${run ? `<div class="run live"><span><b>${hhmm(liveStart)} → running</b><small>${esc(o.active.fitter)}</small>${breakText(liveSpan) ? `<small class="brk">${esc(breakText(liveSpan))}</small>` : ''}</span><strong>${hm(liveSpan.counted / 6e4)}</strong></div>` : ''}
        ${!runs.length && !run ? '<div class="muted">No time logged on this stage yet.</div>' : ''}
      </div>
    </div>
  </div>`;
}

function vFinish(o) {
  const orderTally = tallyRanges(collectRanges(o, null, null, false));
  const total = orderTally.counted / 6e4;
  const stages = orderStages(o);
  const refs = stages.filter(s => !s.extra && s.ref != null).map(s => Number(s.ref));
  const refTotal = refs.length ? refs.reduce((a, n) => a + n, 0) : null;
  const line = refTotal == null ? 'No reference times for this machine yet.'
    : (total >= refTotal ? '+' : '−') + hm(Math.abs(total - refTotal)) + ' against the reference of ' + hm(refTotal) + '.';
  const brk = breakText(orderTally);
  const cost = costText(orderTally);
  return `<div class="pad" style="padding-bottom:12px;flex:none"><h2 class="h2" style="font-size:26px">Finish job · WO ${esc(o.wo)}</h2><div class="meta" style="margin-top:6px">${esc([o.customer, o.machine, 'Qty ' + o.qty].join('  ·  '))}</div></div>
    <div class="scroll" data-scroll="finish"><div style="padding:0 26px 20px">
      <div class="tbl h"><span>#</span><span>Process stage</span><span class="r">Reference</span><span class="r">Counted</span></div>
      ${stages.map(s => {
        const tally = tallyRanges(collectRanges(o, s.n, null, false));
        const ded = breakText(tally);
        return `<div class="tbl"><span class="n">${s.n}</span><span>${esc(s.name)}${s.extra ? ' <small class="sextra">Not on this machine</small>' : ''}${ded ? `<small class="brk" style="display:block;margin-top:4px">${esc(ded)}</small>` : ''}</span><span class="r" style="color:var(--g3)">${s.ref == null ? '—' : hm(s.ref)}</span><span class="r" style="font-weight:700">${hm(tally.counted / 6e4)}</span></div>`;
      }).join('')}
      <div class="tbl t"><span></span><span style="font:900 12px/1 var(--font);letter-spacing:.08em;text-transform:uppercase">Works order total</span><span class="r" style="color:var(--g3)">${refTotal == null ? '—' : hm(refTotal)}</span><span class="r" style="font-weight:900;font-size:16px">${hm(total)}</span></div>
      ${brk ? `<div class="brk" style="margin-top:10px">${esc(brk)}</div>` : ''}
      ${cost ? `<div class="cost" style="margin-top:6px">${esc(cost)}</div>` : ''}
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
        const rows = orderStages(o).filter(s => tallyRanges(collectRanges(o, s.n, null, true)).elapsed > 0);
        const dayTally = tallyRanges(collectRanges(o, null, null, true));
        const tot = dayTally.counted / 6e4;
        const brk = breakText(dayTally);
        const cost = costText(dayTally);
        return `<div style="display:flex;gap:10px;align-items:baseline;margin-bottom:9px"><b style="font:900 15px/1 var(--font)">WO ${esc(o.wo)}</b><span class="meta" style="font-size:12px">${esc([o.customer, o.machine, 'Qty ' + o.qty].join(' · '))}</span></div>
          ${o.notes.length ? `<div class="nbox" style="margin:0 0 9px;padding:9px 12px;font-size:12px">Notes: ${esc(o.notes.map(n => n.text).join('  ·  '))}</div>` : ''}
          <div class="rtbl">${rows.map(s => {
            const st = tallyRanges(collectRanges(o, s.n, null, true));
            const m = st.counted / 6e4;
            const ded = breakText(st);
            return `<div class="rrow"><span style="color:var(--g3)">${s.n}</span><span style="color:var(--ink)">${esc(s.name)}${ded ? `<small class="brk" style="display:block">${esc(ded)}</small>` : ''}</span><span class="r">${hm(m)}</span><span class="r" style="color:var(--g3)">${(m / 60).toFixed(2)}</span></div>`;
          }).join('')}
          <div class="rrow t"><span></span><span>Today counted</span><span class="r">${hm(tot)}</span><span class="r" style="color:var(--g4)">${(tot / 60).toFixed(2)}</span></div></div>
          ${brk ? `<div class="brk" style="margin:-8px 0 14px">${esc(brk)}</div>` : ''}
          ${cost ? `<div class="cost" style="margin:-4px 0 14px">${esc(cost)}</div>` : ''}`;
      }).join('') : '<div class="empty">No time logged today yet.</div>'}
      <div class="tiny" style="line-height:1.5">Times are counted after weekday breaks. The spreadsheet also shows the break taken off, the rate, the cost, totals to date per stage, every start and stop, and hours by function and fitter.</div>
    </div>
    <div class="sheet-f"><button class="pill pill-o" data-a="closereport">Close</button>
      <span class="msg ${S.sendState === 'error' ? 'err' : ''}" style="flex:1;text-align:right;white-space:pre-wrap">${esc(S.sendMsg)}</span>
      ${isOffice() ? `<button class="pill ${S.sendState === 'sent' ? 'pill-d' : 'pill-y'}" data-a="send" ${S.sendState === 'sending' ? 'disabled' : ''}>${btn}</button>` : ''}</div>
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
  if (S.screen === 'admin') body = isOffice() ? vAdmin() : (S.screen = 'board', vBoard());
  if (S.screen === 'new') body = isOffice() ? vNew() : (S.screen = 'board', vBoard());
  if (S.screen === 'stages') body = vStages(o);
  if (S.screen === 'timer') body = vTimer(o);
  if (S.screen === 'finish') body = vFinish(o);
  return `<div class="app">${vTop()}${S.screen !== 'board' ? vCrumbs() : ''}<main class="main">${body}</main>${S.showReport && isOffice() ? vReport() : ''}</div>`;
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
  const f = e.target.dataset.f; if (!f || e.target.tagName === 'SELECT') return;
  S[f] = e.target.value;
  if (e.target.type === 'color') return;
  if (f === 'pass' || f === 'teamPass' || f === 'intSecret' || f === 'intTestTo' || f === 'teamRate' || f === 'runStart' || f === 'runStop') { S.unlockError = ''; return; }
  render();
});
root.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.ref != null) {
    actions.procref({ n: e.target.dataset.ref, value: e.target.value });
    return;
  }
  if (e.target.type === 'color' && e.target.dataset.f) {
    S[e.target.dataset.f] = String(e.target.value || '').toLowerCase();
    render();
    return;
  }
  const f = e.target.dataset.f; if (!f || e.target.tagName !== 'SELECT') return;
  S[f] = e.target.value;
  render();
});
root.addEventListener('submit', e => { e.preventDefault(); if (S.screen === 'unlock') actions.unlock(); });
root.addEventListener('keydown', e => { touchActivity(); });

let greetShown = greetingKind();
setInterval(() => {
  if (S.unlocked || S.handover) {
    if (applyCloseOfDay()) flush();
  }
  if (!S.unlocked) return;
  const g = greetingKind();
  const greetChanged = g !== greetShown;
  greetShown = g;
  const liveShop = S.orders.some(o => o.active);
  const liveAdmin = S.screen === 'admin' && S.adminTab === 'orders' && ((S.woList || []).some(r => r.active) || S.orders.some(o => o.active));
  const choosing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if ((liveShop || liveAdmin || greetChanged) && !S.runEdit && !choosing) render();
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
  loadProcess();
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
