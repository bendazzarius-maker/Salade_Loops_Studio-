/* ================= Electro DAW | playlist.js ================= */
/* ---------------- playlist render with auto clip length ---------------- */

// One-time keybinds for playlist clip deletion
if (!window.__slsPlaylistKeybindsInstalled) {
  window.__slsPlaylistKeybindsInstalled = true;
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const key = (e.key || "").toLowerCase();
    if (key !== "delete" && key !== "backspace") return;

    // Don't hijack typing
    const ae = document.activeElement;
    const tag = (ae && ae.tagName ? ae.tagName.toLowerCase() : "");
    if (tag === "input" || tag === "textarea" || ae?.isContentEditable) return;

    if (state?.selectedPlaylistClip) {
      e.preventDefault();
      deleteSelectedPlaylistClip();
    }
  }, { passive: false });
}


function _isLfoTrack(t){
  try{
    if(window.LFO && typeof LFO.isLfoTrack==="function") return !!LFO.isLfoTrack(t);
  }catch(_e){}
  const tp = (t?.type || t?.kind || t?.trackType || "").toString().toLowerCase();
  return tp === "lfo" || tp === "lfo_track" || tp === "automation_lfo";
}
function _isLfoPattern(p){
  try{
    if(window.LFO && typeof LFO.isLfoPattern==="function") return !!LFO.isLfoPattern(p);
  }catch(_e){}
  const tp = (p?.type || p?.kind || p?.patternType || "").toString().toLowerCase();
  return tp === "lfo_curve" || tp === "lfo_preset" || tp === "lfo";
}
function renderPlaylist(){
  plistInfo.textContent = `Bars: ${project.playlist.bars} • Tracks: ${project.playlist.tracks.length}`;

  const _ph = document.getElementById("plistPlayhead");
  tracks.innerHTML="";
  if(_ph){
    // Make sure the playhead never blocks clicks on clips
    _ph.style.pointerEvents = "none";
    tracks.appendChild(_ph);
  }

  const barW = cssNum("--plist-step-w") * state.stepsPerBar;
  const laneW = project.playlist.bars * barW;

  for(const t of project.playlist.tracks){
    const isLfo=_isLfoTrack(t);
    const row=document.createElement("div");
    row.className="track";
    if(isLfo){
      // Force real 2x height (CSS might have fixed height)
      row.style.height = "84px";
      row.style.minHeight = "84px";
    }
    row.innerHTML = `
      <div class="thead">
        <div class="mini-dot" style="background:${t.color}"></div>
        <div style="flex:1">${t.name}</div>
        ${isLfo?`<div class="small" style="opacity:.85;font-weight:800">LFO</div>`:``}
      </div>
      <div class="lane" data-trk="${t.id}"><div class="laneInner"></div></div>
    `;
    const lane=row.querySelector(".lane");
    const laneInner=row.querySelector(".laneInner");
    laneInner.style.width = `${laneW}px`;
    if(isLfo){ lane.style.minHeight="86px"; lane.style.height="86px"; }

    lane.addEventListener("mousedown",(e)=>{
      if(e.button!==0) return;

      const laneRect = lane.getBoundingClientRect();
      // FIX: previously had a typo that broke playlist editing
      const x = (e.clientX - laneRect.left); // pan/scroll already included via laneRect
      const bar = Math.floor(x / barW);
      if(bar<0) return;

      // If we clicked inside an existing clip range: remove it (delete on left-click)
      const hitIndex = t.clips.findIndex(c => bar >= c.startBar && bar < (c.startBar + c.lenBars));
      if (hitIndex !== -1) {
        const removed = t.clips.splice(hitIndex, 1)[0];
        if (state?.selectedPlaylistClip?.clipId === removed?.id) state.selectedPlaylistClip = null;
        renderPlaylist();
        return;
      }

      // Otherwise: place the currently selected pattern at this bar
      placeClip(t.id, bar);
    });

    for(const c of t.clips){
      const clip=document.createElement("div");
      clip.className="clip";
      clip.style.left = `${c.startBar * barW}px`;
      clip.style.width = `${c.lenBars * barW}px`;

      const pat = project.patterns.find(p=>p.id===c.patternId);
      const col = pat?.color || t.color;
      clip.style.background = col;
      if(isLfo && pat && _isLfoPattern(pat)){
        clip.style.display="grid";
        clip.style.gridTemplateRows="auto 1fr";
        clip.style.padding="6px";
        const title=document.createElement("div");
        title.className="small";
        title.style.fontWeight="800";
        title.style.opacity="0.95";
        const lfoType = String(pat.type||pat.kind||pat.patternType||"").toLowerCase();
        title.textContent = lfoType==="lfo_preset" ? `LFO Preset: ${pat.name}` : `LFO Curve: ${pat.name}`;
        clip.appendChild(title);

        if(lfoType==="lfo_curve"){
          const canvas=document.createElement("canvas");
          canvas.style.width="100%";
          canvas.style.height="100%";
          canvas.style.borderRadius="8px";
          canvas.style.background="rgba(0,0,0,0.18)";
          clip.appendChild(canvas);
          // Keep drawing strictly inside the clip
          clip.style.overflow="hidden";
          requestAnimationFrame(()=>{
            try{
              if(window.LFO){
                if(clip.__lfoCleanup) try{clip.__lfoCleanup();}catch(_e){}
                clip.__lfoCleanup = LFO.makeInteractive(canvas, pat, ()=>{ /* live edit only */ });
              }
            }catch(_e){}
          });
        }else{
          // LFO Preset: NO curve UI here
          const badge=document.createElement("div");
          badge.className="small";
          badge.style.opacity="0.9";
          badge.style.marginTop="6px";
          badge.textContent="Preset FX (bind)";
          clip.appendChild(badge);
        }
      }else{
        clip.textContent = pat ? pat.name : "Pattern";
      }

      // Selection highlight (inline to avoid CSS dependency)
      const sel = state?.selectedPlaylistClip;
      if (sel && sel.trackId === t.id && sel.clipId === c.id) {
        clip.style.outline = "2px solid rgba(255,255,255,0.9)";
        clip.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.35) inset";
      }

      // Click on a clip selects it and also selects its pattern for editing
      clip.addEventListener("mousedown", (e)=>{
        if (e.button !== 0) return;
        e.stopPropagation();

        // Shift+click = quick delete
        if (e.shiftKey) {
          t.clips = t.clips.filter(x => x.id !== c.id);
          if (state?.selectedPlaylistClip?.clipId === c.id) state.selectedPlaylistClip = null;
          renderPlaylist();
          return;
        }

        selectPlaylistClip(t.id, c.id);
      });

      laneInner.appendChild(clip);
    }

    tracks.appendChild(row);
  }

  plistTime.style.transform = `translateX(-${tracks.scrollLeft}px)`;
}

function selectPlaylistClip(trackId, clipId){
  if (!state) return;
  state.selectedPlaylistClip = { trackId, clipId };

  const t = project.playlist.tracks.find(x => x.id === trackId);
  const c = t?.clips.find(x => x.id === clipId);

  // Pattern clips: keep the old behavior (piano roll edits selected pattern)
  // LFO clips: DO NOT hijack piano roll / automation. Keep editing in Playlist.
  if (c && c.patternId) {
    const pat = project.patterns.find(p=>p.id===c.patternId);
    const isLfo = _isLfoTrack(t) || _isLfoPattern(pat);

    if(isLfo){
      state.selectedLfoPatternId = c.patternId;
      project.activePatternId = c.patternId;
      // optional: jump to playlist tab only
      try{ selectTab && selectTab("plist"); }catch(_e){}
      try{ refreshUI(); }catch(_e){}
    }else{
      project.activePatternId = c.patternId;
      try{ refreshUI(); } catch(_e){}
      try{ renderAll(); } catch(_e){}
    }
  }

  renderPlaylist();
}

function deleteSelectedPlaylistClip(){
  const sel = state?.selectedPlaylistClip;
  if (!sel) return;
  const t = project.playlist.tracks.find(x => x.id === sel.trackId);
  if (!t) return;
  t.clips = t.clips.filter(c => c.id !== sel.clipId);
  state.selectedPlaylistClip = null;
  renderPlaylist();
}

function placeClip(trackId, bar){
  const t=project.playlist.tracks.find(x=>x.id===trackId);
  if(!t) return;
  const patId = plistPatternSelect.value || project.activePatternId;
  const pat = project.patterns.find(p=>p.id===patId);
  if(!pat) return;

  // If a clip already starts exactly here, don't stack duplicates.
  // (Deletion is handled by the hit-range click above.)
  const ex = t.clips.find(c => c.startBar === bar);
  if (ex) {
    selectPlaylistClip(t.id, ex.id);
    return;
  }

  const lenBars = patternLengthBars(pat);
  t.clips.push({ id: gid("clip"), patternId: patId, startBar: bar, lenBars });
  renderPlaylist();
}

tracks.addEventListener("scroll", ()=>{ plistTime.style.transform = `translateX(-${tracks.scrollLeft}px)`; });
