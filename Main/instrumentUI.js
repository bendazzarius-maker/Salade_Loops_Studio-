/* ================= Electro DAW | instrumentUI.js ================= */
/* Build right-panel UI from an instrument schema */
function renderInstrumentUI(container, schema, params, onChange){
  if(!container) return;
  container.innerHTML = "";
  const title = document.createElement("div");
  title.className = "panel-title";
  title.textContent = (schema && schema.title) ? schema.title : "Instrument";
  container.appendChild(title);

  const sections = (schema && schema.sections) ? schema.sections : [];
  for(const section of sections){
    const sec = document.createElement("div");
    sec.className = "panel-section";

    if(section.title){
      const h = document.createElement("div");
      h.className = "panel-section-title";
      h.textContent = section.title;
      sec.appendChild(h);
    }

    const controls = section.controls || [];
    for(const ctrl of controls){
      sec.appendChild(_makeInstrumentControl(ctrl, params, onChange));
    }

    container.appendChild(sec);
  }
}

function _makeInstrumentControl(ctrl, params, onChange){
  const row = document.createElement("div");
  row.className = "ctrl-row";

  const label = document.createElement("label");
  label.className = "ctrl-label";
  label.textContent = ctrl.label || ctrl.key;
  row.appendChild(label);

  const key = ctrl.key;

  if(ctrl.type === "slider"){
    const wrap = document.createElement("div");
    wrap.className = "ctrl-slider";

    const input = document.createElement("input");
    input.type = "range";
    input.min = ctrl.min;
    input.max = ctrl.max;
    input.step = (ctrl.step!=null) ? ctrl.step : 0.01;
    input.value = (params[key]!=null) ? params[key] : (ctrl.default!=null?ctrl.default:0);

    const value = document.createElement("div");
    value.className = "ctrl-value";
    value.textContent = _fmtValue(input.value, ctrl.unit);

    input.addEventListener("input", ()=>{
      const v = (ctrl.valueAs === "int") ? parseInt(input.value,10) : parseFloat(input.value);
      value.textContent = _fmtValue(v, ctrl.unit);
      onChange(key, v);
    });

    wrap.appendChild(input);
    wrap.appendChild(value);
    row.appendChild(wrap);
  }
  else if(ctrl.type === "toggle"){
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!((params[key]!=null)?params[key]:(ctrl.default||false));
    input.addEventListener("change", ()=>onChange(key, input.checked));
    row.appendChild(input);
  }
  else if(ctrl.type === "select"){
    const select = document.createElement("select");
    const options = ctrl.options || [];
    const grouped = new Map();
    for(const opt of options){
      const group = (opt && opt.group!=null) ? String(opt.group) : "";
      if(!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(opt);
    }

    for(const [groupName, groupOptions] of grouped.entries()){
      if(groupName){
        const og = document.createElement("optgroup");
        og.label = groupName;
        for(const opt of groupOptions){
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label;
          og.appendChild(o);
        }
        select.appendChild(og);
      } else {
        for(const opt of groupOptions){
          const o = document.createElement("option");
          o.value = opt.value;
          o.textContent = opt.label;
          select.appendChild(o);
        }
      }
    }
    select.value = (params[key]!=null) ? params[key] : (ctrl.default!=null?ctrl.default:"");
    select.addEventListener("change", ()=>onChange(key, select.value));
    row.appendChild(select);
  }
  return row;
}

function _fmtValue(v, unit){
  if(unit==null || unit==="") return String(v);
  return `${v}${unit}`;
}
