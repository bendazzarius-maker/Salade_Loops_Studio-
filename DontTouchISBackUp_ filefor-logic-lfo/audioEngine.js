/* ================= Electro DAW | audioEngine.js ================= */
class AudioEngine{
  constructor(){
    this.ctx=null;

    // Mixer core
    this.mixer=null;        // { master:{...}, channels:[...] }
    this.masterIn=null;     // master input (sum of channels)
    this.master=null;       // master post chain (to comp)
    this.comp=null;
  }

  async ensure(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext||window.webkitAudioContext)({latencyHint:"playback"});

      // Soft limiter / comp to avoid clipping

      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.knee.value = 18;
      this.comp.ratio.value = 3;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.18;

      // Build mixer (default 16 channels)
      try{
        this.initMixer(16);

        // Master -> comp -> speakers
        this.master.connect(this.comp);
        this.comp.connect(this.ctx.destination);

        // Apply model values (if a project mixer exists)
        if(typeof project!=="undefined" && project.mixer){
          this.applyMixerModel(project.mixer);
        }
      }catch(err){
        console.error("[AudioEngine] initMixer failed, falling back to simple chain:", err);
        // Fallback: masterIn -> master -> comp -> speakers
        this.masterIn = this.ctx.createGain();
        this.masterIn.gain.value = 1;

        this.master = this.ctx.createGain();
        this.master.gain.value = 0.85;

        this.masterIn.connect(this.master);
        this.master.connect(this.comp);
        this.comp.connect(this.ctx.destination);

        this.mixer = null;
      }

      // Apply model values (if a project mixer exists)
      if(typeof project!=="undefined" && project.mixer){
        this.applyMixerModel(project.mixer);
      }
    }
    if(this.ctx.state==="suspended") await this.ctx.resume();
  }

  /* ---------------- Mixer API ---------------- */

  initMixer(num=16){
    const ctx=this.ctx;

    // Master sum bus
    this.masterIn = ctx.createGain();
    this.masterIn.gain.value = 1;

    // Master strip chain
    const m = this._createStripNodes(ctx, true);
    // masterIn -> EQ -> pan -> gain -> fx -> masterOut
    this.masterIn.connect(m.eqLow);
    m.out.gain.value = 0.85;

    this.master = m.out;

    this.mixer = {
      master: {
        nodes: m,
        fx: [] // {type, enabled, node}
      },
      channels: []
    };

    // Create channels
    for(let i=0;i<num;i++){
      this._addMixerChannelInternal();
    }

    // init crossfader computation
    this.updateCrossfader(0.5);
  }

  addMixerChannel(){
    if(!this.mixer) return 0;
    this._addMixerChannelInternal();
    return this.mixer.channels.length; // 1-based index
  }

  _addMixerChannelInternal(){
    const ctx=this.ctx;
    const strip = this._createStripNodes(ctx, false);

    // channel out -> crossfader gain -> masterIn
    strip.xfade.connect(this.masterIn);

    const ch = {
      input: strip.input,
      nodes: strip,
      fx: [],
      xAssign: "A",
    };
    this.mixer.channels.push(ch);
  }

  getMixerInput(index1){
    if(!this.mixer) return this.masterIn;
    const idx = Math.max(1, Math.floor(index1||1)) - 1;
    const ch = this.mixer.channels[idx];
    return ch ? ch.input : this.masterIn;
  }

  _smooth(param, value, tc=0.02){
    try{
      const t=this.ctx.currentTime;
      param.cancelScheduledValues(t);
      // keep continuity
      const cur = (typeof param.value==="number") ? param.value : value;
      param.setValueAtTime(cur, t);
      param.setTargetAtTime(value, t, tc);
    }catch(_){ try{ param.value=value; }catch(__){} }
  }

  applyMixerModel(model){
    if(!this.mixer || !model) return;

    // Ensure size
    const want = Math.max(1, (model.channels||[]).length || 16);
    while(this.mixer.channels.length < want){
      this._addMixerChannelInternal();
    }

    // Master params
    const M = model.master || {};
    this.setMasterParams(M);

    // Channel params
    for(let i=0;i<want;i++){
      const C = (model.channels||[])[i] || {};
      this.setChannelParams(i+1, C);
    }

    this.updateCrossfader(M.cross==null?0.5:M.cross);
  }

  setMasterParams(p){
    if(!this.mixer) return;
    const n = this.mixer.master.nodes;
    if(p.gain!=null) this._smooth(n.out.gain, clamp(+p.gain,0,1.5), 0.02);
    if(p.pan!=null) this._smooth(n.pan.pan, clamp(+p.pan,-1,1), 0.02);
    if(p.eqLow!=null) this._smooth(n.eqLow.gain, clamp(+p.eqLow,-24,24), 0.03);
    if(p.eqMid!=null) this._smooth(n.eqMid.gain, clamp(+p.eqMid,-24,24), 0.03);
    if(p.eqHigh!=null) this._smooth(n.eqHigh.gain, clamp(+p.eqHigh,-24,24), 0.03);

    // FX chain rebuild if needed
    if(Array.isArray(p.fx)) this._syncFxList(this.mixer.master, p.fx);
  }

  setChannelParams(index1, p){
    if(!this.mixer) return;
    const idx = Math.max(1, Math.floor(index1||1)) - 1;
    const ch = this.mixer.channels[idx];
    if(!ch) return;

    const n = ch.nodes;
    if(p.gain!=null) this._smooth(n.gain.gain, clamp(+p.gain,0,1.5), 0.02);
    if(p.pan!=null) this._smooth(n.pan.pan, clamp(+p.pan,-1,1), 0.02);
    if(p.eqLow!=null) this._smooth(n.eqLow.gain, clamp(+p.eqLow,-24,24), 0.03);
    if(p.eqMid!=null) this._smooth(n.eqMid.gain, clamp(+p.eqMid,-24,24), 0.03);
    if(p.eqHigh!=null) this._smooth(n.eqHigh.gain, clamp(+p.eqHigh,-24,24), 0.03);

    if(p.xAssign!=null) ch.xAssign = p.xAssign;

    if(Array.isArray(p.fx)) this._syncFxList(ch, p.fx);
  }

  updateCrossfader(v){
    if(!this.mixer) return;
    const x = clamp(+v, 0, 1);

    for(const ch of this.mixer.channels){
      let g = 1;
      if(ch.xAssign==="A"){
        // A fades out when x -> 1
        g = 1 - x;
      } else if(ch.xAssign==="B"){
        // B fades in when x -> 1
        g = x;
      } else { // OFF
        g = 1;
      }
      this._smooth(ch.nodes.xfade.gain, g, 0.02);
    }
  }

  /* ---------- FX ---------- */

  createFx(type){
    const ctx=this.ctx;
    const t = String(type||"").toLowerCase();
    if(t==="compresseur" || t==="compressor"){
      return fxCompressor(ctx);
    }
    if(t==="chorus"){
      return fxChorus(ctx);
    }
    if(t==="reverb"){
      return fxReverb(ctx);
    }
    if(t==="flanger"){
      return fxFlanger(ctx);
    }
    if(t==="delay"){
      return fxDelay(ctx);
    }
    if(t==="gross beat" || t==="grossbeat" || t==="gate"){
      return fxGrossBeat(ctx);
    }
    return null;
  }

  _syncFxList(target, fxModelList){
    // target is either this.mixer.master or channel object
    // fxModelList is [{type, enabled, params}]
    const want = Array.isArray(fxModelList) ? fxModelList : [];
    const typeSig = want.map(f=>String(f.type||"")).join("|");
    const enSig   = want.map(f=>(f.enabled===false?0:1)).join("");

    // (1) types changed -> rebuild objects and chain
    const existing = target.fx || [];
    const curTypeSig = target._fxTypeSig || "";
    if(curTypeSig !== typeSig){
      for(const e of existing){
        try{ e.node?.dispose?.(); }catch(_){}
      }
      target.fx = [];
      for(const f of want){
        const node = this.createFx(f.type);
        if(!node) continue;
        target.fx.push({ type:f.type, enabled: f.enabled!==false, node });
      }
      target._fxTypeSig = typeSig;
      target._fxEnSig   = enSig;
      this._rebuildFxChain(target);
    } else {
      // (2) enabled flags changed -> rebuild chain (but keep nodes)
      if((target._fxEnSig||"") !== enSig){
        for(let i=0;i<target.fx.length;i++){
          const f = want[i]||{};
          target.fx[i].enabled = (f.enabled!==false);
        }
        target._fxEnSig = enSig;
        this._rebuildFxChain(target);
      }
    }

    // (3) params update (no rebuild!)
    for(let i=0;i<(target.fx||[]).length;i++){
      const e=target.fx[i];
      const f=want[i]||{};
      if(e.node?.setParams && f.params) e.node.setParams(f.params);
    }
  }

  _rebuildFxChain(target){
    // rebuild connections after EQ node up to before xfade/master out
    const isMaster = (target===this.mixer.master);

    const nodes = isMaster ? target.nodes : target.nodes;
    const fxList = (target.fx||[]).filter(f=>f.enabled && f.node);

    // We chain starting from eqHigh -> ... -> out (or xfade)
    // For master: eqHigh -> fx -> out
    // For channel: eqHigh -> fx -> xfade

    const startNode = nodes.eqHigh;
    const endNode   = isMaster ? nodes.out : nodes.xfade;

    // disconnect previous
    try{ startNode.disconnect(); }catch(_){}
    for(const fx of (target.fx||[])){
      // IMPORTANT: do NOT disconnect fx.node.input here — that would break the internal FX wiring.
      // Only disconnect the FX output from the external chain.
      try{ fx.node.output.disconnect(); }catch(_){}
    }

    if(fxList.length===0){
      // no fx
      startNode.connect(endNode);
      return;
    }

    // connect chain
    startNode.connect(fxList[0].node.input);
    for(let i=0;i<fxList.length-1;i++){
      fxList[i].node.output.connect(fxList[i+1].node.input);
    }
    fxList[fxList.length-1].node.output.connect(endNode);
  }

  _createStripNodes(ctx, isMaster){
    const input = ctx.createGain();
    input.gain.value = 1;

    const gain = ctx.createGain();
    gain.gain.value = 0.85;

    const pan = (ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain());
    try{ pan.pan.value = 0; }catch(_){ /* no pan */ }

    // 3-band EQ
    const eqLow = ctx.createBiquadFilter();
    eqLow.type="lowshelf";
    eqLow.frequency.value = 180;
    eqLow.gain.value = 0;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type="peaking";
    eqMid.frequency.value = 950;
    eqMid.Q.value = 0.9;
    eqMid.gain.value = 0;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type="highshelf";
    eqHigh.frequency.value = 4800;
    eqHigh.gain.value = 0;

    // Post output
    const out = ctx.createGain();
    out.gain.value = 0.85;

    // Crossfader gain (channels only)
    const xfade = ctx.createGain();
    xfade.gain.value = 1;

    // Base chain: input -> gain -> pan -> eq -> xfade/out
    input.connect(gain);
    gain.connect(pan);
    pan.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);

    if(isMaster){
      eqHigh.connect(out);
    } else {
      eqHigh.connect(xfade);
    }

    return { input, gain, pan, eqLow, eqMid, eqHigh, xfade, out };
  }
}
const ae = new AudioEngine();

/* ---------------- helpers (instruments) ---------------- */
function mtof(m){ return 440*Math.pow(2,(m-69)/12); }
function env(g, t, a, d, s, r, peak){
  // ADSR simple (a,d,r en sec, s [0..1])
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, peak), t + Math.max(0.001,a));
  g.gain.linearRampToValueAtTime(
    Math.max(0.0001, peak*s),
    t + Math.max(0.001,a) + Math.max(0.001,d)
  );

  // release sera déclenché au stop
  return (tRel)=> {
    g.gain.cancelScheduledValues(tRel);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value || 0.0001), tRel);
    g.gain.exponentialRampToValueAtTime(0.0001, tRel + Math.max(0.02,r));
  };
}

/* ---------------- FX factory (usable in mixer) ---------------- */
function _fxBase(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.gain.value = 1;
  output.gain.value = 1;
  return { input, output, dispose:()=>{} };
}

function fxCompressor(ctx){
  const b=_fxBase(ctx);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value=-22;
  comp.knee.value=18;
  comp.ratio.value=4;
  comp.attack.value=0.003;
  comp.release.value=0.2;
  b.input.connect(comp);
  comp.connect(b.output);
  b.setParams = (p={})=>{
    if(p.threshold!=null) comp.threshold.value = clamp(+p.threshold, -80, 0);
    if(p.ratio!=null) comp.ratio.value = clamp(+p.ratio, 1, 20);
    if(p.attack!=null) comp.attack.value = clamp(+p.attack, 0.001, 0.2);
    if(p.release!=null) comp.release.value = clamp(+p.release, 0.02, 1.0);
  };
  return b;
}

function fxDelay(ctx){
  const b=_fxBase(ctx);
  const delay = ctx.createDelay(2.0);
  const fb = ctx.createGain();
  const wet = ctx.createGain();
  const dry = ctx.createGain();
  delay.delayTime.value = 0.28;
  fb.gain.value = 0.28;
  wet.gain.value = 0.35;
  dry.gain.value = 0.9;

  b.input.connect(dry).connect(b.output);
  b.input.connect(delay);
  delay.connect(wet).connect(b.output);
  delay.connect(fb).connect(delay);

  b.setParams=(p={})=>{
    if(p.time!=null) delay.delayTime.value = clamp(+p.time, 0.01, 1.5);
    if(p.feedback!=null) fb.gain.value = clamp(+p.feedback, 0, 0.92);
    if(p.wet!=null) wet.gain.value = clamp(+p.wet, 0, 1);
  };
  return b;
}

function fxReverb(ctx){
  const b=_fxBase(ctx);
  const wet = ctx.createGain(); wet.gain.value=0.28;
  const dry = ctx.createGain(); dry.gain.value=0.9;
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, 1.8, 0.25);

  b.input.connect(dry).connect(b.output);
  b.input.connect(conv).connect(wet).connect(b.output);

  b.setParams=(p={})=>{
    if(p.wet!=null) wet.gain.value = clamp(+p.wet, 0, 1);
    if(p.decay!=null) conv.buffer = makeImpulse(ctx, clamp(+p.decay,0.2,8), 0.25);
  };
  return b;
}

function makeImpulse(ctx, seconds=2, decay=2){
  const rate=ctx.sampleRate;
  const len=Math.max(1, Math.floor(rate*seconds));
  const buf=ctx.createBuffer(2,len,rate);
  for(let c=0;c<2;c++){
    const ch=buf.getChannelData(c);
    for(let i=0;i<len;i++){
      const t=i/len;
      ch[i]=(Math.random()*2-1)*Math.pow(1-t, decay);
    }
  }
  return buf;
}

function fxChorus(ctx){
  const b=_fxBase(ctx);
  const ch = makeChorus(ctx); // returns {input, output, setWet}
  // wire: b.input -> chorus.input ; chorus.output -> b.output
  b.input.connect(ch.input);
  ch.output.connect(b.output);
  b.setParams=(p={})=>{
    if(p.wet!=null) ch.setWet(clamp(+p.wet,0,1));
  };
  return b;
}

function fxFlanger(ctx){
  const b=_fxBase(ctx);
  const delay = ctx.createDelay();
  delay.delayTime.value = 0.0045;

  const fb = ctx.createGain();
  fb.gain.value = 0.25;

  const wet = ctx.createGain(); wet.gain.value=0.35;
  const dry = ctx.createGain(); dry.gain.value=0.9;

  const lfo = ctx.createOscillator(); lfo.type="sine"; lfo.frequency.value=0.25;
  const lfoG = ctx.createGain(); lfoG.gain.value=0.002;
  lfo.connect(lfoG); lfoG.connect(delay.delayTime);
  lfo.start();

  b.input.connect(dry).connect(b.output);
  b.input.connect(delay);
  delay.connect(wet).connect(b.output);
  delay.connect(fb).connect(delay);

  b.setParams=(p={})=>{
    if(p.rate!=null) lfo.frequency.value = clamp(+p.rate, 0.05, 2.0);
    if(p.depth!=null) lfoG.gain.value = clamp(+p.depth, 0.0001, 0.01);
    if(p.feedback!=null) fb.gain.value = clamp(+p.feedback, 0, 0.95);
    if(p.wet!=null) wet.gain.value = clamp(+p.wet, 0, 1);
  };
  return b;
}

function fxGrossBeat(ctx){
  const b=_fxBase(ctx);
  const g = ctx.createGain();
  g.gain.value = 1;

  const wet = ctx.createGain(); wet.gain.value = 0.85;
  const dry = ctx.createGain(); dry.gain.value = 0.15;

  // Gate LFO (square)
  const lfo = ctx.createOscillator(); lfo.type="square"; lfo.frequency.value = 4; // 4Hz default
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.6;
  lfo.connect(lfoGain);
  lfoGain.connect(g.gain);
  lfo.start();

  b.input.connect(dry).connect(b.output);
  b.input.connect(g).connect(wet).connect(b.output);

  b.setParams=(p={})=>{
    if(p.rate!=null) lfo.frequency.value = clamp(+p.rate, 0.5, 24);
    if(p.depth!=null) lfoGain.gain.value = clamp(+p.depth, 0, 1);
    if(p.wet!=null){ wet.gain.value = clamp(+p.wet, 0, 1); dry.gain.value = 1-wet.gain.value; }
  };
  return b;
}

/* ---------------- Chorus helper (used by instruments & FX) ---------------- */
function makeChorus(ctx){
  const input = ctx.createGain();
  const output = ctx.createGain();

  const d1 = ctx.createDelay(); d1.delayTime.value = 0.018;
  const d2 = ctx.createDelay(); d2.delayTime.value = 0.026;

  const lfo1 = ctx.createOscillator(); lfo1.type="sine"; lfo1.frequency.value=0.23;
  const lfo2 = ctx.createOscillator(); lfo2.type="sine"; lfo2.frequency.value=0.17;

  const lfoGain1 = ctx.createGain(); lfoGain1.gain.value = 0.004;
  const lfoGain2 = ctx.createGain(); lfoGain2.gain.value = 0.005;

  lfo1.connect(lfoGain1); lfoGain1.connect(d1.delayTime);
  lfo2.connect(lfoGain2); lfoGain2.connect(d2.delayTime);

  const wet = ctx.createGain(); wet.gain.value = 0.35;
  const dry = ctx.createGain(); dry.gain.value = 0.8;

  input.connect(dry).connect(output);
  input.connect(d1).connect(wet).connect(output);
  input.connect(d2).connect(wet);

  lfo1.start(); lfo2.start();
  return { input, output, setWet:(v)=>wet.gain.value=v };
}

/* Distorsion douce (pour BASS/LEAD) */
function makeSaturation(ctx, amount=10){
  const ws = ctx.createWaveShaper();
  const n = 4096;
  const curve = new Float32Array(n);
  for(let i=0;i<n;i++){
    const x = (i/(n-1))*2 - 1;
    curve[i] = Math.tanh(x*amount);
  }
  ws.curve = curve;
  ws.oversample = "4x";
  return ws;
}

/* Backward-compat helper (older instrument code)
   drive in [0..1] -> saturation amount */
function makeWaveshaper(ctx, drive01){
  const d = (drive01==null) ? 0 : Math.max(0, Math.min(1, drive01));
  const amount = 2 + d * 22;
  return makeSaturation(ctx, amount);
}
