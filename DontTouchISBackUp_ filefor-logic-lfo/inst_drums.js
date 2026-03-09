/* ================= Electro DAW | inst_drums.js ================= */
(function(){
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};
  const DEF = {
    id: "Drums",
    name: "Drums",
    type: "drums",
    color: "#ff4d6d",
    defaultParams: function(){
      return {
        __drumMachineUiState: null,
        gain: 1.0,
        kick: 1.0, kickTone: 0.32, kickPitch: 0.18, kickNoise: 0.00, kickDrive: 0.10,
        kick2: 0.9, kick2Tone: 0.45, kick2Pitch: 0.32, kick2Noise: 0.00, kick2Drive: 0.18,
        snare: 1.0, snareTone: 0.68, snarePitch: 0.58, snareNoise: 0.65, snareDrive: 0.08,
        clap: 0.8, clapTone: 0.72, clapPitch: 0.60, clapNoise: 0.75, clapDrive: 0.05,
        tomL: 0.9, tomLTone: 0.40, tomLPitch: 0.24, tomLNoise: 0.02, tomLDrive: 0.05,
        tomH: 0.85, tomHTone: 0.52, tomHPitch: 0.46, tomHNoise: 0.02, tomHDrive: 0.05,
        hatC: 0.9, hatCTone: 0.90, hatCPitch: 0.82, hatCNoise: 0.95, hatCDrive: 0.00,
        hatO: 0.85, hatOTone: 0.92, hatOPitch: 0.84, hatONoise: 0.95, hatODrive: 0.00,
        ride: 0.6, rideTone: 0.95, ridePitch: 0.76, rideNoise: 0.90, rideDrive: 0.00,
        crash: 0.7, crashTone: 0.98, crashPitch: 0.78, crashNoise: 0.92, crashDrive: 0.00,
        perc: 0.6, percTone: 0.70, percPitch: 0.66, percNoise: 0.20, percDrive: 0.06,
        perc2: 0.6, perc2Tone: 0.80, perc2Pitch: 0.74, perc2Noise: 0.20, perc2Drive: 0.06
      };
    },
    uiSchema: {
      title: "Drums",
      sections: [
        { title: "Main", controls: [
          { type: "slider", key: "gain", label: "Gain", min: 0, max: 1.5, step: 0.01 }
        ]}
      ]
    }
  };
  window.__INSTRUMENTS__.Drums = DEF;
})();
