/* ================= Electro DAW | scheduler.js ================= */
/* ---------------- play scheduler (Pattern/Song) ---------------- */

const pb = {
  timer: null,
  intervalMs: 20,   // robuste si UI lag
  lookahead: 1.2,   // robuste lors des changements de vue / gros redraw
  startT: 0,
  nextStep: 0,
  endStep: 0,
  pendingEndStep: 0,
  uiStep: 0,
  uiAbsStep: 0,
  uiSongStep: 0,
  uiRollStep: 0,
  rangeStartStep: 0,
  rangeEndStep: 0,
  forceSongFromSelection: false
};

function _selectedRangeSteps(){
  try{
    const pl = (typeof getTimeRulerSelectionSteps === "function") ? getTimeRulerSelectionSteps("playlist") : null;
    if(pl && pl.endStep > pl.startStep) return { ...pl, source:"playlist" };
    const roll = (typeof getTimeRulerSelectionSteps === "function") ? getTimeRulerSelectionSteps("roll") : null;
    if(roll && roll.endStep > roll.startStep) return { ...roll, source:"roll" };
  }catch(_){ }
  return null;
}
// ---------------- LFO preset runtime override (non-destructive) ----------------
const __lfoRT = {
  // key -> { enabled, params } original snapshot to restore when LFO not active
  orig: new Map(),
  // key -> last applied signature to avoid redundant applyMixerModel
  lastSig: new Map(),
};
// ---------------- LFO curve runtime override (mixer/FX params) ----------------
const __lfoCurveRT = {
  // key -> { value } original snapshot to restore when LFO not active
  orig: new Map(),
  // key -> last applied signature to avoid redundant applyMixerModel
  lastSig: new Map(),
};

const __lfoVisualRT = {
  fxByKey: new Map(),
};

function __lfoVisualSet(scope, chIndex1, fxIndex, pat){
  const s = (scope||"").toLowerCase()==="master" ? "master" : "channel";
  const key = `${s}:${Math.max(1, Math.floor(chIndex1||1))}:${Math.max(0, Math.floor(fxIndex||0))}`;
  __lfoVisualRT.fxByKey.set(key, {
    key,
    patternId: pat?.id || null,
    name: String(pat?.name || "LFO"),
    color: String(pat?.color || "#facc15")
  });
}

function __lfoVisualPublish(){
  try{
    window.__lfoVisualState = {
      fxMap: Array.from(__lfoVisualRT.fxByKey.values())
    };
  }catch(_){ }
}


function __deepClone(obj){
  try{
    if (typeof structuredClone === "function") return structuredClone(obj);
  }catch(_){}
  try{ return JSON.parse(JSON.stringify(obj)); }catch(_){}
  if(obj && typeof obj === "object") return { ...obj };
  return obj;
}

function __lfoCurveClamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function __lfoCurveQuad(a,b,c,t){
  const u = 1 - t;
  return (u*u*a) + (2*u*t*b) + (t*t*c);
}

function __lfoCurveEnsurePoints(p){
  const fallback = [
    { t: 0.0, v: 0.0 },
    { t: 0.33, v: 0.85 },
    { t: 1.0, v: 0.15 }
  ];
  if(!p) return fallback;
  if(window.LFO && typeof LFO.ensureCurve==="function"){
    try{ return LFO.ensureCurve(p); }catch(_){}
  }
  const pts = (p.curve && Array.isArray(p.curve.points)) ? p.curve.points : fallback;
  if(pts.length !== 3) return fallback;
  return pts.map((q,i)=>({
    t: __lfoCurveClamp(Number(q.t ?? (i===0?0:i===2?1:0.5)), 0, 1),
    v: __lfoCurveClamp(Number(q.v ?? 0.5), 0, 1)
  }));
}

function __lfoCurveSample(p, t){
  const pts = __lfoCurveEnsurePoints(p);
  const A = pts[0], B = pts[1], C = pts[2];
  return __lfoCurveClamp(__lfoCurveQuad(A.v, B.v, C.v, __lfoCurveClamp(t, 0, 1)), 0, 1);
}

function __lfoCurveKey(scope, channelId, kind, fxIndex, param){
  const sc = (scope||"channel").toLowerCase()==="master" ? "master" : "channel";
  const ch = (sc==="master") ? "master" : (channelId || "ch1");
  return `${sc}:${ch}:${kind||"mixer"}:${fxIndex||0}:${param||"gain"}`;
}

function __lfoCurveParamRange(param, scope){
  const p = String(param||"").toLowerCase();
  const isMaster = (scope||"").toLowerCase()==="master";
  if(p === "gain") return { min: 0, max: 1.5 };
  if(p === "pan") return { min: -1, max: 1 };
  if(p === "eqlow" || p === "eqmid" || p === "eqhigh") return { min: -24, max: 24 };
  if(p === "cross") return isMaster ? { min: 0, max: 1 } : null;
  return null;
}

function __lfoCurveFxParamRange(param){
  const p = String(param||"").toLowerCase();
  const ranges = {
    wet: [0,1],
    rate: [0.05,10],
    depth: [0,0.02],
    base: [0.001,0.04],
    feedback: [0,0.95],
    threshold: [-80,0],
    ratio: [1,20],
    attack: [0.0005,0.5],
    release: [0.01,2.5],
    makeup: [0,4],
    decay: [0.2,12],
    predelay: [0,0.2],
    damp: [500,20000],
    time: [0.01,1.5],
    smooth: [0,0.03]
  };
  const r = ranges[p];
  if(!r) return null;
  return { min: r[0], max: r[1] };
}


function __fxKey(scope, chIndex1, fxIndex){
  const s = (scope||"").toLowerCase()==="master" ? "master" : `ch${chIndex1||1}`;
  return `${s}:fx${fxIndex||0}`;
}

// Restore any FX not overridden on this tick
function __lfoRestoreMissing(activeKeys){
  for(const [key, snap] of __lfoRT.orig.entries()){
    if(activeKeys.has(key)) continue;
    const info = __lfoDecodeKey(key);
    if(!info) continue;
    const fx = __getMixerFx(info.scope, info.chIndex1, info.fxIndex);
    if(!fx) continue;
    // restore
    if(snap.enabled != null) fx.enabled = snap.enabled;
    if(snap.params && typeof snap.params === "object"){
      fx.params = { ...snap.params };
    }
    __lfoRT.lastSig.delete(key);
    __lfoRT.orig.delete(key);
  }
}

function __lfoDecodeKey(key){
  // "master:fx0" or "ch2:fx1"
  try{
    const [a,b] = key.split(":");
    const fxIndex = parseInt((b||"fx0").replace("fx",""),10)||0;
    if(a==="master") return {scope:"master", chIndex1:1, fxIndex};
    const m = /^ch(\d+)$/.exec(a||"");
    if(!m) return null;
    return {scope:"channel", chIndex1: parseInt(m[1],10)||1, fxIndex};
  }catch(_){ return null; }
}

function __getMixerFx(scope, chIndex1, fxIndex){
  try{
    const isMaster = (scope||"").toLowerCase()==="master";
    const list = isMaster ? (project.mixer?.master?.fx||[]) : ((project.mixer?.channels||[])[Math.max(0,(chIndex1||1)-1)]?.fx||[]);
    return list[fxIndex] || null;
  }catch(_){ return null; }
}

function __isLfoTrackModel(tr){
  try{ if(window.LFO && typeof LFO.isLfoTrack==="function") return !!LFO.isLfoTrack(tr); }catch(_){ }
  const t = (tr && (tr.type||tr.kind||tr.trackType||"")).toString().toLowerCase();
  return t === "lfo" || t === "lfo_track" || t === "automation_lfo";
}

function __lfoPatternType(p){
  return (p && (p.type||p.kind||p.patternType||"")).toString().toLowerCase();
}

function __clipLenBars(clip, pat){
  const fromClip = Math.max(0, Number(clip?.lenBars)||0);
  if(fromClip > 0) return fromClip;
  try{ return Math.max(1, patternLengthBars(pat)); }catch(_){ return 1; }
}

function __resolveMixerChannel(scope, channelId){
  const sc = (scope||"").toLowerCase();
  if(sc === "master") return { model: project.mixer?.master, keyId: "master" };
  const channels = project.mixer?.channels || [];
  const byId = channels.find(ch => String(ch.id) === String(channelId));
  if(byId) return { model: byId, keyId: String(byId.id) };
  const fallback = channels[0];
  return { model: fallback || null, keyId: fallback ? String(fallback.id) : "ch1" };
}

function __resolveMixerIndex(scope, channelId){
  const sc = (scope||"").toLowerCase();
  if(sc === "master") return 1;
  const channels = project.mixer?.channels || [];
  const byIdIndex = channels.findIndex(ch => String(ch.id) === String(channelId));
  if(byIdIndex >= 0) return byIdIndex + 1;
  const explicit = Number(channelId);
  if(Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return 1;
}

function __lfoCurveRestoreMissing(activeKeys){
  for(const [key, snap] of __lfoCurveRT.orig.entries()){
    if(activeKeys.has(key)) continue;
    const info = key.split(":");
    if(info.length < 5) continue;
    const scope = info[0];
    const channelId = info[1];
    const kind = info[2];
    const fxIndex = parseInt(info[3],10) || 0;
    const param = info.slice(4).join(":");

    if(kind === "mixer"){
      const resolved = __resolveMixerChannel(scope, channelId);
      if(resolved?.model && param in resolved.model){
        resolved.model[param] = snap.value;
      }
    }else if(kind === "fx"){
      const chIndex1 = (scope==="master") ? 1 : Math.max(1, (project.mixer?.channels||[]).findIndex(ch => String(ch.id) === String(channelId)) + 1);
      const fx = __getMixerFx(scope==="master"?"master":"channel", chIndex1, fxIndex);
      if(fx && fx.params && typeof fx.params === "object"){
        fx.params[param] = snap.value;
      }
    }

    __lfoCurveRT.lastSig.delete(key);
    __lfoCurveRT.orig.delete(key);
  }
}

function __applyLfoCurveOverrides(songStep){
  if(!state.playing) return;
  if(state.mode !== "song") return;
  if(!project || !project.playlist || !Array.isArray(project.playlist.tracks)) return;

  const activeKeys = new Set();
  const stepInSong = songStep;
  const spb = state.stepsPerBar;

  let didApply = false;
  let didRestore = false;

  for(const tr of project.playlist.tracks){
    if(!__isLfoTrackModel(tr)) continue;

    for(const clip of (tr.clips||[])){
      const pat = project.patterns.find(p => p.id === clip.patternId);
      if(!pat) continue;
      const ptype = __lfoPatternType(pat);
      if(ptype !== "lfo_curve") continue;

      const clipStartStep = (clip.startBar||0) * spb;
      const clipLenSteps = Math.max(1, __clipLenBars(clip, pat) * spb);
      const clipEndStep = clipStartStep + clipLenSteps;
      if(stepInSong < clipStartStep || stepInSong >= clipEndStep) continue;

      const patLenSteps = Math.max(1, patternLengthBars(pat) * spb);
      const stepInClip = Math.max(0, stepInSong - clipStartStep);
      const stepInPattern = stepInClip % patLenSteps;
      const t = stepInPattern / patLenSteps;
      const lfoVal = __lfoCurveSample(pat, t);

      const bind = pat.bind || {};
      const scope = (bind.scope||"channel").toString().toLowerCase();
      const kind = (bind.kind||"mixer").toString().toLowerCase();
      const param = (bind.param||"gain").toString();
      const fxIndex = Math.max(0, Math.floor(bind.fxIndex||0));

      if(kind === "mixer"){
        const range = __lfoCurveParamRange(param, scope);
        if(!range) continue;
        const resolved = __resolveMixerChannel(scope, bind.channelId);
        if(!resolved?.model) continue;
        const key = __lfoCurveKey(scope, resolved.keyId, "mixer", 0, param);
        if(!__lfoCurveRT.orig.has(key)){
          __lfoCurveRT.orig.set(key, { value: resolved.model[param] });
        }
        const value = range.min + (range.max - range.min) * lfoVal;
        const sig = JSON.stringify({ patId: pat.id, value });
        if(__lfoCurveRT.lastSig.get(key) !== sig){
          resolved.model[param] = value;
          __lfoCurveRT.lastSig.set(key, sig);
          didApply = true;
        }
        activeKeys.add(key);
      }else if(kind === "fx"){
        const range = __lfoCurveFxParamRange(param);
        if(!range) continue;
        const resolved = __resolveMixerChannel(scope, bind.channelId);
        if(!resolved?.model) continue;
        const chIndex1 = (scope==="master") ? 1 : Math.max(1, (project.mixer?.channels||[]).findIndex(ch => String(ch.id) === String(resolved.keyId)) + 1);
        const fx = __getMixerFx(scope==="master"?"master":"channel", chIndex1, fxIndex);
        if(!fx) continue;
        fx.params = fx.params && typeof fx.params === "object" ? fx.params : {};
        const key = __lfoCurveKey(scope, resolved.keyId, "fx", fxIndex, param);
        if(!__lfoCurveRT.orig.has(key)){
          __lfoCurveRT.orig.set(key, { value: fx.params[param] });
        }
        const value = range.min + (range.max - range.min) * lfoVal;
        const sig = JSON.stringify({ patId: pat.id, value });
        if(__lfoCurveRT.lastSig.get(key) !== sig){
          fx.params[param] = value;
          __lfoCurveRT.lastSig.set(key, sig);
          didApply = true;
        }
        __lfoVisualSet(scope, chIndex1, fxIndex, pat);
        activeKeys.add(key);
      }
    }
  }

  const before = __lfoCurveRT.orig.size;
  __lfoCurveRestoreMissing(activeKeys);
  const after = __lfoCurveRT.orig.size;
  if(after < before) didRestore = true;

  if(didApply || didRestore){
    try{ if(ae && ae.applyMixerModel) ae.applyMixerModel(project.mixer); }catch(_){}
  }
}

function __applyLfoPresetFxOverrides(songStep){
  // Apply overrides aligned to playhead (no lookahead)
  if(!state.playing) return;
  if(state.mode !== "song") return;
  if(!project || !project.playlist || !Array.isArray(project.playlist.tracks)) return;

  const activeKeys = new Set();
  const stepInSong = songStep; // playhead-aligned step
  const spb = state.stepsPerBar;

  let didApply = false;
  let didRestore = false;

  for(const tr of project.playlist.tracks){
    if(!__isLfoTrackModel(tr)) continue;

    for(const clip of (tr.clips||[])){
      const pat = project.patterns.find(p => p.id === clip.patternId);
      if(!pat) continue;
      const ptype = __lfoPatternType(pat);
      if(ptype !== "lfo_preset") continue;

      const clipStartStep = (clip.startBar||0) * spb;
      const clipEndStep   = ((clip.startBar||0) + __clipLenBars(clip, pat)) * spb;
      if(stepInSong < clipStartStep || stepInSong >= clipEndStep) continue;

      const bind = (pat.preset && typeof pat.preset === "object") ? pat.preset : {};
      const scope = (bind.scope||"channel").toString().toLowerCase();
      let chIndex1 = 1;

      if(scope === "master"){
        chIndex1 = 1;
      }else{
        const resolved = __resolveMixerIndex(scope, bind.channelId);
        if(resolved > 0) chIndex1 = resolved;
        else{
          try{
            const ac = (typeof activeChannel==="function") ? activeChannel() : null;
            if(ac && ac.mixOut) chIndex1 = Math.max(1, Math.floor(ac.mixOut));
          }catch(_){}
        }
      }

      const fxIndex = Math.max(0, Math.floor(bind.fxIndex||0));
      const key = __fxKey(scope, chIndex1, fxIndex);

      const fx = __getMixerFx(scope==="master"?"master":"channel", chIndex1, fxIndex);
      if(!fx) continue;

      if(!__lfoRT.orig.has(key)){
        __lfoRT.orig.set(key, {
          enabled: fx.enabled,
          params: (fx.params && typeof fx.params==="object") ? { ...fx.params } : {}
        });
      }

      const base = __lfoRT.orig.get(key) || { enabled: fx.enabled, params: {} };

      const snap =
        (bind.snapshot && typeof bind.snapshot === "object") ? bind.snapshot :
        (pat.preset && pat.preset.snapshot && typeof pat.preset.snapshot === "object") ? pat.preset.snapshot :
        bind;

      const enabled =
        (snap.enabled != null) ? !!snap.enabled :
        (bind.enabled != null) ? !!bind.enabled :
        true;

      let params =
        (snap.params && typeof snap.params==="object") ? snap.params :
        (bind.params && typeof bind.params==="object") ? bind.params :
        {};

      params = __deepClone(params || {});

      const sig = JSON.stringify({patId: pat.id, enabled, params});
      if(__lfoRT.lastSig.get(key) !== sig){
        fx.enabled = enabled;
        fx.params = { ...(base.params||{}), ...(params||{}) };
        __lfoRT.lastSig.set(key, sig);
        didApply = true;
      }

      __lfoVisualSet(scope, chIndex1, fxIndex, pat);

      activeKeys.add(key);
    }
  }

  const before = __lfoRT.orig.size;
  __lfoRestoreMissing(activeKeys);
  const after = __lfoRT.orig.size;
  if(after < before) didRestore = true;

  if(didApply || didRestore){
    try{ if(ae && ae.applyMixerModel) ae.applyMixerModel(project.mixer); }catch(_){}
  }
}
function _recalcEndStepForMode(){
  try{
    if(state.mode === "pattern"){
      const p = activePattern();
      const bars = p ? patternLengthBars(p) : 1;
      return Math.max(1, bars * state.stepsPerBar);
    }
    const start = Math.max(0, Math.floor(pb.rangeStartStep||0));
    const end = Math.max(start+1, Math.floor(pb.rangeEndStep||0));
    return Math.max(1, end - start);
  }catch(_){
    return pb.endStep || 0;
  }
}



function buildProjectSnapshotForEngine(){
  const ppqResolution = 960;
  const trackMap = new Map();
  for (const pat of (project.patterns || [])) {
    if (!Array.isArray(pat.channels)) continue;
    for (const ch of pat.channels) {
      const trackId = String(ch.id || gid("t"));
      if (!trackMap.has(trackId)) {
        trackMap.set(trackId, {
          trackId,
          name: String(ch.name || `Channel ${trackId}`),
          instrument: {
            type: "internal",
            preset: String(ch.preset || "default"),
            params: (ch && typeof ch.params === "object" && ch.params) ? JSON.parse(JSON.stringify(ch.params)) : {}
          }
        });
      }
    }
  }
  const tracks = Array.from(trackMap.values());
  (project.playlist?.tracks || []).forEach((tr) => {
    tracks.push({
    trackId: `playlist:${String(tr.id || gid("t"))}`,
    name: String(tr.name || "Track"),
    instrument: { type: "internal", preset: "default" }
  });
  });
  tracks.push({ trackId: "master", name: "Master" });

  const patterns = [];
  for (const pat of (project.patterns || [])) {
    if (!Array.isArray(pat.channels)) continue;
    for (const ch of pat.channels) {
      const notes = (ch.notes || []).map((n) => ({
        startPpq: Number(n.step || 0) * (ppqResolution / 4),
        lenPpq: Math.max(1, Number(n.len || 1)) * (ppqResolution / 4),
        note: Number(n.midi || 60),
        vel: Number((n.vel || 100) / 127),
        ch: 0
      }));
      patterns.push({ patternId: `${pat.id}:${ch.id}`, trackId: String(ch.id), notes });
    }
  }

  const arrangement = [];
  for (const tr of (project.playlist?.tracks || [])) {
    for (const clip of (tr.clips || [])) {
      const pat = project.patterns.find((p) => p.id === clip.patternId);
      if (!pat || !Array.isArray(pat.channels)) continue;
      for (const ch of pat.channels) {
        arrangement.push({
          clipId: `${clip.id || gid("c")}:${ch.id}`,
          patternId: `${pat.id}:${ch.id}`,
          startPpq: Number(clip.startBar || 0) * 4 * ppqResolution,
          lenPpq: Math.max(1, Number(clip.lenBars || 1)) * 4 * ppqResolution,
          loop: false
        });
      }
    }
  }

  return {
    projectId: "main-project",
    tempo: { bpm: state.bpm },
    ppqResolution,
    tracks,
    patterns,
    arrangement
  };
}

function audioTriggerNote(payload){
  if (window.audioBackend) {
    window.audioBackend.triggerNote(payload);
    return;
  }
  if (typeof payload.trigger === "function") payload.trigger();
}

function audioTriggerSample(payload){
  if (window.audioBackend && typeof window.audioBackend.triggerSample === "function") {
    window.audioBackend.triggerSample(payload);
    return;
  }
  if (typeof payload.trigger === "function") payload.trigger();
}

function scheduleInstrumentTrigger({ presetName, inst, t, n, vv, dur, ch, effectiveParams, patternBeats }) {
  if (presetName === "Sample Paterne") {
    const p = effectiveParams || ch.params || {};
    const samplePath = p.samplePath || p.path || p.file || (p.sample && p.sample.path) || p.url;

    if (!samplePath) {
      console.warn("[Sample Paterne] Missing samplePath", { channelId: ch && ch.id, presetName, p, effectiveParams });
      return;
    }

    const resolvedPatternBeats = Math.max(1, Number(p.patternBeats || patternBeats || 4));
    const stretchDurationSec = (60 / Math.max(20, Number(state.bpm || 120))) * resolvedPatternBeats;

    audioTriggerSample({
      trigger: () => inst.trigger(t, n.midi, vv, stretchDurationSec),
      trackId: String((ch && ch.id) || "sample-pattern"),
      samplePath,
      startNorm: p.startNorm,
      endNorm: p.endNorm,
      rootMidi: p.rootMidi,
      pitchMode: p.pitchMode,
      gain: p.gain,
      note: n.midi,
      velocity: vv,
      durationSec: stretchDurationSec,
      patternBeats: resolvedPatternBeats,
      bpm: Number(state.bpm || 120),
    });
    return;
  }

  // Default route for non-sample instruments
  audioTriggerNote({
    trigger: () => inst.trigger(t, n.midi, vv, dur),
    trackId: String((ch && ch.id) || "track"),
    instId: String(inst?.instId || `inst-${String(ch?.id || "track")}`),
    instType: String(inst?.type || presetName || "piano"),
    params: (effectiveParams || ch?.params || {}),
    mixCh: Number(ch?.mixOut || 1),
    note: n.midi,
    velocity: vv,
    durationSec: dur,
  });
}

function secPerStep() { return (60 / state.bpm) / 4; }

function resolveSamplePatternParams(pattern, channel){
  const chParams = (channel && typeof channel.params === "object" && channel.params) ? channel.params : null;
  if (chParams && chParams.samplePath) return chParams;
  const patCfg = (pattern && typeof pattern.samplePatternConfig === "object" && pattern.samplePatternConfig) ? pattern.samplePatternConfig : null;
  if (patCfg && patCfg.samplePath) {
    channel.params = Object.assign({}, patCfg, chParams || {});
    return channel.params;
  }
  return chParams;
}

function playlistEndBar() {
  let end = 1;
  for (const tr of project.playlist.tracks) {
    for (const c of tr.clips) {
      end = Math.max(end, c.startBar + c.lenBars);
    }
  }
  return Math.max(1, end);
}

function scheduleStep_PATTERN(step, t) {
  const p = activePattern(); if (!p) return;
  const patBars = patternLengthBars(p);
  const patSteps = Math.max(1, Math.round(patBars * state.stepsPerBar));
  const local = step % patSteps;

  for (const ch of p.channels) {
    if (ch.muted) continue;
    const channelPreset = String(ch.preset || "");
    const presetName = (channelPreset === "Sample Paterne") ? channelPreset : (presetOverride.value || channelPreset);
    const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut || 1) : ae.master);
    const effectiveParams = resolveSamplePatternParams(p, ch);
    const inst = presets.get(presetName, effectiveParams || ch.params, outBus);

    for (const n of ch.notes) {
      if (n.step === local) {
        const vv = (n.vel || 100) / 127;
const dur = Math.max(1, n.len) * secPerStep();

// Apply per-note automation (non-destructive): temporarily override ch.params for this trigger.
const np = n.autoParams || null;
if (np && typeof ch.params === "object" && ch.params) {
  const prev = {};
  for (const k in np) {
    prev[k] = ch.params[k];
    ch.params[k] = np[k];
  }
  scheduleInstrumentTrigger({ presetName, inst, t, n, vv, dur, ch, effectiveParams, patternBeats: patBars * 4 });
  for (const k in np) {
    if (prev[k] === undefined) delete ch.params[k];
    else ch.params[k] = prev[k];
  }
} else {
  scheduleInstrumentTrigger({ presetName, inst, t, n, vv, dur, ch, effectiveParams, patternBeats: patBars * 4 });
}}
    }
  }
}

function scheduleStep_SONG(step, t) {
  const stepInSong = step;

  for (const tr of project.playlist.tracks) {
    for (const clip of tr.clips) {
      const pat = project.patterns.find(p => p.id === clip.patternId);
      if (!pat) continue;

      const clipStartStep = clip.startBar * state.stepsPerBar;
      const clipEndStep = (clip.startBar + clip.lenBars) * state.stepsPerBar;
      if (stepInSong < clipStartStep || stepInSong >= clipEndStep) continue;

      const patBars = patternLengthBars(pat);
      const patSteps = Math.max(1, Math.round(patBars * state.stepsPerBar));
      const local = (stepInSong - clipStartStep) % patSteps;


      // Skip non-notes patterns (e.g., LFO patterns have no channels)
      if (!Array.isArray(pat.channels)) continue;

      for (const ch of pat.channels) {
        if (ch.muted) continue;
        const channelPreset = String(ch.preset || "");
        const presetName = (channelPreset === "Sample Paterne") ? channelPreset : (presetOverride.value || channelPreset);
        const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut || 1) : ae.master);
        const effectiveParams = resolveSamplePatternParams(pat, ch);
        const inst = presets.get(presetName, effectiveParams || ch.params, outBus);

        for (const n of ch.notes) {
          if (n.step === local) {
            const vv = (n.vel || 100) / 127;
const dur = Math.max(1, n.len) * secPerStep();

// Apply per-note automation (non-destructive): temporarily override ch.params for this trigger.
const np = n.autoParams || null;
if (np && typeof ch.params === "object" && ch.params) {
  const prev = {};
  for (const k in np) {
    prev[k] = ch.params[k];
    ch.params[k] = np[k];
  }
  scheduleInstrumentTrigger({ presetName, inst, t, n, vv, dur, ch, effectiveParams, patternBeats: patBars * 4 });
  for (const k in np) {
    if (prev[k] === undefined) delete ch.params[k];
    else ch.params[k] = prev[k];
  }
} else {
  scheduleInstrumentTrigger({ presetName, inst, t, n, vv, dur, ch, effectiveParams, patternBeats: patBars * 4 });
}// Glow (safe)
            try {
              if (project.activePatternId === pat.id) {
                const ap = activePattern();
                if (ap && ap.activeChannelId === ch.id) _scheduleGlow(n.id, t);
              }
            } catch (_) {}
          }
        }
      }
    }
  }
}

/**
 * Tick robuste:
 * - calcule le temps depuis pb.startT + step*sp (pas d'accumulation => pas de drift)
 * - saute les steps ratés si UI freeze (safetyLead)
 */
function tick() {

  // Keep endStep consistent with current mode (prevents mixed state if UI switches modes)
  try{
    const want = _recalcEndStepForMode();
    if(want && want !== pb.endStep){
      pb.endStep = want;
      // clamp nextStep so we don't overshoot immediately in non-loop
      if(!state.loop && pb.nextStep > pb.endStep) pb.nextStep = pb.endStep;
    }
  }catch(_){}

  if (!state.playing) return;

  const ctx = ae.ctx;
  const now = ctx.currentTime;
  const sp = secPerStep();

  const safetyLead = 0.06;         // 60ms anti-stall UI
  const minT = now + safetyLead;

  // Jump nextStep to first step scheduled >= minT
  const wantedStep = Math.ceil((minT - pb.startT) / sp);
  if (wantedStep > pb.nextStep) pb.nextStep = wantedStep;

  // Schedule ahead
  while (true) {
    const t = pb.startT + pb.nextStep * sp;
    if (t >= now + pb.lookahead) break;

    // Apply pending loop-length changes at boundary
    if (
      pb.pendingEndStep &&
      state.loop &&
      pb.endStep > 0 &&
      (pb.nextStep % pb.endStep === 0)
    ) {
      pb.endStep = pb.pendingEndStep;
      pb.pendingEndStep = 0;
    }

    const rangeLen = Math.max(1, pb.rangeEndStep - pb.rangeStartStep);
    const stepForSeq = (state.loop && pb.endStep > 0)
      ? (pb.rangeStartStep + (pb.nextStep % rangeLen))
      : (pb.rangeStartStep + pb.nextStep);

    if (state.mode === "pattern") scheduleStep_PATTERN(stepForSeq, t);
    else scheduleStep_SONG(stepForSeq, t);

    pb.nextStep++;

    if (!state.loop && pb.nextStep >= pb.endStep) break;
  }

  // UI readhead
  const elapsed = Math.max(0, now - pb.startT);
  const absStep = Math.floor(elapsed / sp);
  const rangeLen = Math.max(1, pb.rangeEndStep - pb.rangeStartStep);
  const relUiStep = (state.loop && pb.endStep > 0) ? (absStep % pb.endStep) : absStep;
  const uiStep = pb.rangeStartStep + relUiStep;

  pb.uiAbsStep = absStep;
  pb.uiSongStep = uiStep;

  __lfoVisualRT.fxByKey.clear();

  // LFO preset overrides must be aligned to playhead (NOT scheduling lookahead)
  try{ __applyLfoPresetFxOverrides(pb.uiSongStep); }catch(_){ }
  // LFO curve overrides (mixer/FX) aligned to playhead
  try{ __applyLfoCurveOverrides(pb.uiSongStep); }catch(_){ }
  __lfoVisualPublish();


  try {
    const p = activePattern();
    const bars = p ? patternLengthBars(p) : 1;
    const patSteps = Math.max(1, bars * state.stepsPerBar);
    pb.uiRollStep = (pb.rangeStartStep + absStep) % patSteps;
  } catch (_) {
    pb.uiRollStep = uiStep;
  }

  pb.uiStep = uiStep;
}

function _autoScrollFollow() {
  if (!state.playing || state.autoScroll === false) return;

  // Piano Roll follow
  try {
    const stepW = cssNum("--roll-step-w");
    const x = (pb.uiRollStep != null ? pb.uiRollStep : pb.uiStep) * stepW;
    const vw = gridScroll.clientWidth;
    const marginL = vw * 0.30, marginR = vw * 0.70;
    const left = gridScroll.scrollLeft;
    if (x < left + marginL || x > left + marginR) {
      gridScroll.scrollLeft = Math.max(0, x - marginL);
      syncRollScroll();
    }
  } catch (_) {}

  // Playlist follow
  try {
    const stepW2 = cssNum("--plist-step-w");
    const trackCol2 = cssNum("--track-col");
    const x2 = trackCol2 + (pb.uiSongStep != null ? pb.uiSongStep : pb.uiStep) * stepW2;
    const vw2 = tracks.clientWidth;
    const marginL2 = vw2 * 0.30, marginR2 = vw2 * 0.70;
    const left2 = tracks.scrollLeft;
    if (x2 < left2 + marginL2 || x2 > left2 + marginR2) {
      tracks.scrollLeft = Math.max(0, x2 - marginL2);
      plistTime.style.transform = `translateX(-${tracks.scrollLeft}px)`;
    }
  } catch (_) {}
}

let _uiRAF = 0;
function _uiLoop() {
  if (state.playing) {
    try {
      const xRoll = (pb.uiRollStep != null ? pb.uiRollStep : pb.uiStep) * cssNum("--roll-step-w");
      playhead.style.left = `${xRoll}px`;

      const trackCol = cssNum("--track-col");
      const xPl = trackCol + (pb.uiSongStep != null ? pb.uiSongStep : pb.uiStep) * cssNum("--plist-step-w");
      if (typeof plistPlayhead !== "undefined" && plistPlayhead) {
        plistPlayhead.style.left = `${xPl}px`;
        plistPlayhead.style.height = `${tracks.scrollHeight}px`;
      }

      _autoScrollFollow();
    } catch (_) {}
  }
  _uiRAF = requestAnimationFrame(_uiLoop);
}

async function start() {
  await ae.ensure();
  if (window.audioBackend) {
    await window.audioBackend.setBpm(state.bpm);
  }

  // CRITICAL: avoid double scheduler
  if (pb.timer) { clearInterval(pb.timer); pb.timer = null; }

  state.playing = true;
  playBtn.textContent = "⏸ Pause";

  pb.startT = ae.ctx.currentTime + 0.06;   // match safetyLead
  pb.nextStep = 0;

  const selected = _selectedRangeSteps();
  pb.forceSongFromSelection = !!selected;
  if(selected){
    pb.rangeStartStep = Math.max(0, Math.floor(selected.startStep||0));
    pb.rangeEndStep = Math.max(pb.rangeStartStep+1, Math.floor(selected.endStep||0));
    try{ if(state.mode !== "song") setMode("song"); }catch(_){ state.mode = "song"; }
  }else{
    // Smart play: no selection => full song playback
    try{ if(state.mode !== "song") setMode("song"); }catch(_){ state.mode = "song"; }
    pb.rangeStartStep = 0;
    pb.rangeEndStep = playlistEndBar() * state.stepsPerBar;
  }

  if (state.mode === "pattern") {
    const p = activePattern();
    const bars = p ? patternLengthBars(p) : 1;
    pb.rangeStartStep = 0;
    pb.rangeEndStep = bars * state.stepsPerBar;
    pb.endStep = pb.rangeEndStep - pb.rangeStartStep;
  } else {
    pb.endStep = Math.max(1, pb.rangeEndStep - pb.rangeStartStep);
  }

  pb.pendingEndStep = 0;

  pb.timer = setInterval(tick, pb.intervalMs);

  if (window.audioBackend) {
    await window.audioBackend.play(buildProjectSnapshotForEngine);
  }

  if (!_uiRAF) _uiRAF = requestAnimationFrame(_uiLoop);
}

async function pause() {
  state.playing = false;
  playBtn.textContent = "▶ Play";
  clearInterval(pb.timer); pb.timer = null;
  if (window.audioBackend) await window.audioBackend.stop();
  try{ __lfoVisualRT.fxByKey.clear(); __lfoVisualPublish(); }catch(_){ }
}

async function stop() {
  await pause();
  try { playhead.style.left = "0px"; } catch (_) {}
  try { if (plistPlayhead) plistPlayhead.style.left = "0px"; } catch (_) {}
}

// Make sure wiring.js can call these even if scripts are modules
window.pb = pb;
window.start = start;
window.pause = pause;
window.stop = stop;
window.tick = tick;
