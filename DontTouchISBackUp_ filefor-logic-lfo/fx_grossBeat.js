/* ================= Electro DAW | fx_grossBeat.js =================
   GrossBeat DJ-Fader (volume gate) — anti-click version
*/

function fxGrossBeat(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();

  const wet = ctx.createGain();
  const dry = ctx.createGain();
  wet.gain.value = 1;
  dry.gain.value = 0;

  // --- DC blocker (IMPORTANT for clicks) ---
  // If your signal has DC offset, gating clicks even with ramps.
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = "highpass";
  dcBlock.frequency.value = 25;   // 20–35 Hz
  dcBlock.Q.value = 0.707;

  // "DJ fader"
  const fader = ctx.createGain();
  fader.gain.value = 1;

  // wiring
  input.connect(dry);
  input.connect(dcBlock);
  dcBlock.connect(fader);
  fader.connect(wet);

  dry.connect(output);
  wet.connect(output);

  // --- params ---
  let division = 64;
  let pattern = new Array(64).fill(1);  // 1=open, 0=closed

  let smooth = 0.03;        // 30ms (increase if needed: 0.04–0.06)
  let depth  = 1.0;         // 1 full gate
  let epsilon = 0.01;       // -40 dB ~ avoids hard “0” (was too low)
  let curvePow = 1.7;

  const intervalMs = 20;
  const lookahead  = 1.2;
  const safetyLead = 0.08;

  let timer = null;
  let nextK = null;         // next scheduled step index (absolute)
  let lastTarget = 1;

  function bpm(){
    return (typeof state !== "undefined" && state.bpm) ? state.bpm : 120;
  }
  function barSec(){
    return (60 / Math.max(1, bpm())) * 4;
  }
  function stepSec(){
    return barSec() / division;
  }
  function transportStart(){
    // lock to scheduler start if available
    if (typeof pb !== "undefined" && pb.startT != null) return pb.startT;
    return ctx.currentTime;
  }

  function gainFromGate01(g01){
    const shaped = Math.pow(Math.max(0, Math.min(1, g01)), curvePow);
    const g = (1 - depth) + depth * shaped;
    return Math.max(epsilon, g);
  }

  function scheduleOneStep(k){
    const startT = transportStart();
    const sp = stepSec();
    const t0 = startT + k * sp;

    const idx = ((k % division) + division) % division;
    const gate01 = pattern[idx] ? 1 : 0;
    const target = gainFromGate01(gate01);

    // Use setTargetAtTime for smooth, click-free transitions
    // timeConstant ~ smooth/3 gives a nice “fader” feel
    const tc = Math.max(0.003, smooth / 3);

    try{
      // IMPORTANT: no cancelScheduledValues spam here
      // Just set a new target at the boundary
      fader.gain.setTargetAtTime(target, t0, tc);
    }catch(_){
      fader.gain.value = target;
    }

    lastTarget = target;
  }

  function schedule(){
    const now = ctx.currentTime;
    const startT = transportStart();
    const sp = stepSec();

    const minT = now + safetyLead;
    const endT = now + lookahead;

    // initialize nextK so that its boundary time is >= minT
    if (nextK == null){
      nextK = Math.ceil((minT - startT) / sp);
    }

    // schedule forward only (never reschedule old steps)
    while (startT + nextK * sp < endT){
      scheduleOneStep(nextK);
      nextK++;
    }
  }

  function normalizePattern(arr){
    const src = arr.map(v => !!v);
    const out = new Array(division).fill(false);
    for (let i=0;i<division;i++) out[i] = src[i % src.length];
    return out;
  }

  function restartScheduler(){
    // reset scheduling cursor to avoid overlaps after param changes
    nextK = null;
    schedule();
  }

  function start(){
    if (timer) return;
    schedule();
    timer = setInterval(schedule, intervalMs);
  }
  start();

  return {
    input, output,

    setParams(p){
      if(!p) return;
      const now = ctx.currentTime;

      if(p.wet != null){
        const w = Math.max(0, Math.min(1, +p.wet));
        try{
          wet.gain.setTargetAtTime(w, now, 0.01);
          dry.gain.setTargetAtTime(1 - w, now, 0.01);
        }catch(_){
          wet.gain.value = w;
          dry.gain.value = 1 - w;
        }
      }

      if(p.smooth != null) smooth = Math.max(0.005, Math.min(0.08, +p.smooth));
      if(p.depth  != null) depth  = Math.max(0.0, Math.min(1.0, +p.depth));
      if(p.curve  != null) curvePow = Math.max(0.6, Math.min(4.0, +p.curve));
      if(p.epsilon != null) epsilon = Math.max(0.001, Math.min(0.05, +p.epsilon));

      let changedGrid = false;

      if(p.division != null){
        const s = String(p.division).trim();
        const m = s.match(/1\s*:\s*(\d+)/);
        const d = m ? parseInt(m[1],10) : parseInt(s,10);
        division = [2,3,4,6,8,16,32,64].includes(d) ? d : 64;
        pattern = normalizePattern(pattern);
        changedGrid = true;
      }

      if(p.pattern != null && Array.isArray(p.pattern) && p.pattern.length){
        pattern = normalizePattern(p.pattern);
        changedGrid = true;
      }

      // If timing grid/pattern changed, restart scheduling cursor
      if(changedGrid) restartScheduler();
    },

    dispose(){
      try{ if(timer) clearInterval(timer); }catch(_){}
      timer = null;
      nextK = null;
      try{ input.disconnect(); }catch(_){}
      try{ dcBlock.disconnect(); }catch(_){}
      try{ fader.disconnect(); }catch(_){}
      try{ wet.disconnect(); }catch(_){}
      try{ dry.disconnect(); }catch(_){}
      try{ output.disconnect(); }catch(_){}
    }
  };
}
