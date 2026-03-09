/* ================= Electro DAW | inst_bass.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};
  const DEF = {
    id: "Bass",
    name: "Bass",
    type: "synth",
    color: "#6ea8ff",
    defaultParams: function(){
      return {
        engine: "fm",
        preset: "FM Bass",
        gain: 1.0,
        poly: 8,
        drive: 0.22,
        attack: 0.003,
        decay: 0.10,
        sustain: 0.72,
        release: 0.14,
        cutoff: 900,
        reso: 1.4,
        subLevel: 0.68,
        fm: 0.85
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
        { title:"Filter / Body", controls:[
          { type:"slider", key:"cutoff", label:"Cutoff", min:60, max:8000, step:5, valueAs:"int", unit:"Hz" },
          { type:"slider", key:"reso", label:"Reso", min:0.1, max:18, step:0.1 },
          { type:"slider", key:"subLevel", label:"Sub Level", min:0, max:1, step:0.01 },
          { type:"slider", key:"fm", label:"FM Amount", min:0, max:1.5, step:0.01 }
        ]}
      ]
    }
  };
  window.__INSTRUMENTS__.Bass = DEF;
})();
