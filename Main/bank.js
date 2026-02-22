/* ================= Electro DAW | bank.js (Virtual Instruments Bank) ================= */
/* Each instrument has its own file: inst_*.js. This bank is the registry for the DAW. */
class PresetBank{
  constructor(ae){
    this.ae = ae;
    this._defs = new Map();
    const src = (window.__INSTRUMENTS__||{});
    for(const k of Object.keys(src)){
      this.register(src[k]);
    }
  }

  register(def){
    if(!def || !def.name || !def.create) return;
    this._defs.set(def.name, def);
  }

  list(){
    return [...this._defs.keys()];
  }

  def(name){
    if(this._defs.has(name)) return this._defs.get(name);

    const raw = (name == null) ? "" : String(name);
    const trimmed = raw.trim();
    if(trimmed && this._defs.has(trimmed)) return this._defs.get(trimmed);

    if(trimmed){
      const lower = trimmed.toLowerCase();
      for(const [k, def] of this._defs.entries()){
        if(String(k).toLowerCase() === lower) return def;
      }
    }

    return this._defs.get("Piano") || null;
  }

  defaults(name){
    const d = this.def(name);
    return d && d.defaultParams ? d.defaultParams() : {};
  }

  // Backward compatible: returns a runtime instrument with trigger()
  get(name, paramsRef, outBus){
    const d = this.def(name);
    if(!d) return null;

    // Hybrid-safe: Sample Paterne can run with its own AudioContext fallback
    // (useful when native backend is active and ae.ctx is not initialized).
    const resolvedName = String(d.name || "").toLowerCase();
    const reqName = String(name || "").toLowerCase();
    const isSamplePaterne = resolvedName === "sample paterne"
      || reqName === "sample paterne"
      || reqName === "sample pattern"
      || reqName === "samplepaterne";

    // ensure audio context exists for WebAudio-only instruments
    const ctx = this.ae.ctx;
    if(!ctx && !isSamplePaterne) return { name:"Piano", type:"synth", color:"#27e0a3", trigger:()=>{} };
    return d.create(this.ae, paramsRef, outBus);
  }
}
const presets = new PresetBank(ae);
