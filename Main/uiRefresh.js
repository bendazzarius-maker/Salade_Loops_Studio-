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
function _isLfoPattern(p){
  if(!p) return false;
  const t = String(p.type||p.kind||p.patternType||"").toLowerCase();
  if(t.includes("lfo")) return true;
  // heuristics: lfo patterns usually have bind/preset structures without channels
  if(p.preset && (p.preset.fxIndex!==undefined || p.preset.params || p.preset.snapshot)) return true;
  if(p.bind && (p.bind.param || p.bind.fxIndex!==undefined)) return true;
  return false;
}
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
  if(!pat || (String(pat.type||"").toLowerCase()!=="lfo_preset")){
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
function _isLfoPattern(p){
  const t = (p && (p.type||p.kind||p.patternType||"")).toString().toLowerCase();
  return t === "lfo_curve" || t === "lfo_preset" || t === "lfo";
}

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
        openRenameSocket(e.clientX, e.clientY, ch.name, (v)=>{
          ch.name = v;
          refreshUI(); renderPlaylist();
        });
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
}

/* ---------------- LFO inspector (playlist-side binding) ---------------- */
function updateLfoInspector(){
  const wrap = document.getElementById("lfoInspector");
  if(!wrap) return;

  const p = (typeof activePattern === "function") ? activePattern() : null;
  if(!p || !_isLfoPattern(p)){
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";

  const scopeSel = document.getElementById("lfoScope");
  const chSel = document.getElementById("lfoChannel");
  const kindSel = document.getElementById("lfoBindKind");
  const paramSel = document.getElementById("lfoParam");
  const fxRow = document.getElementById("lfoFxRow");
  const fxSel = document.getElementById("lfoFx");
  const cloneBtn = document.getElementById("lfoCloneFx");

  if(!scopeSel || !chSel || !kindSel || !paramSel || !fxSel || !fxRow || !cloneBtn) return;

  // One-time listener binding (non-destructive)
  if(!wrap.__bound){
    wrap.__bound = true;

    scopeSel.addEventListener("change", ()=>{
      const pat = activePattern();
      if(!pat) return;
      if(pat.type==="lfo_preset"){
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
      if(pat.type==="lfo_preset"){
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
      if(pat.type==="lfo_preset"){
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
      if(pat.type==="lfo_preset"){
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
      if(pat.type==="lfo_preset"){
        pat.preset = pat.preset || {};
        pat.preset.fxIndex = ix;
      }else{
        pat.bind = pat.bind || {};
        pat.bind.fxIndex = ix;
      }
      try{ renderPlaylist(); }catch(_e){}
    });

    cloneBtn.addEventListener("click", ()=>{
      const pat = activePattern();
      if(!pat) return;
      if(String(pat.type||"").toLowerCase()!=="lfo_preset"){
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

  const isPreset = (p.type||"").toString().toLowerCase()==="lfo_preset";

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
  scopeSel.value = scope;

  chSel.value = (bind.channelId||"");
  if(scope==="master") chSel.value = "";

  if(isPreset){
    kindSel.value = "fx";
    kindSel.disabled = true;
  }else{
    kindSel.disabled = false;
    kindSel.value = bind.kind || "mixer";
  }

  paramSel.innerHTML="";
  const wantFx = (isPreset || kindSel.value==="fx");
  if(!wantFx){
    for(const it of mixerParams){
      if(it.k==="cross" && scope!=="master") continue;
      const o=document.createElement("option"); o.value=it.k; o.textContent=it.n; paramSel.appendChild(o);
    }
    fxRow.style.display="none";
    paramSel.value = bind.param || "gain";
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
    fxSel.value = String(bind.fxIndex||0);

    const op=document.createElement("option");
    op.value=(bind.param||"mix");
    op.textContent="(param FX — à câbler)";
    paramSel.appendChild(op);
    paramSel.value = bind.param || "mix";
  }

  // If the floating clone editor is open, keep it in sync when switching presets.
  if(window.__lfoFxCloneState?.open){
    try{ _updateLfoFxCloneWindow(); }catch(_e){}
  }
}
