/* ================= Electro DAW | juceInstructionLibrary.js =================
   Purpose: JS-side readable conversion dictionary for JUCE native runtime.
   UI stays in JS; audio processing intent is described as native instruction spec.
*/
(function initJuceInstructionLibrary(global){
  function clone(v){
    try { return JSON.parse(JSON.stringify(v)); } catch(_) { return {}; }
  }

  const INSTRUMENT_OPMAP = {
    "Piano": {
      module: "instrument.piano",
      voiceModel: "poly-fm-adsr",
      params: ["gain","poly","tone","attack","decay","sustain","release","fm","hammer","tremRate","tremDepth","preset"]
    },
    "Bass": {
      module: "instrument.bass",
      voiceModel: "mono-subtractive",
      params: ["gain","tone","attack","decay","sustain","release","drive","glide","wave"]
    },
    "SubBass": {
      module: "instrument.subbass",
      voiceModel: "mono-sub",
      params: ["gain","tone","attack","decay","sustain","release","drive","sub"]
    },
    "Lead": {
      module: "instrument.lead",
      voiceModel: "poly-bright-fm",
      params: ["gain","tone","attack","decay","sustain","release","fm","detune","drive"]
    },
    "Pad": {
      module: "instrument.pad",
      voiceModel: "poly-slow-adsr",
      params: ["gain","tone","attack","decay","sustain","release","width","chorus","detune"]
    },
    "Drums": {
      module: "instrument.drums",
      voiceModel: "multi-piece-drumkit",
      noteMap: "pitch-class-kit-map",
      params: ["gain","kick","kick2","snare","clap","tomL","tomH","hatC","hatO","ride","crash","perc","perc2"]
    },
    "Violin": {
      module: "instrument.violin",
      voiceModel: "bowed-string-model",
      params: ["gain","tone","attack","decay","sustain","release","vibratoRate","vibratoDepth"]
    },
    "Sample Paterne": {
      module: "instrument.sample_pattern",
      voiceModel: "sample-slice-pitch",
      params: ["samplePath","startNorm","endNorm","rootMidi","pitchMode","gain"]
    },
    "Sample Touski": {
      module: "instrument.touski",
      voiceModel: "program-mapped-sampler",
      params: ["programPath","gain","pan"]
    }
  };

  function resolveInstrumentEntry(name){
    const key = String(name || "Piano");
    return INSTRUMENT_OPMAP[key] || INSTRUMENT_OPMAP["Piano"];
  }

  function buildInstrumentSpec({ name, params, instId, trackId } = {}){
    const entry = resolveInstrumentEntry(name);
    return {
      version: 1,
      target: "juce",
      kind: "instrument",
      module: entry.module,
      voiceModel: entry.voiceModel,
      noteMap: entry.noteMap || null,
      instId: String(instId || "global"),
      trackId: String(trackId || "track"),
      params: clone(params || {}),
      allowedParams: clone(entry.params || []),
    };
  }

  function buildMixerSpec(model = {}){
    const channels = Array.isArray(model.channels) ? model.channels : [];
    return {
      version: 1,
      target: "juce",
      kind: "mixer",
      module: "mixer.console",
      master: clone(model.master || {}),
      channels: channels.map((ch, idx) => ({
        index: idx,
        id: String(ch.id || `ch-${idx+1}`),
        gain: Number(ch.gain ?? 0.85),
        pan: Number(ch.pan ?? 0),
        mute: !!ch.mute,
        solo: !!ch.solo,
      })),
    };
  }

  function buildFxSpec(scope, fx = {}, index = 0){
    return {
      version: 1,
      target: "juce",
      kind: "fx",
      module: String(fx.type || "fx.unknown"),
      scope: clone(scope || { scope: "channel", ch: 0 }),
      index,
      enabled: fx.enabled !== false,
      params: clone(fx.params || fx),
    };
  }

  global.JuceInstructionLibrary = {
    instrumentMap: INSTRUMENT_OPMAP,
    buildInstrumentSpec,
    buildMixerSpec,
    buildFxSpec,
  };
})(window);
