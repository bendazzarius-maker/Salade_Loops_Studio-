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

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function resolveNormalizedPositions(program) {
    const pos_action = Number.isFinite(+program?.posAction) ? clamp01(+program.posAction) : 0;
    const pos_loop_start = Number.isFinite(+program?.posLoopStart)
      ? clamp01(+program.posLoopStart)
      : clamp01((Number(program?.loopStartPct) || 15) / 100);
    const pos_loop_end = Number.isFinite(+program?.posLoopEnd)
      ? clamp01(+program.posLoopEnd)
      : clamp01((Number(program?.loopEndPct) || 90) / 100);
    const pos_release = Number.isFinite(+program?.posRelease) ? clamp01(+program.posRelease) : 1;

    const orderedLoopStart = Math.max(pos_action + 0.001, pos_loop_start);
    const orderedLoopEnd = Math.max(orderedLoopStart + 0.001, pos_loop_end);
    const orderedRelease = Math.max(orderedLoopEnd, pos_release);

    return {
      pos_action,
      pos_loop_start: Math.min(0.999, orderedLoopStart),
      pos_loop_end: Math.min(1, orderedLoopEnd),
      pos_release: Math.min(1, orderedRelease),
    };
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
            const playbackRate = Math.pow(2, (midi - rootMidi) / 12);
            const gain = Math.max(0.0001, (+p.gain || 1) * Math.max(0, Math.min(1, vel)));
            const atk = Math.max(0.001, +p.attack || 0.002);
            const rel = Math.max(0.01, +p.release || 0.18);
            const hold = Math.max(atk + 0.01, dur);
            const keyUpTime = t + hold;
            const fadeMs = 0.005;

            const positions = resolveNormalizedPositions(program);
            const actionSec = positions.pos_action * buffer.duration;
            const loopStartSec = positions.pos_loop_start * buffer.duration;
            const loopEndSec = positions.pos_loop_end * buffer.duration;
            const releaseSec = positions.pos_release * buffer.duration;
            const loopLenSec = Math.max(0.001, loopEndSec - loopStartSec);

            const amp = ctx.createGain();
            const sustainBus = ctx.createGain();
            const releaseBus = ctx.createGain();

            amp.gain.setValueAtTime(0.0001, t);
            amp.gain.linearRampToValueAtTime(gain, t + atk);
            amp.gain.setValueAtTime(gain, keyUpTime);
            amp.gain.linearRampToValueAtTime(0.0001, keyUpTime + rel);

            sustainBus.gain.setValueAtTime(1, t);
            sustainBus.gain.setValueAtTime(1, keyUpTime);
            sustainBus.gain.linearRampToValueAtTime(0.0001, keyUpTime + fadeMs);

            releaseBus.gain.setValueAtTime(0.0001, t);
            releaseBus.gain.setValueAtTime(0.0001, keyUpTime - fadeMs);
            releaseBus.gain.linearRampToValueAtTime(1, keyUpTime + fadeMs);

            amp.connect(out);
            sustainBus.connect(amp);
            releaseBus.connect(amp);

            const sustainSrc = ctx.createBufferSource();
            sustainSrc.buffer = buffer;
            sustainSrc.playbackRate.setValueAtTime(playbackRate, t);
            sustainSrc.loop = true;
            sustainSrc.loopStart = loopStartSec;
            sustainSrc.loopEnd = loopEndSec;
            sustainSrc.connect(sustainBus);
            sustainSrc.start(t, actionSec);
            sustainSrc.stop(keyUpTime + fadeMs + 0.02);

            const elapsedSampleSec = Math.max(0, (keyUpTime - t) * playbackRate);
            let releaseStartSec = actionSec + elapsedSampleSec;
            if (releaseStartSec >= loopStartSec) {
              const loopElapsed = (releaseStartSec - loopStartSec) % loopLenSec;
              releaseStartSec = loopStartSec + loopElapsed;
            }

            const clippedReleaseStart = Math.min(Math.max(actionSec, releaseStartSec), releaseSec);
            const releaseDurationSec = (releaseSec - clippedReleaseStart) / playbackRate;
            if (releaseDurationSec > 0.001) {
              const releaseSrc = ctx.createBufferSource();
              releaseSrc.buffer = buffer;
              releaseSrc.playbackRate.setValueAtTime(playbackRate, keyUpTime);
              releaseSrc.connect(releaseBus);
              releaseSrc.start(keyUpTime, clippedReleaseStart);
              releaseSrc.stop(keyUpTime + releaseDurationSec + rel + 0.02);
            }
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
