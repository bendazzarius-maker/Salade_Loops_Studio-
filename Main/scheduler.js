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
  uiRollStep: 0
};
// ---------------- LFO preset runtime override (non-destructive) ----------------
const __lfoRT = {
  // key -> { enabled, params } original snapshot to restore when LFO not active
  orig: new Map(),
  // key -> last applied signature to avoid redundant applyMixerModel
  lastSig: new Map(),
};

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

function __applyLfoPresetFxOverrides(songStep){
  // Apply overrides aligned to playhead (no lookahead)
  if(!state.playing) return;
  if(state.mode !== "song") return;
  if(!project || !project.playlist || !Array.isArray(project.playlist.tracks)) return;

  const activeKeys = new Set();

  const stepInSong = songStep; // ensure defined (fixes ReferenceError)
  const spb = state.stepsPerBar;

  for(const tr of project.playlist.tracks){
    const ttype = (tr.type||"").toString().toLowerCase();
    if(ttype !== "lfo") continue;

    for(const clip of (tr.clips||[])){
      const pat = project.patterns.find(p => p.id === clip.patternId);
      if(!pat) continue;
      const ptype = (pat.type||pat.kind||"").toString().toLowerCase();
      if(ptype !== "lfo_preset") continue;

      const clipStartStep = (clip.startBar||0) * spb;
      const clipEndStep   = ((clip.startBar||0) + (clip.lenBars||0)) * spb;
      if(stepInSong < clipStartStep || stepInSong >= clipEndStep) continue;

      // Determine target in mixer
      const bind = pat.preset || {};
      const scope = (bind.scope||"channel").toString().toLowerCase();
      let chIndex1 = 1;

      if(scope === "master"){
        chIndex1 = 1;
      }else{
        // prefer explicit bind.channelId (numeric mixer channel index1)
        const explicit = Number(bind.channelId);
        if(Number.isFinite(explicit) && explicit > 0) chIndex1 = Math.floor(explicit);
        else{
          // fallback: current active instrument channel mixOut
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

      // snapshot original once
      if(!__lfoRT.orig.has(key)){
        __lfoRT.orig.set(key, {
          enabled: fx.enabled,
          params: fx.params ? { ...fx.params } : {}
        });
      }

      // build override state
      const enabled = (bind.enabled != null) ? !!bind.enabled : (pat.preset?.enabled != null ? !!pat.preset.enabled : true);
      const params = (bind.params && typeof bind.params==="object") ? bind.params : (pat.preset?.params || {});

      // signature to avoid redundant apply
      const sig = JSON.stringify({enabled, params});
      if(__lfoRT.lastSig.get(key) !== sig){
        fx.enabled = enabled;
        fx.params = { ...(fx.params||{}), ...(params||{}) };
        __lfoRT.lastSig.set(key, sig);

        // push to audio engine (only when changes)
        try{ if(ae && ae.applyMixerModel) ae.applyMixerModel(project.mixer); }catch(_){}
      }

      activeKeys.add(key);
    }
  }

  __lfoRestoreMissing(activeKeys);
}
function _recalcEndStepForMode(){
  try{
    if(state.mode === "pattern"){
      const p = activePattern();
      const bars = p ? patternLengthBars(p) : 1;
      return Math.max(1, bars * state.stepsPerBar);
    }
    return Math.max(1, playlistEndBar() * state.stepsPerBar);
  }catch(_){
    return pb.endStep || 0;
  }
}


function secPerStep() { return (60 / state.bpm) / 4; }

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
  const patSteps = patBars * state.stepsPerBar;
  const local = step % patSteps;

  if (!p || !Array.isArray(p.channels)) return; // skip LFO/invalid patterns

  for (const ch of p.channels) {
    if (ch.muted) continue;
    const presetName = presetOverride.value || ch.preset;
    const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut || 1) : ae.master);
    const inst = presets.get(presetName, ch.params, outBus);

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
  inst.trigger(t, n.midi, vv, dur);
  for (const k in np) {
    if (prev[k] === undefined) delete ch.params[k];
    else ch.params[k] = prev[k];
  }
} else {
  inst.trigger(t, n.midi, vv, dur);
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

      const local = stepInSong - clipStartStep; // play once


      // Skip non-notes patterns (e.g., LFO patterns have no channels)
      if (!Array.isArray(pat.channels)) continue;

      for (const ch of pat.channels) {
        if (ch.muted) continue;
        const presetName = presetOverride.value || ch.preset;
        const outBus = (ae.getMixerInput ? ae.getMixerInput(ch.mixOut || 1) : ae.master);
        const inst = presets.get(presetName, ch.params, outBus);

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
  inst.trigger(t, n.midi, vv, dur);
  for (const k in np) {
    if (prev[k] === undefined) delete ch.params[k];
    else ch.params[k] = prev[k];
  }
} else {
  inst.trigger(t, n.midi, vv, dur);
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

    const stepForSeq = (state.loop && pb.endStep > 0)
      ? (pb.nextStep % pb.endStep)
      : pb.nextStep;

    if (state.mode === "pattern") scheduleStep_PATTERN(stepForSeq, t);
    else scheduleStep_SONG(stepForSeq, t);

    pb.nextStep++;

    if (!state.loop && pb.nextStep >= pb.endStep) break;
  }

  // UI readhead
  const elapsed = Math.max(0, now - pb.startT);
  const absStep = Math.floor(elapsed / sp);
  const uiStep = (state.loop && pb.endStep > 0) ? (absStep % pb.endStep) : absStep;

  pb.uiAbsStep = absStep;
  pb.uiSongStep = uiStep;

  // LFO preset overrides must be aligned to playhead (NOT scheduling lookahead)
  try{ __applyLfoPresetFxOverrides(pb.uiSongStep); }catch(_){ }


  try {
    const p = activePattern();
    const bars = p ? patternLengthBars(p) : 1;
    const patSteps = Math.max(1, bars * state.stepsPerBar);
    pb.uiRollStep = absStep % patSteps;
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

  // CRITICAL: avoid double scheduler
  if (pb.timer) { clearInterval(pb.timer); pb.timer = null; }

  state.playing = true;
  playBtn.textContent = "⏸ Pause";

  pb.startT = ae.ctx.currentTime + 0.06;   // match safetyLead
  pb.nextStep = 0;

  if (state.mode === "pattern") {
    const p = activePattern();
    const bars = p ? patternLengthBars(p) : 1;
    pb.endStep = bars * state.stepsPerBar;
  } else {
    pb.endStep = playlistEndBar() * state.stepsPerBar;
  }

  pb.pendingEndStep = 0;

  pb.timer = setInterval(tick, pb.intervalMs);

  if (!_uiRAF) _uiRAF = requestAnimationFrame(_uiLoop);
}

function pause() {
  state.playing = false;
  playBtn.textContent = "▶ Play";
  clearInterval(pb.timer); pb.timer = null;
}

function stop() {
  pause();
  try { playhead.style.left = "0px"; } catch (_) {}
  try { if (plistPlayhead) plistPlayhead.style.left = "0px"; } catch (_) {}
}

// Make sure wiring.js can call these even if scripts are modules
window.pb = pb;
window.start = start;
window.pause = pause;
window.stop = stop;
window.tick = tick;
