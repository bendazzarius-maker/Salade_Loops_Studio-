/* ================= Electro DAW | automationLane.js ================= */
/* P004 — Automation lane under Piano Roll (Instrument automation)
   - Dropdown lists automatable params from the selected channel's instrument uiSchema (right panel)
   - Two modes:
     - Curve (continuous sliders + Velocity)
     - Discrete (select/toggle)
   Data stored on channel:
     ch.auto = {
       "__velocity__": {mode:"curve", points:[{xStep,yVal,bias}], ...},
       "<paramKey>":   {mode:"curve"|"discrete", ...}
     }
*/

(function(){
  const $id = (id)=>document.getElementById(id);

  // DOM refs (created in index.html by P004)
  const autoWrap = ()=> $id("autoLane");
  const autoTarget = ()=> $id("autoTarget");
  const autoEditorScroll = ()=> $id("autoEditorScroll");
  const autoCanvas = ()=> $id("autoCanvas");
  const autoDiscrete = ()=> $id("autoDiscrete");

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function _patternSteps(){
    const p = (typeof activePattern==="function") ? activePattern() : null;
    const bars = (typeof patternLengthBars==="function") ? patternLengthBars(p) : (p && p.lenBars) ? p.lenBars : 4;
    const spb = (window.state && state.stepsPerBar) ? state.stepsPerBar : 16;
    return Math.max(1, bars) * spb;
  }

  function _getInstrumentDef(){
    const ch = (typeof activeChannel==="function") ? activeChannel() : null;
    if(!ch) return null;
    const presetName = ch.preset || "Piano";
    try{
      if(typeof presets !== "undefined" && presets && typeof presets.def === "function"){
        return presets.def(presetName);
      }
    }catch(_){}
    return null;
  }

  function _flattenControls(uiSchema){
    const out=[];
    if(!uiSchema || !uiSchema.sections) return out;
    for(const sec of uiSchema.sections){
      for(const ctrl of (sec.controls||[])){
        if(!ctrl || !ctrl.key) continue;
        out.push(ctrl);
      }
    }
    return out;
  }

  function _buildTargetList(){
    const list=[];
    list.push({key:"__velocity__", label:"Velocity", mode:"curve", min:1, max:127, step:1, def:100});
    const def=_getInstrumentDef();
    const schema = def ? (def.uiSchema || null) : null;
    const ctrls=_flattenControls(schema);

    for(const c of ctrls){
      const label = c.label || c.key;
      if(c.type==="slider"){
        list.push({
          key:c.key, label, mode:"curve",
          min: (c.min!=null)?Number(c.min):0,
          max: (c.max!=null)?Number(c.max):1,
          step:(c.step!=null)?Number(c.step):0.01,
          unit:c.unit||"",
          // default value for note bars when note has no stored value yet
          def: ( ( (c.min!=null)?Number(c.min):0 ) + ( (c.max!=null)?Number(c.max):1 ) ) / 2
        });
      } else if(c.type==="toggle"){
        list.push({key:c.key, label, mode:"discrete", options:[
          {value:false,label:"OFF"},{value:true,label:"ON"}
        ]});
      } else if(c.type==="select"){
        const opts=(c.options||[]).map(o=>({value:o.value,label:o.label||String(o.value)}));
        if(opts.length) list.push({key:c.key,label,mode:"discrete",options:opts});
      }
    }
    return list;
  }

  function _ensureAuto(ch){
    if(!ch.auto) ch.auto = {};
    return ch.auto;
  }

  function _ensureLaneData(ch, target){
    const store=_ensureAuto(ch);
    if(store[target.key]) return store[target.key];

    const totalSteps=_patternSteps();

    if(target.mode==="curve"){
      const mid = (target.min + target.max)/2;
      store[target.key] = {
        mode:"curve",
        points:[
          {step:0, value:mid, bias:0},
          {step:Math.max(1,totalSteps-1), value:mid, bias:0}
        ]
      };
    }else{
      store[target.key] = {
        mode:"discrete",
        steps:{} // stepIndex -> optionIndex
      };
    }
    return store[target.key];
  }

  function _cssNum(name, fallback){
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = parseFloat(v);
    return Number.isFinite(n)?n:fallback;
  }

  function _metrics(){
    const stepW = _cssNum("--roll-step-w", 18);
    const totalSteps=_patternSteps();
    const w = Math.max(1, Math.round(totalSteps*stepW));
    const h = Math.max(80, (autoEditorScroll()?.clientHeight || 140));
    return {stepW,totalSteps,w,h};
  }

  function _laneValueToY(v, target, h){
    const t = (v-target.min)/Math.max(1e-9,(target.max-target.min));
    return (1-clamp(t,0,1))*(h-1);
  }
  function _yToLaneValue(y, target, h){
    const t = 1-(y/Math.max(1,(h-1)));
    return target.min + clamp(t,0,1)*(target.max-target.min);
  }

  function _sortPoints(points){
    points.sort((a,b)=>a.step-b.step);
    // clamp monotonic
    for(let i=1;i<points.length;i++){
      if(points[i].step<points[i-1].step) points[i].step=points[i-1].step;
    }
  }

  function _drawCurve(target, laneData){
    const cv=autoCanvas(); if(!cv) return;
    const {stepW,w,h,totalSteps}=_metrics();

    // ensure canvas pixel size matches drawn size
    cv.width = w;
    cv.height = h;

    const ctx=cv.getContext("2d");
    if(!ctx) return;

    // IMPORTANT: canvas default drawing styles are black.
    // On our dark theme that makes the editor look "empty".
    // So we set explicit visible colors and always draw a subtle background.
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0,0,w,h);

    const gridCol = "rgba(255,255,255,0.07)";
    const lineCol = "rgba(255,255,255,0.85)";
    const ptCol   = "rgba(39,224,163,0.95)"; // accent

    // grid verticals (quarters)
    const spb = (window.state && state.stepsPerBar) ? state.stepsPerBar : 16;
    const q = Math.max(1, spb/4);
    ctx.strokeStyle = gridCol;
    ctx.globalAlpha = 1;
    for(let s=0;s<=totalSteps;s+=q){
      const x = s*stepW + 0.5;
      ctx.beginPath();
      ctx.moveTo(x,0);
      ctx.lineTo(x,h);
      ctx.stroke();
    }

    // horizontal guides (0%, 50%, 100%)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for(const yy of [0, Math.floor(h/2)+0.5, h-0.5]){
      ctx.beginPath();
      ctx.moveTo(0,yy);
      ctx.lineTo(w,yy);
      ctx.stroke();
    }

    const pts = laneData.points || [];
    _sortPoints(pts);

    // draw line
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for(let i=0;i<pts.length;i++){
      const p=pts[i];
      const x = p.step*stepW;
      const y = _laneValueToY(p.value, target, h);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // draw points
    for(const p of pts){
      const x=p.step*stepW, y=_laneValueToY(p.value,target,h);
      ctx.fillStyle = ptCol;
      ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fill();
      // outline for visibility
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // draw mid-bias handles between points (visual + hit target)
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const midStep = (a.step+b.step)/2;
      // bias [-1..1] : -1 = towards start, +1 = towards end
      const bias = clamp((a.bias||0), -1, 1);
      const x = midStep*stepW;
      const y = _laneValueToY((a.value+b.value)/2, target, h);
      // small handle
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    }
  }

  
  // ---------- NOTE-BARS editor (per-note automation) ----------
  function _ensureNoteBars(){
    const editor = autoEditorScroll();
    if(!editor) return null;

    let nb = $id("autoNoteBars");
    if(!nb){
      nb = document.createElement("div");
      nb.id = "autoNoteBars";
      nb.style.position = "relative";
      nb.style.height = "100%";
      nb.style.display = "none";
      // Put it after the canvas so scrollLeft is shared via editor.
      editor.appendChild(nb);
    }
    return nb;
  }

  function _drawNoteBarsGrid(nb, stepW, totalSteps, h){
    // Light background so "empty" is obvious (user asked to see something).
    nb.style.background = "rgba(0,0,0,.10)";

    // Grid as background-image (cheap DOM): step / beat / bar
    const spb = (window.state && state.stepsPerBar) ? state.stepsPerBar : 16;
    const barEvery = spb;
    const beatEvery = Math.max(1, Math.round(spb/4));

    // Build CSS gradients: step lines + beat lines + bar lines
    const stepLine = `linear-gradient(to right, rgba(255,255,255,.05) 1px, transparent 1px)`;
    const beatLine = `linear-gradient(to right, rgba(255,255,255,.10) 1px, transparent 1px)`;
    const barLine  = `linear-gradient(to right, rgba(255,255,255,.18) 1px, transparent 1px)`;

    nb.style.backgroundImage = [stepLine, beatLine, barLine].join(",");
    nb.style.backgroundSize  = `${stepW}px 100%, ${stepW*beatEvery}px 100%, ${stepW*barEvery}px 100%`;
    nb.style.backgroundPosition = "0 0, 0 0, 0 0";
  }

  function _noteValueGet(n, target){
    const fallback = (target && target.def!=null) ? target.def : ((target.min!=null && target.max!=null) ? ((target.min+target.max)/2) : 0);
    if(!n) return fallback;
    if(target.key==="__velocity__"){
      return (n.vel!=null) ? n.vel : fallback;
    }
    const ap = n.autoParams || {};
    return (ap[target.key]!=null) ? ap[target.key] : fallback;
  }
  function _noteValueSet(n, target, v){
    if(!n) return;
    if(target.key==="__velocity__"){
      n.vel = Math.round(clamp(v, target.min, target.max));
      return;
    }
    if(!n.autoParams) n.autoParams = {};
    n.autoParams[target.key] = clamp(v, target.min, target.max);
  }

  function _renderNoteBars(target, ch){
    const nb=_ensureNoteBars(); if(!nb) return;
    const {stepW,totalSteps,w,h}=_metrics();
    nb.style.width = w+"px";
    nb.style.height = h+"px";
    _drawNoteBarsGrid(nb, stepW, totalSteps, h);

    // Clear previous bars
    nb.innerHTML = "";

    // Optional title/info
    const info = document.createElement("div");
    info.style.position = "sticky";
    info.style.top = "0";
    info.style.zIndex = "5";
    info.style.padding = "6px 8px";
    info.style.fontSize = "12px";
    info.style.background = "rgba(0,0,0,.25)";
    info.style.borderBottom = "1px solid rgba(255,255,255,.08)";
    info.textContent = `NOTE BARS — ${target.label || target.key}`;
    nb.appendChild(info);

    const notes = (ch && Array.isArray(ch.notes)) ? ch.notes : [];
    if(!notes.length){
      const empty = document.createElement("div");
      empty.style.position="absolute";
      empty.style.left="10px";
      empty.style.top="50%";
      empty.style.transform="translateY(-50%)";
      empty.style.fontSize="12px";
      empty.style.color="rgba(255,255,255,.65)";
      empty.textContent = "Aucune note — ajoute des notes dans le piano roll pour voir les barres.";
      nb.appendChild(empty);
      return;
    }

    // Render bars
    const barAreaTop = 30; // below sticky info
    const barAreaH = Math.max(10, h - barAreaTop - 6);

    // We'll render a narrow bar per note, centered in its step.
    for(const n of notes){
      if(n.step==null) continue;
      const x = Math.round(n.step * stepW);

      const v = _noteValueGet(n, target);
      const t = (v - target.min) / Math.max(1e-9, (target.max - target.min));
      const hh = Math.round(clamp(t,0,1) * barAreaH);

      const bar = document.createElement("div");
      bar.className = "autoNoteBar";
      bar.dataset.noteId = String(n.id || "");
      bar.dataset.step = String(n.step);
      bar.style.position = "absolute";
      bar.style.left = (x + Math.max(0, Math.floor(stepW/2)-3)) + "px";
      bar.style.bottom = "6px";
      bar.style.width = "6px";
      bar.style.height = hh + "px";
      bar.style.borderRadius = "3px";
      bar.style.background = "rgba(39,224,163,.95)";
      bar.style.boxShadow = "0 0 0 1px rgba(0,0,0,.35)";
      bar.title = `${target.label||target.key}: ${Math.round(v*1000)/1000}`;

      // Drag to edit
      bar.addEventListener("mousedown", (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        const startY = ev.clientY;
        const startV = _noteValueGet(n, target);

        const onMove = (mv)=>{
          const dy = (startY - mv.clientY);
          const delta = (dy / Math.max(1, barAreaH)) * (target.max - target.min);
          const nv = startV + delta;
          _noteValueSet(n, target, nv);
          // Re-render quickly
          renderAutomationLane();
          // keep notes UI updated if velocity changed
          if(target.key==="__velocity__" && typeof renderNotes==="function") renderNotes();
        };
        const onUp = ()=>{
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          // Trigger UI refresh (non fatal)
          try{ document.dispatchEvent(new CustomEvent("daw:refresh")); }catch(e){}
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });

      nb.appendChild(bar);
    }
  }

function _renderDiscrete(target, laneData){
    const holder=autoDiscrete(); if(!holder) return;
    holder.innerHTML = "";
    const {stepW,totalSteps,w,h}=_metrics();
    holder.style.width = w+"px";
    holder.style.height = h+"px";

    const opts=target.options||[];
    for(let s=0;s<totalSteps;s++){
      const cell=document.createElement("div");
      cell.className="autoStep";
      cell.style.width = stepW+"px";
      cell.dataset.step = String(s);
      const idx = (laneData.steps && laneData.steps[s]!=null) ? laneData.steps[s] : 0;
      cell.textContent = opts[idx] ? opts[idx].label : "";
      cell.addEventListener("click", ()=>{
        const ch=activeChannel(); if(!ch) return;
        const lane=_ensureLaneData(ch, target);
        const cur = (lane.steps && lane.steps[s]!=null) ? lane.steps[s] : 0;
        const next = (cur+1) % Math.max(1,opts.length);
        lane.steps = lane.steps || {};
        lane.steps[s]=next;
        renderAutomationLane();
      });
      holder.appendChild(cell);
    }
  }

  function _setEditorMode(mode){
    const cv=autoCanvas(); const d=autoDiscrete();
    const nb=$id("autoNoteBars");
    if(cv) cv.style.display = (mode==="curve") ? "block" : "none";
    if(d) d.style.display = (mode==="discrete") ? "flex" : "none";
    if(nb) nb.style.display = (mode==="noteBars") ? "block" : "none";
  }

  function _fillTargetDropdown(){
    const sel=autoTarget(); if(!sel) return;
    const list=_buildTargetList();

    const cur = sel.value;
    sel.innerHTML = "";
    for(const t of list){
      const opt=document.createElement("option");
      opt.value=t.key;
      opt.textContent=t.label;
      sel.appendChild(opt);
    }
    // restore previous selection if possible
    sel.value = list.some(t=>t.key===cur) ? cur : (list[0]?.key || "__velocity__");
  }

  // Interaction state for curve editing
  let _drag = null; // {kind:"pt", idx} or {kind:"new", ...}

  function _activeTarget(){
    const list=_buildTargetList();
    const key = autoTarget()?.value || "__velocity__";
    return list.find(t=>t.key===key) || list[0];
  }

  function _canvasLocalPos(ev){
    const cv=autoCanvas();
    const r=cv.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    return {x,y};
  }

  function _hitTestPoint(pos, target, laneData){
    const {stepW,h}=_metrics();
    const pts=laneData.points||[];
    _sortPoints(pts);
    for(let i=0;i<pts.length;i++){
      const p=pts[i];
      const px=p.step*stepW;
      const py=_laneValueToY(p.value,target,h);
      const dx=pos.x-px, dy=pos.y-py;
      if(dx*dx+dy*dy <= 8*8) return {idx:i};
    }
    return null;
  }

  function _onDblClick(ev){
    const ch=activeChannel(); if(!ch) return;
    const target=_activeTarget(); if(!target || target.mode!=="curve") return;
    const lane=_ensureLaneData(ch, target);

    const {stepW,h,totalSteps}=_metrics();
    const pos=_canvasLocalPos(ev);
    const step = clamp(Math.round(pos.x/stepW),0,totalSteps-1);
    const val = _yToLaneValue(pos.y, target, h);

    lane.points = lane.points || [];
    lane.points.push({step, value:val, bias:0});
    _sortPoints(lane.points);
    renderAutomationLane();
  }

  function _onMouseDown(ev){
    if(ev.button!==0) return;
    const ch=activeChannel(); if(!ch) return;
    const target=_activeTarget(); if(!target || target.mode!=="curve") return;
    const lane=_ensureLaneData(ch, target);

    const hit=_hitTestPoint(_canvasLocalPos(ev), target, lane);
    if(hit){
      _drag={kind:"pt", idx:hit.idx, targetKey:target.key};
      ev.preventDefault();
    }
  }

  function _onMouseMove(ev){
    if(!_drag) return;
    const ch=activeChannel(); if(!ch) return;
    const target=_activeTarget(); if(!target || target.mode!=="curve") return;
    const lane=_ensureLaneData(ch, target);

    const {stepW,h,totalSteps}=_metrics();
    const pos=_canvasLocalPos(ev);
    const step = clamp(Math.round(pos.x/stepW),0,totalSteps-1);
    const val = _yToLaneValue(pos.y, target, h);

    const p = lane.points[_drag.idx];
    if(p){
      p.step=step; p.value=val;
      _sortPoints(lane.points);
      renderAutomationLane();
    }
  }

  function _onMouseUp(){
    _drag=null;
  }

  function renderAutomationLane(){
    const wrap=autoWrap(); if(!wrap) return;
    const ch = (typeof activeChannel==="function") ? activeChannel() : null;
    if(!ch){
      // still render dropdown to show velocity
      _fillTargetDropdown();
      _setEditorMode("noteBars");
      _ensureNoteBars();
      _renderNoteBars({key:"__velocity__",label:"Velocity",mode:"curve",min:1,max:127,def:100}, {notes:[]});
      return;
    }

    _fillTargetDropdown();
    const target=_activeTarget();
    const lane=_ensureLaneData(ch, target);

    if(target.mode==="curve"){
      _setEditorMode("noteBars");
      _ensureNoteBars();
      _renderNoteBars(target, ch);
    }else{
      _setEditorMode("discrete");
      _renderDiscrete(target, lane);
    }
  }

  function _wire(){
    const sel=autoTarget();
    if(sel){
      sel.addEventListener("change", ()=>renderAutomationLane());
    }
    const ed=autoEditorScroll();
    const gs = (typeof gridScroll!=="undefined") ? gridScroll : $id("gridScroll");
    if(ed && gs){
      // keep scroll synced with piano roll grid
      gs.addEventListener("scroll", ()=>{ ed.scrollLeft = gs.scrollLeft; });
      ed.addEventListener("scroll", ()=>{ gs.scrollLeft = ed.scrollLeft; });
    }
    const cv=autoCanvas();
    if(cv){
      cv.addEventListener("dblclick", _onDblClick);
      cv.addEventListener("mousedown", _onMouseDown);
    }
    window.addEventListener("mousemove", _onMouseMove);
    window.addEventListener("mouseup", _onMouseUp);

    // refresh lane whenever UI refresh happens
    window.addEventListener("daw:refresh", ()=>{ try{renderAutomationLane();}catch(_){} });
    window.addEventListener("daw:channel", ()=>{ try{renderAutomationLane();}catch(_){} });
    window.addEventListener("daw:pattern", ()=>{ try{renderAutomationLane();}catch(_){} });
  }

  window.renderAutomationLane = renderAutomationLane;

  window.addEventListener("DOMContentLoaded", ()=>{
    try{ _wire(); }catch(e){ console.error("[automationLane] wire failed", e); }
    try{ renderAutomationLane(); }catch(e){ console.error("[automationLane] render failed", e); }
  });
})();
