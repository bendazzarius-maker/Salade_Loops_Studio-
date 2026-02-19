/* ================= Electro DAW | inst_sample_paterne.js ================= */
(function () {
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const safeRequire = (typeof window !== "undefined" && (window.require || null)) || (typeof require === "function" ? require : null);
  let PitchShifter = null;
  if (safeRequire) {
    try {
      PitchShifter = safeRequire("./pitchShifter");
    } catch (_error) {
      PitchShifter = null;
    }
  }

  let audioCtx = null;
  const BUFFER_CACHE = new Map();
  const PROCESS_CACHE = new Map();

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

  function extractMonoSegment(buffer, startNorm, endNorm) {
    const data = buffer.getChannelData(0);
    const startIndex = Math.max(0, Math.min(data.length - 2, Math.floor(startNorm * (data.length - 1))));
    const endIndex = Math.max(startIndex + 1, Math.min(data.length - 1, Math.floor(endNorm * (data.length - 1))));
    const mono = new Float32Array(Math.max(1, endIndex - startIndex));
    mono.set(data.subarray(startIndex, endIndex));
    return mono;
  }

  function buildBufferFromMono(ctx, monoData, sampleRate, channelCount) {
    const ch = Math.max(1, channelCount || 1);
    const out = ctx.createBuffer(ch, monoData.length, sampleRate);
    for (let c = 0; c < ch; c += 1) out.getChannelData(c).set(monoData);
    return out;
  }

  function buildProcessKey(path, params, midi, bpm, stretchRate, pitchCompFactor) {
    return [
      String(path || ""),
      (Number(params.startNorm) || 0).toFixed(5),
      (Number(params.endNorm) || 1).toFixed(5),
      Math.max(1, Math.min(32, Math.floor(+params.patternBeats || 4))),
      (Number(bpm) || 120).toFixed(3),
      Number(midi) || 60,
      (Number(stretchRate) || 1).toFixed(6),
      (Number(pitchCompFactor) || 1).toFixed(6),
      Number(params.rootMidi) || 60,
      String(params.pitchMode || "chromatic"),
    ].join("::");
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

        const beats = Math.max(1, Math.min(32, Math.floor(+p.patternBeats || 4)));
        const beatDur = 60 / Math.max(20, +state.bpm || 120);
        const targetDurSec = beats * beatDur;

        decodeSample(p.samplePath)
          .then((decodedBuffer) => {
            if (!decodedBuffer || !ctx) return;

            const startNorm = clamp01(p.startNorm, 0);
            const endNormRaw = clamp01(p.endNorm, 1);
            const endNorm = Math.max(startNorm + 0.001, endNormRaw);
            const segmentDurSec = Math.max(0.01, (endNorm - startNorm) * decodedBuffer.duration);

            const stretchRate = Math.max(0.25, Math.min(4, segmentDurSec / Math.max(0.01, targetDurSec)));
            const tonalRatio = noteRatio(midi, p.rootMidi, p.pitchMode);
            const pitchCompFactor = tonalRatio / stretchRate;
            const processKey = buildProcessKey(p.samplePath, p, midi, state.bpm, stretchRate, pitchCompFactor);

            let segmentBufferPromise = PROCESS_CACHE.get(processKey);
            if (!segmentBufferPromise) {
              segmentBufferPromise = Promise.resolve().then(() => {
                const monoSeg = extractMonoSegment(decodedBuffer, startNorm, endNorm);
                const canShift = PitchShifter && isFinite(pitchCompFactor) && Math.abs(pitchCompFactor - 1) > 0.001;
                let processedMono = monoSeg;
                if (canShift) {
                  const shifter = new PitchShifter({
                    fftSize: 2048,
                    overlap: 0.75,
                    hopSize: 512,
                    sampleRate: decodedBuffer.sampleRate || 44100,
                  });
                  processedMono = shifter.process(monoSeg, pitchCompFactor);
                }
                return buildBufferFromMono(ctx, processedMono, decodedBuffer.sampleRate || 44100, decodedBuffer.numberOfChannels || 1);
              });
              PROCESS_CACHE.set(processKey, segmentBufferPromise);
            }

            return segmentBufferPromise.then((segmentBuffer) => {
              const source = ctx.createBufferSource();
              source.buffer = segmentBuffer;
              source.playbackRate.value = stretchRate;

              const amp = ctx.createGain();
              const gain = Math.max(0.0001, (+p.gain || 1) * Math.max(0, Math.min(1, vel)));
              amp.gain.setValueAtTime(gain, t);

              source.connect(amp);
              amp.connect(out);

              source.start(t, 0, Math.max(0.01, segmentBuffer.duration));
              source.stop(t + targetDurSec + 0.01);
            });
          })
          .catch((error) => {
            console.warn("[Sample Paterne] decode/stretch fail", error);
          });
      }

      return Object.assign(common, { trigger });
    },
  };

  window.__INSTRUMENTS__[DEF.name] = DEF;
})();
