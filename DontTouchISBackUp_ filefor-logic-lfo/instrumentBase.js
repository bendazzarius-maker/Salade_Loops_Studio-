/* ================= Electro DAW | instrumentBase.js ================= */
/* Shared helpers for virtual instruments */
function instClamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function instDbToGain(db){ return Math.pow(10, db/20); }
