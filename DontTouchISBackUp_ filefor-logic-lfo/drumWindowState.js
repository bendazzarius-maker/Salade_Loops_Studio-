/* ================= Electro DAW | drumWindowState.js ================= */
(function(){
  const LS_KEY = 'sls.drums.windowState.v1';
  const listeners = new Set();

  const DEFAULT_STATE = {
    open: false,
    minimized: false,
    x: 140,
    y: 120,
    width: 980,
    height: 720,
    zIndex: 40,
    selectedPieceId: 'kickMain',
    selectedFamily: 'Jazz Studio'
  };

  function clone(v){
    return JSON.parse(JSON.stringify(v));
  }

  function loadState(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return clone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return Object.assign(clone(DEFAULT_STATE), parsed || {});
    } catch (_) {
      return clone(DEFAULT_STATE);
    }
  }

  let state = loadState();

  function persist(){
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function emit(){
    persist();
    const snapshot = clone(state);
    listeners.forEach(function(fn){
      try { fn(snapshot); } catch (err) { console.warn('[drumWindowState] listener error', err); }
    });
  }

  function setState(patch){
    state = Object.assign({}, state, patch || {});
    emit();
    return clone(state);
  }

  window.DrumWindowStateStore = {
    getState: function(){ return clone(state); },
    subscribe: function(fn){
      if (typeof fn !== 'function') return function(){};
      listeners.add(fn);
      try { fn(clone(state)); } catch (_) {}
      return function(){ listeners.delete(fn); };
    },
    setState: setState,
    open: function(){ return setState({ open: true, minimized: false }); },
    close: function(){ return setState({ open: false }); },
    toggleOpen: function(){ return setState({ open: !state.open }); },
    setMinimized: function(flag){ return setState({ minimized: !!flag }); },
    setPosition: function(x, y){
      return setState({ x: Number(x) || 0, y: Number(y) || 0 });
    },
    setSize: function(width, height){
      return setState({ width: Math.max(480, Number(width) || DEFAULT_STATE.width), height: Math.max(320, Number(height) || DEFAULT_STATE.height) });
    },
    bringToFront: function(zIndex){
      return setState({ zIndex: Math.max(1, Number(zIndex) || state.zIndex || DEFAULT_STATE.zIndex) });
    },
    selectPiece: function(pieceId){
      return setState({ selectedPieceId: String(pieceId || '') || DEFAULT_STATE.selectedPieceId });
    },
    selectFamily: function(family){
      return setState({ selectedFamily: String(family || '') || DEFAULT_STATE.selectedFamily });
    },
    reset: function(){
      state = clone(DEFAULT_STATE);
      emit();
      return clone(state);
    }
  };
})();
