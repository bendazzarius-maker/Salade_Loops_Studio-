/* ================= Electro DAW | bank.js (JUCE IPC Instrument Drivers) ================= */
class JuceInstrumentRuntime {
  static _instByParams = new WeakMap();
  static _knownInst = new Set();

  constructor(name, paramsRef){
    this.name = name;
    this.paramsRef = paramsRef || {};
    this.type = this._mapType(name);
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
    const n = String(name||"").toLowerCase();
    const explicitType = String(instrumentDef?.type || "").toLowerCase();
    if (explicitType === "drums") return "drums";
    if (explicitType === "sampler") return n.includes("touski") ? "touski" : "sample_pattern";
    if (n.includes("bass") && !n.includes("sub")) return "bass";
    if (n.includes("sub")) return "subbass";
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
    if (!JuceInstrumentRuntime._knownInst.has(this.instId)) {
      await this._req("inst.create", { instId: this.instId, type: this.type, ch: 0 });
      JuceInstrumentRuntime._knownInst.add(this.instId);
    }
    await this._req("inst.param.set", { instId: this.instId, params: this.paramsRef || {} });
  }

  trigger(_t, midi, vel=0.85, dur=0.25){
    if (this.type === "sample_pattern") return;
    this._ensureCreate().then(() => {
      this._req("note.on", { instId: this.instId, note: Number(midi), vel: Number(vel), when: "now" });
      setTimeout(() => {
        this._req("note.off", { instId: this.instId, note: Number(midi), when: "now" });
      }, Math.max(20, Math.floor(Number(dur || 0.25) * 1000)));
    });
  }
}

class PresetBank{
  constructor(ae){ this.ae = ae; }
  register(){ }
  list(){ return ["Piano","Bass","Lead","Pad","Drums","SubBass","Violin","Sample Paterne","Sample Touski"]; }
  def(name){ return { name: name || "Piano", defaultParams: () => ({}) }; }
  defaults(){ return {}; }
  get(name, paramsRef){ return new JuceInstrumentRuntime(name, paramsRef); }
}

const presets = new PresetBank(ae);
