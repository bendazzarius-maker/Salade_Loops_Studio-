/* ================= Electro DAW | lfoCurveEditor.js ================= */
/* ---------------- LFO Curve Pattern Editor (clip-style curve) ---------------- */
/*
  Data model (pattern.kind === "lfo_curve"):
    pattern.curve.points = [{ t:0..1, v:0..1, biasToNext:-1..1 }, ...]
  - biasToNext lives on point i and controls the curve segment from i -> i+1
  - biasToNext = 0 => linear
  - biasToNext > 0 => rises earlier (ease-in) / drops earlier
  - biasToNext < 0 => rises later (ease-out) / drops later
*/

(function(){
  let lfoCurveCanvas = null;
  function clamp01(x){ return Math.max(0, Math.min(1, x)); }
  function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
  function lerp(a,b,t){ return a + (b-a)*t; }

  // bias function: returns eased t in [0,1]
  function biasT(t, bias){
    // bias in [-1..1] -> k in [0.2..5]
    const k = Math.pow(5, bias); // bias>0 => k>1 (earlier), bias<0 => k<1 (later)
    // Avoid extremes
    const tt = clamp01(t);
    // Smooth monotonic curve
    const a = Math.pow(tt, k);
    const b = Math.pow(1-tt, k);
    const denom = a + b;
    return denom <= 1e-9 ? tt : (a / denom);
  }

  function getActiveLfoPattern(){
    const ap = (typeof activePattern === "function") ? activePattern() : null;
    if(ap && ap.kind === "lfo_curve") return ap;
    return null;
  }

  function _collectTargetParamsForMixerChannel(idx){
    // idx is 1-based
    const out = [];
    // base mixer params
    out.push({ id:"base.gain",  label:"Gain", type:"curve" });
    out.push({ id:"base.pan",   label:"Pan", type:"curve" });
    out.push({ id:"base.eqLow", label:"EQ Low", type:"curve" });
    out.push({ id:"base.eqMid", label:"EQ Mid", type:"curve" });
    out.push({ id:"base.eqHigh",label:"EQ High", type:"curve" });

    try{
      const mix = project && project.mixer;
      const ch = mix && mix.channels ? mix.channels[idx-1] : null;
      const fx = ch && Array.isArray(ch.fx) ? ch.fx : [];
      fx.forEach((fxSlot, slotIndex)=>{
        const fxName = (fxSlot.type || "FX").toUpperCase();
        const params = fxSlot.params || {};
        Object.keys(params).forEach((k)=>{
          const v = params[k];
          let t = "option";
          if(typeof v === "number") t = "curve";
          // arrays / bool / string => option
          out.push({
            id:`fx${slotIndex}.${k}`,
            label:`FX${slotIndex+1} ${fxName} / ${k}`,
            type:t
          });
        });
      });
    }catch(_e){}
    return out;
  }

  function _inferTargetType(idx, paramId){
    if(!paramId) return "curve";
    if(paramId.startsWith("base.")) return "curve";
    // fx params: read runtime value to determine
    try{
      const mix = project && project.mixer;
      const ch = mix && mix.channels ? mix.channels[idx-1] : null;
      const m = /^fx(\d+)\.(.+)$/.exec(paramId);
      if(ch && m){
        const slot = parseInt(m[1],10);
        const key = m[2];
        const fx = ch.fx && ch.fx[slot];
        const v = fx && fx.params ? fx.params[key] : null;
        if(typeof v === "number") return "curve";
        return "option";
      }
    }catch(_e){}
    return "option";
  }

  function ensureLfoTargetsUI(p){
    try{
      if(!lfoTargetChan || !lfoTargetParam || !lfoApplyMode) return;

      // -------- channel list (mixer channels) --------
      lfoTargetChan.innerHTML = "";
      const n = (project?.mixer?.channels?.length || 16);
      for(let i=1;i<=n;i++){
        const o=document.createElement("option");
        o.value=String(i);
        o.textContent=`CH ${i}`;
        lfoTargetChan.appendChild(o);
      }

      const tgt = (p && p.target) ? p.target : (p.target = {});
      tgt.channel = parseInt(tgt.channel||1,10) || 1;
      lfoTargetChan.value = String(tgt.channel);

      // -------- param list (base + FXs on that channel) --------
      const list = _collectTargetParamsForMixerChannel(tgt.channel);
      lfoTargetParam.innerHTML = "";
      list.forEach(it=>{
        const o=document.createElement("option");
        o.value = it.id;
        o.textContent = it.label;
        lfoTargetParam.appendChild(o);
      });

      // Backward compatibility:
      // old field: target.applyMode = absolute/add/multiply
      // new UI: lfoApplyMode is used as EDITOR MODE (curve/option)
      if(!tgt.editor){
        tgt.editor = (tgt.applyMode && (tgt.applyMode==="absolute"||tgt.applyMode==="add"||tgt.applyMode==="multiply")) ? "curve" : "curve";
      }

      // default param
      if(!tgt.paramId) tgt.paramId = "base.gain";

      // ensure selected param exists
      if(!list.find(x=>x.id===tgt.paramId)){
        tgt.paramId = list[0] ? list[0].id : "base.gain";
      }
      lfoTargetParam.value = tgt.paramId;

      // auto infer editor when param type changes
      const inferred = _inferTargetType(tgt.channel, tgt.paramId);
      if(inferred === "option") tgt.editor = "option";

      // -------- editor mode select --------
      // values expected: "curve" | "option"
      lfoApplyMode.value = (tgt.editor === "option") ? "option" : "curve";

      // -------- show/hide curve canvas depending on mode --------
      try{
        const isCurve = (lfoApplyMode.value === "curve");
        if(lfoCurveCanvas) lfoCurveCanvas.style.display = isCurve ? "block" : "none";
        if(lfoHelp){
          lfoHelp.style.display = isCurve ? "none" : "block";
          if(!isCurve){
            lfoHelp.textContent = "Mode Option : ce paramètre n'est pas un potentiomètre. (Éditeur discret à venir : choix par pas / préréglages FX).";
          }
        }
      }catch(_e){}

      // bind events once
      if(!lfoTargetChan.__bound){
        lfoTargetChan.__bound=true;
        lfoTargetChan.addEventListener("change", ()=>{
          const ap=getActiveLfoPattern(); if(!ap) return;
          ap.target = ap.target || {};
          ap.target.channel = parseInt(lfoTargetChan.value||"1",10) || 1;

          // rebuild param list for new channel
          ensureLfoTargetsUI(ap);
        });
      }
      if(!lfoTargetParam.__bound){
        lfoTargetParam.__bound=true;
        lfoTargetParam.addEventListener("change", ()=>{
          const ap=getActiveLfoPattern(); if(!ap) return;
          ap.target = ap.target || {};
          ap.target.paramId = lfoTargetParam.value || "base.gain";

          // auto-infer editor mode
          const inferred = _inferTargetType(ap.target.channel||1, ap.target.paramId);
          ap.target.editor = (inferred==="option") ? "option" : (ap.target.editor||"curve");
          ensureLfoTargetsUI(ap);
        });
      }
      if(!lfoApplyMode.__bound){
        lfoApplyMode.__bound=true;
        lfoApplyMode.addEventListener("change", ()=>{
          const ap=getActiveLfoPattern(); if(!ap) return;
          ap.target = ap.target || {};
          ap.target.editor = (lfoApplyMode.value === "option") ? "option" : "curve";
          ensureLfoTargetsUI(ap);
        });
      }
    }catch(_e){}
  }

  // Show/hide editor by toggling roll elements
  window.showLfoCurveEditor = function(show){
    try{
      if(!lfoCurveWrap) return;
      lfoCurveWrap.style.display = show ? "block" : "none";
      // Hide piano elements when LFO editor is visible
      if(pianoScroll) pianoScroll.style.display = show ? "none" : "";
      if(grid && gridScroll) {
        // Keep grid container visible (we are inside it), but hide the note grid itself
        grid.style.display = show ? "none" : "";
      }
    }catch(_e){}
  };

  // Canvas + interaction state
  const ui = {
    canvas: null,
    ctx: null,
    dpr: 1,
    w: 1,
    h: 1,
    pad: 18,
    hitR: 8,
    drag: null, // {type:"pt"|"ctrl", i}
    hover: null,
    selected: new Set()
  };

  function resizeCanvas(){
    if(!ui.canvas) return;
    const rect = ui.canvas.getBoundingClientRect();
    ui.dpr = Math.max(1, window.devicePixelRatio || 1);
    ui.w = Math.max(2, Math.floor(rect.width * ui.dpr));
    ui.h = Math.max(2, Math.floor(rect.height * ui.dpr));
    ui.canvas.width = ui.w;
    ui.canvas.height = ui.h;
    draw();
  }

  function worldFromClient(x,y){
    const rect=ui.canvas.getBoundingClientRect();
    const cx=(x-rect.left);
    const cy=(y-rect.top);
    const px = (cx * ui.dpr);
    const py = (cy * ui.dpr);
    return { px, py };
  }

  function graphRect(){
    const pad=ui.pad*ui.dpr;
    return { x: pad, y: pad, w: ui.w - pad*2, h: ui.h - pad*2 };
  }

  function ptToPix(t,v){
    const g=graphRect();
    return {
      x: g.x + t*g.w,
      y: g.y + (1-v)*g.h
    };
  }

  function pixToPt(px,py){
    const g=graphRect();
    const t = (px - g.x) / g.w;
    const v = 1 - ((py - g.y) / g.h);
    return { t: clamp01(t), v: clamp01(v) };
  }

  function sortPoints(points){
    points.sort((a,b)=>a.t-b.t);
    // ensure end points are within [0,1]
    for(const p of points){
      p.t = clamp01(p.t);
      p.v = clamp01(p.v);
      if(typeof p.biasToNext !== "number") p.biasToNext = 0;
      p.biasToNext = clamp(p.biasToNext, -1, 1);
    }
  }

  function hitTest(px,py, pattern){
    const pts = pattern.curve?.points || [];
    // key points
    for(let i=0;i<pts.length;i++){
      const p=pts[i];
      const pp=ptToPix(p.t,p.v);
      const dx=pp.x-px, dy=pp.y-py;
      if(Math.hypot(dx,dy) <= ui.hitR*ui.dpr) return { type:"pt", i };
    }
    // control points (between i and i+1)
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const bias = clamp(a.biasToNext||0, -1, 1);
      const midT = (a.t + b.t)/2;
      const eased = biasT(0.5, bias);
      const midV = lerp(a.v, b.v, eased);
      const cp=ptToPix(midT, midV);
      const dx=cp.x-px, dy=cp.y-py;
      if(Math.hypot(dx,dy) <= (ui.hitR-1)*ui.dpr) return { type:"ctrl", i };
    }
    return null;
  }

  function addPoint(pattern, t, v){
    const pts = pattern.curve.points;
    // find segment insertion
    pts.push({ t, v, biasToNext:0 });
    sortPoints(pts);
    // reassign bias: keep previous biases on existing points; ok as is
  }

  function drawGrid(){
    const ctx=ui.ctx;
    const g=graphRect();
    ctx.save();
    ctx.clearRect(0,0,ui.w,ui.h);

    // background
    ctx.fillStyle="rgba(8,12,22,0.55)";
    ctx.fillRect(0,0,ui.w,ui.h);

    // border
    ctx.strokeStyle="rgba(255,255,255,0.10)";
    ctx.lineWidth=1*ui.dpr;
    ctx.strokeRect(g.x,g.y,g.w,g.h);

    // horizontal grid lines (0..1)
    ctx.strokeStyle="rgba(255,255,255,0.06)";
    ctx.lineWidth=1*ui.dpr;
    const hLines=5;
    for(let i=1;i<hLines;i++){
      const y=g.y + (i/hLines)*g.h;
      ctx.beginPath();
      ctx.moveTo(g.x,y);
      ctx.lineTo(g.x+g.w,y);
      ctx.stroke();
    }
    // vertical grid lines
    const vLines=8;
    for(let i=1;i<vLines;i++){
      const x=g.x + (i/vLines)*g.w;
      ctx.beginPath();
      ctx.moveTo(x,g.y);
      ctx.lineTo(x,g.y+g.h);
      ctx.stroke();
    }

    // labels
    ctx.fillStyle="rgba(255,255,255,0.55)";
    ctx.font=`${12*ui.dpr}px ui-sans-serif, system-ui, -apple-system`;
    ctx.fillText("MAX", g.x+6*ui.dpr, g.y+14*ui.dpr);
    ctx.fillText("0", g.x+6*ui.dpr, g.y+g.h-6*ui.dpr);

    ctx.restore();
  }

  function sampleAt(pattern, t){
    const pts = pattern.curve?.points || [];
    if(pts.length===0) return 0;
    sortPoints(pts);

    if(t<=pts[0].t) return pts[0].v;
    if(t>=pts[pts.length-1].t) return pts[pts.length-1].v;

    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      if(t>=a.t && t<=b.t){
        const local = (t-a.t) / Math.max(1e-9, (b.t-a.t));
        const eased = biasT(local, clamp(a.biasToNext||0, -1, 1));
        return lerp(a.v, b.v, eased);
      }
    }
    return pts[pts.length-1].v;
  }

  function drawCurve(pattern){
    const ctx=ui.ctx;
    const g=graphRect();
    ctx.save();

    // curve
    ctx.strokeStyle="rgba(112,167,255,0.95)";
    ctx.lineWidth=2*ui.dpr;
    ctx.beginPath();
    const steps=240;
    for(let i=0;i<=steps;i++){
      const t=i/steps;
      const v=sampleAt(pattern, t);
      const p=ptToPix(t,v);
      if(i===0) ctx.moveTo(p.x,p.y);
      else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();

    // points + control points
    const pts=pattern.curve.points;
    // control points (mid)
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const bias=clamp(a.biasToNext||0,-1,1);
      const midT=(a.t+b.t)/2;
      const midV=lerp(a.v,b.v,biasT(0.5,bias));
      const cp=ptToPix(midT, midV);

      // little line to visualize influence
      ctx.strokeStyle="rgba(255,255,255,0.08)";
      ctx.lineWidth=1*ui.dpr;
      const aa=ptToPix(a.t,a.v), bb=ptToPix(b.t,b.v);
      ctx.beginPath();
      ctx.moveTo(aa.x, aa.y);
      ctx.lineTo(cp.x, cp.y);
      ctx.lineTo(bb.x, bb.y);
      ctx.stroke();

      ctx.fillStyle="rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 4*ui.dpr, 0, Math.PI*2);
      ctx.fill();
    }

    // key points
    for(let i=0;i<pts.length;i++){
      const p=pts[i];
      const pp=ptToPix(p.t,p.v);
      ctx.fillStyle="rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 5*ui.dpr, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle="rgba(0,0,0,0.35)";
      ctx.lineWidth=2*ui.dpr;
      ctx.stroke();
    }

    ctx.restore();
  }

  function draw(){
    const p=getActiveLfoPattern();
    if(!p || !ui.ctx || !lfoCurveWrap) return;
    ensureLfoTargetsUI(p);
    drawGrid();
    drawCurve(p);
  }

  function onDown(e){
    const p=getActiveLfoPattern(); if(!p) return;
    const {px,py}=worldFromClient(e.clientX,e.clientY);
    const hit=hitTest(px,py,p);
    if(hit){
      ui.drag = hit;
      e.preventDefault();
      return;
    }
  }

  function onMove(e){
    const p=getActiveLfoPattern(); if(!p) return;
    const {px,py}=worldFromClient(e.clientX,e.clientY);

    if(ui.drag){
      const pts=p.curve.points;
      if(ui.drag.type==="pt"){
        const i=ui.drag.i;
        const pv=pixToPt(px,py);
        // prevent moving first/last t outside
        if(i===0) pv.t=0;
        if(i===pts.length-1) pv.t=1;
        pts[i].t=pv.t;
        pts[i].v=pv.v;
        sortPoints(pts);
        draw();
        e.preventDefault();
        return;
      }
      if(ui.drag.type==="ctrl"){
        const i=ui.drag.i;
        const a=pts[i], b=pts[i+1];
        // compute bias from vertical position around linear mid
        const midT=(a.t+b.t)/2;
        const pv=pixToPt(px,py);
        // vLinear at mid
        const vLin=lerp(a.v,b.v,0.5);
        // delta: up => positive bias, down => negative bias
        const delta = (pv.v - vLin);
        // scale to [-1..1] (empirical)
        const scale = 1.8; // higher = easier to get strong curves
        const bias = clamp(delta*scale, -1, 1);
        a.biasToNext = bias;
        draw();
        e.preventDefault();
        return;
      }
    }
  }

  function onUp(_e){
    ui.drag=null;
  }

  function onDblClick(e){
    const p=getActiveLfoPattern(); if(!p) return;
    const {px,py}=worldFromClient(e.clientX,e.clientY);
    const hit=hitTest(px,py,p);
    if(hit) return; // don't add on existing point
    const pv=pixToPt(px,py);
    addPoint(p, pv.t, pv.v);
    draw();
  }

  function init(){
    lfoCurveCanvas = document.getElementById("lfoCurveCanvas");
    if(!lfoCurveCanvas) return;
    ui.canvas = lfoCurveCanvas;
    ui.ctx = ui.canvas.getContext("2d");
    ui.canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    ui.canvas.addEventListener("dblclick", onDblClick);
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
  }

  // Wait for DOM refs (loaded after domRefs.js)
  window.addEventListener("DOMContentLoaded", ()=>{
    try{ init(); }catch(e){ console.error("[lfoCurveEditor] init failed", e); }
  });

  // Expose render function
  window.renderLfoCurve = function(){
    // lazy init if needed (in case DOMContentLoaded order differs)
    if(!ui.canvas && lfoCurveCanvas) init();
    resizeCanvas();
    draw();
  };
})();