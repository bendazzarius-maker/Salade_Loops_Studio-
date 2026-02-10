/* ================= Electro DAW | saveLoad.js ================= */
/* ---------------- Project Save/Load ---------------- */
const deepClone = (obj) => {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
};

function exportProject(){
  return {
    schema: "ElectroDAW.Project",
    version: 1,
    savedAt: new Date().toISOString(),
    state: deepClone({
      bpm: state.bpm,
      loop: state.loop,
      preview: state.preview,
      tool: state.tool,
      snap: state.snap,
      defaultLen: state.defaultLen,
      octaveMin: state.octaveMin,
      octaveMax: state.octaveMax,
      mode: state.mode,
      bars: state.bars,
      stepsPerBar: state.stepsPerBar
    }),
    project: deepClone(project),
    instrumentPresets: (window.presetStore && presetStore.exportAll) ? presetStore.exportAll() : null
  };
}

function importProject(data){
  if(!data || data.schema !== "ElectroDAW.Project"){
    throw new Error("Fichier projet invalide (schema).");
  }
  if(!data.project || !Array.isArray(data.project.patterns) || !data.project.playlist){
    throw new Error("Fichier projet invalide (contenu).");
  }

  if(data.state){
    const s=data.state;
    if(typeof s.bpm==="number") state.bpm = clamp(s.bpm,40,240);
    if(typeof s.loop==="boolean") state.loop = s.loop;
    if(typeof s.preview==="boolean") state.preview = s.preview;
    if(typeof s.tool==="string") state.tool = s.tool;
    if(typeof s.snap==="number") state.snap = s.snap;
    if(typeof s.defaultLen==="number") state.defaultLen = s.defaultLen;
    if(typeof s.octaveMin==="number") state.octaveMin = s.octaveMin;
    if(typeof s.octaveMax==="number") state.octaveMax = s.octaveMax;
    if(typeof s.mode==="string") state.mode = s.mode;
    if(typeof s.bars==="number") state.bars = s.bars;
    if(typeof s.stepsPerBar==="number") state.stepsPerBar = s.stepsPerBar;
  }

  applyOctaves();

  project.patterns = data.project.patterns || [];
  project.activePatternId = data.project.activePatternId || (project.patterns[0]?.id ?? null);
  project.playlist = data.project.playlist || { bars: state.bars, tracks: [] };

  // Mixer (Master + Channels) restore
  if(data.project.mixer){
    project.mixer = data.project.mixer;
    // Ensure minimum channels
    if(!project.mixer.channels || !Array.isArray(project.mixer.channels)) project.mixer = initMixerModel(16);
    ensureMixerSize(Math.max(16, project.mixer.channels.length));
  } else {
    project.mixer = initMixerModel(16);
  }


  
  // Instrument presets (embedded in project file)
  try{
    if(data.instrumentPresets && window.presetStore && presetStore.importAll){
      presetStore.importAll(data.instrumentPresets, true);
    }
  }catch(_){ }

// UI sync
  $("#bpm").value = String(state.bpm);
  $("#loop").classList.toggle("active", state.loop);

  const previewBtn=$("#previewBtn");
  previewBtn.classList.toggle("active", state.preview);
  previewBtn.textContent = state.preview ? "🔊 Preview: ON" : "🔇 Preview: OFF";

  setTool(state.tool === "handler" ? "handler" : "paint");
  updateSnapLabel();
  setMode(state.mode === "song" ? "song" : "pattern");

  buildAllTimelines();
  refreshUI();
  try{ if(typeof reloadLfoBindEditorFromPlaylist === "function") reloadLfoBindEditorFromPlaylist(); }catch(_){ }
  renderAll();
  try{ renderMixerUI(); }catch(_){}
  try{ if(ae && ae.ctx && ae.mixer){ ae.applyMixerModel(project.mixer); } }catch(_){}
  stop();

  $("#hud").textContent = "Projet chargé ✅";
}

async function saveProject(){
  const payload = exportProject();

  // Electron bridge
  if(window.dawFS?.saveProject){
    const res = await window.dawFS.saveProject(payload);
    if(res?.ok){ $("#hud").textContent = "Sauvegardé ✅"; return; }
    throw new Error("Sauvegarde Electron échouée.");
  }

  // Fallback navigateur
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ElectroDAW_Project_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  $("#hud").textContent = "Export JSON téléchargé ✅";
}

async function loadProject(){
  // Electron bridge
  if(window.dawFS?.loadProject){
    const res = await window.dawFS.loadProject();
    if(!res?.ok || res.canceled) return;
    importProject(res.data);
    return;
  }

  // Fallback navigateur
  const input = $("#projectFile");
  input.value = "";
  input.onchange = async ()=>{
    const file = input.files?.[0];
    if(!file) return;
    const txt = await file.text();
    const data = JSON.parse(txt);
    importProject(data);
  };
  input.click();
}
