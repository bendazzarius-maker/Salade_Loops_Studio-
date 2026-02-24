/* ================= Electro DAW | inst_sampler_touski.js (JUCE IPC driver) ================= */
(function installTouskiInstrument(global){
  function req(op, data){
    return global.audioBackend?.backends?.juce?._request?.(op, data).catch(()=>null);
  }

  const Touski = {
    name: "Touski",
    color: "#8fd3ff",
    type: "sampler",
    defaultParams(){ return { programPath: "", gain: 1, pan: 0 }; },
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
        name: "Touski",
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
})(window);
