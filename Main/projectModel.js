/* ================= Electro DAW | projectModel.js ================= */
/* ---------------- project model (Pattern = multi channels) ---------------- */

function initMixerModel(num=16){
  const chs=[];
  for(let i=1;i<=num;i++){
    chs.push({
      id: gid("mix"),
      name: `CH ${i}`,
      gain: 0.85,
      pan: 0,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      xAssign: "A", // A / B / OFF
      fx: []
    });
  }
  return {
    channels: chs,
    master: {
      gain: 0.85,
      pan: 0,
      cross: 0.5,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      fx: []
    }
  };
}

function ensureMixerSize(n){
  n = Math.max(1, Math.floor(n));
  while(project.mixer.channels.length < n){
    const i = project.mixer.channels.length + 1;
    project.mixer.channels.push({
      id: gid("mix"),
      name: `CH ${i}`,
      gain: 0.85, pan:0, eqLow:0, eqMid:0, eqHigh:0,
      xAssign:"A",
      fx:[]
    });
  }
}

const project = {
  patterns: [],
  activePatternId: null,
  playlist: { bars: state.bars, tracks: [] },
  mixer: initMixerModel(16)
};

function isLfoPattern(p){
  const t = (p && (p.type || p.kind || p.patternType || "")).toString().toLowerCase();
  return t === "lfo_curve" || t === "lfo_preset" || t === "lfo";
}

function activePattern(){ return project.patterns.find(p=>p.id===project.activePatternId)||null; }

// Notes context: piano roll must always resolve to a "notes" pattern (with channels)
function activePatternNotes(){
  const p = activePattern();
  if(p && !isLfoPattern(p) && Array.isArray(p.channels)) return p;
  // fallback: first non-LFO pattern
  return project.patterns.find(x=>!isLfoPattern(x) && Array.isArray(x.channels)) || null;
}

function activeChannel(){
  const p = activePatternNotes(); if(!p) return null;
  return (p.channels||[]).find(c=>c.id===p.activeChannelId) || (p.channels||[])[0] || null;
}


function createPattern(name){
  const p={
    id:gid("pat"),
    name,
    color:"#27e0a3",
    lenBars: 4, // fixed cycle length (independent of last note)
    channels: [],
    activeChannelId: null
  };
  project.patterns.push(p);
  if(!project.activePatternId) project.activePatternId=p.id;

  // channel par défaut (Piano)
  addChannelToPattern(p.id, "Piano", "#27e0a3");

  refreshUI(); renderAll(); renderPlaylist();
}

function createLfoPatternCurve(name){
  const p={
    id:gid("lfo"),
    name,
    color:"#facc15",
    lenBars: 4,
    type:"lfo_curve",
    kind:"lfo_curve",
    // binding to a slider parameter (mixer or instrument)
    bind: (window.LFO && LFO.defaultBinding) ? LFO.defaultBinding() : {scope:"channel", channelId:null, kind:"mixer", param:"gain", fxIndex:0},
    curve: { points: (window.LFO && LFO.ensureCurve) ? LFO.ensureCurve({curve:{}}).slice?.() : [{t:0,v:0},{t:0.33,v:0.85},{t:1,v:0.15}] }
  };
  // normalize via LFO.ensureCurve if available
  try{ if(window.LFO && LFO.ensureCurve){ LFO.ensureCurve(p); } }catch(_){}
  project.patterns.push(p);
  project.activePatternId = p.id; // ok, but piano roll uses activePatternNotes()
  refreshUI(); try{ renderPlaylist(); }catch(_){}
  return p;
}

function createLfoPatternPreset(name){
  const p={
    id:gid("lfo"),
    name,
    color:"#ff4d6d",
    lenBars: 4,
    type:"lfo_preset",
    kind:"lfo_preset",
    // preset binds to an FX clone
    preset: {
      scope:"channel", // master|channel
      channelId:null,
      fxIndex:0,
      fxType:"",       // chorus/delay/...
      params:{}        // cloned params
    }
  };
  project.patterns.push(p);
  project.activePatternId = p.id;
  refreshUI(); try{ renderPlaylist(); }catch(_){}
  return p;
}


function addChannelToPattern(patternId, presetName="Piano", color="#27e0a3"){
  const p=project.patterns.find(x=>x.id===patternId); if(!p) return;
  const ch={
    id:gid("ch"),
    name:presetName,
    preset:presetName,
    color,
    muted:false,
    params: (typeof presets!=="undefined" && presets.defaults) ? presets.defaults(presetName) : {},
    mixOut: 1,
    notes:[]
  };
  // auto-assign mixer out (1..16+) based on channel count
  ensureMixerSize(Math.max(16, project.mixer.channels.length));
  ch.mixOut = Math.min(project.mixer.channels.length, Math.max(1, p.channels.length+1));
  p.channels.push(ch);
  p.activeChannelId = ch.id;
}

function deleteChannel(patternId, channelId){
  const p=project.patterns.find(x=>x.id===patternId); if(!p) return;
  p.channels = p.channels.filter(c=>c.id!==channelId);
  if(!p.channels.length){
    addChannelToPattern(p.id,"Piano","#27e0a3");
  }
  p.activeChannelId = p.channels[0].id;
}

function addTrack(){
  const colors=["#27e0a3","#70a7ff","#ff4d6d","#facc15","#a78bfa","#ff7b42"];
  const t={id:gid("trk"),name:`Track ${project.playlist.tracks.length+1}`,color:colors[Math.floor(Math.random()*colors.length)],clips:[]};
  project.playlist.tracks.push(t);
  refreshUI(); renderPlaylist();
}

function addLfoTrack(){
  const colors=["#facc15","#ff4d6d","#70a7ff","#27e0a3"];
  const t={
    id: gid("trk"),
    name: `LFO ${project.playlist.tracks.filter(x=> (x.type||'').toString().toLowerCase()==='lfo').length+1}`,
    color: colors[(project.playlist.tracks.length)%colors.length],
    type: "LFO",
    clips: []
  };
  project.playlist.tracks.push(t);
  renderPlaylist();
  return t;
}

function clearPlaylist(){ project.playlist.tracks.forEach(t=>t.clips=[]); renderPlaylist(); }

/* ---------------- pattern length inference (in bars) ---------------- */
function patternLengthBars(p){
  // Fixed time-cycle length (preferred): p.lenBars
  if(p && typeof p.lenBars === "number" && p.lenBars > 0) return Math.max(1, Math.floor(p.lenBars));
  // Fallback: default to 4 bars (strict time cycle)
  return 4;
}
