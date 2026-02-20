/* ================= Electro DAW | boot.js ================= */
/* ---------------- boot ---------------- */

function _installDiag(){
  try{
    const wrap = document.createElement("div");
    wrap.id = "diag";
    wrap.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9999;width:360px;max-width:92vw;background:rgba(15,23,42,.92);border:1px solid rgba(112,167,255,.25);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.35);padding:10px;font:12px/1.35 system-ui; color:#e7ecff;";
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px; margin-bottom:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:#27e0a3;box-shadow:0 0 10px #27e0a3"></div>
        <div style="font-weight:900">Audio Debug</div>
        <div id="diag-state" style="margin-left:auto;color:#93a4c7">...</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <button id="diag-init" class="btn" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-weight:900">Init Audio</button>
        <button id="diag-beep" class="btn" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-weight:900">Test Beep</button>
        <button id="diag-c4" class="btn" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-weight:900">Test Piano C4</button>
        <button id="diag-copy" class="btn" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-weight:900">Copy Log</button>
        <button id="diag-hide" class="btn" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-weight:900">Hide</button>
      </div>
      <div id="diag-log" style="white-space:pre-wrap;max-height:160px;overflow:auto;color:#cbd5ff;"></div>
    `;
    document.body.appendChild(wrap);

    const logEl = wrap.querySelector("#diag-log");
    const stateEl = wrap.querySelector("#diag-state");
    function log(msg){
      const t = new Date().toLocaleTimeString();
      logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
    }

    window.__SL_AUDIO_DEBUG__ = {
      push: function(msg){
        log(String(msg || ""));
      },
      getText: function(){
        return logEl.textContent || "";
      },
      copy: async function(){
        const text = logEl.textContent || "";
        if (!text) return false;
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch (_) {}
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "readonly");
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          return !!ok;
        } catch (_) {
          return false;
        }
      }
    };
    function refresh(){
      try{
        const s = ae && ae.ctx ? ae.ctx.state : "noctx";
        const ct = ae && ae.ctx ? ae.ctx.currentTime.toFixed(2) : "--";
        stateEl.textContent = `${s} | t=${ct}`;
      }catch(_){}
      requestAnimationFrame(refresh);
    }
    refresh();

    window.addEventListener("error", (e)=>{
      log(`ERROR: ${e.message} (${e.filename||"?"}:${e.lineno||"?"})`);
    });
    window.addEventListener("unhandledrejection", (e)=>{
      log(`PROMISE: ${e.reason && (e.reason.message||String(e.reason))}`);
    });

    wrap.querySelector("#diag-init").addEventListener("click", async ()=>{
      try{ await ae.ensure(); log("AudioContext ensured."); }
      catch(err){ log("ensure() failed: "+(err?.message||String(err))); }
    });

    wrap.querySelector("#diag-beep").addEventListener("click", async ()=>{
      try{
        await ae.ensure();
        const ctx = ae.ctx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0.0;
        o.type="sine";
        o.frequency.value = 440;
        o.connect(g);
        g.connect(ctx.destination);
        const t = ctx.currentTime + 0.02;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12, t+0.02);
        g.gain.linearRampToValueAtTime(0.0001, t+0.18);
        o.start(t);
        o.stop(t+0.20);
        log("Beep OK (440Hz).");
      }catch(err){ log("Beep failed: "+(err?.message||String(err))); }
    });

    wrap.querySelector("#diag-c4").addEventListener("click", async ()=>{
      try{
        await ae.ensure();
        const out = (ae && ae.master) ? ae.master : (ae.ctx? ae.ctx.destination : null);
        const inst = presets.get("Piano", presets.defaults("Piano"), out);
        const t = ae.ctx.currentTime + 0.02;
        inst.trigger(t, 60, 0.9, 0.35);
        log("Triggered Piano C4.");
      }catch(err){ log("Piano test failed: "+(err?.message||String(err))); }
    });

    wrap.querySelector("#diag-copy").addEventListener("click", async ()=>{
      try{
        const ok = await window.__SL_AUDIO_DEBUG__.copy();
        log(ok ? "Log copié dans le presse-papiers." : "Copie impossible (sélection manuelle du texte diag).");
      }catch(err){
        log("Copy failed: "+(err?.message||String(err)));
      }
    });

    wrap.querySelector("#diag-hide").addEventListener("click", ()=>{
      wrap.style.display="none";
    });

    log("Diag ready. Click 'Init Audio' then 'Test Beep'.");
  }catch(e){
    console.warn("diag install failed", e);
  }
}

window.addEventListener("load",()=>{
  _installDiag();
  document.body.addEventListener("click", async ()=>{ await ae.ensure(); }, {once:true});
  seedDemo();
  refreshUI();
  buildAllTimelines();
  renderAll();
  renderMixerUI();
  try{ installZoomPan(); }catch(e){ console.warn(e); }

});
