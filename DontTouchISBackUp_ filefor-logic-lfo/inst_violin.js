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
        engine: "fm",
        preset: "FM Violin",
        poly: 10,
        gain: 1.0,
        attack: 0.02,
        decay: 0.08,
        sustain: 0.85,
        release: 0.28,
        cutoff: 9000,
        reso: 1.2,
        vibratoRate: 5.5,
        vibratoDepth: 8,
        bowNoise: 0.12,
        detune: 6,
        fm: 0.60
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
        { title:"Colour", controls:[
          {type:"slider", key:"cutoff", label:"Cutoff", min:300, max:20000, step:10, valueAs:"int", unit:"Hz"},
          {type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1},
          {type:"slider", key:"fm", label:"FM Amount", min:0, max:1.5, step:0.01}
        ]},
        { title:"Bow", controls:[
          {type:"slider", key:"vibratoRate", label:"Vibrato Rate", min:0, max:12, step:0.1, unit:"Hz"},
          {type:"slider", key:"vibratoDepth", label:"Vibrato Depth", min:0, max:30, step:1, valueAs:"int", unit:"c"},
          {type:"slider", key:"bowNoise", label:"Bow Noise", min:0, max:0.6, step:0.01}
        ]}
      ]
    }
  };
  window.__INSTRUMENTS__.Violin = DEF;
})();
