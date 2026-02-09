/* ================= Electro DAW | lfo.js ================= */
/* ---------------- LFO utilities + Canvas rendering ---------------- */

window.LFO = window.LFO || {};

(function(){
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function isLfoPattern(p){
    const t = (p && (p.type || p.kind || p.patternType || "")).toString().toLowerCase();
    return t === "lfo_curve" || t === "lfo_preset" || t === "lfo";
  }

  function isLfoTrack(t){
    const tp = (t && (t.type || t.kind || t.trackType || "")).toString().toLowerCase();
    return tp === "lfo" || tp === "lfo_track" || tp === "automation_lfo";
  }

  // Ensure curve structure exists: A(start), B(control), C(end)
  function ensureCurve(p){
    p.curve = p.curve || {};
    let pts = p.curve.points;
    if(!Array.isArray(pts) || pts.length !== 3){
      pts = [
        { t: 0.0, v: 0.0 },   // A
        { t: 0.33, v: 0.85 }, // B control
        { t: 1.0, v: 0.15 }   // C
      ];
    }
    // normalize
    pts = pts.map((q,i)=>({
      t: clamp(Number(q.t ?? (i===0?0:i===2?1:0.5)), 0, 1),
      v: clamp(Number(q.v ?? 0.5), 0, 1)
    }));
    pts[0].t = 0; pts[2].t = 1;
    p.curve.points = pts;
    return pts;
  }

  // Quadratic bezier y(t): A->C with control B
  function quad(A,B,C,t){
    const u = 1-t;
    return (u*u*A) + (2*u*t*B) + (t*t*C);
  }

  function drawCurve(ctx, w, h, pts){
    const A = pts[0], B = pts[1], C = pts[2];
    ctx.clearRect(0,0,w,h);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    const cols = 16;
    for(let i=0;i<=cols;i++){
      const x = (i/cols)*w;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    }
    for(let j=0;j<=4;j++){
      const y = (j/4)*h;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }

    // dashed helper A-B-C
    ctx.setLineDash([6,6]);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(A.t*w,(1-A.v)*h);
    ctx.lineTo(B.t*w,(1-B.v)*h);
    ctx.lineTo(C.t*w,(1-C.v)*h);
    ctx.stroke();
    ctx.setLineDash([]);

    // curve
    ctx.strokeStyle = "rgba(255,165,60,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for(let i=0;i<=160;i++){
      const t = i/160;
      const yv = quad(A.v,B.v,C.v,t);
      const x = t*w;
      const y = (1-yv)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // endpoints A and C
    const ax = 0, ay = (1-A.v)*h;
    const cx = w, cy = (1-C.v)*h;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(ax,ay,5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

    // tiny labels
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText("A", ax+8, ay-8);
    ctx.fillText("C", cx-16, cy-8);

    // control point B
    const bx = B.t*w, by=(1-B.v)*h;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath(); ctx.arc(bx,by,6,0,Math.PI*2); ctx.fill();
  }

  function fitCanvas(canvas){
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    if(canvas.width !== Math.floor(w*dpr) || canvas.height !== Math.floor(h*dpr)){
      canvas.width = Math.floor(w*dpr);
      canvas.height = Math.floor(h*dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    return {ctx, w, h};
  }

  // Preview render (non-interactive)
  function drawPreview(canvas, pattern){
    if(!canvas || !pattern) return;
    const {ctx,w,h} = fitCanvas(canvas);
    const pts = ensureCurve(pattern);
    drawCurve(ctx,w,h,pts);
  }

  // Make canvas interactive: drag control point B
  function makeInteractive(canvas, pattern, onChange){
    if(!canvas || !pattern) return ()=>{};
    const pts = ensureCurve(pattern);

    let dragging=false;
    let dragTarget=null;

    function redraw(){
      const {ctx,w,h} = fitCanvas(canvas);
      drawCurve(ctx,w,h,pts);
    }
    redraw();

    function getMouse(e){
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left);
      const y = (e.clientY - r.top);
      return {x,y,w:r.width,h:r.height};
    }

    function hitWhich(mx,my,w,h){
      const r2 = 14*14;

      const Ax = 0;
      const Ay = (1-pts[0].v)*h;

      const Bx = pts[1].t*w;
      const By = (1-pts[1].v)*h;

      const Cx = w;
      const Cy = (1-pts[2].v)*h;

      const da = (mx-Ax)*(mx-Ax) + (my-Ay)*(my-Ay);
      if(da<=r2) return "A";

      const db = (mx-Bx)*(mx-Bx) + (my-By)*(my-By);
      if(db<=r2) return "B";

      const dc = (mx-Cx)*(mx-Cx) + (my-Cy)*(my-Cy);
      if(dc<=r2) return "C";

      return null;
    }

    function onDown(e){
      if(e.button!==0) return;
      const r = canvas.getBoundingClientRect();
      if(r.width<2 || r.height<2) return;
      const m = getMouse(e);
      const hit = hitWhich(m.x,m.y,m.w,m.h);
      if(hit){
        dragTarget = hit;
        dragging=true;
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture?.(e.pointerId);
      }
    }
    function onMove(e){
      if(!dragging) return;
      const m = getMouse(e);
      const v = clamp(1 - (m.y / m.h), 0.0, 1.0);
      if(dragTarget==="B"){
        const t = clamp(m.x / m.w, 0.02, 0.98);
        pts[1].t = t;
        pts[1].v = v;
      }else if(dragTarget==="A"){
        pts[0].t = 0;
        pts[0].v = v;
      }else if(dragTarget==="C"){
        pts[2].t = 1;
        pts[2].v = v;
      }
      pattern.curve.points = pts;
      redraw();
      try{ onChange && onChange(pattern); }catch(_){}
    }
    function onUp(e){
      if(!dragging) return;
      dragging=false;
      dragTarget=null;
      try{ onChange && onChange(pattern); }catch(_){}
    }

    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    const ro = new ResizeObserver(()=>redraw());
    ro.observe(canvas);

    return ()=>{
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try{ ro.disconnect(); }catch(_){}
    };
  }

  // Target binding schema for curve patterns
  function defaultBinding(){
    return {
      scope: "channel",   // "master" | "channel"
      channelId: null,    // mix channel id or null for master
      kind: "mixer",      // "mixer" | "fx"
      param: "gain",      // mixer param key OR fx param key
      fxIndex: 0          // index in fx array if kind==="fx"
    };
  }

  window.LFO.isLfoTrack = isLfoTrack;
  window.LFO.isLfoPattern = isLfoPattern;
  window.LFO.ensureCurve = ensureCurve;
  window.LFO.drawPreview = drawPreview;
  window.LFO.makeInteractive = makeInteractive;
  window.LFO.defaultBinding = defaultBinding;
})();
