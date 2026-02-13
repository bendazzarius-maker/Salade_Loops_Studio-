/* ================= Electro DAW | instrumentPanel.js ================= */
/* Right panel instrument UI (per selected channel) */


function _renderPresetManager(host, def, ch){
  const instId = (def && (def.id || def.name)) ? (def.id || def.name) : (ch.preset || "Instrument");
  const wrap = document.createElement("div");
  wrap.className = "instPresetMgr";

  const top = document.createElement("div");
  top.className = "instPresetTop";

  const title = document.createElement("div");
  title.className = "small";
  title.textContent = "Presets (global)";

  const btnSave = document.createElement("button");
  btnSave.className = "btn small";
  btnSave.textContent = "💾 Save";

  const btnDel = document.createElement("button");
  btnDel.className = "btn small";
  btnDel.textContent = "🗑️ Delete";

  const btnExp = document.createElement("button");
  btnExp.className = "btn small";
  btnExp.textContent = "⬇ Export";

  const btnImp = document.createElement("button");
  btnImp.className = "btn small";
  btnImp.textContent = "⬆ Import";

  top.appendChild(title);
  top.appendChild(btnSave);
  top.appendChild(btnDel);
  top.appendChild(btnExp);
  top.appendChild(btnImp);

  const row = document.createElement("div");
  row.className = "instPresetRow";

  const nameInput = document.createElement("input");
  nameInput.className = "mixSmallSel";
  nameInput.style.flex = "1";
  nameInput.placeholder = "Nom preset (sans prompt)";

  const sel = document.createElement("select");
  sel.className = "mixSmallSel";
  sel.style.flex = "1";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Load preset —";
  sel.appendChild(opt0);

  function refreshList(){
    while(sel.children.length>1) sel.removeChild(sel.lastChild);
    const names = (window.presetStore && presetStore.list) ? presetStore.list(instId) : [];
    names.forEach(n=>{
      const o=document.createElement("option");
      o.value=n; o.textContent=n;
      sel.appendChild(o);
    });
  }
  refreshList();
  nameInput.value = "";

  const btnLoad = document.createElement("button");
  btnLoad.className = "btn small";
  btnLoad.textContent = "Load";

  row.appendChild(sel);
  row.appendChild(btnLoad);

  const row2 = document.createElement("div");
  row2.className = "instPresetRow";
  row2.appendChild(nameInput);

  function saveNamedPreset(){
    const name = String(nameInput.value || "").trim();
    if(!name) return;
    const ok = presetStore.save(instId, name, ch.params || {});
    if(ok){
      refreshList();
      sel.value = name;
      nameInput.value = name;
    } else {
      alert("Preset save failed (storage full or blocked).");
    }
  }

  btnSave.addEventListener("click", saveNamedPreset);
  nameInput.addEventListener("keydown", (ev)=>{
    if(ev.key === "Enter") saveNamedPreset();
  });

  btnLoad.addEventListener("click", ()=>{
    const name = sel.value;
    if(!name) return;
    nameInput.value = name;
    const data = presetStore.get(instId, name);
    if(!data) return;
    ch.params = ch.params || {};
    for(const k of Object.keys(ch.params)) delete ch.params[k];
    for(const k of Object.keys(data)) ch.params[k]=data[k];

    try{
      if(typeof def.applyPreset==="function" && data.preset){
        def.applyPreset(ch.params, data.preset);
        for(const k of Object.keys(data)) ch.params[k]=data[k];
      }
    }catch(_){}

    try{ renderInstrumentPanel(); }catch(_){}
  });

  btnDel.addEventListener("click", ()=>{
    const name = sel.value;
    if(!name) return;
    if(!confirm("Delete preset '"+name+"' for "+instId+" ?")) return;
    presetStore.remove(instId, name);
    refreshList();
    sel.value = "";
  });

  btnExp.addEventListener("click", ()=>{
    const data = presetStore.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "electrodaw-instrument-presets.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 50);
  });

  btnImp.addEventListener("click", ()=>{
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async ()=>{
      const f = input.files && input.files[0];
      if(!f) return;
      try{
        const raw = await f.text();
        const data = JSON.parse(raw);
        const ok = presetStore.importAll(data, true);
        if(ok){
          refreshList();
          alert("Presets imported.");
        } else {
          alert("Import failed.");
        }
      }catch(e){
        alert("Invalid JSON preset file.");
      }
    });
    input.click();
  });

  wrap.appendChild(top);
  wrap.appendChild(row);
  wrap.appendChild(row2);
  host.appendChild(wrap);
}

function renderInstrumentPanel(){
  if(typeof instrumentPanel === "undefined" || !instrumentPanel) return;
  const ch = activeChannel ? activeChannel() : null;
  if(!ch){ instrumentPanel.innerHTML = "<div class='small'>Aucun channel.</div>"; return; }

  // Use channel preset (not override) to edit channel params
  const presetName = ch.preset || "Piano";
  const def = presets && presets.def ? presets.def(presetName) : null;
  if(!def){
    instrumentPanel.innerHTML = "<div class='small'>Instrument introuvable.</div>";
    return;
  }

  if(!ch.params){ ch.params = presets.defaults(presetName); }
  if(ch.mixOut==null) ch.mixOut = 1;

  instrumentPanel.innerHTML = "";

  // Mixer routing (instrument -> mixer channel)
  const routeWrap=document.createElement("div");
  routeWrap.className="panel-section";
  const rtTitle=document.createElement("div");
  rtTitle.className="panel-section-title";
  rtTitle.textContent="Routing";
  routeWrap.appendChild(rtTitle);

  const row=document.createElement("div");
  row.className="ctrl-row";
  const lab=document.createElement("label");
  lab.className="ctrl-label";
  lab.textContent="Mixer Out";
  row.appendChild(lab);

  const sel=document.createElement("select");
  sel.className="mixSmallSel";
  const max = (project && project.mixer && project.mixer.channels) ? project.mixer.channels.length : 16;
  for(let i=1;i<=max;i++){
    const o=document.createElement("option");
    o.value=String(i);
    o.textContent=`CH ${i}`;
    sel.appendChild(o);
  }
  sel.value = String(Math.max(1, Math.min(max, ch.mixOut||1)));
  sel.addEventListener("change",()=>{
    ch.mixOut = parseInt(sel.value,10)||1;
  });
  row.appendChild(sel);
  routeWrap.appendChild(row);
  instrumentPanel.appendChild(routeWrap);

  // Preset manager (global, cross-pattern)
  const presetDiv = document.createElement("div");
  try{ _renderPresetManager(presetDiv, def, ch); }catch(_){}
  instrumentPanel.appendChild(presetDiv);

  // Instrument parameters UI
  const controlsDiv = document.createElement("div");
  instrumentPanel.appendChild(controlsDiv);

  const schema = (typeof def.uiSchema === "function") ? def.uiSchema(ch.params || {}) : (def.uiSchema || {title:presetName, sections:[]});
  renderInstrumentUI(controlsDiv, schema, ch.params, (key,val)=>{
    // If instrument supports preset application, do it in-place (keeps reference)
    if(key==="preset" && typeof def.applyPreset==="function"){
      def.applyPreset(ch.params, val);
    } else {
      ch.params[key]=val;
    }
    // optional live update hook (future): could re-render audio nodes etc.
  });
}

if(!window.__samplerProgramPanelRefreshHook){
  window.__samplerProgramPanelRefreshHook = true;
  const refresh = ()=>{ try{ renderInstrumentPanel(); }catch(_){ } };
  window.addEventListener("sampler-programs:changed", refresh);
  window.addEventListener("sampler-directory:change", refresh);
}
