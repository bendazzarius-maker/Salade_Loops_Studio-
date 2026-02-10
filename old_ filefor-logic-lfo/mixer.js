/* ================= Electro DAW | mixer.js ================= */
/* Mixer UI + routing (Master + N channels) */

const FX_TYPES = ["compresseur","chorus","reverb","flanger","delay","gross beat"];

function renderMixerUI(){
  if(typeof mixerMaster==="undefined" || !mixerMaster) return;
  if(typeof project==="undefined" || !project.mixer) return;

  // ensure model size >= 16
  ensureMixerSize(Math.max(16, project.mixer.channels.length));

  // render master
  mixerMaster.innerHTML = "";
  mixerChannels.innerHTML = "";

  mixerMaster.appendChild(_makeMasterStrip());

  // render channels
  project.mixer.channels.forEach((chModel, i)=>{
    mixerChannels.appendChild(_makeChannelStrip(i+1, chModel));
  });

  // Apply to audio engine if ready
  if(ae && ae.ctx && ae.mixer){
    ae.applyMixerModel(project.mixer);
  }
}

function _makeMasterStrip(){
  const m = project.mixer.master;

  const el = document.createElement("div");
  el.className = "mixStrip master";

  const title = document.createElement("div");
  title.className="mixTitle";
  title.textContent="MASTER";
  el.appendChild(title);

  const sub = document.createElement("div");
  sub.className="mixSub";
  sub.textContent="Gain • Pan • Crossfader • EQ • FX";
  el.appendChild(sub);

  // Gain
  el.appendChild(_sliderRow("Gain", 0, 1.5, 0.01, m.gain??0.85, (v)=>{
    m.gain = v; _apply();
  }));

  // Pan
  el.appendChild(_sliderRow("Pan", -1, 1, 0.01, m.pan??0, (v)=>{
    m.pan = v; _apply();
  }));

  // Crossfader (0..1)
  el.appendChild(_sliderRow("Cross", 0, 1, 0.01, m.cross??0.5, (v)=>{
    m.cross = v;
    _apply();
    if(ae && ae.updateCrossfader) ae.updateCrossfader(v);
  }));

  // EQ
  el.appendChild(_sliderRow("EQ Low", -24, 24, 0.1, m.eqLow??0, (v)=>{ m.eqLow=v; _apply(); }));
  el.appendChild(_sliderRow("EQ Mid", -24, 24, 0.1, m.eqMid??0, (v)=>{ m.eqMid=v; _apply(); }));
  el.appendChild(_sliderRow("EQ High", -24, 24, 0.1, m.eqHigh??0, (v)=>{ m.eqHigh=v; _apply(); }));

  // FX
  el.appendChild(_fxBlock(m.fx, (newList)=>{
    m.fx = newList; _apply();
  }));

  function _apply(){
    if(ae && ae.ctx && ae.mixer) ae.applyMixerModel(project.mixer);
  }
  return el;
}

function _makeChannelStrip(index1, chModel){
  const el = document.createElement("div");
  el.className = "mixStrip";

  const title = document.createElement("div");
  title.className="mixTitle";
  title.textContent=`CH ${index1}`;
  el.appendChild(title);

  // Assign A/B/OFF for crossfader
  const assignRow = document.createElement("div");
  assignRow.className="mixRow";
  const lab = document.createElement("label");
  lab.textContent="Xfade";
  assignRow.appendChild(lab);

  const sel = document.createElement("select");
  sel.className="mixSmallSel";
  ["A","B","OFF"].forEach(v=>{
    const o=document.createElement("option"); o.value=v; o.textContent=v;
    sel.appendChild(o);
  });
  sel.value = chModel.xAssign || "A";
  sel.addEventListener("change", ()=>{
    chModel.xAssign = sel.value;
    _apply();
  });
  assignRow.appendChild(sel);
  el.appendChild(assignRow);

  // Gain / Pan / EQ
  el.appendChild(_sliderRow("Gain", 0, 1.5, 0.01, chModel.gain??0.85, (v)=>{ chModel.gain=v; _apply(); }));
  el.appendChild(_sliderRow("Pan", -1, 1, 0.01, chModel.pan??0, (v)=>{ chModel.pan=v; _apply(); }));

  el.appendChild(_sliderRow("EQ Low", -24, 24, 0.1, chModel.eqLow??0, (v)=>{ chModel.eqLow=v; _apply(); }));
  el.appendChild(_sliderRow("EQ Mid", -24, 24, 0.1, chModel.eqMid??0, (v)=>{ chModel.eqMid=v; _apply(); }));
  el.appendChild(_sliderRow("EQ High", -24, 24, 0.1, chModel.eqHigh??0, (v)=>{ chModel.eqHigh=v; _apply(); }));

  // FX block
  el.appendChild(_fxBlock(chModel.fx, (newList)=>{
    chModel.fx = newList; _apply();
  }));

  function _apply(){
    if(ae && ae.ctx && ae.mixer) ae.applyMixerModel(project.mixer);
  }

  return el;
}

function _sliderRow(label, min, max, step, value, onChange){
  const wrap = document.createElement("div");
  wrap.className="mixFader";

  const row = document.createElement("div");
  row.className="mixRow";

  const l = document.createElement("label");
  l.textContent = label;
  row.appendChild(l);

  const val = document.createElement("div");
  val.className="mixSub";
  val.textContent = String(Math.round(value*100)/100);
  row.appendChild(val);
  wrap.appendChild(row);

  const input = document.createElement("input");
  input.type="range";
  input.min=min; input.max=max; input.step=step;
  input.value=value;
  input.addEventListener("input", ()=>{
    const v = parseFloat(input.value);
    val.textContent = String(Math.round(v*100)/100);
    onChange(v);
  });
  wrap.appendChild(input);

  return wrap;
}

function _fxBlock(fxList, onUpdate){
  const box = document.createElement("div");

  const top = document.createElement("div");
  top.className="mixRow";
  const lab = document.createElement("label");
  lab.textContent="FX";
  top.appendChild(lab);

  const addSel = document.createElement("select");
  addSel.className="mixSmallSel";
  const o0=document.createElement("option"); o0.value=""; o0.textContent="+ Ajouter";
  addSel.appendChild(o0);
  FX_TYPES.forEach(t=>{
    const o=document.createElement("option"); o.value=t; o.textContent=t;
    addSel.appendChild(o);
  });
  addSel.addEventListener("change", ()=>{
    const t = addSel.value;
    addSel.value="";
    if(!t) return;
    const next = [...(fxList||[])];
    next.push({ type:t, enabled:true, params:_defaultFxParams(t) });
    onUpdate(next);
    renderMixerUI();
  });
  top.appendChild(addSel);
  box.appendChild(top);

  const list = document.createElement("div");
  list.className="fxList";

  (fxList||[]).forEach((fx, idx)=>{
    const item=document.createElement("div");
    item.className="fxItem";

    const left=document.createElement("div");
    const name=document.createElement("div");
    name.className="fxName";
    name.textContent = fx.type;
    left.appendChild(name);

    
    // params editor
    const params = fx.params || (fx.params = _defaultFxParams(fx.type));
    const paramsBox = _renderFxParams(fx.type, { ...params }, (nextParams)=>{
      fx.params = nextParams;
      const next = [...(fxList||[])];
      next[idx] = { ...next[idx], params: nextParams };
      onUpdate(next);
      // apply immediately
      if(ae && ae.ctx && ae.mixer){ ae.applyMixerModel(project.mixer); }
    });
    left.appendChild(paramsBox);
// enable
    const enRow=document.createElement("div");
    enRow.className="mixRow";
    const enLab=document.createElement("label"); enLab.textContent="ON";
    const chk=document.createElement("input"); chk.type="checkbox"; chk.checked = fx.enabled!==false;
    chk.addEventListener("change", ()=>{
      const next=[...(fxList||[])];
      next[idx] = { ...next[idx], enabled: chk.checked };
      onUpdate(next);
      renderMixerUI();
    });
    enRow.appendChild(enLab); enRow.appendChild(chk);
    left.appendChild(enRow);
    item.appendChild(left);

    const btns=document.createElement("div");
    btns.className="fxBtns";

    const rem=document.createElement("button");
    rem.className="btnTiny";
    rem.textContent="🗑";
    rem.title="Supprimer";
    rem.addEventListener("click", ()=>{
      const next=[...(fxList||[])];
      next.splice(idx,1);
      onUpdate(next);
      renderMixerUI();
    });
    btns.appendChild(rem);

    item.appendChild(btns);
    list.appendChild(item);
  });

  box.appendChild(list);
  return box;
}

function _divOptions(){
  // Kept as strings to match UI select values.
  // NOTE: GrossBeat supports higher resolution grids.
  return ["1:64","1:32","1:16","1:8","1:6","1:4","1:3","1:2"];
}

function _parseDivisionDenom(v, fallback=16){
  // Accept "1:16", "16", 16, etc.
  try{
    if(v == null) return fallback;
    if(typeof v === "number" && Number.isFinite(v)) return Math.max(1, Math.floor(v));
    const s = String(v).trim();
    const m = s.match(/(\d+)\s*:\s*(\d+)/);
    if(m) return Math.max(1, parseInt(m[2], 10) || fallback);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? Math.max(1, n) : fallback;
  }catch(_){
    return fallback;
  }
}

function _normalizeDivisionValue(v){
  const denom = _parseDivisionDenom(v, 16);
  return `1:${denom}`;
}

function _renderFxParams(type, params, onParams){
  const t = String(type||"").toLowerCase();
  const box = document.createElement("div");
  box.className = "fxParams";

  function addSlider(label, key, min, max, step){
    box.appendChild(_sliderRow(label, min, max, step, params[key] ?? 0, (v)=>{
      params[key]=v;
      onParams({ ...params });
    }));
  }
  function addSelect(label, key, options){
    const row=document.createElement("div");
    row.className="mixRow";
    const lab=document.createElement("label");
    lab.textContent=label;
    row.appendChild(lab);
    const sel=document.createElement("select");
    sel.className="mixSmallSel";
    options.forEach(opt=>{
      const o=document.createElement("option"); o.value=opt; o.textContent=opt;
      sel.appendChild(o);
    });
    // Normalize some params to match option values
    if(t.includes("gross") && key==="division"){
      const norm = _normalizeDivisionValue(params[key] ?? options[0]);
      sel.value = options.includes(norm) ? norm : options[0];
      // keep model in sync (important when params.division is stored as number)
      params[key] = sel.value;
    }else{
      sel.value = params[key] ?? options[0];
    }
    sel.addEventListener("change", ()=>{
      params[key]=sel.value;
      // auto-resize pattern for gross beat
      if(t.includes("gross") && key==="division"){
        const denom=_parseDivisionDenom(sel.value, 16);
        const arr = Array.isArray(params.pattern)? params.pattern.slice(): [];
        const out = new Array(denom).fill(0);
        for(let i=0;i<denom;i++) out[i]= !!arr[i % Math.max(1,arr.length)] ? 1:0;
        params.pattern = out;
      }
      onParams({ ...params });
    });
    row.appendChild(sel);
    box.appendChild(row);
  }

  if(t.includes("gross")){
    addSelect("Division", "division", _divOptions());
    addSlider("Wet", "wet", 0, 1, 0.01);
    addSlider("Smooth", "smooth", 0, 0.03, 0.001);

    // pattern grid
    const grid=document.createElement("div");
    grid.className="fxGrid";
    const pat = Array.isArray(params.pattern) ? params.pattern : [];
    const denom=_parseDivisionDenom(params.division || "1:16", pat.length||16);
    const arr = (pat.length===denom) ? pat : new Array(denom).fill(1);
    for(let i=0;i<denom;i++){
      const b=document.createElement("button");
      b.className = "fxCell " + (arr[i] ? "on":"off");
      b.textContent = arr[i] ? "ON" : "OFF";
      b.addEventListener("click", ()=>{
        arr[i] = arr[i] ? 0 : 1;
        params.pattern = arr.slice();
        onParams({ ...params });
        b.className = "fxCell " + (arr[i] ? "on":"off");
        b.textContent = arr[i] ? "ON" : "OFF";
      });
      grid.appendChild(b);
    }
    box.appendChild(grid);
  } else if(t.includes("delay")){
    addSelect("Division", "division", _divOptions());
    addSlider("Wet", "wet", 0, 1, 0.01);
    addSlider("Feedback", "feedback", 0, 0.95, 0.01);
    addSlider("Damp", "damp", 500, 20000, 10);
  } else if(t.includes("reverb")){
    addSlider("Wet", "wet", 0, 1, 0.01);
    addSlider("Decay", "decay", 0.2, 12, 0.05);
    addSlider("PreDelay", "preDelay", 0, 0.2, 0.001);
  } else if(t.includes("flanger") || t.includes("chorus")){
    addSlider("Wet", "wet", 0, 1, 0.01);
    addSlider("Rate", "rate", 0.05, 10, 0.01);
    addSlider("Depth", "depth", 0, 0.02, 0.0005);
    addSlider("Base", "base", 0.001, 0.04, 0.0005);
    addSlider("Feedback", "feedback", 0, 0.95, 0.01);
  } else if(t.includes("comp")){
    addSlider("Wet", "wet", 0, 1, 0.01);
    addSlider("Thresh", "threshold", -80, 0, 1);
    addSlider("Ratio", "ratio", 1, 20, 0.1);
    addSlider("Attack", "attack", 0.0005, 0.5, 0.0005);
    addSlider("Release", "release", 0.01, 2.5, 0.01);
    addSlider("Makeup", "makeup", 0, 4, 0.01);
  } else {
    addSlider("Wet", "wet", 0, 1, 0.01);
  }

  return box;
}


function _defaultFxParams(type){
  const t=String(type||"").toLowerCase();

  if(t.includes("delay")){
    return { wet:0.30, division:"1:8", feedback:0.35, damp:12000 };
  }
  if(t.includes("reverb")){
    return { wet:0.28, decay:1.8, preDelay:0.01 };
  }
  if(t.includes("flanger")){
    return { wet:0.35, rate:0.25, depth:0.002, base:0.004, feedback:0.25 };
  }
  if(t.includes("chorus")){
    return { wet:0.35, rate:0.22, depth:0.006, base:0.018, feedback:0.12 };
  }
  if(t.includes("comp")){
    return { wet:1.0, threshold:-22, ratio:4, attack:0.003, release:0.18, knee:12, makeup:1.0 };
  }
  if(t.includes("gross")){
    // division determines pattern length
    return { wet:1.0, division:"1:16", smooth:0.002, pattern:new Array(16).fill(1) };
  }
  return { wet:0.35 };
}

function _fxQuickControls(type, params, onChange){
  const wrap=document.createElement("div");
  wrap.style.display="flex";
  wrap.style.flexDirection="column";
  wrap.style.gap="6px";
  wrap.style.marginTop="6px";

  const t=String(type||"").toLowerCase();
  const p={...params};

  // Wet
  if(!t.includes("comp")){
    wrap.appendChild(_miniSlider("Wet", 0, 1, 0.01, p.wet??0.35, (v)=>{
      p.wet=v; onChange(p);
    }));
  }

  if(t.includes("delay")){
    wrap.appendChild(_miniSlider("Time", 0.01, 1.5, 0.01, p.time??0.28, (v)=>{ p.time=v; onChange(p); }));
    wrap.appendChild(_miniSlider("FB", 0, 0.92, 0.01, p.feedback??0.28, (v)=>{ p.feedback=v; onChange(p); }));
  } else if(t.includes("reverb")){
    wrap.appendChild(_miniSlider("Decay", 0.2, 8, 0.1, p.decay??1.8, (v)=>{ p.decay=v; onChange(p); }));
  } else if(t.includes("flanger")){
    wrap.appendChild(_miniSlider("Rate", 0.05, 2.0, 0.01, p.rate??0.25, (v)=>{ p.rate=v; onChange(p); }));
    wrap.appendChild(_miniSlider("Depth", 0.0001, 0.01, 0.0001, p.depth??0.002, (v)=>{ p.depth=v; onChange(p); }));
  } else if(t.includes("gross")){
    wrap.appendChild(_miniSlider("Rate", 0.5, 24, 0.1, p.rate??4, (v)=>{ p.rate=v; onChange(p); }));
    wrap.appendChild(_miniSlider("Depth", 0, 1, 0.01, p.depth??0.6, (v)=>{ p.depth=v; onChange(p); }));
  } else if(t.includes("comp")){
    wrap.appendChild(_miniSlider("Thres", -80, 0, 1, p.threshold??-22, (v)=>{ p.threshold=v; onChange(p); }));
    wrap.appendChild(_miniSlider("Ratio", 1, 20, 0.1, p.ratio??4, (v)=>{ p.ratio=v; onChange(p); }));
  }

  return wrap;
}

function _miniSlider(label, min, max, step, value, onChange){
  const row=document.createElement("div");
  row.className="mixRow";
  const l=document.createElement("label"); l.textContent=label;
  const input=document.createElement("input");
  input.type="range"; input.min=min; input.max=max; input.step=step; input.value=value;
  input.style.flex="1";
  input.addEventListener("input", ()=> onChange(parseFloat(input.value)));
  row.appendChild(l); row.appendChild(input);
  return row;
}

// ---------------- Mixer pan/scroll helpers ----------------
(function enableMixerViewportNav(){
  const viewport = document.getElementById("mixerViewport");
  if(!viewport) return;

  // avoid double-binding if hot reload / re-render
  if(viewport.__panBound) return;
  viewport.__panBound = true;

  let panning = false;
  let sx = 0, sy = 0, sl = 0, st = 0;

  viewport.addEventListener("mousedown", (e)=>{
    if(e.button !== 1) return; // middle click
    e.preventDefault();        // block browser autoscroll
    panning = true;

    viewport.classList.add("panning");
    sx = e.clientX; sy = e.clientY;
    sl = viewport.scrollLeft; st = viewport.scrollTop;
  }, { passive:false });

  window.addEventListener("mousemove", (e)=>{
    if(!panning) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    viewport.scrollLeft = sl - dx;
    viewport.scrollTop  = st - dy;
  });

  function stop(){
    if(!panning) return;
    panning = false;
    viewport.classList.remove("panning");
  }
  window.addEventListener("mouseup", stop);
  viewport.addEventListener("mouseleave", stop);

  // Bonus DAW: Shift + wheel => horizontal scroll
  viewport.addEventListener("wheel", (e)=>{
    // trackpad horizontal should stay native
    if(Math.abs(e.deltaX) > 0) return;

    if(e.shiftKey){
      e.preventDefault();
      viewport.scrollLeft += e.deltaY;
    }
  }, { passive:false });
})();

