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
        engine: "fm",
        preset: "FM Pad",
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
        lfoDepth: 0.35,
        fm: 0.55
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
        { title:"Filter / FM", controls:[
          { type:"slider", key:"cutoff", label:"Cutoff", min:200, max:20000, step:10, valueAs:"int", unit:"Hz" },
          { type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1 },
          { type:"slider", key:"fm", label:"FM Amount", min:0, max:1.5, step:0.01 }
        ]},
        { title:"Motion", controls:[
          { type:"slider", key:"lfoRate", label:"LFO Rate", min:0, max:8, step:0.05, unit:"Hz" },
          { type:"slider", key:"lfoDepth", label:"LFO Depth", min:0, max:1, step:0.01 }
        ]}
      ]
    }
  };
  window.__INSTRUMENTS__.Pad = DEF;
})();
