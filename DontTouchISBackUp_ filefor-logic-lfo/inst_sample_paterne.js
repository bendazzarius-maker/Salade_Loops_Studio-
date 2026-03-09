/* ================= Electro DAW | inst_sample_paterne.js (JUCE IPC driver) ================= */
(function installSamplePaterne(global){
  function req(op, data){ return global.audioBackend?.backends?.juce?._request?.(op, data).catch(()=>null); }
  function hashSamplePath(path){
    const s = String(path || ""); let h = 2166136261;
    for (let i=0;i<s.length;i+=1){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `sp_${(h>>>0).toString(16)}`;
  }

  const SamplePaterne = {
    name: "Sample Paterne",
    color: "#ffd166",
    type: "sample_pattern",
    defaultParams(){ return { samplePath:"", startNorm:0, endNorm:1, rootMidi:60, gain:1, pan:0, pitchMode:"vinyl" }; },
    create(_ae, params){
      return {
        name: "Sample Paterne",
        async trigger(_t, midi, vel=0.85, dur=0.25){
          const samplePath = String(params?.samplePath || "").trim();
          if (!samplePath) return;
          const sampleId = hashSamplePath(samplePath);
          await req("sampler.load", { sampleId, path: samplePath });
          await req("sampler.trigger", {
            trackId: "sample-pattern",
            sampleId,
            startNorm: Number(params?.startNorm ?? 0),
            endNorm: Number(params?.endNorm ?? 1),
            rootMidi: Number(params?.rootMidi ?? 60),
            note: Number(midi),
            velocity: Number(vel),
            gain: Number(params?.gain ?? 1),
            pan: Number(params?.pan ?? 0),
            mode: String(params?.pitchMode || "vinyl") === "fit_duration_vinyl" ? "fit_duration_vinyl" : "vinyl",
            durationSec: Number(dur || 0.25),
            when: "now"
          });
        }
      };
    }
  };

  global.__INSTRUMENTS__ = global.__INSTRUMENTS__ || {};
  global.__INSTRUMENTS__[SamplePaterne.name] = SamplePaterne;
})(window);
