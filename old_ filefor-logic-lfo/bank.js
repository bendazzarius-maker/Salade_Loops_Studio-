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
    return this._defs.get(name) || this._defs.get("Piano") || null;
  }

  defaults(name){
    const d = this.def(name);
    return d && d.defaultParams ? d.defaultParams() : {};
  }

  // Backward compatible: returns a runtime instrument with trigger()
  get(name, paramsRef, outBus){
    const d = this.def(name);
    if(!d) return null;
    // ensure audio context exists
    const ctx = this.ae.ctx;
    if(!ctx) return { name:"Piano", type:"synth", color:"#27e0a3", trigger:()=>{} };
    return d.create(this.ae, paramsRef, outBus);
  }
}
const presets = new PresetBank(ae);
