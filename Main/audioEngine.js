/* ================= Electro DAW | audioEngine.js ================= */
class AudioEngine{
  constructor(){
    this.ctx = { currentTime: 0, state: "running" };
    this._clockStart = performance.now();
    this._timer = null;
    this._meterByCh = new Map();
    this._backendUnsub = null;
    this._mixerFlushTimer = null;
    this._pendingMixerModel = null;
    this._lastMixerSnapshot = null;
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

  _requestNoThrow(op, data){
    return window.audioBackend.backends.juce._request(op, data).catch(()=>{});
  }

  _normalizeFxChain(fxList = []){
    return fxList.map((fx, idx) => ({
      id: String(fx.id || `${fx.type||"fx"}-${idx}`),
      type: String(fx.type || "eq3"),
      enabled: fx.enabled !== false,
      params: fx.params || {},
      source: fx,
      idx,
    }));
  }

  _xAssignToNumber(xAssign){
    // Engine enum: 0=A, 1=B, 2=OFF
    if (xAssign === "A") return 0;
    if (xAssign === "B") return 1;
    return 2;
  }

  _flushMixerModel(){
    const model = this._pendingMixerModel;
    this._pendingMixerModel = null;
    this._mixerFlushTimer = null;
    if (!window.audioBackend?.backends?.juce || !model) return;

    const req = (op, data) => this._requestNoThrow(op, data);
    const mixerSpec = window.JuceInstructionLibrary?.buildMixerSpec?.(model) || null;
    const prev = this._lastMixerSnapshot;

    const m = model.master || {};
    const master = {
      gain: Number(m.gain ?? 0.85), pan: Number(m.pan ?? 0), cross: Number(m.cross ?? 0.5),
      eqLow: Number(m.eqLow ?? 0), eqMid: Number(m.eqMid ?? 0), eqHigh: Number(m.eqHigh ?? 0),
    };
    if (!prev || JSON.stringify(prev.master) !== JSON.stringify(master)) {
      if (!prev) {
        req("mixer.master.set", { ...master, limiterEnabled: true, juceSpec: mixerSpec });
      } else {
        Object.entries(master).forEach(([param, value]) => {
          if (prev.master?.[param] !== value) req("mixer.param.set", { scope: "master", param, value });
        });
      }
    }

    const channels = Array.isArray(model.channels) ? model.channels : [];
    const nextChannels = [];
    channels.forEach((ch, i) => {
      const normalized = {
        gain: Number(ch.gain ?? 0.85), pan: Number(ch.pan ?? 0), mute: !!ch.mute, solo: !!ch.solo,
        eqLow: Number(ch.eqLow ?? 0), eqMid: Number(ch.eqMid ?? 0), eqHigh: Number(ch.eqHigh ?? 0),
        xAssign: ch.xAssign ?? "OFF",
      };
      nextChannels.push(normalized);
      const prevCh = prev?.channels?.[i];
      if (!prevCh) {
        req("mixer.channel.set", { ch: i, ...normalized, juceSpec: mixerSpec });
      } else {
        Object.entries(normalized).forEach(([param, value]) => {
          if (prevCh[param] === value) return;
          const sendValue = param === "xAssign" ? this._xAssignToNumber(value) : (typeof value === "boolean" ? Number(value) : value);
          req("mixer.param.set", { scope: "channel", ch: i, param, value: sendValue });
        });
      }

      const fxChain = this._normalizeFxChain(Array.isArray(ch.fx) ? ch.fx : []);
      const chainSig = fxChain.map((fx) => `${fx.id}:${fx.type}:${fx.enabled ? 1 : 0}`).join("|");
      const prevSig = prev?.channelFx?.[i]?.chainSig;
      if (!prev || chainSig !== prevSig) {
        req("fx.chain.set", { target: { scope: "channel", ch: i }, chain: fxChain.map(({ id, type, enabled }) => ({ id, type, enabled })) });
      }
      fxChain.forEach((fx) => {
        const prevParams = prev?.channelFx?.[i]?.paramsById?.[fx.id];
        if (!prevParams || JSON.stringify(prevParams) !== JSON.stringify(fx.params)) {
          req("fx.param.set", { target: { scope: "channel", ch: i }, id: fx.id, params: fx.params, juceSpec: window.JuceInstructionLibrary?.buildFxSpec?.({ scope: "channel", ch: i }, fx.source, fx.idx) || null });
        }
      });
    });

    const masterFx = this._normalizeFxChain(Array.isArray(m.fx) ? m.fx : []);
    const masterChainSig = masterFx.map((fx) => `${fx.id}:${fx.type}:${fx.enabled ? 1 : 0}`).join("|");
    if (!prev || masterChainSig !== prev?.masterFx?.chainSig) {
      req("fx.chain.set", { target: { scope: "master" }, chain: masterFx.map(({ id, type, enabled }) => ({ id, type, enabled })) });
    }
    masterFx.forEach((fx) => {
      const prevParams = prev?.masterFx?.paramsById?.[fx.id];
      if (!prevParams || JSON.stringify(prevParams) !== JSON.stringify(fx.params)) {
        req("fx.param.set", { target: { scope: "master" }, id: fx.id, params: fx.params, juceSpec: window.JuceInstructionLibrary?.buildFxSpec?.({ scope: "master" }, fx.source, fx.idx) || null });
      }
    });

    this._lastMixerSnapshot = {
      master,
      channels: nextChannels,
      channelFx: channels.map((ch) => {
        const chain = this._normalizeFxChain(Array.isArray(ch.fx) ? ch.fx : []);
        return {
          chainSig: chain.map((fx) => `${fx.id}:${fx.type}:${fx.enabled ? 1 : 0}`).join("|"),
          paramsById: Object.fromEntries(chain.map((fx) => [fx.id, fx.params]))
        };
      }),
      masterFx: {
        chainSig: masterChainSig,
        paramsById: Object.fromEntries(masterFx.map((fx) => [fx.id, fx.params]))
      }
    };
  }

  async applyMixerModel(model){
    if (!window.audioBackend?.backends?.juce || !model) return;
    this._pendingMixerModel = model;
    if (this._mixerFlushTimer) return;
    this._mixerFlushTimer = setTimeout(() => this._flushMixerModel(), 12);
  }

  getMixerInput(){ return null; }
  addMixerChannel(){ return 16; }
  updateCrossfader(value){
    // value: 0..1 (Deck A..Deck B)
    if (!window.audioBackend?.backends?.juce) return;
    window.audioBackend.backends.juce._request("mixer.param.set", { scope: "master", param: "cross", value: Number(value||0) }).catch(()=>{});
  }

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
