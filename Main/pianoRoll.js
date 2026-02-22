/* ================= Electro DAW | pianoRoll.js ================= */
function resolveSamplePatternParamsForPreview(pattern, channel){
  const chParams = (channel && typeof channel.params === "object" && channel.params) ? channel.params : null;
  if (chParams && chParams.samplePath) return chParams;
  const patCfg = (pattern && typeof pattern.samplePatternConfig === "object" && pattern.samplePatternConfig) ? pattern.samplePatternConfig : null;
  if (patCfg && patCfg.samplePath) {
    channel.params = Object.assign({}, patCfg, chParams || {});
    return channel.params;
  }
  return chParams;
}

/* ---------------- piano keys ---------------- */
function buildPianoColumn(){
  pianoKeys.innerHTML="";
  for(let m=midiMax(); m>=state.baseMidi; m--){
    const name=midiToName(m);
    const isBlack=name.includes("#");
    const row=document.createElement("div");
    row.className="pkey "+(isBlack?"black":"white");
    row.textContent=name;
    row.dataset.midi=String(m);

    row.addEventListener("mousedown", async (e)=>{
      if(e.button!==0) return;
      if(!state.preview) return;
      await ae.ensure();
      const ch=activeChannel(); if(!ch) return;
      const p = activePattern();
      const patType = String(p?.type || p?.kind || "").toLowerCase();
      const isSamplePattern = patType === "sample_pattern";
      const effectiveParams = isSamplePattern ? resolveSamplePatternParamsForPreview(p, ch) : ch.params;
      const hasSampleParams = !!(effectiveParams && effectiveParams.samplePath);
      const channelPreset = String(ch.preset || "");
      const presetName = (isSamplePattern || hasSampleParams || channelPreset === "Sample Paterne")
        ? "Sample Paterne"
        : (presetOverride.value || channelPreset);
      const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut||1) : ae.master);
      const inst = presets.get(presetName, effectiveParams || ch.params, outBus);
      const velv=(parseInt(vel.value,10)||100)/127;
      inst.trigger(ae.ctx.currentTime, m, velv, 0.25);
    });

    pianoKeys.appendChild(row);
  }
}

/* ---------------- grid sizing ---------------- */
function sizeGrid(){
  const rowH=cssNum("--row-h");
  const stepW=cssNum("--roll-step-w");
  const totalSteps = project.playlist.bars * state.stepsPerBar;
  grid.style.height = `${state.noteCount * rowH}px`;
  grid.style.width  = `${totalSteps * stepW}px`;
  playhead.style.height = `${state.noteCount * rowH}px`;
}

/* ---------------- note find + render (channel only) ---------------- */
function findNote(ch,midi,step){ return ch.notes.find(n=>n.midi===midi && n.step===step) || null; }
function clearSelection(ch){ ch.notes.forEach(n=>n.selected=false); }

function renderNotes(){
  $$(".note").forEach(n=>n.remove());
  const p=activePattern(); const ch=activeChannel();
  if(!p || !ch) return;

  const rowH=cssNum("--row-h");
  const stepW=cssNum("--roll-step-w");

  for(const n of ch.notes){
    const el=document.createElement("div");
    el.className="note"+(n.selected?" selected":"");
    el.dataset.id = n.id;
    const row=rowFromMidi(n.midi);
    el.style.left = `${n.step * stepW}px`;
    el.style.top  = `${row * rowH}px`;
    el.style.width= `${Math.max(1,n.len) * stepW}px`;
    el.style.background = ch.color;

    const h=document.createElement("div");
    h.className="handle";
    h.dataset.id=n.id;
    el.appendChild(h);

    el.addEventListener("mousedown", async (e)=>{
      e.stopPropagation();
      if(e.button!==0) return;

      if(state.tool==="paint"){
        ch.notes = ch.notes.filter(x=>x.id!==n.id);
        renderNotes();
        renderPlaylist(); // longueur pattern peut changer
        return;
      }

      // Selection: Ctrl=toggle, Shift=add, else single-select
      if(e.ctrlKey){
        n.selected = !n.selected;
      }else{
        if(!e.shiftKey) clearSelection(ch);
        n.selected=true;
      }
      renderNotes();

      if(state.preview){
        await ae.ensure();
        const pType = String(p?.type || p?.kind || "").toLowerCase();
        const isSamplePattern = pType === "sample_pattern";
        const effectiveParams = isSamplePattern ? resolveSamplePatternParamsForPreview(p, ch) : ch.params;
        const hasSampleParams = !!(effectiveParams && effectiveParams.samplePath);
        const channelPreset = String(ch.preset || "");
        const presetName = (isSamplePattern || hasSampleParams || channelPreset === "Sample Paterne")
          ? "Sample Paterne"
          : (presetOverride.value || channelPreset);
        const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut||1) : ae.master);
      const inst = presets.get(presetName, effectiveParams || ch.params, outBus);
        const vv=(n.vel||100)/127;
        inst.trigger(ae.ctx.currentTime, n.midi, vv, 0.25);
      }

      if(e.target.classList.contains("handle")){
        beginResize(n.id, e.clientX);
      }
    });

    grid.appendChild(el);
  }

  // Keep automation lane in sync with note edits
  if(typeof renderAutomationLane==="function") renderAutomationLane();

  try{ document.dispatchEvent(new CustomEvent('daw:refresh')); }catch(_){ }
}


/* ---- Note glow (played) ---- */
window.noteGlow = function(noteId, ms=120){
  const el = document.querySelector(`.note[data-id="${noteId}"]`);
  if(!el) return;
  el.classList.add("playing");
  setTimeout(()=>{ try{ el.classList.remove("playing"); }catch(_){} }, ms);
};

/* ---------------- time-ruler -> note selection ---------------- */
(function(){
  if(window.__rollTimeSelHookInstalled) return;
  window.__rollTimeSelHookInstalled = true;

  function selectNotesInRange(ch, startStep, endStep){
    // endStep is exclusive
    ch.notes.forEach(n=>{ n.selected = false; });
    if(!(endStep > startStep)) return;

    for(const n of ch.notes){
      const n0 = n.step;
      const n1 = n.step + Math.max(1, n.len||1);
      // overlap test
      if(n0 < endStep && n1 > startStep){
        n.selected = true;
      }
    }
  }

  window.addEventListener("timeRulerSelectionChanged", (ev)=>{
    const d = ev?.detail;
    if(!d || d.scope !== "roll") return;
    const ch = activeChannel();
    const p = activePattern();
    if(!p || !ch) return;

    // When selection is cleared, do not force-clear user's manual selection unless they explicitly cleared via ruler
    // Here we follow ruler behavior: selection range always defines selection set.
    selectNotesInRange(ch, d.startStep||0, d.endStep||0);
    try{ renderNotes(); }catch(_){}
  });
})();


/* ✅ cursor->cell using gridScroll rect (no double scroll) */
function gridCellFromEvent(e){
  const viewportRect = gridScroll.getBoundingClientRect();
  const x = (e.clientX - viewportRect.left) + gridScroll.scrollLeft;
  const y = (e.clientY - viewportRect.top ) + gridScroll.scrollTop;

  const step = Math.floor(x / cssNum("--roll-step-w"));
  const row  = Math.floor(y / cssNum("--row-h"));
  const midi = midiFromRow(row);
  return {step,row,midi,x,y};
}

/* ---------------- paint drag ---------------- */
let mouseDown=false;
let paintMode=null; // "add"|"erase"

async function applyPaintAt(cell){
  const p=activePattern(); const ch=activeChannel();
  if(!p || !ch) return;

  if(cell.midi < state.baseMidi || cell.midi > midiMax()) return;
  if(cell.step < 0) return;

  const ex=findNote(ch, cell.midi, cell.step);

  if(paintMode==="erase"){
    if(ex){
      ch.notes = ch.notes.filter(n=>n.id!==ex.id);
      renderNotes(); renderPlaylist();
    }
    return;
  }

  if(!ex){
    ch.notes.push({
      id:gid("note"),
      midi:cell.midi,
      step:cell.step,
      len:state.defaultLen,
      vel:parseInt(vel.value,10)||100,
      selected:false
    });
    renderNotes(); renderPlaylist();

    if(state.preview){
      await ae.ensure();
      const p = activePattern();
      const patType = String(p?.type || p?.kind || "").toLowerCase();
      const isSamplePattern = patType === "sample_pattern";
      const effectiveParams = isSamplePattern ? resolveSamplePatternParamsForPreview(p, ch) : ch.params;
      const hasSampleParams = !!(effectiveParams && effectiveParams.samplePath);
      const channelPreset = String(ch.preset || "");
      const presetName = (isSamplePattern || hasSampleParams || channelPreset === "Sample Paterne")
        ? "Sample Paterne"
        : (presetOverride.value || channelPreset);
      const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut||1) : ae.master);
      const inst = presets.get(presetName, effectiveParams || ch.params, outBus);
      const vv=(parseInt(vel.value,10)||100)/127;
      inst.trigger(ae.ctx.currentTime, cell.midi, vv, 0.25);
    }
  }
}

grid.addEventListener("mousedown", async (e)=>{
  if(e.button!==0) return;
  mouseDown=true;

  const ch=activeChannel(); if(!ch) return;
  const cell=gridCellFromEvent(e);
  const ex=findNote(ch, cell.midi, cell.step);
  paintMode = ex ? "erase" : "add";

  if(state.tool==="paint"){
    await applyPaintAt(cell);
  }
});

grid.addEventListener("mousemove", async (e)=>{
  const cell=gridCellFromEvent(e);

  const bar = Math.floor(cell.step / state.stepsPerBar) + 1;
  const beat = Math.floor((cell.step % state.stepsPerBar)/4)+1;
  const stepInBeat = (cell.step % 4)+1;
  const nname = (cell.midi>=state.baseMidi && cell.midi<=midiMax()) ? midiToName(cell.midi) : "—";
  posTxt.textContent = `Bar ${bar} • Beat ${beat} • Step ${stepInBeat} • ${nname}`;
  hud.textContent = posTxt.textContent;

  if(!mouseDown) return;
  if(state.tool!=="paint") return;
  await applyPaintAt(cell);
});

window.addEventListener("mouseup", ()=>{ mouseDown=false; paintMode=null; });

/* ---------------- resize handler ---------------- */
let resize={active:false,id:null,startX:0,startLen:0};
function beginResize(id, clientX){
  const ch=activeChannel(); if(!ch) return;
  const n=ch.notes.find(x=>x.id===id); if(!n) return;
  resize.active=true; resize.id=id; resize.startX=clientX; resize.startLen=n.len;
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", endResize, {once:true});
}
function onResizeMove(e){
  if(!resize.active) return;
  const ch=activeChannel(); if(!ch) return;
  const n=ch.notes.find(x=>x.id===resize.id); if(!n) return;

  const dx = e.clientX - resize.startX;
  const dSteps = Math.round(dx / cssNum("--roll-step-w"));
  let newLen = Math.max(1, resize.startLen + dSteps);

  const s=Math.max(1,state.snap);
  newLen = Math.max(1, Math.round(newLen/s)*s);

  n.len=newLen;
  renderNotes();
  renderPlaylist(); // durée pattern peut changer
}
function endResize(){
  resize.active=false; resize.id=null;
  window.removeEventListener("mousemove", onResizeMove);
}

/* ---------------- scroll sync (piano<->grid, timeline<->grid) ---------------- */
function syncRollScroll(){
  pianoScroll.scrollTop = gridScroll.scrollTop;
  rollTime.style.transform = `translateX(-${gridScroll.scrollLeft}px)`;
}
gridScroll.addEventListener("scroll", syncRollScroll);


/* ---------------- time ruler selection -> note selection ---------------- */
if(!window.__slsTimeRulerSelectionHookInstalled){
  window.__slsTimeRulerSelectionHookInstalled=true;
  window.addEventListener("timeRulerSelectionChanged",(ev)=>{
    const d=ev.detail||{};
    if(d.scope!=="roll") return;
    const ch=activeChannel(); if(!ch) return;
    const start=d.startStep||0, end=d.endStep||0;
    if(end<=start){ return; }
    // Select notes whose start step is within range
    ch.notes.forEach(n=>{ n.selected = (n.step>=start && n.step<end); });
    renderNotes();
  });
}
