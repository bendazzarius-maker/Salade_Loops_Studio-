/* ================= Electro DAW | inst_piano.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const PIANO_PRESETS = {
    "Grand Piano": { preset:"Grand Piano", gain:1.05, poly:16, tone:16000, attack:0.003, decay:0.10, sustain:0.55, release:0.14, fm:12, hammer:0.35, tremRate:0.0, tremDepth:0.0 },
    "Fender Rhodes": { preset:"Fender Rhodes", gain:1.00, poly:12, tone:9000, attack:0.008, decay:0.20, sustain:0.75, release:0.28, fm:5, hammer:0.10, tremRate:4.5, tremDepth:0.25 },
    "E Piano": { preset:"E Piano", gain:1.00, poly:14, tone:12000, attack:0.004, decay:0.16, sustain:0.65, release:0.22, fm:18, hammer:0.18, tremRate:6.0, tremDepth:0.12 }
  };

  function _pianoDefaults(){
    return { preset:"Grand Piano", poly:16, gain:1.0, tone:14000, attack:0.004, decay:0.14, sustain:0.6, release:0.18, fm:12, hammer:0.25, tremRate:0.0, tremDepth:0.0 };
  }

  function _applyPreset(paramsRef, name){
    const base = _pianoDefaults();
    const pr = PIANO_PRESETS[name] || PIANO_PRESETS["Grand Piano"];
    const next = Object.assign({}, base, pr);
    // mutate in place (keeps reference)
    if(paramsRef){
      for(const k of Object.keys(paramsRef)) delete paramsRef[k];
      for(const k of Object.keys(next)) paramsRef[k]=next[k];
      return paramsRef;
    }
    return next;
  }

  function _safeP(paramsRef){
    const base=_pianoDefaults();
    const p=Object.assign({}, base, (paramsRef||{}));
    // if preset changed but params not matching, gently merge that preset
    if(p.preset && PIANO_PRESETS[p.preset]){
      const pr = PIANO_PRESETS[p.preset];
      // only fill missing keys, don't override user's tweaks
      for(const k in pr){
        if(p[k]==null) p[k]=pr[k];
      }
    }
    // clamps
    p.poly = Math.max(1, (p.poly||16)|0);
    p.gain = isFinite(p.gain)? Math.max(0, +p.gain) : 1.0;
    p.tone = isFinite(p.tone)? Math.max(200, +p.tone) : 12000;
    p.attack = isFinite(p.attack)? Math.max(0.001, +p.attack) : 0.004;
    p.decay = isFinite(p.decay)? Math.max(0.01, +p.decay) : 0.14;
    p.sustain = isFinite(p.sustain)? instClamp(+p.sustain, 0.05, 1.0) : 0.6;
    p.release = isFinite(p.release)? instClamp(+p.release, 0.02, 2.0) : 0.18;
    p.fm = isFinite(p.fm)? instClamp(+p.fm, 0, 40) : 12;
    p.hammer = isFinite(p.hammer)? instClamp(+p.hammer, 0, 1) : 0.25;
    p.tremRate = isFinite(p.tremRate)? instClamp(+p.tremRate, 0, 12) : 0.0;
    p.tremDepth = isFinite(p.tremDepth)? instClamp(+p.tremDepth, 0, 1) : 0.0;
    return p;
  }

  function _makeNoiseBuffer(ctx){
    const sr=ctx.sampleRate;
    const len=Math.floor(sr*0.02);
    const b=ctx.createBuffer(1,len,sr);
    const d=b.getChannelData(0);
    for(let i=0;i<len;i++){ d[i]=(Math.random()*2-1)*Math.pow(1-i/len, 2.5); }
    return b;
  }

  const DEF = {
    id: "Piano",
    name: "Piano",
    type: "synth",
    color: "#27e0a3",
    defaultParams: _pianoDefaults,
    applyPreset: _applyPreset,
    uiSchema: {
      title: "Piano",
      sections: [
        {
          title: "Preset",
          controls: [
            { type:"select", key:"preset", label:"Preset",
              options:[
                {value:"Grand Piano", label:"Grand Piano"},
                {value:"Fender Rhodes", label:"Fender Rhodes"},
                {value:"E Piano", label:"E Piano"}
              ],
              default:"Grand Piano"
            }
          ]
        },
        {
          title: "Main",
          controls: [
            { type:"slider", key:"gain", label:"Gain", min:0, max:1.6, step:0.01 },
            { type:"slider", key:"poly", label:"Poly", min:1, max:24, step:1, valueAs:"int" },
            { type:"slider", key:"tone", label:"Tone", min:300, max:20000, step:10, valueAs:"int", unit:"Hz" }
          ]
        },
        {
          title: "Amp",
          controls: [
            { type:"slider", key:"attack", label:"Attack", min:0.001, max:0.25, step:0.001, unit:"s" },
            { type:"slider", key:"decay", label:"Decay", min:0.01, max:1.5, step:0.01, unit:"s" },
            { type:"slider", key:"sustain", label:"Sustain", min:0.05, max:1.0, step:0.01 },
            { type:"slider", key:"release", label:"Release", min:0.02, max:2.0, step:0.01, unit:"s" }
          ]
        },
        {
          title: "Character",
          controls: [
            { type:"slider", key:"fm", label:"FM Amount", min:0, max:40, step:0.5 },
            { type:"slider", key:"hammer", label:"Hammer", min:0, max:1, step:0.01 },
            { type:"slider", key:"tremRate", label:"Trem Rate", min:0, max:12, step:0.1, unit:"Hz" },
            { type:"slider", key:"tremDepth", label:"Trem Depth", min:0, max:1, step:0.01 }
          ]
        }
      ]
    },
    create: function(ae, paramsRef, outBus){
      const ctx = ae.ctx;
      const voices = [];
      const noiseBuf = _makeNoiseBuffer(ctx);

      function cleanupVoices(tt){
        for(let i=voices.length-1;i>=0;i--){ if(voices[i].stopAt <= tt-0.05) voices.splice(i,1); }
      }
      function stealIfNeeded(tt, poly){
        cleanupVoices(tt);
        while(voices.length >= poly){
          const v = voices.shift();
          try{ v.kill(tt); }catch(e){}
        }
      }
      const common = { id:this.id, name:this.name, type:this.type, color:this.color, uiSchema:this.uiSchema, defaultParams:this.defaultParams, applyPreset:this.applyPreset };

      function trigger(t,midi,vel=0.9,dur=0.35){
        const p = _safeP(paramsRef);
        stealIfNeeded(t, p.poly);

        const f = mtof(midi);
        const out = outBus || ae.master;

        const lp = ctx.createBiquadFilter();
        lp.type="lowpass";
        lp.frequency.setValueAtTime(p.tone, t);
        lp.Q.value = 0.7;

        // main osc + mod osc (FM-ish)
        const car = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();

        const isRhodes = (p.preset === "Fender Rhodes");
        const isEP = (p.preset === "E Piano");

        car.type = isRhodes ? "sine" : (isEP ? "triangle" : "triangle");
        car.frequency.setValueAtTime(f, t);

        mod.type = "sine";
        mod.frequency.setValueAtTime(f*(isRhodes?2:2.5), t);
        modGain.gain.setValueAtTime((p.fm||0) * vel, t);

        mod.connect(modGain);
        modGain.connect(car.frequency);

        // amp ADSR
        const g = ctx.createGain();
        const peak = (p.gain||1) * instClamp(vel,0,1);

        const atk = p.attack;
        const dec = p.decay;
        const sus = p.sustain;
        const rel = p.release;

        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t+atk);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak*sus), t+atk+dec);
        g.gain.setValueAtTime(Math.max(0.0002, peak*sus), t+Math.max(atk+dec, dur));
        g.gain.linearRampToValueAtTime(0.0001, t+Math.max(atk+dec, dur)+rel);

        // tremolo for rhodes/ep
        let trem=null, tremGain=null;
        if((p.tremRate||0)>0.01 && (p.tremDepth||0)>0.001){
          trem = ctx.createOscillator();
          trem.type="sine";
          trem.frequency.setValueAtTime(p.tremRate, t);
          tremGain = ctx.createGain();
          tremGain.gain.setValueAtTime(p.tremDepth*0.5, t);
          trem.connect(tremGain);
          tremGain.connect(g.gain);
          trem.start(t);
        }

        // hammer/noise transient for grand
        let ns=null, nsG=null;
        if(p.hammer>0.01 && !isRhodes){
          ns = ctx.createBufferSource();
          ns.buffer = noiseBuf;
          nsG = ctx.createGain();
          nsG.gain.setValueAtTime(0.0001, t);
          nsG.gain.exponentialRampToValueAtTime(0.15*p.hammer*vel, t+0.002);
          nsG.gain.exponentialRampToValueAtTime(0.0001, t+0.02);
          ns.connect(nsG);
          nsG.connect(lp);
          ns.start(t);
          ns.stop(t+0.03);
        }

        car.connect(lp);
        lp.connect(g);
        g.connect(out);

        car.start(t);
        mod.start(t);

        const stopAt = t + Math.max(atk+dec, dur) + rel + 0.08;
        car.stop(stopAt);
        mod.stop(stopAt);
        if(trem) trem.stop(stopAt);

        voices.push({
          stopAt: stopAt+0.05,
          kill:(tt)=>{
            try{
              g.gain.cancelScheduledValues(tt);
              g.gain.setValueAtTime(Math.max(0.0001, g.gain.value||0.0001), tt);
              g.gain.exponentialRampToValueAtTime(0.0001, tt+0.02);
              try{ car.stop(tt+0.03); }catch(e){}
              try{ mod.stop(tt+0.03); }catch(e){}
              if(trem) try{ trem.stop(tt+0.03);}catch(e){}
            }catch(e){}
          }
        });
      }

      return { ...common, trigger };
    }
  };

  // Also expose piano presets as separate "virtual instruments" (optional)
  function _makeAlias(name){
    const d = Object.assign({}, DEF);
    d.id = name;
    d.name = name;
    d.uiSchema = Object.assign({}, DEF.uiSchema, { title: name });
    d.defaultParams = function(){ return _applyPreset(null, name); };
    return d;
  }

  window.__INSTRUMENTS__["Piano"] = DEF;
  window.__INSTRUMENTS__["Grand Piano"] = _makeAlias("Grand Piano");
  window.__INSTRUMENTS__["Fender Rhodes"] = _makeAlias("Fender Rhodes");
  window.__INSTRUMENTS__["E Piano"] = _makeAlias("E Piano");
})();
