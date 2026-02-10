/* ================= Electro DAW | inst_pad.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const DEF = {
    id: "Pad",
    name: "Pad",
    type: "synth",
    color: "#a78bfa",
    defaultParams: function(){
      return {
        poly: 14,
        gain: 1.0,
        detune: 10,
        attack: 0.25,
        decay: 0.40,
        sustain: 0.80,
        release: 1.20,
        cutoff: 9000,
        reso: 0.9,
        lfoRate: 0.12,
        lfoDepth: 0.35
      };
    },
    uiSchema: {
      title:"Pad",
      sections:[
        { title:"Main", controls:[
          { type:"slider", key:"gain", label:"Gain", min:0, max:1.6, step:0.01 },
          { type:"slider", key:"poly", label:"Poly", min:1, max:24, step:1, valueAs:"int" },
          { type:"slider", key:"detune", label:"Detune", min:0, max:30, step:1, valueAs:"int", unit:"c" }
        ]},
        { title:"Amp", controls:[
          { type:"slider", key:"attack", label:"Attack", min:0.005, max:2.0, step:0.005, unit:"s" },
          { type:"slider", key:"decay", label:"Decay", min:0.01, max:3.0, step:0.01, unit:"s" },
          { type:"slider", key:"sustain", label:"Sustain", min:0.05, max:1, step:0.01 },
          { type:"slider", key:"release", label:"Release", min:0.05, max:6.0, step:0.05, unit:"s" }
        ]},
        { title:"Filter", controls:[
          { type:"slider", key:"cutoff", label:"Cutoff", min:200, max:20000, step:10, valueAs:"int", unit:"Hz" },
          { type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1 }
        ]},
        { title:"Motion", controls:[
          { type:"slider", key:"lfoRate", label:"LFO Rate", min:0, max:8, step:0.05, unit:"Hz" },
          { type:"slider", key:"lfoDepth", label:"LFO Depth", min:0, max:1, step:0.01 }
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

      function trigger(t, midi, vel=0.9, dur=0.6){
        const p = Object.assign({}, DEF.defaultParams(), (paramsRef||{}));
        const poly = Math.max(1, (p.poly||14)|0);
        steal(t, poly);

        const out = outBus || ae.master;
        const f = mtof(midi);
        const detC = instClamp(+p.detune||0, 0, 30);

        const osc1 = ctx.createOscillator();
        osc1.type = "sawtooth";
        osc1.frequency.setValueAtTime(f, t);
        osc1.detune.setValueAtTime(-detC, t);

        const osc2 = ctx.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(f, t);
        osc2.detune.setValueAtTime(detC, t);

        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(instClamp(+p.cutoff||9000, 200, 20000), t);
        lp.Q.value = instClamp(+p.reso||0.9, 0.1, 18);

        // LFO -> filter frequency
        let lfo=null, lfoGain=null;
        const lr = instClamp(+p.lfoRate||0, 0, 8);
        const ld = instClamp(+p.lfoDepth||0, 0, 1);
        if(lr>0.01 && ld>0.001){
          lfo = ctx.createOscillator();
          lfo.type = "sine";
          lfo.frequency.setValueAtTime(lr, t);
          lfoGain = ctx.createGain();
          // depth maps to +- 3000 Hz range
          lfoGain.gain.setValueAtTime(ld * 3000, t);
          lfo.connect(lfoGain);
          lfoGain.connect(lp.frequency);
          lfo.start(t);
        }

        const g = ctx.createGain();
        const peak = Math.max(0,(+p.gain||1)) * instClamp(vel,0,1);

        const atk = instClamp(+p.attack||0.25, 0.005, 2.0);
        const dec = instClamp(+p.decay||0.40, 0.01, 3.0);
        const sus = instClamp(+p.sustain||0.80, 0.05, 1.0);
        const rel = instClamp(+p.release||1.20, 0.05, 6.0);

        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + atk);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak*sus), t + atk + dec);

        const hold = Math.max(atk+dec, dur);
        g.gain.setValueAtTime(Math.max(0.0002, peak*sus), t + hold);
        g.gain.linearRampToValueAtTime(0.0001, t + hold + rel);

        osc1.connect(lp);
        osc2.connect(lp);
        lp.connect(g);
        g.connect(out);

        osc1.start(t);
        osc2.start(t);

        const stopAt = t + hold + rel + 0.10;
        osc1.stop(stopAt);
        osc2.stop(stopAt);
        if(lfo) lfo.stop(stopAt);

        voices.push({
          stopAt: stopAt + 0.05,
          kill:(tt)=>{
            try{
              g.gain.cancelScheduledValues(tt);
              g.gain.setValueAtTime(Math.max(0.0001, g.gain.value||0.0001), tt);
              g.gain.exponentialRampToValueAtTime(0.0001, tt+0.05);
              try{ osc1.stop(tt+0.06);}catch(e){}
              try{ osc2.stop(tt+0.06);}catch(e){}
              if(lfo) try{ lfo.stop(tt+0.06);}catch(e){}
            }catch(e){}
          }
        });
      }

      return { ...common, trigger };
    }
  };

  window.__INSTRUMENTS__["Pad"] = DEF;
})();
