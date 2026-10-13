// Build Mate prototype logic — reference only. State, data model, stage list and all rules live here.
// In the prototype this class is mounted by a small runtime; renderVals() returns the values the template reads.

const STAGES = [
  {n:1,fn:'FABRICATION',colour:'#00a3e0',name:'Fabricate',ref:0,tasks:['Main Frame (UK)','Prime (UK)','Outsourced — no internal time expected']},
  {n:2,fn:'STORES',colour:'#8c4799',name:'Pick Parts',ref:40,tasks:['Pick all components (excluding fixings)']},
  {n:3,fn:'ASSEMBLY',colour:'#e57200',name:'Sub-assemble Main Frame',ref:60,tasks:['Main Frame (UK)','Wheels','Towbar','Axle']},
  {n:4,fn:'ASSEMBLY',colour:'#e57200',name:'Sub-assemble Engine & Preparation',ref:60,tasks:['Engine & W/Loom (UK)','Engine Base Plate','Oil/Fuel']},
  {n:5,fn:'ASSEMBLY',colour:'#e57200',name:'Sub-assemble Trunnion',ref:120,tasks:['Trunnion (UK)','Tilt Wheel (INT)','Chain Sprocket','Brackets']},
  {n:6,fn:'ASSEMBLY',colour:'#e57200',name:'Sub-assemble Drum',ref:120,tasks:['Top Drum (INT)','Bottom Drum (INT)','Shaft (DC Assy) (INT)','Tophat (DC Assy) (INT)','Blades x2','Bonded/Fixed','Clamped/Spot Welded']},
  {n:7,fn:'BUILD',colour:'#009639',name:'Build up mixer',ref:60,tasks:['Fit all Sub-assemblies to mainframe','Engine (UK)','Trunnion (UK)','Drum (INT)','Pulley Alignment','Belt Tensioning']},
  {n:8,fn:'QC',colour:'#e11f1c',name:'Test / Inspection',ref:60,tasks:['Engine Start','Drum Run Speed','Water Tightness','Drum Backlash']},
  {n:9,fn:'QC',colour:'#e11f1c',name:'Paint',ref:240,tasks:['Engine Bagged','Wheels Bagged','Masked','Prime','Topcoat']},
  {n:10,fn:'QC',colour:'#e11f1c',name:'Finish',ref:35,tasks:['Pull Cord Plate','Engine Stop Switch','Engine Lids* (UK)','Engine Grills* (UK)','Decals','Battery']}
];
const MACHINES = [
  {name:'100T ES Diesel', hasRef:true},
  {name:'150T ES Diesel', hasRef:false},
  {name:'150TFT ES Diesel', hasRef:false},
  {name:'175T ES Diesel', hasRef:false},
  {name:'175TFT ES Diesel', hasRef:false}
];
const FITTERS = ['Alan Beardall','Andrew Thomond','Andrew Simpson','Clive Hope','Graham Hodge','Ian Carr','Ian Bradbury','Keagan Brindley','Neil Churchouse','Ryan Cave','Stuart Fildes'];
const QUICK_PICKS = 5;
const KEY = 'winget-build-timer-v1';

function initials(n){ return n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }
function hm(mins){ const m=Math.round(mins); return Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'; }
function clock(ms){ const s=Math.max(0,Math.floor(ms/1000)); return String(Math.floor(s/3600))+':'+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }
function hhmm(ts){ const d=new Date(ts); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

function seed(){
  const base = new Date(); base.setHours(7,30,0,0);
  const t = base.getTime();
  return [{
    id:'o1', wo:'48217', customer:'Example Customer', machine:'100T ES Diesel', hasRef:true,
    qty:1, mode:'batch', done:false, finishedAt:null,
    runs:[
      {stage:2, unit:1, fitter:'Alan Beardall', start:t, stop:t+38*60000},
      {stage:3, unit:1, fitter:'Alan Beardall', start:t+42*60000, stop:t+105*60000},
      {stage:4, unit:1, fitter:'Andrew Thomond', start:t+110*60000, stop:t+166*60000}
    ],
    complete:[2,3],
    notes:[{text:'Tilt wheel on back order — expected Thursday.', fitter:'Andrew Thomond', at:t+170*60000}],
    active:null
  }];
}

class Component extends DCLogic {
  state = {
    screen:'signin', fitter:null, orders:seed(), activeId:null, stage:null, unit:1,
    now:Date.now(), wo:'', cust:'', machine:null, qty:1, mode:'batch',
    showReport:false, sent:false, loaded:false, noteDraft:'', newNote:''
  };

  componentDidMount(){
    try{ const raw=localStorage.getItem(KEY); if(raw){ const s=JSON.parse(raw); let orders=s.orders||seed();
        if(orders.some(o=>o.id==='o1' && o.customer==='Kier Construction')){ const fresh=seed()[0]; orders=orders.map(o=>o.id==='o1'?fresh:o); this.persist(orders, !!s.sent); }
        this.setState({orders, sent:!!s.sent}); } }catch(e){}
    this.iv=setInterval(()=>this.setState({now:Date.now()}),1000);
  }
  componentWillUnmount(){ clearInterval(this.iv); }
  persist(orders, sent){
    try{ localStorage.setItem(KEY, JSON.stringify({orders:orders||this.state.orders, sent: sent===undefined?this.state.sent:sent})); }catch(e){}
  }
  update(fn, extra){
    this.setState(st=>{
      const orders = st.orders.map(o=> o.id===st.activeId ? fn({...o}) : o);
      this.persist(orders);
      return Object.assign({orders}, extra||{});
    });
  }
  order(){ return this.state.orders.find(o=>o.id===this.state.activeId) || null; }
  refFor(o,n){ const s=STAGES.find(x=>x.n===n); return o && o.hasRef ? s.ref : null; }
  loggedMs(o, n, unit){
    let ms = o.runs.filter(r=>r.stage===n && (unit==null||r.unit===unit)).reduce((a,r)=>a+(r.stop-r.start),0);
    if(o.active && o.active.stage===n && (unit==null||o.active.unit===unit)) ms += this.state.now - o.active.start;
    return ms;
  }
  orderMs(o){ let ms=o.runs.reduce((a,r)=>a+(r.stop-r.start),0); if(o.active) ms += this.state.now-o.active.start; return ms; }
  stopActive(o){ if(o.active){ o.runs=o.runs.concat([{...o.active, stop:Date.now()}]); o.active=null; } return o; }

  renderVals(){
    const st=this.state, o=this.order();
    const showRef = this.props.showReferenceTimes !== false;
    const v = {
      fitters: FITTERS.map(n=>({name:n, initials:initials(n), onPick:()=>this.setState({fitter:n, screen:'board'})})),
      fitterName: st.fitter||'', fitterInitials: st.fitter?initials(st.fitter):'',
      signedIn: st.screen!=='signin', isSignin: st.screen==='signin', isBoard: st.screen==='board',
      isNew: st.screen==='new', isStages: st.screen==='stages', isTimer: st.screen==='timer', isFinish: st.screen==='finish',
      signOut: ()=>this.setState({screen:'signin', fitter:null, activeId:null}),
      toBoard: ()=>this.setState({screen:'board'}),
      goHome: ()=>this.setState({screen:'signin', fitter:null, activeId:null, showReport:false}),
      homeBg: 'rgba(255,255,255,.1)', homeFg: '#ffffff',
      showCrumbs: ['new','stages','timer','finish'].indexOf(st.screen)>=0,
      goBack: ()=>this.setState(s=>({screen: (s.screen==='timer'||s.screen==='finish')?'stages':'board'})),
      backLabel: (st.screen==='timer'||st.screen==='finish')?'Back to stages':'Back to works orders',
      toStages: ()=>this.setState({screen:'stages'}),
      newOrder: ()=>this.setState({screen:'new', wo:'', cust:'', machine:null, qty:1, mode:'batch', newNote:''}),
      todayLabel: new Date().toLocaleDateString('en-GB',{weekday:'long', day:'numeric', month:'long'}),
      reportTo: this.props.reportEmail || 'justin.smith@seddonplant.co.uk',
      showReport: st.showReport,
      openReport: ()=>this.setState({showReport:true}),
      closeReport: ()=>this.setState({showReport:false}),
      sendReport: ()=>{ this.persist(null,true); this.setState({sent:true}); },
      sendLabel: st.sent?'Sent ✓':'Send now',
      sendBg: st.sent?'#009639':'#fdc42b', sendFg: st.sent?'#ffffff':'#373a36',
      resetDemo: ()=>{ const s=seed(); this.persist(s,false); this.setState({orders:s, sent:false, activeId:null, screen:'board'}); },
      hintLine: st.screen==='signin' ? 'Tap a fitter to begin' : 'Shared tablet · '+(st.fitter||'')
    };

    const anyActive = st.orders.find(x=>x.active);
    v.running = !!anyActive;
    if(anyActive){
      v.runningStage = 'Stage '+anyActive.active.stage;
      v.runningClock = clock(st.now - anyActive.active.start);
    } else { v.runningStage=''; v.runningClock=''; }

    v.orders = st.orders.map(x=>{
      const pct = Math.round(x.complete.length/10*100);
      return {
        wo:'WO '+x.wo, line:[x.customer, x.machine, 'Qty '+x.qty+(x.qty>1?' · '+(x.mode==='batch'?'batch timer':'per unit'):'')].join('  ·  '),
        status: x.done?'Finished':(x.active?'Running':'In progress'),
        statusBg: x.done?'#e9eded':(x.active?'#fdc42b':'#fff6dc'),
        statusFg: x.done?'#6e7a7b':(x.active?'#373a36':'#8a6400'),
        notesLabel: (x.notes||[]).length ? (x.notes.length+' note'+(x.notes.length>1?'s':'')) : '',
        pct: pct+'%', logged: hm(this.orderMs(x)/60000), stagesLabel: x.complete.length+' of 10 stages',
        onOpen: ()=>this.setState({activeId:x.id, screen:'stages', unit:1})
      };
    });
    v.noOrders = st.orders.length===0;

    v.woDisplay = st.wo || '—'; v.woCount = st.wo.length+' / 10';
    v.newNoteDraft = st.newNote; v.setNewNote = e=>this.setState({newNote:e.target.value});
    v.custDraft = st.cust;
    v.setCust = e=>this.setState({cust:e.target.value});
    const tally = {};
    st.orders.forEach(x=>{ const k=(x.customer||'').trim(); if(!k) return; const t=tally[k]||(tally[k]={name:k,n:0,last:0}); t.n++; const ts=parseInt(String(x.id).slice(1))||0; if(ts>t.last) t.last=ts; });
    v.recentCustomers = Object.values(tally).sort((a,b)=>b.n-a.n||b.last-a.last).slice(0,QUICK_PICKS).map(c=>({name:c.name, onPick:()=>this.setState({cust:c.name})}));
    v.hasRecent = v.recentCustomers.length>0;
    v.keys = ['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(k=>({label:k, onPress:()=>this.setState(s=>({
      wo: k==='C' ? '' : k==='⌫' ? s.wo.slice(0,-1) : (s.wo.length<10 ? s.wo+k : s.wo)
    }))}));
    v.machines = MACHINES.map(m=>{
      const sel = st.machine===m.name;
      return {name:m.name, meta: m.hasRef?'Ref times':'No ref yet',
        bg: sel?'#373a36':'#fff', border: sel?'#373a36':'#d6dcdb', fg: sel?'#fff':'#373a36', metaFg: sel?'#bac5c3':'#8b9596',
        onPick:()=>this.setState({machine:m.name})};
    });
    v.qtyDraft = st.qty;
    v.qtyUp = ()=>this.setState(s=>({qty:Math.min(20,s.qty+1)}));
    v.qtyDown = ()=>this.setState(s=>({qty:Math.max(1,s.qty-1), mode: s.qty-1<=1?'batch':s.mode}));
    v.showModeChoice = st.qty>1;
    v.batchBg = st.mode==='batch'?'#373a36':'#fff'; v.batchBorder = st.mode==='batch'?'#373a36':'#d6dcdb'; v.batchFg = st.mode==='batch'?'#fff':'#373a36';
    v.unitBg = st.mode==='unit'?'#373a36':'#fff'; v.unitBorder = st.mode==='unit'?'#373a36':'#d6dcdb'; v.unitFg = st.mode==='unit'?'#fff':'#373a36';
    v.pickBatch = ()=>this.setState({mode:'batch'});
    v.pickUnit = ()=>this.setState({mode:'unit'});
    const canCreate = st.wo.length>0 && st.cust.trim().length>0 && !!st.machine;
    v.createDisabled = !canCreate; v.createBg = canCreate?'#fdc42b':'#d6dcdb'; v.createFg = canCreate?'#373a36':'#8b9596'; v.createCursor = canCreate?'pointer':'not-allowed';
    v.createOrder = ()=>{ if(!canCreate) return; const id='o'+Date.now();
      const rec = MACHINES.find(m=>m.name===st.machine);
      const nw = {id, wo:st.wo, customer:st.cust.trim(), machine:st.machine, hasRef:rec.hasRef, qty:st.qty, mode:st.mode, done:false, finishedAt:null, runs:[], complete:[], active:null, notes: st.newNote.trim()?[{text:st.newNote.trim(), fitter:st.fitter, at:Date.now()}]:[]};
      const orders = st.orders.concat([nw]); this.persist(orders);
      this.setState({orders, activeId:id, screen:'stages', unit:1});
    };

    if(o){
      v.orderTitle = 'WO '+o.wo;
      v.orderMeta = [o.customer, o.machine, 'Qty '+o.qty].join('  ·  ');
      v.orderTotal = hm(this.orderMs(o)/60000);
      v.perUnit = o.mode==='unit' && o.qty>1;
      v.units = Array.from({length:o.qty},(_,i)=>i+1).map(n=>({n, bg: st.unit===n?'#373a36':'#fff', border: st.unit===n?'#373a36':'#d6dcdb', fg: st.unit===n?'#fff':'#4d585a', onPick:()=>this.setState({unit:n})}));
      const unitFilter = v.perUnit ? st.unit : null;
      v.stages = STAGES.map(s=>{
        const done = o.complete.indexOf(s.n)>=0;
        const run = o.active && o.active.stage===s.n;
        const ms = this.loggedMs(o, s.n, unitFilter);
        const ref = this.refFor(o,s.n);
        return {num:s.n, name:s.name, fn:s.fn, colour: this.props.colourByFunction===false ? '#6e7a7b' : s.colour,
          bg: run?'#fff6dc':'#fff', border: run?'#fdc42b':'#d6dcdb', numFg: done?'#bac5c3':'#373a36',
          logged: ms>0?hm(ms/60000):'—', loggedFg: run?'#8a6400':'#373a36',
          ref: showRef ? (ref==null?'no ref':'ref '+hm(ref)) : '',
          chip: run?'Running':(done?'Complete':(ms>0?'In progress':'Not started')),
          chipBg: run?'#fdc42b':(done?'#009639':(ms>0?'#f3e2b0':'#e9eded')),
          chipFg: run?'#373a36':(done?'#fff':(ms>0?'#5c4300':'#8b9596')),
          onPick: ()=>this.setState({stage:s.n, screen:'timer'})};
      });
      const remaining = 10-o.complete.length;
      v.finishDisabled = remaining>0;
      v.finishBg = remaining>0?'#e9eded':'#373a36'; v.finishFg = remaining>0?'#8b9596':'#fff'; v.finishCursor = remaining>0?'not-allowed':'pointer';
      v.finishHint = o.done ? 'Finished '+(o.finishedAt?hhmm(o.finishedAt):'') + ' · queued for tonight\u2019s report'
        : remaining>0 ? remaining+' stage'+(remaining>1?'s':'')+' still to complete. Stages can be done in any order.'
        : 'All 10 stages complete.';
      v.toFinish = ()=>{ if(remaining===0) this.setState({screen:'finish'}); };

      v.summary = STAGES.map(s=>{
        const ms=this.loggedMs(o,s.n,null); const ref=this.refFor(o,s.n);
        return {num:s.n, name:s.name, ref: ref==null?'—':hm(ref), logged: hm(ms/60000)};
      });
      const totalMin = this.orderMs(o)/60000;
      const totalRefMin = o.hasRef ? STAGES.reduce((a,s)=>a+s.ref,0) : null;
      v.totalLogged = hm(totalMin); v.totalRef = totalRefMin==null?'—':hm(totalRefMin);
      v.varianceLine = totalRefMin==null
        ? 'No reference times exist for this model yet — this build becomes the first recorded set.'
        : (totalMin>=totalRefMin ? '+'+hm(totalMin-totalRefMin)+' against the recorded 100T reference of '+hm(totalRefMin)+'.'
                                 : '−'+hm(totalRefMin-totalMin)+' against the recorded 100T reference of '+hm(totalRefMin)+'.');
      v.finishJob = ()=>{ this.update(x=>{ this.stopActive(x); x.done=true; x.finishedAt=Date.now(); return x; }, {screen:'board'}); };

      const s = STAGES.find(x=>x.n===st.stage) || STAGES[0];
      const run = o.active && o.active.stage===s.n;
      const done = o.complete.indexOf(s.n)>=0;
      const ms = this.loggedMs(o, s.n, unitFilter);
      const ref = this.refFor(o,s.n);
      v.tNum=s.n; v.tFn=s.fn; v.tName=s.name; v.tColour = this.props.colourByFunction===false?'#6e7a7b':s.colour;
      v.tUnitLabel = 'WO '+o.wo+'  ·  '+o.machine + (v.perUnit?'  ·  Unit '+st.unit+' of '+o.qty:'');
      v.tTasks = s.tasks.map(t=>({label:t}));
      v.tClock = run ? clock(st.now - o.active.start) : clock(ms);
      v.tClockLabel = run ? 'Running now' : (ms>0?'Logged on this stage':'Not started');
      v.tPanelBg = run?'#fdc42b':'#373a36'; v.tPanelFg = run?'#373a36':'#ffffff'; v.tPanelMeta = run?'#5c4300':'#bac5c3';
      v.tRefLine = showRef ? (ref==null ? 'No reference time for this model' : 'Reference '+hm(ref)+'  ·  logged today '+hm(ms/60000)) : 'Logged today '+hm(ms/60000);
      v.tBtnLabel = run?'Stop':'Start';
      v.tBtnBg = run?'#373a36':'#009639';
      v.tToggle = ()=>this.update(x=>{
        if(x.active && x.active.stage===s.n){ this.stopActive(x); }
        else { this.stopActive(x); x.active={stage:s.n, unit: v.perUnit?st.unit:1, fitter: st.fitter, start:Date.now()}; }
        return x;
      });
      v.tCompleteLabel = done?'Reopen stage':'Mark stage complete';
      v.tCompleteBg = done?'#fff':'#009639'; v.tCompleteFg = done?'#4d585a':'#fff'; v.tCompleteBorder = done?'#d6dcdb':'#009639';
      v.tComplete = ()=>this.update(x=>{
        this.stopActive(x);
        x.complete = done ? x.complete.filter(n=>n!==s.n) : x.complete.concat([s.n]);
        return x;
      }, done?{}:{screen:'stages'});
      const runs = o.runs.filter(r=>r.stage===s.n && (!v.perUnit || r.unit===st.unit));
      v.tRuns = runs.map(r=>({range: hhmm(r.start)+' → '+hhmm(r.stop), fitter:r.fitter, dur: hm((r.stop-r.start)/60000), bg:'#f4f6f6', durFg:'#373a36'}))
        .concat(run ? [{range: hhmm(o.active.start)+' → running', fitter:o.active.fitter, dur: hm((st.now-o.active.start)/60000), bg:'#fff6dc', durFg:'#8a6400'}] : []);
      v.tRunCount = v.tRuns.length + (v.tRuns.length===1?' run':' runs');
      v.tNoRuns = v.tRuns.length===0;
      const nts = o.notes||[];
      v.notes = nts.slice().reverse().map(n=>({text:n.text, meta:(n.fitter||'')+' · '+new Date(n.at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+' '+hhmm(n.at)}));
      v.hasNotes = nts.length>0; v.notesCount = nts.length ? nts.length+(nts.length>1?' notes':' note') : 'None yet';
      v.noteDraft = st.noteDraft; v.setNoteDraft = e=>this.setState({noteDraft:e.target.value});
      v.addNoteBg = st.noteDraft.trim()?'#fdc42b':'#e9eded';
      v.addNote = ()=>{ const txt=st.noteDraft.trim(); if(!txt) return; this.update(x=>{ x.notes=(x.notes||[]).concat([{text:txt, fitter:st.fitter, at:Date.now()}]); return x; }, {noteDraft:''}); };
      const sObj = STAGES.find(x=>x.n===st.stage);
      v.crumbs = [{sep:'', label:'Works orders', onClick:()=>this.setState({screen:'board'})},
        {sep:'›', label:'WO '+o.wo, onClick:()=>this.setState({screen:'stages'})}];
      if(st.screen==='timer' && sObj) v.crumbs.push({sep:'›', label:'Stage '+sObj.n+' · '+sObj.name, onClick:()=>{}});
      if(st.screen==='finish') v.crumbs.push({sep:'›', label:'Finish job', onClick:()=>{}});
      const inOrder = st.screen==='stages' || st.screen==='timer' || st.screen==='finish';
      v.ctxLabel = inOrder ? o.customer : 'Shop floor';
      v.ctxValue = inOrder ? 'WO '+o.wo+' · '+o.machine : 'No works order open';
    } else {
      v.notes=[]; v.hasNotes=false; v.notesCount=''; v.noteDraft=''; v.setNoteDraft=()=>{}; v.addNote=()=>{}; v.addNoteBg='#e9eded';
      v.crumbs=[{sep:'', label:'Works orders', onClick:()=>this.setState({screen:'board'})}];
      v.perUnit=false; v.units=[]; v.stages=[]; v.summary=[]; v.tRuns=[]; v.tTasks=[]; v.tNoRuns=true;
      v.ctxLabel='Shop floor'; v.ctxValue='No works order open';
      v.orderTitle=''; v.orderMeta=''; v.orderTotal='0h 00m';
      v.finishDisabled=true; v.finishBg='#e9eded'; v.finishFg='#8b9596'; v.finishCursor='not-allowed'; v.finishHint=''; v.toFinish=()=>{};
      v.totalLogged='0h 00m'; v.totalRef='—'; v.varianceLine=''; v.finishJob=()=>{};
      v.tNum=''; v.tFn=''; v.tName=''; v.tColour='#6e7a7b'; v.tUnitLabel=''; v.tClock='0:00:00'; v.tClockLabel='';
      v.tPanelBg='#373a36'; v.tPanelFg='#fff'; v.tPanelMeta='#bac5c3'; v.tRefLine=''; v.tBtnLabel='Start'; v.tBtnBg='#009639';
      v.tToggle=()=>{}; v.tCompleteLabel=''; v.tCompleteBg='#fff'; v.tCompleteFg='#4d585a'; v.tCompleteBorder='#d6dcdb'; v.tComplete=()=>{}; v.tRunCount='0 runs';
    }

    v.reportOrders = st.orders.map(x=>{
      const rows = STAGES.filter(s=>this.loggedMs(x,s.n,null)>0).map(s=>{
        const mins=this.loggedMs(x,s.n,null)/60000;
        return {num:s.n, name:s.name, hm:hm(mins), dec:(mins/60).toFixed(2), bg:'#fff'};
      });
      const tot=this.orderMs(x)/60000;
      const xn = x.notes||[];
      return {hasNotes: xn.length>0, notesText: xn.map(n=>n.text).join('  ·  '), wo:'WO '+x.wo, line:[x.customer,x.machine,'Qty '+x.qty].join(' · '), rows, totalHm:hm(tot), totalDec:(tot/60).toFixed(2)};
    });
    if(st.screen==='new') v.crumbs=[{sep:'', label:'Works orders', onClick:()=>this.setState({screen:'board'})},{sep:'›', label:'New works order', onClick:()=>{}}];
    v.crumbs = v.crumbs.map((c,i,a)=>{ const last=i===a.length-1; return Object.assign({}, c, {fg: last?'#373a36':'#4d585a', deco: last?'none':'underline', cursor: last?'default':'pointer'}); });
    return v;
  }
}
