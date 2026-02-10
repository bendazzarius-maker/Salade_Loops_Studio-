/* ================= Electro DAW | tabs.js ================= */
/* ---------------- tabs ---------------- */
$$(".tab").forEach(t=>{
  t.addEventListener("click",()=>{
    $$(".tab").forEach(x=>x.classList.toggle("active",x===t));
    const v=t.dataset.v;
    $$(".view").forEach(x=>x.classList.toggle("active", x.id===`view-${v}`));
    if(v==="mixer"){ try{ renderMixerUI(); }catch(_){}}
  });
});
