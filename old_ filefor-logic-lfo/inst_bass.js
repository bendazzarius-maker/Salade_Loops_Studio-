/* ================= Electro DAW | inst_bass.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const DEF = {
    id: "Bass",
    name: "Bass",
    type: "synth",
    color: "#70a7ff",
    defaultParams: function(){
      return {
        poly: 12,
        gain: 1.0,
        drive: 0.20,
        cutoff: 900,
        reso: 1.4,
        attack: 0.003,
        decay: 0.09,
        sustain: 0.70,
        release: 0.14,
        subLevel: 0.65
      };
    },
    uiSchema: {
      title:"Bass",
      sections:[
        { title:"Main", controls:[
          { type:"slider", key:"gain", label:"Gain", min:0, max:1.8, step:0.01 },
          { type:"slider", key:"poly", label:"Poly", min:1, max:24, step:1, valueAs:"int" },
          { type:"slider", key:"drive", label:"Drive", min:0, max:1, step:0.01 }
        ]},
        { title:"Amp", controls:[
          { type:"slider", key:"attack", label:"Attack", min:0.001, max:0.25, step:0.001, unit:"s" },
          { type:"slider", key:"decay", label:"Decay", min:0.01, max:1.2, step:0.01, unit:"s" },
          { type:"slider", key:"sustain", label:"Sustain", min:0.05, max:1, step:0.01 },
          { type:"slider", key:"release", label:"Release", min:0.02, max:2.0, step:0.01, unit:"s" }
        ]},
        { title:"Filter", controls:[
          { type:"slider", key:"cutoff", label:"Cutoff", min:60, max:8000, step:5, valueAs:"int", unit:"Hz" },
          { type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1 }
        ]},
        { title:"Sub", controls:[
          { type:"slider", key:"subLevel", label:"Sub Level", min:0, max:1, step:0.01 }
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

        const f = mtof(midi);
        const out = outBus || ae.master;

        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(f, t);

        const sub = ctx.createOscillator();
        sub.type = "square";
        sub.frequency.setValueAtTime(f/2, t);

        const mix = ctx.createGain();
        mix.gain.setValueAtTime(1, t);

        const subMix = ctx.createGain();
        subMix.gain.setValueAtTime(instClamp(+p.subLevel||0, 0, 1), t);

        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(instClamp(+p.cutoff||900, 60, 8000), t);
        lp.Q.value = instClamp(+p.reso||1.4, 0.1, 18);

        const drive = makeWaveshaper(ctx, instClamp(+p.drive||0, 0, 1));

        const g = ctx.createGain();
        const peak = Math.max(0, (+p.gain||1)) * instClamp(vel, 0, 1);

        const atk = instClamp(+p.attack||0.003, 0.001, 0.25);
        const dec = instClamp(+p.decay||0.09, 0.01, 1.2);
        const sus = instClamp(+p.sustain||0.70, 0.05, 1.0);
        const rel = instClamp(+p.release||0.14, 0.02, 2.0);

        // ADSR
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + atk);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak*sus), t + atk + dec);

        const hold = Math.max(atk+dec, dur);
        g.gain.setValueAtTime(Math.max(0.0002, peak*sus), t + hold);
        g.gain.linearRampToValueAtTime(0.0001, t + hold + rel);

        osc.connect(mix);
        sub.connect(subMix);
        subMix.connect(mix);
        mix.connect(lp);
        lp.connect(drive);
        drive.connect(g);
        g.connect(out);

        osc.start(t);
        sub.start(t);

        const stopAt = t + hold + rel + 0.06;
        osc.stop(stopAt);
        sub.stop(stopAt);

        voices.push({
          stopAt: stopAt + 0.05,
          kill:(tt)=>{
            try{
              g.gain.cancelScheduledValues(tt);
              g.gain.setValueAtTime(Math.max(0.0001, g.gain.value||0.0001), tt);
              g.gain.exponentialRampToValueAtTime(0.0001, tt+0.02);
              try{ osc.stop(tt+0.03);}catch(e){}
              try{ sub.stop(tt+0.03);}catch(e){}
            }catch(e){}
          }
        });
      }

      return { ...common, trigger };
    }
  };

  window.__INSTRUMENTS__["Bass"] = DEF;
})();
