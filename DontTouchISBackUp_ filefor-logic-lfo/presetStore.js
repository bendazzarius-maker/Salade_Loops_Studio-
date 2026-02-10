/* ================= Electro DAW | presetStore.js =================
   Instrument preset save/load (localStorage)
   - Presets are global (can be used across patterns/projects)
   - Stored per instrument id/name
   Storage schema:
     {
       version: 1,
       instruments: {
         "<InstrumentId>": {
            "<PresetName>": { ...params }
         }
       }
     }
=================================================================== */

(function(){
  const KEY = "ElectroDAW.instrumentPresets.v1";

  function _read(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return { version:1, instruments:{} };
      const data = JSON.parse(raw);
      if(!data || typeof data!=="object") return { version:1, instruments:{} };
      if(!data.instruments || typeof data.instruments!=="object") data.instruments = {};
      data.version = 1;
      return data;
    }catch(e){
      return { version:1, instruments:{} };
    }
  }

  function _write(data){
    try{
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    }catch(e){
      console.warn("PresetStore: save failed", e);
      return false;
    }
  }

  function _cloneParams(obj){
    const out = {};
    if(!obj || typeof obj!=="object") return out;
    for(const k of Object.keys(obj)){
      const v = obj[k];
      if(v==null) continue;
      if(typeof v==="number" || typeof v==="string" || typeof v==="boolean"){
        out[k]=v;
      } else if(Array.isArray(v)){
        out[k]=v.map(x => (typeof x==="number"||typeof x==="string"||typeof x==="boolean") ? x : 0);
      } else {
        // ignore nested objects for now
      }
    }
    return out;
  }

  function list(instId){
    const db=_read();
    const table = db.instruments[String(instId||"")] || {};
    return Object.keys(table).sort((a,b)=>a.localeCompare(b));
  }

  function get(instId, presetName){
    const db=_read();
    const table = db.instruments[String(instId||"")] || {};
    const p = table[String(presetName||"")];
    if(!p) return null;
    return JSON.parse(JSON.stringify(p));
  }

  function save(instId, presetName, params){
    const id = String(instId||"");
    const name = String(presetName||"").trim();
    if(!id || !name) return false;
    const db=_read();
    db.instruments[id] = db.instruments[id] || {};
    db.instruments[id][name] = _cloneParams(params);
    return _write(db);
  }

  function remove(instId, presetName){
    const id = String(instId||"");
    const name = String(presetName||"").trim();
    if(!id || !name) return false;
    const db=_read();
    if(!db.instruments[id]) return false;
    delete db.instruments[id][name];
    return _write(db);
  }

  function exportAll(){
    return _read();
  }

  function importAll(data, merge=true){
    try{
      if(!data || typeof data!=="object") return false;
      const incoming = data.instruments || {};
      const db = merge ? _read() : { version:1, instruments:{} };
      for(const instId of Object.keys(incoming)){
        const table = incoming[instId];
        if(!table || typeof table!=="object") continue;
        db.instruments[instId] = db.instruments[instId] || {};
        for(const presetName of Object.keys(table)){
          db.instruments[instId][presetName] = _cloneParams(table[presetName]);
        }
      }
      return _write(db);
    }catch(e){
      console.warn("PresetStore: import failed", e);
      return false;
    }
  }

  window.presetStore = { list, get, save, remove, exportAll, importAll };
})();
