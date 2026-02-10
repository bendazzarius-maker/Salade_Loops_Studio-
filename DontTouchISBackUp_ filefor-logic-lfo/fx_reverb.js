/* ================= Electro DAW | fx_reverb.js ================= */
/* Reverb FX (convolver with generated impulse) */

function _makeImpulse(ctx, seconds, decay){
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);

  for(let c=0;c<2;c++){
    const data = buf.getChannelData(c);
    for(let i=0;i<len;i++){
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      data[i] = (Math.random()*2-1) * env;
    }
  }
  return buf;
}

function fxReverb(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0.28;

  const pre = ctx.createDelay(0.2);
  pre.delayTime.value = 0.01;

  const conv = ctx.createConvolver();
  let decay = 1.8;
  conv.buffer = _makeImpulse(ctx, 2.5, 3.0);

  input.connect(dry);
  input.connect(pre);

  pre.connect(conv);
  conv.connect(wet);

  dry.connect(output);
  wet.connect(output);

  return {
    input, output,
    setParams(p){
      if(!p) return;
      if(p.wet!=null){ wet.gain.value = clamp(+p.wet, 0, 1); dry.gain.value = 1 - wet.gain.value; }
      if(p.preDelay!=null) pre.delayTime.value = clamp(+p.preDelay, 0, 0.2);
      if(p.decay!=null){
        const d = clamp(+p.decay, 0.2, 12);
        // only rebuild if meaningful change
        if(Math.abs(d - decay) > 0.05){
          decay = d;
          const seconds = clamp(0.8 + d*0.9, 0.8, 12);
          conv.buffer = _makeImpulse(ctx, seconds, 3.0);
        }
      }
    },
    dispose(){
      try{ input.disconnect(); }catch(_){}
      try{ dry.disconnect(); }catch(_){}
      try{ wet.disconnect(); }catch(_){}
      try{ pre.disconnect(); }catch(_){}
      try{ conv.disconnect(); }catch(_){}
      try{ output.disconnect(); }catch(_){}
    }
  };
}
