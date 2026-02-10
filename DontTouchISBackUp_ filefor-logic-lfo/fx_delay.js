/* ================= Electro DAW | fx_delay.js ================= */
/* Tempo synced delay */

function _parseDivision(div){
  // expects "1:16" "1:8" "1:6" "1:4" "1:3" "1:2"
  const s = String(div||"").trim();
  const m = s.match(/1\s*:\s*(\d+)/);
  const denom = m ? parseInt(m[1],10) : 8;
  return [2,3,4,6,8,16].includes(denom) ? denom : 8;
}

function _delayTimeFromDivision(bpm, denom){
  const beat = 60 / Math.max(1, bpm||120);     // quarter note
  const whole = beat * 4;                      // whole note duration
  return whole / denom;                        // 1/denom note
}

function fxDelay(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0.3;

  const delay = ctx.createDelay(2.0);
  const fb = ctx.createGain();
  fb.gain.value = 0.35;

  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 12000;

  // routing
  input.connect(dry);
  input.connect(delay);
  delay.connect(damp);
  damp.connect(fb);
  fb.connect(delay);

  damp.connect(wet);

  dry.connect(output);
  wet.connect(output);

  let lastDenom = 8;

  function _applyTiming(p){
    const bpm = (typeof state!=="undefined" && state.bpm) ? state.bpm : 120;
    const denom = _parseDivision(p.division || p.rate || "1:8");
    lastDenom = denom;
    const dt = _delayTimeFromDivision(bpm, denom);
    delay.delayTime.setValueAtTime(dt, ctx.currentTime);
  }

  return {
    input, output,
    setParams(p){
      if(!p) return;
      if(p.wet!=null){ wet.gain.value = clamp(+p.wet, 0, 1); dry.gain.value = 1 - wet.gain.value; }

      // tempo division
      if(p.division!=null || p.rate!=null) _applyTiming(p);

      // If user gives time explicitly (seconds), prefer it
      if(p.time!=null && isFinite(+p.time)){
        delay.delayTime.setValueAtTime(clamp(+p.time, 0.01, 2.0), ctx.currentTime);
      }

      // feedback / repeats
      if(p.repeats!=null && isFinite(+p.repeats) && +p.repeats>0 && p.feedback==null){
        // make repeats decay to ~10% by N repeats
        const end = (p.endGain!=null) ? clamp(+p.endGain, 0.01, 0.9) : 0.1;
        fb.gain.value = clamp(Math.pow(end, 1/Math.max(1,+p.repeats)), 0, 0.95);
      }
      if(p.feedback!=null) fb.gain.value = clamp(+p.feedback, 0, 0.95);

      if(p.damp!=null) damp.frequency.value = clamp(+p.damp, 500, 20000);
    },
    // allow scheduler to refresh timing when bpm changes
    tick(){
      // lightweight: keep in sync if using division
      // nothing unless division field exists in model; mixer.js keeps it
    },
    dispose(){
      try{ input.disconnect(); }catch(_){}
      try{ delay.disconnect(); }catch(_){}
      try{ fb.disconnect(); }catch(_){}
      try{ damp.disconnect(); }catch(_){}
      try{ dry.disconnect(); }catch(_){}
      try{ wet.disconnect(); }catch(_){}
      try{ output.disconnect(); }catch(_){}
    }
  };
}
