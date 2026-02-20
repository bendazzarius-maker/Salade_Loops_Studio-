/* ================= Electro DAW | inst_sample_paterne.js ================= */
(function () {
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  let audioCtx = null;
  const BUFFER_CACHE = new Map();
  const SHIFT_CACHE = new Map();
  const safeRequire = (typeof window !== "undefined" && (window.require || null)) || (typeof require === "function" ? require : null);
  let PitchShifter = null;
  if (safeRequire) {
    try {
      PitchShifter = safeRequire("./pitchShifter");
    } catch (_error) {
      PitchShifter = null;
    }
  }

  function ensureCtx() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  function sampleUrl(path) {
    if (!path) return "";
    return `file://${encodeURI(String(path).replace(/\\/g, "/"))}`;
  }

  async function decodeSample(path) {
    const key = String(path || "");
    if (!key) return null;
    if (BUFFER_CACHE.has(key)) return BUFFER_CACHE.get(key);
    const ctx = ensureCtx();
    if (!ctx) return null;
    const response = await fetch(sampleUrl(key));
    const raw = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(raw.slice(0));
    BUFFER_CACHE.set(key, buffer);
    return buffer;
  }

  function clamp01(v, d = 0) {
    return Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : d));
  }

  function noteRatio(midi, rootMidi, pitchMode) {
    if (String(pitchMode) === "fixed") return 1;
    return Math.pow(2, ((+midi || 60) - (+rootMidi || 60)) / 12);
  }

  function copyMonoDataFromBuffer(buffer) {
    const source = buffer.getChannelData(0);
    const mono = new Float32Array(source.length);
    mono.set(source);
    return mono;
  }

  function buildBufferFromMono(ctx, monoData, sampleRate, channelCount) {
    const ch = Math.max(1, channelCount || 1);
    const out = ctx.createBuffer(ch, monoData.length, sampleRate);
    for (let c = 0; c < ch; c += 1) out.getChannelData(c).set(monoData);
    return out;
  }

  async function getPitchShiftedBuffer(path, sourceBuffer, pitchFactor) {
    if (!sourceBuffer || !PitchShifter) return sourceBuffer;
    if (!isFinite(pitchFactor) || pitchFactor <= 0) return sourceBuffer;
    if (Math.abs(pitchFactor - 1) < 1e-4) return sourceBuffer;

    const cacheKey = `${String(path || "")}::${pitchFactor.toFixed(8)}`;
    if (SHIFT_CACHE.has(cacheKey)) return SHIFT_CACHE.get(cacheKey);

    const shifter = new PitchShifter({
      fftSize: 2048,
      overlap: 0.75,
      hopSize: 512,
      sampleRate: sourceBuffer.sampleRate || 44100,
    });

    const mono = copyMonoDataFromBuffer(sourceBuffer);
    const shiftedMono = shifter.process(mono, pitchFactor);
    const shifted = buildBufferFromMono(ensureCtx(), shiftedMono, sourceBuffer.sampleRate || 44100, sourceBuffer.numberOfChannels || 1);
    SHIFT_CACHE.set(cacheKey, shifted);
    return shifted;
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
      const ctx = ae.ctx;
      const common = {
        id: this.id,
        name: this.name,
        type: this.type,
        color: this.color,
        defaultParams: this.defaultParams,
        uiSchema: makeSchema(),
      };

      function trigger(t, midi, vel = 0.9) {
        const p = Object.assign({}, DEF.defaultParams(), paramsRef || {});
        const out = outBus || ae.master;
        if (!p.samplePath) return;

        decodeSample(p.samplePath)
          .then(async (decodedBuffer) => {
            const pitchRate = noteRatio(midi, p.rootMidi, p.pitchMode);
            const useStrictPitchShift = String(p.pitchMode) === "chromatic" && !!PitchShifter;
            const buffer = useStrictPitchShift
              ? await getPitchShiftedBuffer(p.samplePath, decodedBuffer, pitchRate)
              : decodedBuffer;
            if (!buffer || !ctx) return;
            const source = ctx.createBufferSource();
            source.buffer = buffer;

            const startNorm = clamp01(p.startNorm, 0);
            const endNormRaw = clamp01(p.endNorm, 1);
            const endNorm = Math.max(startNorm + 0.001, endNormRaw);

            const startSec = startNorm * buffer.duration;
            const endSec = endNorm * buffer.duration;
            const loopLenSec = Math.max(0.01, endSec - startSec);

            source.loop = true;
            source.loopStart = startSec;
            source.loopEnd = endSec;

            const amp = ctx.createGain();
            const gain = Math.max(0.0001, (+p.gain || 1) * Math.max(0, Math.min(1, vel)));
            amp.gain.setValueAtTime(gain, t);

            source.connect(amp);
            amp.connect(out);

            const beatDur = (60 / state.bpm);
            const fixedDur = Math.max(1, Math.min(32, Math.floor(+p.patternBeats || 4))) * beatDur;

            // Stretch de la zone Start/End pour qu'un cycle complet corresponde
            // exactement à la longueur de pattern choisie dans l'éditeur.
            // NOTE: en mode chromatic, la variation de hauteur impacte aussi la durée.
            // Le stretch de base est donc calculé sur la longueur de pattern.
            const stretchRate = loopLenSec / Math.max(0.01, fixedDur);
            const pitchRate = noteRatio(midi, p.rootMidi, p.pitchMode);
            source.playbackRate.value = Math.max(0.02, Math.min(16, stretchRate * pitchRate));

            source.start(t, startSec);
            source.stop(t + Math.max(loopLenSec * 0.5, fixedDur));
          })
          .catch((error) => {
            console.warn("[Sample Paterne] decode fail", error);
          });
      }

      return Object.assign(common, { trigger });
    },
  };

  window.__INSTRUMENTS__[DEF.name] = DEF;
})();
