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
        engine: "fm",
        preset: "FM Lead",
        poly: 12,
        gain: 1.0,
        attack: 0.003,
        decay: 0.10,
        sustain: 0.65,
        release: 0.14,
        cutoff: 12000,
        reso: 1.2,
        glide: 0.0,
        detune: 6,
        vibratoRate: 0.0,
        vibratoDepth: 0,
        fm: 0.75
      };
    },
    uiSchema: {
      title:"Lead",
      sections:[
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
        { title:"Colour", controls:[
          { type:"slider", key:"fm", label:"FM Amount", min:0, max:1.5, step:0.01 },
          { type:"slider", key:"detune", label:"Detune", min:0, max:30, step:1, valueAs:"int", unit:"c" },
          { type:"slider", key:"cutoff", label:"Cutoff", min:200, max:20000, step:10, valueAs:"int", unit:"Hz" },
          { type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1 }
        ]},
        { title:"Vibrato", controls:[
          { type:"slider", key:"vibratoRate", label:"Rate", min:0, max:12, step:0.1, unit:"Hz" },
          { type:"slider", key:"vibratoDepth", label:"Depth", min:0, max:30, step:1, valueAs:"int", unit:"c" }
        ]}
      ]
    }
  };
  window.__INSTRUMENTS__.Lead = DEF;
})();
