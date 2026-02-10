/* ================= Electro DAW | inst_violin.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const DEF = {
    id:"Violin",
    name:"Violin",
    type:"synth",
    color:"#facc15",
    defaultParams:function(){
      return {
        poly: 10,
        gain: 1.0,
        attack: 0.02,
        decay: 0.08,
        sustain: 0.85,
        release: 0.28,
        cutoff: 9000,
        reso: 1.2,
        vibratoRate: 5.5,
        vibratoDepth: 8,   // cents
        bowNoise: 0.12,
        detune: 6          // cents
      };
    },
    uiSchema:{
      title:"Violin",
      sections:[
        { title:"Main", controls:[
          {type:"slider", key:"gain", label:"Gain", min:0, max:1.6, step:0.01},
          {type:"slider", key:"poly", label:"Poly", min:1, max:24, step:1, valueAs:"int"},
          {type:"slider", key:"detune", label:"Detune", min:0, max:30, step:1, valueAs:"int", unit:"c"}
        ]},
        { title:"Amp", controls:[
          {type:"slider", key:"attack", label:"Attack", min:0.001, max:0.4, step:0.001, unit:"s"},
          {type:"slider", key:"decay", label:"Decay", min:0.01, max:1.2, step:0.01, unit:"s"},
          {type:"slider", key:"sustain", label:"Sustain", min:0.05, max:1, step:0.01},
          {type:"slider", key:"release", label:"Release", min:0.02, max:2.0, step:0.01, unit:"s"}
        ]},
        { title:"Filter", controls:[
          {type:"slider", key:"cutoff", label:"Cutoff", min:300, max:20000, step:10, valueAs:"int", unit:"Hz"},
          {type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1}
        ]},
        { title:"Bow", controls:[
          {type:"slider", key:"vibratoRate", label:"Vibrato Rate", min:0, max:12, step:0.1, unit:"Hz"},
          {type:"slider", key:"vibratoDepth", label:"Vibrato Depth", min:0, max:30, step:1, valueAs:"int", unit:"c"},
          {type:"slider", key:"bowNoise", label:"Bow Noise", min:0, max:0.6, step:0.01}
        ]}
      ]
    },
    create:function(ae, paramsRef, outBus){
      const ctx=ae.ctx;
      const voices=[];
      const common={ id:this.id, name:this.name, type:this.type, color:this.color, uiSchema:this.uiSchema, defaultParams:this.defaultParams };

      // small noise buffer for bow
      const sr=ctx.sampleRate;
      const nb=ctx.createBuffer(1, Math.floor(sr*0.15), sr);
      const nd=nb.getChannelData(0);
      for(let i=0;i<nd.length;i++){
        const t=i/nd.length;
        nd[i]=(Math.random()*2-1) * Math.pow(1-t, 1.6);
      }

      function cleanup(tt){ for(let i=voices.length-1;i>=0;i--){ if(voices[i].stopAt<=tt-0.05) voices.splice(i,1);} }
      function steal(tt, poly){ cleanup(tt); while(voices.length>=poly){ const v=voices.shift(); try{v.kill(tt);}catch(e){} } }

      function trigger(t,midi,vel=0.9,dur=0.6){
        const p = Object.assign({}, DEF.defaultParams(), (paramsRef||{}));
        const poly=Math.max(1,(p.poly||10)|0);
        steal(t, poly);

        const f=mtof(midi);
        const out=outBus||ae.master;

        const osc1=ctx.createOscillator(); osc1.type="sawtooth";
        const osc2=ctx.createOscillator(); osc2.type="triangle";

        const detC=(+p.detune||0);
        osc1.frequency.setValueAtTime(f, t);
        osc2.frequency.setValueAtTime(f, t);
        osc1.detune.setValueAtTime(-detC, t);
        osc2.detune.setValueAtTime(detC, t);

        const form=ctx.createBiquadFilter();
        form.type="bandpass";
        form.frequency.setValueAtTime(Math.min(6000, f*6), t);
        form.Q.value=6;

        const lp=ctx.createBiquadFilter();
        lp.type="lowpass";
        lp.frequency.setValueAtTime(Math.max(300, Math.min(20000, +p.cutoff||9000)), t);
        lp.Q.value = Math.max(0.1, +p.reso||1.2);

        const g=ctx.createGain();
        const peak=Math.max(0, (+p.gain||1))*Math.max(0,Math.min(1,vel));

        const atk=Math.max(0.001, +p.attack||0.02);
        const dec=Math.max(0.01, +p.decay||0.08);
        const sus=Math.max(0.05, Math.min(1, +p.sustain||0.85));
        const rel=Math.max(0.02, +p.release||0.28);

        g.gain.setValueAtTime(0.0001,t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t+atk);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak*sus), t+atk+dec);
        g.gain.setValueAtTime(Math.max(0.0002, peak*sus), t+Math.max(atk+dec, dur));
        g.gain.linearRampToValueAtTime(0.0001, t+Math.max(atk+dec, dur)+rel);

        // vibrato
        const vibR = Math.max(0, +p.vibratoRate||0);
        const vibD = Math.max(0, +p.vibratoDepth||0);
        let vib=null, vibGain=null;
        if(vibR>0.01 && vibD>0.01){
          vib=ctx.createOscillator(); vib.type="sine"; vib.frequency.setValueAtTime(vibR,t);
          vibGain=ctx.createGain(); vibGain.gain.setValueAtTime(vibD, t);
          vib.connect(vibGain);
          vibGain.connect(osc1.detune);
          vibGain.connect(osc2.detune);
          vib.start(t);
        }

        // bow noise
        let noise=null, ng=null, nlp=null;
        const bn=Math.max(0, +p.bowNoise||0);
        if(bn>0.001){
          noise=ctx.createBufferSource(); noise.buffer=nb;
          ng=ctx.createGain(); ng.gain.setValueAtTime(0.0001,t);
          ng.gain.exponentialRampToValueAtTime(Math.max(0.0002, bn*0.25*vel), t+0.015);
          ng.gain.setValueAtTime(Math.max(0.0002, bn*0.2*vel), t+Math.max(0.03, dur*0.6));
          ng.gain.exponentialRampToValueAtTime(0.0001, t+Math.max(0.03, dur*0.6)+rel);
          nlp=ctx.createBiquadFilter(); nlp.type="highpass"; nlp.frequency.value=800;
          noise.connect(nlp); nlp.connect(ng); ng.connect(lp);
          noise.start(t);
        }

        osc1.connect(form);
        osc2.connect(form);
        form.connect(lp);
        lp.connect(g);
        g.connect(out);

        osc1.start(t); osc2.start(t);

        const stopAt=t+Math.max(atk+dec, dur)+rel+0.08;
        osc1.stop(stopAt); osc2.stop(stopAt);
        if(noise) noise.stop(stopAt);
        if(vib) vib.stop(stopAt);

        voices.push({
          stopAt: stopAt+0.05,
          kill:(tt)=>{
            try{
              g.gain.cancelScheduledValues(tt);
              g.gain.setValueAtTime(Math.max(0.0001, g.gain.value||0.0001), tt);
              g.gain.exponentialRampToValueAtTime(0.0001, tt+0.02);
              try{ osc1.stop(tt+0.03);}catch(e){}
              try{ osc2.stop(tt+0.03);}catch(e){}
              if(noise) try{ noise.stop(tt+0.03);}catch(e){}
              if(vib) try{ vib.stop(tt+0.03);}catch(e){}
            }catch(e){}
          }
        });
      }

      return { ...common, trigger };
    }
  };

  window.__INSTRUMENTS__["Violin"]=DEF;
})();
