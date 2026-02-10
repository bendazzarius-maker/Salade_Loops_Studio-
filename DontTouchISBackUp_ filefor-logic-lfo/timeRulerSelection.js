/* ================= Electro DAW | timeRulerSelection.js =================
   P004b: Restore red time-ruler selection visualization and fix mapping
   with padding-left + horizontal scroll (piano column / playlist track column).

   This module expects buildTimeline() to create .qseg elements with dataset.q
   (global quarter index). It will ALSO paint via inline styles so it does not
   depend on CSS changes.
*/
(function(){
  const STORE_KEY = "__timeRulerSel";
  if(!window[STORE_KEY]) window[STORE_KEY] = { roll:null, plist:null };

  function cssVarPx(name){
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function stepWidthPx(scope){
    return scope==="plist" ? (cssVarPx("--plist-step-w") || 1) : (cssVarPx("--roll-step-w") || 1);
  }

  function stripPadLeftPx(strip){
    const pl = parseFloat(getComputedStyle(strip).paddingLeft || "0");
    return Number.isFinite(pl) ? pl : 0;
  }

  function getScrollLeft(scope){
    if(scope==="plist"){
      return (window.tracks && typeof tracks.scrollLeft==="number") ? tracks.scrollLeft : 0;
    }
    return (window.gridScroll && typeof gridScroll.scrollLeft==="number") ? gridScroll.scrollLeft : 0;
  }

  function getStrip(scope){
    return scope==="plist" ? document.getElementById("plistTime") : document.getElementById("rollTime");
  }

  function quarterFromClientX(scope, clientX){
    const strip = getStrip(scope);
    if(!strip) return 0;
    const rect = strip.getBoundingClientRect();
    // include scroll and exclude padding-left (piano/track column)
    const x = (clientX - rect.left - stripPadLeftPx(strip)) + getScrollLeft(scope);
    const stepW = stepWidthPx(scope);
    const stepIndex = Math.max(0, Math.floor(x / stepW));
    return Math.floor(stepIndex / 4); // 4 steps per quarter
  }

  function selectionToSteps(sel){
    if(!sel) return null;
    const a = Math.min(sel.q0, sel.q1);
    const b = Math.max(sel.q0, sel.q1);
    return { startStep: a*4, endStep: (b+1)*4 };
  }

  function paint(scope){
    const strip = getStrip(scope);
    if(!strip) return;
    const sel = window[STORE_KEY][scope];
    const a = sel ? Math.min(sel.q0, sel.q1) : 0;
    const b = sel ? Math.max(sel.q0, sel.q1) : -1;

    const segs = strip.querySelectorAll(".qseg");
    segs.forEach(s=>{
      const q = parseInt(s.dataset.q || "0", 10);
      const on = !!sel && q>=a && q<=b;

      // Inline paint (doesn't rely on CSS)
      s.style.background = on ? "rgba(255,77,109,0.35)" : "transparent";
      s.style.outline = on ? "1px solid rgba(255,77,109,0.70)" : "none";
      s.style.boxSizing = "border-box";
    });
  }

  function emit(scope){
    const steps = selectionToSteps(window[STORE_KEY][scope]);
    window.dispatchEvent(new CustomEvent("timeRulerSelectionChanged", {
      detail: {
        scope: (scope==="plist" ? "playlist" : "roll"),
        startStep: steps ? steps.startStep : 0,
        endStep: steps ? steps.endStep : 0
      }
    }));
  }

  function setSelection(scope, q0, q1){
    const a = Math.min(q0,q1);
    const b = Math.max(q0,q1);
    window[STORE_KEY][scope] = { q0:a, q1:b };
    paint(scope);
    emit(scope);
  }

  function clearSelection(scope){
    window[STORE_KEY][scope] = null;
    paint(scope);
    emit(scope);
  }

  window.getTimeRulerSelection = function(type){
    const scope = (type==="playlist" ? "plist" : "roll");
    const sel = window[STORE_KEY][scope];
    return sel ? { ...sel } : null;
  };
  window.getTimeRulerSelectionSteps = function(type){
    const scope = (type==="playlist" ? "plist" : "roll");
    return selectionToSteps(window[STORE_KEY][scope]);
  };
  window.repaintTimeRulerSelection = function(){
    paint("roll"); paint("plist");
  };

  function getScopeFromTarget(target){
    const roll = document.getElementById("rollTime");
    const plist = document.getElementById("plistTime");
    if(roll && (target===roll || roll.contains(target))) return "roll";
    if(plist && (target===plist || plist.contains(target))) return "plist";
    return null;
  }

  // Repaint after rebuilds (some renders rebuild timeline DOM)
  window.addEventListener("DOMContentLoaded", ()=>{ paint("roll"); paint("plist"); });
  window.addEventListener("ui:timelineRebuilt", ()=>{ paint("roll"); paint("plist"); });

  let dragging = null;

  document.addEventListener("mousedown", (e)=>{
    if(!e.ctrlKey || e.button !== 2) return;
    const scope = getScopeFromTarget(e.target);
    if(!scope) return;
    e.preventDefault();
    const q = quarterFromClientX(scope, e.clientX);
    dragging = { scope, startQ: q };
    setSelection(scope, q, q);
  }, true);

  document.addEventListener("mousemove", (e)=>{
    if(!dragging) return;
    e.preventDefault();
    const q = quarterFromClientX(dragging.scope, e.clientX);
    setSelection(dragging.scope, dragging.startQ, q);
  }, true);

  document.addEventListener("mouseup", (e)=>{
    if(!dragging) return;
    e.preventDefault();
    dragging = null;
  }, true);

  document.addEventListener("click", (e)=>{
    if(e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const scope = getScopeFromTarget(e.target);
    if(!scope) return;
    clearSelection(scope);
  }, true);

  document.addEventListener("contextmenu", (e)=>{
    const scope = getScopeFromTarget(e.target);
    if(!scope) return;
    if(e.ctrlKey) e.preventDefault();
  }, true);
})();
