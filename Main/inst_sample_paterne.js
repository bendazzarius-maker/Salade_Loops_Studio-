/* ================= Electro DAW | inst_sample_paterne.js ================= */
(function () {
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const BUFFER_CACHE_BY_CTX = new WeakMap();
  let backendWarned = false;
  let busContextWarned = false;

  function clamp01(v, d = 0) {
    return Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : d));
  }

  function sampleUrl(samplePath) {
    return `file://${encodeURI(String(samplePath || "").replace(/\\/g, "/"))}`;
  }

  function getCtxCache(ctx) {
    if (!ctx) return null;
    if (!BUFFER_CACHE_BY_CTX.has(ctx)) BUFFER_CACHE_BY_CTX.set(ctx, new Map());
    return BUFFER_CACHE_BY_CTX.get(ctx);
  }

  async function getDecodedBuffer(ctx, samplePath) {
    const key = String(samplePath || "").trim();
    if (!ctx || !key) return null;

    const cache = getCtxCache(ctx);
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const response = await fetch(sampleUrl(key));
        const raw = await response.arrayBuffer();
        return ctx.decodeAudioData(raw.slice(0));
      })());
    }

    return cache.get(key);
  }

  function resolveOutputNode(ctx, outBus) {
    if (outBus && typeof outBus.connect === "function" && outBus.context === ctx) return outBus;
    if (outBus && !busContextWarned) {
      busContextWarned = true;
      console.warn("[Sample Paterne] outBus context mismatch: fallback ctx.destination.");
    }
    return ctx.destination;
  }

  async function renderSamplePatternWebAudio(ctx, channel, noteEvent, time, outBus) {
    const params = (channel && channel.params) ? channel.params : {};
    if (!ctx || !params.samplePath) return;

    const buffer = await getDecodedBuffer(ctx, params.samplePath);
    if (!buffer) return;

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
    amp.connect(resolveOutputNode(ctx, outBus));

    player.start(time, loopStart);
    player.stop(time + duration + 0.02);
  }

  async function triggerSamplePattern(ctx, channel, noteEvent, time, outBus) {
    const backend = window.audioBackend;
    const params = (channel && channel.params) ? channel.params : {};
    const active = backend && typeof backend.getActiveBackendName === "function"
      ? backend.getActiveBackendName()
      : "webaudio";

    if (active === "juce" && backend && typeof backend.triggerSample === "function") {
      await backend.triggerSample({
        samplePath: params.samplePath,
        startNorm: params.startNorm,
        endNorm: params.endNorm,
        rootMidi: params.rootMidi,
        gain: params.gain,
        note: +noteEvent.midi || 60,
        velocity: Math.max(0, Math.min(1, +noteEvent.vel || 0.9)),
        durationSec: Math.max(0.01, Number(noteEvent.duration) || 0.25),
        trackId: "sample-pattern-preview",
      });
      return;
    }

    if (!backendWarned) {
      backendWarned = true;
      console.warn("[Sample Paterne] JUCE indisponible: fallback WebAudio local.");
    }
    await renderSamplePatternWebAudio(ctx, channel, noteEvent, time, outBus);
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
          ae.ctx,
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
