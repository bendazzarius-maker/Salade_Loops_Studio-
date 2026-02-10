/* ================= Electro DAW | timeline.js =================
   P004b: Add quarter segments (.qseg) so time-ruler selections can be
   highlighted and mapped to steps reliably.

   Keeps existing visuals:
   - bar label (1..bars)
   - beat lines at 25/50/75%
*/
function buildTimeline(el, bars){
  el.innerHTML = "";
  const n = Math.max(0, (bars|0));

  for(let i=0;i<n;i++){
    const b = document.createElement("div");
    b.className = "bar";

    const lab = document.createElement("span");
    lab.className = "bar-label";
    lab.textContent = String(i+1);
    lab.style.position = "absolute";
    lab.style.left = "6px";
    lab.style.top = "6px";
    lab.style.pointerEvents = "none";
    b.appendChild(lab);

    for(let q=0;q<4;q++){
      const s = document.createElement("div");
      s.className = "qseg";
      s.dataset.q = String(i*4 + q);
      // make the segment fill the bar as a 25% slice
      s.style.flex = "1";
      s.style.height = "100%";
      b.appendChild(s);
    }

    for(let k=1;k<4;k++){
      const l = document.createElement("div");
      l.className = "beatline";
      l.style.left = `${(k*25)}%`;
      b.appendChild(l);
    }

    el.appendChild(b);
  }

  // Notify selection module to repaint after rebuild
  try{ window.dispatchEvent(new Event("ui:timelineRebuilt")); }catch(_e){}
}
