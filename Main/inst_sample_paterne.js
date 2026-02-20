/* ================= Electro DAW | inst_sample_paterne.js ================= */
(function () {
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const BUFFER_CACHE = new Map();
  const RAW_CACHE = new Map();
  const safeRequire = (typeof window !== "undefined" && (window.require || null)) || (typeof require === "function" ? require : null);
  let ToneLib = (typeof window !== "undefined" && window.Tone) ? window.Tone : null;
  let toneMissingWarned = false;

  function audioDebugPush(message) {
    try {
      if (!window.__SL_AUDIO_DEBUG__ || typeof window.__SL_AUDIO_DEBUG__.push !== "function") return;
      window.__SL_AUDIO_DEBUG__.push(String(message || ""));
    } catch (_) {}
  }

  if (safeRequire) {
    try {
      ToneLib = ToneLib || safeRequire("tone");
    } catch (_error) {
      ToneLib = ToneLib || null;
    }
  }

  function clamp01(v, d = 0) {
    return Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : d));
  }

  function sampleUrl(path) {
    if (!path) return "";
    return `file://${encodeURI(String(path).replace(/\\/g, "/"))}`;
  }

  function fetchRawSample(samplePath) {
    const key = String(samplePath || "");
    if (!key) return Promise.resolve(null);
    if (!RAW_CACHE.has(key)) {
      RAW_CACHE.set(key, fetch(sampleUrl(key)).then((response) => response.arrayBuffer()));
    }
    return RAW_CACHE.get(key);
  }

  async function getToneBuffer(samplePath) {
    const key = `tone::${String(samplePath || "")}`;
    if (!samplePath || !ToneLib || !ToneLib.ToneAudioBuffer) return null;
    if (!BUFFER_CACHE.has(key)) {
      BUFFER_CACHE.set(key, new Promise((resolve, reject) => {
        try {
          const b = new ToneLib.ToneAudioBuffer(samplePath, () => resolve(b), reject);
        } catch (error) {
          reject(error);
        }
      }));
    }
    return BUFFER_CACHE.get(key);
  }

  async function getNativeBuffer(samplePath, ctx) {
    const key = `native::${String(samplePath || "")}`;
    if (!samplePath || !ctx) return null;
    if (!BUFFER_CACHE.has(key)) {
      BUFFER_CACHE.set(key, fetchRawSample(samplePath).then((raw) => {
        if (!raw) return null;
        return ctx.decodeAudioData(raw.slice(0));
      }));
    }
    return BUFFER_CACHE.get(key);
  }

  function renderSamplePattern(channel, noteEvent, time, outBus) {
    const params = (channel && channel.params) ? channel.params : {};
    if (!params.samplePath) return Promise.resolve();

    const startNorm = clamp01(params.startNorm, 0);
    const endNormRaw = clamp01(params.endNorm, 1);
    const endNorm = Math.max(startNorm + 0.001, endNormRaw);
    const detune = ((+noteEvent.midi || 60) - (+params.rootMidi || 60)) * 100;

    if (ToneLib && ToneLib.GrainPlayer) {
      return getToneBuffer(params.samplePath)
        .then((toneBuffer) => {
          if (!toneBuffer || !toneBuffer.duration) return;

          const loopStart = startNorm * toneBuffer.duration;
          const loopEnd = endNorm * toneBuffer.duration;
          const loopLen = Math.max(0.01, loopEnd - loopStart);
          const duration = Math.max(0.01, Number(noteEvent.duration) || loopLen);
          const offset = loopStart;

          const player = new ToneLib.GrainPlayer({
            url: toneBuffer,
            loop: true,
            loopStart,
            loopEnd,
            grainSize: 0.1,
            overlap: 0.05,
            detune,
            playbackRate: 1,
          });

          const gain = Math.max(0.0001, (+params.gain || 1) * Math.max(0, Math.min(1, +noteEvent.vel || 0.9)));
          const amp = new ToneLib.Gain(gain);
          player.connect(amp);
          if (outBus && typeof outBus.connect === "function") amp.connect(outBus);
          else amp.toDestination();

          player.start(time, offset, duration);
          player.stop(time + duration + 0.02);
          player.onstop = function () {
            try {
              player.dispose();
              amp.dispose();
            } catch (_) {}
          };
        });
    }

    if (!toneMissingWarned) {
      toneMissingWarned = true;
      const msg = "[Sample Paterne] Tone.js indisponible: fallback WebAudio activé.";
      console.warn(msg);
      audioDebugPush(msg);
    }

    const ctx = channel && channel.ae && channel.ae.ctx;
    if (!ctx) return Promise.resolve();

    return getNativeBuffer(params.samplePath, ctx).then((buffer) => {
      if (!buffer) return;
      const loopStart = startNorm * buffer.duration;
      const loopEnd = endNorm * buffer.duration;
      const loopLen = Math.max(0.01, loopEnd - loopStart);
      const duration = Math.max(0.01, Number(noteEvent.duration) || loopLen);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
      source.detune.setValueAtTime(detune, time);
      source.playbackRate.setValueAtTime(1, time);

      const gainNode = ctx.createGain();
      const gain = Math.max(0.0001, (+params.gain || 1) * Math.max(0, Math.min(1, +noteEvent.vel || 0.9)));
      gainNode.gain.setValueAtTime(gain, time);

      source.connect(gainNode);
      gainNode.connect(outBus || ctx.destination);

      source.start(time, loopStart, duration);
      source.stop(time + duration + 0.02);
    });
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

        renderSamplePattern(
          { params: p, ae },
          { midi, vel, duration },
          t,
          out
        ).catch((error) => {
          const msg = `[Sample Paterne] lecture impossible: ${error && error.message ? error.message : error}`;
          console.warn(msg);
          audioDebugPush(msg);
        });
      }

      return Object.assign(common, { trigger });
    },
  };

  window.__INSTRUMENTS__[DEF.name] = DEF;
})();
