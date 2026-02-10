/* ================= Electro DAW | fx_chorus.js ================= */
/* Chorus FX (delay mod + wet/dry) */

function fxChorus(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0.35;

  const delay = ctx.createDelay(0.05);
  const fb = ctx.createGain();
  fb.gain.value = 0.12;

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();

  // defaults
  delay.delayTime.value = 0.018;
  lfo.frequency.value = 0.22;
  lfoGain.gain.value = 0.006; // depth seconds

  // wiring
  input.connect(dry);
  input.connect(delay);

  delay.connect(wet);
  delay.connect(fb);
  fb.connect(delay);

  dry.connect(output);
  wet.connect(output);

  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  return {
    input, output,
    setParams(p){
      if(!p) return;
      if(p.wet!=null){ wet.gain.value = clamp(+p.wet, 0, 1); dry.gain.value = 1 - wet.gain.value; }
      if(p.rate!=null) lfo.frequency.value = clamp(+p.rate, 0.05, 8);
      if(p.depth!=null) lfoGain.gain.value = clamp(+p.depth, 0, 0.02);
      if(p.base!=null) delay.delayTime.value = clamp(+p.base, 0.003, 0.04);
      if(p.feedback!=null) fb.gain.value = clamp(+p.feedback, 0, 0.95);
    },
    dispose(){
      try{ lfo.stop(); }catch(_){}
      try{ input.disconnect(); }catch(_){}
      try{ delay.disconnect(); }catch(_){}
      try{ fb.disconnect(); }catch(_){}
      try{ dry.disconnect(); }catch(_){}
      try{ wet.disconnect(); }catch(_){}
      try{ output.disconnect(); }catch(_){}
    }
  };
}
