/* ================= Electro DAW | renderHelpers.js ================= */
/* ---------------- render helpers ---------------- */
function renderAll(){
  buildPianoColumn();
  sizeGrid();
  renderNotes();
  if(typeof renderAutomationLane==='function') renderAutomationLane();
  syncRollScroll();
  renderPlaylist();
}
function buildAllTimelines(){
  buildTimeline(rollTime, project.playlist.bars);
  buildTimeline(plistTime, project.playlist.bars);
}
