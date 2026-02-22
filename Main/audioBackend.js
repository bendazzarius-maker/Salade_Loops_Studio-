/* ================= Electro DAW | audioBackend.js ================= */
/* ---------------- unified backend switch (WebAudio / JUCE IPC) ---------------- */

(function initAudioBackendGlobal() {
  const PROTOCOL = "SLS-IPC/1.0";

  function nowMs() { return Date.now(); }
  function rid() { return `req-${nowMs()}-${Math.random().toString(36).slice(2, 8)}`; }

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

    async setConfig(cfg) { return this._request("engine.setConfig", cfg || {}); }
    async setBpm(bpm) { return this._request("transport.setTempo", { bpm }); }
    async play() { return this._request("transport.play", {}); }
    async stop() { return this._request("transport.stop", { panic: true }); }
    async seek(ppq = 0) { return this._request("transport.seek", { mode: "ppq", ppq }); }
    async panic() { return this._request("midi.panic", {}); }
    async sendProjectSync(snapshot) { return this._request("project.sync", snapshot || {}); }

    triggerNote({ note, velocity = 0.85, trackId = "preview", durationSec = 0.25 }) {
      const channel = 0;
      const startReq = this._request("midi.noteOn", {
        trackId, channel, note, velocity, when: "now"
      });
      setTimeout(() => {
        this._request("midi.noteOff", { trackId, channel, note, when: "now" }).catch(() => {});
      }, Math.max(20, Math.floor(durationSec * 1000)));
      return startReq;
    }
  }

  class AudioBackendController {
    constructor() {
      this.backends = {
        webaudio: new AudioBackendWebAudio(),
        juce: new AudioBackendJUCE(),
      };
      this.active = "webaudio";
      this.preferred = state.audioBackend || "webaudio";
      state.audioBackend = this.preferred;
    }

    async init() {
      if (this.preferred === "juce") {
        const ok = await this.trySwitch("juce");
        if (!ok) await this.trySwitch("webaudio");
      } else {
        await this.trySwitch("webaudio");
      }
    }

    getActiveBackendName() { return this.active; }

    async trySwitch(name) {
      const key = (name === "juce") ? "juce" : "webaudio";
      const backend = this.backends[key];
      try {
        await backend.init();
        this.active = key;
        state.audioBackend = key;
        window.dispatchEvent(new CustomEvent("audio:backend", { detail: { active: key } }));
        return true;
      } catch (e) {
        console.warn(`[AudioBackend] Failed to init ${key}:`, e?.message || e);
        if (key !== "webaudio") {
          this.active = "webaudio";
          state.audioBackend = "webaudio";
        }
        return false;
      }
    }

    async requestBackend(name) {
      this.preferred = (name === "juce") ? "juce" : "webaudio";
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
      if (this.active !== "juce") {
        this.backends.webaudio.triggerNote(payload);
        return;
      }
      const res = await this.backends.juce.triggerNote(payload);
      if (!res?.ok) {
        await this.trySwitch("webaudio");
        this.backends.webaudio.triggerNote(payload);
      }
    }
  }

  window.AudioBackendController = AudioBackendController;
})();
