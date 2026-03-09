/* ================= Electro DAW | inst_sampler_touski.js (JUCE IPC driver) ================= */
(function installTouskiInstrument(global){
  function req(op, data){
    return global.audioBackend?.backends?.juce?._request?.(op, data).catch(()=>null);
  }

  function buildProgramOptions(currentPath = ""){
    const list = (global.sampleDirectory && typeof global.sampleDirectory.listPrograms === "function") ? global.sampleDirectory.listPrograms() : [];
    const options = [{ value: "", label: "(aucun programme)", group: "Programmes" }];
    const seen = new Set();
    for (const p of list){
      const programPath = String(p?.filePath || p?.path || "").trim();
      if (!programPath) continue;
      seen.add(programPath);
      options.push({ value: programPath, label: String(p?.name || programPath.split(/[\/]/).pop() || programPath), group: String(p?.category || "Programmes") });
    }
    const current = String(currentPath || "").trim();
    if (current && !seen.has(current)) {
      options.push({ value: current, label: `${current.split(/[\/]/).pop() || current} (actuel)`, group: "Programmes" });
    }
    return options;
  }

  const Touski = {
    name: "Sample Touski",
    id: "Sample Touski",
    color: "#8fd3ff",
    type: "sampler",
    defaultParams(){ return { programPath: "", gain: 1, pan: 0, smoothingMs: 12.0, zeroCrossSearchMs: 3.0, pitchEngine: "granular", grainSizeMs: 70.0, grainOverlap: 0.78, grainJitterMs: 8.0, seamDiffusePct: 35.0 }; },
    uiSchema(params = {}){
      return {
        title: "Sample Touski",
        sections: [
          { title: "Programme", controls: [
            { type: "select", key: "programPath", label: "Programme", options: buildProgramOptions(params?.programPath || ""), default: "" }
          ]},
          { title: "Mix", controls: [
            { type: "slider", key: "gain", label: "Gain", min: 0, max: 2, step: 0.01 },
            { type: "slider", key: "pan", label: "Pan", min: -1, max: 1, step: 0.01 },
            { type: "slider", key: "smoothingMs", label: "Lissage boucle", min: 0, max: 250, step: 0.5, default: 12.0 }
          ]},
          { title: "Boucle & maintien", controls: [
            { type: "select", key: "pitchEngine", label: "Moteur maintien", default: "granular", options: [
              { value: "granular", label: "Granular Hold" },
              { value: "resample", label: "Resample Hold" }
            ]},
            { type: "slider", key: "zeroCrossSearchMs", label: "Recherche zéro-cross", min: 0, max: 50, step: 0.1, default: 3.0 },
            { type: "slider", key: "grainSizeMs", label: "Taille grain", min: 8, max: 250, step: 1, default: 70.0 },
            { type: "slider", key: "grainOverlap", label: "Recouvrement grain", min: 0.1, max: 0.98, step: 0.01, default: 0.78 },
            { type: "slider", key: "grainJitterMs", label: "Jitter source grain", min: 0, max: 80, step: 0.5, default: 8.0 },
            { type: "slider", key: "seamDiffusePct", label: "Diffusion maintien", min: 0, max: 100, step: 1, default: 35.0 }
          ]}
        ]
      };
    },
    create(_ae, params){
      const instId = `touski-${Math.random().toString(36).slice(2,8)}`;
      let created = false;
      async function ensure(){
        if (created) return;
        await req("inst.create", { instId, type: "drums", ch: 0 });
        if (params?.programPath) await req("touski.program.load", { instId, ch: 0, programPath: params.programPath });
        await req("touski.param.set", { instId, params: params || {} });
        created = true;
      }
      return {
        name: "Sample Touski",
        trigger(_t, midi, vel=0.85, dur=0.3){
          ensure().then(() => {
            req("touski.note.on", { instId, note: Number(midi), vel: Number(vel), when: "now" });
            setTimeout(()=> req("touski.note.off", { instId, note: Number(midi), when: "now" }), Math.max(20, Math.floor(dur * 1000)));
          });
        }
      };
    }
  };

  global.__INSTRUMENTS__ = global.__INSTRUMENTS__ || {};
  global.__INSTRUMENTS__[Touski.name] = Touski;
  global.__INSTRUMENTS__.Touski = Touski;
})(window);
