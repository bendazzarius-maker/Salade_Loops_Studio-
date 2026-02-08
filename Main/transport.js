/* ================= Electro DAW | transport.js ================= */
/* ---------------- transport / tools (UI helpers) ----------------
   IMPORTANT: wiring.js expects GLOBAL functions:
   setTool, updateSnapLabel, cycleSnap, setMode, toggleMax
*/

function setTool(tool){
  if(!window.state) return;
  state.tool = tool;
  try{ toolPaint && toolPaint.classList.toggle("active", tool==="paint"); }catch(_){}
  try{ toolHandle && toolHandle.classList.toggle("active", tool==="handler"); }catch(_){}
}

function updateSnapLabel(){
  try{
    if(!window.state || !snapBtn) return;
    if(state.snap == null) state.snap = 16;
    snapBtn.textContent = `⏱️ Snap: 1/${16/state.snap}`;
  }catch(_){}
}

function cycleSnap(){
  try{
    if(!window.state) return;
    const snaps=[1,2,4,8,16];
    if(state.snap == null) state.snap = 16;
    const i=snaps.indexOf(state.snap);
    state.snap=snaps[(i+1)%snaps.length];
    updateSnapLabel();
  }catch(_){}
}

function _updateModeBtn(){
  try{
    if(!modeBtn) return;
    const m = state.mode || "pattern";
    modeBtn.classList.toggle("active", m==="pattern");
    modeBtn.textContent = m==="pattern" ? "🎯 MODE: PATTERN" : "🎼 MODE: SONG";
    // ensure clickable (some layouts may overlay)
    modeBtn.style.pointerEvents = "auto";
    modeBtn.style.position = modeBtn.style.position || "relative";
    modeBtn.style.zIndex = "9999";
  }catch(_){}
}

function setMode(m){
  try{
    if(!window.state) return;
    state.mode = (m==="song") ? "song" : "pattern";
    _updateModeBtn();
    // Let the rest of the UI know
    try{ window.dispatchEvent(new CustomEvent("daw:refresh")); }catch(_){}
  }catch(_){}
}

async function toggleMode(){
  try{
    if(!window.state) return;
    const next = (state.mode==="pattern") ? "song" : "pattern";
    const wasPlaying = !!state.playing;
    // Strict mode: if playing, restart in the new mode so scheduler boundaries match.
    if(wasPlaying){
      try{ stop(); }catch(_){}
      setMode(next);
      try{ await start(); }catch(_){}
    }else{
      setMode(next);
    }
  }catch(err){
    console.error("[transport] toggleMode failed", err);
  }
}

/* maximize */
function toggleMax(){
  try{
    if(!window.state) return;
    state.maximized = !state.maximized;
    if(layout){
      layout.style.gridTemplateColumns = state.maximized ? "0px 1fr 0px" : "320px 1fr 320px";
    }
    if(maxBtn){
      maxBtn.textContent = state.maximized ? "🗗 Restore" : "⛶ Maximize";
    }
  }catch(_){}
}

/* Robust binding (survives multiple script loads / DOM overlays) */
(function bindTransportUI(){
  function bind(){
    updateSnapLabel();
    if(!window.state) window.state = window.state || {};
    if(!state.mode) state.mode = "pattern";
    _updateModeBtn();

    // direct click binding (safe)
    try{
      if(modeBtn && !modeBtn.__bound_mode_v17__){
        modeBtn.__bound_mode_v17__ = true;
        modeBtn.addEventListener("click", (e)=>{
          e.preventDefault();
          toggleMode();
        });
      }
    }catch(_){}

    // delegated click binding (capture) - works even if inner elements used
    try{
      if(!window.__bound_mode_delegate_v17__){
        window.__bound_mode_delegate_v17__ = true;
        document.addEventListener("click", (e)=>{
          const btn = e.target && e.target.closest ? e.target.closest("#modeBtn") : null;
          if(!btn) return;
          e.preventDefault();
          toggleMode();
        }, true);
      }
    }catch(_){}

    // keyboard toggle (M)
    try{
      if(!window.__bound_mode_key_v17__){
        window.__bound_mode_key_v17__ = true;
        window.addEventListener("keydown", (e)=>{
          if(e.repeat) return;
          const ae = document.activeElement;
          const tag = (ae && ae.tagName ? ae.tagName.toLowerCase() : "");
          if(tag==="input" || tag==="textarea" || tag==="select" || ae?.isContentEditable) return;
          if((e.key||"").toLowerCase()==="m"){
            e.preventDefault();
            toggleMode();
          }
        });
      }
    }catch(_){}

    try{
      if(maxBtn && !maxBtn.__bound_max__){
        maxBtn.__bound_max__ = true;
        maxBtn.addEventListener("click", toggleMax);
      }
    }catch(_){}
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bind, { once:true });
  }else{
    bind();
  }
})();
