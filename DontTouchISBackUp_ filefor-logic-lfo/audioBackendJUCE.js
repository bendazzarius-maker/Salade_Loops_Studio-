/* ================= Electro DAW | audioBackendJUCE.js ================= */
(function initAudioBackendJUCE(global){
  // DEPRECATED: keep for backward compatibility, do not override main audioBackend.js implementation.
  if (global.audioBackend) return;
  function hashString(value=""){
    let h = 2166136261;
    const s = String(value||"");
    for(let i=0;i<s.length;i+=1){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h>>>0).toString(16);
  }

  class AudioBackendJUCE {
    constructor(){
      this.loadedSamples = new Map();
      this.pending = new Map();
      this.seq = 1;
      this.available = !!(global.audioNative && typeof global.audioNative.send === "function");
      if(this.available && global.audioNative.onEvent){
        global.audioNative.onEvent((msg)=> this._onEvent(msg));
      }
    }

    isActive(){
      return this.available;
    }

    _onEvent(msg){
      if(!msg || msg.type !== "res" || !msg.id) return;
      const waiter = this.pending.get(msg.id);
      if(!waiter) return;
      this.pending.delete(msg.id);
      if(msg.ok) waiter.resolve(msg.data || {});
      else waiter.reject(new Error(msg.err?.message || "Native audio error"));
    }

    _send(op, data = {}){
      if(!this.available) return Promise.reject(new Error("Audio native indisponible"));
      const id = `r-${Date.now()}-${this.seq++}`;
      const envelope = { id, op, data };
      return new Promise((resolve, reject)=>{
        this.pending.set(id, { resolve, reject });
        global.audioNative.sendEnvelope(envelope).then((ack)=>{
          if(!ack?.ok){
            this.pending.delete(id);
            reject(new Error("E_SEND_FAIL"));
          }
        }).catch((err)=>{
          this.pending.delete(id);
          reject(err);
        });
      });
    }

    _resolveSamplePath(samplePath){
      return String(samplePath || "").trim();
    }

    async ensureSampleLoaded(samplePath){
      const resolved = this._resolveSamplePath(samplePath);
      if(!resolved) throw new Error("samplePath manquant");
      const sampleId = `sp_${hashString(resolved.toLowerCase())}`;
      if(!this.loadedSamples.has(sampleId)){
        const task = this._send("sampler.load", { sampleId, path: resolved })
          .then((data)=>({ sampleId, ...data }));
        this.loadedSamples.set(sampleId, task);
      }
      await this.loadedSamples.get(sampleId);
      return sampleId;
    }

    async triggerSample(payload = {}){
      const samplePath = String(payload.samplePath || "").trim();
      const sampleId = await this.ensureSampleLoaded(samplePath);
      return this._send("sampler.trigger", {
        trackId: String(payload.trackId || "track-1"),
        sampleId,
        gain: Number(payload.gain ?? 1),
        pan: Number(payload.pan ?? 0),
        startNorm: Number(payload.startNorm ?? 0),
        endNorm: Number(payload.endNorm ?? 1),
        rootMidi: Math.floor(Number(payload.rootMidi ?? 60)),
        note: Math.floor(Number(payload.note ?? 60)),
        velocity: Number(payload.velocity ?? 0.8),
        when: "now",
      });
    }
  }

  global.audioBackend = new AudioBackendJUCE();
})(window);
