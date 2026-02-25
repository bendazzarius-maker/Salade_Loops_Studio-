/* ================= Electro DAW | inst_sampler_touski.js (JUCE IPC driver) ================= */
(function installTouskiInstrument(global){
  function req(op, data){
    return global.audioBackend?.backends?.juce?._request?.(op, data).catch(()=>null);
  }

  function buildProgramOptions(){
    const list = (global.sampleDirectory && typeof global.sampleDirectory.listPrograms === "function") ? global.sampleDirectory.listPrograms() : [];
    const options = [{ value: "", label: "(aucun programme)", group: "Programmes" }];
    for (const p of list){
      const programPath = String(p?.filePath || p?.path || "").trim();
      if (!programPath) continue;
      options.push({ value: programPath, label: String(p?.name || programPath.split(/[\/]/).pop() || programPath), group: String(p?.category || "Programmes") });
    }
    return options;
  }

  const Touski = {
    name: "Sample Touski",
    id: "Sample Touski",
    color: "#8fd3ff",
    type: "sampler",
    defaultParams(){ return { programPath: "", gain: 1, pan: 0 }; },
    uiSchema(){
      return {
        title: "Sample Touski",
        sections: [
          { title: "Programme", controls: [
            { type: "select", key: "programPath", label: "Programme", options: buildProgramOptions(), default: "" }
          ]},
          { title: "Mix", controls: [
            { type: "slider", key: "gain", label: "Gain", min: 0, max: 2, step: 0.01 },
            { type: "slider", key: "pan", label: "Pan", min: -1, max: 1, step: 0.01 }
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
