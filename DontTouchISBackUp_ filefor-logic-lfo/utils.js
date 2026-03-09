/* ================= Electro DAW | utils.js ================= */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const cssNum = v => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || 0;
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const gid = (p="id") => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

function triggerSamplePatternPreviewNative(pattern, channel, midi, velocity = 0.85){
  const isSamplePattern = String(channel?.preset || "") === "Sample Paterne"
    || String(pattern?.type || pattern?.kind || "").toLowerCase() === "sample_pattern";
  if (!isSamplePattern) return false;
  return false;
}

function triggerSamplePatternTestNative(pattern, channel, midi, velocity = 0.85){
  return triggerSamplePatternPreviewNative(pattern, channel, midi, velocity);
}


const state = {
  autoScroll: true,
  bpm: 120,
  playing: false,
  loop: false,
  preview: true,
  tool: "paint",
  snap: 1,
  defaultLen: 4,
  octaveMin: 0,
  octaveMax: 8,
  baseMidi: 12,
  noteCount: 0,
  bars: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bars")) || 64,
  stepsPerBar: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--steps-per-bar")) || 16,
  mode: "pattern", // "pattern" | "song"
  maximized: false,
  audioBackend: "juce",
  audioBufferSize: 512,
  audioSampleRate: 48000
};
function applyOctaves(){
  state.baseMidi = 12 * (state.octaveMin + 1);     // C0=12
  state.noteCount = (state.octaveMax - state.octaveMin + 1) * 12;
}
applyOctaves();

const noteNames = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const midiMax = () => state.baseMidi + state.noteCount - 1;
const rowFromMidi = (m)=> midiMax() - m; // aigus en haut
const midiFromRow = (r)=> midiMax() - r;
function midiToName(m){
  const n = noteNames[m % 12];
  const o = Math.floor(m / 12 - 1);
  return `${n}${o}`;
}
function nameToMidi(name){
  const m = name.match(/^([A-G])(#?)(-?\d+)$/);
  if(!m) return null;
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]];
  const semi = base + (m[2]==="#" ? 1 : 0);
  const oct = parseInt(m[3],10);
  return 12*(oct+1)+semi;
}


/* ================= Zoom & Pan (PianoRoll + Playlist) =================
   - Zoom horizontal only (Ctrl+Wheel or Ctrl +/-) inside each viewport
   - Pan with SPACE + drag (or middle mouse drag) in viewport
   - Prevent browser zoom when DAW uses Ctrl+Wheel / Ctrl +/- / Ctrl+0
====================================================================== */
state.rollZoomX = 1;
state.plistZoomX = 1;
state.spacePan = false;
state._hoverZone = "roll"; // "roll" | "plist"

function _setCssVar(name, px){
  document.documentElement.style.setProperty(name, `${Math.round(px)}px`);
}

function setRollStepW(px){
  px = clamp(px, 8, 140);
  state.rollZoomX = px / 40;
  _setCssVar("--roll-step-w", px);
  try{ sizeGrid(); buildAllTimelines(); renderNotes(); }catch(_){}
  try{ renderPlaylist(); }catch(_){}
}
function setPlistStepW(px){
  px = clamp(px, 8, 140);
  state.plistZoomX = px / 40;
  _setCssVar("--plist-step-w", px);
  try{ buildAllTimelines(); }catch(_){}
  try{ renderPlaylist(); }catch(_){}
}

function zoomRoll(delta){
  const cur = cssNum("--roll-step-w") || 40;
  setRollStepW(cur + delta);
}
function zoomPlist(delta){
  const cur = cssNum("--plist-step-w") || 40;
  setPlistStepW(cur + delta);
}

function installZoomPan(){
  // Elements exist after domRefs.js is loaded; we query by id to be safe.
  const gridScrollEl = document.getElementById("gridScroll");
  const pianoScrollEl = document.getElementById("pianoScroll");
  const tracksEl = document.getElementById("tracks");
  const rollTimeEl = document.getElementById("rollTime");
  const plistTimeEl = document.getElementById("plistTime");

  // Hover zone
  gridScrollEl?.addEventListener("mouseenter", ()=> state._hoverZone="roll");
  rollTimeEl?.addEventListener("mouseenter", ()=> state._hoverZone="roll");
  tracksEl?.addEventListener("mouseenter", ()=> state._hoverZone="plist");
  plistTimeEl?.addEventListener("mouseenter", ()=> state._hoverZone="plist");

  // Ctrl+wheel zoom (prevent browser zoom)
  function wheelZoomHandler(zone){
    return (e)=>{
      if(!e.ctrlKey) return;
      e.preventDefault();
      const dir = (e.deltaY>0) ? -1 : 1;
      const step = e.shiftKey ? 2 : 6; // finer with shift
      if(zone==="roll") zoomRoll(dir*step);
      else zoomPlist(dir*step);
    };
  }
  gridScrollEl?.addEventListener("wheel", wheelZoomHandler("roll"), {passive:false});
  rollTimeEl?.addEventListener("wheel", wheelZoomHandler("roll"), {passive:false});
  tracksEl?.addEventListener("wheel", wheelZoomHandler("plist"), {passive:false});
  plistTimeEl?.addEventListener("wheel", wheelZoomHandler("plist"), {passive:false});

  // Pan drag (SPACE or middle mouse)
  function installPan(el, zone){
    if(!el) return;
    let dragging=false, sx=0, sy=0, sl=0, st=0;

    function down(e){
      const panWanted = state.spacePan || e.button===1;
      if(!panWanted) return;
      dragging=true;
      document.body.classList.add("panning");
      sx=e.clientX; sy=e.clientY;
      sl=el.scrollLeft; st=el.scrollTop;
      e.preventDefault();
      e.stopPropagation();
      window.addEventListener("mousemove", move, {passive:false});
      window.addEventListener("mouseup", up, {passive:false});
    }
    function move(e){
      if(!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      el.scrollLeft = sl - dx;
      el.scrollTop  = st - dy;
      // sync timelines
      try{
        if(zone==="roll") syncRollScroll();
        if(zone==="plist") plistTime.style.transform = `translateX(-${tracks.scrollLeft}px)`;
      }catch(_){}
      e.preventDefault();
    }
    function up(e){
      dragging=false;
      document.body.classList.remove("panning");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    // capture so it wins over note placing / clip placing
    el.addEventListener("mousedown", down, {capture:true});
  }

  installPan(gridScrollEl, "roll");
  installPan(tracksEl, "plist");

  // Keep piano keys synced while panning
  if(gridScrollEl && pianoScrollEl){
    gridScrollEl.addEventListener("scroll", ()=>{
      try{ pianoScroll.scrollTop = gridScroll.scrollTop; }catch(_){}
    }, {passive:true});
  }

  // Keyboard: SPACE for pan, Ctrl +/-/0 for zoom
  window.addEventListener("keydown",(e)=>{
    if(e.code==="Space" && !e.repeat){
      state.spacePan = true;
      document.body.classList.add("panMode");
      // avoid page scroll
      e.preventDefault();
    }

    if(e.ctrlKey){
      const k = e.key;
      if(k==="+" || k==="="){
        e.preventDefault();
        if(state._hoverZone==="plist") zoomPlist(+6);
        else zoomRoll(+6);
      } else if(k==="-" || k==="_"){
        e.preventDefault();
        if(state._hoverZone==="plist") zoomPlist(-6);
        else zoomRoll(-6);
      } else if(k==="0"){
        e.preventDefault();
        if(state._hoverZone==="plist") setPlistStepW(40);
        else setRollStepW(40);
      }
    }
  }, {passive:false});

  window.addEventListener("keyup",(e)=>{
    if(e.code==="Space"){
      state.spacePan = false;
      document.body.classList.remove("panMode");
    }
  });
}
