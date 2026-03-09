/* ================= Electro DAW | drumMachineHost.js ================= */
(function(){
  const FRAME_ID = 'drumMachineOverlayFrame';
  const WRAP_ID = 'drumMachineOverlayWrap';
  const HOST_SOURCE = 'sls-drumkit-host';
  const UI_SOURCE = 'sls-drumkit-ui';
  const HTML_PATH = './drum_machine_fm.html?embedded=1';
  let frame = null;
  let wrap = null;
  let frameLoaded = false;

  function deepClone(v){
    try { return JSON.parse(JSON.stringify(v)); } catch(_) { return null; }
  }

  function activeDrumChannel(){
    try {
      const ch = (typeof activeChannel === 'function') ? activeChannel() : null;
      if (!ch) return null;
      const p = String(ch.preset || '').toLowerCase();
      return p.includes('drum') ? ch : null;
    } catch (_) {
      return null;
    }
  }

  function ensureWrap(){
    if (wrap && frame) return;
    wrap = document.getElementById(WRAP_ID);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = WRAP_ID;
      Object.assign(wrap.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1400',
        display: 'none',
        background: 'transparent',
        pointerEvents: 'none'
      });
      document.body.appendChild(wrap);
    }

    frame = document.getElementById(FRAME_ID);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = FRAME_ID;
      frame.src = HTML_PATH;
      frame.setAttribute('title', 'Drum Machine FM');
      Object.assign(frame.style, {
        position: 'absolute',
        left: '140px',
        top: '120px',
        width: '980px',
        height: '720px',
        border: '0',
        background: 'transparent',
        colorScheme: 'dark',
        pointerEvents: 'auto',
        display: 'block'
      });
      frame.addEventListener('load', () => {
        frameLoaded = true;
        applyFrameBounds();
        syncActiveChannelToUI(true);
      });
      wrap.appendChild(frame);
    }
  }

  function getStoredSnapshot(ch){
    return deepClone(ch?.params?.__drumMachineUiState || null);
  }

  function postToFrame(type, payload){
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ source: HOST_SOURCE, type, payload }, '*');
  }

  function norm100(v, fallback=50){
    const n = Number(v);
    return Math.max(0, Math.min(100, Number.isFinite(n) ? n : fallback)) / 100;
  }

  function avgOperatorLevel(voice){
    const ops = Array.isArray(voice?.operators) ? voice.operators : [];
    if (!ops.length) return 0.75;
    const sum = ops.reduce((acc, op) => acc + Math.max(0, Math.min(100, Number(op?.level) || 0)), 0);
    return Math.max(0, Math.min(1, sum / (ops.length * 100)));
  }

  function derivePieceMacros(voice){
    const qp = voice?.quickParams || {};
    const ops = Array.isArray(voice?.operators) ? voice.operators : [];
    const op0 = ops[0] || {};
    return {
      level: Math.max(0.05, Math.min(2.0, 0.45 + avgOperatorLevel(voice) * 1.2)),
      tone: norm100(qp.feedback, 50),
      pitch: norm100(qp.tune, 50),
      noise: norm100(qp.noiseMix, 35),
      drive: norm100(qp.drive, 10),
      attack: 0.0008 + norm100(op0.attack, 18) * 0.03,
      decay: 0.03 + norm100(op0.release, 45) * 0.55,
    };
  }

  function buildLegacyDrumParams(ch, snapshot){
    const params = Object.assign({}, ch?.params || {});
    params.__drumMachineUiState = deepClone(snapshot);

    const voices = snapshot?.project?.voices || {};
    function apply(stem, voiceId){
      const voice = voices[voiceId];
      if (!voice) return;
      const p = derivePieceMacros(voice);
      params[stem] = p.level;
      params[stem + 'Attack'] = p.attack;
      params[stem + 'Decay'] = p.decay;
      params[stem + 'Tone'] = p.tone;
      params[stem + 'Pitch'] = p.pitch;
      params[stem + 'Noise'] = p.noise;
      params[stem + 'Drive'] = p.drive;
    }

    apply('kick', 'kickSub');
    apply('kick2', 'kickAcoustic');
    apply('snare', 'snareMain');
    apply('clap', 'clapLayer');
    apply('tomL', 'lowTom');
    apply('tomH', 'highTom');
    apply('hatC', 'openCloseHat');
    apply('hatO', 'openCloseHat');
    apply('ride', 'rideMain');
    apply('crash', 'crash1');
    apply('perc', 'rimshotVar');
    apply('perc2', 'china');
    return params;
  }

  function persistSnapshotToChannel(ch, snapshot){
    if (!ch || !snapshot) return;
    ch.params = buildLegacyDrumParams(ch, snapshot);
    try {
      const simpleRows = (snapshot.project?.mappingRows || []).map((row) => ({
        noteLabel: row.note,
        midiNote: row.midi,
        voiceKey: row.voiceId,
        displayName: row.articulation || row.voiceId,
        family: 'perc',
        mixChannel: row.channel,
        presetId: snapshot.project?.kitId || '',
        macro: row.articulation || '',
        color: '#4da3ff'
      }));
      window.DrumMappingStore?.replaceState?.({
        selectedFamily: snapshot.project?.kitId || 'globalHybridA',
        rows: simpleRows
      });
    } catch (_) {}
  }

  function getWindowBounds(){
    const st = window.DrumWindowStateStore?.getState?.() || {};
    return {
      x: Math.max(0, Number(st.x) || 140),
      y: Math.max(0, Number(st.y) || 120),
      width: Math.max(720, Number(st.width) || 980),
      height: Math.max(520, Number(st.height) || 720),
      minimized: !!st.minimized,
      open: !!st.open
    };
  }

  function applyFrameBounds(){
    if (!frame) return;
    const bounds = getWindowBounds();
    frame.style.left = `${bounds.x}px`;
    frame.style.top = `${bounds.y}px`;
    frame.style.width = `${bounds.width}px`;
    frame.style.height = `${bounds.minimized ? 72 : bounds.height}px`;
  }

  function normalizeSnapshot(snapshot, opts){
    const next = deepClone(snapshot || {}) || {};
    next.ui = next.ui || {};
    next.ui.window = Object.assign({}, next.ui.window || {}, opts || {});
    return next;
  }

  function showWrap(){
    ensureWrap();
    applyFrameBounds();
    wrap.style.display = 'block';
  }

  function hideWrap(){
    if (wrap) wrap.style.display = 'none';
  }

  function syncActiveChannelToUI(forceOpen){
    const ch = activeDrumChannel();
    if (!ch) return;
    ensureWrap();
    const snapshot = getStoredSnapshot(ch);
    if (forceOpen) {
      window.DrumWindowStateStore?.open?.();
      showWrap();
    }
    if (!frameLoaded) return;
    const st = getWindowBounds();
    if (snapshot) {
      postToFrame('drumkit:set-state', normalizeSnapshot(snapshot, { isOpen: true, isMinimized: st.minimized, x: st.x, y: st.y, w: st.width, h: st.height }));
    } else {
      postToFrame('drumkit:request-state', {});
    }
  }

  function triggerPreview(ch, payload, snapshot){
    const rows = Array.isArray(snapshot?.project?.mappingRows) ? snapshot.project.mappingRows : [];
    const row = rows.find((r) => r.id === payload?.rowId) || rows.find((r) => Number(r.midi) === Number(payload?.midi)) || null;
    const midi = Number(payload?.midi ?? row?.midi ?? 36);
    const mixCh = Math.max(1, Number(row?.channel || ch?.mixOut || 1));
    const params = buildLegacyDrumParams(ch, snapshot);
    if (window.audioBackend?.triggerNote) {
      window.audioBackend.triggerNote({
        note: midi,
        velocity: 0.95,
        durationSec: 0.28,
        trackId: 'drum-machine-preview',
        instId: String(ch.id || 'drums-preview'),
        instType: String(ch.preset || 'drums'),
        params,
        mixCh
      }).catch?.(()=>{});
    }
  }

  function pushSnapshotToEngine(ch, snapshot){
    if (!ch || !snapshot || !window.audioBackend?.setInstrumentParams) return;
    const params = buildLegacyDrumParams(ch, snapshot);
    window.audioBackend.setInstrumentParams({
      trackId: 'drum-machine-live',
      instId: String(ch.id || 'drums-live'),
      instType: String(ch.preset || 'drums'),
      params
    }).catch?.(()=>{});
  }

  function onUiMessage(event){
    const msg = event?.data;
    if (!msg || msg.source !== UI_SOURCE) return;
    const detail = msg.detail || {};
    const snapshot = msg.snapshot || null;
    const ch = activeDrumChannel();

    switch (detail.type) {
      case 'ui:drumkit/window-close':
        if (ch && snapshot) persistSnapshotToChannel(ch, normalizeSnapshot(snapshot, { isOpen: false }));
        hideWrap();
        window.DrumWindowStateStore?.close?.();
        break;
      case 'ui:drumkit/window-minimize':
        if (ch && snapshot) persistSnapshotToChannel(ch, normalizeSnapshot(snapshot, { isOpen: true, isMinimized: !!detail.payload?.isMinimized }));
        window.DrumWindowStateStore?.setMinimized?.(!!detail.payload?.isMinimized);
        applyFrameBounds();
        showWrap();
        break;
      case 'ui:drumkit/window-focus':
        if (ch && snapshot) persistSnapshotToChannel(ch, normalizeSnapshot(snapshot, { isOpen: true, isMinimized: false }));
        window.DrumWindowStateStore?.open?.();
        applyFrameBounds();
        showWrap();
        break;
      case 'ui:drumkit/window-move':
        window.DrumWindowStateStore?.setPosition?.(Number(detail.payload?.x) || 0, Number(detail.payload?.y) || 0);
        if (ch && snapshot) persistSnapshotToChannel(ch, normalizeSnapshot(snapshot, { isOpen: true }));
        applyFrameBounds();
        showWrap();
        break;
      case 'ui:drumkit/window-resize':
        window.DrumWindowStateStore?.setSize?.(Number(detail.payload?.w) || 980, Number(detail.payload?.h) || 720);
        if (ch && snapshot) persistSnapshotToChannel(ch, normalizeSnapshot(snapshot, { isOpen: true }));
        applyFrameBounds();
        showWrap();
        break;
      case 'ui:drumkit/state-sync':
        if (ch && snapshot) {
          persistSnapshotToChannel(ch, snapshot);
          pushSnapshotToEngine(ch, snapshot);
        }
        break;
      case 'engine:drumkit/preview-note':
        if (ch && snapshot) triggerPreview(ch, detail.payload || {}, snapshot);
        break;
      case 'project:drumkit/load-kit':
      case 'project:drumkit/mapping-row-update':
      case 'project:drumkit/operator-set-envelope':
      case 'project:drumkit/voice-set-algorithm':
      case 'project:drumkit/voice-set-xy':
      case 'project:drumkit/voice-set-quick-param':
      case 'project:drumkit/operator-set-param':
        if (ch && snapshot) {
          const normalized = normalizeSnapshot(snapshot, { isOpen: true });
          persistSnapshotToChannel(ch, normalized);
          pushSnapshotToEngine(ch, normalized);
        }
        break;
      default:
        if (ch && snapshot) {
          const normalized = normalizeSnapshot(snapshot, { isOpen: true });
          persistSnapshotToChannel(ch, normalized);
        }
        break;
    }

    try {
      window.dispatchEvent(new CustomEvent('drumkit:ipc', { detail }));
      window.dispatchEvent(new CustomEvent('drumkit:ipc:snapshot', { detail: { detail, snapshot } }));
    } catch (_) {}
    try { if (typeof renderInstrumentPanel === 'function') renderInstrumentPanel(); } catch (_) {}
  }

  window.addEventListener('message', onUiMessage);
  window.DrumWindowStateStore?.subscribe?.((st) => {
    applyFrameBounds();
    if (st?.open) showWrap();
    else hideWrap();
  });

  window.DrumMachineHost = {
    openForActiveChannel(){
      const ch = activeDrumChannel();
      if (!ch) return false;
      window.DrumWindowStateStore?.open?.();
      showWrap();
      syncActiveChannelToUI(true);
      return true;
    },
    toggleForActiveChannel(){
      if (this.isOpen()) { this.close(); return false; }
      return this.openForActiveChannel();
    },
    close(){ hideWrap(); window.DrumWindowStateStore?.close?.(); },
    syncActiveChannelToUI,
    isOpen(){ return !!wrap && wrap.style.display !== 'none'; }
  };
})();
