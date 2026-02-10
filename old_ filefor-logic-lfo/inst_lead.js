/* ================= Electro DAW | inst_lead.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const DEF = {
    id: "Lead",
    name: "Lead",
    type: "synth",
    color: "#facc15",
    defaultParams: function(){
      return {
        poly: 12,
        gain: 1.0,
        wave: "square",
        attack: 0.003,
        decay: 0.10,
        sustain: 0.65,
        release: 0.14,
        cutoff: 12000,
        reso: 1.2,
        glide: 0.0,
        detune: 6,
        vibratoRate: 0.0,
        vibratoDepth: 0
      };
    },
    uiSchema: {
      title:"Lead",
      sections:[
        { title:"Osc", controls:[
          { type:"select", key:"wave", label:"Wave", default:"square", options:[
            {value:"square", label:"Square"},
            {value:"sawtooth", label:"Saw"},
            {value:"triangle", label:"Triangle"},
            {value:"sine", label:"Sine"}
          ]},
          { type:"slider", key:"detune", label:"Detune", min:0, max:30, step:1, valueAs:"int", unit:"c" }
        ]},
        { title:"Main", controls:[
          { type:"slider", key:"gain", label:"Gain", min:0, max:1.6, step:0.01 },
          { type:"slider", key:"poly", label:"Poly", min:1, max:24, step:1, valueAs:"int" },
          { type:"slider", key:"glide", label:"Glide", min:0, max:0.25, step:0.001, unit:"s" }
        ]},
        { title:"Amp", controls:[
          { type:"slider", key:"attack", label:"Attack", min:0.001, max:0.25, step:0.001, unit:"s" },
          { type:"slider", key:"decay", label:"Decay", min:0.01, max:1.5, step:0.01, unit:"s" },
          { type:"slider", key:"sustain", label:"Sustain", min:0.05, max:1, step:0.01 },
          { type:"slider", key:"release", label:"Release", min:0.02, max:2.0, step:0.01, unit:"s" }
        ]},
        { title:"Filter", controls:[
          { type:"slider", key:"cutoff", label:"Cutoff", min:200, max:20000, step:10, valueAs:"int", unit:"Hz" },
          { type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1 }
        ]},
        { title:"Vibrato", controls:[
          { type:"slider", key:"vibratoRate", label:"Rate", min:0, max:12, step:0.1, unit:"Hz" },
          { type:"slider", key:"vibratoDepth", label:"Depth", min:0, max:30, step:1, valueAs:"int", unit:"c" }
        ]}
      ]
    },

    create: function(ae, paramsRef, outBus){
      const ctx = ae.ctx;
      const voices = [];

      function cleanup(tt){
        for(let i=voices.length-1;i>=0;i--){
          if(voices[i].stopAt <= tt-0.05) voices.splice(i,1);
        }
      }
      function steal(tt, poly){
        cleanup(tt);
        while(voices.length >= poly){
          const v = voices.shift();
          try{ v.kill(tt); }catch(e){}
        }
      }

      const common = { id:this.id, name:this.name, type:this.type, color:this.color, uiSchema:this.uiSchema, defaultParams:this.defaultParams };

      function trigger(t, midi, vel=0.9, dur=0.3){
        const p = Object.assign({}, DEF.defaultParams(), (paramsRef||{}));
        const poly = Math.max(1, (p.poly||12)|0);
        steal(t, poly);

        const out = outBus || ae.master;
        const f = mtof(midi);

        const wave = ["sine","square","sawtooth","triangle"].includes(String(p.wave)) ? String(p.wave) : "square";
        const detC = instClamp(+p.detune||0, 0, 30);

        const osc1 = ctx.createOscillator();
        osc1.type = wave;
        osc1.frequency.setValueAtTime(f, t);
        osc1.detune.setValueAtTime(-detC, t);

        const osc2 = ctx.createOscillator();
        osc2.type = wave;
        osc2.frequency.setValueAtTime(f, t);
        osc2.detune.setValueAtTime(detC, t);

        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(instClamp(+p.cutoff||12000, 200, 20000), t);
        lp.Q.value = instClamp(+p.reso||1.2, 0.1, 18);

        const g = ctx.createGain();
        const peak = Math.max(0, (+p.gain||1)) * instClamp(vel,0,1);

        const atk = instClamp(+p.attack||0.003, 0.001, 0.25);
        const dec = instClamp(+p.decay||0.10, 0.01, 1.5);
        const sus = instClamp(+p.sustain||0.65, 0.05, 1.0);
        const rel = instClamp(+p.release||0.14, 0.02, 2.0);

        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + atk);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak*sus), t + atk + dec);

        const hold = Math.max(atk+dec, dur);
        g.gain.setValueAtTime(Math.max(0.0002, peak*sus), t + hold);
        g.gain.linearRampToValueAtTime(0.0001, t + hold + rel);

        // Vibrato (detune cents)
        let vib=null, vibGain=null;
        const vr = instClamp(+p.vibratoRate||0, 0, 12);
        const vd = instClamp(+p.vibratoDepth||0, 0, 30);
        if(vr>0.01 && vd>0.01){
          vib = ctx.createOscillator();
          vib.type = "sine";
          vib.frequency.setValueAtTime(vr, t);
          vibGain = ctx.createGain();
          vibGain.gain.setValueAtTime(vd, t);
          vib.connect(vibGain);
          vibGain.connect(osc1.detune);
          vibGain.connect(osc2.detune);
          vib.start(t);
        }

        osc1.connect(lp);
        osc2.connect(lp);
        lp.connect(g);
        g.connect(out);

        osc1.start(t);
        osc2.start(t);

        const stopAt = t + hold + rel + 0.06;
        osc1.stop(stopAt);
        osc2.stop(stopAt);
        if(vib) vib.stop(stopAt);

        voices.push({
          stopAt: stopAt + 0.05,
          kill:(tt)=>{
            try{
              g.gain.cancelScheduledValues(tt);
              g.gain.setValueAtTime(Math.max(0.0001, g.gain.value||0.0001), tt);
              g.gain.exponentialRampToValueAtTime(0.0001, tt+0.02);
              try{ osc1.stop(tt+0.03);}catch(e){}
              try{ osc2.stop(tt+0.03);}catch(e){}
              if(vib) try{ vib.stop(tt+0.03);}catch(e){}
            }catch(e){}
          }
        });
      }

      return { ...common, trigger };
    }
  };

  window.__INSTRUMENTS__["Lead"] = DEF;
})();
