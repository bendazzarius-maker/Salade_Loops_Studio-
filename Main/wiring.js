
function updateLoopButtonLabel(){
  const hasSel = (typeof getTimeRulerSelectionSteps === "function") && (
    ((getTimeRulerSelectionSteps("playlist")||{}).endStep||0) > ((getTimeRulerSelectionSteps("playlist")||{}).startStep||0) ||
    ((getTimeRulerSelectionSteps("roll")||{}).endStep||0) > ((getTimeRulerSelectionSteps("roll")||{}).startStep||0)
  );
  const scope = hasSel ? "SEG" : ((state.mode==="song") ? "SONG" : "PAT");
  loopBtn.textContent = `🔁 Loop ${scope}`;
  loopBtn.classList.toggle("active", !!state.loop);
}

/* ================= Electro DAW | wiring.js ================= */
/* ---------------- wiring buttons ---------------- */
toolPaint.addEventListener("click",()=>setTool("paint"));
toolHandle.addEventListener("click",()=>setTool("handler"));
snapBtn.addEventListener("click",cycleSnap);

bpm.addEventListener("change",()=>{
  state.bpm=clamp(parseInt(bpm.value,10)||120,40,240);
  bpm.value=state.bpm;
});

playBtn.addEventListener("click", async ()=>{ if(!state.playing) await start(); else pause(); });
stopBtn.addEventListener("click", stop);
loopBtn.addEventListener("click",()=>{ state.loop=!state.loop; updateLoopButtonLabel(); });
window.addEventListener("timeRulerSelectionChanged", updateLoopButtonLabel);
window.addEventListener("daw:refresh", updateLoopButtonLabel);
updateLoopButtonLabel();

function resolveSamplePatternParamsForTrigger(pattern, channel){
  const chParams = (channel && typeof channel.params === "object" && channel.params) ? channel.params : null;
  if (chParams && chParams.samplePath) return chParams;
  const patCfg = (pattern && typeof pattern.samplePatternConfig === "object" && pattern.samplePatternConfig) ? pattern.samplePatternConfig : null;
  if (patCfg && patCfg.samplePath) {
    channel.params = Object.assign({}, patCfg, chParams || {});
    return channel.params;
  }
  return chParams;
}

vel.addEventListener("input",()=> velVal.textContent=vel.value);

previewBtn.addEventListener("click",()=>{
  state.preview=!state.preview;
  previewBtn.classList.toggle("active",state.preview);
  previewBtn.textContent = state.preview ? "🔊 Preview: ON" : "🔇 Preview: OFF";
});
lenSelect.addEventListener("change",()=>{ state.defaultLen=parseInt(lenSelect.value,10)||4; });

patternLenSelect?.addEventListener("change",()=>{
  const p = activePattern(); if(!p) return;
  const v = clamp(parseInt(patternLenSelect.value,10)||4, 1, 8);
  p.lenBars = v;
  // if we are playing in PATTERN mode, apply change strictly at cycle boundary
  if(state.playing && state.mode==="pattern"){
    pb.pendingEndStep = v * state.stepsPerBar;
  }
  refreshUI(); renderPlaylist();
});

patternSelect.addEventListener("change",()=>{
  project.activePatternId=patternSelect.value;
  const p=activePattern();
  if(p && !p.activeChannelId && p.channels[0]) p.activeChannelId=p.channels[0].id;
  refreshUI(); renderAll();
});
channelSelect.addEventListener("change",()=>{
  const p=activePattern(); if(!p) return;
  p.activeChannelId=channelSelect.value;
  refreshUI(); renderNotes();
});

$("#addPattern").addEventListener("click",()=> createPattern(`Pattern ${project.patterns.length+1}`));
const _addLfoCurveBtn = document.getElementById("addLfoCurve");
if(_addLfoCurveBtn) _addLfoCurveBtn.addEventListener("click",()=> createLfoPatternCurve(`LFO Curve ${project.patterns.filter(p=> ((p.type||p.kind||"").toString().toLowerCase()==="lfo_curve")).length+1}`));
const _addLfoPresetBtn = document.getElementById("addLfoPreset");
if(_addLfoPresetBtn) _addLfoPresetBtn.addEventListener("click",()=> createLfoPatternPreset(`LFO Preset ${project.patterns.filter(p=> ((p.type||p.kind||"").toString().toLowerCase()==="lfo_preset")).length+1}`));

$("#addChannel").addEventListener("click",()=>{
  const p=activePattern(); if(!p) return;
  addChannelToPattern(p.id, "Piano", "#27e0a3");
  refreshUI(); renderAll();
});
$("#clearChannel").addEventListener("click",()=>{
  const ch=activeChannel(); if(!ch) return;
  ch.notes=[]; renderNotes(); renderPlaylist();
});
$("#addTrack").addEventListener("click",addTrack);
const _addLfoBtn = document.getElementById("addLfoTrack");
if(_addLfoBtn) _addLfoBtn.addEventListener("click", addLfoTrack);
$("#clearPlaylist").addEventListener("click",clearPlaylist);

$("#testC4").addEventListener("click", async ()=>{
  await ae.ensure();
  const ch=activeChannel(); if(!ch) return;
  const channelPreset = String(ch.preset || "");
  const presetName = (channelPreset === "Sample Paterne") ? channelPreset : (presetOverride.value || channelPreset);
  const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut||1) : ae.master);
  const inst=presets.get(presetName, effectiveParams || ch.params, outBus);
  const m = (inst.type==="drums") ? 48 : 60; // Drum hit / C4
  const vv=(parseInt(vel.value,10)||100)/127;
  inst.trigger(ae.ctx.currentTime,m,vv,0.35);
});

$("#export").addEventListener("click",()=>{ console.log("EXPORT", exportProject()); alert("Export JSON -> console (F12)."); });

/* Save / Load buttons */
$("#saveProjectBtn").addEventListener("click", async ()=>{
  try{ await saveProject(); }
  catch(err){ console.error(err); alert("Erreur sauvegarde: "+err.message); }
});
$("#loadProjectBtn").addEventListener("click", async ()=>{
  try{ await loadProject(); }
  catch(err){ console.error(err); alert("Erreur chargement: "+err.message); }
});

window.addEventListener("keydown",(e)=>{
  if(e.repeat) return;

  // Don't hijack typing
  const ae = document.activeElement;
  const tag = (ae && ae.tagName ? ae.tagName.toLowerCase() : "");
  if(tag==="input" || tag==="textarea" || tag==="select" || ae?.isContentEditable) return;

  const k=(e.key||"").toLowerCase();
  if(k==="p") setTool("paint");
  if(k==="h") setTool("handler");
  if(k==="escape") ctxEl.style.display="none";

  // Piano Roll shortcuts (selected notes)
  const ch = activeChannel();
  if(!ch) return;

  const selected = ch.notes.filter(n=>n.selected);
  if(!selected.length) return;

  const clampMidi=(m)=>Math.max(0, Math.min(127, m));
  const snapCell = Math.max(1, state?.snap || 1);

  if(e.key==="ArrowUp"){
    e.preventDefault();
    const d = e.shiftKey ? 12 : 1;
    selected.forEach(n=> n.midi = clampMidi(n.midi + d));
    renderNotes(); return;
  }
  if(e.key==="ArrowDown"){
    e.preventDefault();
    const d = e.shiftKey ? 12 : 1;
    selected.forEach(n=> n.midi = clampMidi(n.midi - d));
    renderNotes(); return;
  }
  if(e.key==="ArrowRight"){
    e.preventDefault();
    const dSteps = e.shiftKey ? 4 : snapCell; // quarter-beat or 1 cell
    selected.forEach(n=> n.step = Math.max(0, n.step + dSteps));
    renderNotes(); renderPlaylist(); return;
  }
  if(e.key==="ArrowLeft"){
    e.preventDefault();
    const dSteps = e.shiftKey ? 4 : snapCell;
    selected.forEach(n=> n.step = Math.max(0, n.step - dSteps));
    renderNotes(); renderPlaylist(); return;
  }
});


/* Mixer */
addMixChannel?.addEventListener("click",()=>{
  ensureMixerSize(project.mixer.channels.length+1);
  // also create audio nodes if audio context already started
  if(ae && ae.ctx && ae.mixer){ ae.addMixerChannel(); }
  renderMixerUI();
  refreshUI();
});
