/* ================= Electro DAW | fx_compressor.js ================= */
/* Compressor FX (wet/dry parallel) */

function fxCompressor(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0;

  const comp = ctx.createDynamicsCompressor();
  // defaults
  comp.threshold.value = -22;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;

  const makeup = ctx.createGain();
  makeup.gain.value = 1.0;

  // wiring
  input.connect(dry);
  input.connect(comp);
  comp.connect(makeup);
  makeup.connect(wet);

  dry.connect(output);
  wet.connect(output);

  const api = {
    input, output,
    setParams(p){
      if(!p) return;
      if(p.wet!=null){ wet.gain.value = clamp(+p.wet, 0, 1); dry.gain.value = 1 - wet.gain.value; }
      if(p.threshold!=null) comp.threshold.value = clamp(+p.threshold, -80, 0);
      if(p.ratio!=null) comp.ratio.value = clamp(+p.ratio, 1, 20);
      if(p.attack!=null) comp.attack.value = clamp(+p.attack, 0.0005, 0.5);
      if(p.release!=null) comp.release.value = clamp(+p.release, 0.01, 2.5);
      if(p.knee!=null) comp.knee.value = clamp(+p.knee, 0, 40);
      if(p.makeup!=null) makeup.gain.value = clamp(+p.makeup, 0, 4);
    },
    dispose(){
      try{ input.disconnect(); }catch(_){}
      try{ dry.disconnect(); }catch(_){}
      try{ wet.disconnect(); }catch(_){}
      try{ comp.disconnect(); }catch(_){}
      try{ makeup.disconnect(); }catch(_){}
      try{ output.disconnect(); }catch(_){}
    }
  };
  return api;
}
