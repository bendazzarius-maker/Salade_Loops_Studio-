/* ================= Electro DAW | inst_sample_paterne.js ================= */
(function () {
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const BUFFER_CACHE = new Map();
  let audioCtx = null;
  let backendWarned = false;

  function clamp01(v, d = 0) {
    return Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : d));
  }

  function ensureCtx() {
    // Prefer Tone.js context if present to avoid cross-context connect errors
    try {
      if (window.Tone && typeof Tone.getContext === "function") {
        const tctx = Tone.getContext();
        if (tctx && tctx.rawContext) return tctx.rawContext;
      }
      if (window.Tone && Tone.context && Tone.context.rawContext) return Tone.context.rawContext;
    } catch (_) {}

    // Singleton WebAudio context for this module
    if (audioCtx) return audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (window.__SLS_SAMPLEPATTERN_CTX) {
      audioCtx = window.__SLS_SAMPLEPATTERN_CTX;
      return audioCtx;
    }
    audioCtx = new Ctor();
    window.__SLS_SAMPLEPATTERN_CTX = audioCtx;
    return audioCtx;
  }

  function sampleUrl(samplePath) {
    return `file://${encodeURI(String(samplePath || "").replace(/\\/g, "/"))}`;
  }

  async function getDecodedBuffer(samplePath) {
    const key = String(samplePath || "").trim();
    if (!key) return null;
    if (!BUFFER_CACHE.has(key)) {
      BUFFER_CACHE.set(key, (async () => {
        const ctx = ensureCtx();
        if (!ctx) return null;
        const response = await fetch(sampleUrl(key));
        const raw = await response.arrayBuffer();
        return ctx.decodeAudioData(raw.slice(0));
      })());
    }

    return BUFFER_CACHE.get(key);
  }

  async function renderSamplePatternWebAudio(channel, noteEvent, time, outBus) {
    const params = (channel && channel.params) ? channel.params : {};
    if (!params.samplePath) return;
    const buffer = await getDecodedBuffer(params.samplePath);
    const ctx = ensureCtx();
    if (!buffer || !ctx) return;

    const startNorm = clamp01(params.startNorm, 0);
    const endNormRaw = clamp01(params.endNorm, 1);
    const endNorm = Math.max(startNorm + 0.001, endNormRaw);

    const loopStart = startNorm * buffer.duration;
    const loopEnd = endNorm * buffer.duration;
    const loopLen = Math.max(0.01, loopEnd - loopStart);

    const detune = ((+noteEvent.midi || 60) - (+params.rootMidi || 60)) * 100;
    const duration = Math.max(0.01, Number(noteEvent.duration) || loopLen);

    const player = ctx.createBufferSource();
    player.buffer = buffer;
    player.loop = true;
    player.loopStart = loopStart;
    player.loopEnd = loopEnd;
    player.detune.setValueAtTime(detune, time);

    const gain = Math.max(0.0001, (+params.gain || 1) * Math.max(0, Math.min(1, +noteEvent.vel || 0.9)));
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, time);

    player.connect(amp);
    if (outBus && typeof outBus.connect === "function" && outBus.context === ctx) amp.connect(outBus);
    else amp.connect(ctx.destination);

    player.start(time, loopStart);
    player.stop(time + duration + 0.02);
  }

  async function triggerSamplePattern(channel, noteEvent, time, outBus) {
    const backend = window.audioBackend;
    const active = backend && typeof backend.getActiveBackendName === "function"
      ? backend.getActiveBackendName()
      : "webaudio";

    if (active === "juce" && backend && typeof backend.triggerSample === "function") {
      const params = (channel && channel.params) ? channel.params : {};
      await backend.triggerSample({
        trackId: "sample-pattern-preview",
        samplePath: String(params.samplePath || ""),
        startNorm: clamp01(params.startNorm, 0),
        endNorm: clamp01(params.endNorm, 1),
        gain: Math.max(0, +params.gain || 1),
        pan: Math.max(-1, Math.min(1, +params.pan || 0)),
        rootMidi: +params.rootMidi || 60,
        note: +noteEvent.midi || 60,
        velocity: Math.max(0, Math.min(1, +noteEvent.vel || 0.9)),
        when: "now"
      });
      return;
    }

    if (!backendWarned) {
      backendWarned = true;
      console.warn("[Sample Paterne] JUCE indisponible: fallback WebAudio local.");
    }
    await renderSamplePatternWebAudio(channel, noteEvent, time, outBus);
  }

  function makeSchema() {
    return {
      title: "Sample Paterne",
      sections: [
        {
          title: "Lecteur paterne",
          controls: [
            { type: "text", key: "samplePath", label: "Sample path" },
            { type: "slider", key: "startNorm", label: "Start", min: 0, max: 1, step: 0.001 },
            { type: "slider", key: "endNorm", label: "End", min: 0.01, max: 1, step: 0.001 },
            { type: "slider", key: "patternBeats", label: "Pattern Beats", min: 1, max: 32, step: 1 },
            { type: "slider", key: "rootMidi", label: "Root MIDI", min: 24, max: 96, step: 1 },
            {
              type: "select",
              key: "pitchMode",
              label: "Pitch",
              options: [
                { value: "chromatic", label: "Chromatique" },
                { value: "fixed", label: "Fixe" },
              ],
            },
            { type: "slider", key: "gain", label: "Gain", min: 0, max: 1.6, step: 0.01 },
          ],
        },
      ],
    };
  }

  const DEF = {
    id: "SamplePaterne",
    name: "Sample Paterne",
    type: "sampler",
    color: "#b28dff",
    defaultParams: function () {
      return {
        samplePath: "",
        startNorm: 0,
        endNorm: 1,
        patternBeats: 4,
        rootMidi: 60,
        pitchMode: "chromatic",
        gain: 1,
      };
    },
    uiSchema: function () {
      return makeSchema();
    },
    create: function (ae, paramsRef, outBus) {
      const common = {
        id: this.id,
        name: this.name,
        type: this.type,
        color: this.color,
        defaultParams: this.defaultParams,
        uiSchema: makeSchema(),
      };

      function trigger(t, midi, vel = 0.9, durSec) {
        const p = Object.assign({}, DEF.defaultParams(), paramsRef || {});
        const out = outBus || ae.master;
        const duration = Math.max(0.01, durSec || ((60 / state.bpm) * Math.max(1, Math.floor(+p.patternBeats || 4))));
        triggerSamplePattern(
          { params: p },
          { midi, vel, duration },
          t,
          out
        )
          .catch((error) => {
            console.warn("[Sample Paterne] trigger fail", error);
          });
      }

      return Object.assign(common, { trigger });
    },
  };

  window.__INSTRUMENTS__[DEF.name] = DEF;
  window.__INSTRUMENTS__[DEF.id] = DEF;
  window.__INSTRUMENTS__["Sample Pattern"] = DEF;
  window.__INSTRUMENTS__["SamplePaterne"] = DEF;
})();
