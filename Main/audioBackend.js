/* ================= Electro DAW | audioBackend.js ================= */
/* ---------------- production backend switch (JUCE IPC default) ---------------- */

(function initAudioBackendGlobal() {
  const PROTOCOL = "SLS-IPC/1.0";

  function nowMs() { return Date.now(); }
  function rid() { return `req-${nowMs()}-${Math.random().toString(36).slice(2, 8)}`; }
  function hashSamplePath(path) {
    const s = String(path || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `sp_${(h >>> 0).toString(16)}`;
  }

  const DEV_ENABLE_WEBAUDIO_FALLBACK = false;

  class AudioBackendWebAudio {
    constructor() {
      this.name = "webaudio";
    }

    async init() {
      await ae.ensure();
      return { ok: true };
    }

    async setBpm() { return { ok: true }; }
    async play() { return { ok: true }; }
    async stop() { return { ok: true }; }
    async seek() { return { ok: true }; }
    async panic() { return { ok: true }; }
    async sendProjectSync() { return { ok: true }; }

    triggerNote({ trigger }) {
      if (typeof trigger === "function") trigger();
      return { ok: true };
    }
  }

  class AudioBackendJUCE {
    constructor() {
      this.name = "juce";
      this.ready = false;
      this.capabilities = {};
      this.transportState = { playing: false, bpm: 120, ppq: 0, samplePos: 0 };
      this._unsubscribeEvt = null;
      this._loadedSampleIds = new Set();
    }

    _buildReq(op, data = {}) {
      return { v: 1, type: "req", op, id: rid(), ts: nowMs(), data };
    }

    async _request(op, data = {}) {
      if (!window.audioNative?.request) throw new Error("audioNative bridge unavailable");
      return window.audioNative.request(this._buildReq(op, data));
    }

    _evt(msg) {
      if (!msg || msg.type !== "evt") return;
      if (msg.op === "transport.state") {
        this.transportState = { ...this.transportState, ...(msg.data || {}) };
      }
    }

    async init() {
      const avail = await window.audioNative?.isAvailable?.();
      if (!avail?.ok) throw new Error("JUCE process unavailable");

      if (!this._unsubscribeEvt && window.audioNative?.onEvent) {
        this._unsubscribeEvt = window.audioNative.onEvent((msg) => this._evt(msg));
      }

      const hello = await this._request("engine.hello", {});
      if (!hello?.ok) throw new Error(hello?.err?.message || "engine.hello failed");
      if (hello?.data?.protocol !== PROTOCOL) {
        throw new Error(`Invalid protocol (${hello?.data?.protocol || "unknown"})`);
      }

      const ping = await this._request("engine.ping", { nonce: rid() });
      if (!ping?.ok) throw new Error(ping?.err?.message || "engine.ping failed");

      this.capabilities = hello.data?.capabilities || {};
      this.ready = true;
      return { ok: true };
    }

    async setConfig(cfg) { return this._request("engine.config.set", cfg || {}); }
    async setBpm(bpm) { return this._request("transport.setTempo", { bpm }); }
    async play() { return this._request("transport.play", {}); }
    async stop() { return this._request("transport.stop", { panic: true }); }
    async seek(ppq = 0) { return this._request("transport.seek", { mode: "ppq", ppq }); }
    async panic() { return this._request("note.allOff", {}); }
    async sendProjectSync(snapshot) { return this._request("project.sync", snapshot || {}); }

    async ensureSampleLoaded(samplePath) {
      const path = String(samplePath || "").trim();
      if (!path) throw new Error("Missing samplePath");
      const sampleId = hashSamplePath(path);
      if (this._loadedSampleIds.has(sampleId)) return sampleId;
      const res = await this._request("sampler.load", { sampleId, path });
      if (!res?.ok) throw new Error(res?.err?.message || "sampler.load failed");
      this._loadedSampleIds.add(sampleId);
      return sampleId;
    }

    async triggerSample(payload = {}) {
      const sampleId = await this.ensureSampleLoaded(payload.samplePath);
      const pitchMode = String(payload.pitchMode || "chromatic").toLowerCase();
      const mode = (pitchMode === "fixed") ? "fixed" : "fit_duration_vinyl";
      return this._request("sampler.trigger", {
        trackId: String(payload.trackId || "sample-pattern"),
        sampleId,
        gain: Number.isFinite(+payload.gain) ? +payload.gain : 1,
        pan: Number.isFinite(+payload.pan) ? +payload.pan : 0,
        startNorm: Number.isFinite(+payload.startNorm) ? +payload.startNorm : 0,
        endNorm: Number.isFinite(+payload.endNorm) ? +payload.endNorm : 1,
        rootMidi: Number.isFinite(+payload.rootMidi) ? +payload.rootMidi : 60,
        note: Number.isFinite(+payload.note) ? +payload.note : 60,
        velocity: Number.isFinite(+payload.velocity) ? +payload.velocity : 0.85,
        mode,
        durationSec: Number.isFinite(+payload.durationSec) ? +payload.durationSec : 0,
        patternSteps: Number.isFinite(+payload.patternSteps) ? +payload.patternSteps : 0,
        patternBeats: Number.isFinite(+payload.patternBeats) ? +payload.patternBeats : 0,
        bpm: Number.isFinite(+payload.bpm) ? +payload.bpm : undefined,
        mixCh: Number.isFinite(+payload.mixCh) ? +payload.mixCh : 1,
        when: "now",
      });
    }

    async triggerNote({ note, velocity = 0.85, trackId = "preview", durationSec = 0.25, instId = "global", instType = "piano", params = {}, mixCh = 1 }) {
      const channel = 0;
      const safeInstId = String(instId || "global");
      const safeType = String(instType || "piano");
      await this._request("inst.create", { instId: safeInstId, type: safeType, ch: 0 });
      const safeParams = (params && typeof params === "object") ? params : {};
      const juceSpec = window.JuceInstructionLibrary?.buildInstrumentSpec?.({ name: safeType, params: safeParams, instId: safeInstId, trackId }) || null;
      await this._request("inst.param.set", { instId: safeInstId, type: safeType, params: safeParams, juceSpec });
      const startReq = this._request("note.on", {
        trackId, channel, instId: safeInstId, mixCh: Number(mixCh || 1), note, velocity, when: "now"
      });
      setTimeout(() => {
        this._request("note.off", { trackId, channel, instId: safeInstId, mixCh: Number(mixCh || 1), note, when: "now" }).catch(() => {});
      }, Math.max(20, Math.floor(durationSec * 1000)));
      return startReq;
    }
  }

  class AudioBackendController {
    constructor() {
      this.backends = { juce: new AudioBackendJUCE() };
      if (DEV_ENABLE_WEBAUDIO_FALLBACK) this.backends.webaudio = new AudioBackendWebAudio();
      this.active = "juce";
      this.preferred = "juce";
      state.audioBackend = this.preferred;
    }

    async init() {
      const ok = await this.trySwitch("juce");
      if (!ok && DEV_ENABLE_WEBAUDIO_FALLBACK) {
        await this.trySwitch("webaudio");
      }
    }

    getActiveBackendName() { return this.active; }

    async trySwitch(name) {
      const key = (name === "juce") ? "juce" : "webaudio";
      const backend = this.backends[key];
      if (!backend) return false;
      try {
        await backend.init();
        this.active = key;
        state.audioBackend = key;
        window.dispatchEvent(new CustomEvent("audio:backend", { detail: { active: key } }));
        return true;
      } catch (e) {
        console.warn(`[AudioBackend] Failed to init ${key}:`, e?.message || e);
        if (key !== "webaudio" && DEV_ENABLE_WEBAUDIO_FALLBACK) {
          this.active = "webaudio";
          state.audioBackend = "webaudio";
        }
        return false;
      }
    }

    async requestBackend(name) {
      this.preferred = (name === "juce") ? "juce" : (DEV_ENABLE_WEBAUDIO_FALLBACK ? "webaudio" : "juce");
      return this.trySwitch(this.preferred);
    }

    async setBpm(bpm) {
      if (this.active === "juce") {
        const res = await this.backends.juce.setBpm(bpm);
        if (!res?.ok) await this.trySwitch("webaudio");
      }
    }

    async play(projectSnapshotBuilder) {
      if (this.active !== "juce") return;
      if (typeof projectSnapshotBuilder === "function") {
        const snapshot = projectSnapshotBuilder();
        const syncRes = await this.backends.juce.sendProjectSync(snapshot);
        if (!syncRes?.ok) {
          await this.trySwitch("webaudio");
          return;
        }
      }
      const res = await this.backends.juce.play();
      if (!res?.ok) await this.trySwitch("webaudio");
    }

    async stop() {
      if (this.active !== "juce") return;
      const res = await this.backends.juce.stop();
      if (!res?.ok) await this.trySwitch("webaudio");
    }

    async triggerNote(payload) {
      if (this.active !== "juce") return;
      const res = await this.backends.juce.triggerNote(payload);
      if (!res?.ok) {
        if (DEV_ENABLE_WEBAUDIO_FALLBACK) await this.trySwitch("webaudio");
      }
    }

    async triggerSample(payload) {
      if (this.active !== "juce") return;
      const res = await this.backends.juce.triggerSample(payload);
      if (!res?.ok) {
        if (DEV_ENABLE_WEBAUDIO_FALLBACK) await this.trySwitch("webaudio");
      }
    }
  }

  window.AudioBackendController = AudioBackendController;
})();
