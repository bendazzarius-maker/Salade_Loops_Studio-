/* ================= Electro DAW | uiRefresh.js ================= */
/* ---------------- UI refresh (patterns + channel rack) ---------------- */

// --- helpers (non-destructive) ---
function _deepClone(obj){
  try{ return (typeof structuredClone==="function") ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)); }
  catch(_e){ try{ return JSON.parse(JSON.stringify(obj)); }catch(_e2){ return obj ? { ...obj } : obj; } }
}
function _safeToast(msg){
  try{ if(typeof toast==="function") return toast(msg); }catch(_e){}
  console.warn("[toast]", msg);
}
function _lfoPatternType(p){
  return String(p?.type||p?.kind||p?.patternType||"").toLowerCase();
}

function _isLfoPattern(p){
  if(!p) return false;
  const t = _lfoPatternType(p);
  if(t.includes("lfo")) return true;
  // heuristics: lfo patterns usually have bind/preset structures without channels
  if(p.preset && (p.preset.fxIndex!==undefined || p.preset.params || p.preset.snapshot)) return true;
  if(p.bind && (p.bind.param || p.bind.fxIndex!==undefined)) return true;
  return false;
}


function _normalizeLfoTargetRef(ref){
  const out = ref && typeof ref === "object" ? ref : {};
  const scope = (String(out.scope||"channel").toLowerCase()==="master") ? "master" : "channel";
  out.scope = scope;

  const channels = project?.mixer?.channels || [];
  const fallbackCh = channels[0] || null;
  if(scope === "master"){
    out.channelId = null;
  }else{
    const raw = out.channelId;
    const wantsAuto = (raw == null || String(raw)==="");
    if(wantsAuto){
      out.channelId = null;
    }else{
      const hasExact = channels.some(ch => String(ch.id) === String(raw));
      out.channelId = hasExact ? raw : (fallbackCh ? fallbackCh.id : null);
    }
  }

  out.kind = (String(out.kind||"mixer").toLowerCase()==="fx") ? "fx" : "mixer";
  out.fxIndex = Math.max(0, Math.floor(Number(out.fxIndex||0)));

  if(out.kind === "mixer"){
    const allowed = new Set(["gain","pan","eqLow","eqMid","eqHigh","cross"]);
    if(!allowed.has(String(out.param||""))) out.param = "gain";
    if(out.param === "cross" && scope !== "master") out.param = "gain";
  }
  return out;
}

function _normalizeLfoPatternBinding(pat){
  if(!pat || !_isLfoPattern(pat)) return;
  if(_lfoPatternType(pat)==="lfo_curve"){
    pat.bind = _normalizeLfoTargetRef(pat.bind || (window.LFO && LFO.defaultBinding ? LFO.defaultBinding() : { scope:"channel", channelId:null, kind:"mixer", param:"gain", fxIndex:0 }));
    pat.bind.kind = "mixer";
  }
  if(_lfoPatternType(pat)==="lfo_preset"){
    pat.preset = _normalizeLfoTargetRef(pat.preset || { scope:"channel", channelId:null, kind:"fx", fxIndex:0, fxType:"", params:{} });
    pat.preset.kind = "fx";
    pat.preset.snapshot = (pat.preset.snapshot && typeof pat.preset.snapshot === "object") ? pat.preset.snapshot : { enabled:true, params:{} };

    const isMaster = pat.preset.scope === "master";
    const mix = project?.mixer || {};
    const bank = isMaster ? mix.master : ((mix.channels||[]).find(c=>String(c.id)===String(pat.preset.channelId)) || (mix.channels||[])[0]);
    const fxArr = bank?.fx || [];
    if(fxArr.length===0){
      pat.preset.fxIndex = 0;
    }else if(pat.preset.fxIndex >= fxArr.length){
      pat.preset.fxIndex = fxArr.length - 1;
    }
  }
}

window._normalizeLfoPatternBinding = _normalizeLfoPatternBinding;

function reloadLfoBindEditorFromPlaylist(){
  try{

    for(const pat of (project?.patterns||[])){
      if(!_isLfoPattern(pat)) continue;
      _normalizeLfoPatternBinding(pat);
    }

    if(typeof updateLfoInspector === "function") updateLfoInspector();
    if(typeof updateLfoCurvePatternEditor === "function") updateLfoCurvePatternEditor();
    try{ renderPlaylist(); }catch(_e){}
  }catch(err){
    console.warn("[lfo] reload bind editor failed", err);
  }
}
window.reloadLfoBindEditorFromPlaylist = reloadLfoBindEditorFromPlaylist;

function _ensurePresetSnapshot(pat, fx){
  pat.preset = pat.preset || {};
  // snapshot shape: { enabled:boolean, params:object, fxType:string }
  if(!pat.preset.snapshot){
    const enabled = (fx && fx.enabled!==undefined) ? (fx.enabled!==false) : true;
    // params: if fx has params use it, else clone fx itself
    const baseParams = (fx && typeof fx==="object") ? (fx.params ? fx.params : fx) : {};
    pat.preset.snapshot = { enabled, params: _deepClone(baseParams) };
  }else{
    // ensure fields exist
    if(pat.preset.snapshot.enabled===undefined) pat.preset.snapshot.enabled = true;
    if(!pat.preset.snapshot.params) pat.preset.snapshot.params = {};
  }
}
// floating clone window state
window.__lfoFxCloneState = window.__lfoFxCloneState || { open:false, patId:null, pinned:false };
function _updateLfoFxCloneWindow(){
  const st = window.__lfoFxCloneState;
  const win = document.getElementById("__lfoFxFloat");
  if(!win) { st.open=false; return; }
  const pat = (typeof activePattern==="function") ? activePattern() : null;
  if(!pat || (_lfoPatternType(pat)!=="lfo_preset")){
    // no active preset: show placeholder and clear patId
    st.patId = null;
    const body = win.querySelector("#__lfoFxBody");
    if(body) body.innerHTML = '<div class="small" style="opacity:.85">Sélectionne une pattern <b>LFO preset</b> pour éditer le clone FX.</div>';
    return;
  }
  // if pinned to a pattern id, only refresh when that pattern selected
  st.patId = pat.id;

  // resolve mixer bank + fx
  const scope = (pat.preset && pat.preset.scope) ? pat.preset.scope : "channel";
  const isMaster = scope==="master";
  const cid = pat.preset ? (pat.preset.channelId||null) : null;
  const mix = project.mixer;
  const bank = isMaster ? mix.master : (mix.channels.find(c=>c.id===cid) || mix.channels[0]);
  const fxArr = bank?.fx || [];
  const fx = fxArr[Number(pat.preset?.fxIndex||0)];
  const fxType = pat.preset?.fxType || fx?.type || fx?.name || "fx";

  // ensure snapshot exists
  _ensurePresetSnapshot(pat, fx);

  // build UI
  const body = win.querySelector("#__lfoFxBody");
  if(!body) return;
  body.innerHTML = "";

  // header info
  const info = document.createElement("div");
  info.className = "small";
  info.style.opacity = ".9";
  info.style.marginBottom = "8px";
  info.innerHTML = `Preset: <b>${(pat.name||pat.id)}</b> — ${isMaster ? "Master" : (bank?.name||"Channel")} — FX #${Number(pat.preset?.fxIndex||0)}`;
  body.appendChild(info);

  // enabled toggle
  const row = document.createElement("div");
  row.className = "mixRow";
  row.style.display="flex";
  row.style.alignItems="center";
  row.style.justifyContent="space-between";
  row.style.gap="8px";
  const lab = document.createElement("label");
  lab.textContent = "FX Enabled";
  row.appendChild(lab);
  const chk = document.createElement("input");
  chk.type="checkbox";
  chk.checked = (pat.preset.snapshot.enabled!==false);
  chk.onchange = ()=>{
    pat.preset.snapshot.enabled = !!chk.checked;
    try{ renderPlaylist(); }catch(_e){}
  };
  row.appendChild(chk);
  body.appendChild(row);

  // params UI (same as mixer)
  const paramsObj = pat.preset.snapshot.params || {};
  const uiBox = (typeof _renderFxParams==="function")
    ? _renderFxParams(fxType, paramsObj, (nextParams)=>{
        // store back to snapshot (deep to avoid shared ref)
        pat.preset.snapshot.params = _deepClone(nextParams);
        try{ renderPlaylist(); }catch(_e){}
      })
    : null;

  if(uiBox){
    body.appendChild(uiBox);
  }else{
    const ta=document.createElement("textarea");
    ta.style.width="100%";
    ta.style.height="240px";
    ta.style.background="rgba(0,0,0,.25)";
    ta.style.color="var(--text)";
    ta.style.border="1px solid rgba(36,49,79,.9)";
    ta.style.borderRadius="12px";
    ta.style.padding="10px";
    ta.style.fontFamily='ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ta.value = JSON.stringify(pat.preset.snapshot, null, 2);
    ta.onchange = ()=>{
      try{
        const obj=JSON.parse(ta.value);
        if(obj && typeof obj==="object"){
          pat.preset.snapshot = obj;
          try{ renderPlaylist(); }catch(_e){}
        }
      }catch(_e){}
    };
    body.appendChild(ta);
  }
}


function openChannelContextMenu(x, y, ch, p){
  try{ document.getElementById('__channelCtx')?.remove(); }catch(_e){}
  const menu=document.createElement('div');
  menu.id='__channelCtx';
  menu.style.position='fixed';
  menu.style.left=Math.max(8,x)+'px';
  menu.style.top=Math.max(8,y)+'px';
  menu.style.zIndex='999999';
  menu.style.minWidth='180px';
  menu.style.background='rgba(10,14,28,0.98)';
  menu.style.border='1px solid rgba(255,255,255,0.14)';
  menu.style.borderRadius='10px';
  menu.style.padding='8px';
  menu.style.display='grid';
  menu.style.gap='6px';

  const mk=(label, fn)=>{ const b=document.createElement('button'); b.className='btn2'; b.style.textAlign='left'; b.textContent=label; b.onclick=()=>{ try{fn();}finally{menu.remove();} }; return b; };
  const colorRow=document.createElement('label');
  colorRow.className='btn2';
  colorRow.style.display='flex';
  colorRow.style.alignItems='center';
  colorRow.style.justifyContent='space-between';
  colorRow.style.gap='8px';
  colorRow.textContent='🎨 Couleur des notes';
  const picker=document.createElement('input');
  picker.type='color';
  picker.value=ch.color||'#27e0a3';
  picker.oninput=()=>{ ch.color=picker.value; refreshUI(); renderNotes(); renderPlaylist(); };
  colorRow.appendChild(picker);

  menu.appendChild(mk('✏️ Renommer', ()=>{
    openRenameSocket(x,y,ch.name,(v)=>{ ch.name=v; refreshUI(); renderPlaylist(); });
  }));
  menu.appendChild(colorRow);
  menu.appendChild(mk('🗑️ Supprimer instrument', ()=>{
    deleteChannel(p.id, ch.id);
    refreshUI(); renderAll(); renderPlaylist();
  }));

  document.body.appendChild(menu);
  const close=(ev)=>{ if(!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown',close,true);} };
  document.addEventListener('mousedown',close,true);
}

// Floating rename socket (right-click pattern button)
function openRenameSocket(x, y, initialValue, onSubmit){
  try{ document.getElementById('__renameSocket')?.remove(); }catch(_e){}
  const wrap=document.createElement('div');
  wrap.id='__renameSocket';
  wrap.style.position='fixed';
  wrap.style.left=Math.max(8, x)+'px';
  wrap.style.top=Math.max(8, y)+'px';
  wrap.style.zIndex=999999;
  wrap.style.background='rgba(10,14,28,0.98)';
  wrap.style.border='1px solid rgba(255,255,255,0.14)';
  wrap.style.borderRadius='10px';
  wrap.style.padding='10px';
  wrap.style.boxShadow='0 12px 30px rgba(0,0,0,0.35)';
  wrap.style.display='grid';
  wrap.style.gridTemplateColumns='1fr auto auto';
  wrap.style.gap='8px';

  const inp=document.createElement('input');
  inp.type='text';
  inp.value=initialValue||'';
  inp.style.width='240px';
  inp.style.padding='8px 10px';
  inp.style.borderRadius='8px';
  inp.style.border='1px solid rgba(255,255,255,0.16)';
  inp.style.background='rgba(255,255,255,0.06)';
  inp.style.color='white';

  const ok=document.createElement('button');
  ok.textContent='OK';
  ok.className='btn2';

  const cancel=document.createElement('button');
  cancel.textContent='✕';
  cancel.className='btn2';

  function close(){ try{ wrap.remove(); }catch(_e){} }
  function submit(){
    const v=(inp.value||'').trim();
    if(v){ try{ onSubmit(v); }catch(_e){} }
    close();
  }

  ok.addEventListener('click', submit);
  cancel.addEventListener('click', close);
  inp.addEventListener('keydown',(e)=>{
    if(e.key==='Enter'){ e.preventDefault(); submit(); }
    if(e.key==='Escape'){ e.preventDefault(); close(); }
  });
  setTimeout(()=>inp.focus(), 0);

  // close when clicking outside
  const onDoc=(e)=>{ if(!wrap.contains(e.target)){ close(); document.removeEventListener('mousedown', onDoc, true); } };
  document.addEventListener('mousedown', onDoc, true);

  wrap.appendChild(inp);
  wrap.appendChild(ok);
  wrap.appendChild(cancel);
  document.body.appendChild(wrap);
}

/* ---------------- helpers: detect LFO pattern + safe "notes pattern" ---------------- */
function _hasChannels(p){
  return !!(p && Array.isArray(p.channels));
}

// Pattern utilisée pour PianoRoll/ChannelRack : uniquement une pattern "notes" (avec channels)
function _getNotesPattern(){
  const ap = (typeof activePattern === "function") ? activePattern() : null;
  if(_hasChannels(ap)) return ap;

  // fallback : dernière pattern "notes" active, sinon première trouvée
  const fallbackId = project?.activeNotesPatternId;
  if(fallbackId){
    const fp = project.patterns.find(x=>x.id===fallbackId);
    if(_hasChannels(fp)) return fp;
  }
  const first = (project?.patterns || []).find(x=>_hasChannels(x));
  return first || null;
}

function refreshUI(){
  // ---------------- Pattern selects ----------------
  patternSelect.innerHTML="";
  plistPatternSelect.innerHTML="";

  const patterns = Array.isArray(project?.patterns) ? project.patterns : [];

  // IMPORTANT :
  // - patternSelect (PianoRoll) : seulement les patterns "notes" (avec channels)
  // - plistPatternSelect (Playlist) : toutes (notes + LFO)
  for(const p of patterns){
    // playlist select: all patterns
    const o2=document.createElement("option");
    o2.value=p.id; o2.textContent=`${p.name}`;
    plistPatternSelect.appendChild(o2);

    // pianoroll select: notes only
    if(_hasChannels(p)){
      const o1=document.createElement("option");
      o1.value=p.id; o1.textContent=`${p.name}`;
      patternSelect.appendChild(o1);
    }
  }

  // S’assurer que le piano roll ne pointe jamais vers une LFO pattern
  const notesPat = _getNotesPattern();
  if(notesPat){
    project.activeNotesPatternId = notesPat.id;
    // si activePatternId est LFO, ne pas le forcer ici (playlist-side),
    // mais forcer patternSelect à rester sur notesPat.
    patternSelect.value = notesPat.id;
  }

  // playlist select reste sur activePatternId si dispo, sinon fallback
  if(project.activePatternId){
    plistPatternSelect.value=project.activePatternId;
  }else if(notesPat){
    plistPatternSelect.value=notesPat.id;
  }

  // pattern length selector (1..8 temps)
  if(typeof patternLenSelect!=="undefined" && patternLenSelect){
    const ap = (typeof activePattern==="function") ? activePattern() : null;
    const curLen = ap ? clamp(patternLengthBars(ap),1,8) : 4;
    patternLenSelect.value = String(curLen);
  }

  // ---------------- Pattern list with rename + color ----------------
  const pl=$("#patternList");
  pl.innerHTML="";

  for(const p of patterns){
    // sécuriser color
    if(!p.color) p.color = "#27e0a3";

    const wrap=document.createElement("div");
    wrap.style.display="grid";
    wrap.style.gridTemplateColumns="1fr auto";
    wrap.style.gap="8px";
    wrap.style.marginBottom="8px";

    const b=document.createElement("button");
    // active class: si c'est la pattern active playlist, ou notesPat pour piano roll
    const isActive = (p.id===project.activePatternId) || (notesPat && _hasChannels(p) && p.id===notesPat.id && !_hasChannels((typeof activePattern==="function")?activePattern():null));
    b.className="btn2"+(isActive?" active":"");

    const tag = _isLfoPattern(p) ? " (LFO)" : "";
    b.innerHTML=`<span>🧩 <span class="pname">${p.name}${tag}</span></span><span class="small">${patternLengthBars(p)} bar(s)</span>`;

    // click: si notes pattern -> activePatternId (piano + playlist)
    //        si LFO pattern   -> activePatternId (playlist seulement) sans toucher aux channels
    b.addEventListener("click",()=>{
      project.activePatternId=p.id;

      if(_hasChannels(p)){
        project.activeNotesPatternId = p.id;
        if(!p.activeChannelId && p.channels && p.channels[0]) p.activeChannelId=p.channels[0].id;
        refreshUI(); renderAll(); renderPlaylist();
      }else{
        // LFO: ne pas tenter de set activeChannelId
        // et ne pas appeler renderAll() qui touche au piano roll
        refreshUI();
        renderPlaylist();
      }
    });

    // rename on dblclick (Electron-friendly socket)
    b.addEventListener("dblclick",(e)=>{
      e.preventDefault();
      const r = b.getBoundingClientRect();
      openRenameSocket(r.left + 20, r.top + 10, p.name, (v)=>{
        p.name = v;
        refreshUI(); renderPlaylist();
      });
    });

    // rename on right click
    b.addEventListener("contextmenu",(e)=>{
      e.preventDefault();
      openRenameSocket(e.clientX, e.clientY, p.name, (v)=>{
        p.name = v;
        refreshUI(); renderPlaylist();
      });
    });

    const col=document.createElement("input");
    col.type="color";
    col.value=p.color;
    col.title="Couleur de pattern";
    col.addEventListener("input",()=>{
      p.color=col.value;
      refreshUI(); renderPlaylist();
    });

    wrap.appendChild(b);
    wrap.appendChild(col);
    pl.appendChild(wrap);
  }

  // ---------------- Channel rack ----------------
  // Ici on FORCE une pattern notes pour éviter le crash quand activePatternId = LFO
  const p = notesPat;
  const cl=$("#channelList");
  cl.innerHTML="";
  channelSelect.innerHTML="";

  // preset override list (right panel)
  if(typeof presetOverride!=="undefined" && presetOverride){
    const cur = presetOverride.value;
    presetOverride.innerHTML = "";
    const o0=document.createElement("option");
    o0.value=""; o0.textContent="(utiliser le preset du channel)";
    presetOverride.appendChild(o0);
    const names = (presets.list ? presets.list() : ["Piano","Bass","Lead","Pad","Drums"]);
    for(const n of names){
      const o=document.createElement("option");
      o.value=n; o.textContent=n;
      presetOverride.appendChild(o);
    }
    presetOverride.value = cur;
  }

  if(p && _hasChannels(p)){
    for(const ch of p.channels){
      const opt=document.createElement("option");
      opt.value=ch.id; opt.textContent=`${ch.name} (${ch.preset})`;
      channelSelect.appendChild(opt);

      const row=document.createElement("div");
      row.style.display="grid";
      row.style.gridTemplateColumns="1fr auto";
      row.style.gap="8px";
      row.style.marginBottom="8px";

      const btn=document.createElement("button");
      btn.className="btn2"+(ch.id===p.activeChannelId?" active":"");
      btn.innerHTML=`
        <span style="display:flex;align-items:center;gap:10px">
          <span class="mini-dot" style="background:${ch.color}"></span>
          ${ch.name}
          <span class="small">(${ch.preset})</span>
        </span>
        <span class="small">${ch.muted?"MUTE":""}</span>
      `;
      btn.addEventListener("click",()=>{
        p.activeChannelId=ch.id;
        refreshUI(); renderNotes();
      });

      // rename channel (socket, pas prompt)
      btn.addEventListener("dblclick",(e)=>{
        e.preventDefault();
        const r = btn.getBoundingClientRect();
        openRenameSocket(r.left + 20, r.top + 10, ch.name, (v)=>{
          ch.name = v;
          refreshUI(); renderPlaylist();
        });
      });
      btn.addEventListener("contextmenu",(e)=>{
        e.preventDefault();
        openChannelContextMenu(e.clientX, e.clientY, ch, p);
      });

      const tools=document.createElement("div");
      tools.style.display="flex";
      tools.style.gap="6px";
      tools.style.alignItems="center";
      tools.style.justifyContent="flex-end";

      const presetSel=document.createElement("select");
      presetSel.style.width="140px";
      ( (presets && presets.list) ? presets.list() : ["Piano","Bass","Lead","Pad","Drums"] ).forEach(n=>{
        const o=document.createElement("option");
        o.value=n; o.textContent=n;
        presetSel.appendChild(o);
      });
      presetSel.value=ch.preset;
      presetSel.addEventListener("change",()=>{
        ch.preset=presetSel.value;
        ch.name = ch.name || ch.preset;
        refreshUI(); renderNotes(); renderPlaylist();
      });

      const col=document.createElement("input");
      col.type="color";
      col.value=ch.color;
      col.title="Couleur channel";
      col.addEventListener("input",()=>{
        ch.color=col.value;
        refreshUI(); renderNotes(); renderPlaylist();
      });

      const mute=document.createElement("button");
      mute.className="pill";
      mute.textContent = ch.muted ? "🔇" : "🔊";
      mute.style.padding="8px 10px";
      mute.addEventListener("click",(e)=>{
        e.stopPropagation();
        ch.muted=!ch.muted;
        refreshUI();
      });

      const del=document.createElement("button");
      del.className="pill";
      del.textContent="🗑️";
      del.style.padding="8px 10px";
      del.addEventListener("click",(e)=>{
        e.stopPropagation();
        deleteChannel(p.id, ch.id);
        refreshUI(); renderAll(); renderPlaylist();
      });

      tools.appendChild(presetSel);
      tools.appendChild(col);
      tools.appendChild(mute);
      tools.appendChild(del);

      row.appendChild(btn);
      row.appendChild(tools);
      cl.appendChild(row);
    }

    if(p.activeChannelId) channelSelect.value=p.activeChannelId;
  }

  // S'assurer que patternSelect pointe sur une notes pattern
  if(notesPat) patternSelect.value = notesPat.id;
  if(p?.activeChannelId) channelSelect.value=p.activeChannelId;

  if(typeof renderInstrumentPanel==="function") renderInstrumentPanel();
  if(typeof renderAutomationLane==="function") renderAutomationLane();

  try{ updateLfoInspector(); }catch(_e){}
  try{ updateLfoCurvePatternEditor(); }catch(_e){}
}

/* ---------------- LFO inspector (playlist-side binding) ---------------- */

function _safeSetSelectValue(sel, value, fallback=""){
  if(!sel) return;
  const wanted = String(value==null?"":value);
  const has = Array.from(sel.options||[]).some(o=>String(o.value)===wanted);
  if(has){ sel.value = wanted; return; }
  const hasFallback = Array.from(sel.options||[]).some(o=>String(o.value)===String(fallback));
  if(hasFallback){ sel.value = String(fallback); return; }
  if(sel.options && sel.options.length) sel.value = sel.options[0].value;
}

function updateLfoInspector(){
  const wrap = document.getElementById("lfoInspector");
  if(!wrap) return;

  const p = (typeof activePattern === "function") ? activePattern() : null;
  if(!project.mixer || !Array.isArray(project.mixer.channels)) project.mixer = initMixerModel(16);
  if(!p || !_isLfoPattern(p)){
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";

  const titleEl = document.getElementById("lfoInspectorTitle");
  const helpEl = document.getElementById("lfoInspectorHelp");
  const scopeSel = document.getElementById("lfoScope");
  const chSel = document.getElementById("lfoChannel");
  const kindSel = document.getElementById("lfoBindKind");
  const paramSel = document.getElementById("lfoParam");
  const fxRow = document.getElementById("lfoFxRow");
  const fxSel = document.getElementById("lfoFx");
  const cloneBtn = document.getElementById("lfoCloneFx");
  const kindRow = document.getElementById("lfoKindRow");
  const paramRow = document.getElementById("lfoParamRow");
  const lenSel = document.getElementById("lfoPatternLen");

  if(!scopeSel || !chSel || !kindSel || !paramSel || !fxSel || !fxRow || !cloneBtn || !lenSel) return;

  // One-time listener binding (non-destructive)
  if(!wrap.__bound){
    wrap.__bound = true;

    scopeSel.addEventListener("change", ()=>{
      const pat = activePattern();
      if(!pat) return;
      if(_lfoPatternType(pat)==="lfo_preset"){
        pat.preset = pat.preset || {};
        pat.preset.scope = scopeSel.value;
      }else{
        pat.bind = pat.bind || {};
        pat.bind.scope = scopeSel.value;
      }
      refreshUI(); try{ renderPlaylist(); }catch(_e){}
    });

    chSel.addEventListener("change", ()=>{
      const pat = activePattern();
      if(!pat) return;
      const cid = chSel.value || null;
      if(_lfoPatternType(pat)==="lfo_preset"){
        pat.preset = pat.preset || {};
        pat.preset.channelId = cid;
      }else{
        pat.bind = pat.bind || {};
        pat.bind.channelId = cid;
      }
      refreshUI(); try{ renderPlaylist(); }catch(_e){}
    });

    kindSel.addEventListener("change", ()=>{
      const pat = activePattern();
      if(!pat) return;
      const k = kindSel.value;
      if(_lfoPatternType(pat)==="lfo_preset"){
        pat.preset = pat.preset || {};
        pat.preset.kind = k;
      }else{
        pat.bind = pat.bind || {};
        pat.bind.kind = k;
      }
      refreshUI(); try{ renderPlaylist(); }catch(_e){}
    });

    paramSel.addEventListener("change", ()=>{
      const pat = activePattern();
      if(!pat) return;
      const v = paramSel.value;
      if(_lfoPatternType(pat)==="lfo_preset"){
        pat.preset = pat.preset || {};
        pat.preset.param = v;
      }else{
        pat.bind = pat.bind || {};
        pat.bind.param = v;
      }
      try{ renderPlaylist(); }catch(_e){}
    });

    fxSel.addEventListener("change", ()=>{
      const pat = activePattern();
      if(!pat) return;
      const ix = Number(fxSel.value||0);
      if(_lfoPatternType(pat)==="lfo_preset"){
        pat.preset = pat.preset || {};
        pat.preset.fxIndex = ix;
      }else{
        pat.bind = pat.bind || {};
        pat.bind.fxIndex = ix;
      }
      try{ renderPlaylist(); }catch(_e){}
    });

    lenSel.addEventListener("change", ()=>{
      const pat = activePattern();
      if(!pat || !_isLfoPattern(pat)) return;
      pat.lenBars = Math.max(1, Math.min(8, parseInt(lenSel.value,10)||4));
      try{
        // keep existing clips of this pattern aligned with edited pattern length
        for(const tr of (project?.playlist?.tracks||[])){
          for(const clip of (tr?.clips||[])){
            if(String(clip.patternId)===String(pat.id)) clip.lenBars = pat.lenBars;
          }
        }
      }catch(_e){}
      try{
        if(typeof patternLenSelect !== "undefined" && patternLenSelect){
          patternLenSelect.value = String(pat.lenBars);
        }
      }catch(_e){}
      try{ refreshUI(); }catch(_e){}
      try{ renderPlaylist(); }catch(_e){}
    });

    cloneBtn.addEventListener("click", ()=>{
      const pat = activePattern();
      if(!pat) return;
      if(_lfoPatternType(pat)!=="lfo_preset"){
        _safeToast("Le clonage FX est réservé aux patterns LFO preset.");
        return;
      }
      const isMaster = (scopeSel.value==="master");
      const cid = chSel.value || null;
      const mix = project.mixer;
      const bank = isMaster ? mix.master : (mix.channels.find(c=>c.id===cid) || mix.channels[0]);
      const fxArr = bank?.fx || [];
      const fx = fxArr[Number(fxSel.value||0)];
      if(!fx){
        _safeToast("Aucun FX à cloner sur ce canal.");
        return;
      }

      // store bind target (non-destructive)
      pat.preset = pat.preset || {};
      pat.preset.scope = isMaster ? "master" : "channel";
      pat.preset.channelId = isMaster ? null : bank.id;
      pat.preset.fxIndex = Number(fxSel.value||0);
      pat.preset.fxType = fx.type || fx.name || "fx";

      // IMPORTANT: snapshot (independent per preset)
      pat.preset.snapshot = {
        enabled: (fx.enabled!==false),
        params: _deepClone(fx.params ? fx.params : fx)
      };

      // open / reuse floating window
      let win = document.getElementById("__lfoFxFloat");
      if(!win){
        win = document.createElement("div");
        win.id="__lfoFxFloat";
        win.style.position="fixed";
        win.style.right="16px";
        win.style.top="70px";
        win.style.width="380px";
        win.style.maxHeight="70vh";
        win.style.overflow="auto";
        win.style.background="rgba(15,23,42,.98)";
        win.style.border="1px solid rgba(36,49,79,.9)";
        win.style.borderRadius="14px";
        win.style.boxShadow="0 12px 30px rgba(0,0,0,.45)";
        win.style.padding="12px";
        win.innerHTML = `
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <div style="font-weight:900">FX Clone (bindé)</div>
            <div style="flex:1"></div>
            <button class="pill" id="__lfoFxClose">✖</button>
          </div>
          <div id="__lfoFxBody"></div>
        `;
        document.body.appendChild(win);
        win.querySelector("#__lfoFxClose").onclick = ()=> win.remove();
      }
      window.__lfoFxCloneState.open = true;
      window.__lfoFxCloneState.patId = pat.id;

      _updateLfoFxCloneWindow();
      try{ renderPlaylist(); }catch(_e){}
    });
  }

  const isPreset = _lfoPatternType(p)==="lfo_preset";
  const isCurve = _lfoPatternType(p)==="lfo_curve";
  const _norm = (typeof _normalizeLfoPatternBinding === "function") ? _normalizeLfoPatternBinding : (window._normalizeLfoPatternBinding || null);
  if(_norm) _norm(p);
  lenSel.value = String(Math.max(1, Math.min(8, parseInt(p.lenBars||4,10)||4)));

  cloneBtn.style.display = isPreset ? "inline-flex" : "none";
  cloneBtn.textContent = "🧬 Binder FX";
  cloneBtn.title = "Binder le preset FX";

  if(titleEl){
    titleEl.textContent = isPreset ? "🧬 LFO Preset — FX Clone" : "📈 LFO Curve — Mixer Sliders";
  }
  if(helpEl){
    helpEl.textContent = isPreset
      ? "Pré-configuration d'effet : clone un FX dans une fenêtre flottante."
      : "Contrôle les sliders du mixer via une courbe A-B-C.";
  }

  scopeSel.innerHTML="";
  ["master","channel"].forEach(v=>{
    const o=document.createElement("option"); o.value=v; o.textContent=(v==="master"?"Master":"Channel"); scopeSel.appendChild(o);
  });

  chSel.innerHTML="";
  const none=document.createElement("option"); none.value=""; none.textContent="(auto)"; chSel.appendChild(none);
  for(const ch of project.mixer.channels){
    const o=document.createElement("option");
    o.value=ch.id; o.textContent=ch.name;
    chSel.appendChild(o);
  }

  kindSel.innerHTML="";
  ["mixer","fx"].forEach(v=>{
    const o=document.createElement("option");
    o.value=v; o.textContent=(v==="mixer"?"Mixer":"FX");
    kindSel.appendChild(o);
  });

  const mixerParams = [
    {k:"gain", n:"Gain"},
    {k:"pan", n:"Pan"},
    {k:"eqLow", n:"EQ Low"},
    {k:"eqMid", n:"EQ Mid"},
    {k:"eqHigh", n:"EQ High"},
    {k:"cross", n:"Cross (master)"}
  ];

  const bind = isPreset ? (p.preset||{}) : (p.bind||{});
  const scope = bind.scope || "channel";
  _safeSetSelectValue(scopeSel, scope, "channel");

  _safeSetSelectValue(chSel, (scope==="master") ? "" : (bind.channelId||""), "");

  if(isPreset){
    kindSel.value = "fx";
    kindSel.disabled = true;
  }else{
    kindSel.disabled = true;
    kindSel.value = "mixer";
    bind.kind = "mixer";
  }

  paramSel.innerHTML="";
  const wantFx = isPreset;
  if(!wantFx){
    for(const it of mixerParams){
      if(it.k==="cross" && scope!=="master") continue;
      const o=document.createElement("option"); o.value=it.k; o.textContent=it.n; paramSel.appendChild(o);
    }
    fxRow.style.display="none";
    _safeSetSelectValue(paramSel, bind.param || "gain", "gain");
  }else{
    fxRow.style.display="block";
    const mix = project.mixer;
    const bank = (scope==="master") ? mix.master : (mix.channels.find(c=>c.id===(bind.channelId||mix.channels[0].id)) || mix.channels[0]);
    const fxArr = bank?.fx || [];
    fxSel.innerHTML="";
    if(fxArr.length===0){
      const o=document.createElement("option"); o.value="0"; o.textContent="(aucun FX)"; fxSel.appendChild(o);
    }else{
      fxArr.forEach((fx,i)=>{
        const o=document.createElement("option");
        o.value=String(i);
        o.textContent = `${i+1}. ${(fx.type||fx.name||"FX")}`;
        fxSel.appendChild(o);
      });
    }
    _safeSetSelectValue(fxSel, String(bind.fxIndex||0), "0");

    // Populate FX params if available (prevents empty selector with imported projects)
    const paramsObj = fxArr[Number(bind.fxIndex||0)]?.params || {};
    const keys = Object.keys(paramsObj);
    if(keys.length===0){
      const op=document.createElement("option");
      op.value=(bind.param||"mix");
      op.textContent="(param FX — à câbler)";
      paramSel.appendChild(op);
      _safeSetSelectValue(paramSel, bind.param || "mix", bind.param || "mix");
    }else{
      for(const k of keys){
        const op=document.createElement("option");
        op.value=k;
        op.textContent=`FX Param: ${k}`;
        paramSel.appendChild(op);
      }
      _safeSetSelectValue(paramSel, bind.param || keys[0], keys[0]);
    }
  }

  if(kindRow) kindRow.style.display = isPreset ? "none" : "block";
  if(paramRow) paramRow.style.display = isPreset ? "none" : "block";
  if(fxRow) fxRow.style.display = isPreset ? "block" : "none";

  // If the floating clone editor is open, keep it in sync when switching presets.
  if(window.__lfoFxCloneState?.open){
    try{ _updateLfoFxCloneWindow(); }catch(_e){}
  }
}

function updateLfoCurvePatternEditor(){
  const wrap = document.getElementById("lfoCurveEditor");
  const canvas = document.getElementById("lfoCurvePatternCanvas");
  if(!wrap || !canvas) return;

  const p = (typeof activePattern === "function") ? activePattern() : null;
  if(!project.mixer || !Array.isArray(project.mixer.channels)) project.mixer = initMixerModel(16);
  const isCurve = p && (String(p.type||p.kind||"").toLowerCase()==="lfo_curve");

  if(!isCurve){
    wrap.style.display = "none";
    if(canvas.__lfoCleanup){
      try{ canvas.__lfoCleanup(); }catch(_e){}
      canvas.__lfoCleanup = null;
    }
    canvas.__lfoPatternId = null;
    return;
  }

  wrap.style.display = "block";
  if(window.LFO){
    if(canvas.__lfoPatternId !== p.id){
      if(canvas.__lfoCleanup){
        try{ canvas.__lfoCleanup(); }catch(_e){}
      }
      canvas.__lfoPatternId = p.id;
      canvas.__lfoCleanup = LFO.makeInteractive(canvas, p, ()=>{ try{ renderPlaylist(); }catch(_e){} });
    }else{
      try{ LFO.drawPreview(canvas, p); }catch(_e){}
    }
  }
}
