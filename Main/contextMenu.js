/* ================= Electro DAW | contextMenu.js ================= */
/* ---------------- context menu + disable browser menu ---------------- */
let clipboard=[];
function showCtx(x,y){
  ctxEl.style.display="block";
  ctxEl.style.left=x+"px"; ctxEl.style.top=y+"px";
  const close=(e)=>{
    if(!ctxEl.contains(e.target)){
      ctxEl.style.display="none";
      document.removeEventListener("click",close);
    }
  };
  setTimeout(()=>document.addEventListener("click",close),10);
}

function getDupOffsetSteps(){
  const r = (window.getTimeRulerSelection ? window.getTimeRulerSelection("roll") : {startStep:0,endStep:0});
  const len = (r && r.endStep>r.startStep) ? (r.endStep-r.startStep) : 0;
  return Math.max(1, len || 4);
}

function ctxAction(a){
  const ch=activeChannel(); if(!ch) return;
  const sel=ch.notes.filter(n=>n.selected);

  if(a==="delete"){
    ch.notes=ch.notes.filter(n=>!n.selected);
    renderNotes(); renderPlaylist();
    return;
  }
  if(a==="copy"){
    clipboard=sel.map(n=>({...n}));
    return;
  }
  if(a==="paste"){
    if(!clipboard.length) return;
    const offset=getDupOffsetSteps();
    // Paste: new notes become selected
    sel.forEach(n=>n.selected=false);
    clipboard.forEach(n=>{
      ch.notes.push({
        ...n,
        id:gid("note"),
        step:(n.step||0)+offset,
        selected:true
      });
    });
    renderNotes(); renderPlaylist();
    return;
  }
  if(a==="duplicate"){
    const offset=getDupOffsetSteps();
    // Duplicate: copy becomes selection (ergonomic)
    sel.forEach(n=>n.selected=false);
    sel.forEach(n=>{
      ch.notes.push({
        ...n,
        id:gid("note"),
        step:(n.step||0)+offset,
        selected:true
      });
    });
    renderNotes(); renderPlaylist();
    return;
  }
  if(a==="quantize"){
    const s=Math.max(1,state.snap);
    sel.forEach(n=>{
      n.step=Math.round(n.step/s)*s;
      n.len =Math.max(1,Math.round(n.len/s)*s);
    });
    renderNotes(); renderPlaylist();
    return;
  }
}

document.addEventListener("contextmenu",(e)=>{ e.preventDefault(); });
grid.addEventListener("contextmenu",(e)=>{ e.preventDefault(); showCtx(e.clientX,e.clientY); });
ctxEl.addEventListener("click",(e)=>{
  const it=e.target.closest(".it"); if(!it) return;
  ctxAction(it.dataset.a);
  ctxEl.style.display="none";
});
