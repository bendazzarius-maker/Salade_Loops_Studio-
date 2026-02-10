/* ================= Electro DAW | fx_flanger.js ================= */
/* Flanger FX (short modulated delay + feedback) */

function fxFlanger(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0.35;

  const delay = ctx.createDelay(0.02);
  delay.delayTime.value = 0.004;

  const fb = ctx.createGain();
  fb.gain.value = 0.25;

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.25;
  lfoGain.gain.value = 0.002; // depth

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
      if(p.rate!=null) lfo.frequency.value = clamp(+p.rate, 0.05, 10);
      if(p.depth!=null) lfoGain.gain.value = clamp(+p.depth, 0, 0.008);
      if(p.base!=null) delay.delayTime.value = clamp(+p.base, 0.0005, 0.01);
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
