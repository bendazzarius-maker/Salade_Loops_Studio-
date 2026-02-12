/* ================= Electro DAW | inst_sampler_touski.js ================= */
(function () {
  window.__INSTRUMENTS__ = window.__INSTRUMENTS__ || {};

  const CACHE = new Map();
  let audioCtx = null;

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function midiToName(midi) {
    const idx = ((midi % 12) + 12) % 12;
    const oct = Math.floor(midi / 12) - 1;
    return `${NOTE_NAMES[idx]}${oct}`;
  }

  function getPrograms() {
    const api = window.sampleDirectory;
    if (!api || typeof api.listPrograms !== "function") return [];
    return api.listPrograms() || [];
  }

  function programOptions() {
    const programs = getPrograms();
    if (!programs.length) {
      return [{ value: "", label: "(Aucune programmation)" }];
    }
    return programs.map((p) => {
      const note = Number.isFinite(+p.rootMidi) ? midiToName(+p.rootMidi) : "—";
      return { value: String(p.id), label: `${p.name} • ${note}` };
    });
  }

  function defaultProgramId() {
    const programs = getPrograms();
    return programs[0]?.id || "";
  }

  function getProgram(programId) {
    const api = window.sampleDirectory;
    if (!api || typeof api.getProgram !== "function") return null;
    return api.getProgram(programId);
  }

  function sampleUrl(sample) {
    if (!sample?.path) return "";
    return `file://${encodeURI(String(sample.path).replace(/\\/g, "/"))}`;
  }

  function ensureCtx() {
    if (!audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    return audioCtx;
  }

  async function decodeProgramBuffer(program) {
    if (!program?.sample?.path) return null;
    const key = String(program.sample.path);
    if (CACHE.has(key)) return CACHE.get(key);

    const ctx = ensureCtx();
    if (!ctx) return null;
    const response = await fetch(sampleUrl(program.sample));
    const raw = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(raw.slice(0));
    CACHE.set(key, buffer);
    return buffer;
  }

  function makeSchema(paramsRef) {
    const selected = String(paramsRef?.programId || defaultProgramId());
    return {
      title: "Sampler Touski",
      sections: [
        {
          title: "Programmation",
          controls: [
            { type: "select", key: "programId", label: "Program", default: selected, options: programOptions() },
            { type: "slider", key: "gain", label: "Gain", min: 0, max: 1.6, step: 0.01 },
            { type: "slider", key: "attack", label: "Attack", min: 0.001, max: 0.2, step: 0.001, unit: "s" },
            { type: "slider", key: "release", label: "Release", min: 0.01, max: 2, step: 0.01, unit: "s" },
          ],
        },
      ],
    };
  }

  const DEF = {
    id: "SamplerTouski",
    name: "Sampler Touski",
    type: "sampler",
    color: "#70a7ff",
    defaultParams: function () {
      return {
        programId: defaultProgramId(),
        gain: 1,
        attack: 0.002,
        release: 0.18,
      };
    },
    uiSchema: function (paramsRef) {
      return makeSchema(paramsRef || {});
    },
    create: function (ae, paramsRef, outBus) {
      const ctx = ae.ctx;
      const common = {
        id: this.id,
        name: this.name,
        type: this.type,
        color: this.color,
        defaultParams: this.defaultParams,
        uiSchema: makeSchema(paramsRef || {}),
      };

      function trigger(t, midi, vel = 0.9, dur = 0.25) {
        const p = Object.assign({}, DEF.defaultParams(), paramsRef || {});
        const out = outBus || ae.master;
        const program = getProgram(p.programId);
        if (!program?.sample?.path) return;

        decodeProgramBuffer(program)
          .then((buffer) => {
            if (!buffer || !ctx) return;
            const rootMidi = Number.isFinite(+program.rootMidi) ? +program.rootMidi : 60;

            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.playbackRate.setValueAtTime(Math.pow(2, (midi - rootMidi) / 12), t);

            const g = ctx.createGain();
            const gain = Math.max(0.0001, (+p.gain || 1) * Math.max(0, Math.min(1, vel)));
            const atk = Math.max(0.001, +p.attack || 0.002);
            const rel = Math.max(0.01, +p.release || 0.18);
            const hold = Math.max(atk + 0.01, dur);

            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(gain, t + atk);
            g.gain.setValueAtTime(gain, t + hold);
            g.gain.linearRampToValueAtTime(0.0001, t + hold + rel);

            src.connect(g);
            g.connect(out);

            const startNorm = Math.max(0, Math.min(100, +program.loopStartPct || 0)) / 100;
            const endNorm = Math.max(startNorm + 0.01, Math.min(100, +program.loopEndPct || 100)) / 100;
            const startSec = buffer.duration * startNorm;
            const endSec = buffer.duration * endNorm;

            src.loop = true;
            src.loopStart = startSec;
            src.loopEnd = endSec;
            src.start(t, startSec);
            src.stop(t + hold + rel + 0.05);
          })
          .catch((error) => {
            console.warn("[Sampler Touski] playback decode error", error);
          });
      }

      return { ...common, trigger };
    },
  };

  window.__INSTRUMENTS__[DEF.name] = DEF;
})();
