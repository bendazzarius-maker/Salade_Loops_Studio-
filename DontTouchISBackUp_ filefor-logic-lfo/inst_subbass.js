/* ================= Electro DAW | inst_subbass.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const DEF = {
    id:"Sub Bass",
    name:"Sub Bass",
    type:"synth",
    color:"#8b5cf6",
    defaultParams:function(){
      return {
        poly: 10,
        gain: 1.0,
        wave: "sine",     // sine/square
        attack: 0.003,
        decay: 0.08,
        sustain: 0.7,
        release: 0.14,
        cutoff: 550,
        reso: 0.9,
        drive: 0.15
      };
    },
    uiSchema:{
      title:"Sub Bass",
      sections:[
        {title:"Main", controls:[
          {type:"slider", key:"gain", label:"Gain", min:0, max:1.8, step:0.01},
          {type:"slider", key:"poly", label:"Poly", min:1, max:24, step:1, valueAs:"int"},
          {type:"select", key:"wave", label:"Wave", default:"sine", options:[
            {value:"sine", label:"Sine"},
            {value:"square", label:"Square"}
          ]},
          {type:"slider", key:"drive", label:"Drive", min:0, max:1, step:0.01}
        ]},
        {title:"Amp", controls:[
          {type:"slider", key:"attack", label:"Attack", min:0.001, max:0.25, step:0.001, unit:"s"},
          {type:"slider", key:"decay", label:"Decay", min:0.01, max:1.2, step:0.01, unit:"s"},
          {type:"slider", key:"sustain", label:"Sustain", min:0.05, max:1, step:0.01},
          {type:"slider", key:"release", label:"Release", min:0.02, max:2.0, step:0.01, unit:"s"}
        ]},
        {title:"Filter", controls:[
          {type:"slider", key:"cutoff", label:"Cutoff", min:60, max:5000, step:5, valueAs:"int", unit:"Hz"},
          {type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1}
        ]}
      ]
    },
    create:function(ae, paramsRef, outBus){
      const ctx=ae.ctx;
      const voices=[];
      const common={ id:this.id, name:this.name, type:this.type, color:this.color, uiSchema:this.uiSchema, defaultParams:this.defaultParams };

      function cleanup(tt){ for(let i=voices.length-1;i>=0;i--){ if(voices[i].stopAt<=tt-0.05) voices.splice(i,1);} }
      function steal(tt, poly){ cleanup(tt); while(voices.length>=poly){ const v=voices.shift(); try{v.kill(tt);}catch(e){} } }

      function trigger(t,midi,vel=0.9,dur=0.35){
        const p = Object.assign({}, DEF.defaultParams(), (paramsRef||{}));
        const poly=Math.max(1,(p.poly||10)|0);
        steal(t, poly);

        const f=mtof(midi);
        const out=outBus||ae.master;

        const osc=ctx.createOscillator();
        osc.type = (p.wave==="square") ? "square" : "sine";
        osc.frequency.setValueAtTime(f, t);

        const lp=ctx.createBiquadFilter();
        lp.type="lowpass";
        lp.frequency.setValueAtTime(Math.max(60, Math.min(20000, +p.cutoff||550)), t);
        lp.Q.value = Math.max(0.1, +p.reso||0.9);

        const sh = makeWaveshaper(ctx, +p.drive||0);

        const g=ctx.createGain();
        const peak=Math.max(0,(+p.gain||1))*Math.max(0,Math.min(1,vel));

        const atk=Math.max(0.001, +p.attack||0.003);
        const dec=Math.max(0.01, +p.decay||0.08);
        const sus=Math.max(0.05, Math.min(1, +p.sustain||0.7));
        const rel=Math.max(0.02, +p.release||0.14);

        g.gain.setValueAtTime(0.0001,t);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t+atk);
        g.gain.linearRampToValueAtTime(Math.max(0.0002, peak*sus), t+atk+dec);
        g.gain.setValueAtTime(Math.max(0.0002, peak*sus), t+Math.max(atk+dec, dur));
        g.gain.linearRampToValueAtTime(0.0001, t+Math.max(atk+dec, dur)+rel);

        osc.connect(lp);
        lp.connect(sh);
        sh.connect(g);
        g.connect(out);

        osc.start(t);
        const stopAt=t+Math.max(atk+dec, dur)+rel+0.08;
        osc.stop(stopAt);

        voices.push({
          stopAt: stopAt+0.05,
          kill:(tt)=>{
            try{
              g.gain.cancelScheduledValues(tt);
              g.gain.setValueAtTime(Math.max(0.0001, g.gain.value||0.0001), tt);
              g.gain.exponentialRampToValueAtTime(0.0001, tt+0.02);
              try{ osc.stop(tt+0.03);}catch(e){}
            }catch(e){}
          }
        });
      }

      return { ...common, trigger };
    }
  };

  window.__INSTRUMENTS__["Sub Bass"]=DEF;
})();
