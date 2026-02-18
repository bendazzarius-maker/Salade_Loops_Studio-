/* ================= Electro DAW | mixer.js ================= */
/* Mixer UI + routing (Master + N channels) */

const FX_TYPES = ["compresseur","chorus","reverb","flanger","delay","gross beat"];
const __mixUi = {
  meterRAF: 0,
  meterEntries: [],
  controlSync: []
};

function renderMixerUI(){
  if(typeof mixerMaster==="undefined" || !mixerMaster) return;
  if(typeof project==="undefined" || !project.mixer) return;

  // ensure model size >= 16
  ensureMixerSize(Math.max(16, project.mixer.channels.length));

  // render master
  __stopMixerMeters();
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
  __startMixerMeters();
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
  sub.textContent="Gain • Pan • Crossfader • EQ • FX Rack";
  el.appendChild(sub);

  // Gain
  el.appendChild(_gainRow("Gain", 0, 1.5, 0.01, m.gain??0.85, "master", 1, (v)=>{
    m.gain = v; _apply();
  }, ()=>m.gain));

  // Pan
  el.appendChild(_knobRow("Pan", -1, 1, 0.01, m.pan??0, (v)=>{
    m.pan = v; _apply();
  }, ()=>m.pan));

  // Crossfader (0..1)
  el.appendChild(_sliderRow("Cross", 0, 1, 0.01, m.cross??0.5, (v)=>{
    m.cross = v;
    _apply();
    if(ae && ae.updateCrossfader) ae.updateCrossfader(v);
  }, ()=>m.cross));

  // EQ
  el.appendChild(_knobRow("EQ Low", -24, 24, 0.1, m.eqLow??0, (v)=>{ m.eqLow=v; _apply(); }, ()=>m.eqLow));
  el.appendChild(_knobRow("EQ Mid", -24, 24, 0.1, m.eqMid??0, (v)=>{ m.eqMid=v; _apply(); }, ()=>m.eqMid));
  el.appendChild(_knobRow("EQ High", -24, 24, 0.1, m.eqHigh??0, (v)=>{ m.eqHigh=v; _apply(); }, ()=>m.eqHigh));

  // FX
  el.appendChild(_fxRack("master", 1, m.fx, (newList)=>{
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
  el.appendChild(_gainRow("Gain", 0, 1.5, 0.01, chModel.gain??0.85, "channel", index1, (v)=>{ chModel.gain=v; _apply(); }, ()=>chModel.gain));
  el.appendChild(_knobRow("Pan", -1, 1, 0.01, chModel.pan??0, (v)=>{ chModel.pan=v; _apply(); }, ()=>chModel.pan));

  el.appendChild(_knobRow("EQ Low", -24, 24, 0.1, chModel.eqLow??0, (v)=>{ chModel.eqLow=v; _apply(); }, ()=>chModel.eqLow));
  el.appendChild(_knobRow("EQ Mid", -24, 24, 0.1, chModel.eqMid??0, (v)=>{ chModel.eqMid=v; _apply(); }, ()=>chModel.eqMid));
  el.appendChild(_knobRow("EQ High", -24, 24, 0.1, chModel.eqHigh??0, (v)=>{ chModel.eqHigh=v; _apply(); }, ()=>chModel.eqHigh));

  // FX block
  el.appendChild(_fxRack("channel", index1, chModel.fx, (newList)=>{
    chModel.fx = newList; _apply();
  }));

  function _apply(){
    if(ae && ae.ctx && ae.mixer) ae.applyMixerModel(project.mixer);
  }

  return el;
}

function _sliderRow(label, min, max, step, value, onChange, getValue){
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
  __registerControlSync(input, min, max, ()=>{
    const v = parseFloat(input.value);
    val.textContent = String(Math.round(v*100)/100);
  }, getValue);
  wrap.appendChild(input);

  return wrap;
}

function _gainRow(label, min, max, step, value, scope, chIndex1, onChange, getValue){
  const wrap = document.createElement("div");
  wrap.className="mixFader gainRow";

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

  const body = document.createElement("div");
  body.className = "gainBody";
  const input = document.createElement("input");
  input.type = "range";
  input.min=min; input.max=max; input.step=step; input.value=value;
  input.className = "mixVertical";
  input.addEventListener("input", ()=>{
    const v = parseFloat(input.value);
    val.textContent = String(Math.round(v*100)/100);
    onChange(v);
  });
  __registerControlSync(input, min, max, ()=>{
    const v = parseFloat(input.value);
    val.textContent = String(Math.round(v*100)/100);
  }, getValue);
  body.appendChild(input);

  const meter = document.createElement("div");
  meter.className = "mixVu";
  const fill = document.createElement("div");
  fill.className = "mixVuFill";
  meter.appendChild(fill);
  body.appendChild(meter);
  wrap.appendChild(body);

  __mixUi.meterEntries.push({ scope, chIndex1, fill });
  return wrap;
}

function _knobRow(label, min, max, step, value, onChange, getValue){
  const wrap = document.createElement("div");
  wrap.className="mixKnobRow";
  const row = document.createElement("div");
  row.className="mixRow";
  const l = document.createElement("label");
  l.textContent = label;
  row.appendChild(l);
  const val = document.createElement("div");
  val.className="mixSub";
  row.appendChild(val);
  wrap.appendChild(row);

  const knobWrap = document.createElement("div");
  knobWrap.className = "mixKnobWrap";
  const input = document.createElement("input");
  input.type = "range";
  input.min=min; input.max=max; input.step=step; input.value=value;
  input.className = "mixKnob";
  knobWrap.appendChild(input);
  wrap.appendChild(knobWrap);

  const paint = ()=>{
    const v = parseFloat(input.value);
    const t = (v - min) / Math.max(1e-9, (max-min));
    const deg = -135 + (270*t);
    input.style.setProperty("--ang", `${deg}deg`);
    val.textContent = String(Math.round(v*100)/100);
  };
  input.addEventListener("input", ()=>{ paint(); onChange(parseFloat(input.value)); });
  __registerControlSync(input, min, max, paint, getValue);
  paint();
  return wrap;
}

function __registerControlSync(input, min, max, paint, getValue){
  if(typeof getValue !== "function") return;
  __mixUi.controlSync.push({ input, min, max, paint, getValue });
}

function _fxRack(scope, chIndex1, fxList, onUpdate){
  const rack = document.createElement("div");
  rack.className = "fxRack";

  const hdr = document.createElement("div");
  hdr.className = "mixRow";
  const t = document.createElement("label");
  t.textContent = "FX Rack";
  hdr.appendChild(t);
  const lfoBadge = document.createElement("div");
  lfoBadge.className = "lfoFeedbackBlock";
  lfoBadge.dataset.scope = scope;
  lfoBadge.dataset.channel = String(chIndex1);
  lfoBadge.textContent = "LFO: —";
  hdr.appendChild(lfoBadge);
  rack.appendChild(hdr);

  rack.appendChild(_fxBlock(scope, chIndex1, fxList, onUpdate, lfoBadge));
  return rack;
}

function _fxBlock(scope, chIndex1, fxList, onUpdate, lfoBadgeEl){
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
    item.dataset.scope = scope;
    item.dataset.channel = String(chIndex1);
    item.dataset.fxIndex = String(idx);

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
  __paintLfoVisuals(lfoBadgeEl);
  return box;
}

function __lfoMapByKey(){
  const out = new Map();
  const arr = window.__lfoVisualState?.fxMap || [];
  for(const e of arr){
    if(!e || !e.key) continue;
    out.set(String(e.key), e);
  }
  return out;
}

function __paintLfoVisuals(lfoBadgeEl){
  const map = __lfoMapByKey();
  const firstByRack = new Map();
  const items = document.querySelectorAll(".fxItem");
  items.forEach((item)=>{
    const rackKey = `${item.dataset.scope}:${item.dataset.channel}`;
    const key = `${item.dataset.scope}:${item.dataset.channel}:${item.dataset.fxIndex}`;
    const st = map.get(key);
    if(st){
      item.style.borderColor = st.color;
      item.style.boxShadow = `0 0 0 1px ${st.color}55, 0 8px 18px ${st.color}33`;
      item.style.background = `linear-gradient(145deg, ${st.color}22, rgba(0,0,0,.22) 52%)`;
      if(!firstByRack.has(rackKey)) firstByRack.set(rackKey, st.name);
    }else{
      item.style.borderColor = "";
      item.style.boxShadow = "";
      item.style.background = "";
    }
  });
  const badges = lfoBadgeEl ? [lfoBadgeEl] : Array.from(document.querySelectorAll(".lfoFeedbackBlock"));
  badges.forEach((b)=>{
    const rk = `${b.dataset.scope||"channel"}:${b.dataset.channel||"1"}`;
    const n = firstByRack.get(rk) || "";
    b.textContent = n ? `LFO: ${n}` : "LFO: —";
  });
}

function __stopMixerMeters(){
  if(__mixUi.meterRAF){
    cancelAnimationFrame(__mixUi.meterRAF);
    __mixUi.meterRAF = 0;
  }
  __mixUi.meterEntries = [];
  __mixUi.controlSync = [];
}

function __startMixerMeters(){
  const loop = ()=>{
    __paintLfoVisuals();
    for(const m of __mixUi.meterEntries){
      const lvl = (m.scope === "master")
        ? (ae?.getMasterMeterLevel ? ae.getMasterMeterLevel() : 0)
        : (ae?.getChannelMeterLevel ? ae.getChannelMeterLevel(m.chIndex1) : 0);
      if(m.fill) m.fill.style.height = `${Math.max(0, 100 - Math.round(lvl*100))}%`;
    }
    for(const c of __mixUi.controlSync){
      if(!c || !c.input || !c.input.isConnected) continue;
      if(c.input.matches(":active") || c.input === document.activeElement) continue;
      const nextRaw = Number(c.getValue());
      if(!Number.isFinite(nextRaw)) continue;
      const next = Math.max(c.min, Math.min(c.max, nextRaw));
      const current = Number(c.input.value);
      if(Math.abs(next - current) < 1e-4) continue;
      c.input.value = String(next);
      if(typeof c.paint === "function") c.paint();
    }
    __mixUi.meterRAF = requestAnimationFrame(loop);
  };
  __mixUi.meterRAF = requestAnimationFrame(loop);
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
