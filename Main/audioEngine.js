/* ================= Electro DAW | audioEngine.js ================= */
class AudioEngine{
  constructor(){
    this.ctx = { currentTime: 0, state: "running" };
    this._clockStart = performance.now();
    this._timer = null;
    this._meterByCh = new Map();
    this._backendUnsub = null;
  }

  async ensure(){
    if (!this._timer) {
      this._timer = setInterval(() => {
        this.ctx.currentTime = (performance.now() - this._clockStart) / 1000;
      }, 15);
    }
    this.ctx.state = "running";

    if (window.audioBackend?.backends?.juce && !this._backendUnsub) {
      const juce = window.audioBackend.backends.juce;
      const prev = juce._evt?.bind(juce);
      juce._evt = (msg) => {
        if (typeof prev === "function") prev(msg);
        if (msg?.type === "evt" && msg.op === "meter.level") {
          const frames = Array.isArray(msg.data?.frames) ? msg.data.frames : [];
          for (const f of frames) this._meterByCh.set(Number(f.ch), f);
        }
      };
      await juce._request("meter.subscribe", { fps: 30, channels: [-1, ...Array.from({length:16}, (_,i)=>i)] }).catch(()=>{});
    }

    await window.audioBackend?.backends?.juce?._request?.("mixer.init", { channels: 16 }).catch(()=>{});
  }

  async applyMixerModel(model){
    if (!window.audioBackend?.backends?.juce || !model) return;
    const req = (op, data) => window.audioBackend.backends.juce._request(op, data).catch(()=>{});
    const m = model.master || {};
    req("mixer.master.set", { gain: Number(m.gain ?? 0.85), limiterEnabled: true });

    const channels = Array.isArray(model.channels) ? model.channels : [];
    channels.forEach((ch, i) => {
      req("mixer.channel.set", {
        ch: i,
        gain: Number(ch.gain ?? 0.85),
        pan: Number(ch.pan ?? 0),
        mute: !!ch.mute,
        solo: !!ch.solo,
      });
      req("fx.chain.set", {
        target: { scope: "channel", ch: i },
        chain: Array.isArray(ch.fx) ? ch.fx.map((fx, idx) => ({ id: String(fx.id || `${fx.type||'fx'}-${idx}`), type: String(fx.type||"eq3"), enabled: fx.enabled !== false })) : []
      });
    });

    req("fx.chain.set", {
      target: { scope: "master" },
      chain: Array.isArray(m.fx) ? m.fx.map((fx, idx) => ({ id: String(fx.id || `${fx.type||'fx'}-${idx}`), type: String(fx.type||"eq3"), enabled: fx.enabled !== false })) : []
    });
  }

  getMixerInput(){ return null; }
  addMixerChannel(){ return 16; }
  updateCrossfader(){ }

  _frameToSnapshot(frame){
    if (!frame) return { norm: 0, db: -60 };
    const peak = Array.isArray(frame.peak) ? Math.max(Math.abs(Number(frame.peak[0]||0)), Math.abs(Number(frame.peak[1]||0))) : 0;
    const db = peak > 1e-6 ? (20 * Math.log10(peak)) : -60;
    return { norm: Math.max(0, Math.min(1, peak)), db: Math.max(-60, db) };
  }

  getMasterMeterSnapshot(){ return this._frameToSnapshot(this._meterByCh.get(-1)); }
  getChannelMeterSnapshot(chIndex1){ return this._frameToSnapshot(this._meterByCh.get(Number(chIndex1)-1)); }
  getMasterMeterLevel(){ return this.getMasterMeterSnapshot().norm; }
  getChannelMeterLevel(chIndex1){ return this.getChannelMeterSnapshot(chIndex1).norm; }
}

const ae = new AudioEngine();
