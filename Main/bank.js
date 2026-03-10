/* ================= Electro DAW | bank.js (JUCE IPC Instrument Drivers) ================= */
class JuceInstrumentRuntime {
  static _instByParams = new WeakMap();
  static _knownInst = new Set();

  constructor(name, paramsRef, instrumentDef){
    this.name = name;
    this.paramsRef = paramsRef || {};
    this.type = this._mapType(name, instrumentDef);
    this.instId = this._resolveStableInstId();
  }

  _resolveStableInstId(){
    const p = this.paramsRef;
    if (p && typeof p === "object") {
      const cached = JuceInstrumentRuntime._instByParams.get(p);
      if (cached) return cached;
      const id = `inst-${String(this.name||"inst").toLowerCase().replace(/\s+/g,"-")}-${Math.random().toString(36).slice(2,8)}`;
      JuceInstrumentRuntime._instByParams.set(p, id);
      return id;
    }
    return `inst-${String(this.name||"inst").toLowerCase().replace(/\s+/g,"-")}-${Math.random().toString(36).slice(2,8)}`;
  }

  _mapType(name, instrumentDef){
    const rawName = String(name||"");
    const n = rawName.toLowerCase();
    if(window.vstLibrary?.parseInstrumentValue?.(rawName)) return "vst_instrument";
    const explicitType = String(instrumentDef?.type || "").toLowerCase();
    if (explicitType === "drums") return "drums";
    if (explicitType === "sampler") return n.includes("touski") ? "touski" : "sample_pattern";
    if (n.includes("fender rhodes")) return "fender rhodes";
    if (n.includes("grand piano")) return "grand piano";
    if (n.includes("e piano")) return "e piano";
    if (n.includes("bass") && !n.includes("sub")) return "bass";
    if (n.includes("sub bass") || n.includes("subbass")) return "sub bass";
    if (n.includes("lead")) return "lead";
    if (n.includes("pad")) return "pad";
    if (n.includes("drum")) return "drums";
    if (n.includes("violin")) return "violin";
    if (n.includes("touski")) return "touski";
    if (n.includes("paterne") || n.includes("sample")) return "sample_pattern";
    return "piano";
  }

  async _req(op, data){
    const juce = window.audioBackend?.backends?.juce;
    if (!juce?._request) return;
    return juce._request(op, data).catch(()=>{});
  }

  async _ensureCreate(){
    if (this.type === "sample_pattern") return;
    if (this.type === "vst_instrument") {
      const presetValue = String(this.name || "");
      const pluginPath = window.vstLibrary?.parseInstrumentValue?.(presetValue) || "";
      if (!pluginPath) return;
      await this._req("vst.inst.ensure", { instId: this.instId, pluginPath, presetValue });
      await this._req("vst.inst.param.set", { instId: this.instId, params: this.paramsRef || {} });
      return;
    }
    if (!JuceInstrumentRuntime._knownInst.has(this.instId)) {
      const createType = this.type === "touski" ? "drums" : this.type;
      await this._req("inst.create", { instId: this.instId, type: createType, ch: 0 });
      JuceInstrumentRuntime._knownInst.add(this.instId);
    }
    if (this.type === "touski") {
      const programPath = String(this.paramsRef?.programPath || "").trim();
      const samples = Array.isArray(this.paramsRef?.samples) ? this.paramsRef.samples : [];
      if (programPath || samples.length) {
        await this._req("touski.program.load", { instId: this.instId, ch: 0, programPath, samples });
      }
      await this._req("touski.param.set", { instId: this.instId, params: this.paramsRef || {} });
      return;
    }
    await this._req("inst.param.set", { instId: this.instId, params: this.paramsRef || {} });
  }

  trigger(_t, midi, vel=0.85, dur=0.25){
    if (this.type === "sample_pattern") return;
    if (this.type === "vst_instrument") {
      this._ensureCreate().then(() => {
        const pluginPath = window.vstLibrary?.parseInstrumentValue?.(String(this.name || "")) || "";
        this._req("vst.note.on", { instId: this.instId, pluginPath, note: Number(midi), vel: Number(vel), when: "now" });
        setTimeout(() => {
          this._req("vst.note.off", { instId: this.instId, pluginPath, note: Number(midi), when: "now" });
        }, Math.max(20, Math.floor(Number(dur || 0.25) * 1000)));
      });
      return;
    }
    this._ensureCreate().then(() => {
      const onOp = this.type === "touski" ? "touski.note.on" : "note.on";
      const offOp = this.type === "touski" ? "touski.note.off" : "note.off";
      this._req(onOp, { instId: this.instId, note: Number(midi), vel: Number(vel), when: "now" });
      setTimeout(() => {
        this._req(offOp, { instId: this.instId, note: Number(midi), when: "now" });
      }, Math.max(20, Math.floor(Number(dur || 0.25) * 1000)));
    });
  }
}

class PresetBank{
  constructor(ae){ this.ae = ae; }
  register(){ }

  _defs(){ return window.__INSTRUMENTS__ || {}; }

  list(){
    const defs = this._defs();
    const names = Object.keys(defs);
    const fallback = ["Piano","Bass","Lead","Pad","Drums","SubBass","Violin","Sample Paterne","Sample Touski"];
    const merged = [...new Set([...(names.length ? names : fallback), "Sample Paterne", "Sample Touski", "Touski"])];
    return merged.sort((a,b)=>a.localeCompare(b));
  }

  def(name){
    const defs = this._defs();
    const key = String(name || "Piano");
    const found = defs[key] || (key === "Sample Touski" ? defs["Touski"] : null);
    if (found) return found;
    if (window.vstLibrary?.parseInstrumentValue?.(key)) {
      return {
        id: key,
        name: key,
        type: "vst_instrument",
        defaultParams: () => ({ gain: 1.0 }),
        uiSchema: () => ({ title: "VST Instrument", sections: [] })
      };
    }
    return defs["Piano"] || { name: key, defaultParams: () => ({}) };
  }

  defaults(name){
    const d = this.def(name);
    try {
      return (typeof d.defaultParams === "function") ? d.defaultParams() : { ...(d.defaultParams || {}) };
    } catch (_) {
      return {};
    }
  }

  get(name, paramsRef){ return new JuceInstrumentRuntime(name, paramsRef, this.def(name)); }
}

const presets = new PresetBank(ae);
